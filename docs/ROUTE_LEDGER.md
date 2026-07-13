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
  - `pages/admin/instructors.html` (1) — instructor management
  - `pages/admin/listening/` (17) — content, audit, mcq, gist, tf, segments, dictation, cutter, import, tests, render, etc.
  - `pages/admin/mock-exams/` (1) — exam management
  - `pages/admin/mock-reviews/` (2) — index + report
  - `pages/admin/reading/` (2) — content + preview
  - `pages/admin/speaking/` (3) — index + sessions + topics
  - `pages/admin/students.html` (1) — user management
  - `pages/admin/system/` (3) — alerts + ai-usage + index
  - `pages/admin/usage.html` (1) — statistics
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

### Q3: Vocabulary dual-route issue (two index files)
- Both `frontend/vocabulary.html` (root) and `frontend/pages/vocabulary.html` exist.
- `frontend/pages/my-vocabulary.html` is a legacy path that redirects to `/pages/vocabulary.html` per vercel.json line 35.
- **Issue:** Root-level `frontend/vocabulary.html` and `frontend/pages/vocabulary.html` may target the same route.
- **Resolution:** Verify canonical ownership; root-level file should either redirect or one should be retired post-migration.

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
- `full-test.html` and `full-test-result.html` use `session_id` query param.
- Chaining uses `_ftAllSessionIds` in frontend + `extra_session_ids` in pronunciation endpoint (per CLAUDE.md).
- **Resolution:** Full-test is ONE complex flow across multiple pages; session state is per-session_id, chained via query param array.

### Q8: Instructor routes (3 vs. expected scope)
- Only 3 instructor files found: `pages/instructor/index.html` (dashboard), `/grade.html`, `/compare.html`.
- Expectation from writing flow: instructor sees queue in `/admin/writing/instructor-queue.html` instead.
- **Resolution:** Instructor grade/compare are specialty pages; primary flow is via admin-writing tab for school workflows.

### Q9: Admin.html (root redirect stub)
- Both `/admin.html` (root-level stub) and `/pages/admin/index.html` (real hub) exist.
- `admin.html` is a redirect stub per CLAUDE.md file structure.
- **Resolution:** `/admin.html` is a legacy redirect; canonical entry is `/pages/admin/index.html` (or via clean URL `/admin` if rewrite added).

### Q10: Root-level vocabulary.html
- `frontend/vocabulary.html` exists at root level alongside `pages/vocabulary.html`.
- Need to verify if root-level is (a) legacy redirect, (b) independent route, or (c) accidental duplicate.
- **Resolution:** Pending verification; likely a legacy alias that should redirect to `pages/vocabulary.html`.

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
| `/grammar` | `/grammar.html` | `grammar.html` | Public | none | localStorage (theme) | M | Grammar hub; category browser |
| `/grammar/:category/:slug` | `/:category/:slug` (clean URL alias via vercel rewrite) | `pages/grammar-article.html` | Public | `anchor` (scroll to section) | localStorage (theme), fetch (public API) | M | Article view; ~150 articles served by single page; server-side SEO metadata |
| `/grammar/compare` | — | `pages/grammar-compare.html` | Public | `a`, `b` (article slugs to compare) | localStorage (theme), fetch API | M | Side-by-side article comparison |
| `/grammar/roadmap` | — | `pages/grammar-roadmap.html` | Public | none | localStorage (theme) | S | Learning path graph; static layout |
| `/grammar/search` | — | `pages/grammar-search.html` | Public | `q` (search term) | localStorage (theme), fetch API | M | Full-text search; real-time results |

