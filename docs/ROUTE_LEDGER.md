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

### Q1: Admin route count (65 vs 67)
- **Baseline claim (v2):** 62 admin pages
- **Verified count (v3 audit 2026-07-13):** 67 files under `pages/admin/`
- **Breakdown:**
  - `pages/admin/index.html` (1) — main hub
  - `pages/admin/dashboard/` (2) — overview + reading-attempts
  - `pages/admin/error-logs/` (1) — error triage
  - `pages/admin/feedback/` (1) — feedback analytics
  - `pages/admin/foot-traffic/` (1) — usage metrics
  - `pages/admin/grammar/` (4) — index + articles + analytics + recommend-test
  - `pages/admin/instructors.html` (1) — instructor oversight
  - `pages/admin/listening/` (17) — content, audit, mcq, gist, tf, segments, dictation, cutter, import, tests, render, etc.
  - `pages/admin/mock-exams/` (1) — exam management
  - `pages/admin/mock-reviews/` (2) — index + report
  - `pages/admin/reading/` (2) — content + preview
  - `pages/admin/speaking/` (3) — index + sessions + topics
  - `pages/admin/students.html` (1) — user management
  - `pages/admin/system/` (3) — alerts + ai-usage + index
  - `pages/admin/usage/index.html` (1) — per-user/access-code activity rollup
  - `pages/admin/users.html` (1) — user list & access-code mgmt
  - `pages/admin/vocab/` (9) — index + content + d1-curation + exercises + lemmas + quiz + quiz-analytics + stats + topics
  - `pages/admin/writing/` (11) — index + new + grade + queue + assignments + prompts + cohorts + tips + regrade-requests + status + instructor-queue
  - **Total: 67** ✓

- **Resolution:** Plan doc should reference 67, not 62; ledger below uses 67 as canonical.

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
- Expectation from writing flow: instructor sees queue in `/admin/writing/instructor-queue.html` instead.
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
| `/pricing` | — | `pricing.html` | Public | none | localStorage (theme) | S | Pricing table; marketing static |
| `/login` | — | `login.html` | Public | `next` (redirect after login) | localStorage (theme), Supabase client | M | Auth entry point; session init |
| `/onboarding` | — | `onboarding.html` | Student | none | localStorage (theme), Supabase session | M | Post-signup activation flow |

### Grammar

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/grammar` | `/grammar.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(public-content)/grammar/page.tsx` — CUTOVER (pilot 2) | Public | none | localStorage (theme) | M | Grammar hub; category browser |
| `/grammar/:category/:slug` | `/:category/:slug` (clean URL alias via vercel rewrite) | `pages/grammar-article.html` | Public | `anchor` (scroll to section) | localStorage (theme), fetch (public API) | M | Article view; ~150 articles served by single page; server-side SEO metadata |
| `/grammar/compare` | — | `pages/grammar-compare.html` | Public | `a`, `b` (article slugs to compare) | localStorage (theme), fetch API | M | Side-by-side article comparison |
| `/grammar/roadmap` | — | `pages/grammar-roadmap.html` | Public | none | localStorage (theme) | S | Learning path graph; static layout |
| `/grammar/search` | — | `pages/grammar-search.html` | Public | `q` (search term) | localStorage (theme), fetch API | M | Full-text search; real-time results |

### Migration Runtime Infrastructure

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/core-player/launch` | — | `app/core-player/launch/route.ts` | Public redirect boundary; no data access, destination/backend remains authoritative | `surface` plus the allowlisted identity/context query for that surface | no-store 307 redirect | S | Runtime admission boundary for new core attempts. It never accepts an implementation choice from the client; cached launchers are resolved against the currently deployed policy. This endpoint is part of the coexistence rollback floor while old launcher bundles may call it. |

