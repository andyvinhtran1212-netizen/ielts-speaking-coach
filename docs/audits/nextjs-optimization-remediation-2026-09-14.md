# Next.js optimization remediation plan — 2026-09-14

Baseline verified against production commit `b38973cda3b17445aca709eb51ebc3701d1dc119`.
This plan distinguishes real product debt from intentional architecture: FastAPI
remains the canonical REST backend for web/mobile consumers, and migration
fixtures are not deployable application routes.

## Verified inventory

- 133 App Router pages and 79 layouts; production build generates 137 routes.
- 152 client TSX modules contain 46,317 of 56,486 TSX lines (82.0%).
- 74 layouts load `AuthedShell`; 68 pages use `AdminAccessGate`.
- 208 internal raw anchors, seven `next/link` usages and 80 TSX files with hard
  `window.location` navigation.
- 131 TS/TSX modules call `window.api`; the generated OpenAPI declaration is not
  imported by application code.
- 649 explicit `: any` / `as any` occurrences in app, components and lib.
- 147 public JavaScript files and 142 public CSS files remain deployable assets.
- Only one route-level `loading.tsx`; global, route and not-found boundaries exist.
- 520 frontend unit tests, of which 477 inspect source text; no TSX component test.

## Revalidated local evidence after remediation

- Next 16.3.4 with Cache Components builds all 141 App Router routes; the route
  manifest includes static, Partial Prerendered and request-time routes instead
  of forcing one rendering mode across the product.
- Literal internal anchors in `frontend/app/**/*.tsx` fell from 208 to 131. The
  remainder is not a zero-count target: active-exam exits, downloads, external
  targets and affinity-sensitive launches retain hard browser navigation.
- Thirteen application modules now derive wire shapes from generated OpenAPI types.
  `window.api` is still referenced by 129 TS/TSX modules, but that file count is
  not a completion metric: several migrated screens keep the bridge only for
  mutations while their high-volume reads already use typed adapters.
- The full frontend contract suite passes 9,097/9,097; the rendered React suite
  passes 3/3; the full backend suite passes 7,966/7,966 with 308 environment-
  gated skips. Production build and TypeScript checks pass.
- A backend-less local build logs one handled `ECONNREFUSED` while prerendering
  public data, then successfully emits all 141 routes. This is expected from the
  streaming/error-boundary design locally, but staging still has to prove the
  real compressed Vocabulary payload and content-triggered cache refresh.
- Zero `next/image` imports and only one segment `loading.tsx` are not defects by
  themselves. The current product has many client-fetched authenticated states,
  inline Suspense boundaries and media/test surfaces where blanket conversion
  would add indirection without improving the user-visible critical path.

## Finding register and execution order

### NXT-01 — Vocabulary catalogue over-serialization

- **Root cause:** `/vocabulary` fetched the historical categories contract, then
  passed every embedded word summary through a Client Component boundary. The
  production catalogue therefore appeared in both the backend response and RSC
  payload even though only one viewport was visible.
- **Severity:** Medium (highest measurable performance impact).
- **Impacted code:** `backend/routers/vocabulary.py:get_categories`,
  `backend/services/vocab_content.py:get_categories`,
  `frontend/app/(public-content)/vocabulary/page.tsx:VocabularyBody`,
  `vocabulary-wiki.tsx:VocabularyWiki`.
- **Minimal fix:** additive paged directory contract; keep the legacy categories
  response unchanged; serialize the first 60 summaries and fetch filters/pages
  on demand.
- **Verification:** service/router bounds tests, client payload-shape tests, full
  Next build, browser deep-link/search/load-more check, staging compressed HTML
  budget under 60 KiB.
- **Status:** implementation complete in Wave A; staging measurement pending PR.

### NXT-02 — Internal navigation still behaves like an MPA

- **Root cause:** legacy ports retained raw internal anchors and
  `window.location` assignments, remounting auth/chrome and forfeiting App Router
  prefetch/transition behavior.
- **Severity:** Medium.
- **Impacted code:** 208 anchor occurrences and 80 TSX modules; start with shared
  chrome, student hubs and admin workspaces. Auth logout, downloads, cross-origin
  targets and affinity-sensitive exam launches are explicit hard-navigation
  exceptions.
- **Minimal fix:** use Next's typed `Link`/router primitives directly, then
  migrate route groups in bounded batches; do not perform regex replacement.
- **Verification:** source inventory decreases, browser history/back-forward and
  auth-provider mount remain stable, exam launch/return contracts remain green.