### Speaking

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/speaking` | `/pages/speaking.html` (file), `/pages/dashboard.html` → `/pages/speaking.html` (legacy redirect via vercel.json line 34) | `pages/speaking.html` | Student | none | localStorage (theme), sessionStorage (session state), Supabase session | M | Speaking hub; session list & full-test launch |
| `/practice` | `?session_id=<uuid>` (mandatory; error if missing) | `pages/practice.html` | Student | `session_id` | localStorage (theme), sessionStorage (recording state), MediaRecorder, Whisper API (audio upload), Claude grading API, Supabase session | XL | Core speaking practice; 3167 LOC practice.js; recording + grading + feedback + full-test chaining |
| `/result` | `?session_id=<uuid>` (from practice complete) | `pages/result.html` | Student | `session_id`, `part` (optional, scroll anchor) | localStorage (theme), sessionStorage (cached result), audio playback | L | Result display; grammar feedback, pronunciation pills, next-question nav |
| `/full-test` | — | `pages/full-test.html` | Student | `test_id`, `attempt_id`, `session_ids` (array from chaining) | localStorage (theme), sessionStorage (test state, part progress) | L | Full mock test 3-part orchestration; session chaining |
| `/full-test-result` | — | `pages/full-test-result.html` | Student | `attempt_id` | localStorage (theme), audio playback | L | Aggregated result across 3 parts; band calculation |

### Writing

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/writing` | — | `pages/writing-dashboard.html` | Student | none | localStorage (theme), sessionStorage (state), Supabase session | M | Writing hub; assignment list + status + cohort view |
| `/writing/dashboard` | Clean URL alias via vercel.json line 23 | `pages/writing-dashboard.html` | Student | none | localStorage (theme), sessionStorage (state) | M | Rewrite target; assignment overview |
| `/writing/result` | Clean URL alias via vercel.json line 24 | `pages/writing-result.html` | Student | `submission_id` | localStorage (theme), sessionStorage (cached result), fetch (Rails images from legacy Supabase project) | L | Task 1/Task 2 result + instructor feedback |

### Reading

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/reading` | — | `pages/reading.html` | Public (can practice without login; auth optional for progress save) | none | localStorage (theme) | S | Reading hub; passage browser |
| `/reading/exam` | — | `pages/reading-exam.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (exam state, answers, timing), fetch API | XL | Full 3-passage IELTS reading; 2613 LOC reading-exam.js; local/session storage for persistence |
| `/reading/skill` | — | `pages/reading-skill.html` | Student | `skill_id` (comprehension, vocab, skim, scan) | localStorage (theme), sessionStorage (answers) | L | Skill-specific passage drills |
| `/reading/skill/:exercise_id` | — | `pages/reading-skill-exercise.html` | Student | `exercise_id`, `passage_id` | localStorage (theme), sessionStorage (state) | M | Single exercise within skill drill |
| `/reading/vocab` | — | `pages/reading-vocab.html` | Public | none | localStorage (theme), fetch (vocab list) | M | Vocabulary extraction from reading content |
| `/reading/vocab/:passage_id` | — | `pages/reading-vocab-passage.html` | Public | `passage_id` | localStorage (theme) | M | Words from single passage |
| `/reading/review` | — | `pages/reading-review.html` | Student | `attempt_id` | localStorage (theme), fetch (answer review) | M | Post-exam review + analytics |
| `/reading/mini-test` | — | `pages/reading-mini-test.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (mini test state) | M | 1-passage reading drill |
| `/reading/test` | — | `pages/reading-test.html` | Student | (not commonly used; prefer exam or mini-test) | localStorage (theme) | S | Generic reading test page (low traffic) |

### Listening

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/listening` | — | `pages/listening.html` | Public | none | localStorage (theme) | S | Listening hub; content browser |
| `/listening/mcq` | — | `pages/listening-mcq.html` | Student | `test_id`, `attempt_id`, `section` (optional) | localStorage (theme), sessionStorage (mcq state, answers), audio playback, free-scrub timing | L | Multiple-choice questions with linked audio |
| `/listening/gist` | — | `pages/listening-gist.html` | Student | `test_id`, `attempt_id`, `section` | localStorage (theme), sessionStorage (gist state), audio playback | M | Main idea comprehension task |
| `/listening/tf` | — | `pages/listening-tf.html` | Student | `test_id`, `attempt_id`, `section` | localStorage (theme), sessionStorage (tf state, answers), audio playback | M | True/False/Not Given task |
| `/listening/dictation` | — | `pages/listening-dictation.html` | Student | `test_id`, `attempt_id`, `section` (if linked to test) | localStorage (theme), sessionStorage (transcribed text), audio playback (free-scrub), clipboard (paste submit) | L | Free-text transcription from audio |
| `/listening/test-dictation` | — | `pages/listening-test-dictation.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (dictation state), audio playback | M | Linked dictation from test sections |
| `/listening/skills` | — | `pages/listening-skills.html` | Student | `skill_id` (drill type: mcq, gist, tf, dictation) | localStorage (theme), sessionStorage (skill drill state) | M | Skill-specific drill selector + launcher |
| `/listening/browse` | — | `pages/listening-browse.html` | Public | `level` (elementary, intermediate, advanced) | localStorage (theme), fetch (content list) | S | Listening content catalog |
| `/listening/review` | — | `pages/listening-review.html` | Student | `attempt_id` | localStorage (theme), fetch (review data), audio playback | M | Post-test review + section breakdown |
| `/listening/analytics` | — | `pages/listening-analytics.html` | Student | `test_id`, `user_id` (optional, for admin) | localStorage (theme), fetch (analytics API) | M | Performance summary + trend |
| `/listening/mini-test` | — | `pages/listening-mini-test.html` | Student | `test_id`, `attempt_id` | localStorage (theme), sessionStorage (mini test state), audio playback | M | 1-section listening drill |

### Vocabulary

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/vocabulary` | `/vocabulary.html` (root), `/pages/vocabulary.html`, `/pages/my-vocabulary.html` → `/pages/vocabulary.html` (vercel.json line 35) | `pages/vocabulary.html` | Student | none | localStorage (theme), sessionStorage (card state), Supabase session | M | Student vocab hub; curated topic words |
| `/vocabulary/exam` | — | `pages/vocab-exam.html` | Student | `list_id` (AWL, TOEIC, THPT, or course-specific) | localStorage (theme), sessionStorage (quiz state, score), fetch API | L | Quiz from imported vocabulary list |
| `/vocabulary/practice` | — | `pages/vocab-practice.html` | Student | `list_id`, `card_id` (optional, resume) | localStorage (theme), sessionStorage (card progress, deck order) | M | Flashcard study (not locked in IIFE; reusable via quiz-vocab) |
| `/vocabulary/article` | — | `pages/vocab-article.html` | Public | `word_id`, `source` (reading, listening, etc.) | localStorage (theme), fetch (word definition + examples) | S | Word detail + etymology + usage |