### Speaking

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/speaking` | `/pages/speaking.html` (file, bản legacy vẫn phục vụ làm mốc rollback + vế parity), `/pages/dashboard.html` → `/pages/speaking.html` (legacy redirect via vercel.json line 34) | `app/(authed-speaking)/speaking/page.tsx` — CUTOVER 2026-08-05 | Student | none | localStorage (theme), sessionStorage (session state), Supabase session | M | Speaking hub; session list & full-test launch |
| `/practice` | `?session_id=<uuid>` (mandatory; error if missing) | `pages/practice.html` | Student | `session_id` | localStorage (theme), sessionStorage (recording state), MediaRecorder, Whisper API (audio upload), Claude grading API, Supabase session | XL | Core speaking practice; 3167 LOC practice.js; recording + grading + feedback + full-test chaining |
| `/practice/session` | NATIVE BOOTSTRAP + RECORDER + SUBMISSION + FULL-TEST STATE + PLAYER LIFECYCLE + JSX SHELL + PREP-PART2-SHEET-COMPLETION VIEW / FEEDBACK LEGACY; admission vẫn `/pages/practice.html`, `route_ready=false` | `app/(authed-practice)/practice/session/page.tsx`; React sở hữu auth, session/question bootstrap, MediaRecorder, multipart/reconciliation, Full Test chain/retry/resume/finalize, state activation, cleanup timer/countdown/listener/speech/object URL, static player DOM/handlers/SVG và view-model của header/loading/error/test progress/Part 1-3 prep/recording/processing/Part 2/assignment sheet/completion; backend pin chain đúng part/cùng sitting, 9/1/5 câu và exact response coverage; feedback/pronunciation và test-results vẫn do `practice.js` ghi qua ID tương thích | Student | `session_id` | AuthProvider + checked bootstrap + native player/recorder/submission/full-test controllers; receipt-safe canonical backend readback | XL | Stable implementation URL cho Gate E drill; dynamic renderer mới port một phần, chưa browser/live drill hay cutover, không được dùng parity nhánh thiếu query làm player-ready evidence |
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
| `/writing/dashboard` | rewrite ĐÃ GỠ ở #950; `/pages/writing-dashboard.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-writing)/writing/dashboard/page.tsx` — CUTOVER 2026-08-05 | Student | none | localStorage (theme), sessionStorage (state) | M | Rewrite target; assignment overview |
| `/writing/result` | rewrite ĐÃ GỠ; `/pages/writing-result.html` giữ làm rollback + parity | `app/(authed-writing-result)/writing/result/page.tsx` — CUTOVER 2026-08-12 | Student | `id`, legacy `essay_id` | localStorage (theme), Supabase session, Writing API | L | Task 1/Task 2 result + instructor feedback + regrade request + DOCX export |

### Reading

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/reading` | — | `pages/reading.html` | Public (can practice without login; auth optional for progress save) | none | localStorage (theme) | S | Reading hub; passage browser |
| `/reading/exam` | — | `pages/reading-exam.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (exam state, answers, timing), fetch API | XL | Full 3-passage IELTS reading; 2613 LOC reading-exam.js; local/session storage for persistence |
| `/reading/exam/session` | Stable Next dark route; admission remains legacy until Gate E cutover | `app/(authed-reading-player)/reading/exam/session/page.tsx` | Student for `test_id`; anonymous capability for `share` | `test_id` or `share`; optional `sitting_id`, `mock_embed`, `from`, `class_item` | AuthProvider, canonical Reading boot/attempt/answer/submit APIs, server-anchored timer, debounced retrying autosave, MockHook | XL | Native React player for all 16 Reading question types; restores canonical in-progress attempts and answers, submits the complete in-memory answer set, preserves password/share capability headers, and keeps legacy review as the post-result drill-down. Failure/coexistence evidence remains pending before admission can move. |
| `/reading/skill` | `/pages/reading-skill.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/skill/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student | filters: `difficulty`, `skill` | AuthProvider; `/api/reading/skill`; abort on filter/account switch and unmount | L | Filterable L2 skill library; account-keyed, React-escaped and soft-navigation safe |
| `/reading/skill/:exercise_id` | — | `pages/reading-skill-exercise.html` | Student | `exercise_id`, `passage_id` | localStorage (theme), sessionStorage (state) | M | Single exercise within skill drill |
| `/reading/vocab` | `/pages/reading-vocab.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/vocab/page.tsx` — CUTOVER 2026-08-05; native React behavior 2026-08-09 | Student | none | AuthProvider; `/api/reading/vocab`; abort on filter/account switch and unmount | M | Filterable L1 reading library; account-keyed, React-escaped and soft-navigation safe |
| `/reading/vocab/:passage_id` | — | `pages/reading-vocab-passage.html` | Public | `passage_id` | localStorage (theme) | M | Words from single passage |
| `/reading/review` | — | `pages/reading-review.html` | Student | `attempt_id` | localStorage (theme), fetch (answer review) | M | Post-exam review + analytics |
| `/reading/mini-test` | `/pages/reading-mini-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/mini-test/page.tsx` + `reading-mini-test-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (mini test state) | M | 1-passage reading drill; authenticated fail-close; aborts stale filter/account requests; explicit `test_type=mini` |
| `/reading/test` | `/pages/reading-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-reading)/reading/test/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student | filter: `module`; request pins `test_type=full` | AuthProvider; `/api/reading/test`; abort on filter/account switch and unmount | S | Full-test library; account-keyed, React-escaped and soft-navigation safe |

