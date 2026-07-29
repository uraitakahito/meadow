# meadow

A shared Fastify **fixture-origin** — the synthetic internet that Chrome visits in
[BrowserHive](https://github.com/uraitakahito/browserhive) and
[waggle](https://github.com/uraitakahito/waggle) integration tests. It controls
content, HTTP status, latency, per-key retry state, and request counts so tests can
drive timeout, redirect, lazy-load and retry paths on demand.

📖 **[Documentation](https://uraitakahito.github.io/meadow/)** ·
**[日本語](https://uraitakahito.github.io/meadow/ja/)**

## Quick start

```ts
import { buildFixture, scenarios } from "meadow";

const app = buildFixture();
const res = await app.inject(scenarios.status(503));
// res.statusCode === 503
await app.close();
```

`app.inject()` runs in-process and never opens a socket, so **Chrome cannot reach
it**. Scenarios about what a real browser does need the container instead:

```sh
container build -t meadow .
container run -d --name meadow meadow
curl -sf http://<meadow-ip>:8080/health
```

Configure with `MEADOW_PORT` (default `8080`) and `MEADOW_HOST` (default `0.0.0.0`).

Use the typed [`scenarios`](src/scenarios.ts) helper rather than hard-coding paths,
so URLs stay in one place across repos. Every route, and the failure each one
reproduces, is on the
**[Scenarios](https://uraitakahito.github.io/meadow/scenarios/)** page.

## Development

```sh
npm run check        # typecheck + lint + test
npm run build        # emit dist/
npm start            # run dist/serve.js
npm run site:check   # build the docs and verify every reference resolves
```

## License

The Unlicense.