- **Status:** Wave B1 complete for landing, public Grammar, Vocabulary learning
  and the shared admin-denied action. `next/link` occurrences increased from 7
  to 75, while same-line raw internal anchors decreased from 208 to 171. Browser
  proof confirms the document, shared Supabase client, telemetry and history
  survive soft navigation. Wave B2 gives both `aver-chrome` and
  `aver-admin-chrome` a root App Router navigation owner without rewriting their
  Shadow DOM implementations: ordinary same-origin clicks use `router.push`,
  hover/focus prefetches, while modified clicks, downloads, external targets and
  in-page hashes retain browser semantics. A production browser run proves both
  student and admin chrome can cross route groups without losing the document,
  shared Supabase singleton or telemetry owner. Generated HTML inside the Grammar
  article shell and route-specific operational `window.location` transitions
  remain bounded compatibility debt; exam launches and downloads must continue
  to be classified before conversion. Wave B3 converts the complete Admin
  Overview surface—metric drill-downs, attention cards, skill hubs, recent
  activity and utility links—to App Router navigation. Exact literal internal
  anchors across `frontend/app/**/*.tsx` decrease from 171 to 161. A production
  browser fixture proves `/admin` → AI Usage keeps the same document while
  preserving the selected time window and canonical request. Wave B4 converts
  the ordinary navigation in all eight Reading/Listening library page shells;
  the literal-anchor inventory falls again to 138. Active-test exits, download
  links and receipt recovery remain hard by design. Shared-runtime browser proof
  passes 15/15: Reading and Listening route changes retain the document,
  Supabase singleton, route-owned body classes and telemetry without JS errors.
  Wave B5 converts ordinary directory navigation across Admin Classes, Class
  Detail, Students and the Writing Queue while retaining lesson attachments as
  real download-capable anchors. The literal-anchor inventory falls to 131.
  Canonical source tests pass 46/46 and four fixture-backed browser journeys pass
  73/73, including truthful reload-after-write, responsive containment and no
  unexpected writes or JavaScript errors. Remaining anchors still require
  route-by-route classification; zero anchors is not an optimization target.

### NXT-03 — Browser runtime bridge bypasses module typing/tree-shaking

- **Root cause:** the migration compatibility shell still loads Supabase UMD,
  `api.js`, Lucide UMD and web-component chrome; 131 modules consume
  `window.api` instead of imported clients.
- **Severity:** Medium.
- **Impacted code:** `frontend/components/authed-shell.tsx`,
  `frontend/components/supabase-runtime-boundary.tsx`,
  `frontend/lib/auth/auth-provider.tsx`, page behavior modules.
- **Minimal fix:** build a single ESM Supabase browser singleton and typed FastAPI
  transport; migrate one domain at a time while the bridge remains for untouched
  pages. Remove a script only after dependency inventory reaches zero.
- **Verification:** no duplicate GoTrue client, refresh/logout/account-switch
  browser tests, bundle analyzer comparison, public-script consumer inventory.
- **Status:** Wave C1 introduced an imported, OpenAPI-typed browser GET adapter
  and moved Vocabulary directory reads behind it. Wave C2 establishes one
  bundled ESM Supabase singleton for every Next shell; the compatibility
  `api.js` bridge adopts that exact client for domains not migrated yet. All 74
  authenticated route groups plus public auth/content no longer request the
  Supabase UMD bundle or its migration fallback. Browser proofs cover login,
  quiz, exam exit, onboarding, Writing admission and client navigation without
  duplicating the GoTrue client. This is primarily an ownership, typing and CSP
  improvement—not a byte win: the measured shared ESM chunk is about 60.2 KiB
  gzip versus 51.4 KiB for the former UMD bundle (plus its small fallback).
  `window.api` remains the deliberate compatibility boundary and should retire
  incrementally through typed domain adapters.

### NXT-04 — OpenAPI contract is generated but not consumed

- **Root cause:** `frontend/types/api.d.ts` is refreshed in CI, while application
  requests supply ad-hoc generic types and broad casts; drift is detected late.
- **Severity:** Medium.
- **Impacted code:** `frontend/types/api.d.ts`, API transport, 649 explicit any
  occurrences (not all are API-boundary defects).
- **Minimal fix:** derive endpoint request/response types from `paths`, add domain
  adapters with runtime normalization, and prohibit new API-boundary `any`.
- **Verification:** typecheck fixtures for request/response drift and domain route
  tests; track API-boundary casts separately from the global count.