### Listening

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/listening` | `/pages/listening.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/page.tsx` + `listening-landing-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | none | AuthProvider; `/api/listening/overview`; abort on account switch and unmount | S | Count-driven Listening hub; runnable-mode library guard; explicit loading and generic API fallback; React-escaped và soft-navigation safe |
| `/listening/tests` | `/pages/listening-tests.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/tests/page.tsx` + `listening-tests-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | none | AuthProvider; paged `/api/listening/tests?test_type=full`; abort on account switch and unmount | S | Cambridge full tests shelf; `submitted` mới là đã làm, total attempts chỉ là activity; account-keyed, React-escaped và soft-navigation safe |
| `/listening/practice` | `/pages/listening-practice.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/practice/page.tsx` + `listening-practice-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | hash `trap` / `section` / `curated` | AuthProvider; overview + paged practice-group reads; per-tab cache; abort on account/tab switch and unmount | M | Luyện nhanh; canonical count-driven tabs; trap grouping; `submitted` mới là hoàn thành, total attempts chỉ là activity; React-escaped và soft-navigation safe |
| `/listening/test/session` | Stable Next dark route; admission remains legacy until Gate E cutover | `app/(authed-listening-player)/listening/test/session/page.tsx` | Student; MockHook may seal access inside an active mock sitting | `test_id`; optional `attempt_id`, `sitting_id`, `mock_embed`, `from`, `class_item` | AuthProvider, canonical Listening test/attempt/answer/submit APIs, server-anchored audio position, debounced retrying autosave, MockHook | XL | Native React player for full, mini, drill, and practice Listening tests; restores canonical in-progress attempts and answers, blocks submit while any answer save remains unresolved, preserves single-play/no-scrub rules for full tests, and keeps legacy review/dictation as post-result drill-downs. Failure/coexistence evidence remains pending before admission can move. |
| `/listening/mcq` | — | `pages/listening-mcq.html` | Student | `test_id`, `attempt_id`, `section` (optional) | localStorage (theme), sessionStorage (mcq state, answers), audio playback, free-scrub timing | L | Multiple-choice questions with linked audio |
| `/listening/gist` | — | `pages/listening-gist.html` | Student | `test_id`, `attempt_id`, `section` | localStorage (theme), sessionStorage (gist state), audio playback | M | Main idea comprehension task |
| `/listening/tf` | — | `pages/listening-tf.html` | Student | `test_id`, `attempt_id`, `section` | localStorage (theme), sessionStorage (tf state, answers), audio playback | M | True/False/Not Given task |
| `/listening/dictation` | — | `pages/listening-dictation.html` | Student | `test_id`, `attempt_id`, `section` (if linked to test) | localStorage (theme), sessionStorage (transcribed text), audio playback (free-scrub), clipboard (paste submit) | L | Free-text transcription from audio |
| `/listening/test-dictation` | — | `pages/listening-test-dictation.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (dictation state), audio playback | M | Linked dictation from test sections |
| `/listening/skills` | `/pages/listening-skills.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/skills/page.tsx` + `listening-skills-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `skill_id` (drill type) | AuthProvider; paged `/api/listening/tests?test_type=drill`; abort on account switch and unmount | M | Eleven skill ladders; L/T sorting; nav/filter/summary native; `submitted` mới là đã luyện; static SVG, React-escaped và soft-navigation safe |
| `/listening/browse` | `/pages/listening-browse.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/browse/page.tsx` + `listening-browse-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | filters: `accent_tag`, `cefr_level`, `ielts_section` | AuthProvider; paged `/api/listening/content`; abort on filter/account switch and unmount | S | Listening content catalog; backend-gated exercise modes; missing/malformed lookup is visible, not no-data; React-escaped và soft-navigation safe |
| `/listening/review` | — | `pages/listening-review.html` | Student | `attempt_id` | localStorage (theme), fetch (review data), audio playback | M | Post-test review + section breakdown |
| `/listening/analytics` | `/pages/listening-analytics.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/analytics/page.tsx` + `listening-analytics-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | filter: `range` (`7d`, `30d`, `all`) | AuthProvider; `/api/listening/analytics`; abort on range/account switch and unmount | M | Performance summary + 14-day trend; canonical weighted aggregates, backend-owned weakest mode, generic errors, React-escaped and soft-navigation safe |
| `/listening/mini-test` | `/pages/listening-mini-test.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-listening)/listening/mini-test/page.tsx` + `listening-mini-test-behavior.tsx` — native React behavior, legacy page retained for parity/rollback | Student | `test_id`, `attempt_id` | AuthProvider; paged `/api/listening/tests?test_type=mini`; abort on account switch and unmount | M | 1-section listening drill; variable score không gắn `/40`; `submitted` mới là đã luyện, total attempts chỉ là activity; account-keyed, React-escaped và soft-navigation safe |

