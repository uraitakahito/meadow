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

  it("/ok returns 200 HTML", async () => {
    const res = await app.inject("/ok");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<h1>ok</h1>");
  });

  it("/redirect-page ships a client-side location.replace", async () => {
    const res = await app.inject("/redirect-page");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('location.replace("/landed")');
  });

  it("/lazy has a below-the-fold lazy image", async () => {
    const res = await app.inject("/lazy");
    expect(res.body).toContain('loading="lazy"');
    expect(res.body).toContain("/assets/hero.svg");
  });

  it("/banner has a fixed cookie overlay", async () => {
    const res = await app.inject("/banner");
    expect(res.body).toContain("cookie-banner");
  });

  it("/set-cookie sets a cookie header", async () => {
    const res = await app.inject("/set-cookie");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.body).toContain("localStorage.setItem");
  });
});

describe("controllable responses", () => {
  it("/slow waits the requested time then responds", async () => {
    const res = await app.inject("/slow?ms=5");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("slept 5ms");
  });

  it("/status/:code returns that status", async () => {
    expect((await app.inject("/status/503")).statusCode).toBe(503);
    expect((await app.inject("/status/404")).statusCode).toBe(404);
    expect((await app.inject("/status/204")).statusCode).toBe(204);
  });

  it("/redirect/:n chains 302s down to /landed", async () => {
    const two = await app.inject("/redirect/2");
    expect(two.statusCode).toBe(302);
    expect(two.headers.location).toBe("/redirect/1");

    const zero = await app.inject("/redirect/0");
    expect(zero.statusCode).toBe(302);
    expect(zero.headers.location).toBe("/landed");
  });

  it("/big returns a body of the requested size", async () => {
    const res = await app.inject("/big?bytes=100");
    expect(res.rawPayload.length).toBe(100);
  });

  it("/drip trickles the requested number of bytes", async () => {
    const res = await app.inject("/drip?bytes=50&ms=0");
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(50);
  });
});

describe("stateful flaky", () => {
  it("fails `fail` times then succeeds, per key", async () => {
    const url = "/flaky?fail=2&key=t1";
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(200);
  });

  it("isolates counters between keys", async () => {
    expect((await app.inject("/flaky?fail=1&key=a")).statusCode).toBe(503);
    // Different key starts fresh, so it is still on its first (failing) request.
    expect((await app.inject("/flaky?fail=1&key=b")).statusCode).toBe(503);
    // `a` has now had its one failure and succeeds.
    expect((await app.inject("/flaky?fail=1&key=a")).statusCode).toBe(200);
  });
});

describe("introspection", () => {
  it("/__hits counts requests per URL", async () => {
    await app.inject("/ok");
    await app.inject("/ok");
    await app.inject("/landed");
    const hits = (await app.inject("/__hits")).json<Record<string, number>>();
    expect(hits["/ok"]).toBe(2);
    expect(hits["/landed"]).toBe(1);
  });

  it("/__reset clears counters and flaky state", async () => {
    await app.inject("/flaky?fail=1&key=r");
    await app.inject("/ok");
    const reset = await app.inject({ method: "POST", url: "/__reset" });
    expect(reset.statusCode).toBe(200);

    // Counters gone (only this /__hits request is counted now).
    const hits = (await app.inject("/__hits")).json<Record<string, number>>();
    expect(hits["/ok"]).toBeUndefined();
    // Flaky counter reset, so key=r fails again on its fresh first request.
    expect((await app.inject("/flaky?fail=1&key=r")).statusCode).toBe(503);
  });
});

describe("static assets", () => {
  it("serves /assets/hero.svg", async () => {
    const res = await app.inject("/assets/hero.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg");
  });
});
