---
title: Scenarios
description: Every route meadow serves, what it returns, and the failure mode each one exists to reproduce
---

Each route exists to make **one specific thing** happen on demand. This page is
the reason each one is there — the part a table of paths cannot carry.

## Use the typed helper, not the paths

Hard-coding `/flaky?fail=2&key=x` in a consumer means a rename in meadow breaks
that consumer silently, months later, in a repo nobody is looking at. The
`scenarios` export is the one place these URLs are written down:

```ts file="src/scenarios.ts#scenarios"
```

Prefix with the fixture origin:

```ts
import { scenarios } from "meadow";

const url = `http://${meadowIp}:8080` + scenarios.flaky(2, "retry-budget");
```

## Static pages

### `/ok` — the success baseline

Plain 200 HTML, no scripts, no sub-resources. Every other scenario is only
meaningful against a control that is known to work; when a test fails, `/ok`
answers "is the pipeline broken, or is this scenario doing its job?".

### `/redirect-page` → `/landed` — client-side navigation

Serves a page whose only content is `location.replace("/landed")`, running at
parse time.

This destroys the JavaScript execution context **while the capture code is
mid-`await`**. Puppeteer surfaces that as `Execution context was destroyed,
most likely because of a navigation`, and any code that touches the page across
that boundary throws. BrowserHive's `runOnStableContext` exists for this; this
route is what proves it works.

A server-side 302 does *not* reproduce it — the browser follows the redirect
before the page ever exists. It has to be the page navigating itself.

### `/lazy` — deferred sub-resources

3000px of filler, then two images below the fold, each deferred by a **different
mechanism**:

- `<img loading="lazy">` — the browser's own deferral
- `<img data-src>` swapped by an `IntersectionObserver`

Neither image is requested until something scrolls. A capture that grabs the
page without scrolling produces an archive missing both, and — this is the
awkward part — the archive still looks fine: correct HTML, no errors, just
images that 404 on replay.

Two mechanisms rather than one because they fail differently: native `lazy`
responds to the viewport, the observer responds to layout. A behaviour that
scrolls instantly to the bottom can satisfy one and miss the other.

### `/banner` — a fixed overlay

Content with a `position: fixed` bar pinned to the bottom, carrying a cookie
notice and an Accept button that removes it.

Whatever a consumer does about overlays — remove them, ignore them, click
through them — this is a page where one demonstrably exists, so the difference
between "handled" and "not handled" is visible in a screenshot.

### `/set-cookie` — state that outlives a page

Sets `meadow=1` as an HttpOnly cookie **and** writes to `localStorage`.

Two stores because they are cleared by different mechanisms and a reset that
only handles one leaves the other. That leak matters: a worker reuses its
browser across captures, so state from task N shows up in task N+1's archive —
and it shows up as *content*, silently, not as an error.

## Parameterised routes

### `/slow?ms=` — page-load timeouts

Waits `ms` before sending anything. **Defaults to 35000**, deliberately more
than BrowserHive's 30-second page-load timeout, so `scenarios.slow()` with no
argument is already a timeout.

Note where the delay is: before the *response*, not during it. The socket is
open and nothing arrives — the case that hangs a naive fetch forever. For a
response that starts and then stalls, use `/drip`.

### `/block-main-thread?holdMs=&repeatForMs=` — a page that stops responding

Holds the page's main thread for `holdMs` at a time, repeating for
`repeatForMs`. While it is held, nothing else in the page runs: `setTimeout`
callbacks cannot fire and an injected `page.evaluate` cannot even start.

**This is not the same as a slow network.** `/slow` delays the *response*; the
page it eventually serves works normally. Here the response is instant and the
page is the thing that stops working. A consumer that only ever tested against
slow responses has never exercised the timeouts that guard its in-page
operations, because nothing it did could make them expire.

That is what this route is for. BrowserHive wraps each browser operation in a
budget that asks *"is this one operation stuck?"*, and those budgets are worth
very little until something has proved they still fire. In particular they must
keep firing when `operationDelayMs` is in play — a capture deliberately slowed
down is not a capture that may run forever.

**The holding starts from a `setTimeout`, never during parsing.** Blocking the
parse would delay `DOMContentLoaded` itself, and the cost would land on the
consumer's *navigation* budget (30s in BrowserHive) instead of the much tighter
budgets around in-page work (5s). Same page, entirely different test.

`repeatForMs` is capped at 30000. A page that holds its thread forever outlives
the capture that asked for it and wedges whatever runs next in the same tab.

### `/status/:code` — the non-2xx branch

Returns exactly the status asked for, with a body. Any code: `/status/404`,
`/status/503`, `/status/418`.

The body matters. A pipeline that only checks the status treats these
identically, but one that captures the response has to decide whether an error
page is an artifact worth keeping — and that decision needs a real body to act
on.

### `/redirect/:n` — redirect chains

A 302 chain of length `n`, ending at `/landed`. `/redirect/3` is four hops:
`3 → 2 → 1 → 0 → /landed`.

Chain length is the parameter because redirect handling usually breaks at a
limit rather than at one hop. Browsers cap chains around 20; a chain longer
than the cap is how you test what happens at the boundary rather than in the
middle.

### `/big?bytes=` — response-size caps

A body of exactly `bytes` bytes, sent at once. Defaults to 1 MiB.

An archiver has to cap what it stores or a single video swallows the disk. This
route makes the cap testable from both sides: one byte under, one byte over.

### `/drip?bytes=&ms=` — slow bodies

`bytes` bytes trickled over roughly `ms`, in ten chunks.

Different failure from `/slow`: here the response **starts immediately** and
then arrives slowly. Headers are in, the status is 200, and a timeout measured
from request-start behaves differently from one measured between chunks. Code
that treats "response received" as "done" passes `/slow` and hangs on `/drip`.

### `/flaky?fail=&key=` — deterministic retries

Returns 503 for the first `fail` requests carrying `key`, then 200 for every
request after. Defaults to `fail=2`, `key=default`.

**`key` is what makes retry tests trustworthy.** The failure counter is
per-key, so two tests running at once do not consume each other's budget, and a
test that reruns in the same process starts from a clean count by using a fresh
key. Without it, "did the retry work?" would depend on execution order — the
classic flaky test, testing flakiness.

Pick a key per assertion, not per suite:

```ts
scenarios.flaky(2, "retry-budget-exhausted")
scenarios.flaky(1, "single-retry-then-success")
```

### `/assets/*` — static sub-resources

Serves `site/` (`hero.svg`, `below.svg`). Referenced by `/lazy`, and available
directly when a test needs a sub-resource whose bytes it can predict.

## Introspection

Two test-only endpoints. They exist because *how many times* something was
requested is often the actual assertion — a retry test that only checks the
final status cannot tell one retry from five.

### `GET /__hits`

Request count per URL, as a plain object:

```json
{ "/ok": 1, "/flaky?fail=2&key=retry-budget": 3 }
```

Keyed by **full URL including the query string**, so `/flaky?fail=2&key=a` and
`/flaky?fail=2&key=b` count separately — the same isolation `key` gives you for
the failure counter.

### `POST /__reset`

Clears both the hit counters and the flaky state.

Call it **between tests, not once per suite**. Both counters live in the server
process, so a container shared across a run accumulates state; the previous
test's hits are indistinguishable from this one's without a reset.

```ts
beforeEach(async () => {
  await fetch(`http://${meadowIp}:8080/__reset`, { method: "POST" });
});
```

### `GET /health`

Returns `{ "ok": true }`. Not part of `scenarios` — it is for waiting on the
container during startup, not for a test to assert on.

```sh
until curl -sf "http://${MEADOW_IP}:8080/health" >/dev/null; do sleep 1; done
```
