# Sprint 12.0 — Admin IA Refactor Discovery

**Cluster:** DEBT-ADMIN-IA-REFACTOR (opens this sprint)
**Predecessor cluster:** DEBT-LISTENING-MODULE — CLOSED on 2026-05-18 via PR #216 (Sprint 11.5)
**Discovery date:** 2026-05-18
**Author:** Claude Opus 4.7
**Pattern reference:** Sprint 11.0 listening discovery (`docs/sprint-11-0-listening-discovery.md`)

---

## 0. Discovery process

Inventory carried out by:

1. Direct file glob across `frontend/pages/admin-*.html` (12 pages) +
   `frontend/admin.html` (1 hub) = **13 admin pages total**.
2. Direct file glob across `backend/routers/admin*.py` (6 files) + admin
   sub-router inside `backend/routers/listening.py` (1 router) +
   verification grep across the 6 router files for `@router.<method>`
   decorators.
3. Migration sweep across `backend/migrations/0[01-59]*.sql` to map the
   schema state of admin-relevant tables (`users`, `students`,
   `access_codes`, `user_code_assignments`, `writing_*`, `listening_*`,
   `vocab_*`, `grammar_*`).
4. Cross-reference of inventory findings against Andy's 2026-05-18
   request + the 3 pre-locked decisions in the commission prompt.

**Falsifications captured during inventory** are listed at §9.

---

## 1. Frontend admin pages inventory (13 pages)

### 1.1 Per-page table

| # | File | Title (vi) | Purpose | Endpoints called | Arrived from |
|---|---|---|---|---|---|
| 1 | `frontend/admin.html` | Admin — IELTS Speaking Coach | Monolithic admin hub: Speaking sessions list + filters, access codes management, topics + question library, AI usage, vocab stats, flashcards stats, alerts | `/admin/users`, `/admin/stats`, `/admin/access-codes` (GET/POST/PATCH/DELETE), `/admin/topics` + `/admin/topics/{id}/questions` (full CRUD + bulk + generate), `/admin/ai-usage`, `/admin/sessions` + `/admin/sessions/{id}`, `/admin/alerts`, `/admin/responses/{id}/regrade`, `/admin/vocab/stats`, `/admin/flashcards/stats` | Direct URL or top-right "📝 Writing Coach" from `pages/home.html` |
| 2 | `frontend/pages/admin-writing.html` | Tác giả viết luận | Writing Coach hub — card grid linking to the 5 writing sub-pages | None directly (nav-only) | `admin.html` top-right link |
| 3 | `frontend/pages/admin-writing-new.html` | Soạn bài viết | Admin submits an essay on behalf of a student: paste text + metadata + analysis level + form-of-address + select grading model | `POST /admin/writing/essays`, `GET /admin/writing/prompts` (for prompt picker) | `admin-writing.html` |
| 4 | `frontend/pages/admin-writing-grade.html` | Chấm bài viết | Review AI feedback, edit annotations, save revised feedback, trigger regrade | `GET /admin/writing/essays/{id}`, `PATCH /admin/writing/essays/{id}/feedback`, `POST /admin/writing/essays/{id}/regrade` | `admin-writing.html` + `admin-writing-status.html` row click |
| 5 | `frontend/pages/admin-writing-status.html` | Trạng thái chấm | Poll the grading pipeline state of all essays (pending → grading → graded → reviewed → delivered) | `GET /admin/writing/essays/status` | `admin-writing.html` |
| 6 | `frontend/pages/admin-writing-assignments.html` | Gán bài tập | Bulk assign library prompts to cohorts/students with due dates | `GET /admin/writing/assignments`, `POST /admin/writing/assignments`, `PATCH /admin/writing/assignments/{id}` | `admin-writing.html` |
| 7 | `frontend/pages/admin-writing-prompts.html` | Thư viện câu prompt | CRUD library prompts with image upload | `GET/POST/PATCH/DELETE /admin/writing/prompts`, `POST /admin/writing/prompts/upload-image` | `admin-writing.html` |
| 8 | `frontend/pages/admin-instructor-queue.html` | Hàng đợi Instructor | Queue of instructor-tier essays pending human review; claim / release / deliver workflow | `GET /admin/instructor/queue`, `POST /admin/instructor/reviews/{id}/{claim|release|deliver}` | `admin-writing.html` |
| 9 | `frontend/pages/admin-students.html` | Quản lý học viên | Students CRUD + bulk CSV import + summary modal | `GET/POST/PATCH/DELETE /admin/students`, `POST /admin/students/import` | **No nav entry — direct URL only** |
| 10 | `frontend/pages/admin-listening-segments.html` | Chia cắt audio | Upload audio, render via ElevenLabs, segment into per-sentence clips + assign timestamps | `POST /admin/listening/upload`, `POST /admin/listening/render`, `GET /admin/listening/content/{id}`, `POST /admin/listening/exercises` (segments JSONB upsert) | **No nav entry — direct URL only** |
| 11 | `frontend/pages/admin-listening-gist.html` | Tác giả bài Gist | Gist exercise authoring: prompt + model answer + rubric keywords | `GET /admin/listening/content/{id}`, `GET/POST /admin/listening/exercises` | **No nav entry — direct URL only** |
| 12 | `frontend/pages/admin-listening-tf.html` | Tác giả bài T/F | T/F/NG statement authoring (3-12 statements) | `GET /admin/listening/content/{id}`, `GET/POST /admin/listening/exercises` | **No nav entry — direct URL only** |
| 13 | `frontend/pages/admin-listening-mcq.html` | Tác giả bài MCQ | MCQ authoring (1-20 questions, 4 options A-D each) | `GET /admin/listening/content/{id}`, `GET/POST /admin/listening/exercises` | **No nav entry — direct URL only** |
| 14 | `frontend/pages/admin-listening-mini-test.html` | Tác giả Mini Test | Assemble mini-test from the published exercise pool (any mix of gist + T/F + MCQ + dictation) | `GET /admin/listening/content?status=published`, `GET /admin/listening/exercises?content_id={id}`, `GET/POST /admin/listening/sessions` | **No nav entry — direct URL only** |

