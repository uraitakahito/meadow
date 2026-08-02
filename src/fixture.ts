import { join } from "node:path";
import { Readable } from "node:stream";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { BUILD_INFO } from "./generated/version.js";

const PLAIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;
/**
 * A page the browser will revalidate on every visit.
 *
 * `no-cache` means "store it, but ask before reusing it" — so the second and
 * every later navigation sends `If-None-Match` and this route answers `304`,
 * which carries no body. That is the state BrowserHive's cache modes exist to
 * deal with, and nothing else in this fixture set can produce it: every other
 * route sends no validator at all, so Chromium has nothing to revalidate
 * against and never asks.
 *
 * Deliberately not `max-age`: a fresh entry is served from cache without
 * contacting the origin at all, which reports as a 200 and proves nothing.
 */
const CACHEABLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>cacheable</title></head><body><h1>cacheable</h1></body></html>`;
const CACHEABLE_ETAG = '"meadow-cacheable-v1"';

const REDIRECT_TARGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>landed</title></head><body><h1>landed</h1></body></html>`;

// Client-side navigation on DOMContentLoaded. BrowserHive's runOnStableContext
// must survive the "Execution context was destroyed" this triggers.
const CLIENT_SIDE_REDIRECT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>redirecting</title></head><body><script>location.replace("/redirect-target")</script></body></html>`;

// Below-the-fold lazy image + IntersectionObserver-swapped data-src. Only a
// browser that scrolls (autoScroll) will request /assets/hero.svg and /assets/below.svg.
/**
 * A page with no bottom.
 *
 * BrowserHive's `autoscroll` decides it has reached the end of a page by
 * scrolling, waiting 250ms and checking whether `scrollY` moved. So the page
 * has to have grown by then, every time — which is why the growing happens in
 * a `scroll` handler. Those run synchronously as the scroll is applied, so
 * they cannot be late.
 *
 * An `IntersectionObserver` would look far more like a real feed, and that is
 * exactly the trap: its callback is asynchronous, and a late one leaves
 * `scrollY` unchanged at the moment autoscroll looks. Autoscroll then reports
 * `reachedBottom: true` and the test that depends on this fixture goes red for
 * a reason that has nothing to do with what it is testing. A flaky fixture
 * gets a `retry` bolted on eventually, and then it is testing nothing.
 *
 * What is wanted here is not realism. It is the guarantee that the bottom is
 * never reached.
 */
const ENDLESS_FEED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>endless</title></head><body style="margin:0">
<div id="feed"></div>
<script>
var feed = document.getElementById("feed");
var screens = 0;
// Always keep three screens of runway below wherever we are. One would race
// the check outright; two still races it on the fractional final step.
function grow() {
  var want = window.scrollY + window.innerHeight * 3;
  while (feed.offsetHeight < want) {
    var s = document.createElement("div");
    s.style.height = "100vh";
    s.textContent = "screen " + (++screens);
    feed.appendChild(s);
  }
}
addEventListener("scroll", grow);
grow();
</script>
</body></html>`;

const LAZY_IMAGES_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>lazy</title></head><body>
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
const COOKIE_BANNER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>banner</title></head><body>
<h1>content</h1>
<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:16px">
  We use cookies. <button onclick="document.getElementById('cookie-banner').remove()">Accept</button>
</div>
</body></html>`;

// Sets a cookie and writes localStorage; resetPageState must clear both between tasks.
const COOKIE_AND_STORAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>set-cookie</title></head><body>
<h1>state</h1>
<script>localStorage.setItem("meadow", Date.now().toString())</script>
</body></html>`;

const FAILING_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>retry</title></head><body><h1>retry</h1></body></html>`;
const SUCCEEDED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;

/**
 * Hold the page's main thread for `holdMs` at a time, repeating for
 * `repeatForMs`. While it is held nothing else in the page runs: `setTimeout`
 * callbacks cannot fire and `page.evaluate` cannot even start.
 *
 * This is the only way an origin can make a capture's per-operation budget
 * expire. A slow *response* (`/slow`) delays the navigation; it does not stop
 * the page from working once it has loaded.
 *
 * The holding starts from a `setTimeout`, not during parsing. Blocking the
 * parse would delay `DOMContentLoaded` itself, which pushes the cost onto the
 * navigation's 30s budget instead of the 5s budgets that guard the in-page
 * operations — a different thing entirely.
 */
const blockMainThreadHtml = (holdMs: number, repeatForMs: number): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>blocked</title></head><body><h1>blocked</h1>
<script>
const deadline = Date.now() + ${String(repeatForMs)};
const holdThread = () => {
  if (Date.now() >= deadline) { document.title = "unblocked"; return; }
  const until = Date.now() + ${String(holdMs)};
  while (Date.now() < until) { /* synchronous: nothing else in the page runs */ }
  setTimeout(holdThread, 0);
};
setTimeout(holdThread, 0);
</script>
</body></html>`;

