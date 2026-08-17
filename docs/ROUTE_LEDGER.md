# Route Ledger for Next.js Migration

**Status:** DRAFT (Generated 2026-07-13)  
**Baseline commit:** `3f031d17` (11 commits after baseline audit `9047e09f`)  
**Scope:** All production routes normalized from 128 source HTML files (124 production + 4 test fixtures)  
**Method:** Source-of-truth inventory per §7.3 (FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md)

**IMPORTANT:** This ledger is a *working inventory*, not a finalized migration contract. Numbers and route counts are subject to revision as following details:
- Route consolidation after analysis of URL aliases and rewrites
- Auth level re-verification by reading each file's session/permission checks
- Browser dependency audit (audio, recording, clipboard, storage APIs)
- Complexity assessment based on state management and user interaction flows
- Test invariant mapping (per §7.4)

---

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| **Total production HTML files** | 124 | Verified 2026-07-13 |
| **Canonical route patterns** | ~110 | Normalized from files + vercel.json rules |
| **Admin routes** | 67 | Includes listening (17), writing (11), vocab (9), other (30) |
| **Student-facing routes** | 25 | Speaking, writing, reading, listening, vocabulary, profile |
| **Public/marketing routes** | 8 | Grammar, pricing, login, onboarding |
| **Instructor routes** | 3 | Grade, compare, dashboard |
| **Root-level HTML** | 7 | index, login, admin, grammar, vocabulary, pricing, onboarding |
| **Vercel rewrites** | 11 | Clean URLs: /home, /speaking, /grammar/:category/:slug, /writing/*, /admin/writing/* |
| **Vercel redirects** | 18 | Legacy path consolidation (admin split, vocabulary rename) |
| **Test fixtures** | 4 | Harness, retention-harness, result-harness (outside production scope) |

---

## Discrepancies & Open Questions

### Q1: Admin route count (current inventory)
- **Baseline claim (v2):** 62 admin pages
- **Verified count (cross-audit 2026-08-15):** 66 files under `pages/admin/`
- **Breakdown:**
  - `pages/admin/index.html` (1) — main hub
  - `pages/admin/dashboard/` (2) — overview + reading-attempts
  - `pages/admin/error-logs/` (1) — error triage
  - `pages/admin/feedback/` (1) — feedback analytics
  - `pages/admin/foot-traffic/` (1) — usage metrics
  - `pages/admin/grammar/` (4) — index + articles + analytics + recommend-test
  - `pages/admin/instructors.html` (1) — instructor oversight
  - `pages/admin/listening/` (15) — explicit rollback pages for the 15 native Admin Listening route surfaces
  - `pages/admin/access-codes/`, `classes/`, `cohorts/` (3) — access and class operations
  - `pages/admin/mock-exams/` (1) — exam management
  - `pages/admin/mock-live/`, `mock-pacing/`, `mock-tests/` (3) — mock-test operations
  - `pages/admin/mock-reviews/` (2) — index + report
  - `pages/admin/reading/` (2) — content + preview
  - `pages/admin/speaking/` (3) — index + sessions + topics
  - `pages/admin/students/` (1) — user management
  - `pages/admin/system/` (3) — alerts + ai-usage + index
  - `pages/admin/usage/index.html` (1) — per-user/access-code activity rollup
  - `pages/admin/users/` (1) — user list & access-code mgmt
  - `pages/admin/vocab/` (9) — vocabulary operations
  - `pages/admin/writing/` (11) — writing operations
  - **Total: 66** ✓

- **Resolution:** The filesystem inventory is canonical; update this count whenever a rollback page is added or retired.

### Q2: Access-code redirect (2 targets)
- `vercel.json` line 48–50 has three rules:
  1. `/admin/access-codes` → `/pages/admin/users/index.html?tab=codes` (clean-URL alias)
  2. `/pages/admin/access-codes/index.html` → `/pages/admin/users/index.html?tab=codes` (legacy path consolidation)
  3. `/pages/admin/dashboard/index.html` → `/pages/admin/index.html` (dashboard moved to admin hub)
- **Resolution:** Both `/admin/access-codes` and `/pages/admin/users.html?tab=codes` are canonical; access-codes view is a tab within users.

### Q3: Vocabulary dual-route issue (two index files) — ĐÃ CHỐT 2026-08-08
- Both `frontend/public/vocabulary.html` (root) and `frontend/public/pages/vocabulary.html` exist.
- `frontend/pages/my-vocabulary.html` is a legacy path that redirects to `/pages/vocabulary.html` per vercel.json line 35.
- **Chúng KHÔNG phải bản trùng lặp.** Đo 2026-08-08, cả hai đều trả 200 trên production:

  | | `public/vocabulary.html` | `public/pages/vocabulary.html` |
  |---|---|---|
  | Tiêu đề | Vocabulary Wiki — Aver Learning | Từ vựng — Aver Learning |
  | Cần đăng nhập | **không** | **có** |
  | Nguồn dẫn | tab «Vocabulary» của `aver-chrome.js:324`, `vocab-article.html`, admin | các lối vào trong khu học viên |

- **CHỐT (chủ dự án, 2026-08-08): `/vocabulary` thuộc về WIKI CÔNG KHAI.**
  Trang Từ vựng của học viên giữ `/vocabulary/hub`.
  Lý do: tab điều hướng chung ĐANG trỏ vào wiki, nên tên đó khớp với thứ người
  dùng đã quen; và trang công khai mới là trang cần URL ngắn để chia sẻ.
  Chi phí bằng 0: không link nào phải sửa.
- Chốt `vocabulary-route-ownership.test.mjs` ghim quyết định này: route `/vocabulary`
  (khi wiki được port) KHÔNG được nằm trong nhóm `(authed-*)`, và trang học viên
  phải ở lại `/vocabulary/hub`.

### Q4: Grammar routes and dynamic patterns
- `vercel.json` line 22 has one dynamic rewrite: `/grammar/:category/:slug` → `/pages/grammar-article.html`
- This is ONE canonical route pattern serving ~150 markdown articles at various category/slug combinations.
- Frontend routes enumerated separately (grammar-article, grammar-compare, grammar-search, grammar-roadmap) are pages that **serve** the pattern, not alternative routes.
- **Resolution:** Counted as 1 dynamic route pattern in the Grammar domain.

### Q5: Writing admin consolidation
- Modern writing admin routes live under `/admin/writing/` (vercel.json rewrites + actual files).
- Legacy paths like `/pages/admin-writing.html` redirect per vercel.json lines 36–42.
- **Resolution:** Only canonical paths (`/admin/writing/*`) are in ledger; legacy redirects are enumerated in "Aliases/redirects" column.

### Q6: Listening tests vs. listening-mini-test vs. skills drills
- Three overlapping naming schemes:
  - `listening-test.html` — full IELTS listening test (4 sections, answer key)
  - `listening-mini-test.html` — mini practice (1-2 sections)
  - `listening-skills.html` — skill drills (reuses listening_tests as test_type=drill)
- **Resolution:** All three are distinct routes; drills are a feature gate within skills, not a separate page.

### Q7: Full-test chaining and session affinity
- The player carries `p1/p2/p3` for legacy URL compatibility; new sessions persist one server-owned `sessions.full_test_attempt_id` across all three Parts.
- `/full-test-result` can resolve the full chain canonically from Part 1. Pre-migration rows still require explicit `p1/p2/p3` and are marked unverified rather than silently treated as a database-backed chain.
- **Resolution:** Full-test is ONE complex flow across multiple pages; the database chain identity is canonical, while the tab-scoped ID array remains resume/rollback transport only.

### Q8: Instructor routes (3 vs. expected scope)
- Only 3 instructor files found: `pages/instructor/index.html` (dashboard), `/grade.html`, `/compare.html`.
- Expectation from writing flow: instructor sees the admin-operated queue at `/admin/writing/instructor-queue` instead.
- **Resolution:** Instructor grade/compare are specialty pages; primary flow is via admin-writing tab for school workflows.

### Q9: Admin.html (root redirect stub)
- Both `/admin.html` (root-level stub) and `/pages/admin/index.html` (real hub) exist.
- `admin.html` is a redirect stub per CLAUDE.md file structure.
- **Resolution:** `/admin.html` is a legacy redirect; canonical entry is `/pages/admin/index.html` (or via clean URL `/admin` if rewrite added).

### Q10: Root-level vocabulary.html — ĐÃ ĐÓNG 2026-08-08
- Giả thuyết cũ («likely a legacy alias») **SAI**. Nó là một trang ĐỘC LẬP:
  wiki công khai, không cần đăng nhập, và là đích của tab «Vocabulary» trên
  thanh điều hướng chung. Bằng chứng + quyết định sở hữu route: xem **Q3**.
- Không được biến nó thành redirect sang `pages/vocabulary.html`: hai trang phục
  vụ hai đối tượng khác nhau (khách vs học viên đã đăng nhập).

---

## Routes by Domain

### Marketing & Public

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/` | — | `index.html` | Public | none | localStorage (theme) | S | Landing page; marketing content only |
| `/pricing` | `/pricing.html` giữ nguyên làm rollback/source cho ngày launch | `app/(marketing)/pricing/page.tsx` — CUTOVER 2026-08-15 | Public | none | none while pre-launch closed | S | Native server redirect về `/`; không gửi UI giá chưa phát hành xuống trình duyệt. Legacy cũng tiếp tục giữ redirect sentinel. |
| `/login` | `/login.html` remains rollback/parity target | `app/(public-auth)/login/page.tsx` — native React ownership 2026-08-15 | Public | none; Supabase implicit callback hash/query is consumed then removed | localStorage (theme), shared Supabase client, canonical `/auth/me` | M | Native auth entry; strict backend profile truth; inactive access-code flow reconciles `/auth/me` after every mutation outcome, including lost ACK; active unonboarded users route to canonical `/onboarding` |
| `/onboarding` | `/onboarding.html` remains rollback target | `app/(authed-onboarding)/onboarding/page.tsx` — native React ownership 2026-08-15 | Student | none | AuthProvider, canonical `/auth/me`, `/auth/profile` PATCH | M | Three-step native wizard; inactive/completed/malformed profiles fail closed; submit always reconciles canonical profile, including lost ACK |

### Grammar

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/grammar` | `/grammar.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(public-content)/grammar/page.tsx` — CUTOVER (pilot 2) | Public | none | localStorage (theme) | M | Grammar hub; category browser |
| `/grammar/:category/:slug` | `/:category/:slug` (clean URL alias via vercel rewrite) | `pages/grammar-article.html` | Public | `anchor` (scroll to section) | localStorage (theme), fetch (public API) | M | Article view; ~150 articles served by single page; server-side SEO metadata |
| `/grammar/compare` | `/pages/grammar-compare.html` vẫn phục vụ làm mốc rollback + vế parity | `app/(public-content)/grammar/compare/page.tsx` — CUTOVER 2026-08-15 | Public | `slug` theo dạng `<left>-vs-<right>` | localStorage (theme); server fetch public API | M | Native SSR side-by-side article comparison; legacy page retained for rollback/parity |
| `/grammar/roadmap` | `/pages/grammar-roadmap.html` vẫn phục vụ làm mốc rollback + vế parity | `app/(public-content)/grammar/roadmap/page.tsx` — CUTOVER 2026-08-15 | Mixed: public khi có `slug`, Student khi không có | `slug` category tùy chọn | localStorage (theme); public server fetch `/api/grammar/roadmap/{slug}`; personal AuthProvider + `/api/me/roadmap` | M | Native public category roadmap và personal KP roadmap; legacy retained for rollback/parity |
| `/grammar/search` | `/pages/grammar-search.html` vẫn phục vụ làm mốc rollback + vế parity | `app/(public-content)/grammar/search/page.tsx` — CUTOVER 2026-08-15 | Public | `q` (search term) | localStorage (theme); server fetch public API | M | Native SSR full-text search; legacy page retained for rollback/parity |

### Migration Runtime Infrastructure

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/core-player/launch` | — | `app/core-player/launch/route.ts` | Public redirect boundary; no data access, destination/backend remains authoritative | `surface` plus the allowlisted identity/context query for that surface | no-store 307 redirect | S | Runtime admission boundary for new core attempts. It never accepts an implementation choice from the client; cached launchers are resolved against the currently deployed policy. This endpoint is part of the coexistence rollback floor while old launcher bundles may call it. |

### Speaking

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/speaking` | `/pages/speaking.html` (file, bản legacy vẫn phục vụ làm mốc rollback + vế parity), `/pages/dashboard.html` → `/pages/speaking.html` (legacy redirect via vercel.json line 34) | `app/(authed-speaking)/speaking/page.tsx` — CUTOVER 2026-08-05 | Student | none | localStorage (theme), sessionStorage (session state), Supabase session | M | Speaking hub; session list & full-test launch |
| `/practice` | `?session_id=<uuid>` (mandatory; error if missing) | `pages/practice.html` | Student | `session_id` | localStorage (theme), sessionStorage (recording state), MediaRecorder, Whisper API (audio upload), Claude grading API, Supabase session | XL | Core speaking practice; 3167 LOC practice.js; recording + grading + feedback + full-test chaining |
| `/practice/session` | Next dark route ready; admission vẫn `/pages/practice.html` (`admit_new=legacy`) | `app/(authed-practice)/practice/session/page.tsx`; React sở hữu auth, session/question bootstrap, MediaRecorder, multipart/reconciliation, Full Test chain/retry/resume/finalize, state activation, cleanup timer/countdown/listener/speech/object URL, static player DOM/handlers/SVG và structured view-model của header/loading/error/test progress/Part 1-3 prep/recording/processing/Part 2/assignment sheet/completion/feedback/pronunciation/test results; backend pin chain đúng part/cùng sitting, 9/1/5 câu và exact response coverage; `practice.js` giữ legacy DOM fallback trên URL rollback | Student | `session_id` | AuthProvider + checked bootstrap + native player/recorder/submission/full-test controllers; receipt-safe canonical backend readback | XL | `route_ready=true` chỉ xác lập coexistence rollback floor; real Safari/iOS và live floor→cutover→rollback drill vẫn chặn admission/cutover |
| `/result` | `app/(authed-session-result)/result/page.tsx` — native React behavior 2026-08-09; `/pages/result.html` remains rollback target | `pages/result.html` (parity/rollback only) | Student | `id` (`session_id` accepted as compatibility alias) | AuthProvider, `/sessions/{id}`, signed audio, PDF export; requests/audio/blob URLs cleaned on unmount | L | Canonical persisted session result; fail-visible response lookup, sealed-mock state, grammar/pronunciation detail, pending-vocab + KP widgets; Next player/history use canonical route while Legacy player stays on stable file URL |
| `/full-test` | `app/(authed-full-test)/full-test/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-09 | `pages/full-test.html` (parity/rollback only) | Student | none | AuthProvider, `/api/mock-exams`; abort on unmount/account switch | S | Authenticated mock-exam launcher; canonical backend enforces published/window/cohort and one-live-sitting rules; soft-navigation safe |
| `/vocabulary/hub` | `app/(authed-vocabulary-hub)/vocabulary/hub/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-09 | `pages/vocabulary.html` (parity/rollback only) | Student | hash: `vocab-topics`, `flashcards`, `exercises` | AuthProvider, `/api/student/home-summary`, `/auth/me`, `/api/vocabulary/categories`; abort on unmount/account switch | M | Hub từ vựng học viên; React sở hữu dashboard/topic picker và lifecycle mount cho hai domain module; default-deny feature flags; soft-navigation safe. Tên `/vocabulary/hub` là CUỐI CÙNG vì `/vocabulary` thuộc WIKI CÔNG KHAI (Q3). |
| `/mock/result` | `app/(authed-mock-result)/mock/result/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-09 | `pages/mock-result.html` (parity/rollback only) | Student | `sitting` | AuthProvider, `/api/mock-exams/sittings/{id}/result`; abort on unmount/account/query change | M | Phiếu điểm TRF; canonical backend seals result until released and owns final bands/gap/retest truth; soft-navigation safe |
| `/speaking/result` | `app/(authed-speaking-result)/speaking/result/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-08 | `pages/speaking-result.html` (parity/rollback only) | Student | `sitting` | AuthProvider, `/api/mock-exams/sittings/{id}/result`; abort on unmount/account switch | S | Nhận xét Speaking của giáo viên chấm; authored content React-escaped; soft-navigation safe |
| `/full-test-result` | `app/(authed-full-test-result)/full-test-result/page.tsx` — native React behavior 2026-08-10; `/pages/full-test-result.html` remains rollback target | `pages/full-test-result.html` (parity/rollback only) | Student | `p1`; `p2/p3` legacy compatibility; `session_id` accepted as Part 1 alias | AuthProvider, canonical `/sessions/{p1}/full-test-summary`, persisted pronunciation, PDF export; request/blob cleanup on unmount | L | Server resolves persisted `full_test_attempt_id`, validates owned Part 1/2/3 + exact 9/1/5 questions, suppresses sealed/pending/failed scores, and never reruns pronunciation AI on page load |

### Writing

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/writing` | — | `pages/writing-dashboard.html` | Student | none | localStorage (theme), sessionStorage (state), Supabase session | M | Writing hub; assignment list + status + cohort view |
| `/writing/dashboard` | rewrite ĐÃ GỠ ở #950; `/pages/writing-dashboard.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-writing)/writing/dashboard/page.tsx` — CUTOVER 2026-08-05 | Student | none | localStorage (theme), account/assignment-keyed sessionStorage submit receipt | M | Assignment overview; exact-text UUID submit, side-effect-free canonical readback after ambiguous response and shared Legacy/Next resume contract (migration 207) |
| `/writing/result` | rewrite ĐÃ GỠ; `/pages/writing-result.html` giữ làm rollback + parity | `app/(authed-writing-result)/writing/result/page.tsx` — CUTOVER 2026-08-12 | Student | `id`, legacy `essay_id` | localStorage (theme), Supabase session, Writing API | L | Task 1/Task 2 result + instructor feedback + regrade request + DOCX export |

### Reading

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/reading` | — | — | — | — | — | — | Historical phantom inventory row: `pages/reading.html` never existed. Canonical learner entry is `/reading/vocab`; this is not a migration target. |
| `/reading/exam` | — | `pages/reading-exam.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (exam state, answers, timing), fetch API | XL | Full 3-passage IELTS reading; 2613 LOC reading-exam.js; local/session storage for persistence |
| `/reading/exam/session` | Stable Next dark route; admission remains legacy until Gate E cutover | `app/(authed-reading-player)/reading/exam/session/page.tsx` | Student for `test_id`; anonymous capability for `share` | `test_id` or `share`; optional `sitting_id`, `mock_embed`, `from`, `class_item` | AuthProvider, canonical Reading boot/attempt/answer/submit APIs, server-anchored timer, debounced retrying autosave, MockHook | XL | Native React player for all 16 Reading question types; restores canonical in-progress attempts and answers, submits the complete in-memory answer set, preserves password/share capability headers, and enters the native review route after submit. Failure/coexistence evidence remains pending before admission can move. |
| `/reading/skill` | `/pages/reading-skill.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/skill/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student | filters: `difficulty`, `skill` | AuthProvider; `/api/reading/skill`; abort on filter/account switch and unmount | L | Filterable L2 skill library; account-keyed, React-escaped and soft-navigation safe |
| `/reading/skill/[slug]` | `/pages/reading-skill-exercise.html?slug=…` retained as rollback/parity target | `app/(authed-reading)/reading/skill/[slug]/page.tsx` — native React 2026-08-15 | Student | path `slug` | AuthProvider; canonical GET + per-question POST check; sanitized Markdown; glossary/feedback helpers | M | Shared native detail workspace; server-side instant grading, strict answer-key leak guard, retryable check, accessible panes/lightbox and account/slug stale-state isolation. |
| `/reading/vocab` | `/pages/reading-vocab.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/vocab/page.tsx` — CUTOVER 2026-08-05; native React behavior 2026-08-09 | Student | none | AuthProvider; `/api/reading/vocab`; abort on filter/account switch and unmount | M | Filterable L1 reading library; account-keyed, React-escaped and soft-navigation safe |
| `/reading/vocab/[slug]` | `/pages/reading-vocab-passage.html?slug=…` retained as rollback/parity target | `app/(authed-reading)/reading/vocab/[slug]/page.tsx` — native React 2026-08-15 | Student | path `slug` | AuthProvider; canonical GET + per-question POST check; sanitized Markdown; glossary/feedback helpers | M | Shared native detail workspace; server-side instant grading, strict answer-key leak guard, retryable check, accessible panes/lightbox and account/slug stale-state isolation. |
| `/reading/review` | `/pages/reading-review.html` retained as rollback/parity target | `app/(reading-review)/reading/review/page.tsx` + `reading-review-workspace.tsx` — native React 2026-08-16 | Student, anonymous capability, or admin preview | `attempt_id`; optional `anon`, `from`, `sitting`; admin preview uses `admin_test_id` | AuthProvider; submitted-only canonical review API; anonymous capability header; sanitized Markdown; KP micro-check + feedback helpers; abort/stale-response guard | L | Native post-exam answer-key review. Preserves score/skill truth, original/translation panes, source locate, rich solution/stepper, feedback, sealed-attempt backend gate and honest no-score admin preview. Legacy HTML remains rollback-only until Gate F. |
| `/reading/mini-test` | `/pages/reading-mini-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/mini-test/page.tsx` + `reading-mini-test-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (mini test state) | M | 1-passage reading drill; authenticated fail-close; aborts stale filter/account requests; explicit `test_type=mini` |
| `/reading/test` | `/pages/reading-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/test/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student | filter: `module`; request pins `test_type=full` | AuthProvider; `/api/reading/test`; abort on filter/account switch and unmount | S | Full-test library; account-keyed, React-escaped and soft-navigation safe |

### Listening

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/listening` | `/pages/listening.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/page.tsx` + `listening-landing-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | none | AuthProvider; `/api/listening/overview`; abort on account switch and unmount | S | Count-driven Listening hub; runnable-mode library guard; explicit loading and generic API fallback; React-escaped và soft-navigation safe |
| `/listening/tests` | `/pages/listening-tests.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/tests/page.tsx` + `listening-tests-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | none | AuthProvider; paged `/api/listening/tests?test_type=full`; abort on account switch and unmount | S | Cambridge full tests shelf; `submitted` mới là đã làm, total attempts chỉ là activity; account-keyed, React-escaped và soft-navigation safe |
| `/listening/practice` | `/pages/listening-practice.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/practice/page.tsx` + `listening-practice-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | hash `trap` / `section` / `curated` | AuthProvider; overview + paged practice-group reads; per-tab cache; abort on account/tab switch and unmount | M | Luyện nhanh; canonical count-driven tabs; trap grouping; `submitted` mới là hoàn thành, total attempts chỉ là activity; React-escaped và soft-navigation safe |
| `/listening/test/session` | Stable Next dark route; admission remains legacy until Gate E cutover | `app/(authed-listening-player)/listening/test/session/page.tsx` | Student; MockHook may seal access inside an active mock sitting | `test_id`; optional `attempt_id`, `sitting_id`, `mock_embed`, `from`, `class_item` | AuthProvider, canonical Listening test/attempt/answer/submit APIs, server-anchored audio position, debounced retrying autosave, MockHook | XL | Native React player for full, mini, drill, and practice Listening tests; restores canonical in-progress attempts and answers, blocks submit while any answer save remains unresolved, preserves single-play/no-scrub rules for full tests, and enters the native review route after submit. Dictation remains a separate post-result drill-down. Failure/coexistence evidence remains pending before admission can move. |
| `/listening/mcq` | `/pages/listening-mcq.html` remains the direct rollback page | `app/(authed-listening)/listening/(standalone-exercises)/mcq/page.tsx` + shared `listening-standalone-workspace.tsx` | Student | required `content_id` | AuthProvider; parallel abortable content/exercise reads; canonical attempt POST; audio playback | M | Native React MCQ; server-filtered answer keys, controlled four-option answers, first-attempt-safe score truth, no automatic mutation replay |
| `/listening/gist` | `/pages/listening-gist.html` remains the direct rollback page | `app/(authed-listening)/listening/(standalone-exercises)/gist/page.tsx` + shared `listening-standalone-workspace.tsx` | Student | required `content_id` | AuthProvider; parallel abortable content/exercise reads; canonical attempt POST; audio playback | M | Native React main-idea response; AI versus keyword-fallback truth, explicit official-first-attempt copy, no automatic mutation replay |
| `/listening/tf` | `/pages/listening-tf.html` remains the direct rollback page | `app/(authed-listening)/listening/(standalone-exercises)/tf/page.tsx` + shared `listening-standalone-workspace.tsx` | Student | required `content_id` | AuthProvider; parallel abortable content/exercise reads; canonical attempt POST; audio playback | M | Native React T/F/NG; controlled answers, server-canonical expected values after submit, no automatic mutation replay |
| `/listening/dictation` | `/pages/listening-dictation.html` remains the direct rollback page | `app/(authed-listening)/listening/(standalone-exercises)/dictation/page.tsx` + `listening-standalone-dictation.tsx` | Student | required `content_id` | AuthProvider; abortable student-safe dictation boot; canonical per-segment attempt POST; clipped audio playback | L | Native segmented standalone dictation. Boot withholds content/segment transcripts; reference text is reconstructed only from the validated grade diff after each submission. Controlled answer/iterator, explicit first-attempt truth and no automatic mutation replay. Distinct from the test-linked core player. |
| `/listening/test-dictation` | `/listening/dictation/session` is the native dark-route successor; admission remains legacy pending Gate E | `pages/listening-test-dictation.html` remains the production owner and rollback target | Student | `test_id`, `section` | Legacy auth/API bridge; audio playback | M | Legacy production route while coexistence evidence is collected |
| `/listening/dictation/session` | Stable Next dark route; admission remains legacy until Gate E cutover | `app/(authed-listening-dictation)/listening/dictation/session/page.tsx` + `listening-dictation-session.tsx` | Student | `test_id`, `section` | AuthProvider; server-canonical grade; account/test/section-scoped durable completion receipt in localStorage; audio playback | M | Native route owns picker, sentence timing/hints, word diff, canonical idempotent completion read-back, recovery and content flags |
| `/listening/skills` | `/pages/listening-skills.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/skills/page.tsx` + `listening-skills-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `skill_id` (drill type) | AuthProvider; paged `/api/listening/tests?test_type=drill`; abort on account switch and unmount | M | Eleven skill ladders; L/T sorting; nav/filter/summary native; `submitted` mới là đã luyện; static SVG, React-escaped và soft-navigation safe |
| `/listening/browse` | `/pages/listening-browse.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/browse/page.tsx` + `listening-browse-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | filters: `accent_tag`, `cefr_level`, `ielts_section` | AuthProvider; paged `/api/listening/content`; abort on filter/account switch and unmount | S | Listening content catalog; backend-gated exercise modes; missing/malformed lookup is visible, not no-data; React-escaped và soft-navigation safe |
| `/listening/review` | `/pages/listening-review.html` retained as rollback/parity target | `app/(authed-listening-review)/listening/review/page.tsx` + `listening-review-workspace.tsx` — native React 2026-08-16 | Student or admin preview | `attempt_id`; optional `from`, `sitting`; admin preview uses `admin_test_id` | AuthProvider; submitted-only canonical review API; shared full-track audio player; transcript anchors; feedback helpers; abort/stale-response/account guard | M | Native post-test answer review. Preserves score/band floor, wrong/all/correct filters, K1–K8 weakness summary, section transcript, real audio-window seek, honest no-score admin preview and sealed-attempt backend gate. Legacy HTML remains rollback-only until Gate F. |
| `/listening/analytics` | `/pages/listening-analytics.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/analytics/page.tsx` + `listening-analytics-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | filter: `range` (`7d`, `30d`, `all`) | AuthProvider; `/api/listening/analytics`; abort on range/account switch and unmount | M | Performance summary + 14-day trend; canonical weighted aggregates, backend-owned weakest mode, generic errors, React-escaped and soft-navigation safe |
| `/listening/mini-test` | `/pages/listening-mini-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/mini-test/page.tsx` + `listening-mini-test-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `test_id`, `attempt_id` | AuthProvider; paged `/api/listening/tests?test_type=mini`; abort on account switch and unmount | M | 1-section listening drill; variable score không gắn `/40`; `submitted` mới là đã luyện, total attempts chỉ là activity; account-keyed, React-escaped và soft-navigation safe |

### Tài khoản học viên

Bề mặt hồ sơ/tài khoản. Tách riêng vì rà quyền và rollback đi theo MIỀN:
để `/profile` nằm trong "Exercises & Quizzes" chỉ vì nó được chèn cạnh
`/exercises` là làm lệch đúng lượt rà đó (bot bắt ở #958).

| Route | Alias / redirect | Tệp sở hữu | Ai xem được | Tham số | Trạng thái phía client | Kích thước | Ghi chú |
|---|---|---|---|---|---|---|---|
| `/profile` | `/pages/profile.html` → 307 sang `/profile` (bản legacy ĐÃ gỡ khi cutover pilot 3) | `app/(authed)/profile/page.tsx` — CUTOVER (pilot 3) | Student | none | localStorage (theme), Supabase session | M | Hồ sơ học viên |
| `/my-class` | `/pages/my-class.html` remains rollback/parity target | `app/(authed-my-class)/my-class/page.tsx` + `my-class-workspace.tsx` — native React ownership 2026-08-16 | Student | none | AuthProvider; canonical `/api/class/me`; `/api/class/assignments/{item}/start`; runtime core-player admission; sanitized Markdown; visibility-aware deadline reconciliation | L | Native class workspace with fail-visible block degradation, canonical progress/list contract checks, one-operation start lock, nearest-deadline refresh, 14-day rhythm and lesson attachments. All canonical inbound links use `/my-class`; Legacy HTML remains rollback-only until Gate F. |

### Vocabulary

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/vocabulary` | `public/vocabulary.html` và `public/pages/vocab-article.html` giữ làm rollback + parity | `app/(public-content)/vocabulary/page.tsx` — CUTOVER 2026-08-15 | **Public** | `cat`, `slug` (identity kép; tùy chọn) | localStorage (theme), sessionStorage analytics id; public server fetch `/api/vocabulary/categories` + `/api/vocabulary/articles/{cat}/{slug}`; client fetch khi đổi từ, Web Audio/Speech, anonymous feedback | M | **Wiki từ vựng CÔNG KHAI** — React sở hữu master/detail, lọc, deep-link, audio fallback, báo lỗi và analytics; strict canonical normalizers fail closed. SỞ HỮU tên `/vocabulary` (Q3); trang học viên ở `/vocabulary/hub`. |
| `/vocabulary/exam` | `/pages/vocab-exam.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-vocab-exam)/vocabulary/exam/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student shell; endpoint public | none | `/api/vocabulary/exam`; abort on unmount | S | Read-only AWL/TOEIC/THPT list launcher; authored metadata React-escaped; opens shared flashcard player; soft-navigation safe |
| `/vocabulary/practice` | `app/(authed-vocab-practice)/vocabulary/practice/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-09 | `pages/vocab-practice.html` (parity/rollback only) | Student | none | AuthProvider, `/api/quiz/banks?skill_area=vocab`; abort on unmount/account switch | S | Vocabulary Quick-Check bank picker; authored metadata React-escaped; soft-navigation safe |
| `/pages/vocab-article.html` | rollback-only standalone; không có clean route riêng | canonical detail nằm tại `/vocabulary?cat=<category>&slug=<slug>` | Public | `cat`, `slug` | legacy `vocabulary.js`; cùng `/api/vocabulary/articles/{cat}/{slug}` | S | Hàng `/vocabulary/article?word_id&source` cũ là phantom contract: file thật luôn dùng `cat` + `slug`. Giữ artifact đến Gate F nhưng mọi inbound link đã về owner `/vocabulary`. |

### Exercises & Quizzes

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/grammar/exercises` | `app/(public-content)/grammar/exercises/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-08 | `pages/grammar-exercises.html` (parity/rollback only) | Public | none | `/api/grammar/exercises`; abort on unmount | M | Grammar quiz launcher; authored bank metadata React-escaped; soft-navigation safe |
| `/d1-exercise` | `/pages/d1-exercise.html` giữ làm rollback | `app/(authed-d1-exercise)/d1-exercise/page.tsx` — native React behavior 2026-08-16 | Student | `session` (D1 session UUID, optional resume) | AuthProvider; `/auth/me`; `/api/exercises/d1/sessions*`; account-keyed localStorage resume pointer; idempotent attempt ACK gate | M | D1 fill-blank vocabulary player; immutable snapshot, resume, canonical completion summary và local-only wrong-answer revision |
| `/course-exercises` | — (không có bản legacy) | `app/(authed)/course-exercises/page.tsx` — route CHỈ CÓ ở Next | Student | none | localStorage (theme), Supabase session | M | Bài tập theo giáo trình |
| `/exercises` | `/pages/exercises.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-exercises)/exercises/page.tsx` — CUTOVER 2026-08-06; lifecycle-safe Next orchestration 2026-08-09 | Student | none | AuthProvider; `/auth/me`; retained `vocab-modules/exercises.js` through shared mount/unmount adapter; abort on unmount | M | Feature-gated exercise hub; account-keyed and soft-navigation safe |
| `/quiz` | `app/(authed-quiz-player)/quiz/page.tsx` — CUTOVER 2026-08-15; native React behavior | `pages/quiz.html` (parity/rollback only) | Student | `bank` (bank UUID), or `skill_area` + `topic_id` (optional picker scope) | AuthProvider, `/api/quiz/banks*`, `/api/quiz/sessions*`; keyed/abortable bank reads; serialized retry outbox + keepalive; in-memory session review | L | Adaptive Quick-Check player; choice/text/boolean/syllable, non-destructive review, reset reconciliation and truthful save warning |
| `/quiz/progress` | `app/(authed-quiz-progress)/quiz/progress/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-08 | `pages/quiz-progress.html` (parity/rollback only) | Student | `skill_area` (optional: `vocab` or `grammar`) | AuthProvider, `/api/quiz/progress`, `/api/quiz/mistakes`; abort on unmount/account switch | M | Quiz attempt history + stats; soft-navigation safe |
| `/flashcards` | `/pages/flashcards.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-flashcards)/flashcards/page.tsx` — CUTOVER 2026-08-06; lifecycle-safe Next orchestration 2026-08-09 | Student | none | AuthProvider; retained `vocab-modules/flashcards.js` through shared mount/unmount adapter; abort on unmount | M | Flashcard stack browser/create/delete; account-keyed and soft-navigation safe |
| `/flashcard-study` | `app/(flashcard-study)/flashcard-study/page.tsx` | `pages/flashcard-study.html` (rollback only) | Hybrid public/student | `stack=wiki:<category>`, `stack=examlist:<slug>`, `stack=auto:<kind>` or stack UUID | public marks in localStorage; personal SRS is server-ACK-gated and idempotent by `client_review_id` | M | Native React player for all three modes; legacy artifact retained until Gate F |
| `/exam` | `/pages/exam.html` giữ làm parity/rollback | `app/(authed-exam)/exam/page.tsx` — native React ownership 2026-08-17 | Student | `id` (exam UUID); `source` (optional list filter) | AuthProvider; `/api/exams*`; abortable list/detail reads; account/generation stale guards; serialized submit; caller-owned review retry | M | Multi-source standalone `mcq_single` player (TOEIC Part 5 first); answer/solution stay hidden until submitted-attempt review; KP stepper + micro-check are native React. Legacy did not persist answers despite the former ledger claim. |

### Instructor

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/instructor` | `/pages/instructor/index.html` remains rollback target | `app/(authed-instructor)/instructor/page.tsx` — native React ownership 2026-08-16 | Instructor | `as_instructor` (admin-only, audited by backend) | AuthProvider + canonical `/auth/me`; owner-scoped `/instructor/*`; account/request-keyed stale guard; canonical reload after mutations | L | Native roster, student summary, cohorts, enrollment codes, prompt/assignment matrix and review claim. Admin impersonation propagates through the single path helper; instructor surface never calls admin APIs. Grade detail remains on the legacy stable URL until its own route migrates. |
| `/instructor/grade` | `/pages/instructor/grade.html` remains rollback target | `app/(authed-instructor-grade)/instructor/grade/page.tsx` — native React ownership 2026-08-16 | Instructor | `essay_id`; optional `review_id`; `as_instructor` (admin-only, audited by backend) | AuthProvider + canonical `/auth/me`; owner-scoped essay/version/active-review reads; note PATCH; essay-bound exactly-once review delivery; regrade/revoke canonical readback | L | Native Writing review workspace with shared learner renderers, explicit version budget, accessible regrade/revoke confirmations, mutation lock after ambiguous readback and truthful degraded queue/version states. Dashboard and compare links now return here; legacy HTML remains rollback-only until Gate F. |
| `/instructor/compare` | `/pages/instructor/compare.html` remains rollback target | `app/(authed-instructor-compare)/instructor/compare/page.tsx` — native React ownership 2026-08-16 | Instructor | `essay_id`; `as_instructor` (admin-only, audited by backend) | AuthProvider + canonical `/auth/me`; owner-scoped live-version GET and compose POST; shared learner `WritingRenderers`; canonical readback after mutation | M | Native per-criterion version comparison and composed-feedback preview. Full canonical `feedback_json` restores truthful base-derived overview/mistakes/improved-essay preview; selection copies whole criterion objects and backend recomputes Overall. Legacy grade now links here; legacy compare remains rollback-only until Gate F. |

### Admin — Main & System

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin` | `/pages/admin/index.html` remains rollback target; `/admin.html`, `/pages/admin.html` and `/pages/admin/dashboard/index.html` are legacy redirects | `app/(authed-admin-overview)/admin/page.tsx` — native React ownership 2026-08-12 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; `/admin/dashboard/overview`, `/admin/dashboard/trends`, `/admin/overview`; visibility-aware refresh | M | Native operational + content dashboard; account-keyed fail-closed state, stale-response guard, safe internal activity links |
| `/admin/system` | `/pages/admin/system/index.html` remains rollback target | `app/(authed-admin-system)/admin/system/page.tsx` — native React ownership 2026-08-12 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme) | S | Read-only hub linking AI usage + alerts; account-keyed fail-closed admin state |
| `/admin/system/alerts` | `/pages/admin/system/alerts.html` remains rollback target | `app/(authed-admin-system)/admin/system/alerts/page.tsx` — native React ownership 2026-08-12 | Admin | client scope `all`, `sessions`, `grading` | AuthProvider + backend-owned `/auth/me` role guard; canonical read-only `/admin/alerts?limit=30`; account-keyed stale-response guard | M | Native read-only operational triage for session errors and deduplicated response grading failures; truthful partial-identity/malformed states and links to real Speaking sessions. Backend exposes no dismissal mutation. |
| `/admin/system/ai-usage` | `/pages/admin/system/ai-usage.html` remains rollback target | `app/(authed-admin-system)/admin/system/ai-usage/page.tsx` — native React ownership 2026-08-12 | Admin | `days=1|7|30|90|all`; absent defaults to 7 days | AuthProvider + backend-owned `/auth/me` role guard; canonical read-only `/admin/ai-usage`; account-keyed stale-response guard | M | Native estimated-cost workspace with all backend service keys, per-user attribution, truthful 10k safety-cap/truncation metadata and malformed states; `days=all` remains URL-stable while the backend receives no `days` filter; no chart or billing precision is invented. |
| `/admin/students` | `/pages/admin/classes/index.html?tab=students` remains rollback workspace | `app/(authed-admin-students)/admin/students/page.tsx` — native directory ownership 2026-08-12 | Admin | server-backed client search | AuthProvider + backend-owned `/auth/me` role guard; canonical `/admin/students`, active `/admin/cohorts`, student/writing summaries; canonical reload after every mutation | L | Native roster directory: truthful class/account state, create/edit with nullable clears, CSV import errors, bulk assignment and partial-failure profile; hard delete deliberately not exposed |
| `/admin/classes` | `/pages/admin/classes/index.html` remains rollback target | `app/(authed-admin-classes)/admin/classes/page.tsx` — native directory ownership 2026-08-12 | Admin | client filters `status`, `course`, `search` | AuthProvider + backend-owned `/auth/me` role guard; canonical `/admin/cohorts?with_rollup=true` + `/admin/courses`; canonical reload after every mutation | M | Native class directory: truthful roster/course failures, create/edit, soft archive/restore |
| `/admin/classes/[cohortId]` | `/pages/admin/classes/index.html?cohort_id=…` remains the URL-only rollback target | `app/(authed-admin-classes)/admin/classes/[cohortId]/page.tsx` — native detail + homework + assignment-centric marking + student-centric cross-assignment work-history ownership 2026-08-12 | Admin | `tab=roster|progress|lessons|homework`; optional `student_id`, `assignment_id` deep-links | AuthProvider + backend-owned `/auth/me` role guard; canonical cohort members/courses, progress, lessons, per-student work, assignment reconciliation/catalog/action-log/tally/attempt-report/student-report/writing reads; canonical reload after every roster, class, lesson, assignment or return-work mutation | XL | Native class profile, roster, four-skill progress, lesson timeline, complete homework lifecycle, per-student history across every assigned item, and native per-assignment submission workspace: tally, effort/stalled/unfinished-writing, course answer report with canonical session/revision trail, writing review, Speaking artifact link and audited return-work. Legacy is not linked from the native flow and remains only as the URL rollback target. |
| `/admin/users` | `/pages/admin/users/index.html` remains rollback target | `app/(authed-admin-users)/admin/users/page.tsx` — native React ownership 2026-08-12 | Admin | `tab=codes` (access-code view; default is users) | AuthProvider + backend-owned `/auth/me` role guard; canonical users/cohorts/access-code APIs; account-keyed stale-response guards | L | User roles, student conversion, generate-and-assign, access-code ownership/quota and code lifecycle; every mutation reconciles with canonical GET before success state |
| `/admin/access-codes` | Temporary redirect to `/admin/users?tab=codes`; `/pages/admin/access-codes/index.html` remains the legacy consolidation alias | — | Admin | — | — | — | Clean alias into the native access-code tab; temporary redirect keeps rollback safe |
| `/admin/instructors` | `/pages/admin/instructors.html` remains rollback target | `app/(authed-admin-instructors)/admin/instructors/page.tsx` — native React ownership 2026-08-12 | Admin | client search `q` | AuthProvider + backend-owned `/auth/me` role guard; canonical read-only `/admin/instructors`; sanctioned audited drill-down to legacy instructor workspace | M | Native read-only instructor oversight: canonical owner-derived students/prompts/delivered essays, distinct regraded-essay vs regrade-event counts, all-version Writing token/cost estimate, malformed-state warning and responsive cards. No cohort-assignment mutation exists on this endpoint. |
| `/admin/usage` | `/pages/admin/usage/index.html` remains rollback target | `app/(authed-admin-usage)/admin/usage/page.tsx` — native React ownership 2026-08-12 | Admin | `code_id`; client `q`, `sort` | AuthProvider + backend-owned `/auth/me` role guard; canonical read-only `/admin/usage/users` or `/admin/access-codes/{id}/usage`; account/code keyed stale-response guard | M | Native per-account and active-access-code rollup for Speaking session count, last activity and logged AI cost; paged past PostgREST caps, degraded metrics remain unknown, not zero. This is not DAU/MAU analytics. |
| `/admin/foot-traffic` | `/pages/admin/foot-traffic/index.html` remains rollback target; `frontend/vercel.json` has no rewrite shadowing the native route | `app/(authed-admin-foot-traffic)/admin/foot-traffic/page.tsx` — native React ownership 2026-08-12 | Admin | `route`, `from`, `to`; legacy `date_range` bookmarks fall back to 30 days | AuthProvider + backend-owned `/auth/me` role guard; canonical typed `/admin/analytics/foot-traffic`; snapshot/composite-keyset pagination | M | Native UTC event-traffic dashboard with exact-route filter, inclusive date range, daily trend, truthful partial/unavailable states and account/filter-keyed stale-response guard |
| `/admin/feedback` | `/pages/admin/feedback/index.html` remains rollback target | `app/(authed-admin-feedback)/admin/feedback/page.tsx` — native React ownership 2026-08-12 | Admin | `status=new|resolved|all` (default `new`), `type=rating|report|flag`, `skill=reading|listening|vocabulary` | AuthProvider + backend-owned `/auth/me` role guard; canonical typed GET/PATCH `/api/admin/feedback`; account/filter-keyed stale-response guard | M | Native learner-feedback triage grouped by `(skill, test_id)`, snapshot/keyset reads past PostgREST caps, truthful partial/unavailable states, redacted anonymous capability identity and canonical GET reconciliation after every status mutation |
| `/admin/error-logs` | `/pages/admin/error-logs/index.html` remains rollback target | `app/(authed-admin-error-logs)/admin/error-logs/page.tsx` — native React ownership 2026-08-12 | Admin | client filters `dismissed`, `level`, `source`; rollback measurement `route`, `match`, `window_minutes` | AuthProvider + backend-owned `/auth/me` role guard; canonical error-log/ADR-012 APIs; server `limit/offset` pagination | L | Error triage + dismiss/undo + dogfood test; migration and frozen rollback metrics; account-keyed fail-closed state |
| `/admin/dashboard` | (legacy path redirect to `/admin` via vercel.json line 50) | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/dashboard/reading-attempts` | `/pages/admin/dashboard/reading-attempts.html` remains rollback target | `app/(authed-admin-reading-attempts)/admin/dashboard/reading-attempts/page.tsx` — native React ownership 2026-08-13 | Admin | `days=7|30|90`; absent defaults to 30 | AuthProvider + backend-owned `/auth/me` role guard; canonical typed `/admin/dashboard/reading-attempts`; account/window-keyed stale-response guard | M | Native frozen-snapshot Reading attempt analytics with exact authenticated vs approximate anonymous semantics, truthful complete/partial/unavailable states, malformed-row exclusion, accessible distributions and responsive tables |
| `/admin/reading/content` | `/pages/admin/reading/content.html` remains rollback target | `app/(authed-admin-reading-content)/admin/reading/content/page.tsx` — native React ownership 2026-08-14 | Admin | client `library`; server `limit`, `offset` | AuthProvider + backend-owned `/auth/me` role guard; typed canonical `/admin/reading/content*`; profile/filter-keyed stale-response guard; canonical GET reconciliation after every write | L | Native Reading library manager with mandatory dry-run, single/bundle import, exact mixed-source pagination, L1/L2 delete, attempt-safe L3 archive/delete, exam-only, password lock and one-time share-token controls; L3 rows open native paper QA |

### Admin — Grammar

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/grammar` | `/pages/admin/grammar/index.html` remains rollback target | `app/(authed-admin-grammar)/admin/grammar/page.tsx` — native React ownership 2026-08-13 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme/sidebar) | S | Native file-based content-operations hub; canonical links to learner preview, three native child workspaces and the shared legacy Grammar exercise console; no content mutation or invented metrics |
| `/admin/grammar/articles` | `/pages/admin/grammar/articles.html` remains rollback target | `app/(authed-admin-grammar-articles)/admin/grammar/articles/page.tsx` — native React ownership 2026-08-13 | Admin | `category`, `search`; absent values show the full library | AuthProvider + backend-owned `/auth/me` role guard; typed GET `/admin/grammar/articles` + per-article preview; account/filter-keyed stale-response guard | M | Native read-only Markdown inventory with canonical clean student links, explicit per-source analytics availability, sandboxed inline preview and responsive table/cards; no article mutation |
| `/admin/grammar/analytics` | `/pages/admin/grammar/analytics.html` remains rollback target | `app/(authed-admin-grammar-analytics)/admin/grammar/analytics/page.tsx` — native React ownership 2026-08-13 | Admin | `days` (7/14/30/90; invalid values normalize to 7) | AuthProvider + backend-owned `/auth/me` role guard; typed GET `/admin/grammar/analytics`; profile/window-keyed stale-response guard | M | Read-only canonical snapshot with complete/unavailable state per views, recent activity and saves; recent activity is learner–article records whose last view falls in the window, not event views |
| `/admin/grammar/recommend-test` | `/pages/admin/grammar/recommend-test.html` remains rollback target | `app/(authed-admin-grammar-recommend)/admin/grammar/recommend-test/page.tsx` — native React ownership 2026-08-13 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; typed POST `/admin/grammar/recommend-test`; stale-response guard | M | No-persistence recommendation lab that exposes matched, below-threshold and draft-suppressed production outcomes plus canonical article/anchor destination |

### Admin — Speaking

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/speaking` | `/pages/admin/speaking/index.html` remains rollback target | `app/(authed-admin-speaking)/admin/speaking/page.tsx` — native React ownership 2026-08-13 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme/sidebar) | S | Native read-only operations hub; links to the native Sessions and Topics workspaces, canonical System operations and learner preview without inventing metrics or mutations |
| `/admin/speaking/sessions` | `/pages/admin/speaking/sessions.html` remains rollback target | `app/(authed-admin-speaking-sessions)/admin/speaking/sessions/page.tsx` — native React ownership 2026-08-13 | Admin | `email` (exact) or User ID, `mode`, `status`, `error`, `from`, `to`, `session` | AuthProvider + backend-owned `/auth/me` role guard; canonical typed `/admin/sessions*`; account/filter-keyed stale-response guards and offset pagination | L | Native session grading audit with safe audio replay, deep-linked accessible detail, server-side exact-email lookup, repair-failed-only and explicit force-full regrade, rebuild summary, truthful enrichment warnings and canonical detail/list readback after every mutation |
| `/admin/speaking/topics` | `/pages/admin/speaking/topics.html` remains rollback target | `app/(authed-admin-speaking-topics)/admin/speaking/topics/page.tsx` — native React ownership 2026-08-13 | Admin | `part`, `q`, `topic` | AuthProvider + backend-owned `/auth/me` role guard; canonical typed `/admin/topics*`; account/request-keyed stale-response guards | L | Native topic/question library with responsive inventory + detail workspace, safe missing-only generation, explicit destructive rotation/delete dialogs, bulk create/generate/delete, full Part/cue-card editing, truthful metadata/query failure states and canonical GET reconciliation after every mutation |

### Admin — Writing

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/writing` | `/pages/admin/writing/index.html` remains rollback target | `app/(authed-admin-writing)/admin/writing/page.tsx` — native React ownership 2026-08-13 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme/sidebar) | S | Native read-only workflow hub; truthful NATIVE/MIGRATING ownership labels, canonical learner preview and ten operational destinations without fake metrics or mutations |
| `/admin/writing/new` | `/pages/admin/writing/new.html` remains rollback target; old flat alias redirects to legacy file | `app/(authed-admin-writing-new)/admin/writing/new/page.tsx` — native React ownership 2026-08-13 | Admin | optional `student_id` preset | AuthProvider + backend-owned `/auth/me`; canonical students, extract-text, prompt-image and essay-create APIs; account-keyed ambiguous-submit receipt | L | Native independent-grading composer (not assignment fan-out): review-before-submit, `.docx/.txt` extraction, Task 1 Academic image, exact essay/job ACK; ambiguous POST is never replayed because the endpoint has no idempotency key; direct legacy rollback retained |
| `/admin/writing/queue` | `/pages/admin/writing/queue.html` remains rollback target | `app/(authed-admin-writing-queue)/admin/writing/queue/page.tsx` — native React ownership 2026-08-13 | Admin | `status` (`grading`, `graded`, `reviewed`, `delivered`, `all`), `cohort_id`, `overdue=1`, `mocklane=1`, `embed=1` | AuthProvider + backend-owned `/auth/me` role guard; canonical Writing/cohort/mock APIs; sessionStorage gradeQueue handoff; 8s visible-tab polling only in grading lane | L | Native six-lane queue; malformed/stale-state truth, reviewed-only bulk delivery, Mock word-count decisions, canonical GET readback after every mutation, responsive cards; direct legacy HTML retained for rollback |
| `/admin/writing/grade` | `/pages/admin/writing/grade.html` remains rollback + parity | `app/(authed-admin-writing-grade)/admin/writing/grade/page.tsx` — native React behavior 2026-08-12 | Admin | `id`, legacy `essay_id`; optional `embed`, `mocklane` | AuthProvider + backend-owned `/auth/me` role guard; canonical Writing/Instructor APIs; sessionStorage queue context; clipboard + DOCX blob | XL | 13-section edit/draft workflow; reviewed→delivered→revoke; regrade/rating; instructor ownership; account-keyed and duplicate-mutation guarded |
| `/admin/writing/assignments` | `/pages/admin/writing/assignments.html` remains rollback target | `app/(authed-admin-writing-assignments)/admin/writing/assignments/page.tsx` — native React ownership 2026-08-13 | Admin | `status=pending\|in_progress\|submitted\|graded\|delivered`, `cohort`, client `q`; `assign_student` deep-link | AuthProvider + backend-owned `/auth/me` role guard; canonical Writing assignment/prompt/student/cohort APIs; migration 206 idempotent create + receipt-wide verification RPCs; account/filter-keyed stale guard | L | Native grouped register + individual/cohort composer; client request UUID survives ambiguous POST/reload, verifies the complete immutable assignment-ID set before clearing its receipt, then reloads the canonical list; capped/malformed/source-failure truth; direct legacy HTML retained for rollback |
| `/admin/writing/prompts` | `/pages/admin/writing/prompts.html` remains rollback target | `app/(authed-admin-writing-prompts)/admin/writing/prompts/page.tsx` — native React ownership 2026-08-13 | Admin | `task_type`, `difficulty`, `status=active\|archived`, `visibility=all\|student\|exam`, client `q` over loaded ≤500 | AuthProvider + backend-owned `/auth/me` role guard; canonical Writing Prompt API + Supabase Storage upload; account/filter-keyed stale guard; visible-tab analysis polling | L | Native prompt CRUD, archive/restore, student-vs-exam reservation, Task 1 image lifecycle and answer-key review with image fingerprint concurrency guard; direct legacy HTML retained for rollback |
| `/admin/writing/regrade-requests` | `/pages/admin/writing/regrade-requests.html` remains rollback target | `app/(authed-admin-writing-regrade)/admin/writing/regrade-requests/page.tsx` — native React ownership 2026-08-13 | Admin | `status=pending\|accepted\|rejected\|fulfilled`, client `q` over loaded ≤300 per status | AuthProvider + backend-owned `/auth/me` role guard; four canonical lane reads + fresh detail; migration 205 atomic accept/reject and deliver/fulfil RPCs; account-keyed stale guard | L | Native decision cards, exact ACK + list/detail readback, capped/malformed truth, reject reason flow, direct next-step link to grade workspace; direct legacy HTML retained for rollback |
| `/admin/writing/prompts/new` | — | — | Admin | — | — | — | Handled by `/admin/writing/prompts` form (not separate page) |
| `/admin/writing/cohorts` | `/pages/admin/writing/cohorts.html` remains rollback target | `app/(authed-admin-writing-cohorts)/admin/writing/cohorts/page.tsx` — native React ownership 2026-08-13 | Admin | `cohort` (legacy `cohort_id` accepted), `status=needs_grade\|needs_review\|delivered\|overdue\|issues`, `activity=active\|idle`, client `q` | AuthProvider + backend-owned `/auth/me` role guard; canonical cohort list/detail APIs; account/request-keyed stale guard | L | Native cohort register + student × real give/prompt matrix; repeated prompts remain separate via group/assignment column identity, malformed/stale truth, responsive sticky table and canonical essay drill-through; direct legacy HTML retained for rollback |
| `/admin/writing/tips` | `/pages/admin/writing/tips.html` remains rollback target | `app/(authed-admin-writing-tips)/admin/writing/tips/page.tsx` — native React ownership 2026-08-13 | Admin | `task_type=task_1\|task_2\|both`, `published=true\|false`, client `q` | AuthProvider + backend-owned `/auth/me` role guard; canonical tip CRUD/import APIs; shared sanitized Markdown renderer; account-keyed pending mutation receipt | L | Native content library with URL filters, Markdown editor/preview, accessible publish/delete dialogs and dry-run→commit import; exact ACK plus ID/slug GET readback, ambiguous writes reconcile without replay; malformed/capped/stale truth and direct legacy rollback |
| `/admin/writing/status` | `/pages/admin/writing/status.html` remains rollback target | `app/(authed-admin-writing-status)/admin/writing/status/page.tsx` — native React ownership 2026-08-13 | Admin | required `essay_id` (legacy `id` accepted); optional `embed=1`, `mocklane=1` | AuthProvider + backend-owned `/auth/me` role guard; canonical read-only `/admin/writing/essays/{id}/status`; account/essay-keyed stale-response guard; visibility-aware sequential polling | M | Native per-essay grading monitor — not an aggregate dashboard; truthful time-estimate progress, retry ledger, stale snapshot, terminal success/failure actions and embedded Mock flow |
| `/admin/writing/regrade-requests` | — | `pages/admin/writing/regrade-requests.html` | Admin | `status` (pending, approved, rejected) | localStorage (theme), fetch (regrade API), decision UI | M | Student regrade request review + approval |
| `/admin/writing/instructor-queue` | `/pages/admin/writing/instructor-queue.html` remains rollback target; old flat alias redirects there | `app/(authed-admin-writing-instructor-queue)/admin/writing/instructor-queue/page.tsx` — native React ownership 2026-08-13 | Admin acting as instructor | `view=all_active\|queued\|my_claims\|delivered`; `embed`, `mocklane` | AuthProvider + backend-owned `/auth/me` role guard; canonical instructor queue API; account/request-keyed stale guard; account-keyed pending mutation receipt | L | Native FIFO operations queue; `edited` remains active, claim/release require exact ACK plus GET readback, ambiguous responses reconcile without replaying POST, sequential visible-tab polling; direct legacy HTML retained for rollback |
| `/admin/writing/regrade-requests` (rewrite) | Clean URL alias via vercel.json line 28 | — | Admin | — | — | — | Rewrite target (not a real page) |

### Admin — Reading

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/reading` | clean route; child content HTML remains directly reachable during migration | `app/(authed-admin-reading)/admin/reading/page.tsx` — native React ownership 2026-08-14 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme/sidebar) | S | Native read-only workflow hub; truthful native/legacy ownership, canonical attempts + Reading-filtered feedback destinations and learner preview without fake metrics or mutations |
| `/admin/reading/content` | `/pages/admin/reading/content.html` remains rollback target | `app/(authed-admin-reading-content)/admin/reading/content/page.tsx` | Admin | `library`; server paging | AuthProvider, canonical content API | L | Native import and library lifecycle workspace |
| `/admin/reading/preview` | `/pages/admin/reading/preview.html` remains rollback target | `app/(authed-admin-reading-preview)/admin/reading/preview/page.tsx` — native React ownership 2026-08-14 | Admin | required `test_id` | AuthProvider + backend-owned `/auth/me` role guard; canonical answer-key GET; diagram upload/delete with identity ACK + full canonical readback; shared sanitized Markdown renderer | L | Native paper-QA workspace for every passage/question, canonical answers/alternatives/explanations, parsed template and IMG-PROMPT; consecutive diagram/flow blocks expose one image owner; explicit student-like review creates no attempt |

### Admin — Listening

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/listening` | `/pages/admin/listening/index.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/page.tsx` — native React ownership 2026-08-14 | Admin | `status=draft\|published\|archived`; `page` | AuthProvider + backend-owned `/auth/me` role guard; canonical paged content GET + per-row exercise GET; account/filter-keyed stale guard | M | Native inventory for content, audio provenance and four exercise types; malformed/list-lookup failures stay distinct from empty data; rows deep-link to native content detail |
| `/admin/listening/content/[contentId]` | `/pages/admin/listening/content-detail.html?id=…` remains rollback target | `app/(authed-admin-listening)/admin/listening/content/[contentId]/page.tsx` — native React ownership 2026-08-14 | Admin | path `contentId` | AuthProvider + backend-owned `/auth/me` role guard; independent canonical content/exercise reads; optional parent-test audio read; status PATCH + GET readback; bounded render polling | M | Canonical metadata, audio provenance, transcript, four-type exercise coverage and confirmed publication state; metadata, Dictation, Gist and T/F open native editors while MCQ retains a direct rollback workspace |
| `/admin/listening/content/[contentId]/edit` | `/pages/admin/listening/content-meta.html?id={contentId}` remains rollback target | `app/(authed-admin-listening)/admin/listening/content/[contentId]/edit/page.tsx` + `admin-listening-content-editor.tsx` — native React ownership 2026-08-14 | Admin | path `contentId` | AuthProvider + backend-owned `/auth/me` role guard; exact content GET; delta-only metadata PATCH with `expected_updated_at`; account/content receipt + canonical GET reconciliation | M | Native nine-field editor preserves nullable CEFR/section, supports explicit license/source clearing, prevents concurrent overwrite, exposes read-only provenance and never concludes an ambiguous PATCH without exact readback |
| `/pages/admin/listening/content-detail.html` | — | `pages/admin/listening/content-detail.html` | Admin | `id` (content UUID) | localStorage (theme), fetch (content + exercises) | M | Explicit rollback for native `/admin/listening/content/[contentId]` |
| `/pages/admin/listening/content-meta.html` | — | `pages/admin/listening/content-meta.html` | Admin | `id` (content UUID) | localStorage (theme), fetch (content API) | M | Explicit rollback for native `/admin/listening/content/[contentId]/edit` |
| `/admin/listening/segments` | `/pages/admin/listening/segments.html?content_id=…` remains rollback target; old flat path still redirects | `app/(authed-admin-listening)/admin/listening/segments/page.tsx` + `admin-listening-segments.tsx` — native React ownership 2026-08-14 | Admin | required `content_id`; optional exact `exercise_id` | AuthProvider + backend-owned `/auth/me` role guard; exact content GET; complete Dictation-block GET; versioned exact-block POST; account/content pending receipt + canonical GET reconciliation; shared audio-player public time API | L | Native multi-block Dictation authoring: canonical transcript split, alignment/proportional timestamps, manual mark/preview, draft/publish/archive, duplicate/malformed fail closed, optimistic conflict lock and explicit HTML rollback |
| `/admin/listening/mcq` | `/pages/admin/listening/mcq.html?content_id=…` remains rollback target; old flat path still redirects | `app/(authed-admin-listening)/admin/listening/mcq/page.tsx` + `admin-listening-mcq.tsx` — native React ownership 2026-08-14 | Admin | required `content_id`; optional exact `exercise_id` | AuthProvider + backend-owned `/auth/me` role guard; exact content GET; complete mcq-block GET; versioned exact-block POST; account/content pending receipt + canonical GET reconciliation | M | Native multi-block MCQ answer-key authoring: audio/transcript evidence, 1–20 ordered questions, four bounded options and one exact answer index, draft/publish/archive with migration-209 one-live invariant, repairable oversized legacy text, 401-before-ACK truth, duplicate/malformed fail closed, keyboard-stable reorder, exact all-correct scoring truth and HTML rollback |
| `/admin/listening/gist` | `/pages/admin/listening/gist.html?content_id=…` remains rollback target; old flat path still redirects | `app/(authed-admin-listening)/admin/listening/gist/page.tsx` + `admin-listening-gist.tsx` — native React ownership 2026-08-14 | Admin | required `content_id`; optional exact `exercise_id` | AuthProvider + backend-owned `/auth/me` role guard; exact content GET; complete Gist-block GET; versioned exact-block POST; account/content pending receipt + canonical GET reconciliation | M | Native multi-block Gist rubric authoring: audio/transcript context, prompt/model answer/keyword chips, draft/publish/archive with one learner-reachable published block, 401-before-ACK truth, duplicate/malformed fail closed, explicit scoring truth, exact-block optimistic conflict reload and HTML rollback |
| `/admin/listening/tf` | `/pages/admin/listening/tf.html?content_id=…` remains rollback target; old flat path still redirects | `app/(authed-admin-listening)/admin/listening/tf/page.tsx` + `admin-listening-true-false.tsx` — native React ownership 2026-08-14 | Admin | required `content_id`; optional exact `exercise_id` | AuthProvider + backend-owned `/auth/me` role guard; exact content GET; complete true_false-block GET; versioned exact-block POST; account/content pending receipt + canonical GET reconciliation | M | Native multi-block T/F/NG authoring: audio/transcript evidence, 3–12 ordered statements, explicit answer-key semantics, draft/publish/archive with one learner-reachable published block, repairable oversized legacy text, 401-before-ACK truth, duplicate/malformed fail closed, exact scoring truth, keyboard-stable reorder, exact-block conflict reload and HTML rollback |
| `/admin/listening/dictation` | `/pages/admin/listening/dictation-reports.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/dictation/page.tsx` + `admin-listening-dictation.tsx` — native React ownership 2026-08-14 | Admin | `user`; `test`; `page`; `session` | AuthProvider + backend-owned `/auth/me` role guard; independent account/filter-keyed canonical list + full-scope aggregate reads; exact session detail; explicit user lookup truth | M | Native dictation evidence workspace preserves backend totals, pages aggregate rows beyond PostgREST caps, separates list/aggregate failures and shows reference-versus-learner evidence per sentence |
| `/admin/listening/audit` | `/pages/admin/listening/audit.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/audit/page.tsx` + `admin-listening-audit.tsx` — native React ownership 2026-08-14 | Admin | `search`, `type=full\|mini\|drill\|practice`, `health=error\|warning\|clean\|lookup`, `saved=pending\|passed\|has_issues\|fixed` | AuthProvider + backend-owned `/auth/me` role guard; exact stable pagination of all tests; bounded per-test canonical audit GET; account/request freshness guards; URL filters | L | Native read-only quality inventory separates current structural/audio health from the last persisted structural+LLM full audit, treats lookup failure as unknown rather than clean, and keeps explicit HTML rollback/detail handoff |
| `/admin/listening/audit-detail` | `/pages/admin/listening/audit-detail.html?id=…` remains rollback target | `app/(authed-admin-listening)/admin/listening/audit-detail/page.tsx` + `admin-listening-audit-detail.tsx` — native React ownership 2026-08-14 | Admin | required `id` (test UUID) | AuthProvider + backend-owned `/auth/me` role guard; exact audit/audio GETs; transcript/question optimistic tokens; canonical GET after every PATCH; account/test full-run receipt; GET-only ambiguity reconciliation | L | Native repair workspace separates live structural from saved structural+LLM evidence, selects exact section audio, prevents concurrent overwrite and blocks passed/fixed while saved errors remain unresolved |
| `/admin/listening/attempts` | `/pages/admin/listening/attempts.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/attempts/page.tsx` + `admin-listening-attempts.tsx` — native React ownership 2026-08-14 | Admin | `user`; `test`; `type=full\|mini\|drill\|practice`; `status=submitted\|in_progress\|abandoned`; `page`; `attempt` | AuthProvider + backend-owned `/auth/me` role guard; account/filter-keyed canonical list; exact attempt-detail GET; association lookup truth | M | Native learner-evidence inventory preserves backend totals, separates join failure from missing association and deep-links per-question grading through URL identity |
| `/admin/listening/tests` | `/pages/admin/listening/tests.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/tests/page.tsx` — native React ownership 2026-08-14 | Admin | `status=draft\|published\|archived`; `type=exam\|full\|mini\|drill\|practice`; `search`; `page` | AuthProvider + backend-owned `/auth/me` role guard; canonical paged tests GET; status/exam-only PATCH + exact detail GET + list readback | M | Native test inventory separates lifecycle from learner visibility (`exam_only`) and owns links to the native detail workspace |
| `/admin/listening/tests/[testId]` | `/pages/admin/listening/tests-detail.html?id={testId}` remains rollback target | `app/(authed-admin-listening)/admin/listening/tests/[testId]/page.tsx` + `admin-listening-test-detail.tsx` — native React ownership 2026-08-14 | Admin | path UUID `testId` | AuthProvider + backend-owned `/auth/me` role guard; canonical test/audio/map GETs; mode/audio/assemble/map/status/archive mutations + exact GET readback; typed hard-delete + identity-bound cascade ACK | L | Native operational workspace separates parent publication from cascade archive, exposes preview-signing failures, rejects stale ACKs and retains import/edit legacy workspaces |
| `/pages/admin/listening/tests-detail.html` | — | `pages/admin/listening/tests-detail.html` | Admin | `id` (test UUID) | localStorage (theme), fetch (test/audio/map data) | M | Explicit rollback for native `/admin/listening/tests/[testId]` |
| `/admin/listening/import-drills` | `/pages/admin/listening/import-drills.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/import-drills/page.tsx` + `admin-listening-drill-import.tsx` — native React ownership 2026-08-14 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; directory/loose file inventory; per-bundle SHA-256; dry-run upload; sequential progress-aware commit XHR; account-scoped receipt; exact test list/detail GET reconciliation | L | Native four-gate batch importer binds accessories only by authoritative path or a single loose source, distinguishes metadata-only from audio-ready, blocks duplicate active IDs and audio-without-timings, stops the queue on ambiguous writes and keeps explicit HTML rollback |
| `/admin/listening/import-fulltest` | `/pages/admin/listening/import-fulltest.html` remains rollback target | `app/(authed-admin-listening)/admin/listening/import-fulltest/page.tsx` + `admin-listening-fulltest-import.tsx` — native React ownership 2026-08-14 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; four local files; SHA-256 pack identity; dry-run upload; account-scoped durable receipt; progress-aware commit XHR; exact test list/detail GET reconciliation; status PATCH + GET readback | L | Native three-gate importer: file/type/size validation, parser evidence with answers and contiguous IMG-PROMPT blocks, changed-pack invalidation, duplicate fail-closed handoff to Kho test, no archive-inside-upload saga, no ambiguous POST replay, Draft-first publication and explicit HTML rollback |

### Admin — Vocabulary

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/vocab` | `/pages/admin/vocab/index.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/page.tsx` — native React ownership 2026-08-15 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard | S | Native eight-workspace hub; canonical chrome/overview links use clean routes for Stats, Topics, Quick-Check Quiz, Quiz Analytics, D1 Curation and Lemma Overrides while remaining legacy consoles stay explicit until their own batches |
| `/admin/vocab/content` | `/pages/admin/vocab/content.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/content/page.tsx` + `admin-vocab-content.tsx` — native React ownership 2026-08-15 | Admin | optional `category` admitted through canonical vocab topics; optional `q` headword search; server `limit=50`, `offset` | AuthProvider + backend-owned `/auth/me`; strict list/detail/import/write ACK models; dry-run before one-shot import commit; account/request/mutation guards; canonical page/detail readback after writes | L | Native Markdown import, paged card CRUD, rich JSON-safe word-family editing, audio preview/background generation and counted hard-delete dialogs. Legacy HTML remains rollback-only until Gate F. |
| `/admin/vocab/d1-curation` | `/pages/admin/vocab/d1-curation.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/d1-curation/page.tsx` + `admin-vocab-d1-curation.tsx` — native React ownership 2026-08-15 | Admin | `source=haiku\|gemini\|fallback_evidence`, `active=true\|false`, optional `user_id` UUID | AuthProvider + backend-owned `/auth/me`; strict `/admin/vocab/d1-questions` list/ACK models; paged canonical GET readback after PATCH/DELETE; account/request/mutation guards | M | Native review/editor preserves attempt history through backend soft-delete. The previous ledger's `batch/status` contract did not exist in the legacy page or backend. No optimistic row is presented as persisted truth. |
| `/admin/vocab/exercises` | `/pages/admin/vocab/exercises.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/exercises/page.tsx` + `admin-vocab-exercises.tsx` — native React ownership 2026-08-15 | Admin | `status=draft\|published\|rejected` (invalid values canonicalized to `draft`) | AuthProvider + backend-owned `/auth/me`; three strict status-scoped reads capped at 200; strict transition/bulk/generation ACKs; account/request/mutation guards; full queue readback after writes | M | Native D1 admin-pool moderation and synchronous chunked Gemini generation with truthful completed/partial summaries and explicit no-retry guidance. Legacy HTML remains rollback-only until Gate F. |
| `/admin/vocab/lemmas` | `/pages/admin/vocab/lemmas.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/lemmas/page.tsx` + `admin-vocab-lemmas.tsx` — native React ownership 2026-08-15 | Admin | optional prefix `search` | AuthProvider + backend-owned `/auth/me`; strict `/admin/vocab/lemmas/overrides` list/create models; paged canonical GET readback after POST/DELETE; account/request/mutation guards | M | Native manual override browser/create/delete. The previous ledger's `part_of_speech/frequency/sessionStorage` contract did not exist; POS is create payload only. Rollback HTML remains until Gate F. |
| `/admin/vocab/quiz` | `/pages/admin/vocab/quiz.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/quiz/page.tsx` + `admin-vocab-quiz-import.tsx` — native React ownership 2026-08-15 | Admin | optional `skill_area=grammar`, optional `topic` UUID admitted through the scoped topic list | AuthProvider + backend-owned `/auth/me`; strict topic/bank/import models; dry-run before commit; mutation lock; committed-bank ACK followed by canonical bank-list readback | M | Native grammar/vocab Markdown bank import and inventory. Multipart commit is never retried automatically after an ambiguous failure. Delete requires exact ACK and canonical absence. Rollback HTML remains until Gate F. |
| `/admin/vocab/quiz-analytics` | `/pages/admin/vocab/quiz-analytics.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/quiz-analytics/page.tsx` + `admin-vocab-quiz-analytics.tsx` — native React ownership 2026-08-15 | Admin | `scope=vocab\|course`, `tab=students\|hard`, optional `bank_id` UUID constrained to the selected scope | AuthProvider + backend-owned `/auth/me`; strict student rollup/detail/bank analytics models; account/request freshness guards | M | Read-only learner and difficulty analytics. Deep-linked banks are admitted only after canonical scoped bank lookup; nullable pre-finalization duration is displayed as zero rather than dropping the session. Rollback HTML remains until Gate F. |
| `/admin/vocab/stats` | `/pages/admin/vocab/stats.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/stats/page.tsx` + `admin-vocab-stats.tsx` — native React ownership 2026-08-15 | Admin | `days=7\|30\|90` | AuthProvider + backend-owned `/auth/me` role guard; independent canonical Vocab/Flashcards GETs; UUID-gated flag POST + Vocab GET readback; account/request freshness guards | M | Native stats consumes the actual backend aggregate keys (legacy expected stale field names and rendered empty metrics), preserves partial refresh truth, exposes SRS rating/engagement evidence and never reports a feature-flag write complete without canonical readback |
| `/admin/vocab/topics` | `/pages/admin/vocab/topics.html` remains rollback target | `app/(authed-admin-vocab)/admin/vocab/topics/page.tsx` + `admin-vocab-topics.tsx` — native React ownership 2026-08-15 | Admin | optional `skill_area=grammar`, optional `topic` UUID admitted through the scoped topic list | AuthProvider + backend-owned `/auth/me`; strict topic/bundle/bank/analytics models; mutation locks and canonical list/bundle readback | M | Native topic CRUD, bank publish/delete, inline error analytics and vocab-card handoff. Topic delete preserves backend 409 guard while content remains. Rollback HTML remains until Gate F. |

### Admin — Mock Exams & Reviews

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/mock-tests` | `/pages/admin/mock-tests/index.html` remains rollback target | `app/(authed-admin-mock-tests)/admin/mock-tests/page.tsx` — native React ownership 2026-08-16 | Admin | `tab=manage\|live\|review\|writing`; `exam_id`; client stage filter | AuthProvider + backend-owned `/auth/me` role guard; strict canonical `/admin/mock-exams` list; account/request-keyed stale guards; visible-tab 15s refresh | M | Native orchestration cockpit with truthful deep-linked exam identity, stage rail, shareable accessible tabs and published-only live admission. Manage, Live and Review embed their native routes; Writing embeds the native queue. Direct HTML stays rollback-only during coexistence. |
| `/admin/mock-exams` | `/pages/admin/mock-exams/index.html` remains rollback target | `app/(authed-admin-mock-exams)/admin/mock-exams/page.tsx` — native React ownership 2026-08-16 | Admin | `embed=1`; exam-content filters `kind`, `course_level`, `cohort_id`, `exam_only` | AuthProvider + backend-owned `/auth/me`; strict exam/progress/picker/content contracts; account/request-keyed stale guards; visible-tab 15s refresh; canonical refetch after every mutation | H | Native exam definition workspace: create/publish, sequential open/close/advance with required `from_section`, retake assignment/windows, and cross-library exam-content governance. Live invigilation and review stay outside this route. |
| `/admin/mock-live` | `/pages/admin/mock-live/index.html` remains rollback target | `app/(authed-admin-mock-live)/admin/mock-live/page.tsx` + `admin-mock-live.tsx` — native React ownership 2026-08-16 | Admin | required exact `exam_id` inside cockpit; optional picker fallback only on standalone route; `embed=1` | AuthProvider + backend-owned `/auth/me`; strict published-exam/live snapshot contracts; 5s visible polling; account/exam/request guards; canonical readback after irreversible controls | H | Native invigilator console preserves shared server-anchored clock, pause between collect/advance, roster unknown-vs-zero truth, per-student persisted answer/autosave signals, interrupted-sweep recovery, explicit void reason and no optimistic operational state. |
| `/admin/mock-pacing` | `/pages/admin/mock-pacing/index.html` remains rollback target | `app/(authed-admin-mock-live)/admin/mock-pacing/page.tsx` + `admin-mock-pacing.tsx` — native React ownership 2026-08-16 | Admin | required `sitting`; back-link uses canonical returned `exam_id` | AuthProvider + backend-owned `/auth/me`; strict pacing/caveat contract; account/sitting stale guard | M | Native read-only answer-timing reconstruction. Timestamp clears remain activity but not answers; 90s long-gap and 240s bar cap stay explicit; UI states that timestamps are last touches and gaps only bracket think-time. |
| `/admin/mock-reviews` | `/pages/admin/mock-reviews/index.html` remains rollback target | `app/(authed-admin-mock-reviews)/admin/mock-reviews/page.tsx` + `admin-mock-reviews.tsx` — native React ownership 2026-08-16 | Admin | required exact `mock_exam_id`; `embed=1` | AuthProvider + backend-owned `/auth/me`; strict roster/retest/detail contracts; account/request-keyed stale guards; independent auxiliary failures; canonical refetch after claim, flags, bands, Speaking, grading and release | H | Native per-exam roster and review workspace. Bulk partial refusals remain named per sitting; Writing/L/R/Speaking retain their operational surfaces; publishing uses an accessible confirmation and succeeds only after canonical readback. |
| `/admin/mock-reviews/report` | `/pages/admin/mock-reviews/report.html` remains rollback target | `app/(authed-admin-mock-reviews)/admin/mock-reviews/report/page.tsx` + `admin-mock-review-report.tsx` — native React ownership 2026-08-16 | Admin | required `review_id`; optional `mock_exam_id` for exact back target | AuthProvider + backend-owned `/auth/me`; strict review detail contract; reviewed/released and no-retest gate | M | Native printable score report reads only final backend bands. It renders canonical `overall` whenever present and includes a final-banded live Speaking extra even when the exam's required set is LRW. |

### Admin — Cohorts (generic)

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/cohorts` | — | `pages/admin/cohorts/index.html` | Admin | none | localStorage (theme), fetch (cohort API) | M | Shared cohort management (writing, reading, etc.) |

---

## Route Ownership & Complexity Summary

### By Complexity

| Level | Count | Examples | Typical characteristics |
|-------|-------|----------|---|
| **S (Static)** | ~10 | Grammar roadmap, reading hub, pricing, system status | No state, read-only content, no data fetch post-render |
| **M (Interactive, read-mostly)** | ~60 | Admin hubs, vocab browser, listening browse, writing assignments | Session reading, filters, list views, simple forms, no recording/editing |
| **L (Stateful, mutations)** | ~35 | Writing grading, admin queues, quiz player, reading exam, full test | Form state, mutations, list mutations, navigation within game/exam state |
| **XL (Complex game/recording flows)** | ~5 | Practice (speaking), reading exam (2613 LOC), writing grading (2045 LOC), listening audio, full-test chaining | MediaRecorder, Whisper API, Claude grading, grading UI with rubric calculator, multi-part orchestration, full-test session chaining |

### By Auth Level

| Level | Count | Examples |
|-------|-------|----------|
| **Public** | ~25 | Grammar, reading, listening, pricing, login, onboarding |
| **Student** | ~45 | Practice, result, reading-exam, writing, vocabulary, mock-exam, listening player, flashcards, profile |
| **Instructor** | ~5 | Grading, comparison, dashboard, instructor-queue (dual with admin) |
| **Admin** | ~67 | All admin/* pages + system, students, users, instructors, usage, foot-traffic, feedback, error-logs |

### By Browser Dependencies

| Dependency | Count | Routes |
|---|---|---|
| **localStorage** | 124 | All routes (theme preference universal) |
| **sessionStorage** | ~60 | Exam/practice/quiz/flashcard flows (session state) |
| **Supabase Auth session** | ~80 | Authenticated routes (student, instructor, admin) |
| **fetch API** | ~100 | API-driven content (list, form submission, analytics) |
| **MediaRecorder** | 3 | Practice (speaking), writing (audio submission), dictation |
| **audio playback** | ~20 | Listening, result, dictation, review flows |
| **Clipboard API** | ~5 | Admin grading (paste rubric), dictation (paste answer) |
| **File upload** | ~15 | Admin listening (audio), reading (image), writing (submit) |
| **Canvas/waveform** | 2 | Audio cutter, audio spike visualization |
| **Chart library** | ~12 | Analytics pages (usage, foot-traffic, quiz analytics, etc.) |

---

## Legacy Redirects (vercel.json)

| Legacy URL | Target | Status | Notes |
|---|---|---|---|
| `/pages/dashboard.html` | `/pages/speaking.html` | Permanent | Speaking moved to canonical path |
| `/pages/my-vocabulary.html` | `/pages/vocabulary.html` | Permanent | Vocabulary renamed |
| `/pages/admin-writing.html` | `/pages/admin/writing/index.html` | Permanent | Admin writing split out |
| `/pages/admin-writing-new.html` | `/pages/admin/writing/new.html` | Permanent | — |
| `/pages/admin-writing-grade.html` | `/pages/admin/writing/grade.html` | Permanent | — |
| `/pages/admin-writing-status.html` | `/pages/admin/writing/status.html` | Permanent | — |
| `/pages/admin-writing-assignments.html` | `/pages/admin/writing/assignments.html` | Permanent | — |
| `/pages/admin-writing-prompts.html` | `/pages/admin/writing/prompts.html` | Permanent | — |
| `/pages/admin-instructor-queue.html` | `/pages/admin/writing/instructor-queue.html` | Permanent | — |
| `/pages/admin-students.html` | `/pages/admin/students/index.html` | Permanent | — |
| `/pages/admin-listening-segments.html` | `/pages/admin/listening/segments.html` | Permanent | — |
| `/pages/admin-listening-gist.html` | `/pages/admin/listening/gist.html` | Permanent | — |
| `/pages/admin-listening-tf.html` | `/pages/admin/listening/tf.html` | Permanent | — |
| `/pages/admin-listening-mcq.html` | `/pages/admin/listening/mcq.html` | Permanent | — |
| `/admin/access-codes` | `/admin/users?tab=codes` | Temporary during native pilot | Access-code view merged into native users page; rollback-safe |
| `/pages/admin/access-codes/index.html` | `/pages/admin/users/index.html?tab=codes` | Permanent | (legacy admin path) |
| `/pages/admin/dashboard/index.html` | `/pages/admin/index.html` | Permanent | Dashboard hub redirected to main admin |

---

## Open Items for Migration Planning

### Phase 0 (Discovery) — Must Close Before Gate A

- [ ] **Route ownership graph compiler** — automated detection of Next route conflicts with public/vercel.json rewrites
- [ ] **Supabase project ref audit** — consolidate 2 production refs into 1; verify staging project linkage
- [ ] **Vercel plan upgrade** — confirm Hobby → Pro tier (B34 in plan) before pilot cutover
- [ ] **Runtime config generation** — create shared `runtime-config.js` (environment, API base, Supabase URL, telemetry origin)
- [ ] **Staging environment certification** — provision Railway staging + Supabase staging + OAuth callback setup
- [ ] **E2E baseline runs** — legacy HTML E2E suite against production API (smoke test only; full coverage deferred)

### Phase 1 (Safety Lane) — Environment & Test Data

- [ ] **Test identities seed** — create 5+ test users (student, instructor, admin, no-activation) with fixture data
- [ ] **Mock session/attempt fixtures** — pre-generate completed practice sessions, reading attempts, writing submissions
- [ ] **Data isolation contract** — define what PII/fixture data is safe for Preview; block production data copy to staging
- [ ] **Database bootstrap** — write schema clone script for staging (currently only migrations; no zero-base bootstrap)

### Phase 2 (Platform Lane) — Route Inventory & Coexistence

- [ ] **This ledger** — finalize via stakeholder review; sign off on 110+ canonical routes and 67 admin pages
- [ ] **Dual-stack coexistence design** — decide move strategy (git mv to public/ vs. generated copy); define watcher/stale output risk
- [ ] **Route ownership graph** — implement Vercel routing conflict detection in build step
- [ ] **Navigation seam testing** — E2E from legacy HTML → Next.js route → legacy HTML (auth, theme, query, hash preserved)

### Phase 3 (Risk Lane) — Media & Mutation Spikes

- [ ] **Audio upload + grading spike** — implement practice page (MediaRecorder → Whisper → Claude), measure latency, verify callback
- [ ] **Reading/listening state spike** — sessionStorage persistence + page reload recovery + attempt recovery
- [ ] **Writing grading spike** — implement rubric UI + band calculator, verify persistence + re-grading workflow
- [ ] **Data reconciliation contract** — idempotency, retry, duplicate detection, repair policy (deferred to Phase 1 after mutate pilot)

### Blockers Before Phase 1 Work Starts (all resolved 2026-07-13 — kept for audit trail)

1. **ADR-000 ratification** — RATIFIED ✓ (Next.js; Astro doc superseded)
2. **Vercel Pro tier** — upgraded ✓
3. **Supabase staging project** — provisioned ✓: schema cloned from production (78 tables), 6 buckets, OAuth configured (`docs/ENV_CERTIFICATION_STAGING_2026-07-13.md`)
4. **Railway staging deployment** — live ✓: `ielts-speaking-coach-staging.up.railway.app` (certified; DB isolation proven)

---

## File & Dependency Audit Notes

### Dependency hotspots to address early

| File | Risk | LOC | Dependencies | Owner |
|---|---|---|---|---|
| `frontend/js/practice.js` | Recording + grading orchestration | 3,167 | Whisper API, Claude grading, session persistence, full-test chaining | Practice domain owner |
| `frontend/pages/speaking.html` | Hub state + session list | 1,731 inline LOC | Supabase session, list fetch, localStorage (theme, filter) | Speaking domain owner |
| `frontend/pages/reading-exam.html` | Exam player + answer persistence | 2,613 LOC | sessionStorage (exam state, timing), localStorage (answers), attempt recovery | Reading domain owner |
| `frontend/pages/admin/writing/grade.html` | Grading UI + rubric | 1,635 inline LOC | Supabase session, essay fetch, rubric calculator, band logic, mutation tracking | Writing domain owner |
| `frontend/pages/writing-dashboard.html` | Writing hub + assignment list | 1,572 inline LOC | Supabase session, assignment fetch, cohort filter, localStorage (state) | Writing domain owner |
| `frontend/pages/result.html` | Result display + feedback | 1,165 inline LOC | sessionStorage (cached result), audio replay, grammar feedback rendering | Speaking domain owner |

### Source control hazards

| File | Issue | Impact | Mitigation |
|---|---|---|---|
| `frontend/js/vocabulary.js` | NUL byte (1) used as compound-key delimiter | Git tooling may interpret as binary; byte parity test required | Add to `.gitattributes` or use safe delimiter |
| `frontend/pages/admin/vocab/content.html` | NUL byte (1) used in same context | Same | Same |

### Shared Web Components (need port or legacy support in Next coexistence)

| Component | LOC | Current usage | Next.js strategy |
|---|---|---|---|
| `aver-chrome` | 757 | 101/124 pages (header/nav) | Port to React or keep as Web Component + script include in coexistence |
| `aver-admin-chrome` | 803 | Admin pages | Port to React or keep as Web Component + script include in coexistence |
| `audio-player` | 540 | Listening, result, review pages | Port to React or keep as Web Component + script include in coexistence |

### CDN dependencies (need pinned + outbound allowlist for Preview)

| Resource | Current | Recommendation |
|---|---|---|
| Lucide icons | unpkg.com/lucide@1.17.0 | Pin version; add to allowlist for Preview |
| Supabase JS | jsdelivr (CDN via HTML script tag) | Pin version; consider moving to npm; update CORS origin for staging |
| Fonts | googleapis.com + gstatic.com | Add to allowlist for Preview |

---

## Metrics for Route Completion

Once Next.js migration strategy is finalized, use these to track progress:

| Metric | Current | Target (by phase) | Owner |
|---|---|---|---|
| Routes fully migrated | 0 | 5 (Gate A), 20 (Gate C), 110 (Gate E) | — |
| Domains with >50% migration | 0 | 1 (Gate C), 2 (Gate D) | — |
| E2E test coverage | 0 | 5 flows (Gate B), 15 flows (Gate D) | — |
| Legacy HTML redirects reduced | 18 active | 10 (Gate C), 0 (Gate E) | — |
| Sev1/2 migration defects | 0 | <1 per 10 routes (tolerable threshold) | — |
| Admin pages with persistence failure audit | 0 | 67 (before cutover phase) | — |

---

## Related Documents

- **FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md** — architecture, gates, critical path
- **FE_MIGRATION_DECISION_2026-07-11.md** — framework choice (Next.js vs. Astro)
- **CLAUDE.md (project)** — canonical data structures, tech debt, grammar/writing/reading/listening flows
- **backend/main.py** — API contract; FastAPI is backend of record
- **frontend/vercel.json** — production rewrites, redirects, cache headers

---

## Appendix A: Route Pattern Glossary

### Query Parameter Conventions

| Param | Meaning | Scope | Example |
|---|---|---|---|
| `session_id` | Practice/full-test session UUID | Student practice flows | `?session_id=550e8400-e29b-41d4-a716-446655440000` |
| `test_id` | Content test/exam identifier | Reading/listening/exam flows | `?test_id=reading-full-test-001` |
| `attempt_id` | User's attempt at a test/quiz | Review/result flows | `?attempt_id=a1b2c3d4` |
| `submission_id` | Writing or instructor-reviewed submission | Result/grading flows | `?submission_id=sub-12345` |
| `slug` | Article URL-safe name | Grammar roadmap/search and Vocabulary Wiki | `?slug=future-tense`, `?cat=technology&slug=cutting-edge` |
| `category` | Grammar category (grammar-for-speaking, etc.) | Grammar routes | `?category=grammar-for-writing` (via dynamic route) |
| `cat` | Vocabulary category; ghép với `slug` thành canonical word identity | `/vocabulary` | `?cat=technology&slug=cutting-edge` |
| `tab` | UI tab selector | Admin/hub pages | `?tab=codes` (access-codes view in users page) |
| `search` / `q` | Query string for search | Grammar search, admin list filters | `?q=verb%20agreement` |
| `date_range` | Filter by date (start–end or preset) | Admin analytics | `?date_range=7d` or `?start=2026-07-06&end=2026-07-13` |
| `status` | Filter by status (draft, published, pending, etc.) | Admin CRUD pages | `?status=published` |
| `section` | Section index within test (1-3 for listening/reading) | Listening/reading task-scoped pages | `?section=1` |
| `card_index` | Resume position in flashcard/practice deck | Study flows | `?card_index=5` (for resume) |
| `level` | Difficulty level filter (elementary, intermediate, advanced) | Listening/reading browse | `?level=intermediate` |
| `metric` | Analytics metric selector | Admin dashboards | `?metric=dau` |
| `list_id` | Vocabulary list identifier (AWL, TOEIC, THPT, topic-123) | Vocabulary exam/practice | `?list_id=AWL` |
| `bank_id` | Grammar quiz bank slug | Quiz player | `?bank_id=present-simple` |
| `lesson_id` | Lesson within bank (optional progression) | Quiz player | `?lesson_id=1` |

### Fragment (hash) Conventions

| Fragment | Meaning | Example |
|---|---|---|
| `#section-<num>` | Scroll to section in article/result | `#section-2` (grammar article), `#part-1` (full-test result) |
| `#question-<id>` | Jump to specific question in exam | `#question-5` (reading exam) |
| `#recommendation-<grammar-article-slug>` | Scroll to feedback recommendation | `#recommendation-future-tense` |

---

## Appendix B: Known URL Aliasing & Consolidation

Some routes are served by the same HTML file but accessible via multiple URL patterns:

| Pattern 1 | Pattern 2 | Implementation file | Notes |
|---|---|---|---|
| `/vocabulary` | `public/vocabulary.html` + `public/pages/vocab-article.html` | `app/(public-content)/vocabulary/page.tsx` | CUTOVER 2026-08-15; wiki CÔNG KHAI sở hữu route, HTML cũ chỉ là rollback/parity đến Gate F. |
| `/writing` | `/writing/dashboard` | `pages/writing-dashboard.html` | Clean URL alias via vercel rewrite |
| `/writing/result` | (direct path only) | `pages/writing-result.html` | No root-level alias |
| `/grammar` | `/grammar.html` | `app/(public-content)/grammar/page.tsx` | CUTOVER (pilot 2); legacy giữ làm mốc rollback + vế parity |
| `/grammar/:category/:slug` | `/pages/grammar-article.html` | `pages/grammar-article.html` | Dynamic pattern via rewrite |
| `/speaking` | `/pages/speaking.html` | `app/(authed-speaking)/speaking/page.tsx` | CUTOVER 2026-08-05; legacy giữ làm mốc rollback + vế parity |
| `/home` | `/pages/home.html` | `app/(authed-home)/home/page.tsx` | CUTOVER 2026-08-05; legacy giữ làm mốc rollback + vế parity |

---

## Appendix C: Complexity Justifications (XL-tier routes)

### practice.html (XL — Speaking Core)
- **Why XL:** MediaRecorder → Whisper audio STT → Claude grading in orchestrated flow; 3,167 LOC practice.js manages: recording state, grading callback, full-test chaining, progress persistence, error recovery
- **State:** session_id (query param), recording state (sessionStorage), submitted responses (backend)
- **Recovery:** reload must re-fetch session, skip re-record if already graded
- **Risk:** Whisper API failure, Claude grading hang, MediaRecorder browser incompatibility, full-test session chaining loss

### reading-exam.html (XL — Reading Core)
- **Why XL:** 2,613 LOC for exam player; sessionStorage persistence of full 3-passage exam state, answer tracking, timing, attempt recovery on reload
- **State:** attempt_id (query), exam progress (sessionStorage, also backend), answers (sessionStorage), elapsed time per passage (sessionStorage)
- **Recovery:** reload must restore exact position + answers without data loss; backend must tolerate out-of-order or duplicate submission
- **Risk:** sessionStorage quota exceeded, answer data corruption, timing inconsistency between client/server

### admin/writing/grade.html (XL — Writing Grading)
- **Why XL:** 2,045 LOC + 1,635 inline LOC for grading UI; rubric calculator, band logic, conditional re-grade workflow, mutation persistence, complex form state
- **State:** submission_id (query), essay text + rubric scores (form state), recommended band (computed), decision (graded/rejected), feedback (text + images)
- **Recovery:** reload must preserve form state or re-fetch from backend; mutation idempotency required (save twice = same result)
- **Risk:** Grade overwrites existing grade (revision vs. replacement?), rubric calculator band incorrect, feedback text loss on unhandled error

### listening player (mcq/gist/tf/dictation combined) (XL — Listening Core)
- **Why XL:** Audio playback with free-scrubbing, section-scoped state, answer tracking, dictation text input, timing coordination, attempt persistence
- **State:** attempt_id + section (query/path), answers (sessionStorage + backend), audio position (in-memory), text transcribed (sessionStorage for dictation)
- **Recovery:** reload must restore audio position or re-fetch test data; cached answers must sync with backend
- **Risk:** Audio player freeze, free-scrub causing timing loss, dictation text loss on crash, section boundary errors

### full-test.html (XL — Full Mock Orchestration)
- **Why XL:** Chaining 3 part sessions, progress across parts, band aggregation, attempt persistence, ability to pause/resume between parts
- **State:** session_ids array (query param + sessionStorage), current_part (sessionStorage), part progress (sessionStorage), band aggregation (backend)
- **Recovery:** reload must restore current part + ability to jump back to previous parts or forward to next
- **Risk:** Session chain lost if query param not preserved, band recalc incorrect, part transition failure leaves orphaned session

---

**END OF ROUTE LEDGER**

This document is a working inventory subject to refinement during Phase 0 (discovery). Stakeholders should review:
1. Route count accuracy (124 production files → 110 canonical patterns?)
2. Auth level assignment (sample verification of 5+ pages per domain)
3. Complexity tier alignment with team (is reading-exam truly XL, or should it be L?)
4. Open items prioritization (which Phase 0 work is critical path vs. nice-to-have?)

**Document owner:** Migration lead  
**Last reviewed:** 2026-07-13  
**Next review:** After phase 0 discovery kickoff