### 1.2 Navigation drift summary (key finding #1)

- `admin.html` is the historical hub, but it bundles **Speaking management
  + Vocab management + Flashcards management + Access codes + Topics +
  AI usage + Alerts** into a single ~2000-line monolithic page with
  tabs/sections — no per-skill section page exists.
- `admin-writing.html` is a proper hub with a card grid pointing to its
  5 sub-pages.
- The 5 Listening admin pages + the Students page are **unreachable from
  any other admin page**. Admins must paste the URL manually.

This is the single biggest IA gap and the headline driver of the cluster.

---

## 2. Module data-surface coverage by skill

| Module | Admin pages | Admin endpoints | Tables backing | CRUD completeness | Gaps |
|---|---|---|---|---|---|
| **Speaking** | 0 dedicated pages (logic bundled inside `admin.html`) | `/admin/sessions`, `/admin/sessions/{id}`, `/admin/responses/{id}/regrade`, `/admin/sessions/{session_id}/regrade`, `/admin/sessions/{session_id}/rebuild-summary`, `/admin/topics` + `/admin/topics/{id}/questions` (full CRUD + bulk generate/rotate) | `sessions`, `responses`, `topics`, `topic_questions` | Topics + questions: full CRUD. Sessions: read + regrade only. **No prompt mgmt distinct from topics, no rubric mgmt, no attempts review UI.** | Speaking lacks a dedicated landing page; bundled inside `admin.html` tabs. No way to dogfood a single Speaking practice attempt from admin. No grading rubric edit. |
| **Writing** | 5 pages: hub + new + grade + status + assignments + prompts + instructor queue | `/admin/writing/essays` (GET/POST/{id}/feedback PATCH/{id}/regrade POST/status), `/admin/writing/prompts` (GET/POST/PATCH/DELETE/upload-image), `/admin/writing/assignments` (GET/POST/PATCH), `/admin/instructor/queue` + `/admin/instructor/reviews/{id}/(claim\|release\|deliver)` | `writing_essays`, `writing_feedbacks`, `writing_prompts`, `writing_assignments`, `writing_assignment_students`, `writing_drafts`, `writing_grading_tier_*`, `writing_instructor_reviews`, `students` | Essays: full lifecycle (submit → grade → review → deliver). Prompts: full CRUD with image upload. Assignments: create + update + list. Instructor queue: claim / release / deliver. | **Most complete admin surface in the app.** Minor gaps: no analytics on essay throughput, no instructor productivity dashboard. Not in scope for this cluster — defer to Phase B. |
| **Listening** | 5 pages (segments + gist + tf + mcq + mini-test) | `/admin/listening/upload`, `/admin/listening/render`, `/admin/listening/content` (GET list + GET {id}), `/admin/listening/exercises` (GET/POST/DELETE), `/admin/listening/sessions` (POST/GET) | `listening_content`, `listening_exercises`, `listening_attempts`, `listening_sessions`, `listening_session_exercises` (no — no junction table; exercise_ids is UUID[]) | Content: upload + render + list + status filter. Exercises: 5 types fully authored. Sessions: mini-test composition. | Just shipped (Sprint 11.5). No analytics dashboard for admin (only per-user). |
| **Vocab** | 0 admin pages | `/admin/vocab/stats`, `/admin/users/{user_id}/vocab-flag`, `/admin/vocab/backfill-enrichment`, `/admin/flashcards/stats` | `user_vocabulary`, `user_d1_questions`, `flashcard_stacks`, `flashcard_cards`, `flashcard_reviews` | Stats: read-only summary. Backfill: bulk operation. Flag: per-user per-word. | **No D1 question curation UI** (Sprint 10.5 admin fallback mode added but no editor). **No lemma/IPA correction UI.** **No vocab archive UI.** |
| **Grammar** | 0 admin pages | None | `grammar_recommendations`, `grammar_articles` (markdown files in `backend/content/`), `saved_articles` (per-user) | Articles authored as markdown files in repo; rendered server-side. Recommendations generated per-attempt by `claude_grader._save_grammar_recommendations`. | **No admin UI for articles** (they live as `*.md` files in the repo — possibly intentional). No way to test grammar recommendations against synthetic attempts. |
| **Students / Users** | 1 page (`admin-students.html`) | `/admin/students` (GET/POST/PATCH/DELETE), `/admin/students/import`, `/admin/users` (read-only from inside `admin.html`) | `students`, `users`, `access_codes`, `user_code_assignments` | Students: full CRUD + bulk CSV. Users (auth): list only. Access codes: full CRUD (lives inside `admin.html`). | **No unified users dashboard.** Students lives at a hidden URL. No cohort concept yet. No role assignment UI. |
| **Instructor Queue** | 1 page (`admin-instructor-queue.html`) | `/admin/instructor/queue`, `/admin/instructor/reviews/{id}/*` | `writing_instructor_reviews`, `writing_essays` | Claim / release / deliver workflow complete. | Per Sprint 2.7d.1: instructor IS admin; no separate role split yet. |
| **Tổng quan dashboard** | 0 pages (no global landing) | `/admin/stats`, `/admin/users`, `/admin/ai-usage`, `/admin/alerts`, `/admin/vocab/stats`, `/admin/flashcards/stats` | Many tables aggregated | Stats endpoints exist but render inside `admin.html` tabs, not as a Tổng quan landing. | **No proper landing page** — admins arrive at the Speaking-centric tabbed dashboard. |
| **Báo lỗi (error logs)** | 0 pages | None | **No table exists** | n/a — feature not yet shipped. | Per Andy 2026-05-18 decision (c): build custom `error_logs` table + admin UI + capture hooks. |
| **Truy cập (access codes)** | 0 dedicated pages (lives in `admin.html`) | `/admin/access-codes` (GET/POST/PATCH/DELETE/{id}/users) | `access_codes`, `user_code_assignments` | Full lifecycle: generate, list, edit, delete, revoke per-user. | No code-type discriminator yet. Cohort linkage missing. Usage analytics missing. |

