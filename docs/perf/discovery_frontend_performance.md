# Frontend Performance Discovery

Date: 2026-05-29
Branch: `discovery/frontend-performance`
Scope: cross-cluster frontend responsiveness discovery; no code changes.

## Executive summary

Grammar Wiki feels faster primarily because it avoids the two most expensive user-facing waits present in most other modules: auth/session gating and multi-request API waterfalls. It is not the smallest page by bytes; it wins because the grammar article flow is public, read-only, served from an in-memory Markdown index, and rendered by one shared frontend script/CSS pair.

The slow-feeling modules are mostly page-per-flow HTML documents that restart Supabase session resolution and Railway API fetches on every navigation. Static HTML transfer is often acceptable, but the visible content waits for auth, protected API calls, and sometimes sequential detail calls.

Top recommended actions:

1. Add safe cache headers for public read-only Grammar/Vocabulary content endpoints and preconnect hints for Railway/Supabase/CDN origins.
2. Remove avoidable API waterfalls on first paint, starting with Reading exam boot, Listening exercise open, and Speaking dashboard widgets.
3. Add module-level shell/prefetch patterns for Reading, Listening, and Vocabulary before attempting any site-wide SPA rewrite.

## Methodology

Codex inspected frontend and backend source in `/Users/trantrongvinh/Documents/ielts-worktrees/perf-discovery`, measured live document/API transfer baselines with `curl`, checked representative HTTP headers, and inventoried local HTML asset dependencies from the repo. The measurements below are not Chrome DevTools FCP/LCP traces; they are network baselines useful for locating whether the bottleneck is document delivery, static assets, API latency, or architecture.

Files and contracts inspected:

- `frontend/js/api.js` for auth/session behavior and API base routing.
- `frontend/js/grammar.js`, `backend/routers/grammar.py`, and `backend/services/grammar_content.py` for Grammar Wiki routing and backend serving model.
- `frontend/js/reading-test.js`, `frontend/js/reading-exam.js`, and `backend/routers/reading_student.py` for Reading auth/API flow.
- `frontend/js/listening-dictation.js` and `frontend/js/listening-mini-test.js` for Listening request chains.
- `frontend/pages/speaking.html` for dashboard first-paint API sequencing.
- `frontend/pages/writing-dashboard.html` and `frontend/pages/writing-result.html` for Writing auth/API sequencing.
- `frontend/js/vocabulary.js`, `frontend/js/vocab-modules/*`, and representative admin pages for cross-module patterns.

Limitations:

- No authenticated browser session was available, so protected endpoint timing is represented by unauthenticated 401 timing plus static analysis of authenticated request chains.
- No Chrome Network HAR or Web Vitals trace was available. A template request for Andy is included in Appendix B if deeper FCP/LCP validation is needed.
- Backend latency was not deeply profiled; when backend timing appears relevant, this discovery flags it as frontend-visible latency rather than diagnosing database/service internals.

## Empirical measurements

### Live document timing baseline

Command shape: `curl -L -s -o /dev/null -w '<label> %{http_code} %{time_starttransfer} %{time_total} %{size_download}' <url>` from the Codex environment on 2026-05-29.

| Page | URL | HTTP | TTFB | Total | HTML bytes | Interpretation |
|---|---:|---:|---:|---:|---:|---|
| Grammar home | `/grammar.html` | 200 | 0.115s | 0.117s | 12.0 KB | Static shell is fast. |
| Grammar article | `/grammar/ielts-grammar-lab/talking-about-habits-and-routines` | 200 | 0.380s | 0.380s | 10.0 KB | Clean URL rewrite still cheap. |
| Reading L1 list | `/pages/reading-vocab.html` | 200 | 0.369s | 0.370s | 3.3 KB | Shell is small; data waits on auth API. |
| Reading L3 list | `/pages/reading-test.html` | 200 | 0.387s | 0.387s | 3.1 KB | Shell is small; list waits on auth API. |
| Reading exam | `/pages/reading-exam.html` | 200 | 0.371s | 0.374s | 13.7 KB | Shell okay; boot chains protected API calls. |
| Listening home | `/pages/listening.html` | 200 | 0.451s | 0.452s | 8.7 KB | Shell okay; user flows still protected. |
| Writing dashboard | `/pages/writing-dashboard.html` | 200 | 0.496s | 0.510s | 75.6 KB | Larger HTML plus multiple data calls. |
| Writing result | `/pages/writing-result.html` | 200 | 0.399s | 0.399s | 36.7 KB | Medium shell plus protected result/tips calls. |
| Speaking dashboard | `/pages/speaking.html` | 200 | 0.107s | 0.131s | 116.8 KB | HTML fast despite large size; JS/API work dominates. |
| Vocabulary home | `/pages/vocabulary.html` | 200 | 0.381s | 0.381s | 13.5 KB | Public-ish content page; fetches categories after load. |
| My Vocabulary | `/pages/my-vocabulary.html` | 200 | 0.375s | 0.375s | 4.3 KB | Shell small; data waits on module/auth. |
| Admin Reading | `/pages/admin/reading/content.html` | 200 | 0.377s | 0.377s | 5.5 KB | Shell small; admin chrome/auth/API dominate. |

