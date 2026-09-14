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
  to be classified before conversion.

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
  ad-hoc `/auth/me` shapes. Session/admin domain envelopes and the remaining
  API-boundary casts are intentionally queued for bounded waves.

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
  signal is rejected as a blanket refactor. Writing dashboard and course
  behavior remain genuine migration-era DOM ports. Refactor those two only with
  a behavioral contract, interaction coverage and measured bundle/render impact;
  preserve the existing persistence and finalization paths.

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
  soft navigation. React interaction coverage remains queued.

## Current Next.js adoption verdict

The application now uses Next.js as more than a route-for-route HTML host. A
production build owns 141 App Router routes with Cache Components enabled and
uses Partial Prerendering where request-time state is genuinely required. Public
Vocabulary and Grammar reads have Server Component owners, the browser has one
bundled Supabase singleton, shared student/admin navigation stays inside the App
Router, fonts and metadata are native, Web Vitals use Next's hook, and mutable
Vocabulary content has a tagged invalidation design.

Adoption is therefore **substantial but not yet optimal** in four bounded areas:

1. Vocabulary, public Grammar and the shared auth spine consume generated
   OpenAPI types; session/admin domains still rely on the compatibility API
   bridge.
2. Writing dashboard and course behavior remain imperative parity ports. The
   large Reading/Listening/mock renderers are not automatically defects because
   their state machines are already extracted and tested.
3. The app has root error/not-found ownership but only one route-level loading
   boundary, so slower uncached workspaces do not consistently expose streaming
   feedback.
4. Browser journey coverage is meaningful, but the unit-test pyramid is still
   dominated by source-shape assertions rather than rendered React interaction.

## Prioritized remaining roadmap

### P0 — Prove the new cache contract in staging

- Configure the revalidation secret/URL, mutate one Vocabulary record through
  the canonical admin path, and prove the following Server Component read sees
  it without waiting for TTL.
- Record webhook failure telemetry and verify canonical writes remain successful
  when revalidation is unavailable.

### P1 — Continue from the typed authenticated spine into shared domains

- Give session identity and shared admin list envelopes concrete FastAPI response
  models; generate types and introduce one adapter per domain. The auth identity
  and profile contracts are complete in Wave C4.
- Migrate callers away from `window.api` only after each adapter has runtime
  normalization and account-switch tests. Do not attempt a repository-wide
  replacement.

### P1 — Add streaming UX where latency is real

- Measure request latency first, then add segment `loading.tsx`/Suspense
  boundaries to the slow public catalogue and admin data workspaces. Preserve
  current client-only pages where a server boundary cannot reveal useful UI
  earlier.
- Verify keyboard focus, back/forward behavior and skeleton layout stability in
  desktop/mobile browser runs.

### P2 — Retire the two remaining high-risk parity ports

- Extract state/persistence models from Writing dashboard and course behavior,
  then split views only at stable interaction boundaries.
- Lock autosave, resume, submit, account switch and stale-response behavior with
  rendered interaction tests before removing their global/DOM bridge code.

### P2 — Establish a measured React test layer

- Add a small Vitest/Testing Library harness for newly extracted interactive
  units. Keep source-contract tests only for build-time ownership invariants;
  do not mechanically rewrite the existing 9,000+ passing assertions.
- Gate future client refactors on observable behavior and browser flows, not LOC
  or client-component counts alone.

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