### 2.1 Module completeness summary

| Module | Admin surface state | Cluster scope |
|---|---|---|
| Speaking | Partial — bundled in `admin.html` | **Extract + reorganize** (Sprint 12.5) |
| Writing | Complete | **Place in new IA, no rebuild** (Sprint 12.1) |
| Listening | Complete | **Place in new IA, no rebuild** (Sprint 12.1) |
| Vocab | Stats-only | **Add D1 curation + lemma mgmt** (Sprint 12.6) |
| Grammar | None | **Add articles CRUD** (Sprint 12.7) |
| Students | 1 page, hidden | **Polish + cohort schema** (Sprint 12.2 + 12.8) |
| Error logs | Not built | **New module** (Sprint 12.3) |
| Access codes | Embedded in admin.html | **Extract + cohort-aware** (Sprint 12.2) |
| Tổng quan dashboard | Not built | **Build** (Sprint 12.4) |

---

## 3. Schema inventory (admin-relevant tables)

### 3.1 Foundation tables

#### `users` (Migrations 005 + 013 + 019)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Supabase `auth.users.id` mirror |
| `email` | TEXT | unique |
| `display_name` | TEXT | |
| `role` | TEXT | **Discovered values:** `'admin'`. **No `'instructor'`, no `'student'` role exists today.** Default `NULL` for end-users. |
| `is_active` | BOOLEAN | account toggle |
| `permissions` | JSONB | per-feature flags |
| `onboarding_completed`, `target_band`, `exam_date`, `self_level`, `preferred_topics` | misc | profile |

**Helper SQL function:** `is_current_user_admin()` (Migration 033) —
returns true if `auth.uid()` row in `users` has `role = 'admin'`. Used
by 18+ RLS policies across the codebase.

#### `students` (Migration 033 — Sprint W0)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | own PK |
| `student_code` | TEXT UNIQUE | activation code (1-to-1 with student) |
| `full_name` | TEXT | |
| `target_band`, `target_date`, `persona_notes`, `current_band_estimate` | misc | profile |
| `user_id` | UUID FK → `users(id) ON DELETE SET NULL` | Phase 2 linkage: NULL until student activates via `/activate` |
| `created_by` | UUID FK → `users(id)` | admin who created the row |

**Activation flow (Migration 034):** `/activate` endpoint matches
`student_code` → sets `students.user_id = auth.uid()`. After activation,
RLS extends `writing_essays` + `writing_feedback` for student
self-read.