### Tài khoản học viên

Bề mặt hồ sơ/tài khoản. Tách riêng vì rà quyền và rollback đi theo MIỀN:
để `/profile` nằm trong "Exercises & Quizzes" chỉ vì nó được chèn cạnh
`/exercises` là làm lệch đúng lượt rà đó (bot bắt ở #958).

| Route | Alias / redirect | Tệp sở hữu | Ai xem được | Tham số | Trạng thái phía client | Kích thước | Ghi chú |
|---|---|---|---|---|---|---|---|
| `/profile` | `/pages/profile.html` → 307 sang `/profile` (bản legacy ĐÃ gỡ khi cutover pilot 3) | `app/(authed)/profile/page.tsx` — CUTOVER (pilot 3) | Student | none | localStorage (theme), Supabase session | M | Hồ sơ học viên |

### Vocabulary

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/vocabulary` | `/vocabulary.html` (root) | `public/vocabulary.html` | **Public** | none | localStorage (theme) | M | **Wiki từ vựng CÔNG KHAI** — không cần đăng nhập. Là đích của tab «Vocabulary» trên `aver-chrome.js:324` và của link quay lại trong `vocab-article.html`. SỞ HỮU tên `/vocabulary` (chốt 2026-08-08, Q3). KHÔNG phải trang học viên: trang đó là `pages/vocabulary.html` ↔ `/vocabulary/hub`. `/pages/my-vocabulary.html` → `/pages/vocabulary.html` (vercel.json dòng 35) là redirect của TRANG HỌC VIÊN, không liên quan tới hàng này. |
| `/vocabulary/exam` | `/pages/vocab-exam.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-vocab-exam)/vocabulary/exam/page.tsx` — CUTOVER 2026-08-06; native React behavior 2026-08-09 | Student shell; endpoint public | none | `/api/vocabulary/exam`; abort on unmount | S | Read-only AWL/TOEIC/THPT list launcher; authored metadata React-escaped; opens shared flashcard player; soft-navigation safe |
| `/vocabulary/practice` | `app/(authed-vocab-practice)/vocabulary/practice/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-09 | `pages/vocab-practice.html` (parity/rollback only) | Student | none | AuthProvider, `/api/quiz/banks?skill_area=vocab`; abort on unmount/account switch | S | Vocabulary Quick-Check bank picker; authored metadata React-escaped; soft-navigation safe |
| `/vocabulary/article` | — | `pages/vocab-article.html` | Public | `word_id`, `source` (reading, listening, etc.) | localStorage (theme), fetch (word definition + examples) | S | Word detail + etymology + usage |

