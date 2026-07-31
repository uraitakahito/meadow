---
title: Quickstart
description: Run meadow as an in-process library or as a container, and reach it from a browser in another VM
---

Two ways to run the same server. Which one you want depends on whether a **real
browser** has to reach it.

## As a library

For tests that exercise HTTP behaviour without a browser. `app.inject()` drives
the app in-process — no socket is opened, so there is no port to allocate and
nothing to clean up but the app itself.

```ts
import { buildFixture, scenarios } from "meadow";

const app = buildFixture();

const res = await app.inject(scenarios.httpStatus(503));
// res.statusCode === 503

await app.close();
```

Build one app per test file and close it in teardown. `buildFixture()` is cheap
— it registers routes and returns; nothing listens until you call `listen()`.

:::caution[A library instance cannot serve a browser]
`app.inject()` never touches the network stack, so Chrome cannot reach it. If a
scenario is about what the *browser* does — `/lazy-images`, `/client-side-redirect`,
`/cookie-banner` — you need the container.
:::

## As a container

The primary path. A capture worker's Chrome runs in its own VM, so meadow has
to be reachable over the network by IP or DNS name.

```sh
container build -t meadow .
container run -d --name meadow meadow

# Find the address, then check it is up
container ls
curl -sf http://<meadow-ip>:8080/health
```

Under Apple Container with a project DNS domain, consumers reach it by name
instead — BrowserHive's stack runs it as `meadow.browserhive:8080`.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `MEADOW_PORT` | `8080` | Port to listen on |
| `MEADOW_HOST` | `0.0.0.0` | Binds all interfaces so another VM can reach it |

`0.0.0.0` is the point of the default: binding loopback would make the container
unreachable from the browser VM, which is the whole reason the container exists.

## Waiting for it

There is no readiness signal beyond the server answering, so poll `/health`:

```sh
until curl -sf "http://${MEADOW_IP}:8080/health" >/dev/null; do sleep 1; done
```

Consumers do this in their integration-test setup rather than assuming the
container is up — starting a container returns long before the process inside
is listening.

## Writing a test against it

The shape most consumer tests take:

```ts
import { scenarios } from "meadow";

const origin = `http://${meadowIp}:8080`;

beforeEach(async () => {
  // Both request counts and failure counters are per-process — clear them per test,
  // not per suite.
  await fetch(`${origin}/__reset`, { method: "POST" });
});

it("retries a flaky origin until it succeeds", async () => {
  // A key unique to this assertion, so a parallel test cannot consume the
  // same failure budget.
  await capture(origin + scenarios.failsThenSucceeds(2, "retry-until-success"));

  const hits = await (await fetch(`${origin}/__request-counts`)).json();
  expect(hits[scenarios.failsThenSucceeds(2, "retry-until-success")]).toBe(3);
});
```

See [Scenarios](/scenarios/) for what each route reproduces, and why `key`
matters.

## Keeping these tests out of the default run

The test above fails the moment meadow is not running. **Do not leave that kind
of test in the default test command.** If you do, every change to anything —
including code that has nothing to do with meadow — starts requiring a
container.

Split them into their own test-runner project instead. Consumers use two:

```ts
// vitest.config.mts
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"], // everything that needs meadow lives here
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.e2e.test.ts"],
          globalSetup: ["./test/e2e/global-setup.ts"],
        },
      },
    ],
  },
});
```

and point the default command at only one of them:

```json
"test":     "vitest run --project unit",
"test:e2e": "vitest run --project e2e"
```

Now `npm test` does not *skip* the meadow tests — it never collects them. There
is no "0 skipped" line to misread, and no container to remember.

### Fail, do not skip

When the `e2e` project **is** selected and meadow is not up, fail:

```ts
// test/e2e/global-setup.ts
const READY_ATTEMPTS = 45;

let reachable = false;
for (let i = 0; i < READY_ATTEMPTS && !reachable; i++) {
  reachable = await fetch(`${origin}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) await new Promise((r) => setTimeout(r, 1000));
}
if (!reachable) {
  throw new Error(`meadow not reachable at ${origin} after 45s — start it first`);
}
```

`it.skipIf()` is easier and worse. **A skipped test is not a passing test**, but
it reports as green — so a CI job that forgets to start meadow keeps reporting
success while verifying nothing. Do the separating when the suite is *chosen*,
and once chosen, always produce a result.

### CI

Run `unit` on every pull request and leave the meadow suite on manual dispatch.
There is no reason for day-to-day CI to start a container.

BrowserHive's [Running the tests](https://uraitakahito.github.io/browserhive/running-tests/)
is this arrangement written out in full, including what each command reports and
what to do when an E2E test fails.