**MISSING:** `cohort_id` column. **MISSING:** `cohorts` table entirely.

#### `access_codes` (Migration 009)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | own PK |
| `code` | TEXT | XXXX-XXXX format |
| `session_limit` | INTEGER | quota |
| `expires_at` | TIMESTAMPTZ | |
| `is_active` | BOOLEAN | revocation flag |
| `is_used`, `used_by`, `used_at` | legacy | preserved post-activation |
| `permissions` | JSONB | per-feature flags |

#### `user_code_assignments` (Migration 009)

Junction table — many-to-many between users and codes. Active rows
are the canonical-ownership truth (per `CLAUDE.md` admin section). Both
list + detail endpoints synthesize a fallback from
`access_codes.used_by` when no active assignment row exists.

### 3.2 Per-module tables (admin touchpoints)

- **Speaking:** `sessions` (Sprint 1.x), `responses`, `topics`,
  `topic_questions`.
- **Writing:** `writing_essays`, `writing_feedbacks`, `writing_prompts`,
  `writing_assignments`, `writing_assignment_students`, `writing_drafts`,
  `writing_instructor_reviews` (Migrations 033-047).
- **Listening:** `listening_content`, `listening_exercises`,
  `listening_attempts`, `listening_sessions` (Migrations 056-059).
- **Vocab:** `user_vocabulary`, `user_d1_questions`, `flashcard_stacks`,
  `flashcard_cards`, `flashcard_reviews` (Migrations 019-055).
- **Grammar:** `grammar_recommendations` (Migration 014, 032),
  `saved_articles` (Migration 015). Articles themselves live as `.md`
  files in `backend/content/` (no DB table).

### 3.3 Missing tables (gap matrix → § 6 migrations)

| Table | Purpose | Migration | Driver |
|---|---|---|---|
| `cohorts` | Andy's "code đại trà vs học viên trực tiếp" + class assignment | **060** | Andy lock 3 |
| `error_logs` | Frontend + backend exception capture | **061** | Andy lock c (2026-05-18) |

### 3.4 Schema linkage gap

The `students` table FK-links to `users` via `user_id`. The
`listening_attempts`, `user_vocabulary`, `responses`, and most other
attempt-tracking tables FK-link to `users(id)` directly via `user_id`.

**Open question:** When an admin views a student's progress across all
skills, should the join go `students.user_id` → `users.id` →
`{module}_attempts.user_id`? **Discovery answer: YES.** No new
`student_id` columns needed across module tables. The admin students
page can `JOIN students ON students.user_id = X` to derive everything.

This is the single biggest schema dividend — admin can implement a
"per-student progress" view across all 5 skills without any new FKs.

---

## 4. Gap matrix vs Andy's request (2026-05-18)

| Andy request item | Inventory finding | Gap | Cluster sprint |
|---|---|---|---|
| **"Refactor lại admin pages"** | 13 pages, fragmented IA, no sidebar | Build sidebar + IA route restructure | 12.1 |
| **"Có từng phần cho từng kĩ năng"** | Speaking bundled inside `admin.html`; Vocab + Grammar have no surface | Extract Speaking; build Vocab + Grammar | 12.5 + 12.6 + 12.7 |
| **"Phần riêng cho admin quản lý access/code/usage"** | Access codes lives in `admin.html`; no usage analytics | Extract into "Truy cập" section + add cohort discriminator | 12.2 |
| **"Quản lý speaking; writing"** | Speaking gap; Writing complete | Speaking admin (Sprint 12.5); Writing place-in-IA (12.1) | 12.1 + 12.5 |
| **"Bài tập" admin** | Ambiguous — could mean "all exercises meta-view" or "specific gaps" | **Interpretation:** Means per-skill exercise mgmt — already covered by skill sections | (folded into per-skill sprints) |
| **"Báo lỗi"** | No `error_logs` table; no UI | Build table + capture hooks + admin UI | 12.3 |
| **"Quản lý học viên/người dùng"** | Students page exists but hidden | Promote into IA + add User mgmt section | 12.8 |
| **"Phân biệt code đại trà và code học viên do mình trực tiếp quản lý có thể phân vào lớp"** | No `cohort` concept exists | Schema only this cluster (Migration 060). UI deferred to Phase B per Andy lock 3 | 12.2 schema + Phase B UI |

---

## 5. Proposed Information Architecture (IA)

### 5.1 Sidebar structure (canonical, locks via this Discovery)

