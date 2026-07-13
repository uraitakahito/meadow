/**
 * Typed URL contract shared by every consumer (BrowserHive, waggle) so that
 * scenario paths live in exactly one place and cannot drift between repos.
 *
 * Static scenarios are plain strings; parameterised ones are builder functions.
 * Prefix each with the fixture origin, e.g. `` `http://${ip}:8080` + scenarios.ok ``.
 */
export const scenarios = {
  /** Plain 200 HTML — the success baseline. */
  ok: "/ok",
  /** DOMContentLoaded runs `location.replace("/landed")` — exercises client-side navigation. */
  redirectPage: "/redirect-page",
  /** Landing target of {@link scenarios.redirectPage} and server redirects. */
  landed: "/landed",
  /** Below-the-fold `loading="lazy"` image + IntersectionObserver — exercises auto-scroll. */
  lazy: "/lazy",
  /** Fixed cookie-consent overlay — exercises banner dismissal. */
  banner: "/banner",
  /** Sets a cookie and writes localStorage — exercises per-task state reset. */
  setCookie: "/set-cookie",

  /** Waits `ms` before responding — exercises page-load timeouts. */
  slow: (ms: number): string => `/slow?ms=${String(ms)}`,
  /** Responds with an arbitrary HTTP status — exercises the non-2xx branch. */
  status: (code: number): string => `/status/${String(code)}`,
  /** Server-side 302 chain of length `n`, ending at {@link scenarios.landed}. */
  redirect: (n: number): string => `/redirect/${String(n)}`,
  /** Responds with a body of `bytes` bytes — exercises response-size caps. */
  big: (bytes: number): string => `/big?bytes=${String(bytes)}`,
  /** Trickles `bytes` bytes over `ms` — exercises slow-body handling. */
  drip: (bytes: number, ms: number): string => `/drip?bytes=${String(bytes)}&ms=${String(ms)}`,
  /**
   * Fails (503) the first `fail` requests for `key`, then succeeds (200).
   * `key` isolates counters so parallel tests do not interfere.
   */
  flaky: (fail: number, key: string): string =>
    `/flaky?fail=${String(fail)}&key=${encodeURIComponent(key)}`,
  /** A static asset served from `site/`, e.g. `scenarios.asset("hero.svg")`. */
  asset: (path: string): string => `/assets/${path}`,
} as const;

export type Scenarios = typeof scenarios;