Takeaway: static document download alone does not explain the observed UX. Several slow-feeling pages deliver HTML in under 0.5s, then delay useful UI while JavaScript resolves session/auth and fetches protected data.

### Live API timing baseline

| Endpoint | HTTP | TTFB | Total | Bytes | Notes |
|---|---:|---:|---:|---:|---|
| `/api/grammar/article/ielts-grammar-lab/talking-about-habits-and-routines` | 200 | 0.437s | 0.493s | 19.1 KB | Public success path, no auth. |
| `/api/grammar/home` | 200 | 0.940s | 1.829s | 108.2 KB | Large public payload; still no auth gate. |
| `/api/reading/test` | 401 | 0.652s | 0.652s | 52 B | Protected endpoint spends real time before redirect/failure. |
| `/auth/me` | 401 | 1.020s | 1.020s | 52 B | Auth check itself can be a visible wait. |

Takeaway: Grammar home has a large payload and can still be non-trivial over the network. The perceived advantage is not “all Grammar APIs are instant”; it is that Grammar can render a public static shell and one successful public content request, while authenticated modules often gate the whole useful UI behind auth/session and protected API work.

### Static asset/cache header samples

- `https://www.averlearning.com/js/grammar.js`: `x-vercel-cache: HIT`, `cache-control: public, max-age=0, must-revalidate`, `content-length: 52307`.
- `https://www.averlearning.com/css/grammar-wiki.css`: `x-vercel-cache: HIT`, `cache-control: public, max-age=0, must-revalidate`, `content-length: 30509`.
- Railway API GET samples returned `content-type: application/json` and no `Cache-Control` header in sampled responses.

Takeaway: Vercel is already serving static files from its edge cache, but public Railway API responses do not advertise browser caching. Safe read-only endpoints are candidates for short `Cache-Control` or ETag support.

### Local dependency inventory

A repo-side parser counted each sampled HTML file plus local CSS/JS dependencies referenced by `<link rel="stylesheet">` and `<script src>`. External CDN files are counted by reference but not byte-sized locally.

| Page | Local+HTML bytes | Local deps | External deps | Notes |
|---|---:|---:|---:|---|
| Grammar home | 194 KB | 8 | 2 | Shared grammar renderer is substantial but cacheable/reused. |
| Grammar article | 192 KB | 8 | 2 | Same shared assets as Grammar home. |
| Reading L1 list | 84 KB | 7 | 1 | Small shell and assets. |
| Reading L1 detail | 106 KB | 13 | 3 | More dependencies for markdown/detail rendering. |
| Reading L3 list | 84 KB | 7 | 1 | Small shell and assets. |
| Reading exam | 125 KB | 7 | 3 | Larger JS/CSS for exam chrome. |
| Listening landing | 80 KB | 5 | 2 | Small shell. |
| Listening dictation | 123 KB | 8 | 2 | Exercise UI/player code. |
| Writing dashboard | 206 KB | 9 | 5 | Large inline page plus multiple libraries. |
| Writing result | 178 KB | 12 | 4 | Result renderer dependencies. |
| Speaking dashboard | 259 KB | 11 | 4 | Largest sampled frontend shell. |
| Vocabulary landing | 133 KB | 11 | 3 | Shared chrome/assets plus vocab script. |
| My Vocabulary | 124 KB | 7 | 3 | Vocab module shell. |
| Admin Reading | 105 KB | 7 | 2 | Admin chrome plus page code. |

Takeaway: Grammar is not uniquely lightweight. Its advantage is architectural reuse and low-friction public data access, not raw asset size.

## Architecture comparison

### Grammar Wiki design