- **Status:** Wave C1 derives the Vocabulary directory wire payload directly
  from generated OpenAPI `paths`. Wave C3 extends that contract to all seven
  public Grammar read families: home/category/article/search/compare/roadmap/
  groups now expose concrete FastAPI response models, and their Server
  Components consume the generated types instead of handwritten `any` shapes.
  Validation runs every live Markdown-derived article through Pydantic and
  caught one real pre-existing drift (`complete` in canonical content versus
  `published` in the former page-shell interface). The generated declaration
  remains a CI drift gate. Wave C4 models the complete auth identity/profile
  surface (`/auth/me`, `/auth/profile`, `/auth/check-active`, activation and
  profile update) at the FastAPI boundary. Standard browser consumers now use
  one generated-type adapter with runtime-normalized full-profile and minimal
  authorization projections; bootstrap/account-fenced flows retain their
  specialized transport but consume the same `AuthMeWire` contract. Malformed
  boolean permission/feature fields fail closed. The shared admin gate,
  onboarding, instructor and Vocabulary feature admission no longer declare
  ad-hoc `/auth/me` shapes. Wave C5 models the learner Speaking session spine:
  history preserves its legacy-list/paginated union, stats/detail/audio reads
  expose concrete schemas, and the native history/result surfaces consume one
  generated adapter. Runtime validation rejects malformed pagination, numeric
  bands, nested identities and the canonical sealed/lookup-failure decisions
  instead of rendering them as empty data. Backend coverage passed 86/86,
  frontend contracts 9,074/9,074, the production build generated all 141 routes
  and the Speaking browser journey passed 22/22. Wave C6 then closes the first
  bounded admin domain: the Speaking sessions list/detail, response regrade,
  session regrade and summary rebuild endpoints now publish concrete FastAPI
  response models and are consumed through one generated-type adapter. The
  existing runtime model remains the fail-closed normalization boundary, so the
  wire typing does not make malformed data appear valid. Backend coverage passed
  55/55, frontend contracts 9,076/9,076, the production build generated all 141
  routes and the native admin journey passed 12/12, including partial-failure
  readback, Full Test sibling rebuilding, unsafe audio and hostile text. During
  validation, two apparent backend duplicates were rejected as truncated-output
  artifacts and one stale rollback assertion was corrected to the post-Gate-F
  truth: archived HTML is a fixture, not a deployable route. Wave C7 closes the
  cross-module Admin Overview read boundary: all three dashboard endpoints now
  publish strict Pydantic response models, generated OpenAPI exposes their full
  nested schemas, and the React dashboard reads them through one typed adapter
  instead of `window.api`. Backend route coverage passes 42/42 and the browser
  fixture passes 24/24, including stale-response suppression, partial loading,
  unsafe activity links, responsive containment and soft navigation. Remaining
  admin domains and API-boundary casts are intentionally queued for bounded
  waves. Wave C8 types the next high-value list envelope: `/admin/users` now
  exposes a strict nested response model while explicitly admitting the valid
  legacy `user` role, and both user and access-code lists read through one
  generated-type adapter. Cohorts remain on the compatibility bridge until its
  picker/rollup union is modeled without response-field stripping. Backend
  contract coverage passes 17/17, frontend source coverage 16/16 and the full
  mutation/reconciliation browser journey 28/28. Wave C9 then models the shared
  `/admin/cohorts` picker/rollup union as one strict superset while preserving
  the smaller picker response via `response_model_exclude_unset`. Five native
  consumers—Users, Students, Classes, Writing Queue and Mock Exams—now share the
  generated adapter. Backend model/service tests pass 18/18, consumer contracts
  55/55 and their five browser journeys 87/87. No mutation path changed. Wave
  C10 types the high-volume `/admin/students` list while deliberately leaving
  create/edit/import, bulk assignment and profile-detail reads on their existing
  compatibility paths. The strict response publishes membership and cohort
  lookup failures as canonical truth rather than allowing them to disappear at
  serialization. Backend route/service/model coverage passes 40/40, focused
  frontend contracts 11/11, the production build emits 141 routes and the full
  Admin Students browser journey passes 18/18.
  Wave C11 then models the compact `/admin/courses` ladder envelope and moves
  both the Classes directory and class-detail picker to one generated adapter.
  Create/update course and cohort mutations stay on the compatibility bridge.
  Backend contract/rollup coverage passes 18/18, focused frontend contracts
  25/25, both browser journeys 43/43 and the build still emits 141 routes.
  Wave C12 models the projected `/admin/writing/essays` queue rows and moves the
  native Writing Queue list read behind one generated adapter and its existing
  canonical query builder. Detail, polling and grading/delivery writes are
  unchanged. Backend route/model coverage passes 73/73 plus 8/8 focused service
  and ownership tests; focused frontend contracts pass 10/10, the browser
  journey passes 12/12 and the build emits all 141 routes.