### Exercises & Quizzes

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/grammar/exercises` | `app/(public-content)/grammar/exercises/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-08 | `pages/grammar-exercises.html` (parity/rollback only) | Public | none | `/api/grammar/exercises`; abort on unmount | M | Grammar quiz launcher; authored bank metadata React-escaped; soft-navigation safe |
| `/d1-exercise` | — | `pages/d1-exercise.html` | Student | `task_id`, `attempt_id` | localStorage (theme), sessionStorage (exercise state), file upload (image) | M | Academic writing Task 1 (chart description) |
| `/course-exercises` | — (không có bản legacy) | `app/(authed)/course-exercises/page.tsx` — route CHỈ CÓ ở Next | Student | none | localStorage (theme), Supabase session | M | Bài tập theo giáo trình |
| `/exercises` | `/pages/exercises.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-exercises)/exercises/page.tsx` — CUTOVER 2026-08-06; lifecycle-safe Next orchestration 2026-08-09 | Student | none | AuthProvider; `/auth/me`; retained `vocab-modules/exercises.js` through shared mount/unmount adapter; abort on unmount | M | Feature-gated exercise hub; account-keyed and soft-navigation safe |
| `/quiz` | — | `pages/quiz.html` | Public | `bank_id` (grammar bank slug), `lesson_id` (optional) | localStorage (theme), sessionStorage (quiz answers), fetch API | L | Quiz player; MCQ/gap-fill/true-false |
| `/quiz/progress` | `app/(authed-quiz-progress)/quiz/progress/page.tsx` — CUTOVER 2026-08-07; native React behavior 2026-08-08 | `pages/quiz-progress.html` (parity/rollback only) | Student | `skill_area` (optional: `vocab` or `grammar`) | AuthProvider, `/api/quiz/progress`, `/api/quiz/mistakes`; abort on unmount/account switch | M | Quiz attempt history + stats; soft-navigation safe |
| `/flashcards` | `/pages/flashcards.html` bản legacy vẫn phục vụ làm mốc rollback + vế parity | `app/(authed-flashcards)/flashcards/page.tsx` — CUTOVER 2026-08-06; lifecycle-safe Next orchestration 2026-08-09 | Student | none | AuthProvider; retained `vocab-modules/flashcards.js` through shared mount/unmount adapter; abort on unmount | M | Flashcard stack browser/create/delete; account-keyed and soft-navigation safe |
| `/flashcard-study` | — | `pages/flashcard-study.html` | Student | `deck_id`, `card_index` (optional, resume) | localStorage (theme), sessionStorage (card state, review marks), fetch API | L | Flashcard study player; locked IIFE (not reusable) |
| `/exam` | — | `pages/exam.html` | Public | `exam_id` (MCQ exam type) | localStorage (theme), sessionStorage (exam state, answers) | L | Exam player (generic MCQ/true-false) |

### Instructor

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/instructor` | — | `pages/instructor/index.html` | Instructor | none | localStorage (theme), sessionStorage (cohort filter), Supabase session (verify role) | M | Instructor dashboard; cohort + essay queue |
| `/instructor/grade` | — | `pages/instructor/grade.html` | Instructor | `submission_id` | localStorage (theme), fetch (essay + rubric + student history), file upload (for attachments) | L | Grade UI; 1635 LOC inline script in writing-dashboard context |
| `/instructor/compare` | — | `pages/instructor/compare.html` | Instructor | `submission_id_1`, `submission_id_2` (optional, side-by-side) | localStorage (theme), fetch (essays) | M | Compare two essays side-by-side |

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

### Admin — Grammar

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/grammar` | `/pages/admin/grammar/index.html` remains rollback target | `app/(authed-admin-grammar)/admin/grammar/page.tsx` — native React ownership 2026-08-13 | Admin | none | AuthProvider + backend-owned `/auth/me` role guard; localStorage (theme/sidebar) | S | Native file-based content-operations hub; canonical links to learner preview, three legacy child workspaces and the shared Grammar exercise console; no content mutation or invented metrics |
| `/admin/grammar/articles` | `/pages/admin/grammar/articles.html` remains rollback target | `app/(authed-admin-grammar-articles)/admin/grammar/articles/page.tsx` — native React ownership 2026-08-13 | Admin | `category`, `search`; absent values show the full library | AuthProvider + backend-owned `/auth/me` role guard; typed GET `/admin/grammar/articles` + per-article preview; account/filter-keyed stale-response guard | M | Native read-only Markdown inventory with canonical clean student links, explicit per-source analytics availability, sandboxed inline preview and responsive table/cards; no article mutation |
| `/admin/grammar/analytics` | `/pages/admin/grammar/analytics.html` remains rollback target | `app/(authed-admin-grammar-analytics)/admin/grammar/analytics/page.tsx` — native React ownership 2026-08-13 | Admin | `days` (7/14/30/90; invalid values normalize to 7) | AuthProvider + backend-owned `/auth/me` role guard; typed GET `/admin/grammar/analytics`; profile/window-keyed stale-response guard | M | Read-only canonical snapshot with complete/unavailable state per views, recent activity and saves; recent activity is learner–article records whose last view falls in the window, not event views |
| `/admin/grammar/recommend-test` | — | `pages/admin/grammar/recommend-test.html` | Admin | none | localStorage (theme), fetch (recommendation engine) | M | Test recommendation generator; preview rules |