Relevant code:

- `backend/routers/grammar.py:1-15` declares the Wiki endpoints and documents that routes are public read-only content.
- `backend/routers/grammar.py:35-68` returns home/category/article data directly from `grammar_service` without auth.
- `backend/services/grammar_content.py:91-100` constructs in-memory indexes once in `GrammarContentService.__init__()`.
- `backend/services/grammar_content.py:104-160` loads Markdown files, builds category and search indexes, and keeps summaries/search data in memory.
- `frontend/js/grammar.js:13-22` deliberately uses raw `fetch()` instead of `window.api.get()` because Grammar endpoints are public.
- `frontend/js/grammar.js:36-40` maps articles to clean `/grammar/:category/:slug` URLs.

Behavior:

- Navigation is not a full SPA. Grammar home, article, roadmap, search, and compare are separate HTML pages / rewrites.
- The perceived speed comes from small static HTML documents, Vercel-cached shared assets, public API calls, no Supabase session requirement, and backend in-memory content indexes.
- The content model is read-only and anonymous, so the browser can render immediately and fetch content without waiting for user identity.

### Reading design

Relevant code:

- `backend/routers/reading_student.py:73-84` requires auth before listing L1 vocab passages.
- `backend/routers/reading_student.py:217-230` requires auth before listing L2 skill exercises.
- `backend/routers/reading_student.py:366-375` requires auth before listing L3 tests.
- `frontend/js/reading-test.js:48-64` renders the list only after `window.api.get('/api/reading/test?...')` resolves.
- `frontend/js/reading-exam.js:1104-1115` loads the full test, then checks in-progress attempts in a second API request.
- `frontend/js/api.js:26-34` calls Supabase `auth.getSession()` before every `window.api` request.

Behavior:

- Reading list pages are static-shell-light but data is protected and blocked on session + API.
- Reading exam is a single-page in-flow UI after load, but boot still does sequential protected calls: test bundle first, then in-progress attempt.
- Every page navigation restarts the document and session/API boot process.

### Listening design

Relevant code:

- `frontend/js/listening-dictation.js:91-101` fetches content first, then exercises for the content.
- `frontend/js/listening-mini-test.js:62-77` fetches session metadata, then opens the first step.
- `frontend/js/listening-mini-test.js:87-108` fetches content for each step before rendering it.

Behavior:

- Listening exercises are stateful once inside a page, but initial exercise load often chains multiple protected API calls.
- Mini Test intentionally steps through exercises, but the current implementation fetches step content on open, creating per-step latency unless browser/API cache helps.

### Speaking design

Relevant code:

- `frontend/pages/speaking.html:2073-2091` starts by requiring Supabase session and then calling `/auth/me`.
- `frontend/pages/speaking.html:2103-2119` attempts an aggregate `/api/dashboard/init` endpoint.
- `frontend/pages/speaking.html:2121-2142` falls back to `/sessions/stats` and history calls when aggregate fails.
- `frontend/pages/speaking.html:2147-2156` then loads Grammar dashboard and Vocab updates as additional widgets.
- `frontend/pages/speaking.html:2250-2258` loads `/api/grammar/dashboard-data` through the authenticated API wrapper.

Behavior:

- Speaking has already received partial optimization via an aggregate endpoint, but the page still performs identity, dashboard, history, grammar, vocab, and badge work during first paint.
- The HTML document can arrive quickly, but the dashboard experience is controlled by JavaScript/API sequencing.

### Writing design

Relevant code:

- `frontend/pages/writing-dashboard.html:1294` runs assignments and essays in parallel.
- `frontend/pages/writing-dashboard.html:1319-1371` loads assignments, essays, and permissions via protected APIs.
- `frontend/pages/writing-dashboard.html:716` loads tips.
- `frontend/pages/writing-result.html:429-430` loads a specific essay result through `window.api.get()`.
- `frontend/pages/writing-result.html:638` loads writing tips.

Behavior:

- Writing dashboard is better than a pure waterfall for assignments/essays because it uses `Promise.all`, but it still requires auth/session and multiple protected endpoints.
- Result page is document-per-result, so every result navigation restarts page/chrome/script initialization.

### Vocabulary design

Relevant code:

- `frontend/js/vocabulary.js:49-64` fetches public vocabulary categories with raw `fetch()`.
- `frontend/js/vocabulary.js:144` searches public vocabulary content.
- `frontend/js/vocab-modules/*` power authenticated learner-specific pages behind the Vocabulary iframe/module area.