```
ADMIN  (sidebar collapsed/expanded — persistent across pages)
├─ 🏠 Tổng quan                     /pages/admin/index.html
│
├─ 📚 Nội dung
│  ├─ Speaking                       /pages/admin/speaking/index.html
│  ├─ Writing                        /pages/admin/writing/index.html
│  ├─ Listening                      /pages/admin/listening/index.html
│  ├─ Vocab                          /pages/admin/vocab/index.html
│  └─ Grammar                        /pages/admin/grammar/index.html
│
├─ 👥 Người dùng
│  ├─ Học viên                       /pages/admin/students/index.html
│  ├─ Tất cả người dùng              /pages/admin/users/index.html
│  └─ Lớp / Cohort   (Phase B)       /pages/admin/cohorts/index.html  (placeholder card)
│
├─ 🔑 Truy cập
│  ├─ Mã kích hoạt                   /pages/admin/access-codes/index.html
│  └─ Usage logs     (Phase B)       /pages/admin/usage/index.html    (placeholder card)
│
├─ 🐛 Báo lỗi                       /pages/admin/error-logs/index.html
│
└─ ⚙️ Hệ thống      (Phase B+)     /pages/admin/system/index.html    (placeholder)
```

### 5.2 Route convention decision

**Locked:** Adopt nested folder routes `/pages/admin/<section>/<page>.html`
for new pages. The existing flat URLs (`admin-writing.html`,
`admin-students.html`, etc.) **stay live with 301 redirects** to the new
canonical paths, written into `vercel.json` (matches the
`dashboard.html` → `/pages/speaking.html` redirect pattern locked in
Sprint 5.1).

**Rationale:**

- Sidebar active-state needs the URL path to expose its section + page.
  Flat URLs would require a hardcoded mapping table.
- Nested routes scale linearly when new sub-pages are added (e.g.
  `/pages/admin/listening/segments.html` + `/pages/admin/listening/mcq.html`).
- 301 redirects preserve any bookmarks Andy or other admins have.
- The existing `admin.html` at repo root maps to
  `/pages/admin/index.html` to honor the "Tổng quan" landing.

### 5.3 Sidebar component design

- **Implementation:** New web component `<aver-admin-chrome>` in
  `frontend/js/components/aver-admin-chrome.js`. Shadow-DOM, follows the
  Sprint 7.14 `<aver-chrome>` pattern.
- **Persistence:** Sidebar collapse state stored in `localStorage` under
  `av-admin-sidebar-collapsed` (default expanded on desktop, collapsed
  on mobile per `prefers-reduced-motion` + viewport check).
- **Active state:** Sidebar reads `window.location.pathname` and applies
  `data-active` to the matching `<li>`. Pattern match: `<aver-chrome>`
  uses `<aver-chrome active="listening">` attribute; admin chrome can
  derive its active section from the path so no attribute is needed.
- **Auth gate:** Sidebar component renders only after a
  `getCurrentUser()` check returns `role === 'admin'`. Sprint 12.1
  ships the gate alongside the component.

### 5.4 Migration path for existing pages (Sprint 12.1)

| Old URL | New URL | Redirect type |
|---|---|---|
| `/admin.html` | `/pages/admin/index.html` | 301 |
| `/pages/admin-writing.html` | `/pages/admin/writing/index.html` | 301 |
| `/pages/admin-writing-new.html` | `/pages/admin/writing/new.html` | 301 |
| `/pages/admin-writing-grade.html` | `/pages/admin/writing/grade.html` | 301 |
| `/pages/admin-writing-status.html` | `/pages/admin/writing/status.html` | 301 |
| `/pages/admin-writing-assignments.html` | `/pages/admin/writing/assignments.html` | 301 |
| `/pages/admin-writing-prompts.html` | `/pages/admin/writing/prompts.html` | 301 |
| `/pages/admin-instructor-queue.html` | `/pages/admin/writing/instructor-queue.html` | 301 |
| `/pages/admin-students.html` | `/pages/admin/students/index.html` | 301 |
| `/pages/admin-listening-*.html` (5 pages) | `/pages/admin/listening/<page>.html` | 301 |

All 301s land in `vercel.json` per the existing Sprint 5.1 convention.

---

## 6. Schema migrations (proposed for execution sprints)

### 6.1 Migration 060 — `cohorts` table + `students.cohort_id`

Ships in **Sprint 12.2**. Schema:

```sql
CREATE TABLE IF NOT EXISTS cohorts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    code_prefix   TEXT,                              -- e.g. "JAN26"
    description   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS cohort_id UUID
    REFERENCES cohorts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_cohort_id ON students(cohort_id);
```

**RLS posture:** `cohorts` table — admin-only read/write (matches the
existing `is_current_user_admin()` pattern). `students.cohort_id` —
inherits the existing `students` RLS policy (admins manage everything;
students read self-only via `user_id = auth.uid()`).

**Semantics:**

- `cohort_id IS NULL` → "code đại trà" (mass code flow — bulk import,
  not in a class).
- `cohort_id IS NOT NULL` → "học viên do mình trực tiếp quản lý" (direct
  teaching, has a class).

**Admin UI:** NOT shipped this cluster. Schema-only per Andy lock 3.
Phase B sprint (TBD post-cluster) ships the cohort CRUD UI.

