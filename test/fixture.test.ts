import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture, REQUEST_LOG_LIMIT, type RequestLog } from "../src/fixture.js";

let app: ReturnType<typeof buildFixture>;

beforeEach(() => {
  app = buildFixture();
});

afterEach(async () => {
  await app.close();
});

describe("static pages", () => {
  it("/health returns ok", async () => {
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("/plain-html returns 200 HTML", async () => {
    const res = await app.inject("/plain-html");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<h1>ok</h1>");
  });

  it("/client-side-redirect ships a client-side location.replace", async () => {
    const res = await app.inject("/client-side-redirect");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('location.replace("/redirect-target")');
  });

  it("/lazy-images has a below-the-fold lazy image", async () => {
    const res = await app.inject("/lazy-images");
    expect(res.body).toContain('loading="lazy"');
    expect(res.body).toContain("/assets/hero.svg");
  });

  it("/endless-feed grows itself from a scroll handler, not an observer", async () => {
    const res = await app.inject("/endless-feed");

    expect(res.statusCode).toBe(200);
    // The distinction this fixture exists for. A scroll handler runs
    // synchronously with the scroll, so the page has always grown by the time
    // BrowserHive's autoscroll checks whether `scrollY` moved. An
    // IntersectionObserver callback can be late, and a late one makes
    // autoscroll report that it reached the bottom of a page that has none.
    expect(res.body).toContain('addEventListener("scroll"');
    expect(res.body).not.toContain("IntersectionObserver");
    // Runway, so growing never races the check. Verified against a real
    // capture in browserhive's e2e; reducing it there turns that test red.
    expect(res.body).toContain("window.innerHeight * 3");
  });

  it("/cookie-banner has a fixed cookie overlay", async () => {
    const res = await app.inject("/cookie-banner");
    expect(res.body).toContain("cookie-banner");
  });

  it("/cookie-and-storage sets a cookie header", async () => {
    const res = await app.inject("/cookie-and-storage");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.body).toContain("localStorage.setItem");
  });
});

describe("controllable responses", () => {
  it("/slow waits the requested time then responds", async () => {
    const res = await app.inject("/slow-response?delayMs=5");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("slept 5ms");
  });

  it("/http-status/:code returns that status", async () => {
    expect((await app.inject("/http-status/503")).statusCode).toBe(503);
    expect((await app.inject("/http-status/404")).statusCode).toBe(404);
    expect((await app.inject("/http-status/204")).statusCode).toBe(204);
  });

  it("/server-redirect-chain/:n chains 302s down to /landed", async () => {
    const two = await app.inject("/server-redirect-chain/2");
    expect(two.statusCode).toBe(302);
    expect(two.headers.location).toBe("/server-redirect-chain/1");

    const zero = await app.inject("/server-redirect-chain/0");
    expect(zero.statusCode).toBe(302);
    expect(zero.headers.location).toBe("/redirect-target");
  });

  it("/big returns a body of the requested size", async () => {
    const res = await app.inject("/large-body?bytes=100");
    expect(res.rawPayload.length).toBe(100);
  });

  it("/slow-body trickles the requested number of bytes", async () => {
    const res = await app.inject("/slow-body?bytes=50&overMs=0");
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(50);
  });
});

describe("stateful fails-then-succeeds", () => {
  it("fails `fail` times then succeeds, per key", async () => {
    const url = "/fails-then-succeeds?failTimes=2&key=t1";
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(200);
  });

  it("isolates counters between keys", async () => {
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=a")).statusCode).toBe(503);
    // Different key starts fresh, so it is still on its first (failing) request.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=b")).statusCode).toBe(503);
    // `a` has now had its one failure and succeeds.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=a")).statusCode).toBe(200);
  });
});

describe("introspection", () => {
  it("/__request-counts counts requests per URL", async () => {
    await app.inject("/plain-html");
    await app.inject("/plain-html");
    await app.inject("/redirect-target");
    const hits = (await app.inject("/__request-counts")).json<Record<string, number>>();
    expect(hits["/plain-html"]).toBe(2);
    expect(hits["/redirect-target"]).toBe(1);
  });

  it("/__requests records whether a request was conditional", async () => {
    // The whole reason this exists. /__request-counts can say a URL was asked
    // for twice; it cannot say the second ask carried If-None-Match, which is
    // the only thing that distinguishes "the browser revalidated" from "the
    // browser fetched again".
    const first = await app.inject("/cacheable");
    const etag = first.headers.etag!;
    await app.inject({ url: "/cacheable", headers: { "if-none-match": etag } });

    const log = (await app.inject("/__requests")).json<RequestLog>();

    // Arrival order matters as much as the contents: the statement being made
    // is "the first was unconditional and the second was not".
    expect(log.requests).toHaveLength(2);
    expect(log.requests[0]?.url).toBe("/cacheable");
    expect(log.requests[0]?.ifNoneMatch).toBeUndefined();
    expect(log.requests[1]?.ifNoneMatch).toBe(etag);
    expect(log.truncated).toBe(false);
  });

  it("/__requests keeps the headers that explain caching, and no others", async () => {
    await app.inject({
      url: "/plain-html",
      headers: {
        "accept-language": "ja-JP,ja;q=0.9",
        "cache-control": "no-cache",
        "if-modified-since": "Sun, 02 Aug 2026 00:00:00 GMT",
        // Deliberately not recorded: a bounded set is what keeps the memory
        // cost of a long-running dev container predictable.
        cookie: "session=secret",
      },
    });

    const log = (await app.inject("/__requests")).json<RequestLog>();
    const only = log.requests[0];

    expect(only?.acceptLanguage).toBe("ja-JP,ja;q=0.9");
    expect(only?.cacheControl).toBe("no-cache");
    expect(only?.ifModifiedSince).toBe("Sun, 02 Aug 2026 00:00:00 GMT");
    expect(only?.method).toBe("GET");
    expect(Object.keys(only ?? {})).not.toContain("cookie");
  });

  it("/__requests does not record the introspection endpoints themselves", async () => {
    // Looking at the log must not change what the log says. Otherwise reading
    // "was the second request conditional?" means first subtracting the reads.
    await app.inject("/plain-html");
    await app.inject("/__requests");
    await app.inject("/__request-counts");

    const log = (await app.inject("/__requests")).json<RequestLog>();
    expect(log.requests.map((r) => r.url)).toEqual(["/plain-html"]);
  });

  it("/__requests drops the oldest once the limit is hit, and says it did", async () => {
    // The limit exists so a dev container running for days cannot grow without
    // bound. `truncated` exists so nobody counts a truncated log and believes
    // the number.
    for (let i = 0; i <= REQUEST_LOG_LIMIT; i++) {
      await app.inject(`/plain-html?i=${String(i)}`);
    }

    const log = (await app.inject("/__requests")).json<RequestLog>();
    expect(log.truncated).toBe(true);
    expect(log.requests).toHaveLength(REQUEST_LOG_LIMIT);
    expect(log.requests[0]?.url).not.toContain("i=0");
  });

  it("/__reset clears the request log as well", async () => {
    await app.inject("/plain-html");
    await app.inject({ method: "POST", url: "/__reset" });

    const log = (await app.inject("/__requests")).json<RequestLog>();
    expect(log).toEqual({ requests: [], truncated: false });
  });

  it("/__reset clears counters and failure state", async () => {
    await app.inject("/fails-then-succeeds?failTimes=1&key=r");
    await app.inject("/plain-html");
    const reset = await app.inject({ method: "POST", url: "/__reset" });
    expect(reset.statusCode).toBe(200);

    // Counters gone (only this /__request-counts request is counted now).
    const hits = (await app.inject("/__request-counts")).json<Record<string, number>>();
    expect(hits["/plain-html"]).toBeUndefined();
    // Flaky counter reset, so key=r fails again on its fresh first request.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=r")).statusCode).toBe(503);
  });
});

describe("block-main-thread", () => {
  it("embeds both durations", async () => {
    const res = await app.inject("/block-main-thread?holdMs=6000&repeatForMs=20000");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Date.now() + 20000");
    expect(res.body).toContain("Date.now() + 6000");
  });

  it("does not block parsing — the holding starts from a setTimeout", async () => {
    // If this regresses, the cost lands on the consumer's navigation budget
    // instead of its in-page operation budgets, and the scenario silently
    // stops testing what it exists to test.
    const res = await app.inject("/block-main-thread");
    expect(res.body).toContain("setTimeout(holdThread, 0);\n</script>");
  });

  it("caps repeatForMs so a page cannot hold its thread forever", async () => {
    const res = await app.inject("/block-main-thread?repeatForMs=999999");
    expect(res.body).toContain("Date.now() + 30000");
  });
});

describe("__version", () => {
  it("reports the three fields it exists to report", async () => {
    const res = await app.inject("/__version");
    expect(res.statusCode).toBe(200);
    // The values move with every build, so only the shape is pinned here.
    // Asserting the contents would turn this into a test of
    // generate-version.mjs, which is a different thing entirely.
    const body = res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["buildTime", "revision", "version"]);
    for (const [field, value] of Object.entries(body)) {
      expect(typeof value, field).toBe("string");
    }
  });

  it("leaves /health answering only whether it is up", async () => {
    // The split is the point of having two routes. Readiness waits poll
    // /health in a tight loop and should keep getting one small answer.
    expect((await app.inject("/health")).json()).toEqual({ ok: true });
  });
});

describe("static assets", () => {
  it("serves /assets/hero.svg", async () => {
    const res = await app.inject("/assets/hero.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg");
  });
});