Behavior:

- Public vocabulary article/category flows resemble Grammar more than Reading, but the broader Vocab learner pages are iframe/module based and still pay page/module initialization costs.
- The landing page uses raw public fetch and can be made faster with the same public caching strategy as Grammar.

### Admin design

Relevant code:

- `frontend/js/components/aver-admin-chrome.js:749-773` polls for Supabase and then calls `auth.getSession()` to populate header email.
- Representative admin pages then perform their own admin auth/API calls, e.g. `frontend/js/admin-access-codes.js:147` and `:165`, `frontend/js/admin-reading.js:220`.

Behavior:

- Admin pages correctly prioritize security/role checks over instant rendering.
- Performance issues here are mostly repeated chrome/session initialization plus page-specific admin fetches, not static document size.

## Root cause + bottleneck analysis

### Why Grammar feels fast

1. No auth/session gate. Grammar uses raw public fetch (`frontend/js/grammar.js:13-22`) rather than `window.api.get()`, bypassing `auth.getSession()` on every content request.
2. Backend content is memory-indexed. `GrammarContentService` loads Markdown once and serves indexed article/category/search data from process memory (`backend/services/grammar_content.py:91-160`).
3. Navigation targets are content-light. Article URLs map to small static HTML shells and one article endpoint rather than user-specific state machines.
4. Shared assets are reused across Grammar pages. Grammar home/article pages use the same renderer and CSS, so warm-cache navigation pays mostly document + one API fetch.
5. The module is read-only. No attempt state, progress persistence, audio signing, grading, permissions, or personalized dashboard widgets are required before content is useful.

### Why other modules feel slower

1. Auth is repeated at page and request boundaries. `window.api.get()` calls `_getAuthToken()` before every request (`frontend/js/api.js:26-34`), and many pages also perform their own explicit `/auth/me` or `getSession()` calls.
2. Full document navigations reset frontend state. Moving between module sub-pages usually reloads HTML, CSS, JS, Supabase initialization, user state, and data fetches from scratch.
3. Several flows have API waterfalls. Reading exam loads test then in-progress attempt; Listening dictation loads content then exercises; Listening Mini Test loads session then per-step content.
4. Dashboards aggregate too much first-paint work. Speaking and Writing load multiple widgets/data sources before the page feels complete.
5. Protected 401/permission paths are not cheap. The measured unauthenticated `/auth/me` and `/api/reading/test` responses took about 1.02s and 0.65s respectively from the Codex environment.
6. Static caching exists, but API caching is mostly absent. Vercel asset cache is active, while sampled Railway API responses did not advertise cache headers.

### Universal vs module-specific bottlenecks

Universal:

- Page-per-flow architecture causes full reloads between related pages.
- Repeated Supabase session resolution and auth redirects create visible waits.
- Static assets are cacheable but unbundled and duplicated across page families.
- API calls are usually made only after DOMContentLoaded/page script boot.

Module-specific:

- Reading: list/detail/exam data is fully auth-gated even for browse-style content; exam boot has a sequential in-progress check.
- Listening: content and exercise data are often fetched separately; Mini Test content is loaded step-by-step.
- Speaking: dashboard has many widgets and fallback paths; aggregate endpoint helps but does not cover everything.
- Writing: dashboard parallelizes assignments/essays but still performs permissions/tips/result-specific calls.
- Vocab: public vocabulary pages can be Grammar-like, but authenticated vocab practice modules still restart iframe/page state.
- Admin: security and role checks are expected, but chrome/session/page API initialization repeats frequently.

## Proposals — categorized

### Quick wins

#### Q1. Add preconnect/dns-prefetch for hot origins

- Modules affected: all authenticated modules.
- Effort: ~20-60 LOC across shared chrome/head snippets or canonical page templates.
- Impact: medium on cold loads, low on warm loads.
- Sketch: add `<link rel="preconnect">` and `dns-prefetch` for Railway API, Supabase, and high-use CDN origins where pages load Supabase/Lucide/marked/DOMPurify.
- Risk: low; verify no broken CSP assumptions.

#### Q2. Add cache headers for public read-only API endpoints