/**
 * Ceiling for `repeatForMs`. A page that holds its thread forever survives the
 * capture that asked for it and wedges whatever runs next in the same tab.
 */
const MAX_REPEAT_FOR_MS = 30_000;

/** Trickle `bytes` bytes of "a" over roughly `overMs` milliseconds, in ~10 chunks. */
async function* slowBody(bytes: number, overMs: number): AsyncGenerator<Buffer> {
  const chunks = 10;
  const perChunk = Math.max(1, Math.ceil(bytes / chunks));
  const interval = Math.max(0, Math.floor(overMs / chunks));
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
/**
 * One request as it arrived, for `/__requests`.
 *
 * A bounded set of headers, not all of them. Recording everything makes the
 * memory cost of a long-running dev container unpredictable, and an endpoint
 * that shows anything does not tell a reader what is worth looking at. When
 * something else turns out to be needed, adding it leaves a test explaining
 * why.
 */
export interface RecordedRequest {
  url: string;
  method: string;
  /**
   * The header that separates "the browser revalidated" from "the browser
   * fetched again" — and the reason this endpoint exists at all.
   */
  ifNoneMatch?: string;
  /** The same question for resources served without an `ETag`. */
  ifModifiedSince?: string;
  cacheControl?: string;
  acceptLanguage?: string;
}

/**
 * What `/__requests` returns.
 *
 * Deliberately NOT a way to count requests — use `/__request-counts` for that.
 * This log is capped, so counting it is right until the cap is reached and
 * quietly wrong afterwards. The two endpoints make different promises: counts
 * are exact and unbounded, this is the most recent `REQUEST_LOG_LIMIT`.
 */
export interface RequestLog {
  /** Arrival order. "The first was unconditional, the second was not" needs it. */
  requests: RecordedRequest[];
  /** True once the cap has dropped something. The log is no longer everything. */
  truncated: boolean;
}

/** How many requests `/__requests` keeps before dropping the oldest. */
export const REQUEST_LOG_LIMIT = 1000;

/** Headers worth keeping, and the field each lands in. */
const RECORDED_HEADERS = [
  ["if-none-match", "ifNoneMatch"],
  ["if-modified-since", "ifModifiedSince"],
  ["cache-control", "cacheControl"],
  ["accept-language", "acceptLanguage"],
] as const;

export function buildFixture(): FastifyInstance {
  const app = Fastify();

  // Per-URL request counter for retry/throughput assertions (/__request-counts).
  const hits = new Map<string, number>();
  // Per-key failure counter backing /fails-then-succeeds.
  const failureCounts = new Map<string, number>();
  // The last REQUEST_LOG_LIMIT requests, with headers (/__requests).
  const requests: RecordedRequest[] = [];
  let truncated = false;

  app.addHook("onRequest", (request, _reply, done) => {
    hits.set(request.url, (hits.get(request.url) ?? 0) + 1);

    // Introspection endpoints stay out of the log. Reading it must not change
    // what it says, or answering "was the second request conditional?" starts
    // with subtracting the reads.
    //
    // The counter above deliberately keeps counting them: it has always done
    // so, and tests are written against that.
    if (!request.url.startsWith("/__")) {
      if (requests.length >= REQUEST_LOG_LIMIT) {
        requests.shift();
        truncated = true;
      }
      const recorded: RecordedRequest = { url: request.url, method: request.method };
      for (const [header, field] of RECORDED_HEADERS) {
        const value = request.headers[header];
        if (typeof value === "string") recorded[field] = value;
      }
      requests.push(recorded);
    }
    done();
  });

  // Static assets (referenced by /lazy and available as /assets/*).
  void app.register(fastifyStatic, {
    root: join(import.meta.dirname, "..", "site"),
    prefix: "/assets/",
  });

  app.get("/health", () => ({ ok: true }));

  app.get("/plain-html", (_request, reply) => reply.type("text/html").send(PLAIN_HTML));
  app.get("/cacheable", (request, reply) => {
    reply.header("cache-control", "no-cache").header("etag", CACHEABLE_ETAG);
    // 304 carries no body by definition — that is the whole point of the
    // fixture, not an oversight.
    if (request.headers["if-none-match"] === CACHEABLE_ETAG) {
      return reply.code(304).send();
    }
    return reply.type("text/html").send(CACHEABLE_HTML);
  });

  app.get("/redirect-target", (_request, reply) => reply.type("text/html").send(REDIRECT_TARGET_HTML));
  app.get("/client-side-redirect", (_request, reply) => reply.type("text/html").send(CLIENT_SIDE_REDIRECT_HTML));
  app.get("/lazy-images", (_request, reply) => reply.type("text/html").send(LAZY_IMAGES_HTML));
  app.get("/endless-feed", (_request, reply) =>
    reply.type("text/html").send(ENDLESS_FEED_HTML));
  app.get("/cookie-banner", (_request, reply) => reply.type("text/html").send(COOKIE_BANNER_HTML));

  app.get("/cookie-and-storage", (_request, reply) =>
    reply
      .header("set-cookie", "meadow=1; Path=/; HttpOnly")
      .type("text/html")
      .send(COOKIE_AND_STORAGE_HTML),
  );

  app.get<{ Querystring: { delayMs?: string } }>("/slow-response", async (request, reply) => {
    const delayMs = Number(request.query.delayMs ?? "35000");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return reply.type("text/html").send(`<!doctype html><h1>slept ${String(delayMs)}ms</h1>`);
  });

  app.get<{ Querystring: { holdMs?: string; repeatForMs?: string } }>(
    "/block-main-thread",
    (request, reply) => {
      const holdMs = Number(request.query.holdMs ?? "1000");
      const repeatForMs = Math.min(
        Number(request.query.repeatForMs ?? "10000"),
        MAX_REPEAT_FOR_MS,
      );
      return reply.type("text/html").send(blockMainThreadHtml(holdMs, repeatForMs));
    },
  );

  app.get<{ Params: { code: string } }>("/http-status/:code", (request, reply) => {
    const code = Number(request.params.code);
    return reply.code(code).type("text/html").send(`<!doctype html><h1>${String(code)}</h1>`);
  });

  app.get<{ Params: { hops: string } }>("/server-redirect-chain/:hops", (request, reply) => {
    const hops = Number(request.params.hops);
    const target = hops > 0 ? `/server-redirect-chain/${String(hops - 1)}` : "/redirect-target";
    return reply.redirect(target, 302);
  });

  app.get<{ Querystring: { bytes?: string } }>("/large-body", (request, reply) => {
    const bytes = Number(request.query.bytes ?? "1048576");
    return reply.type("text/plain").send("a".repeat(bytes));
  });

  app.get<{ Querystring: { bytes?: string; overMs?: string } }>("/slow-body", (request, reply) => {
    const bytes = Number(request.query.bytes ?? "65536");
    const overMs = Number(request.query.overMs ?? "5000");
    return reply.type("text/plain").send(Readable.from(slowBody(bytes, overMs)));
  });

  app.get<{ Querystring: { failTimes?: string; key?: string } }>("/fails-then-succeeds", (request, reply) => {
    const key = request.query.key ?? "default";
    const failTimes = Number(request.query.failTimes ?? "2");
    const n = (failureCounts.get(key) ?? 0) + 1;
    failureCounts.set(key, n);
    if (n <= failTimes) return reply.code(503).type("text/html").send(FAILING_HTML);
    return reply.type("text/html").send(SUCCEEDED_HTML);
  });

  // Test-only introspection: read counters, reset all in-memory state.
  app.get("/__request-counts", () => Object.fromEntries(hits));
  app.get("/__requests", (): RequestLog => ({ requests, truncated }));
  app.post("/__reset", () => {
    hits.clear();
    failureCounts.clear();
    requests.length = 0;
    truncated = false;
    return { ok: true };
  });

  // Which build is answering. Deliberately not folded into /health: that
  // question is "are you up", asked in a tight loop by readiness waits, and it
  // should keep answering only that. This one is asked when a test fails for
  // no visible reason and you start wondering whether the container in front
  // of you was ever rebuilt.
  app.get("/__version", () => BUILD_INFO);

  return app;
}
