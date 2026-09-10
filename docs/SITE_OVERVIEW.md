# averlearning.com — Site / Product Overview

> **What this is:** the **single source of truth** for the live site's product map — every module, how the modules relate, and what each sub-page does (purpose · audience · basic operation). Use it to onboard fast or to locate where a feature lives. `README.md` is a thin intro that points here; keep per-page / feature detail in this file only (don't reconstruct a competing map elsewhere).
> **Updated:** 2026-09-10 · route ownership refreshed against the 130 product App Router pages after hard flip. Existing domain/endpoint descriptions are retained unless explicitly corrected below; source coverage is not a fresh end-to-end audit of every feature.
> **Not this:** orchestration plans/lessons/patterns live in `docs/HANDOFF.md`; day-to-day Claude rules in `CLAUDE.md`; design-system narrative in `frontend/css/aver-design/DESIGN_SYSTEM.md`. The root `CURRENT_ARCHITECTURE_AND_PRODUCT_DIRECTION.md` is **retired** as a product-direction doc — superseded by this file (it remains a gitignored, stale-at-Sprint-6 personal-notes file on the author's machine; do not treat it as current).
> **Sub-page unit:** one unique product URL pattern from `frontend/app/**/page.tsx` or `page.ts` = one sub-page. Route groups do not add URL segments; dynamic parameters remain bracketed. Private folders, route handlers, fixtures and the two named engineering routes `/next-probe` and `/recorder-spike` are excluded. Historical HTML URLs are compatibility redirects, not separate live pages or immediately usable rollback UIs.

---

## 1. Tech / hosting snapshot

| Layer | Stack |
|---|---|
| Frontend | Next.js App Router + React/TypeScript, built and served on Vercel at **www.averlearning.com**; `aver-design` tokens (`--av-*`). Shared web components and some public JS/CSS are still used by Next; do not equate HTML retirement with removing all public assets. |
| Backend | Python 3.11 · FastAPI · Pydantic Settings; one router file per domain; hosted on **Railway** |
| Database | Supabase Postgres/Auth/Storage with distinct staging and production provenance; Vercel previews target staging (ADR-006). Backend service-role queries enforce ownership in-app; never assume a local or preview session may write production. |
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
  speaking topics            practice/session / reading/exam/session  Whisper+Claude /    result / chữa-bài     dashboards
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

The first column lists canonical Next URL patterns only; query examples do not
create extra pages. Retained HTML sources and their permanent redirects are
tracked in the Gate F manifest/runbook, not counted as additional product pages.
For example, `pricing.html` enters `/pricing`, whose pre-launch owner redirects
to `/`; the historical source file is not a separately served marketing page.

### 4.1 Public / auth

| Page | Audience | Purpose · operation |
|---|---|---|
| `/` | all | Landing / entry; routes to login or app. |
| `/login` | all | Google OAuth + access-code activation → `POST /auth/activate` (sets `users.is_active`, permissions, marks `access_codes` used). |
| `/onboarding` | new user | First-time setup (band target, level, goals) → `/auth/*` profile write. |
| `/pricing` | public | Pre-launch server redirect to `/`; no pricing controls or payment promise are currently served here. |

### 4.2 Student — Speaking

| Page | Audience | Purpose · operation |
|---|---|---|
| `/home` | student | Multi-skill hub; links to each skill. Pulls home summary (`/api/student/*`). |
| `/speaking` | student | Speaking dashboard — session history + create new (`POST /sessions`, daily cap 24). |
| `/practice/session` | student | Recording state machine; submit audio → `POST /sessions/{id}/responses` (`grading.py`: Whisper + Claude). Full-test chains 3 sessions. |
| `/result` | student | Single-question speaking result (band + feedback panels + audio replay). |
| `/full-test-result` | student | Full 3-part test result; band aggregation at `PATCH /sessions/{id}/complete`. |
| `/profile` | student | Profile, band target, study goals. |
| `/speaking/result` | student | Speaking feedback workspace, separate from the single-question and full-test result entries. |

### 4.3 Student — Writing

| Page | Audience | Purpose · operation |
|---|---|---|
| `/writing/dashboard` | student | Essay queue + submit (gated by `permissions.writing`) → `/api/writing/*` (Gemini grader). |
| `/writing/result` | student | Per-essay feedback (12-section analysis, tips). |

### 4.4 Student — Listening

> Deep reference: [`listening-architecture.md`](listening-architecture.md) — per-type schema/payload/endpoint/grading + the full-test pack pipeline + the convergence proposal.

| Page | Audience | Purpose · operation |
|---|---|---|
| `/listening` | student | Listening hub. |
| `/listening/browse` · `/listening/tests` | student | Browse exercises / Cambridge full tests (`GET /api/listening/*`). |
| `/listening/dictation` · `/listening/gist` · `/listening/tf` · `/listening/mcq` | student | Standalone per-type players keyed by canonical `content_id` — play audio, submit server-graded attempts and render canonical feedback (`/api/listening/dictation/*/boot`, `/api/listening/content/*`, `/api/listening/exercises`, `/api/listening/attempts`). Dictation boot withholds reference transcripts until each segment is graded. |
| `/listening/test/session` · `/listening/mini-test` | student | Full / mini test players (attempt + score). |
| `/listening/skills` | student | Skills Practice — skill drills grouped by question type (`GET /api/listening/tests?test_type=drill`); each drill reuses the mini-test player + review. |
| `/listening/practice-run` | student | Native Luyện nhanh runner keyed by exact `?id=`. It reads the stripped practice bundle, resumes before any destructive start, records only the first answer, loops the question audio after a miss, reveals the canonical answer only after two confirmed misses, and reconciles ambiguous start/submit ACKs through owner GETs. |
| `/listening/dictation/session` | student | Chép chính tả — per-sentence dictation on a test's audio (auto-clip when timed), completion report (time/accuracy/error trends) + content-error flagging (`/api/listening/tests/dictation/*`). |
| `/listening/review` | student, plus admin preview | Native submitted-only chữa-bài: score/band floor, wrong-answer focus, section transcript, rich per-question solution and real audio-window seek (`GET /api/listening/tests/attempts/{id}/review`). `?admin_test_id=` opens the honest no-score admin preview; mock-sealed attempts remain backend-gated until release. |
| `/listening/analytics` | student | Personal listening analytics. |
| `/listening/practice` | student | Quick-practice selection workspace; chosen exercises open the practice runner. |

### 4.5 Student — Reading

| Page | Audience | Purpose · operation |
|---|---|---|
| `/reading/vocab` | student | L1 vocab-passage library list (`GET /api/reading/vocab` list). |
| `/reading/vocab/[slug]` | student | One L1 passage — glossary popovers + 3-toggle pane (Gốc / Dịch / Grammar) + light comprehension Qs (`GET /api/reading/vocab/{slug}`, `.../check`). |
| `/reading/skill` | student | L2 skill-exercise library list. |
| `/reading/skill/[slug]` | student | One L2 exercise — same panes + skill-tagged Qs (`GET /api/reading/skill/{slug}`). |
| `/reading/test` | student | L3 full-test browse (`GET /api/reading/test`). |
| `/reading/mini-test` | student | Mini-test selection and practice workspace. |
| `/reading/exam/session` | student **or anonymous** | L3 exam: boot + start + auto-save + submit (`/api/reading/test/{id}/boot`, `/attempts`, `/answers`, `/submit`). Locked tests prompt a password; `?share=<token>` → anonymous boot/start via `/api/reading/test/share/{token}/*` carrying `X-Reading-Anon`. |
| `/reading/review` | student **or anonymous**, plus admin preview | Native post-submit chữa-bài: score/band/skill + rich per-Q solution (`GET /api/reading/test/attempts/{id}/review`; `?anon=` → `X-Reading-Anon`). `?admin_test_id=` opens the honest no-score admin preview. Solution is stripped during the test, revealed only here; old HTML URLs are permanently redirected to their native owners. |
| `/exam` | student | Native multi-source exam player (Phase 3; TOEIC Part 5 first). `?id=` plays an exam (MCQ → submit → caller-owned result + KP-aware review stepper); no id lists published exams and `?source=` filters them (`GET /api/exams[?source]`, `/api/exams/{id}`, `POST /{id}/attempts`, `/attempts/{id}/review`). React guards account/request staleness and double-submit; a review-read failure retries only the safe GET, never the attempt POST. A right/wrong answer feeds `kp_evidence`. |

### 4.5b Student — Mock Test (4-skill, sealed)

| Page | Audience | Purpose · operation |
|---|---|---|
| `/full-test` | student | Full-test **entry** — lists the currently-open mock exams (`GET /api/mock-exams`, published + `is_open` + cohort-eligible) and links to the runner. Reachable from a card on `/home`. |
| `/mock-exam` | student | Native 4-skill mock **runner** (SEQUENTIAL, admin-gated). `?code=` opens/resumes a sitting; there is no student "Start" — the admin opens Listening → Reading → Writing one at a time (`POST /admin/mock-exams/{id}/advance`), and the runner polls canonical state under the shared server clock. Reading/Listening run through stable core-player admission and flush pending answers before collection; Writing keeps local + server drafts and reuses one immutable final payload across lost-ACK reconciliation. Retake mode exposes only assigned skills, scores stay sealed until release; historical source retention is tracked separately by Gate F. |
| `/mock/result` | student | Mock TRF result — 4 bands + overall + examiner comment. `GET /api/mock-exams/sittings/{id}/result` returns 403 until an admin releases the sitting. |

### 4.6 Student — Vocabulary

| Page | Audience | Purpose · operation |
|---|---|---|
| `/vocabulary/hub` | student | Vocab hub landing (Từ vựng theo chủ đề / Flashcards / Exercises); mounts the tab modules. |
| `/flashcards` · `/flashcard-study` | student | Flashcard stacks + SRS study (`/api/flashcards/*`, SM-2). |
| `/exercises` · `/d1-exercise` | student | Fill-blank vocab exercises (`/api/exercises/*`). |
| `/vocabulary` | all | Vocabulary reference wiki — categories, article selection, pronunciation, usage and collocations; distinct from the authenticated practice hub. |
| `/vocabulary/practice` | student | Active vocabulary practice by set, with progress and review. |
| `/vocabulary/exam` | student | Exam-oriented vocabulary workspace. |
| `/vocabulary/learn` · `/vocabulary/learn/[unitSlug]` | student | Curated learning-unit catalogue and the selected unit lesson. |
| `/quiz` · `/quiz/progress` | student | Quick-Check quiz player and persisted practice statistics. |

### 4.7 Student — Grammar Wiki

| Page | Audience | Purpose · operation |
|---|---|---|
| `/grammar` | all | Grammar Wiki landing (`/api/grammar/*`). |
| `/grammar/[category]/[slug]` | all | One grammar article. |
| `/grammar/compare` | all | Compare confusable pairs. |
| `/grammar/roadmap` | all | Learning-path roadmap. |
| `/grammar/search` | all | Search the wiki. |
| `/grammar/exercises` | all | Grammar practice directory linked from the reference wiki. |

### 4.7b Student — classes and course work

| Page | Audience | Purpose · operation |
|---|---|---|
| `/my-class` | student | My Class workspace for class activity and assigned work. |
| `/course-exercises` | student | Session-based course exercises; opens the learner exercise/answer/review flow. |

### 4.8 Admin — landing + dashboards

| Page | Audience | Purpose · operation |
|---|---|---|
| `/admin` | admin | Admin Overview (pedagogical: students, skills, errors — `/admin/*` + `admin_overview.py`). |
| `/admin/dashboard/reading-attempts` | admin | Native Reading-attempts dashboard — frozen snapshot, truthful partial/unavailable states, auth + anonymous (approximate), band/skill/time, per-test, recent (`GET /admin/dashboard/reading-attempts`). The old HTML URL now redirects to this native owner. |
| `/admin/foot-traffic` · `/admin/usage` | admin | Visitor foot-traffic analytics + canonical per-user/access-code session and logged AI-cost rollups. |
| `/admin/error-logs` | admin | Error-report inbox (`/admin/error-logs`). |
| `/admin/system` · `/admin/system/ai-usage` · `/admin/system/alerts` | admin | System health, AI token usage, alerts. |
| `/admin/feedback` | admin | Learner-feedback inbox and inspection workspace. |

### 4.9 Admin — content authoring (per skill)

| Page(s) | Audience | Purpose · operation |
|---|---|---|
| `/admin/speaking` · `/admin/speaking/sessions` · `/admin/speaking/topics` | admin | Native Speaking operations hub, session grading/rebuild workspace and topic management. |
| `/admin/writing` · `/admin/writing/grade` · `/admin/writing/new` · `/admin/writing/prompts` · `/admin/writing/assignments` · `/admin/writing/status` · `/admin/writing/tips` · `/admin/writing/cohorts` · `/admin/writing/instructor-queue` · `/admin/writing/regrade-requests` | admin / instructor | Writing authoring + grading workflow (`/api/admin/writing/*`, `admin_writing*.py`): compose, grade, prompt library, assign, status, tips, cohorts, instructor queue, regrade requests. |
| `/admin/listening` · `/admin/listening/content/[contentId]` · `/admin/listening/content/[contentId]/edit` · `/admin/listening/segments` · `/admin/listening/gist` · `/admin/listening/tf` · `/admin/listening/mcq` · `/admin/listening/tests` · `/admin/listening/tests/[testId]` · `/admin/listening/import-fulltest` · `/admin/listening/import-drills` · `/admin/listening/audit` · `/admin/listening/audit-detail` · `/admin/listening/attempts` · `/admin/listening/dictation` | admin | Listening operations (`/admin/listening/*`): native inventories, canonical content/test detail, versioned metadata editing, exact-block Dictation, Gist, T/F/NG and MCQ authoring, full-test/drill ingestion, quality inventory/repair, learner attempts and dictation evidence own clean routes. Exercise writes require canonical GET reconciliation, preserve distinct `order_num` blocks and never replay ambiguous POSTs. Standalone Gist/T/F/MCQ authoring may keep multiple drafts, but application preflight plus migration 209's partial unique index permit exactly one published block per content/type so every “published” label remains learner-reachable even under concurrent writes. Gist exposes AI/fallback/pass truth; T/F and MCQ expose exact answer-key meaning and all-correct completion rules. Attempt and dictation history distinguish association lookup failure from missing records; test detail reconciles mode, audio, maps and lifecycle with backend truth. Full-test import binds all four files to one SHA-256 identity. Drill import binds Source JSON/timings/audio by authoritative Test ID, labels metadata-only versus audio-ready, blocks audio without timings, writes one durable receipt before every sequential POST and requires exact list/detail GET reconciliation. Neither importer archives an existing test inside an ambiguous upload. Quality audit reads the complete stable test inventory, separates current structural/audio evidence from the last persisted structural+LLM run and never counts lookup failure as clean. Audit detail sends version tokens, reads back every edit, chooses exact section audio, uses paid-run receipts with GET-only recovery and rejects false clean triage. (ElevenLabs assembly remains active inside test detail; standalone audio cutter / convert DOCX were decommissioned 2026-07-17 — usage audit.) Deep ref: [`listening-architecture.md`](listening-architecture.md). |
| `/admin/reading/content` | admin | Native Reading content manager — mandatory dry-run, import L1/L2/L3 (`POST /admin/reading/content/import`, `/import-bundle`), exact mixed-source pagination, canonical readback and per-L3 exam-only/lock/share/attempt-safe delete controls. |
| `/admin/reading/preview?test_id=…` · `/admin/reading/preview` | admin | Native paper-QA workspace: passages, answer keys, alternatives, explanations, parsed IMG-PROMPT and one upload/delete control per consecutive diagram/flow block; every image mutation reconciles through canonical GET. |
| `/admin/grammar` · `/admin/grammar/articles` · `/admin/grammar/analytics` · `/admin/grammar/recommend-test` | admin | Native Grammar content-operations hub, file-based article inventory, truthful analytics and no-persistence recommendation lab. Articles remain repository-authored Markdown; these native surfaces expose no content mutation. |
| `/admin/vocab` · `/admin/vocab/lemmas` · `/admin/vocab/stats` · `/admin/vocab/exercises` · `/admin/vocab/d1-curation` | admin | Vocab bank curation, lemmas, stats, exercise authoring + D1 curation. |
| `/admin/vocab/content` · `/admin/vocab/topics` | admin | Vocabulary content inventory and topic organisation. |
| `/admin/vocab/quiz` · `/admin/vocab/quiz-analytics` | admin | Quick-Check import/authoring and learner-result analytics. |
| `/admin/vocab/curated` · `/admin/vocab/pilot-metrics` | admin | Curated-unit editorial review/publication and pilot metrics. |
| `/admin/reading` | admin | Reading operations entry linking content, attempt analytics and feedback workspaces. |
| `/admin/writing/queue` | admin | Writing grading queue: triage from AI grading through review and returning work. |
| `/admin/mock-tests` | admin | Combined mock-test operations entry with management, review and writing sections. |
| `/admin/mock-live` · `/admin/mock-pacing` | admin | Live exam-room monitoring and detailed pacing for a selected sitting. |
| `/admin/mock-reviews/report` | admin | Mock score-report workspace for the selected review/exam. |
| `/admin/mock-exams` | admin | Full-test **management** — create an exam (pick Listening/Reading tests, PUBLISHED-only, + Writing task1/task2 prompts + a cohort/class + Reading/Writing minutes), publish, **live open/close** (`is_open`, gates who can even register), then walk the seated block forward ONE SECTION AT A TIME via **"Mở phần tiếp theo"** (`POST /{id}/advance`) — Listening → Reading → Writing — watching live "đã nộp X/Y" counts per section. A chosen test is reserved (hidden from the practice lists). `/admin/mock-exams/*`, `admin_mock_exams.py`. |
| `/admin/mock-reviews` | admin | 4-skill mock review console — queue → atomic claim → 4 skill tabs (Listening/Reading AI draft, Writing text or `/admin/writing/grade` deep-link, Speaking session links) → enter final bands (overall computed server-side) → release (lifts the seal). `/admin/mock-reviews/*`, `admin_mock_reviews.py`. |

### 4.10 Admin — people + access

| Page | Audience | Purpose · operation |
|---|---|---|
| `/admin/users` | admin | All users (role, activation, sessions-today). |
| `/admin/students` | admin | Student roster (Tailwind page). |
| `/admin/classes` · `/admin/classes/[cohortId]` | admin | Class roster and selected class workspace: students, attendance, lessons and assigned work (`/admin/cohorts/*`). |
| `/admin/users?tab=codes` | admin | Access-code tab — issue, assign, revoke; canonical ownership via `user_code_assignments` (legacy fallback `access_codes.used_by`). |
| `/admin/instructors` | admin | Instructor management workspace. |

### 4.11 Instructor — writing review

| Page | Audience | Purpose · operation |
|---|---|---|
| `/instructor` | instructor | Instructor dashboard and assigned work. |
| `/instructor/grade` · `/instructor/compare` | instructor | Writing grading and version comparison/merge workspaces. |

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

When you add or rename a product page under `frontend/app`, add its canonical
URL pattern, audience and purpose to the matching §4 table. The sentinel
`frontend/tests/site-overview-coverage.test.mjs` checks native owners for page
references, the unchanged **85%** product-route coverage floor, six required
spine routes and the README link. API paths in the operation column are not UI
routes. Any historical HTML names mentioned in prose must be registered in the
durable retirement manifest and have a present Next owner; physical HTML is not
required. A declared source-walk limitation fails closed for unsupported routing
conventions; compiled route ownership remains a separate build check. These
checks do not execute UI interactions or verify endpoint/pedagogical prose.
The native-only denominator assumes the separate cutover/redirect checks keep
proving zero directly served legacy HTML; this documentation sentinel does not
replace those guards or certify an unregistered non-Next surface.
