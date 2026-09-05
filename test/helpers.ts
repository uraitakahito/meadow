import { expect } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The response Fastify hands back from `inject`, derived from Fastify itself.
 * `light-my-request` is a transitive dependency here, not a declared one, so
 * importing its types directly leaves them unresolved.
 */
type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

/**
 * Assert the status before touching the body.
 *
 * Fastify's 404 body echoes the requested URL —
 * `{"message":"Route GET:/cookie-banner not found",…}` — so a substring
 * assertion like `expect(res.body).toContain("cookie-banner")` passes against a
 * 404. The assertion ends up reading back the URL the test itself sent.
 *
 * Going through here means a renamed or deleted route fails the test that
 * covers it, instead of quietly passing.
 *
 * The expected status is a parameter because 302 and 503 are the correct answer
 * for some routes.
 */
export const fetchOk = async (
  app: FastifyInstance,
  url: string,
  expected = 200,
): Promise<InjectResponse> => {
  const res = await app.inject(url);
  expect(res.statusCode, url).toBe(expected);
  return res;
};
