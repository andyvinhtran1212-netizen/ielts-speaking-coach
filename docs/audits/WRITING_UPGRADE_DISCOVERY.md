# Writing Upgrade — Discovery (read-only, NOT built)

Scope: map model + exam UI + upload bug + probe grammar/spell libs to scope 4 build-commissions
(W-BUG, W-ASSIGN, W-UI, W-SOFTCHECK). Date: 2026-06-15. **MEASURED** = read in code/probe; **INFERRED** = reasoned.

---

## TL;DR headlines (change the scoping)

1. **W-UI is ~80% already built.** Live word-count, countdown timer, auto-submit-on-expiry, AND spellcheck-disable (7 attrs incl. Grammarly opt-outs) ALL EXIST in `writing-dashboard.html`. **Only 2-pane layout is net-new.** [MEASURED]
2. **Timer fields already exist** (`is_timed`, `time_limit_minutes`, `started_at`, `auto_submitted`; mig 039) — **no migration for timer/auto-submit.** [MEASURED]
3. **W-ASSIGN is strictly 1 prompt → 1 assignment → 1 essay → 1 feedback.** Full 1→N ripple list below. `name/label` + assignment-level `soft_check` flag = net-new fields. [MEASURED]
4. **W-BUG:** writing prompt-image upload uniquely uses **Cloudinary** (everything else = Supabase Storage). Fails either 503 (missing creds) or a generic `except Exception → 500` that masks the real error. Need Andy's exact status + Railway log to pin which. [MEASURED code path; INFERRED prod cause]
5. **W-SOFTCHECK:** `nspell`+`dictionary-en` = **STRONG for spelling** (187KB gz dict, async/opt-in, 0 false-positives, caught all 12 errors). `write-good` = **POOR for grammar** (style linter; misses ESL grammar, adds noise). **No good lightweight client lib for real ESL grammar** → flag for Andy. [MEASURED]

---

## A. Model: assignment ↔ essay ↔ submit ↔ grade ↔ fan-out  [MEASURED]

`writing_assignments` (mig 036 + 039):
- `prompt_id UUID NOT NULL` (SINGLE prompt FK, ON DELETE RESTRICT)
- `student_id`, `essay_id` (nullable until submit), `assigned_by`, `instructions` (free text, NOT a title)
- status enum: pending/in_progress/submitted/graded/delivered + `submitted_at/graded_at/delivered_at`, `deadline`
- timer (mig 039): `is_timed BOOL`, `time_limit_minutes INT`, `started_at`, `auto_submitted BOOL`
- ❌ NO `name`/`label`; ❌ NO soft-check flag; cohort linkage via `students.cohort_id` (not on assignment)

Cardinality: **1 assignment = 1 essay** (`writing_assignments.essay_id`); **1 essay = 1 feedback** (`writing_feedback.essay_id` UNIQUE).
Submit `POST /api/writing/my-assignments/{id}/submit` creates exactly 1 essay, links back. [writing_student.py ~1052-1199]
Cohort fan-out `POST /admin/writing/assignments/fan-out`: **one assignment row per (student, prompt)**, idempotent on `(student_id, prompt_id)`. NOT a join table. [admin_writing_assignments.py ~262-334]