### 6.2 Migration 061 — `error_logs` table

Ships in **Sprint 12.3**. Schema:

```sql
CREATE TABLE IF NOT EXISTS error_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level         TEXT NOT NULL CHECK (level IN ('error', 'warning', 'info')),
    source        TEXT NOT NULL CHECK (source IN ('frontend', 'backend')),
    message       TEXT NOT NULL,
    stack         TEXT,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    url           TEXT,
    user_agent    TEXT,
    request_id    TEXT,
    extra         JSONB,
    dismissed_at  TIMESTAMPTZ,
    dismissed_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_error_logs_occurred_at
    ON error_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_undismissed
    ON error_logs (occurred_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id
    ON error_logs (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all error logs" ON error_logs
    FOR SELECT USING (is_current_user_admin());

CREATE POLICY "Admins dismiss error logs" ON error_logs
    FOR UPDATE USING (is_current_user_admin());

CREATE POLICY "Backend inserts via service role" ON error_logs
    FOR INSERT WITH CHECK (true);
```

**Capture hooks (Sprint 12.3):**

- **Frontend:** `frontend/js/error-reporter.js` wraps `window.onerror` +
  `unhandledrejection` + a manual `window.aver.reportError(msg, ctx)`
  helper. Sends POST to `/api/error-logs` with `source='frontend'`.
- **Backend:** FastAPI exception handler (`backend/main.py`)
  intercepts unhandled exceptions, posts to `error_logs` with
  `source='backend'`. Add `request_id` header propagation for traceback
  correlation.
- **Rate limiting:** Frontend reporter dedupes by `(message, stack)`
  per session (in-memory Set) so a runaway `for` loop in user code
  doesn't flood the DB.

### 6.3 Migration 062 — `access_codes` extensions (decision: extend existing, don't replace)

Ships in **Sprint 12.2**. Schema:

```sql
ALTER TABLE access_codes
    ADD COLUMN IF NOT EXISTS code_type   TEXT NOT NULL DEFAULT 'mass'
        CHECK (code_type IN ('mass', 'direct', 'staff')),
    ADD COLUMN IF NOT EXISTS cohort_id   UUID REFERENCES cohorts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS notes       TEXT;

CREATE INDEX IF NOT EXISTS idx_access_codes_cohort_id
    ON access_codes (cohort_id) WHERE cohort_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_codes_code_type
    ON access_codes (code_type);
```

**Decision:** Andy's "code đại trà vs học viên trực tiếp" maps directly
to `access_codes.code_type` discriminator. **Do NOT introduce a new
table** — extend the existing 16-column `access_codes` with 3 columns.

**Rationale:**

- `access_codes` already has the activation lifecycle (`is_used`,
  `used_by`, `used_at`, `expires_at`, `is_active`, `session_limit`,
  `permissions`).
- Introducing a second access table would split ownership (the
  `students.student_code` activation flow is separate from the
  user `access_codes` flow), but Andy's request is about
  classifying the existing codes, not replacing them.
- `students.student_code` stays as the per-student onboarding token;
  `access_codes` is the per-purchase / per-class license.

**Migration backfill:** All existing `access_codes` rows get
`code_type='mass'` by default (the legacy posture).

### 6.4 Migration 063+ (deferred — propose only if discovery reveals need)

The Speaking, Vocab, Grammar admin pages MAY need new tables; Discovery
finds **NONE required** for the planned admin features:

- Speaking prompt mgmt → uses existing `topics` + `topic_questions`
- Speaking attempts review → uses existing `sessions` + `responses`
- Vocab D1 curation → uses existing `user_d1_questions`
- Grammar articles → already `.md` files in `backend/content/` (no DB
  required; admin UI is a file-tree editor)

If execution sprints surface a need, migrations 063+ will be planned at
that point.

---

## 7. Sprint plan (7 sprints + closure)

