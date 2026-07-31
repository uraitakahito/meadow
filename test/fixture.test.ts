import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";

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

describe("static assets", () => {
  it("serves /assets/hero.svg", async () => {
    const res = await app.inject("/assets/hero.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg");
  });
});