- Modules affected: Grammar Wiki, public Vocabulary, possibly public marketing/reference content.
- Effort: ~40-120 LOC backend middleware/helper plus endpoint selection.
- Impact: high for repeat article/category navigation; medium for first visit.
- Sketch: attach `Cache-Control: public, max-age=60, stale-while-revalidate=300` or ETags to `/api/grammar/home`, `/api/grammar/article/*`, `/api/grammar/categories`, and equivalent public vocabulary endpoints.
- Risk: stale content for recently edited articles; use short TTL or versioned ETags to balance freshness.

#### Q3. Cache Supabase session per page tick in `api.js`

- Modules affected: all pages using `window.api`.
- Effort: ~30-80 LOC.
- Impact: medium on pages with multiple parallel API calls.
- Sketch: wrap `_getAuthToken()` with a short-lived in-memory promise/cache so concurrent `window.api.get()` calls share one `auth.getSession()` result.
- Risk: auth edge cases after login/logout; cache must invalidate on auth state change or very short TTL.

#### Q4. Parallelize safe first-paint calls

- Modules affected: Reading exam, Listening dictation, Listening Mini Test, Writing dashboard, Speaking dashboard.
- Effort: one small patch per page, ~50-150 LOC each.
- Impact: medium-high where waterfall exists.
- Sketch: Reading exam can request test and in-progress attempt in parallel where safe, or expose one combined boot endpoint. Listening dictation can use a combined content+exercise endpoint or parallelize exercise lookup when content id is already known.
- Risk: preserve current error semantics and security checks.

#### Q5. Add lightweight route prefetch on obvious cards/CTAs

- Modules affected: Grammar, Reading lists, Listening browse, Vocabulary, Writing dashboard.
- Effort: ~80-160 LOC shared helper + per-page hooks.
- Impact: medium for perceived navigation latency.
- Sketch: on hover/focus/touchstart of a card, inject `<link rel="prefetch" href="next-page.html">` and optionally fetch read-only detail JSON into an in-memory map.
- Risk: extra network traffic; gate to `navigator.connection.saveData !== true` and avoid aggressive mobile prefetch.

### Medium investments

#### M1. Module-level shell for Reading

- Modules affected: Reading L1/L2/L3.
- Effort: 1 sprint, ~400-900 LOC depending on reuse.
- Impact: high for Reading navigation.
- Sketch: a Reading shell keeps chrome/session/filter state alive and swaps list/detail/exam prestart views client-side. Preserve `reading-exam.html` for active timed exam if simpler.
- Risk: route/back-button complexity; must not weaken answer-key stripping or exam state guards.

#### M2. Combined boot endpoints for stateful flows

- Modules affected: Reading exam, Listening exercises, Speaking dashboard, Writing dashboard.
- Effort: 1 sprint per module group.
- Impact: high on first useful paint.
- Sketch: provide backend endpoints shaped exactly for initial render, e.g. `/api/reading/test/{id}/boot` returns test metadata plus in-progress attempt summary; `/api/listening/dictation/{content_id}/boot` returns content and dictation exercise.
- Risk: backend contract expansion; tests must assert no answer keys or unauthorized data leak.

#### M3. Shared client data cache

- Modules affected: Reading, Listening, Vocab, Writing.
- Effort: 1 sprint, ~200-500 LOC plus adoption.
- Impact: medium-high for back-and-forth navigation.
- Sketch: small `frontend/js/cache.js` with TTL, key namespace, stale-while-revalidate helper, and opt-in invalidation after writes.
- Risk: stale user-specific data; apply first to public/read-only or list endpoints.

#### M4. Skeleton-first rendering standard

- Modules affected: all authenticated modules.
- Effort: 1 sprint for conventions + top pages.
- Impact: medium perceived improvement.
- Sketch: render stable chrome and meaningful skeleton cards immediately, then hydrate data. Avoid blank loading blocks for pages with known layout.
- Risk: cosmetic-only if API latency remains high; should accompany waterfall/cache work.

### Architectural changes

#### A1. App-shell navigation for signed-in student modules

- Modules affected: Speaking, Writing, Reading, Listening, Vocab.
- Effort: multi-sprint.
- Impact: high if done carefully.
- Sketch: keep authenticated chrome/session in one shell and load module views into a content outlet. Start with one module rather than site-wide conversion.
- Risk: large regression surface, browser history/routing complexity, harder page-level isolation.

#### A2. Service worker for static assets and public reference content

- Modules affected: Grammar, Vocabulary, Reading static shells, shared CSS/JS.
- Effort: 1-2 sprints.
- Impact: medium-high for repeat visits and unstable networks.
- Sketch: cache Vercel static assets and public Grammar/Vocab API responses with stale-while-revalidate. Do not cache protected API responses initially.
- Risk: stale cache bugs; requires explicit versioning and rollback strategy.

