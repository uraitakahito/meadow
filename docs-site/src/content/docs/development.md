---
title: Development
description: Building and testing meadow, how consumers pin it as a submodule, and what to keep in mind when adding a scenario
---

## Commands

```sh
npm run check   # typecheck + lint + test
npm run build   # emit dist/
npm start       # run dist/serve.js
```

`npm run check` is what CI runs. `build` is separate because consumers import
from `dist/` — see below.

## How consumers use it

meadow is a **git submodule** in both BrowserHive and waggle, not an npm
dependency. Each pins a specific commit, so a change here does not reach a
consumer until that consumer moves its pointer deliberately.

That has a consequence worth knowing: meadow's `package.json` has **no
`prepare` script**. It used to build on install so that a consumer got `dist/`
for free, but a submodule is checked out without its sources being built, and
`prepare` fired in contexts where `tsc` was not available — inside a Docker
build stage where dev dependencies had been pruned, for one. Consumers now
build meadow explicitly as part of their own build.

## Adding a scenario

Three places, in this order:

1. **`src/fixture.ts`** — the route.
2. **`src/scenarios.ts`** — the typed entry, inside the `// #region scenarios`
   markers. Consumers must never hard-code the path.
3. **[Scenarios](/scenarios/)** — *why* it exists.

Step 3 is the one that gets skipped, and it is the one that matters. A route
whose purpose is not written down becomes a route nobody dares delete: the next
person can see what it returns but not what breaks if it goes away.

:::caution[The `#region` markers are load-bearing]
The scenarios page injects `src/scenarios.ts` between `// #region scenarios` and
`// #endregion` at build time. Removing or renaming those comments **fails the
docs build** — deliberately, so a page can never show code that no longer
exists.
:::

### What makes a good scenario

Each route should reproduce **one** failure mode, and reproduce it
**deterministically**. `/flaky` is the model: `fail` says how many times to
fail, `key` isolates the counter so two tests cannot interfere. A scenario that
behaves differently depending on what ran before it is worse than no scenario —
it makes the consumer's test flaky while looking like it is testing flakiness.

If a scenario needs shared state, key it. If it needs timing, make the timing a
parameter rather than a constant.

## Documentation

```sh
npm run site:dev     # local preview
npm run site:check   # build + verify every doc reference resolves
```

`site:check` runs in CI on every pull request. It catches two kinds of drift the
build alone would not:

- a code fence whose `file=` attribute names a region that was renamed
- a `src/` path written in prose that points at a file that was moved

Both are the same failure — documentation that still builds green while
describing code that is gone.

Pages live in `docs-site/src/content/docs/` (English) and `.../ja/` (Japanese).
**Both locales are updated together**; an untranslated Japanese page silently
falls back to English, which reads as an oversight rather than a decision.

## Container

```sh
container build -t meadow .
container run -d --name meadow meadow
```

The Dockerfile is multi-stage: TypeScript is compiled in a full image, and the
runtime image gets production dependencies plus `dist/` and `site/`. Both `npm
ci` invocations pass `--ignore-scripts` — the build stage because sources are
not copied yet when install runs, the runtime stage because `tsc` is not there
at all.
