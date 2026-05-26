# Sprint 19.0 — WRITING-COACH REFINEMENT Discovery

**Cluster:** 19.x WRITING-COACH REFINEMENT
**Type:** Discovery-first, multi-direction (A/B/C) — **zero feature LOC** (Pattern #43)
**Date:** 2026-05-26
**HEAD audited:** `eb1a361d` (cluster 18.x closure). This PR is doc-only, based on `main`.
**Author:** Code (autonomous). Commission treated as hypothesis; Code PF empirical authoritative (Pattern #42).

> **If you wrote the commission, read Section 7 first.** The "Mind-side blind spots" log
> assumed ~10 features *might not exist*. Empirically, **9 of 10 already exist** — the
> Writing-Coach is a mature, shipped subsystem (5 routers, 8 services, 9 migrations, 9 frontend
> pages, 7 DB tables). The real cluster-19.x work is **refinement, gap-filling, and a cohort
> model decision** — not greenfield build. Several Direction-A/B asks are already 70-90% built.

---

## Section 0 — Surface inventory at a glance

| Layer | Count | Files |
|---|---|---|
| **Backend routers** | 5 | `writing_student.py`, `admin_writing.py`, `admin_writing_assignments.py`, `admin_writing_prompts.py`, `admin_instructor.py` |
| **Backend services** | 8 | `essay_service.py`, `gemini_writing_grader.py`, `writing_history.py`, `writing_word_exporter.py`, `instructor_workflow.py`, `writing_prompt_loader.py`, `writing_render.py`, `file_extract_service.py` |
| **DB tables** | 7 | `students`, `writing_essays`, `writing_feedback`, `writing_jobs`, `writing_prompts`, `writing_assignments`, `writing_drafts`, `instructor_reviews` |
| **Migrations** | 9 core (+grading-events) | `033`–`039`, `043`, `044`, `046`, `047` |
| **User frontend** | 2 | `pages/writing-dashboard.html`, `pages/writing-result.html` |
| **Admin frontend** | 7 | `pages/admin/writing/{index,new,grade,assignments,prompts,status,instructor-queue}.html` |

Next free migration number = **082** (latest is `081_user_code_assignments_audit.sql`).

---

## Section 1 — User-facing inventory (Direction A)

### 1.1 Entry point & navigation

- Student home (`pages/home.html:117`) renders a `data-skill="writing"` card; `js/home.js:211-221`
  navigates to `data.primary_cta_url` (backend-resolved) → **`pages/writing-dashboard.html`**.
- The dashboard is **assignment-driven**, not free-write. Two tabs (`writing-dashboard.html:131-141`):
  `📋 Bài giao` (assignments) and `✅ Bài đã nộp` (submitted essays). A student writes only
  against a prompt an admin assigned — there is **no self-serve "pick a prompt and write" path**
  on the user side (`writing_prompts` library is admin-only via RLS, migration `035:46-52`).

### 1.2 Submission flow

| Step | Endpoint | Evidence |
|---|---|---|
| Load assignments | `GET /api/writing/my-assignments` | `writing-dashboard.html:912`, `writing_student.py:762` |
| Auto-save draft | `PATCH /api/writing/my-assignments/{id}/draft` (3 s debounce) | `writing-dashboard.html:693-731`, `writing_student.py:876` |
| Start timer (IELTS mode) | `POST /api/writing/my-assignments/{id}/start` | `writing_student.py:1279` |
| Submit | `POST /api/writing/my-assignments/{id}/submit` | `writing-dashboard.html:863`, `writing_student.py:963` |
| File→text helper | `POST /api/writing/extract-text` (.docx/.txt) | `writing_student.py:1437`, `file_extract_service.py` |

- **Draft persistence is server-side, not localStorage** — `writing_drafts` table, one row per
  assignment, hard-deleted on submit (migration `037:1-11`). Word-count is a generated STORED column.
- **Confirmation UX:** green toast "Bài viết đã được gửi thành công! ✓", modal closes, both lists
  refresh (`writing-dashboard.html:871-893`).
- A `.docx`/`.txt` upload parser exists (`extract-text`) — extracted text is appended to the
  textarea client-side; the parser is **stateless** (`file_extract_service.py:9-27`, 2 MB / 15 000-char cap).

### 1.3 History / "tổng bài đã làm"

**Exists.** The `✅ Bài đã nộp` tab (`GET /api/writing/my-essays`, `writing_student.py:136`) lists
submitted essays with 4 filter chips — `Tất cả / Đã chấm / Đang chấm / Bị đánh dấu`
(`writing-dashboard.html:154-182`). Status badge supports 6 states
(`pending, submitted, grading, graded, reviewed, delivered, failed`; `writing-dashboard.html:194-223`).

### 1.4 PDF / download — **it's `.docx`, not PDF**

`writing-result.html:125` exposes a "Tải .docx" button → `GET /api/writing/my-essays/{id}/export.docx`
(`writing-result.html:501`, `writing_student.py:325`), rendered by `writing_word_exporter.py` (python-docx).
**There is no writing-PDF path** — speaking uses ReportLab PDF, writing uses Word `.docx`. Direction A's
phrasing "tải PDF bài đã chấm" is satisfiable today by the existing `.docx` export (or a new PDF renderer
if PDF is a hard requirement — architectural Q, Section 6).

### 1.5 Result display

`writing-result.html:134-150` — 5 tabs: **Tổng quan** (band + 4 IELTS criteria + trajectory),
**Nhận xét lỗi** (mistakes + recurring), **Phân tích nâng cao** (lexical / sentence structure /
coherence / idea development / counterargument), **Bài mẫu** (improved essay + AI-detection),
**Note giảng viên** (conditional, read-only). Feedback only renders when `status === 'delivered'`
(`writing-result.html:388-430`); pre-delivery shows "Giảng viên đang review… 24-48 tiếng".

### 1.6 Deadlines / "bài sắp đến hạn"

**Partial.** Deadlines render inline on assignment cards ("Hạn: {date}", `writing-dashboard.html:534`)
and `writing_assignments.deadline` has a partial index (migration `036:59-63`). There is **no dedicated
"upcoming / overdue" surface or sort** — a student scans the `Bài giao` tab manually.

### 1.7 Writing tips / task guidance — **does not exist**

No writing-tips, Task-1/Task-2 guidance, or grammar-wiki-style content surface exists on the user side
(confirmed absent across both user pages). Direction A's "tab gợi ý W task 1 + task 2 (admin publish
dạng grammar wiki)" is a **genuine greenfield gap**.

### 1.8 Re-grade / return interaction — **student side is read-only**

No student-initiated re-grade request, resubmit, or revision UI exists. Instructor notes are display-only.
(Admin *can* regrade — Section 2.5 — but the student cannot *request* it.)

---

## Section 2 — Admin-facing inventory (Direction B)

### 2.1 IA / hub

`pages/admin/writing/index.html:73-88` is a 4-card hub: **Submit New Essay** (`new.html`),
**Review + Edit** (`grade.html`), **Instructor Queue** (`instructor-queue.html`), **Students**
(`/pages/admin/students/index.html`). Two more pages exist but aren't on the hub grid:
`assignments.html` and `prompts.html` (reached via chrome nav / direct link). `status.html` is a
per-essay grading poller reached via redirect.

### 2.2 Cohort-level view — **does not exist**

There is **no class/cohort writing view**. `assignments.html` targets **individual students** via a
multiselect checkbox picker (`assignments.html:120-133`, payload `student_ids: [...]`,
`assignments.html:427-434`). `status.html` polls a **single** `essay_id` (`status.html:188`).
`instructor-queue.html` is a **global** queue, not cohort-scoped. Direction B's "bài giao theo lớp +
bảng status theo lớp" is a **genuine gap** — and the schema makes it *cheap* to add (Section 2.9).

### 2.3 Grading interface (`grade.html`, ~81 KB)

Flow: open `grade.html?essay_id=…` → readonly essay in `<pre>` → 4 editable tabs (overview / mistakes /
advanced / sample). Criteria use the IELTS 4-axis model — `mainCriterion, coherenceCohesion,
lexicalResource, grammaticalRange` each `{title, explanation, feedback, bandScore}`
(`grade.html:577-622`). Edits save per-section via `PATCH /admin/writing/essays/{id}/feedback`
(`grade.html:1199`, `admin_writing.py:202`). **No inline/anchored annotations** — feedback is
section-level only; essay text is non-interactive.

### 2.4 Independent grading (admin-submitted, not via student web) — **exists, paste-based**

`new.html` lets an admin **paste** an essay (student dropdown, task type, level, model, form-of-address,
grading tier, prompt textarea, essay textarea — `new.html:72-169`) → `POST /admin/writing/essays`
(`admin_writing.py:103`, stamps `submitted_by_admin`). After grading, `grade.html` exports
`GET /admin/writing/essays/{id}/export.docx` (`admin_writing.py:346`) and "Mark delivered" supports
`method: 'google_docs_paste'` (`grade.html:1281-1297`, `admin_writing.py:265`). So **"upload bài không
qua web → grade → tải Word / copy Google Docs"** is ~90% built. **Gap:** admin side has *no file
upload* (paste only); the `.docx`/`.txt` parser (`file_extract_service.py`) is wired only to the
**student** `/extract-text` endpoint — reusing it on admin `new.html` is a small lift.

### 2.5 Communication features

| Feature | State | Evidence |
|---|---|---|
| Return essay to student | **Exists** — "Mark delivered" → `POST /admin/writing/essays/{id}/mark-delivered` | `grade.html:1281`, `admin_writing.py:265` |
| Add comment / note | **Exists** — `instructor_note` (≤1000 chars), shown on result page, survives regrade | `grade.html:129-133`, migration `043:35`, `047:55-59` |
| Re-grade (admin-initiated) | **Exists** — `POST /admin/writing/essays/{id}/regrade`, increments `regrade_count`, preserves `instructor_note` | `grade.html:1299-1325`, `admin_writing.py:444` |
| Re-grade *request* (student-initiated) | **Does not exist** | — |
| Multi-grader / "who graded" | **Single-grader** — `instructor_reviews.claimed_by` + `UNIQUE(essay_id)`; locked-by-other shown read-only | migration `047:48,68`, `grade.html:1494-1504` |

### 2.6 Status tracking (`status.html`)

Per-essay live poller (5 s interval, `status.html:102`) over
`pending → grading → graded → reviewed → delivered (/ failed)` with progress bar + ETA. Terminal states
stop polling. **Scope = one essay**, not cohort/global.

### 2.7 Assignments (`assignments.html`)

Modal: pick library prompt → multiselect students → optional deadline / instructions / IELTS timer
(`assignments.html:99-168`). `POST /admin/writing/assignments` (`admin_writing_assignments.py:201`).
**Targets individual students; no cohort dropdown** (see 2.2).

### 2.8 Prompts library (`prompts.html`) — the existing "CMS"

Full CRUD over `writing_prompts` (`admin_writing_prompts.py`): task-type (task2 / task1_academic /
task1_general), difficulty, prompt text, tags, and **image upload for Task 1 Academic** (Cloudinary,
`prompts.html:143-167`, `POST /admin/writing/prompts/upload-image`, `admin_writing_prompts.py:151`).
Seeded with 22 Task-2 prompts (migration `035:67-209`). **This is the closest existing analogue to
Direction A's "admin-published writing tips like grammar wiki"** — but it stores *prompts/tasks*, not
*tips/guidance*. A tips surface would be a new content type (Section 6).

### 2.9 Instructor queue (`instructor-queue.html`)

Work queue for **Instructor-tier** essays awaiting human review. Filters: All Active / Queued / My
Claims / Delivered. Columns: Submitted / Age (color-coded <24h/24-48h/>48h) / Student / Lvl / Task /
Status / Actions (Claim, Edit, Release, View). 30 s auto-refresh. Backed by
`GET /admin/instructor/queue` + claim/release/deliver (`admin_instructor.py:50-129`,
`instructor_workflow.py`).

---

## Section 3 — Backend API + DB schema inventory

### 3.1 Endpoint map

**Student** — `routers/writing_student.py`, prefix `/api/writing`:
`GET /my-essays` · `GET /my-essays/{id}` · `GET /my-essays/{id}/export.docx` · `GET /my-assignments` ·
`GET /my-assignments/{id}` · `PATCH /my-assignments/{id}/draft` · `POST /my-assignments/{id}/submit` ·
`GET /my-assignments/{id}/timer` · `POST /my-assignments/{id}/start` · `POST /my-assignments/{id}/paste-log` ·
`POST /extract-text`

**Admin essays** — `routers/admin_writing.py`, prefix `/admin/writing`:
`POST /essays` (202) · `GET /essays` · `GET /essays/{id}` · `GET /essays/{id}/status` ·
`PATCH /essays/{id}/feedback` · `POST /essays/{id}/mark-delivered` · `DELETE /essays/{id}` ·
`GET /essays/{id}/render` · `GET /essays/{id}/export.docx` · `GET /stats` ·
`PATCH /essays/{id}/instructor-note` · `POST /essays/{id}/regrade` (202) · `GET /students/{id}/summary`

**Admin assignments** — `routers/admin_writing_assignments.py`, prefix `/admin/writing/assignments`:
`GET ""` · `POST ""` (201) · `GET /{id}` · `PATCH /{id}` · `DELETE /{id}`

**Admin prompts** — `routers/admin_writing_prompts.py`, prefix `/admin/writing/prompts`:
`GET ""` · `POST ""` (201) · `POST /upload-image` · `GET /{id}` · `PATCH /{id}` · `DELETE /{id}`

**Admin instructor** — `routers/admin_instructor.py`, prefix `/admin/instructor`:
`GET /queue` · `POST /reviews/{id}/claim` · `POST /reviews/{id}/release` · `POST /reviews/{id}/deliver`

All mounted in `backend/main.py:111-116`.

### 3.2 DB schema (7 tables + 1 enum)

| Table | Migration | Key columns | RLS |
|---|---|---|---|
| `students` | `033:50-68`; `cohort_id` added `060` | `student_code`, `full_name`, `user_id→users`, `target_band`, `cohort_id→cohorts` | admin-all + self-read |
| `writing_essays` | `033:84-131` (+`043`,`044`) | `student_id`, `submitted_by_admin`, `task_type`, `prompt_text`, `essay_text`, `analysis_level`, `status`(6), `grading_tier`(enum), `admin_edits_json`, `instructor_note`, `is_manually_edited`, `regrade_count`, `delivery_method`(4) | admin-all + student-read-own |
| `writing_feedback` | `033:148-175` | 1:1 essay, `overall_band_score`, 4 band axes, `feedback_json`, `model_used`, tokens/cost | admin-all + student-read-own |
| `writing_jobs` | `033:184-200` | async queue: `job_type`, `attempt_count`/`max_attempts`, `status`(4) | service-role only (no policy) |
| `writing_prompts` | `035:16-33` | `task_type`, `prompt_text`, `title`, `difficulty`, `tags[]`, `is_active` | admin-all |
| `writing_assignments` | `036:19-50` (+timer `039`) | `prompt_id`, `student_id`, `essay_id`, `status`(5), `deadline`, `instructions`, `is_timed`/`time_limit_minutes`/`started_at`/`auto_submitted` | admin-all + student-read-own |
| `writing_drafts` | `037:13-41` | `assignment_id`(UNIQUE), `student_id`, `draft_text`, generated `word_count`; deleted on submit | admin-all + student-own |
| `instructor_reviews` | `047:28-69` | `essay_id`(UNIQUE), `status`(5), `claimed_by`, `claimed_at`, `delivered_at`, `instructor_note` | (admin/service) |

`grading_tier_enum = {quick, standard, deep, instructor}` (migration `044:12`):
quick = Flash 5-section, standard = Pro 12-section (default), deep = Pro multi-pass, instructor = human-reviewed.

### 3.3 Grading orchestration

Submission writes the essay row first, then atomically links + queues
(`writing_student.py:1069-1092`, "SAGA" ordering to avoid stuck assignments on crash). Grading runs as an
**in-process FastAPI `BackgroundTasks`** job (`writing_student.py:967`), via
`essay_service.create_essay_row_only` + `_bg_grade_essay`, model **Gemini 2.5 Pro**
(`gemini_writing_grader.py`; default `selected_model='gemini-2.5-pro'`, `033:101`). A spam/paste gate
(`detect_flags`, paste-event audit) forks flagged submissions before grading
(`writing_student.py:1045-1067`). **Note:** background-task grading is in-process — a Railway restart
mid-grade relies on `writing_jobs` retry semantics, not a durable external worker.

> **Speaking vs Writing grader split:** speaking grades with **Claude** (`claude_grader.py`); writing
> grades with **Gemini** (`gemini_writing_grader.py`). Two independent AI pipelines.

---

## Section 4 — End-to-end flow map (Direction C)

### Flow 1 — Student web submission (the primary path)
```
home.html (writing card) → writing-dashboard.html [Bài giao tab]
  → open assignment modal → (optional .docx upload → /extract-text) → type
  → autosave PATCH /my-assignments/{id}/draft  (writing_drafts, 3s debounce)
  → [if is_timed] POST /start stamps started_at; server enforces expiry
  → POST /my-assignments/{id}/submit
       → spam/paste gate (detect_flags)
       → essay_service.create_essay_row_only (writing_essays, status=pending)
       → atomic link essay_id onto assignment + delete draft
       → BackgroundTasks _bg_grade_essay (Gemini) → writing_feedback, status=graded
       → [if grading_tier=instructor] instructor_reviews row (status=queued)
  → writing-dashboard.html [Bài đã nộp] shows status badge
  → admin reviews (Flow 3) → status=delivered
  → writing-result.html (5 tabs) + GET /my-essays/{id}/export.docx
```

### Flow 2 — Admin independent grading (no student web submission)
```
admin/writing/new.html (paste essay, pick student/tier/level)
  → POST /admin/writing/essays (submitted_by_admin) → BG Gemini grade
  → status.html (poll) → grade.html (review/edit feedback)
  → PATCH /essays/{id}/feedback  (admin_edits_json, is_manually_edited)
  → Mark delivered (method=google_docs_paste) OR GET /export.docx
```

### Flow 3 — Instructor-tier human review
```
essay graded (AI Pass 1) + grading_tier=instructor → instructor_reviews(queued)
  → instructor-queue.html → Claim (atomic UPDATE WHERE status=queued)
  → grade.html edit + instructor_note
  → POST /admin/instructor/reviews/{id}/deliver
       → mirrors instructor_note → writing_essays.instructor_note
       → writing_essays.status = delivered
  (Release returns the row to the queue)
```

**Notification mechanism:** none found. State changes are **pull-based** — student/admin must reload or
poll (`status.html` 5 s, `instructor-queue.html` 30 s). No email/push/in-app notification on
delivered / returned / deadline-approaching.

---

## Section 5 — Two-chrome distinction (Pattern #11), current state

| Surface | Chrome | CSS stack | Verdict |
|---|---|---|---|
| **User** `writing-dashboard.html`, `writing-result.html` | own page header (no shared chrome component) | `aver-design/tokens.css` + `components.css` + `ds.css` + page CSS + Tailwind CDN | **Already on modern `av-*`/`ds.css` student tokens — NOT legacy `aw-*`** |
| **Admin** `admin/writing/*.html` (all 7) | `<aver-admin-chrome active="writing">` (shadow DOM) | `aver-design/tokens.css` + `components.css` + **`admin-writing.css`** (+`admin-writing-grade.css` for grade) | On canonical aver-admin chrome; **component classes are `aw-*`** layered on `av-*` tokens |

**Correction to blind-spot #9:** the user-facing writing pages are **not** on legacy Writing-Coach
chrome — they already use the `aver-design` token system + `ds.css`. The `aw-*` prefix is **not a chrome**
— it's a CSS *class-naming convention inside the admin writing stylesheets* (`admin-writing.css`,
`admin-writing-grade.css`), sitting on top of `av-*` design tokens. The admin writing pages already use
the same `<aver-admin-chrome>` shadow-DOM shell as the rest of admin (post-Sprint 18.x).