### Admin — Speaking

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/speaking` | — | `pages/admin/speaking/index.html` | Admin | none | localStorage (theme), sessionStorage (filter state), fetch (speaking API) | M | Speaking admin hub |
| `/admin/speaking/sessions` | — | `pages/admin/speaking/sessions.html` | Admin | `student_id`, `status` (completed, in-progress), `date_range` | localStorage (theme), sessionStorage (filter), fetch (session list) | M | Session list + audio replay + grading audit |
| `/admin/speaking/topics` | — | `pages/admin/speaking/topics.html` | Admin | none | localStorage (theme), fetch (topic API) | M | Topic CRUD + usage stats |

### Admin — Writing

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/writing` | — | `pages/admin/writing/index.html` | Admin | none | localStorage (theme), sessionStorage (tab state), fetch (writing API) | M | Writing admin hub; 8-tab interface |
| `/admin/writing/queue` | — | `pages/admin/writing/queue.html` | Admin | `status` (pending, graded), `cohort_id` | localStorage (theme), sessionStorage (filter state), fetch (queue API), virtual scroll | L | Grading queue; bulk assignment + status update |
| `/admin/writing/grade` | `/pages/admin/writing/grade.html` remains rollback + parity | `app/(authed-admin-writing-grade)/admin/writing/grade/page.tsx` — native React behavior 2026-08-12 | Admin | `id`, legacy `essay_id`; optional `embed`, `mocklane` | AuthProvider + backend-owned `/auth/me` role guard; canonical Writing/Instructor APIs; sessionStorage queue context; clipboard + DOCX blob | XL | 13-section edit/draft workflow; reviewed→delivered→revoke; regrade/rating; instructor ownership; account-keyed and duplicate-mutation guarded |
| `/admin/writing/assignments` | — | `pages/admin/writing/assignments.html` | Admin | `cohort_id`, `status` (active, completed) | localStorage (theme), sessionStorage (filter), fetch (assignment API) | M | Assignment CRUD + distribution |
| `/admin/writing/prompts` | — | `pages/admin/writing/prompts.html` | Admin | `category`, `status` (active, archive) | localStorage (theme), fetch (prompt API), markdown preview | L | Prompt CRUD + sample essay management; image upload |
| `/admin/writing/prompts/new` | — | — | Admin | — | — | — | Handled by `/admin/writing/prompts` form (not separate page) |
| `/admin/writing/cohorts` | — | `pages/admin/writing/cohorts.html` | Admin | none | localStorage (theme), fetch (cohort API) | M | Cohort CRUD + student enrollment |
| `/admin/writing/tips` | — | `pages/admin/writing/tips.html` | Admin | none | localStorage (theme), fetch (tip API) | M | Writing tips CRUD (embedded in grade UI) |
| `/admin/writing/status` | — | `pages/admin/writing/status.html` | Admin | `date_range`, `metric` (submissions, graded, pending) | localStorage (theme), fetch (status API), chart library | M | Daily status dashboard |
| `/admin/writing/regrade-requests` | — | `pages/admin/writing/regrade-requests.html` | Admin | `status` (pending, approved, rejected) | localStorage (theme), fetch (regrade API), decision UI | M | Student regrade request review + approval |
| `/admin/writing/instructor-queue` | (legacy path `/pages/admin-instructor-queue.html` redirects via vercel.json line 42) | `pages/admin/writing/instructor-queue.html` | Instructor (can also access as admin) | `cohort_id`, `status` | localStorage (theme), sessionStorage (filter), fetch (queue API) | M | Instructor-visible grading queue (subset of main queue) |
| `/admin/writing/prompts` (rewrite) | Clean URL alias via vercel.json line 25 | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/writing/tips` (rewrite) | Clean URL alias via vercel.json line 26 | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/writing/cohorts` (rewrite) | Clean URL alias via vercel.json line 27 | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/writing/regrade-requests` (rewrite) | Clean URL alias via vercel.json line 28 | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/writing/assignments` (rewrite) | Clean URL alias via vercel.json line 29 | — | Admin | — | — | — | Rewrite target (not a real page) |