### NXT-05 — Large imperative Client Components remain parity ports

- **Root cause:** high-risk migrated pages preserve module globals, direct DOM
  lookup/listeners and multi-responsibility components. This was intentional for
  migration parity, but now blocks component-level testing and selective render.
- **Severity:** Medium.
- **Impacted code:** writing dashboard (1,832 LOC), session result (1,338), Reading
  exam (1,271), mock runner (1,217), course behavior (1,195) and Listening player
  (865).
- **Minimal fix:** extract pure domain reducers/models first, then view sections
  and hooks; keep backend persistence/finalization contracts unchanged.
- **Verification:** reducer tests, component interaction tests and existing browser
  flows for save/resume/submit/review/account-switch.
- **Status:** revalidated and narrowed. Reading, Listening, mock runner and
  session-result already delegate their critical state transitions to tested
  pure controllers/models; their remaining size is primarily the renderer for
  many IELTS question shapes. Splitting those files by LOC alone would move code
  without reducing shipped behavior or regression risk, so that original audit
  signal is rejected as a blanket refactor. Wave H measured the two remaining
  candidates rather than assuming line count equals client cost: Writing ships
  about 16.7 KiB gzip of route-specific behavior and Course about 9.4 KiB gzip.
  Their critical admission/receipt and session/mastery decisions already live in
  executable models and write-flow gates. The bounded lifecycle debt was real:
  Writing's mutable page/modal state lived at module scope and Course maintained
  a second readiness poller. Writing now owns one isolated runtime via `useRef`
  per mounted page/account. Course uses the shared bounded readiness primitive,
  cancels a pending bootstrap on unmount and flushes queued progress/drafts when
  a Next soft navigation unmounts the client island without `pagehide`. The
  executable Writing harness proves independent runtime objects; 352 focused
  contracts, 27 Writing browser scenarios and the Course ten-write verdict flow
  all pass. A wholesale JSX rewrite is therefore not justified without a new
  measured product need.

### NXT-06 — CSS/font/icon delivery remains layout-link based

- **Root cause:** route-group layouts reproduce the migration-era cascade via
  `<link>` elements and load full icon/font runtimes. The exact cascade is a real
  compatibility constraint, so bulk conversion would cause visual regressions.
- **Severity:** Medium.
- **Impacted code:** `AuthedShell`, public-content layout, 147 JS/142 CSS assets.
- **Minimal fix:** self-host fonts through `next/font`, replace icons with named
  ESM imports, and migrate CSS route group by route group after computed-style
  snapshots. Preserve untouched legacy assets.
- **Verification:** light/dark desktop/mobile screenshots, computed-style parity,
  no missing runtime consumers, bundle/network budgets.
- **Status:** Wave E implementation complete locally for the validated delivery
  debt. The root now self-hosts the three sanctioned variable fonts through
  `next/font`; runtime Google Fonts requests are gone and Lora is not preloaded
  outside long-form use. The 402,312-byte Lucide DOM runtime was removed from
  the landing and changed from global to explicit opt-in: only the two remaining
  legacy consumers (`/practice/session` and `/writing/dashboard`) load it, so
  72/74 authenticated route groups no longer pay that request. Server-rendered
  landing SVGs keep the same 24px computed geometry and eliminate the hydration
  mutation exception. Browser proof observed zero Google Fonts and zero Lucide
  requests on `/`, with fonts served from `/_next/static/media`. Link-based CSS
  ordering remains intentionally intact: validation confirmed it encodes real
  Tailwind/reset cascade compatibility, not a standalone performance bug.

### NXT-07 — Public cache has TTL but no content-triggered invalidation

- **Root cause:** `getPublicJson()` applies `use cache`/`cacheLife`, but no
  `cacheTag` or authenticated invalidation path connected canonical FastAPI
  runtime content commits to Next's cache. Validation narrowed this to
  Vocabulary: Grammar Wiki is repository-authored and its admin surface is
  intentionally read-only, so a content deployment naturally gets a new cache.
- **Severity:** Medium.
- **Impacted code:** `frontend/lib/backend.ts:getPublicJson`, Vocabulary admin
  mutations in FastAPI and the new Next invalidation route.