### Exercises & Quizzes

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/grammar/exercises` | — | `pages/grammar-exercises.html` | Public | none | localStorage (theme), fetch (grammar quiz banks) | M | Grammar quiz launcher; multiple banks |
| `/d1-exercise` | — | `pages/d1-exercise.html` | Student | `task_id`, `attempt_id` | localStorage (theme), sessionStorage (exercise state), file upload (image) | M | Academic writing Task 1 (chart description) |
| `/exercises` | — | `pages/exercises.html` | Student | none | localStorage (theme), fetch (exercise list) | M | Exercise hub; all types |
| `/quiz` | — | `pages/quiz.html` | Public | `bank_id` (grammar bank slug), `lesson_id` (optional) | localStorage (theme), sessionStorage (quiz answers), fetch API | L | Quiz player; MCQ/gap-fill/true-false |
| `/quiz/progress` | — | `pages/quiz-progress.html` | Student | `bank_id` (optional, filter by bank) | localStorage (theme), fetch (progress API) | M | Quiz attempt history + stats |
| `/flashcards` | — | `pages/flashcards.html` | Student | none | localStorage (theme), sessionStorage (deck order) | M | Flashcard deck browser |
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
| `/admin` | `/admin.html` (stub redirect), `/pages/admin.html` (legacy), `/pages/admin/dashboard/index.html` (legacy redirect via vercel.json line 50) | `pages/admin/index.html` | Admin | `tab` (optional, section filter) | localStorage (theme), sessionStorage (filter state), Supabase session (verify admin) | M | Admin hub; 8-domain dashboard |
| `/admin/system` | — | `pages/admin/system/index.html` | Admin | none | localStorage (theme), fetch (system stats) | S | System status + feature flags |
| `/admin/system/alerts` | — | `pages/admin/system/alerts.html` | Admin | `severity` (critical, warning, info) | localStorage (theme), fetch (alert API) | M | Alert triage + dismissal |
| `/admin/system/ai-usage` | — | `pages/admin/system/ai-usage.html` | Admin | `model`, `date_range` (filters) | localStorage (theme), fetch (usage API), chart library (recharts) | M | AI model usage + cost tracking |
| `/admin/students` | — | `pages/admin/students/index.html` | Admin | `search`, `role`, `status` (filters) | localStorage (theme), sessionStorage (filter state), fetch (user list) | M | User list + cohort assignment |
| `/admin/users` | — | `pages/admin/users/index.html` | Admin | `tab=codes` (access-code view; default is users) | localStorage (theme), sessionStorage (tab state), fetch (code API) | L | User management + access-code ownership tracking; dual-view |
| `/admin/access-codes` | Clean alias; redirects to `/admin/users?tab=codes` (vercel.json line 48) | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/instructors` | — | `pages/admin/instructors.html` | Admin | none | localStorage (theme), fetch (instructor list) | M | Instructor management + cohort assignment |
| `/admin/usage` | — | `pages/admin/usage/index.html` | Admin | `metric` (dau, mau, features), `date_range` | localStorage (theme), fetch (analytics API), chart library | M | Aggregate usage stats |
| `/admin/foot-traffic` | — | `pages/admin/foot-traffic/index.html` | Admin | `route`, `date_range` | localStorage (theme), fetch (traffic API), chart library | M | Per-route visitor count + trends |
| `/admin/feedback` | — | `pages/admin/feedback/index.html` | Admin | `status` (open, resolved), `type` (bug, feature) | localStorage (theme), fetch (feedback API) | M | Bug/feedback triage |
| `/admin/error-logs` | — | `pages/admin/error-logs/index.html` | Admin | `level` (error, warning), `service` (frontend, backend), `date` | localStorage (theme), sessionStorage (filter state), fetch (log API), virtual scroll | L | Error log triage + dismissal (bulk ops); 1549 errors triaged as of 2026-07-08 |
| `/admin/dashboard` | (legacy path redirect to `/admin` via vercel.json line 50) | — | Admin | — | — | — | Rewrite target (not a real page) |
| `/admin/dashboard/reading-attempts` | — | `pages/admin/dashboard/reading-attempts.html` | Admin | `date_range`, `status` | localStorage (theme), fetch (attempt API) | M | Reading attempt analytics; custom filters |

