# meadow

A shared Fastify **fixture-origin** — the synthetic internet that Chrome visits in
[BrowserHive](https://github.com/uraitakahito/browserhive) and
[waggle](https://github.com/uraitakahito/waggle) integration tests. It controls the
JavaScript/content, HTTP status, latency, per-key retry state, and request counts so
tests can drive `runOnStableContext`, `autoScroll`, HTTP-error and retry paths on demand.

One core, two shapes:

- **Library** — `import { buildFixture, scenarios } from "meadow"` for in-process tests
  (`app.inject(...)`) and for the shared, typed scenario URLs.
- **Container** — run the image so a worker's Chrome (in another VM) reaches it by IP.
  This is the primary path for real-Chrome integration.

## Quick start

### In-process (library)

```ts
import { buildFixture, scenarios } from "meadow";

const app = buildFixture();
const res = await app.inject(scenarios.status(503));
// res.statusCode === 503
await app.close();
```

### Container

```sh
container build -t meadow .
container run -d --name meadow meadow
# curl http://<meadow-ip>:8080/ok    (see `container ls` for the IP)
```

Configure with `MEADOW_PORT` (default `8080`) and `MEADOW_HOST` (default `0.0.0.0`).

## Scenarios

| Route | Returns | Exercises |
| --- | --- | --- |
| `/ok` | 200 HTML | success baseline |
| `/redirect-page` → `/landed` | client-side `location.replace` | `runOnStableContext` |
| `/lazy` | below-the-fold `loading="lazy"` + IntersectionObserver | `autoScroll` |
| `/slow?ms=` | responds after `ms` | page-load timeout |
| `/status/:code` | that HTTP status | non-2xx / httpError branch |
| `/redirect/:n` | 302 chain of length `n` | redirect following |
| `/set-cookie` | `Set-Cookie` + localStorage write | per-task state reset |
| `/banner` | fixed cookie-consent overlay | banner dismissal |
| `/big?bytes=` | body of `bytes` bytes | response-size caps |
| `/drip?bytes=&ms=` | `bytes` trickled over `ms` | slow-body handling |
| `/flaky?fail=&key=` | 503 for first `fail` requests per `key`, then 200 | deterministic retry |
| `/assets/*` | static JS/CSS/images from `site/` | sub-resource capture |

Use the typed [`scenarios`](src/scenarios.ts) helper rather than hard-coding paths, so
URLs stay in one place across repos.

### Introspection (test-only)

- `GET /__hits` — request count per URL (retry/throughput assertions).
- `POST /__reset` — clear counters and flaky state (isolate tests).

## Development

```sh
npm run check   # typecheck + lint + test
npm run build   # emit dist/
npm start       # run dist/serve.js
```

## License

The Unlicense.