- **Minimal fix:** deterministic public-content tags plus an HMAC-protected
  invalidation webhook called only after canonical commits. TTL remains fallback.
- **Verification:** signed-envelope tests cover exact-body HMAC, stale requests,
  forged signatures, unknown/duplicate tags and size bounds; backend tests cover
  fail-soft notification and post-reload scheduling; full frontend contract
  suite and production build cover the compiled route. A local production-server
  smoke returned 200 for a valid envelope, 401 for a forged signature and 400
  for stale/unknown-tag requests. On staging, mutate one word and prove a
  subsequent revalidation refresh reflects canonical data.
- **Status:** Wave F implementation complete locally. Vocabulary server reads
  carry `public:vocabulary`; successful import/edit/delete/bulk-delete/audio
  writes notify an HMAC-protected, allow-listed Route Handler. Grammar was
  deliberately excluded after false-positive validation. Staging configuration
  and live mutation proof remain pending PR/deploy authorization.

### NXT-08 — Quality gates under-cover React behavior and web metadata

- **Root cause:** most unit tests inspect source strings; there are no TSX
  interaction tests. Public metadata lacks `robots.ts`, `sitemap.ts` and a web
  manifest; custom RUM approximates rather than using Next's web-vitals hook.
- **Severity:** Low–Medium.
- **Impacted code:** frontend test harness, root app metadata files,
  `public/js/rum-vitals.js`, `instrumentation-client.ts`, CSP configuration.
- **Minimal fix:** add Vitest + Testing Library for extracted components, native
  metadata files and `useReportWebVitals`; tighten CSP only after inline/bootstrap
  consumers are removed.
- **Verification:** real interaction assertions, metadata endpoint checks, vitals
  event schema tests and Preview CSP console audit.
- **Status:** Wave D adds native `robots.ts`, `sitemap.ts` and `manifest.ts`,
  canonical identities for public roots/articles, noindex on query workspaces,
  behavioral sitemap normalization tests, and compiled route-ownership checks
  for all three metadata endpoints. Wave D2 replaces the approximate legacy
  collector on App routes with one root `useReportWebVitals` integration while
  retaining the backend envelope and the original document pathname across
  soft navigation. Wave I revalidated the test inventory: the original claim of
  “no rendered TSX test” was too broad because the Speaking feedback suite
  already renders React markup and page-level Playwright journeys exercise live
  React routes. The real missing layer was fast state/focus/keyboard interaction
  coverage. A bounded Vitest + Testing Library harness now locks the shared admin
  dialog's focus trap, dismissal/busy contract and focus restoration, plus the
  Grammar mode switcher's roving-tab and panel semantics. All three component
  interactions pass and CI runs them independently from source contracts and
  page-level browser journeys.

## Current Next.js adoption verdict

The application now uses Next.js as more than a route-for-route HTML host. A
production build owns 141 App Router routes with Cache Components enabled and
uses Partial Prerendering where request-time state is genuinely required. Public
Vocabulary and Grammar reads have Server Component owners, the browser has one
bundled Supabase singleton, shared student/admin navigation stays inside the App
Router, fonts and metadata are native, Web Vitals use Next's hook, and mutable
Vocabulary content has a tagged invalidation design.

Adoption is therefore **substantial but not yet optimal** in four bounded areas:

1. Vocabulary, public Grammar, the shared auth spine, learner Speaking sessions,
   admin Speaking operations, Admin Overview, Admin Users/access codes, the
   shared cohort/course pickers, the Admin Students directory, both Classes
   surfaces and the Writing Queue list consume generated OpenAPI types. Other
   admin domains still rely substantially on the compatibility API bridge.
2. Large renderers still preserve some imperative parity code, but measured
   route bundles are small and their critical state machines/write paths are
   extracted and tested. Remaining conversions are maintainability work, not a
   current correctness or performance blocker.
3. The app has broad inline Suspense coverage and explicit client read states;
   the one confirmed blank Grammar article wait now streams a stable skeleton.
4. Browser journey coverage is meaningful and the new bounded component layer
   covers shared React interaction primitives. Historical source contracts still
   dominate the raw count, but mechanically rewriting them has no product value.

## Prioritized remaining roadmap

### P0 — Prove the new cache contract in staging

- Configure the revalidation secret/URL, mutate one Vocabulary record through
  the canonical admin path, and prove the following Server Component read sees
  it without waiting for TTL.
- Record webhook failure telemetry and verify canonical writes remain successful
  when revalidation is unavailable.