| Sprint | Scope | Effort | Migrations | New pages | New routers / endpoints | Tests |
|---|---|---|---|---|---|---|
| **12.1** | Admin sidebar shell + IA route restructure + 301 redirects | ~1 session | None | 1 (`<aver-admin-chrome>` web component) + nested folder structure | None (page moves only) | +20 sentinel tests for sidebar component + route map |
| **12.2** | Cohort schema + access-code extension + access-codes admin section | ~1 session | 060 + 062 | `/pages/admin/access-codes/index.html` (extracted from `admin.html`) | New endpoints: `GET /admin/cohorts`, `POST /admin/access-codes` extended with `code_type` + `cohort_id`. Cohort CRUD endpoint stubs (UI deferred) | +25 backend + 12 frontend |
| **12.3** | Error logs schema + frontend/backend capture hooks + admin UI | ~1 session | 061 | `/pages/admin/error-logs/index.html` + `error-reporter.js` | `POST /api/error-logs`, `GET /admin/error-logs`, `POST /admin/error-logs/{id}/dismiss` | +20 backend + 10 frontend |
| **12.4** | Tổng quan dashboard (cross-module aggregates) | ~0.5-1 session | None | `/pages/admin/index.html` (replaces `admin.html` body content) | `GET /admin/overview` (aggregates from existing per-module stats endpoints) | +15 backend + 8 frontend |
| **12.5** | Speaking admin extraction + minimal feature surface | ~1 session | None | `/pages/admin/speaking/index.html` + `/pages/admin/speaking/topics.html` + `/pages/admin/speaking/sessions.html` (extracted from `admin.html` tabs) | None (endpoints unchanged) | +15 sentinel tests pinning the extraction |
| **12.6** | Vocab admin pages (D1 curation + lemma mgmt) | ~1 session | Maybe 063 (if Discovery + execution finds gap) | `/pages/admin/vocab/index.html` + `/pages/admin/vocab/d1.html` + `/pages/admin/vocab/lemmas.html` | `GET /admin/vocab/d1-questions`, `PATCH /admin/vocab/d1-questions/{id}`, `POST /admin/vocab/lemmas/correct` | +20 backend + 10 frontend |
| **12.7** | Grammar admin pages (articles browser + dogfood test) | ~0.5-1 session | None | `/pages/admin/grammar/index.html` + `/pages/admin/grammar/articles.html` | `GET /admin/grammar/articles` (lists markdown files), `POST /admin/grammar/preview` (dogfood a synthetic recommendation) | +15 backend + 8 frontend |
| **12.8** | Students / Users polish + instructor role split decision + cluster closure | ~1 session | Maybe 064 (if instructor role split happens) | `/pages/admin/students/index.html` (polish) + `/pages/admin/users/index.html` (new) | `GET /admin/users` (extended with role filter) | +20 backend + 10 frontend |

**Total estimate:** ~6-7 sessions across 8 sprints. Adjust per Discovery
findings in execution.

**Phase B (post-cluster):** Cohort UI, Usage logs, Hệ thống settings,
broader Stripe / Email / SEO clusters (separate planning).

---

## 8. Pattern dividends (Sprint 10.8-style)

Reusable patterns this cluster can lean on without inventing new ones:

| Pattern | Source sprint | Use case in cluster |
|---|---|---|
| `<aver-chrome>` web component | Sprint 7.14 | New `<aver-admin-chrome>` follows same shadow-DOM + active-state architecture (12.1) |
| `require_admin()` auth helper | All admin routers since Sprint 2.5+ | Every new endpoint in 12.2-12.8 reuses verbatim |
| `is_current_user_admin()` SQL helper | Migration 033 | Every new RLS policy in 060-063 reuses |
| `students.student_code` activation flow | Migration 034 / Sprint W0 | Cohort-aware extension in 12.2 — `students.cohort_id` joined at activation time |
| `access_codes` + `user_code_assignments` 2-table pattern | Migration 009 | Extended (not replaced) in 12.2 |
| 301 redirect in `vercel.json` | Sprint 5.1 (`dashboard.html`) | Used for all 12+ page URL moves in 12.1 |
| LCS / pure-helper export pattern | Sprint 11.3.1 | Useful for error log dedup helper in 12.3 |
| BackgroundTask pattern | Sprint 11.1 | Error log writes can be fire-and-forget BackgroundTask to avoid blocking the response |
| Discovery-then-execute | This sprint (12.0) | Sprint 12.1 commission prompt drafted from this doc after Andy sign-off |
| Sentinel-string frontend tests | Sprint 11.x | Each new admin page gets a sentinel test pinning IDs + endpoint URLs |
| Falsification capture in PHASE_CLOSURE_LEDGER | Sprint 11.x | This cluster's row will capture falsifications progressively |
| Two-table fake (`_FakeAdminClient` test pattern) | Sprint 11.4 / 11.5 | Reuse verbatim for backend tests of new endpoints |

---

## 9. Falsifications captured during Discovery