**One concrete debt:** admin writing pages link `tokens.css` + `components.css` + `admin-writing.css`,
but **not `admin-components.css`** — the file that grants `box-sizing: border-box` to admin pages
(see memory `reference_admin_box_sizing`). Worth verifying whether the writing admin pages have latent
overflow risk, or whether `admin-writing.css` sets its own box-sizing. (Out of scope to fix here — flag
for 19.1B.)

---

## Section 6 — Design-alignment gap snapshot (vs `av-*` aver-admin) — high-level, no mockup

- **User pages** are on `aver-design` tokens + `ds.css` but use a **bespoke per-page header** rather than
  a shared chrome. They predate the av-* "aver-admin" component polish the commission references for
  Direction A. Gap = visual consistency + adopting shared components, **not** a chrome migration.
- **Admin pages** are structurally aligned (shared `aver-admin-chrome`) but the `aw-*` class layer is a
  parallel naming system to the canonical `av-*` components — cosmetic-debt, not architectural.
- The `frontend-design` skill apply that Direction A wants is **deferred to 19.1A** per commission; this
  Discovery does not produce mockups.

---

## Section 7 — Mind-side blind-spot corrections (Pattern #42)

The commission honestly logged 10 premises it could not verify. Empirical results:

| # | Premise (Mình's guess) | Verdict | Evidence |
|---|---|---|---|
| 1 | "Tổng bài đã làm" view may not exist / be trivial | **EXISTS** — `Bài đã nộp` tab, 4 filters, 6 statuses | `writing-dashboard.html:154-223`, `writing_student.py:136` |
| 2 | PDF download may never have been built | **EXISTS as `.docx`** (not PDF) — both user & admin | `writing_student.py:325`, `admin_writing.py:346`, `writing_word_exporter.py` |
| 3 | Essay status may be bool flags, no enum | **WRONG** — 3 distinct CHECK-constrained status models (essay 6 / assignment 5 / review 5) | migrations `033:104`, `036:34`, `047:42` |
| 4 | Cohort assignment may not exist for essays | **CONFIRMED gap** — assignments target individual students; **but `students.cohort_id` exists** so cohort-derived is cheap | `036:26-27`, `060:` (cohort_id) |
| 5 | Grammar-wiki-style writing tips may not exist | **CONFIRMED gap** — no tips surface; `writing_prompts` is closest (stores prompts, not tips) | `035`, user pages |
| 6 | Independent grading interface may not exist | **EXISTS** — `new.html` paste → grade → export.docx / gdocs-paste | `new.html`, `admin_writing.py:103,346,265` |
| 7 | Re-grade request flow may not exist | **Split** — admin regrade EXISTS; student-initiated *request* DOES NOT | `admin_writing.py:444`; user pages |
| 8 | Multi-grader support may be missing | **CONFIRMED single-grader** — `instructor_reviews.claimed_by` + `UNIQUE(essay_id)`; schema comment notes future child-table path | `047:48,68` |
| 9 | User-facing writing may still be legacy `aw-*` chrome | **WRONG** — user pages on `aver-design`+`ds.css`; `aw-*` is admin CSS naming, not chrome | Section 5 |
| 10 | A dedicated `writing.py` router Mình doesn't know about | **WRONG shape** — no single file; **5 routers** (student + 4 admin) | `main.py:19-24` |

