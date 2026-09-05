import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

/**
 * The arguments BrowserHive's E2E suite actually passes.
 *
 * meadow is consumed as a pinned git submodule, so a release here reaches
 * nobody until someone bumps that pin. This suite is what makes the bump safe:
 * if a bound added to `fixture.ts` is too tight for a real caller, it goes red
 * here — in a plain unit test — instead of in a suite that needs containers and
 * a browser.
 *
 * Recorded 2026-09-05 from:
 *   browserhive/test/e2e/truncation.e2e.test.ts  largeBody(capBytes + 1 MiB), capBytes ≤ 1 MiB
 *   browserhive/test/e2e/behaviors.e2e.test.ts   blockMainThread(6000, 20_000)
 *   browserhive/test/e2e/session.e2e.test.ts     cookieAndStorage(mark)
 *   browserhive/test/e2e/retry.e2e.test.ts       failsThenSucceeds(2, "e2e")
 *
 * This is a copy, so it goes stale. Re-read the downstream call sites when
 * bumping the submodule; a green run here is evidence about the values below,
 * not about whatever BrowserHive passes today.
 */
describe("values BrowserHive passes today", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["largeBody at 2 MiB", scenarios.largeBody(2 * 1024 * 1024)],
    ["blockMainThread 6s held, 20s repeated", scenarios.blockMainThread(6000, 20_000)],
    ["failsThenSucceeds(2)", scenarios.failsThenSucceeds(2, "e2e")],
    ["httpStatus(404)", scenarios.httpStatus(404)],
    ["asset below.svg", scenarios.asset("below.svg")],
    ["cookieAndStorage with a tag", scenarios.cookieAndStorage("mark")],
  ])("%s is not refused", async (name, path) => {
    // 404, 503 and 302 are all legitimate answers; 400 means a bound is too
    // tight and the submodule bump would break the downstream suite.
    expect((await app.inject(path)).statusCode, `${name} → ${path}`).not.toBe(400);
  });
});
