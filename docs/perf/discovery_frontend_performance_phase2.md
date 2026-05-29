# Frontend Performance Discovery — Phase 2 (bottleneck confirmation)

Date: 2026-05-29
Branch: `discovery/frontend-performance-phase2`
Scope: Phase 2 measurement pass for `docs/perf/discovery_frontend_performance.md`.
Status: docs-only Discovery; no code changes.

## Executive summary

Phase 2 partially confirms the Phase 1 diagnosis, with an important refinement: protected module slowness is measurable, but the dominant cost appears to be protected backend/API wait and request sequencing, not just the browser-side `supabase.auth.getSession()` call in `api.js`.

The strongest confirmed bottlenecks are API waterfalls. Reading exam currently needs a median ~3.85s for test detail plus in-progress check if executed sequentially; Listening dictation needs a median ~3.00s for content detail plus exercise lookup; Writing dashboard and Speaking dashboard hit individual protected endpoints in the ~1.8-2.8s median range.

The HAR files Andy supplied are useful for static CSS/font request timing, but they do not contain document, JavaScript, API, FCP, or LCP records. That prevents a true browser FCP/LCP comparison in this pass. The report therefore treats HAR-based paint conclusions as inconclusive and bases high-confidence recommendations on authenticated API timing plus source-confirmed request sequencing.

Top recommendations:

1. Proceed with a high-confidence API-waterfall sprint for Reading exam and Listening exercise boot paths.
2. Add lightweight backend timing instrumentation (`Server-Timing` or `X-Process-Time`) before committing to larger app-shell work.
3. Treat client session caching as a useful quick win, but not the primary fix until browser HARs with full request capture prove `getSession()` itself is a large cost.

## Methodology

### Inputs available

- Phase 1 report: `docs/perf/discovery_frontend_performance.md`.
- HAR files in `data/har/`:
  - `grammar_cold.har`, `grammar_warm.har`
  - `reading-test_cold.har`, `reading-test_warm.har`
  - `reading_content.cold.har`, `reading_content_warm.har`
  - `listening_cold.har`, `listening_warm.har`
  - `writing_cold.har`, `writing_warm.har`
  - `speaking_dashboard_cold.har`, `speaking_dashboard_warm.har`
  - `vocabulary_cold.har`, `vocabulary_warm.har`
- Production JWT in `data/auth/jwt.txt`, read locally and never printed.

### Methods used

- Parsed HAR files with a local Node script to count entries, page timings, request types, hosts, and slowest requests.
- Ran authenticated production `curl` timings with 5 consecutive requests per endpoint:
  - `time_namelookup`
  - `time_connect`
  - `time_appconnect`
  - `time_starttransfer`
  - `time_total`
  - HTTP status and response size
- Measured public baseline endpoints and health endpoints to separate connection/Railway baseline from protected endpoint work.
- Re-read source paths from Phase 1 to map measured endpoints to actual page boot flows.
- Searched backend for timing instrumentation (`Server-Timing`, `X-Response-Time`, process-time middleware).

### Confidence levels

- High: direct authenticated timing data plus source-confirmed sequential request path.
- Medium: direct timing data but limited browser paint evidence.
- Low: browser FCP/LCP/TTI conclusions from current HARs, because supplied HARs are incomplete for paint/API analysis.

## HAR analysis

### Capture quality finding

The supplied HARs do not contain enough data to compute FCP, LCP, TTI, or API waterfall timing. Every HAR file inspected contains only CSS/font/style requests; none include HTML document requests, JavaScript requests, Railway API requests, Supabase auth requests, paint records, or performance trace events.

Evidence from local HAR parser:

| HAR | Entries | Pages | First request paths | API requests |
|---|---:|---:|---|---:|
| `grammar_cold.har` | 10 | 2 | `/css2`, `/css/aver-design/tokens.css`, `/css/aver-design/components.css`, `/css/ds.css`, `/css/grammar-wiki.css` | 0 |
| `grammar_warm.har` | 10 | 2 | CSS/font only | 0 |
| `reading-test_cold.har` | 8 | 2 | CSS/font only | 0 |
| `reading-test_warm.har` | 5 | 2 | CSS/font only | 0 |
| `reading_content.cold.har` | 4 | 1 | CSS/font only | 0 |
| `reading_content_warm.har` | 4 | 1 | CSS/font only | 0 |
| `listening_cold.har` | 13 | 3 | CSS/font only | 0 |
| `listening_warm.har` | 13 | 3 | CSS/font only | 0 |
| `writing_cold.har` | 6 | 1 | CSS/font only | 0 |
| `writing_warm.har` | 6 | 1 | CSS/font only | 0 |
| `speaking_dashboard_cold.har` | 5 | 1 | CSS/font only | 0 |
| `speaking_dashboard_warm.har` | 5 | 1 | CSS/font only | 0 |
| `vocabulary_cold.har` | 8 | 1 | CSS/font only | 0 |
| `vocabulary_warm.har` | 8 | 1 | CSS/font only | 0 |

Likely cause: DevTools was captured with a resource-type or text filter active, or the HAR export did not preserve the full request log. This is not a product bug; it is a measurement artifact.

### What the HARs can still tell us

The HARs show CSS/font loading is not the main bottleneck. Most stylesheet requests are ~80-200ms; one listening cold request for `ielts-test-paper.css` was 468ms, but that is still small relative to authenticated API medians of 1.3-2.8s.

Representative slow CSS/font requests:

| HAR | Slowest visible resource | Time | Wait |
|---|---|---:|---:|
| `grammar_cold.har` | `/css/ds.css` | 145ms | 90ms |
| `reading-test_cold.har` | `/css/reading-exam-mockup.css` | 96ms | 60ms |
| `listening_cold.har` | `/css/ielts-test-paper.css` | 468ms | 443ms |
| `writing_cold.har` | Google Fonts CSS | 147ms | 59ms |
| `speaking_dashboard_warm.har` | `/css/aver-design/components.css` | 232ms | 140ms |
| `vocabulary_cold.har` | `/css/aver-design/components.css` | 197ms | 178ms |

### HAR conclusion

FCP/LCP/TTI: not measurable from current HAR files.

Static asset bottleneck: not supported as the primary cause by current HAR files.

Next measurement request: recapture HARs with all DevTools filters cleared and include a Performance trace or DevTools Performance JSON if FCP/LCP are required. The Network HAR alone may not expose FCP/LCP unless Chrome includes page timing metadata; a Performance trace is more reliable for paint metrics.

## Authenticated API timing

Command shape:

```bash
curl -L -s -o /dev/null \
  -H "Authorization: Bearer $JWT" \
  -w "code=%{http_code} ns=%{time_namelookup} co=%{time_connect} ssl=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}\n" \
  "$BASE$ENDPOINT"
```

Each endpoint was run 5 times. Median and range below use `time_total`.

### Baselines

| Endpoint | HTTP | Median total | Range | Size | Interpretation |
|---|---:|---:|---:|---:|---|
| `/health` | 200 | 0.726s | 0.636-0.915s | 89 B | Network + Railway + FastAPI baseline; no DB. |
| `/health/ready` | 200 | 2.109s | 1.921-2.241s | 385 B | DB/service readiness path. |
| `/api/grammar/article/...habits-and-routines` | 200 | 1.033s | 0.905-1.391s | 19.1 KB | Public content baseline. |

Interpretation: even a no-DB health endpoint is ~0.7s from this environment, so there is a non-trivial baseline. Protected and DB-backed endpoints regularly add ~0.6-3.4s beyond that.

### Protected endpoint timings