### A5 — 1→N ripple (the real W-ASSIGN scope)
Backend:
- `admin_writing_assignments.py`: `AssignmentCreate.prompt_id`, `FanOutCreate.prompt_id` → arrays; create/fan-out endpoints; dup-check `(prompt_id, student_id)`; `GET /{id}` single-prompt join.
- `writing_student.py`: `_resolve_active_assignment()` (joins single `writing_prompts`), `GET /my-assignments`, `GET /my-assignments/{id}`, submit (which prompt's essay?).
- `admin_writing_cohorts.py`: matrix `[student_id][prompt_id]` (lines ~129-183).
- `admin_writing.py` `GET /stats` (#464): status counts / turnaround keyed on essay — avoid double-count if N essays/assignment.
- delivered-badge (#463): assignment-level `status` — define "delivered" when ALL prompts graded?
Frontend:
- `writing-dashboard.html`: assignment card + submit modal read `assignment.writing_prompts` singular.
- `admin/writing/assignments.html`: single `select#form-prompt` → multi-select; dup warning.
- `admin/writing/cohorts.html`: matrix columns.

**Recommended model shape (INFERRED):** keep "1 row per prompt", add a grouping key (e.g. `assignment_group_id` + `name`) so an admin action = N rows grouped; admin UI shows grouped cards; existing per-row endpoints mostly survive. (Cleaner than `prompt_ids UUID[]`, which breaks PostgREST embeds.) ← Andy/Mình to chốt.
BLIND SPOT checked: model is NOT already 1→N. Confirmed 1→1.

## B. Exam/write UI (W-UI)  [MEASURED — `frontend/pages/writing-dashboard.html`]
Students write in the full-screen `#submit-modal` → `#modal-essay-textarea` (single-pane, prompt stacked above textarea).
| Feature | Status | Evidence |
|---|---|---|
| Live word count | ✅ EXISTS | `countWords()` 681-685, `#modal-word-counter` 1805, on `input` |
| Countdown timer | ✅ EXISTS | 1292-1342, server-authoritative (1s local + 30s sync), 5-min toast |
| Auto-submit on expiry | ✅ EXISTS | 1315-1320 `submitFromModal(true)`; also expired-on-open + 410 paths |
| Disable spellcheck | ✅ EXISTS | textarea 1790-1800: `spellcheck=false autocorrect=off autocapitalize=off data-gramm=false data-gramm_editor=false data-enable-grammarly=false autocomplete=off` |
| **2-pane layout** | ❌ NET-NEW | single-pane; can adapt `.rv-passage-layout` from reading-vocab.css |
Submit: `POST /api/writing/my-assignments/{id}/submit` body `{essay_text}`. Auto-save draft (3s debounce) + .docx/.txt upload already exist.
Other student textarea: `listening-gist.html #answer` (separate module, NOT spellcheck-protected — out of writing scope).

## C. W-BUG — Task 1 prompt-image upload  [MEASURED code; INFERRED prod cause]
- FE `admin/writing/prompts.html:245-268`: FormData field `file` → `POST /admin/writing/prompts/upload-image`.
- BE `admin_writing_prompts.py:151-204`: field matches; content-type `image/*` check; calls `cloudinary_service.upload_prompt_image()`.
- **Divergence:** uses **CLOUDINARY** (needs `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`). reading/listening image uploads use **Supabase Storage** (`supabase_admin.storage.from_(bucket).upload`) — no external creds.
- Failure modes: missing creds → `CloudinaryConfigError` → **503** w/ explicit msg; ANY other exception → generic **500 "Upload failed. Please try again."** (`except Exception`, line ~202) that **masks the real error**.
- Local `backend/.env` has NO `CLOUDINARY_*`. Prod is Railway (may/may not have them) — **need Andy's exact HTTP status + Railway log line** to disambiguate 503-creds vs 500-masked.
- **Suggested fix (Andy to pick):** (a) provision Cloudinary creds on Railway; or (b) **refactor to Supabase Storage** to match the rest (removes external dep — recommended structurally); plus quick win: log/surface the real exception instead of swallowing it.

## D. W-SOFTCHECK library probe  [MEASURED — probed in /tmp, not committed]
Integration into vanilla-JS/Vercel: ship as a small JS module + **async-load the dict only when soft-check is enabled** (opt-in), via CDN or bundled asset. Not render-blocking.
Sizes (gzipped = browser download): **dict `.dic` 187KB**, nspell ~4KB, write-good small. Raw node_modules 1.1M.
Quality on a realistic ESL learner essay (12 planted spelling + several grammar errors):
- **nspell (spelling): STRONG.** Caught ALL 12 misspellings (Nowdays→Nowadays, beleive→believe, definitly→definitely, comunicate→communicate, goverment→government, benificial→beneficial, …) with good top suggestions. **0 false-positives** on correct words. (`dependant` flagged — valid British spelling; minor.)
- **write-good (grammar/style): POOR fit.** Flagged only "many"=weasel, "for the most part"=wordy, "However"=wordy — **missed every real grammar error** (subject-verb "technology have", to/too, plural "new skill", "some peoples") and its flags are noise/false-positives for IELTS (flagging linking words as "wordy" is bad advice).
**Verdict:** spell-check half = solved client-side with nspell (cheap, accurate, opt-in). **Grammar half has no good lightweight client lib** (write-good/retext = style/readability linters, not ESL grammar). Comprehensive ESL grammar (agreement/tense/articles) realistically needs a server (e.g. LanguageTool) — **flagged, NOT chosen** (Andy prioritizes a lib; his call whether to ship spell-only now, add targeted retext rules like a/an + repeated-words, or stand up a grammar API later).

## E. Cross-cutting
- time-limit: ✅ exists (mig 039) → timer/auto-submit need no migration.
- assignment name/label: ❌ net-new field.
- soft-check flag: ❌ net-new; natural home = assignment-level boolean (per-assignment admin tick), thread to exam UI + (optionally) grader.
- spellcheck-disable: ✅ already on the only writing textarea (best-effort; can't block every extension).

---

## Suggested sequencing (for Mình to chốt)
1. **W-BUG** (quick): confirm 503-vs-500 from Railway log; provision creds OR refactor to Supabase Storage + stop swallowing the error.
2. **W-ASSIGN** (model + migration): the 1→N backbone — biggest ripple; do before W-UI 2-pane since exam reads assignment shape. Add `name` + grouping + soft-check flag in same migration.
3. **W-UI** (small): just 2-pane layout (rest exists). Cheap once W-ASSIGN shape is settled.
4. **W-SOFTCHECK** (lib): nspell spell-check, async/opt-in, gated by the assignment soft-check flag. Grammar half = separate decision.
