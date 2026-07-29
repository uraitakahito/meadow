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

const res = await app.inject(scenarios.status(503));
// res.statusCode === 503

await app.close();
```

Build one app per test file and close it in teardown. `buildFixture()` is cheap
— it registers routes and returns; nothing listens until you call `listen()`.

:::caution[A library instance cannot serve a browser]
`app.inject()` never touches the network stack, so Chrome cannot reach it. If a
scenario is about what the *browser* does — `/lazy`, `/redirect-page`,
`/banner` — you need the container.
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
  // Both hit counts and flaky state are per-process — clear them per test,
  // not per suite.
  await fetch(`${origin}/__reset`, { method: "POST" });
});

it("retries a flaky origin until it succeeds", async () => {
  // A key unique to this assertion, so a parallel test cannot consume the
  // same failure budget.
  await capture(origin + scenarios.flaky(2, "retry-until-success"));

  const hits = await (await fetch(`${origin}/__hits`)).json();
  expect(hits[scenarios.flaky(2, "retry-until-success")]).toBe(3);
});
```

See [Scenarios](/scenarios/) for what each route reproduces, and why `key`
matters.