| Endpoint | HTTP | Median total | Range | Size | Page relevance |
|---|---:|---:|---:|---:|---|
| `/auth/me` | 200 | 1.790s | 1.715-2.825s | 547 B | Speaking/admin/profile identity checks. |
| `/api/reading/test` | 200 | 1.271s | 0.906-1.313s | 301 B | Reading L3 list. |
| `/api/reading/test/AVR-READ-001` | 200 | 2.068s | 1.664-2.414s | 24.3 KB | Reading exam detail. |
| `/api/reading/test/AVR-READ-001/attempts/in-progress` | 200 | 1.786s | 1.679-1.928s | 186 B | Reading exam resume check. |
| `/api/listening/content` | 200 | 1.330s | 1.174-1.775s | 1.3 KB | Listening browse/list. |
| `/api/listening/content/{id}` | 200 | 1.425s | 1.209-1.820s | 5.8 KB | Listening exercise content detail. |
| `/api/listening/exercises?content_id={id}&exercise_type=dictation` | 200 | 1.571s | 1.414-1.576s | 16 B | Listening dictation exercise lookup. |
| `/api/writing/my-assignments` | 200 | 2.656s | 2.542-4.111s | 5.2 KB | Writing dashboard assignments. |
| `/api/writing/my-essays` | 200 | 1.826s | 1.520-1.920s | 10.1 KB | Writing dashboard essays. |
| `/api/student/permissions` | 200 | 1.835s | 1.514-2.219s | 133 B | Writing permissions gate. |
| `/api/dashboard/init` | 200 | 2.800s | 2.440-3.782s | 6.2 KB | Speaking dashboard aggregate. |
| `/sessions/stats?limit=20` | 200 | 1.996s | 1.737-2.099s | 5.2 KB | Speaking dashboard fallback/history stats. |
| `/api/grammar/dashboard-data` | 200 | 2.291s | 1.951-2.335s | 2.8 KB | Speaking authenticated grammar widget. |

### Endpoint mismatch found

The Phase 2 prompt listed `/api/writing/assignments`, but production returned 404 for that path in 5/5 runs. The live Writing dashboard uses `/api/writing/my-assignments` and `/api/writing/my-essays`, so the prompt endpoint is stale rather than a product performance endpoint.

Measured stale path:

| Endpoint | HTTP | Median total | Range | Note |
|---|---:|---:|---:|---|
| `/api/writing/assignments` | 404 | 0.621s | 0.442-0.774s | Prompt mismatch; not used by current student dashboard. |

## Backend latency breakdown

### Instrumentation availability

No backend `Server-Timing` or `X-Response-Time` instrumentation was found in source. `backend/main.py:161-168` adds `X-Request-ID`, but not process-time or stage-timing headers.

Relevant source:

- `backend/main.py:100-113` configures CORS and preflight caching (`max_age=86400`), which is positive for browser preflight cost.
- `backend/main.py:161-168` adds request ID middleware only.
- `backend/routers/health.py` provides `/health` and `/health/ready`, which are useful differential baselines.

### Differential breakdown

Because no timing headers exist, Phase 2 used differential timing:

- `/health` median: 0.726s
- Typical TLS appconnect after DNS/connect: ~0.10-0.12s
- Public Grammar article median: 1.033s
- Protected endpoint medians: 1.271-2.800s
- DB/service readiness median: 2.109s

Interpretation:

1. Network + Railway + FastAPI baseline is already meaningful at ~0.7s from the Codex environment.
2. Protected/DB-backed endpoints add substantial server-side or upstream wait.
3. Very small responses can still take ~1.5-2.8s, so payload size is not the main cost for protected endpoints.
4. The current data cannot separate Supabase auth verification, Supabase table queries, Python app code, or outbound service calls within a single endpoint. That requires instrumentation.

Backend observability recommendation:

- Add a docs-backed small sprint to emit `Server-Timing` or `X-Process-Time` for key API routes.
- At minimum include total app time; ideally include stages for auth, Supabase query, serialization, and external services.
- This should happen before committing to multi-sprint app-shell or service-worker architecture.

## Confirmed vs refuted Phase 1 inferences

### Auth gate impact

Status: PARTIAL / REFINED.

Phase 1 claim: auth gate per request causes slow UX.

Phase 2 result:

- Confirmed that protected endpoints are materially slower than public/static flows.
- Refined that the measurable cost is not isolated to browser `auth.getSession()`. Current data shows protected backend endpoints themselves take ~1.3-2.8s median.
- Current HARs do not measure client-side `getSession()` duration.

Confidence: medium-high that protected API wait is a real UX bottleneck; low that client-side session lookup alone is the dominant bottleneck.

Implication:

- Q3 session cache is still reasonable, especially for concurrent `window.api.get()` calls.
- But Q3 should not be expected to solve the largest observed delays by itself.

### API waterfall impact

Status: CONFIRMED.

Evidence:

- Reading exam source loads test detail then in-progress attempt (`frontend/js/reading-exam.js:1104-1115`).
- Measured medians:
  - `/api/reading/test/AVR-READ-001`: 2.068s
  - `/api/reading/test/AVR-READ-001/attempts/in-progress`: 1.786s
  - Sequential wall-clock estimate: ~3.854s before pre-start can fully resolve.
- Listening dictation source loads content then exercises (`frontend/js/listening-dictation.js:91-101`).
- Measured medians:
  - `/api/listening/content/{id}`: 1.425s
  - `/api/listening/exercises?...dictation`: 1.571s
  - Sequential wall-clock estimate: ~2.996s before ready state can fully resolve.

Confidence: high.

Implication:

- Q4 and M2 are strongly supported for Reading exam and Listening dictation.

### Grammar advantage causes

Status: PARTIAL / MOSTLY CONFIRMED.

Evidence:

- Phase 1 source reading still holds: Grammar public article flow uses raw fetch and in-memory Markdown indexes.
- Phase 2 public Grammar article median was 1.033s, faster than most protected module endpoints but not “instant”.
- HARs were incomplete, so Phase 2 cannot quantify FCP/LCP advantage from browser traces.

Confidence: medium-high for no-auth/public-content advantage; low for paint-metric quantification.

Implication:

- Q2 cache headers for public Grammar/Vocabulary endpoints remain safe and likely beneficial.
- “Make everything Grammar-like” should be interpreted as public/read-only/cached where product rules allow, not as evidence for a broad SPA rewrite.

### Railway API latency breakdown

Status: PARTIAL.

Evidence:

- `/health` median 0.726s establishes a meaningful baseline.
- `/health/ready` median 2.109s suggests DB/service checks add ~1.38s over health baseline.
- Protected endpoint medians often align more with readiness than basic health.
- No `Server-Timing` headers exist, so internal stage attribution is not available.

Confidence: medium.

Implication:

- Add observability before diagnosing which backend layer dominates.

## Per-module quantified findings

### Grammar

Data:

- Public article API median: 1.033s.
- Public home API from Phase 1: 1.829s total for 108 KB.
- Current HARs do not include API requests or paint entries.

Blockers:

1. Large `/api/grammar/home` payload can still cost ~1.8s in baseline conditions.
2. API responses lack cache headers in sampled GET responses.
3. Static assets are cached through Vercel but still `max-age=0, must-revalidate`, creating validation round trips.

Priority: medium. Grammar is already the perceived fast module; optimize public caching before deeper work.

### Reading

Data:

- L3 list median: 1.271s.
- L3 detail median: 2.068s.
- In-progress resume check median: 1.786s.
- Sequential exam boot estimate: ~3.854s.

Blockers:

1. Protected detail + resume waterfall.
2. Auth-gated list endpoints, even for browse-style content.
3. No backend timing stage attribution.

Priority: highest. Reading has the clearest high-confidence waterfall target.

### Listening

Data:

- Content list median: 1.330s.
- Content detail median: 1.425s.
- Dictation exercise lookup median: 1.571s.
- Sequential dictation boot estimate: ~2.996s.

Blockers:

1. Content detail + exercise lookup waterfall.
2. Mini Test step flow likely repeats content fetch per step, based on source.
3. Small exercise lookup response still costs ~1.57s, pointing to server/auth/query overhead rather than transfer size.

Priority: high. Listening is a strong candidate for combined boot endpoints.

### Writing

Data:

- Assignments median: 2.656s.
- Essays median: 1.826s.
- Permissions median: 1.835s.
- Stale prompt endpoint `/api/writing/assignments` returns 404; current dashboard uses `/api/writing/my-assignments`.

Blockers:

1. Assignments endpoint is one of the slowest measured protected endpoints.
2. Dashboard needs assignments, essays, permissions, and tips paths.
3. Some calls are already parallelized, so remaining gain may require endpoint aggregation or backend optimization, not just client parallelism.

Priority: high, but first step should be backend timing instrumentation around assignments.

### Speaking

Data:

- `/auth/me` median: 1.790s.
- `/api/dashboard/init` median: 2.800s.
- `/sessions/stats?limit=20` median: 1.996s.
- `/api/grammar/dashboard-data` median: 2.291s.

Blockers:

1. Dashboard aggregate endpoint is slow enough to dominate first paint.
2. Auth identity and dashboard aggregate are both expensive.
3. Additional widgets still run after initial dashboard work.

Priority: high if Speaking dashboard remains commercial entry point; otherwise behind Reading/Listening because it already has aggregation logic.

### Vocabulary

Data:

- HARs only show CSS/font timing.
- Phase 1 source reading showed public landing category/search fetches raw public endpoints.

Blockers:

1. Current Phase 2 data is insufficient for Vocab API timings.
2. Public vocabulary should likely share Grammar’s caching strategy.
3. Authenticated vocab modules still require separate initialization.

Priority: medium; recapture HAR or run targeted API timings before architectural work.

### Admin

Data:

- No explicit Admin HAR pair was supplied. `reading_content.cold.har` / `reading_content_warm.har` appears to cover Admin Reading content CSS only.
- Admin chrome source still performs Supabase session lookup for header email.

Blockers:

1. Data gap for admin FCP/API waterfalls.
2. Admin security checks are expected and should not be optimized by weakening auth.
3. Admin perf work should focus on observability and targeted slow endpoints.

Priority: medium-low for user-facing UX; high only if Andy dogfood pain is severe.

## Updated proposal confidence

| Phase 1 proposal | Updated confidence | Phase 2 verdict |
|---|---|---|
| Q1 preconnect/dns-prefetch | Medium | Still safe. HARs show static requests are not dominant, but preconnect can reduce cold connection tax. |
| Q2 cache headers for public read-only APIs | High | Supported. Public Grammar/Vocab content can benefit; sampled Railway API GETs lack cache headers. |
| Q3 cache Supabase session per page tick | Medium | Useful for concurrent API calls, but current data does not prove browser `getSession()` is dominant. |
| Q4 parallelize safe first-paint calls | High | Strongly supported for Reading exam and Listening dictation. |
| Q5 route prefetch on cards/CTAs | Medium | Likely useful, but should follow cache/header discipline and avoid waste. |
| M1 module-level Reading shell | Medium | Reading is priority, but first do Q4/M2 targeted boot improvements. |
| M2 combined boot endpoints | High | Strongly supported for Reading exam and Listening dictation. |
| M3 shared client data cache | Medium | Good for back-and-forth navigation, but apply first to public/read-only or low-risk lists. |
| M4 skeleton-first rendering | Medium | Improves perceived responsiveness but does not remove measured API waits. |
| A1 signed-in app shell | Low-medium | Data supports reducing reloads, but current evidence favors module-level pilots first. |
| A2 service worker | Medium for public content, low for protected content | Good for static/public repeat visits; do not cache protected APIs initially. |
| A3 asset pipeline/bundling | Low | Current data does not identify bundle transfer as the top bottleneck. |

## Recommendations — sequenced with confidence

### High-confidence next sprints

1. Reading exam boot optimization.
   - Target: `GET /api/reading/test/{id}` + `GET /api/reading/test/{id}/attempts/in-progress`.
   - Options: parallelize in frontend if auth/semantics allow, or add `/api/reading/test/{id}/boot`.
   - Expected impact: reduce boot wait from approximately sum of 2.068s + 1.786s toward max of the two, or one combined endpoint.

2. Listening dictation boot optimization.
   - Target: `GET /api/listening/content/{id}` + `GET /api/listening/exercises?...dictation`.
   - Options: combined boot endpoint returning content + matching exercise; or parallelization if endpoint semantics permit.
   - Expected impact: reduce ready wait from approximately 2.996s toward one request.

3. Public content cache headers.
   - Target: Grammar and public Vocabulary read-only endpoints.
   - Expected impact: repeat navigation and warm-cache improvement; low regression risk if TTL is short.

4. Backend timing instrumentation.
   - Add `Server-Timing` or `X-Process-Time` to identify auth, Supabase, serialization, and external service cost.
   - This should precede large app-shell or backend aggregation investments beyond the obvious boot endpoints.

### Investigation-needed before implementation

1. Browser FCP/LCP/TTI validation.
   - Current HARs are filtered/incomplete.
   - Recapture with all filters cleared or use Chrome Performance traces.