### Admin — Reading

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/reading` | (no index.html; would be hub if created) | — | Admin | — | — | — | **Missing:** No reading admin index page exists yet |
| `/admin/reading/content` | — | `pages/admin/reading/content.html` | Admin | `test_id`, `status` (draft, published) | localStorage (theme), sessionStorage (filter state), fetch (content API) | L | Reading passage CRUD + preview |
| `/admin/reading/preview` | — | `pages/admin/reading/preview.html` | Admin | `passage_id` | localStorage (theme), fetch (passage data) | M | Full passage preview + answer key edit |

### Admin — Listening

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/listening` | — | `pages/admin/listening/index.html` | Admin | none | localStorage (theme), sessionStorage (tab state), fetch (listening API) | M | Listening admin hub; 12-tab interface |
| `/admin/listening/content` | (listed as `/admin/listening/content-meta.html` in file tree) | `pages/admin/listening/content-meta.html` | Admin | `test_id`, `type` (section, question) | localStorage (theme), fetch (content API) | M | Section/question metadata editor |
| `/admin/listening/content-detail` | — | `pages/admin/listening/content-detail.html` | Admin | `section_id` | localStorage (theme), fetch (section data), markdown editor | M | Single section detail + question edit |
| `/admin/listening/segments` | (legacy path `/pages/admin-listening-segments.html` redirects via vercel.json line 44) | `pages/admin/listening/segments.html` | Admin | `section_id`, `status` (processing, ready) | localStorage (theme), fetch (segment API) | L | Audio segmentation + timing map (auto-clip per sentence) |
| `/admin/listening/mcq` | (legacy path `/pages/admin-listening-mcq.html` redirects via vercel.json line 47) | `pages/admin/listening/mcq.html` | Admin | `section_id` | localStorage (theme), fetch (mcq API) | M | MCQ question editor + answer key |
| `/admin/listening/gist` | (legacy path `/pages/admin-listening-gist.html` redirects via vercel.json line 45) | `pages/admin/listening/gist.html` | Admin | `section_id` | localStorage (theme), fetch (gist API) | M | Gist (main idea) question editor |
| `/admin/listening/tf` | (legacy path `/pages/admin-listening-tf.html` redirects via vercel.json line 46) | `pages/admin/listening/tf.html` | Admin | `section_id` | localStorage (theme), fetch (tf API) | M | True/False/Not Given question editor |
| `/admin/listening/dictation` | (from file tree: `dictation-reports.html`) | `pages/admin/listening/dictation-reports.html` | Admin | `test_id`, `date_range`, `status` | localStorage (theme), fetch (dictation reports API) | M | Dictation attempt analytics + review |
| `/admin/listening/audit` | — | `pages/admin/listening/audit.html` | Admin | `test_id`, `status` (valid, errors) | localStorage (theme), fetch (audit API), virtual scroll | L | Content audit + error flag + fix workflow |
| `/admin/listening/audit-detail` | — | `pages/admin/listening/audit-detail.html` | Admin | `audit_id` | localStorage (theme), fetch (audit detail) | M | Single audit item + resolution |
| `/admin/listening/tests` | — | `pages/admin/listening/tests.html` | Admin | `status` (draft, published), `type` (mini, full, drill) | localStorage (theme), fetch (test list) | M | Test list + publish/archive |
| `/admin/listening/tests-detail` | — | `pages/admin/listening/tests-detail.html` | Admin | `test_id` | localStorage (theme), fetch (test data) | M | Single test detail + section management |
| `/admin/listening/import-drills` | — | `pages/admin/listening/import-drills.html` | Admin | none | localStorage (theme), file upload (drill data), fetch (import API) | M | Bulk import skill drills from archive |
| `/admin/listening/import-fulltest` | — | `pages/admin/listening/import-fulltest.html` | Admin | none | localStorage (theme), file upload (test archive), fetch (import API), progress tracking | L | Full-test bulk import + validation |