**Net:** the Writing-Coach is a *shipped, mature* subsystem. Cluster 19.x is **refinement**, with exactly
**two genuine greenfield gaps** (writing-tips surface §1.7, cohort-level views §2.2) and a handful of
"last-mile" lifts on features already 70-90% built.

---

## Section 8 — Architectural decisions to settle BEFORE Sprint 19.1

Code surfaces these; **Mình + Andy decide** (Pattern #42 — Code does not decide in Discovery).

| # | Decision | Empirical context | Code's lean (non-authoritative) |
|---|---|---|---|
| D1 | **Cohort assignment model** — assign essays by cohort directly, or keep individual-student assignment with cohort *derived* from `students.cohort_id`? | `writing_assignments.student_id` is per-student; `students.cohort_id` already exists | **Derive** — add a "assign to whole cohort" UI affordance that fans out to `student_ids`; keeps the row model stable. Cohort *views* read via join. |
| D2 | **Writing-tips / guidance content store** — new DB-backed CMS, reuse `writing_prompts`, or repo markdown like grammar wiki? | No tips surface today; grammar wiki is the published precedent | New lightweight table (e.g. `writing_tips`) mirroring grammar-wiki frontmatter; admin CRUD like `prompts.html`. |
| D3 | **Independent grading: file upload on admin side** — wire `file_extract_service` into `new.html`, or keep paste-only? | Parser exists, wired only to student `/extract-text` | Small lift — reuse parser; net-new value for Direction B. |
| D4 | **Export format** — is Direction A's "PDF" a hard requirement, or does existing `.docx` satisfy it? | Writing has `.docx` only; speaking has ReportLab PDF | Confirm with Andy; if PDF needed, reuse `pdf_generator.py` pattern. |
| D5 | **Cohort status board** — net-new admin page (cohort → students → essay-status table), and which statuses to roll up? | No cohort view; 3 separate status models exist | New page reading `writing_assignments` joined to `students.cohort_id`; roll up assignment.status. |
| D6 | **Multi-grader support** — keep single-grader (`UNIQUE(essay_id)`), or add `claim_history` child table now? | Schema comment (`047:18-20`) anticipated this | Defer unless multi-instructor is imminent; cheap to add later. |
| D7 | **Student-initiated re-grade request** — add request flow + status, or keep admin-only regrade? | Admin regrade exists; no student request | Needs a new status/signal + notification (D8). Product call. |
| D8 | **Notifications** — pull-only today. Add email/in-app for delivered / returned / deadline? | No notification mechanism found | Highest-leverage UX gap; scope separately. |
| D9 | **User chrome consolidation** — adopt a shared chrome/component set for user writing pages, or keep bespoke headers? | User pages use per-page headers on `ds.css` | Align in 19.1A with `frontend-design` skill; low risk (already on tokens). |

---

## Section 9 — Recommended sprint sequencing (Code's view — NOT authoritative)

Two ordering options for Mình + Andy. Both assume per-sprint LOC caps set post-Discovery.

**Option α — user-value first (A→B→C):**
1. **19.1A** — User-facing design align (`frontend-design` skill) + deadlines surface (§1.6) + history polish (§1.3). Lowest risk, all on existing endpoints.
2. **19.1B** — Writing-tips CMS (D2) — net-new but self-contained, grammar-wiki precedent.
3. **19.2** — Cohort status board (D5) + cohort-assign affordance (D1). Reads existing schema.
4. **19.3** — Independent-grading file upload (D3) + export-format decision (D4).
5. **19.4** — Flow polish (C): notifications (D8) + optional student regrade-request (D7).

**Option β — admin-leverage first (B→A→C):** swap 19.1A/19.1B with 19.2 if the teaching-ops cohort
board is the more urgent pain (Andy's "view theo lớp" was raised first).

**Sequencing rationale:** D1/D5 (cohort) are the highest-architecture-risk items but read-only against
existing schema, so they're safe mid-cluster. D2 (tips) and D8 (notifications) are the only true
net-new subsystems and should each own a sprint. The user design-align (D9/19.1A) is the cheapest
visible win and a good opener.

---

**END — Sprint 19.0 Discovery.** Doc-only PR. No code, schema, or migration changes.
