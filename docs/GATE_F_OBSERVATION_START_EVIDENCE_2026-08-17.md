# Gate F observation start evidence — 2026-08-17

**Decision:** observation window started; Legacy retirement remains **NO-GO**.

## Frozen production evidence

- `coverage_started_at`: `2026-08-17T00:15:22Z`
- production runtime marker: `https://www.averlearning.com/js/runtime-config.js`
- production release: `05e2cc54499fb6fc8d8f980567632e39fc9fe808`
- production ref: `main`
- source PR: `#1194`
- response status: `HTTP/2 200`
- cache-busted verification response `Date`: `Mon, 17 Aug 2026 00:15:15 GMT`
- response `Last-Modified`: `Mon, 17 Aug 2026 00:06:39 GMT`
- response cache contract: `cache-control: no-store, max-age=0`
- response cache observation: `x-vercel-cache: HIT`, `age: 516`

The observation timestamp is the local UTC clock captured seven seconds after
the cache-busted production marker response and after the static inventory had
passed. It is deliberately later than both the deploy timestamp and response
`Date`. Vercel reported a cache hit with a non-zero `Age`, so neither that age
nor the older `Last-Modified` timestamp is used to backdate coverage.

## Static inventory on the exact release tree

Command:

```sh
cd frontend
node tooling/next-migration-status.mjs --json
```

Required fields observed on the tree for release
`05e2cc54499fb6fc8d8f980567632e39fc9fe808`:

```json
{
  "appPages": { "source": 125, "product": 123 },
  "legacyHtml": {
    "total": 129,
    "directlyRenderable": 121,
    "telemetryInstrumented": 121,
    "telemetryMissingPaths": []
  },
  "corePlayers": {
    "total": 4,
    "nextReady": 4,
    "admittedToNext": 0
  },
  "routeOwnershipCollisions": [],
  "gateFObservationReady": true,
  "staticCutoverReady": false
}
```

`staticCutoverReady=false` is expected and truthful: 121 Legacy HTML files are
still directly renderable and all four core-player admissions still resolve new
attempts to Legacy.

## Earliest time boundary

The 14-day floor reaches its earliest possible boundary at
`2026-08-31T00:15:22Z`. This is not a scheduled retirement date. Gate F still
requires the longer of the full business/revisit cycle and the 14-day floor,
plus exact zero Legacy exposure, exact stateful pre-cutover drain (or an
owner-approved scoped exception), health/data invariants, permanent redirects,
replacement-test mapping and a reviewed deletion checklist.

In particular, this artifact does not:

- close Gate E or substitute for the physical Safari/iOS device pair;
- start the core-player cutover/drain clock;
- count any time before `coverage_started_at`;
- authorize a policy flip, rollback-floor dispatch or Legacy deletion.

## Reproduction

```sh
curl -fsSL https://www.averlearning.com/js/runtime-config.js
curl -fsSI 'https://www.averlearning.com/js/runtime-config.js?gate_f_evidence=20260817T001502Z'
git rev-parse origin/main
cd frontend
node tooling/next-migration-status.mjs --json
```
