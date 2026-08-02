import { describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

describe("scenarios URL contract", () => {
  it("builds parameterised paths", () => {
    expect(scenarios.plainHtml).toBe("/plain-html");
    expect(scenarios.endlessFeed).toBe("/endless-feed");
    expect(scenarios.slowResponse(30000)).toBe("/slow-response?delayMs=30000");
    expect(scenarios.httpStatus(404)).toBe("/http-status/404");
    expect(scenarios.serverRedirectChain(3)).toBe("/server-redirect-chain/3");
    expect(scenarios.largeBody(2048)).toBe("/large-body?bytes=2048");
    expect(scenarios.slowBody(100, 500)).toBe("/slow-body?bytes=100&overMs=500");
    expect(scenarios.asset("hero.svg")).toBe("/assets/hero.svg");
  });

  it("url-encodes counter keys so parallel tests stay isolated", () => {
    expect(scenarios.failsThenSucceeds(2, "a b")).toBe("/fails-then-succeeds?failTimes=2&key=a%20b");
  });

  it("the contract matches the running fixture", async () => {
    const app = buildFixture();
    try {
      expect((await app.inject(scenarios.httpStatus(503))).statusCode).toBe(503);
      expect((await app.inject(scenarios.plainHtml)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