| # | Claim before Discovery | Reality | Impact |
|---|---|---|---|
| #66 | "Admin uses sidebar nav" | **No sidebar.** `admin.html` has a top bar only; tabs inside the page; 6/13 pages have NO navigation entry at all (Listening admin + Students). | Cluster's headline driver — solved by Sprint 12.1. |
| #67 | "All access code mgmt lives at admin-access-codes.html" | **No such page.** Access codes are managed inside `admin.html` (the monolith) via the `/admin/access-codes` endpoints. | Extraction is a Sprint 12.2 task. |
| #68 | "Speaking admin has its own page" | **No.** Speaking management is bundled inside `admin.html` (sessions list, topics, attempts review). | Extraction is a Sprint 12.5 task. |
| #69 | "`students` table has `cohort_id`" | **No.** `students` has 8 columns and links to `users` via `user_id` but has NO cohort linkage. | Migration 060 needed (12.2). |
| #70 | "`access_codes` discriminates mass vs direct" | **No.** `access_codes` has 16+ columns including permissions JSONB but no `code_type`. | Migration 062 extends (12.2). |
| #71 | "An `error_logs` table exists somewhere" | **No.** No error capture exists. `ai_usage_logs` (Migration 031) is the only related table — different shape, AI-cost-specific. | Migration 061 + capture hooks needed (12.3). |
| #72 | "Instructor role split is needed in this cluster" | **Decision deferred.** Sprint 2.7d.1 comment confirms admin == instructor today. Splitting requires a separate `users.role='instructor'` value + a `require_instructor` guard + adjusted RLS policies. **Recommendation: defer to Sprint 12.8 closure decision, not bundled with sidebar work.** | 12.8 picks up if Discovery review escalates. |
| #73 | "Grammar articles are in a DB table" | **No.** They are `.md` files in `backend/content/<category>/<slug>.md` (file-tree authored). Admin UI for grammar is a file browser, not a DB CRUD. | Sprint 12.7 scope adjusted accordingly. |
| #74 | "`admin.html` is a thin landing page" | **No.** It is a ~2000-line monolithic dashboard that owns 12+ feature areas. The "extract" work is non-trivial. | Sprint 12.4 (overview) + 12.5 (Speaking extract) + 12.2 (access codes extract) all carve from this one file. |
| #75 | "Listening attempts will need `student_id`" | **No.** `listening_attempts.user_id` + `students.user_id` is sufficient for the per-student admin view. **No new FK columns needed across module tables.** | Schema discipline preserved. |
| #76 | "Vocab + Grammar already have admin pages" | **No.** Zero admin pages for either. | Sprints 12.6 + 12.7 build from scratch. |

---

## 10. Not in scope this sprint (and this cluster)

### 10.1 Out of scope for Sprint 12.0 (this Discovery)

- Any code changes.
- Any migration execution.
- Any commit besides the doc + PHASE_CLOSURE_LEDGER + Phase B trigger
  doc (if Andy wants one).
- Sprint 12.1+ commission prompt drafting (waits for Andy sign-off on
  this Discovery).

### 10.2 Out of scope for the entire DEBT-ADMIN-IA-REFACTOR cluster

- **Cohort management UI** — schema only (Migration 060). UI deferred to
  Phase B per Andy lock 3 (2026-05-18).
- **Usage logs admin UI** — placeholder card only in the Truy cập section.
  Full implementation Phase B.
- **Commercial launch features** (Stripe, email, SEO) — separate cluster
  post-12.x.
- **CSS / Tailwind refactor of admin pages** — `admin-writing.css` is at
  cap per § 17.6. New components ride existing tokens.
- **Instructor role split** — schedule-dependent. If Discovery review
  flags as urgent, ship in 12.8; otherwise Phase B.
- **Backwards-compat of inline scripts inside `admin.html`** — the
  monolith is iteratively carved across 12.4 + 12.5 + 12.2. Each sprint
  removes its respective scripts/markup from `admin.html` and adds
  them to the dedicated new page.

---

## 11. Acceptance criteria (Sprint 12.0 closure)

- [x] `docs/sprint-12-0-admin-discovery.md` written
- [x] All 13 admin pages inventoried with route + purpose + endpoints + nav entry
- [x] All 6 admin routers + `listening.py` admin section inventoried
- [x] Per-module gap matrix complete
- [x] IA proposal locks sidebar groups, route convention, redirect strategy
- [x] Schema gaps with migration numbers 060/061/062 drafted
- [x] Sprint plan with rough effort per sprint
- [x] Pattern dividends list
- [x] Falsifications captured (11 total: #66-#76)
- [ ] PHASE_CLOSURE_LEDGER row opening DEBT-ADMIN-IA-REFACTOR cluster — **added below in PR commit**
- [ ] PR ships doc-only (no code, no migrations) — Vercel green expected

---

## 12. Next step

Andy reviews this Discovery doc + signs off (or requests edits). On
sign-off, draft Sprint 12.1 commission prompt — the prompt includes:

- Branch name: `sprint-12-1-admin-sidebar-shell`
- Estimate: ~1 session
- Scope:
  - Build `<aver-admin-chrome>` web component
  - Restructure `frontend/pages/admin/` folder (move 13 pages to nested
    paths with internal hrefs updated)
  - Add 13 redirects to `vercel.json`
  - Replace `admin.html` body with the new sidebar + Tổng quan placeholder
  - Pin the sidebar + route map with sentinel tests
- PR title: `Sprint 12.1: Admin sidebar shell + IA route restructure`

**Phase B trigger doc** (`docs/sprint-12-9-phase-b-trigger-criteria.md`)
will be drafted at cluster closure (Sprint 12.8) — same pattern as
`docs/sprint-11-6-phase-b-trigger-criteria.md`.