### P1 — Continue from the typed authenticated spine into shared domains

- Continue from the completed auth (Wave C4), learner session (Wave C5), admin
  Speaking (Wave C6) and Admin Overview (Wave C7) contracts into the next
  high-value admin list/detail envelope. Generate types and introduce one
  adapter per bounded admin domain.
- Migrate callers away from `window.api` only after each adapter has runtime
  normalization and account-switch tests. Do not attempt a repository-wide
  replacement.
- Next candidate: use the same bounded pattern for a domain whose backend read
  shape is already stable; do not type dynamic mutation paths merely to reduce
  the compatibility-bridge count.
- **Post-C12 stop condition:** the next highest-count consumers are Writing
  Assignments (8 ad-hoc reads), Mock Reviews (7), Mock Exams (5), Class
  Submissions (5) and Class Detail/Homework (multi-source operational reads).
  Each couples several detail, polling or mutation contracts and already has a
  domain normalizer/browser journey. They are feature-sized migrations, not a
  safe shared-read cleanup. Schedule each with the next product change in that
  domain; do not enlarge this audit branch to make the raw bridge count look
  smaller. The remaining inventory is 139 `window.api.get<unknown>` calls and
  226 bridge mutations/uploads across App TSX, both tracked as compatibility
  debt rather than an audit-completion gate.

### P1 — Add streaming UX where latency is real

- Revalidation found that the public catalogue already streams its canonical
  Server Component read, while more than 30 query/param workspaces have inline
  Suspense fallbacks and client-fetched admin pages expose explicit auth/data
  read states. Adding segment files to those client pages would not reveal their
  canonical data earlier and is rejected as a false-positive optimization.
- Replace the one real blank state—the uncached Grammar article segment—with a
  stable article/TOC skeleton, then verify the status announcement and layout on
  desktop/mobile. Add more boundaries only when production latency evidence
  identifies a server-owned route with an unrepresented wait.
- **Status:** completed locally in Wave G. The segment now streams an accessible
  article/TOC skeleton instead of a blank document. A delayed canonical fixture
  proved the fallback at 390×844 and 1440×900 with no horizontal overflow,
  a hidden mobile TOC rail and a 760px desktop reading column (8/8 browser
  checks). TypeScript, all 9,078 frontend contracts and the 141-route production
  build pass. No client-only admin route received a cosmetic segment fallback.

### P2 — Retire the two remaining high-risk parity ports

- **Status:** bounded risk retired in Wave H. Writing no longer shares mutable
  lifecycle state at module scope; Course no longer owns an ad-hoc readiness
  timer. Autosave, resume, submit, account/assignment fencing, stale report
  recovery and verdict aggregation remain locked by executable/browser tests.
- Further JSX view extraction should happen only alongside a feature touching a
  stable interaction boundary and must demonstrate a render, bundle or ownership
  improvement. It is not an audit-completion prerequisite by line count alone.

### P2 — Establish a measured React test layer

- **Status:** completed locally in Wave I. Vitest + Testing Library cover three
  rendered interactions across the shared admin dialog and public Grammar mode
  switcher; `backend-tests.yml` runs the suite on every PR.
- Keep source-contract tests only for build-time ownership invariants and add
  rendered tests alongside future shared interactive primitives. Do not
  mechanically rewrite the existing 9,000+ passing assertions.

### P3 — Continue compatibility retirement by evidence

- Convert generated Grammar internal links and classified operational/admin
  transitions in route-sized batches. Preserve downloads, external navigation,
  auth exits and exam-affinity launches as explicit hard-navigation cases.
- Remove legacy JS/CSS only after the public consumer inventory reaches zero and
  computed-style/network snapshots prove the replacement.

## Explicitly rejected false positives

- Zero Server Actions is not a defect: FastAPI is the canonical external API and
  remains required by non-Next consumers.
- Native `<img>` is not a blanket defect: signed, blob and local preview URLs need
  case-by-case handling before `next/image`.
- A single Next Route Handler is not a defect by itself for the same FastAPI
  boundary reason.
- The 82% client LOC ratio is a prioritization signal, not authorization to mark
  every component as server-renderable.
- Public JS/CSS files cannot be bulk-deleted; many still have live consumers.

## Delivery gates

Each wave must pass focused unit tests, full `next build`, relevant backend tests,
browser coverage for the touched journey, diff review, and a measured before/after
artifact or network budget. Feature branches start from the exact promoted main
SHA and merge into `staging`; production receives only the exact staging-proven
SHA through the existing promotion flow.