2. Writing assignments backend breakdown.
   - `/api/writing/my-assignments` median 2.656s and one run at 4.111s is notable.
   - Need backend stage timing before deciding if frontend aggregation helps.

3. Speaking dashboard aggregate breakdown.
   - `/api/dashboard/init` median 2.800s suggests the aggregate endpoint itself may be slow.
   - Need stage timing to know whether it is auth, query fan-out, serialization, or a specific widget.

### Defer for now

1. Site-wide SPA shell.
   - The data supports reducing reloads eventually, but targeted request-chain fixes have much clearer ROI.

2. Asset pipeline/bundling.
   - Current evidence points to API wait, not static asset size, as the dominant user-perceived bottleneck.

3. Protected API service-worker caching.
   - Security and staleness risk is not justified by current evidence.

## What still needs Andy input

1. Whether Reading browse/list pages may become public like Grammar.
   - If yes, Reading list UX could bypass auth and become much faster.
   - If no, focus on boot endpoints and authenticated API latency.

2. Whether Grammar/Vocabulary public content can tolerate 60-300 seconds of cache staleness.

3. Which module matters most commercially for first optimization:
   - Reading exam has the clearest measured waterfall.
   - Listening dictation has the second-clearest measured waterfall.
   - Speaking dashboard has the largest single aggregate endpoint latency.
   - Writing dashboard has the slowest measured student endpoint.

4. Whether Andy can recapture HARs or Performance traces with filters cleared.

## Appendix A — raw timing summary

### Protected API medians

| Endpoint | Median | Min | Max |
|---|---:|---:|---:|
| `/auth/me` | 1.790s | 1.715s | 2.825s |
| `/api/reading/test` | 1.271s | 0.906s | 1.313s |
| `/api/reading/test/AVR-READ-001` | 2.068s | 1.664s | 2.414s |
| `/api/reading/test/AVR-READ-001/attempts/in-progress` | 1.786s | 1.679s | 1.928s |
| `/api/listening/content` | 1.330s | 1.174s | 1.775s |
| `/api/listening/content/{id}` | 1.425s | 1.209s | 1.820s |
| `/api/listening/exercises?...dictation` | 1.571s | 1.414s | 1.576s |
| `/api/writing/my-assignments` | 2.656s | 2.542s | 4.111s |
| `/api/writing/my-essays` | 1.826s | 1.520s | 1.920s |
| `/api/student/permissions` | 1.835s | 1.514s | 2.219s |
| `/api/dashboard/init` | 2.800s | 2.440s | 3.782s |
| `/sessions/stats?limit=20` | 1.996s | 1.737s | 2.099s |
| `/api/grammar/dashboard-data` | 2.291s | 1.951s | 2.335s |

### Baseline medians

| Endpoint | Median | Min | Max |
|---|---:|---:|---:|
| `/health` | 0.726s | 0.636s | 0.915s |
| `/health/ready` | 2.109s | 1.921s | 2.241s |
| `/api/grammar/article/...habits-and-routines` | 1.033s | 0.905s | 1.391s |

## Appendix B — recapture instructions for complete browser data

The next HAR/trace capture should use:

1. Chrome DevTools Network tab with all filters cleared. Confirm document, JS, Fetch/XHR, CSS, image, and font requests are visible.
2. Preserve log enabled.
3. Cold run: Disable cache enabled.
4. Warm run: Disable cache off, fresh navigation after one prior load.
5. Export Network HAR with content.
6. For FCP/LCP/TTI, also capture Chrome Performance trace:
   - DevTools Performance tab.
   - Record reload.
   - Stop after useful content visible.
   - Export profile JSON.

Minimum recapture set if time is limited:

- Reading: `/pages/reading-test.html` → `reading-exam.html?test_id=AVR-READ-001`
- Listening: `/pages/listening.html` → dictation exercise
- Speaking: `/pages/speaking.html`
- Writing: `/pages/writing-dashboard.html`
- Grammar: `/grammar.html` → article baseline

## Closing verdict

Phase 2 confirms enough to move forward with targeted performance work, but not enough to justify a broad SPA/app-shell rewrite. The highest-confidence work is to reduce measured API waterfalls and add observability, while treating HAR/FCP/LCP analysis as pending due to incomplete capture files.
