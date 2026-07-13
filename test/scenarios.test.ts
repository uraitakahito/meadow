import { describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

describe("scenarios URL contract", () => {
  it("builds parameterised paths", () => {
    expect(scenarios.ok).toBe("/ok");
    expect(scenarios.slow(30000)).toBe("/slow?ms=30000");
    expect(scenarios.status(404)).toBe("/status/404");
    expect(scenarios.redirect(3)).toBe("/redirect/3");
    expect(scenarios.big(2048)).toBe("/big?bytes=2048");
    expect(scenarios.drip(100, 500)).toBe("/drip?bytes=100&ms=500");
    expect(scenarios.asset("hero.svg")).toBe("/assets/hero.svg");
  });

  it("url-encodes flaky keys so parallel tests stay isolated", () => {
    expect(scenarios.flaky(2, "a b")).toBe("/flaky?fail=2&key=a%20b");
  });

  it("the contract matches the running fixture", async () => {
    const app = buildFixture();
    try {
      expect((await app.inject(scenarios.status(503))).statusCode).toBe(503);
      expect((await app.inject(scenarios.ok)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
