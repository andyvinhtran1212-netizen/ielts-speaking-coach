# averlearning.com — Site / Product Overview

> **What this is:** the **single source of truth** for the live site's product map — every module, how the modules relate, and what each sub-page does (purpose · audience · basic operation). Use it to onboard fast or to locate where a feature lives. `README.md` is a thin intro that points here; keep per-page / feature detail in this file only (don't reconstruct a competing map elsewhere).
> **Updated:** 2026-06-02 · reflects state through PR #392 (Reading module feature-complete: L1/L2 glossary + translation + grammar toggle, L3 full test + solution + chữa-bài, access control lock/share/anonymous, attempts dashboard; speaking daily limit 24).
> **Not this:** orchestration plans/lessons/patterns live in `docs/HANDOFF.md`; day-to-day Claude rules in `CLAUDE.md`; design-system narrative in `frontend/css/aver-design/DESIGN_SYSTEM.md`. The root `CURRENT_ARCHITECTURE_AND_PRODUCT_DIRECTION.md` is **retired** as a product-direction doc — superseded by this file (it remains a gitignored, stale-at-Sprint-6 personal-notes file on the author's machine; do not treat it as current).
> **Sub-page unit:** one real route-bearing `.html` under `frontend/` = one sub-page. Test fixtures (`frontend/tests/**`), `graphify-out/`, `_theme-test.html`, and `practice.legacy.html` are excluded.

---

## 1. Tech / hosting snapshot

| Layer | Stack |
|---|---|
| Frontend | Vanilla HTML + CSS + JS (no build step); `aver-design` token system (`--av-*`); served on Vercel at **www.averlearning.com** |
| Backend | Python 3.11 · FastAPI · Pydantic Settings; one router file per domain; hosted on **Railway** |
| Database | Single Supabase Postgres (**dev = prod**); backend uses the service role (bypasses RLS), enforcing ownership in-app |
| AI | OpenAI Whisper (speaking STT) · Anthropic Claude (speaking grading) · Google Gemini (writing grading + question gen) · Azure Speech (pronunciation) · ElevenLabs / Gemini image (listening audio + maps) |
| Storage | Supabase Storage (audio + listening + reading images) · Cloudinary (writing Task-1 images) |
| Auth | Supabase Auth (Google OAuth) + access codes; per-skill gating via `users.permissions` (JSONB) + `expires_at` |

---

## 2. Functional modules (Layer 1)

| Module | What it is |
|---|---|
| **Speaking** | The original core. Topic library (Part 1/2/3), in-browser recording → Whisper STT → Claude band grading + per-criterion feedback + grammar recommendations; single-question and full 3-part test; Azure pronunciation. Daily cap 24 sessions/account (admins bypass). |
| **Writing** | Essay practice graded by Gemini (5 levels × 3 tiers); student queue + result; instructor-grade workflow, prompts library, assignments, cohorts, tips, regrade requests. Task-1 images via Cloudinary. Export `.docx`. |
| **Listening** | Audio comprehension: dictation, gist, true/false, MCQ, mini-test, Cambridge full tests; AI-rendered audio (ElevenLabs) + map images; browse + analytics. |
| **Reading** | Three libraries — **L1 vocab** passages (glossary + translation + grammar toggle), **L2 skill** exercises (same + skill focus), **L3 full tests** (3 passages, ~40 Qs, auto-graded, band estimate, skill breakdown, rich solution / chữa-bài). Access control: per-test password **lock**, time-limited **share links**, and **anonymous** take via share link. |
| **Vocabulary** | Personal vocab bank, SRS **flashcards** (SM-2), fill-blank **exercises** (D1) + generated exercises (D3); 4-tab landing. |
| **Grammar Wiki** | Standalone reference sub-system: articles, compare pairs, learning roadmap, search; feeds grammar recommendations shown after speaking grading. |
| **Dashboard / analytics** | Admin ops dashboard (visitors, practices, grading minutes, tokens, trends) + a Reading-attempts dashboard (auth + anonymous, band/skill/time); foot-traffic, AI-usage, error logs. |
| **Access / accounts** | Google OAuth + access-code activation; per-skill permissions + expiry; admin code/user/cohort management. Reading adds per-test lock + share-link + anonymous capability tokens. |

---

## 3. How the modules relate (Layer 2)

**Authoring → practice → feedback → analytics** is the spine, repeated per skill:

```
ADMIN authors content ──▶ STUDENT (or ANONYMOUS) takes it ──▶ system grades/saves ──▶ STUDENT reviews ──▶ ADMIN sees analytics
  speaking topics            practice.html / reading-exam        Whisper+Claude /        result / chữa-bài     dashboards
  writing prompts            listening player / writing           Gemini / auto-score      writing-result        attempts dashboard
  listening/reading imports  flashcards / exercises               SRS / instant check
```

Cross-cutting relationships:
- **Access gating.** `users.permissions` (+ `expires_at`) gate which skills a student can open. Reading L3 tests add a second gate: a per-test **password lock** (admin-set) and a time-limited **share link** that *bypasses* the lock (the link is the grant).
- **Auth-OR-anonymous.** Most flows require a logged-in user. Reading share-links let an **anonymous** visitor take a test, submit, and view the solution — owned by an unguessable `anon_id` capability token (sent as `X-Reading-Anon`); their source is recorded as a salted IP hash (`anon_src`), never a raw IP.
- **Grammar feedback loop.** Speaking grading persists `grammar_recommendations`; the result page links into the **Grammar Wiki** articles.
- **Dashboards consume attempts.** Reading attempts (auth + anon) feed the admin Reading-attempts dashboard; speaking/sessions feed the ops dashboard (grading minutes, trends).
- **Shared frontend infra.** `aver-chrome` (student) + `aver-admin-chrome` (admin) web-component navs; `api.js` (auth + per-call headers + 401 handling); shared reading panes / questions / glossary components; `avCharts` SVG charts; `aver-design` tokens.

---

## 4. Per sub-page map (Layer 3)

Operation column = audience-facing purpose + the main data in/out (key endpoint or backend router). Endpoints are precise where verified this cluster; otherwise the owning router prefix is given.

### 4.1 Public / auth

| Page | Audience | Purpose · operation |
|---|---|---|
| `index.html` | all | Landing / entry; routes to login or app. |
| `login.html` | all | Google OAuth + access-code activation → `POST /auth/activate` (sets `users.is_active`, permissions, marks `access_codes` used). |
| `onboarding.html` | new user | First-time setup (band target, level, goals) → `/auth/*` profile write. |
| `pricing.html` | public | Pricing / marketing. |

### 4.2 Student — Speaking

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/home.html` | student | Multi-skill hub; links to each skill. Pulls home summary (`/api/student/*`). |
| `pages/speaking.html` | student | Speaking dashboard — session history + create new (`POST /sessions`, daily cap 24). |
| `pages/practice.html` | student | Recording state machine; submit audio → `POST /sessions/{id}/responses` (`grading.py`: Whisper + Claude). Full-test chains 3 sessions. |
| `pages/result.html` | student | Single-question speaking result (band + feedback panels + audio replay). |
| `pages/full-test-result.html` | student | Full 3-part test result; band aggregation at `PATCH /sessions/{id}/complete`. |
| `pages/profile.html` | student | Profile, band target, study goals. |

### 4.3 Student — Writing

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/writing-dashboard.html` | student | Essay queue + submit (gated by `permissions.writing`) → `/api/writing/*` (Gemini grader). |
| `pages/writing-result.html` | student | Per-essay feedback (12-section analysis, tips). |

### 4.4 Student — Listening

> Deep reference: [`listening-architecture.md`](listening-architecture.md) — per-type schema/payload/endpoint/grading + the full-test pack pipeline + the convergence proposal.

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/listening.html` | student | Listening hub. |
| `pages/listening-browse.html` · `pages/listening-tests.html` | student | Browse exercises / Cambridge full tests (`GET /api/listening/*`). |
| `pages/listening-dictation.html` · `pages/listening-gist.html` · `pages/listening-tf.html` · `pages/listening-mcq.html` | student | Per-type players — play audio, answer, auto-score (`/api/listening/*`). |
| `pages/listening-test.html` · `pages/listening-mini-test.html` | student | Full / mini test players (attempt + score). |
| `pages/listening-skills.html` | student | Skills Practice — skill drills grouped by question type (`GET /api/listening/tests?test_type=drill`); each drill reuses the mini-test player + review. |
| `pages/listening-analytics.html` | student | Personal listening analytics. |

### 4.5 Student — Reading

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/reading-vocab.html` | student | L1 vocab-passage library list (`GET /api/reading/vocab` list). |
| `pages/reading-vocab-passage.html` | student | One L1 passage — glossary popovers + 3-toggle pane (Gốc / Dịch / Grammar) + light comprehension Qs (`GET /api/reading/vocab/{slug}`, `.../check`). |
| `pages/reading-skill.html` | student | L2 skill-exercise library list. |
| `pages/reading-skill-exercise.html` | student | One L2 exercise — same panes + skill-tagged Qs (`GET /api/reading/skill/{slug}`). |
| `pages/reading-test.html` | student | L3 full-test browse (`GET /api/reading/test`). |
| `pages/reading-exam.html` | student **or anonymous** | L3 exam: boot + start + auto-save + submit (`/api/reading/test/{id}/boot`, `/attempts`, `/answers`, `/submit`). Locked tests prompt a password; `?share=<token>` → anonymous boot/start via `/api/reading/test/share/{token}/*` carrying `X-Reading-Anon`. |
| `pages/reading-review.html` | student **or anonymous** | Post-submit chữa-bài: score/band/skill + rich per-Q solution (`GET /api/reading/test/attempts/{id}/review`; `?anon=` → `X-Reading-Anon`). Solution is stripped during the test, revealed only here. |
| `pages/exam.html` | student | Multi-source exam player (Phase 3; TOEIC Part 5 first). `?id=` plays an exam (MCQ → submit → result + KP-aware review stepper); no id lists published exams (`GET /api/exams[?source]`, `/api/exams/{id}`, `POST /{id}/attempts`, `/attempts/{id}/review`). A right/wrong answer feeds `kp_evidence`. |

### 4.6 Student — Vocabulary

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/vocabulary.html` | student | Vocab hub landing (Từ vựng theo chủ đề / Flashcards / Exercises); mounts the tab modules. |
| `pages/flashcards.html` · `pages/flashcard-study.html` | student | Flashcard stacks + SRS study (`/api/flashcards/*`, SM-2). |
| `pages/exercises.html` · `pages/d1-exercise.html` | student | Fill-blank vocab exercises (`/api/exercises/*`). |
| `vocabulary.html` (root) | student | Legacy root vocab entry (kept; `pages/vocabulary.html` is canonical). |

### 4.7 Student — Grammar Wiki

| Page | Audience | Purpose · operation |
|---|---|---|
| `grammar.html` (root) | all | Grammar Wiki landing (`/api/grammar/*`). |
| `pages/grammar-article.html` | all | One grammar article. |
| `pages/grammar-compare.html` | all | Compare confusable pairs. |
| `pages/grammar-roadmap.html` | all | Learning-path roadmap. |
| `pages/grammar-search.html` | all | Search the wiki. |
| `pages/vocab-article.html` | all | Vocab-focused article view. |

### 4.8 Admin — landing + dashboards

| Page | Audience | Purpose · operation |
|---|---|---|
| `admin.html` (root) | admin | Legacy combined admin (codes/users/stats/sessions); superseded by `pages/admin/*` but still present. |
| `pages/admin/index.html` | admin | Admin Overview (pedagogical: students, skills, errors — `/admin/*` + `admin_overview.py`). |
| `pages/admin/dashboard/index.html` | admin | Ops dashboard — visitors / practices / grading-minutes / tokens + trends (`GET /admin/dashboard/overview` + `/trends`). |
| `pages/admin/dashboard/reading-attempts.html` | admin | Reading-attempts dashboard — auth + anonymous (approximate), band/skill/time, per-test, recent (`GET /admin/dashboard/reading-attempts`). |
| `pages/admin/foot-traffic/index.html` · `pages/admin/usage/index.html` | admin | Visitor foot-traffic + usage analytics (`/api/analytics/*`). |
| `pages/admin/error-logs/index.html` | admin | Error-report inbox (`/admin/error-logs`). |
| `pages/admin/system/index.html` · `pages/admin/system/ai-usage.html` · `pages/admin/system/alerts.html` | admin | System health, AI token usage, alerts. |

### 4.9 Admin — content authoring (per skill)

| Page(s) | Audience | Purpose · operation |
|---|---|---|
| `pages/admin/speaking/index.html` · `pages/admin/speaking/topics.html` · `pages/admin/speaking/sessions.html` | admin | Manage speaking topics + browse graded sessions (`/admin/*`). |
| `pages/admin/writing/index.html` · `pages/admin/writing/grade.html` · `pages/admin/writing/new.html` · `pages/admin/writing/prompts.html` · `pages/admin/writing/assignments.html` · `pages/admin/writing/status.html` · `pages/admin/writing/tips.html` · `pages/admin/writing/cohorts.html` · `pages/admin/writing/instructor-queue.html` · `pages/admin/writing/regrade-requests.html` | admin / instructor | Writing authoring + grading workflow (`/api/admin/writing/*`, `admin_writing*.py`): compose, grade, prompt library, assign, status, tips, cohorts, instructor queue, regrade requests. |
| `pages/admin/listening/index.html` · `pages/admin/listening/upload.html` · `pages/admin/listening/convert.html` · `pages/admin/listening/import-fulltest.html` · `pages/admin/listening/import-drills.html` · `pages/admin/listening/segments.html` · `pages/admin/listening/audio-cutter.html` · `pages/admin/listening/render.html` · `pages/admin/listening/content-detail.html` · `pages/admin/listening/content-meta.html` · `pages/admin/listening/gist.html` · `pages/admin/listening/tf.html` · `pages/admin/listening/mcq.html` · `pages/admin/listening/tests.html` · `pages/admin/listening/tests-detail.html` | admin | Listening authoring (`/admin/listening/*`): import/convert DOCX, **4-file full-test pack import** (`import-fulltest.html`, #408), cut/segment + AI-render audio, build per-type exercises + Cambridge tests. Deep ref: [`listening-architecture.md`](listening-architecture.md). |
| `pages/admin/reading/content.html` | admin | Reading content manager — import L1/L2/L3 (`POST /admin/reading/content/import`, `/import-bundle`); per-L3-row lock + share-link controls. |
| `pages/admin/reading/preview.html` | admin | Per-test preview with answer keys + diagram-image upload. |
| `pages/admin/grammar/index.html` · `pages/admin/grammar/articles.html` · `pages/admin/grammar/analytics.html` · `pages/admin/grammar/recommend-test.html` | admin | Grammar Wiki authoring + recommendation analytics/testing. |
| `pages/admin/vocab/index.html` · `pages/admin/vocab/lemmas.html` · `pages/admin/vocab/stats.html` · `pages/admin/vocab/exercises.html` · `pages/admin/vocab/d1-curation.html` | admin | Vocab bank curation, lemmas, stats, exercise authoring + D1 curation. |

### 4.10 Admin — people + access

| Page | Audience | Purpose · operation |
|---|---|---|
| `pages/admin/users/index.html` | admin | All users (role, activation, sessions-today). |
| `pages/admin/students/index.html` | admin | Student roster (Tailwind page). |
| `pages/admin/cohorts/index.html` | admin | Cohorts / classes (`/admin/cohorts/*`). |
| `pages/admin/access-codes/index.html` | admin | Access-code lifecycle — issue, assign, revoke; canonical ownership via `user_code_assignments` (legacy fallback `access_codes.used_by`). |

---

## 5. Backend router map (domains)

| Domain | Routers (prefix) |
|---|---|
| Speaking | `sessions.py` `/sessions` · `questions.py` · `grading.py` (★ official) · `pronunciation.py` · `tts.py` · `responses.py` (legacy, unused) |
| Writing | `writing_student.py` `/api/writing` · `admin_writing*.py` (`/api/admin/writing`, assignments, cohorts, prompts, regrade, tips) · `admin_instructor.py` |
| Listening | `listening.py` `/api/listening` · admin under `/admin/listening` |
| Reading | `reading_student.py` `/api/reading` (L1/L2/L3 fetch, exam boot/attempts/submit/answers/review, share + anon) · `admin_reading.py` `/admin/reading` (import, lock, share) |
| Vocabulary | `vocabulary.py` `/api/vocabulary` · `vocabulary_bank.py` · `flashcards.py` · `exercises.py` (+ `/admin/exercises`) |
| Grammar | `grammar.py` `/api/grammar` |
| Dashboard / analytics | `dashboard.py` `/api/dashboard` · `admin.py` `/admin` (dashboard overview/trends, reading-attempts) · `analytics.py` `/api/analytics` · `admin_overview.py` · `error_logs.py` · `cohorts.py` |
| Accounts | `auth.py` `/auth` · `admin_students.py` · `student_home.py` `/api/student` |
| Infra | `health.py` · `sitemap.py` · `export.py` (PDF/`.docx`) |

★ `grading.py` is the only official speaking-grading route; `responses.py` is legacy/unused.

---

## 6. Keeping this current

When you add or rename a route-bearing page under `frontend/`, add it here in the matching §4 table. A light sentinel (`frontend/tests/site-overview-coverage.test.mjs`) checks that (a) every `…​.html` path cited here exists on disk and (b) this doc covers the large majority of real product pages — so it fails loudly rather than rotting silently. It is intentionally tolerant (not every fixture/util page must be listed); update the doc when it trips.