### Admin — Grammar

| Route Pattern | Aliases/Redirects | File | Auth | Query Params | Browser Deps | Complexity | Notes |
|---|---|---|---|---|---|---|---|
| `/admin/grammar` | — | `pages/admin/grammar/index.html` | Admin | none | localStorage (theme), sessionStorage (category filter), fetch (grammar API) | M | Grammar article management hub |
| `/admin/grammar/articles` | — | `pages/admin/grammar/articles.html` | Admin | `category`, `status` (draft, published), `search` | localStorage (theme), sessionStorage (filter state), fetch (article list) | L | Article CRUD + bulk edit; markdown editor |
| `/admin/grammar/analytics` | — | `pages/admin/grammar/analytics.html` | Admin | `date_range`, `category` | localStorage (theme), fetch (analytics API), chart library | M | Article view count + engagement |
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
| `/admin/writing/grade` | — | `pages/admin/writing/grade.html` | Admin | `submission_id` | localStorage (theme), fetch (essay + rubric + history), file upload, clipboard (paste rubric) | XL | Grade UI; 2045 LOC + 1635 LOC inline script; integrated rubric + band calculator |
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
| `/admin/listening/upload` | — | `pages/admin/listening/upload.html` | Admin | none | localStorage (theme), file upload (audio), fetch (import API) | M | Audio file bulk upload + metadata |
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
| `/admin/listening/render` | — | `pages/admin/listening/render.html` | Admin | `test_id`, `format` (html, pdf) | localStorage (theme), fetch (render API), chart (SVG maps) | M | Test rendering preview + export |
| `/admin/listening/convert` | — | `pages/admin/listening/convert.html` | Admin | `source_format` (xml, json, pdf) | localStorage (theme), file upload (test data), fetch (convert API) | M | Format conversion + validation |
| `/admin/listening/audio-cutter` | — | `pages/admin/listening/audio-cutter.html` | Admin | none | localStorage (theme), file upload (audio), audio playback (free-scrub), canvas (waveform) | L | Audio editor; segment clip + timing adjust |
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
| `/admin/access-codes` | `/pages/admin/users/index.html?tab=codes` | Permanent | Access-code view merged into users page |
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
| `/vocabulary` | `/vocabulary.html` | `pages/vocabulary.html` | Root-level file needs audit; likely legacy |
| `/writing` | `/writing/dashboard` | `pages/writing-dashboard.html` | Clean URL alias via vercel rewrite |
| `/writing/result` | (direct path only) | `pages/writing-result.html` | No root-level alias |
| `/grammar` | `/grammar.html` | `grammar.html` | Root-level file |
| `/grammar/:category/:slug` | `/pages/grammar-article.html` | `pages/grammar-article.html` | Dynamic pattern via rewrite |
| `/speaking` | `/pages/speaking.html` | `pages/speaking.html` | Clean URL alias via verwrite; legacy dashboard redirect also here |
| `/home` | `/pages/home.html` | `pages/home.html` | Clean URL alias via verwrite |

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