#### A3. Asset pipeline / bundling

- Modules affected: all frontend.
- Effort: multi-sprint and operationally invasive.
- Impact: medium; less important than API/auth waterfall fixes.
- Sketch: introduce a minimal build step for shared vendor assets and module bundles. Bundle only after page architecture stabilizes.
- Risk: current vanilla deployment is simple; a build step increases release complexity.

## Recommendations

1. Start with Q2 + Q3 + Q4. These attack the biggest observed split: public cacheable Grammar versus authenticated repeated API/session waits.
2. Pilot M2 on Reading exam or Listening dictation. These have clear code evidence of sequential boot chains and measurable UX impact.
3. Add Q5 route prefetch to Reading/Vocabulary/Grammar card grids after cache safety is defined. Prefetch without caching discipline can create waste.
4. Treat a site-wide SPA/app-shell as Phase B. The current evidence supports module-level shells first, not a broad rewrite.
5. Ask Andy for one Chrome DevTools HAR per module before committing to architectural work. Network baselines strongly suggest root causes, but HAR will confirm FCP/LCP and exact third-party timings on Andy's machine.

## What needs Andy input

- Whether public Reading browse pages should remain auth-gated. If Reading library discovery can be public like Grammar, that is a product/security decision with large performance upside.
- Whether slightly stale Grammar/Vocabulary content is acceptable for 60-300 seconds to unlock browser/API caching.
- Which module feels most commercially important to optimize first: Reading exam, Listening practice, Writing dashboard, or Speaking dashboard.
- Whether mobile data-saving should disable prefetch by default.

## Appendices

### Appendix A — raw measurement notes

HTML curl samples collected from Codex environment on 2026-05-29:

```text
grammar_home       200 TTFB=0.115 total=0.117 bytes=12026
grammar_article    200 TTFB=0.380 total=0.380 bytes=10048
reading_vocab      200 TTFB=0.369 total=0.370 bytes=3256
reading_test       200 TTFB=0.387 total=0.387 bytes=3079
reading_exam       200 TTFB=0.371 total=0.374 bytes=13661
listening_home     200 TTFB=0.451 total=0.452 bytes=8707
writing_dashboard  200 TTFB=0.496 total=0.510 bytes=75636
writing_result     200 TTFB=0.399 total=0.399 bytes=36675
speaking           200 TTFB=0.107 total=0.131 bytes=116780
vocabulary_home    200 TTFB=0.381 total=0.381 bytes=13457
my_vocabulary      200 TTFB=0.375 total=0.375 bytes=4327
admin_reading      200 TTFB=0.377 total=0.377 bytes=5511
```

API curl samples:

```text
api_grammar_article 200 TTFB=0.437 total=0.493 bytes=19073
api_grammar_home    200 TTFB=0.940 total=1.829 bytes=108159
api_reading_test    401 TTFB=0.652 total=0.652 bytes=52
api_auth_me         401 TTFB=1.020 total=1.020 bytes=52
```

### Appendix B — suggested DevTools HAR template for Andy

If Andy wants browser-grade confirmation, capture one Network HAR per module with cache disabled and one with cache enabled:

1. Open Chrome DevTools → Network.
2. Check “Preserve log”. For cold run, check “Disable cache”.
3. Load the page from a fresh tab.
4. Wait until visible content is ready, then navigate to one sub-page/card.
5. Export HAR and note perceived wait in seconds.

Suggested samples:

- Grammar: `/grammar.html` → one article.
- Reading: `/pages/reading-test.html` → one `reading-exam.html?test_id=...`.
- Listening: `/pages/listening.html` → one exercise.
- Writing: `/pages/writing-dashboard.html` → one result.
- Speaking: `/pages/speaking.html` initial dashboard.
- Vocab: `/pages/vocabulary.html` → one module page.
- Admin: `/pages/admin/index.html` → one nested admin page.

### Appendix C — discovery conclusion

The evidence refutes the simple hypothesis that Grammar is fast because it is a SPA or because its bundle is tiny. Grammar still performs full document navigations and its shared local asset footprint is larger than several other modules. The stronger explanation is: public read-only content, in-memory backend indexes, shared cacheable renderer assets, and no repeated auth/session gate before useful content appears.