### Admin — Vocabulary

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/vocab` | — | `pages/admin/vocab/index.html` | Admin | none | localStorage (theme), sessionStorage (tab state), fetch (vocab API) | M | Vocabulary admin hub; 8-tab interface |
| `/admin/vocab/content` | — | `pages/admin/vocab/content.html` | Admin | `list_id`, `status` (active, archived), `search` | localStorage (theme), sessionStorage (filter state), fetch (card list) | L | Vocabulary card CRUD + bulk edit; PostgREST 1000-row cap (paginated in v3) |
| `/admin/vocab/d1-curation` | — | `pages/admin/vocab/d1-curation.html` | Admin | `batch`, `status` (pending, reviewed) | localStorage (theme), fetch (curation API) | M | D1 topic word curation workflow |
| `/admin/vocab/exercises` | — | `pages/admin/vocab/exercises.html` | Admin | `list_id`, `type` (quiz, flashcard) | localStorage (theme), fetch (exercise API) | M | Exercise template CRUD |
| `/admin/vocab/lemmas` | — | `pages/admin/vocab/lemmas.html` | Admin | `search`, `part_of_speech`, `frequency` | localStorage (theme), sessionStorage (filter), fetch (lemma list) | M | Lemma browser + headword management |
| `/admin/vocab/quiz` | — | `pages/admin/vocab/quiz.html` | Admin | `bank_id`, `status` | localStorage (theme), fetch (quiz API) | M | Grammar/vocab quiz question editor |
| `/admin/vocab/quiz-analytics` | — | `pages/admin/vocab/quiz-analytics.html` | Admin | `bank_id`, `date_range` | localStorage (theme), fetch (analytics API), chart library | M | Quiz attempt analytics + difficulty review |
| `/admin/vocab/stats` | — | `pages/admin/vocab/stats.html` | Admin | none | localStorage (theme), fetch (stats API), chart library | S | Vocabulary corpus stats (unique words, frequency dist) |
| `/admin/vocab/topics` | — | `pages/admin/vocab/topics.html` | Admin | none | localStorage (theme), fetch (topic API) | M | Topic CRUD + word assignment |

### Admin — Mock Exams & Reviews

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/mock-exams` | — | `pages/admin/mock-exams/index.html` | Admin | none | localStorage (theme), fetch (exam API) | M | Mock exam (placeholder); integrated into reading/writing/listening |
| `/admin/mock-reviews` | — | `pages/admin/mock-reviews/index.html` | Admin | `status` (pending, approved), `type` (speaking, writing) | localStorage (theme), fetch (review API) | M | Instructor review queue (sealed submission flow) |
| `/admin/mock-reviews/report` | — | `pages/admin/mock-reviews/report.html` | Admin | `review_id` | localStorage (theme), fetch (review data) | M | Review detail + decision + feedback |

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
| **File upload** | ~15 | Admin listening (audio), reading (image), writing (submit), d1-exercise (chart) |
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
| `slug` | Grammar article URL-safe name | Grammar routes | `?slug=future-tense` (served via dynamic route) |
| `category` | Grammar category (grammar-for-speaking, etc.) | Grammar routes | `?category=grammar-for-writing` (via dynamic route) |
| `tab` | UI tab selector | Admin/hub pages | `?tab=codes` (access-codes view in users page) |
| `search` / `q` | Query string for search | Grammar search, admin list filters | `?q=verb%20agreement` |
| `date_range` | Filter by date (start–end or preset) | Admin analytics | `?date_range=7d` or `?start=2026-07-06&end=2026-07-13` |
| `status` | Filter by status (draft, published, pending, etc.) | Admin CRUD pages | `?status=published` |
| `section` | Section index within test (1-3 for listening/reading) | Listening/reading task-scoped pages | `?section=1` |
| `card_index` | Resume position in flashcard/practice deck | Study flows | `?card_index=5` (for resume) |
| `level` | Difficulty level filter (elementary, intermediate, advanced) | Listening/reading browse | `?level=intermediate` |
| `metric` | Analytics metric selector | Admin dashboards | `?metric=dau` |
| `list_id` | Vocabulary list identifier (AWL, TOEIC, THPT, topic-123) | Vocabulary exam/practice | `?list_id=AWL` |
| `word_id` | Specific vocabulary word | Vocab article detail | `?word_id=abandon` |
| `bank_id` | Grammar quiz bank slug | Quiz player | `?bank_id=present-simple` |
| `lesson_id` | Lesson within bank (optional progression) | Quiz player | `?lesson_id=1` |
| `source` | Origin of content (reading, listening, writing) | Vocab article context | `?source=reading` |

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
| `/vocabulary` | `/vocabulary.html` | `public/vocabulary.html` | Wiki CÔNG KHAI, trang độc lập — SỞ HỮU `/vocabulary` (chốt 2026-08-08, Q3). Không phải bí danh cũ; không được biến thành redirect. |
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
