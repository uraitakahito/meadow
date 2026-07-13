import { join } from "node:path";
import { Readable } from "node:stream";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

const OK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;
const LANDED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>landed</title></head><body><h1>landed</h1></body></html>`;

// Client-side navigation on DOMContentLoaded. BrowserHive's runOnStableContext
// must survive the "Execution context was destroyed" this triggers.
const REDIRECT_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>redirecting</title></head><body><script>location.replace("/landed")</script></body></html>`;

// Below-the-fold lazy image + IntersectionObserver-swapped data-src. Only a
// browser that scrolls (autoScroll) will request /assets/hero.svg and /assets/below.svg.
const LAZY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>lazy</title></head><body>
<h1>top</h1>
<div style="height:3000px">scroll down</div>
<img loading="lazy" src="/assets/hero.svg" width="64" height="64" alt="lazy">
<img id="io" data-src="/assets/below.svg" width="64" height="64" alt="observed">
<script>
new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const img = e.target;
      img.src = img.dataset.src;
      obs.unobserve(img);
    }
  }
}).observe(document.getElementById("io"));
</script>
</body></html>`;

// Fixed cookie-consent overlay for dismissBanners to find and remove.
const BANNER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>banner</title></head><body>
<h1>content</h1>
<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:16px">
  We use cookies. <button onclick="document.getElementById('cookie-banner').remove()">Accept</button>
</div>
</body></html>`;

// Sets a cookie and writes localStorage; resetPageState must clear both between tasks.
const SET_COOKIE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>set-cookie</title></head><body>
<h1>state</h1>
<script>localStorage.setItem("meadow", Date.now().toString())</script>
</body></html>`;

const FLAKY_RETRY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>retry</title></head><body><h1>retry</h1></body></html>`;
const FLAKY_OK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;

/** Trickle `bytes` bytes of "a" over roughly `ms` milliseconds, in ~10 chunks. */
async function* dripBody(bytes: number, ms: number): AsyncGenerator<Buffer> {
  const chunks = 10;
  const perChunk = Math.max(1, Math.ceil(bytes / chunks));
  const interval = Math.max(0, Math.floor(ms / chunks));
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(perChunk, remaining);
    remaining -= size;
    if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    yield Buffer.alloc(size, 0x61);
  }
}

/**
 * Build the fixture-origin Fastify app.
 *
 * Same core in two shapes: import it for in-process tests (via `app.inject`)
 * or run it in a container (`serve.ts`) so a worker's Chrome reaches it by IP.
 */
export function buildFixture(): FastifyInstance {
  const app = Fastify();

  // Per-URL request counter for retry/throughput assertions (/__hits).
  const hits = new Map<string, number>();
  // Per-key failure counter backing /flaky.
  const flaky = new Map<string, number>();

  app.addHook("onRequest", (request, _reply, done) => {
    hits.set(request.url, (hits.get(request.url) ?? 0) + 1);
    done();
  });

  // Static assets (referenced by /lazy and available as /assets/*).
  void app.register(fastifyStatic, {
    root: join(import.meta.dirname, "..", "site"),
    prefix: "/assets/",
  });

  app.get("/health", () => ({ ok: true }));

  app.get("/ok", (_request, reply) => reply.type("text/html").send(OK_HTML));
  app.get("/landed", (_request, reply) => reply.type("text/html").send(LANDED_HTML));
  app.get("/redirect-page", (_request, reply) => reply.type("text/html").send(REDIRECT_PAGE_HTML));
  app.get("/lazy", (_request, reply) => reply.type("text/html").send(LAZY_HTML));
  app.get("/banner", (_request, reply) => reply.type("text/html").send(BANNER_HTML));

  app.get("/set-cookie", (_request, reply) =>
    reply
      .header("set-cookie", "meadow=1; Path=/; HttpOnly")
      .type("text/html")
      .send(SET_COOKIE_HTML),
  );

  app.get<{ Querystring: { ms?: string } }>("/slow", async (request, reply) => {
    const ms = Number(request.query.ms ?? "35000");
    await new Promise((resolve) => setTimeout(resolve, ms));
    return reply.type("text/html").send(`<!doctype html><h1>slept ${String(ms)}ms</h1>`);
  });

  app.get<{ Params: { code: string } }>("/status/:code", (request, reply) => {
    const code = Number(request.params.code);
    return reply.code(code).type("text/html").send(`<!doctype html><h1>${String(code)}</h1>`);
  });

  app.get<{ Params: { n: string } }>("/redirect/:n", (request, reply) => {
    const n = Number(request.params.n);
    const target = n > 0 ? `/redirect/${String(n - 1)}` : "/landed";
    return reply.redirect(target, 302);
  });

  app.get<{ Querystring: { bytes?: string } }>("/big", (request, reply) => {
    const bytes = Number(request.query.bytes ?? "1048576");
    return reply.type("text/plain").send("a".repeat(bytes));
  });

  app.get<{ Querystring: { bytes?: string; ms?: string } }>("/drip", (request, reply) => {
    const bytes = Number(request.query.bytes ?? "65536");
    const ms = Number(request.query.ms ?? "5000");
    return reply.type("text/plain").send(Readable.from(dripBody(bytes, ms)));
  });

  app.get<{ Querystring: { fail?: string; key?: string } }>("/flaky", (request, reply) => {
    const key = request.query.key ?? "default";
    const fail = Number(request.query.fail ?? "2");
    const n = (flaky.get(key) ?? 0) + 1;
    flaky.set(key, n);
    if (n <= fail) return reply.code(503).type("text/html").send(FLAKY_RETRY_HTML);
    return reply.type("text/html").send(FLAKY_OK_HTML);
  });

  // Test-only introspection: read counters, reset all in-memory state.
  app.get("/__hits", () => Object.fromEntries(hits));
  app.post("/__reset", () => {
    hits.clear();
    flaky.clear();
    return { ok: true };
  });

  return app;
}
