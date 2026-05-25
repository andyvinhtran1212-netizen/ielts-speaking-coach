# Sprint 16.0 — STORAGE-LIFECYCLE-AND-EXPORT Discovery

**Cluster:** 16.x STORAGE-LIFECYCLE-AND-EXPORT
**Type:** Discovery (lightweight, multi-direction — no feature code)
**Date:** 2026-05-25
**HEAD audited:** `5d8b2482` (Sprint 15.3.1) — the branch tip the empirical audit ran against. (This PR itself is based on `main` = `75046274` / PR #281 so the diff is doc-only.)
**Author:** Code (autonomous), commission treated as hypothesis (Pattern #42)

> **Read Section 9 first if you wrote the commission.** Two consequential spec errors invert
> the scope of Directions C and D. Everything downstream depends on those corrections.

---

## Section 1 — Empirical motivation recap

Four directives from Andy (2026-05-25, post cluster-15.x closure):

1. Auto-purge old audio + reports from the student's view; keep only the **last 7 days** of activity. Deleted sessions retain **component scores only**.
2. Encourage users to download their work — ideally a direct path into **the user's own Google Drive** after practice.
3. Show a **flag/warning** for sessions about to be removed from the web.
4. **Refactor PDF export** to improve UI and sync it with recent web changes (cluster 15.x accordion content).

Andy-approved design defaults (baked into this Discovery):

| Spec | Choice |
|---|---|
| Retention semantics | Soft-hide at 7d → hard-delete at 30d (23-day recovery buffer) |
| 7-day clock start | Earlier of `created_at` and `last_accessed_at` |
| Direction C scope | Conditional — Discovery decides feasibility |
| Sprint sequence | β: user-value-first → PDF → Retention → Warning UI → Drive |

---

## Section 2 — Direction A: Retention policy backend (current state + proposal)

### A1. Schema — where the data and the scores live

Migrations live in `backend/migrations/` (**not** `backend/db/migrations/`), 77 files, latest
`077_responses_unique_session_question.sql`. **Next migration = `078`.**

**`sessions` table** — no `CREATE TABLE` in tracked migrations (pre-dates migration tracking);
columns inferred from `backend/routers/sessions.py`:

| Column | Evidence | Survives purge? |
|---|---|---|
| `id`, `user_id`, `mode`, `part`, `topic`, `status`, `started_at` | sessions.py:296-312, 452 | — |
| **`overall_band`** | sessions.py:111, 133, 452 | **KEEP (aggregate score)** |
| **`band_fc`, `band_lr`, `band_gra`, `band_p`** | sessions.py:103-106, 452 | **KEEP (aggregate scores)** |
| `error_code`, `error_message`, `failed_step`, `last_error_at`, `pdf_status` | migration 003:8-12 | — |
| `tokens_used` | grading.py:790 (used; no migration — see CLAUDE.md tech-debt) | — |

> **Resolves commission A1's open question** ("`sessions.*` OR `responses[].grading_scores`?"):
> the aggregate component bands live **on the `sessions` row**. There is no `grading_scores`
> column. This is the single most important retention fact — *keeping the `sessions` row alone
> preserves everything Andy wants to retain.*

**`responses` table** — holds the heavy/purgeable payload:

| Column | Evidence | Purge target? |
|---|---|---|
| `audio_url` | grading.py:285 | YES (points to Storage object) |
| `audio_storage_path` | migration 001:14 | YES (bucket-relative key) |
| `transcript`, `raw_transcript_text` | grading.py:478, 503 | YES |
| `feedback` (jsonb) | grading.py:503 | YES (the report body) |
| `pronunciation_payload` (jsonb) | migration 004:10 | YES (largest jsonb) |
| `overall_band`, `final_overall_band`, `final_band_p` | migration 008:24-25 | optional (per-response, not the session aggregate) |

### A2. Audio storage path

- Bucket: **`audio-responses`** (`grading.py:69`, `sessions.py:21`, `responses.py:21`).
- Object key: **`<user_id>/<session_id>/<question_id><ext>`** (migration `001:9-11`; written at `grading.py:476`).
- Public URL in `responses.audio_url` (`grading.py:285`); signed-URL flow uses `audio_storage_path`
  with 1h TTL (`sessions.py:22, 630-650`).
- **Per-session audio cleanup = delete all objects under the `<user_id>/<session_id>/` prefix.**
  This is a Supabase **Storage API** operation (`storage.from_("audio-responses").remove([...])`),
  **not** a SQL operation — see A4 for why this rules out a pure pg_cron solution.
- **Storage usage today:** not introspectable from code (no metrics endpoint in repo). **TBD —
  Andy/Supabase dashboard.** Rough model: ~1 audio file per response × `MAX_AUDIO_DURATION_SECONDS=300`
  cap. Audio (Storage), not DB rows, is the cost driver Andy named.

### A3. Soft-delete precedent — one exists, reuse its shape

Exhaustive search for `deleted_at` / `is_deleted` / `archived_at` / `hidden_at` / `last_accessed_at`:
**zero hits.** The **only** soft-delete precedent in the codebase is
`user_vocabulary.is_archived BOOLEAN NOT NULL DEFAULT FALSE` (migration `019:23`), filtered in
queries as `WHERE NOT is_archived` (e.g. `student_home_aggregator.py:301-302`, migration `019:32,36`).

→ Retention should follow this precedent but use **timestamps, not booleans**, because the policy is
time-driven (7d/30d) and the warning UI needs to compute "days remaining."

### A4. Scheduled-job mechanism — none exists; recommendation below

Empirical state:

- **No** APScheduler / Celery / pg_cron / Supabase Edge Functions / Railway cron / GitHub Actions cron.
- `.github/workflows/*.yml` (backend-tests, deploy-frontend, e2e) are all event-driven — **no `schedule:` key.**
- Only async primitive: FastAPI `BackgroundTasks` (`grading.py:25, 584`) — request-scoped, fire-and-forget,
  dies on restart. **Not** suitable for recurring cleanup.
- Deploy platform = **Railway via Nixpacks** (`backend/nixpacks.toml`; no `railway.json`/`Procfile`/`Dockerfile`).

**Mechanism evaluation:**

| Option | DB scrub? | Storage delete? | Verdict |
|---|---|---|---|
| (j1) pg_cron | ✅ | ❌ — cannot call Storage API; deleting `storage.objects` rows orphans binaries | **Insufficient alone** |
| (j2) Supabase Edge Function (cron) | ✅ | ✅ | Viable but new Deno platform + deploy pipeline |
| (j3) **Railway cron service** | ✅ | ✅ (Python + Supabase SDK already in stack) | **RECOMMENDED** |
| (j4) On-access lazy purge | partial | partial | Doesn't reclaim storage for abandoned sessions — **insufficient as primary** |
| (j5) GitHub Actions cron → protected endpoint | ✅ | ✅ | Works; adds a service-token secret + public attack surface |

**Recommendation (Pattern #41 DB-integrity + #29 graceful degradation):**
- **Primary:** a **Railway cron service** running an idempotent one-shot
  `python -m jobs.retention_sweep` (new module). It can do *both* the DB scrub and the Storage
  `remove()` because the Supabase Python SDK (`supabase==2.28.3`) is already a dependency.
- **Safety net:** compute `hidden_at`/expiry **lazily at read-time** in the session-list endpoint so
  the warning UI (Direction B) is always correct **even if the cron lags or fails** — graceful degradation.
- ⚠️ **Verify:** Railway plan supports cron services (platform capability, not in repo). If not,
  fall back to (j5) GitHub Actions cron hitting a `POST /internal/retention/sweep` guarded by a
  service token. pg_cron remains a fallback for the DB-only half but **never** the Storage half.

### A5. FK cascade — the real hard-delete blocker (verified)

This is the constraint the mind-side LOC estimates did not account for.

| Child table | FK to sessions/responses | ON DELETE | Effect on purge |
|---|---|---|---|
| `grammar_recommendations` | `session_id`→sessions, `response_id`→responses (migration `014:5-6`) | **none → `NO ACTION`/RESTRICT** | **BLOCKS** deleting a session/response row |
| `user_vocabulary` | `session_id`, `response_id` (migration `019:13-14`) | **`SET NULL`** | survives, FKs nulled — fine |
| `grading_events` | no FK (soft refs only, migration `073:9-13`) | n/a | audit trail survives — fine |

**Design consequence — prefer scrub-in-place over row deletion.** Because `grammar_recommendations`
RESTRICTs deletion of `responses`/`sessions`, the safest 30-day hard-delete is:

1. Delete the audio **objects** from Storage (`<user_id>/<session_id>/` prefix) — reclaims the real cost.
2. **NULL out** the heavy `responses` columns (`audio_url`, `audio_storage_path`, `transcript`,
   `raw_transcript_text`, `feedback`, `pronunciation_payload`) — keeps rows, sidesteps every FK.
3. **Keep** the `sessions` row untouched (its `band_*` aggregates are exactly what Andy wants retained).
4. Stamp `sessions.purged_at = now()`.

This avoids FK surgery entirely. (Alternative — adding `ON DELETE CASCADE`/`SET NULL` to
`grammar_recommendations` then deleting rows — is more invasive and loses the recommendation history;
not recommended for 16.x.)

### A6. Session-list filter — current state

The history list is **not** on `home.html`. It lives in **`frontend/pages/speaking.html`**,
`renderHistory()` (lines `1048-1094`), rendered into `#history-tbody`, fed by **`GET /sessions?limit=200`**
(`speaking.html:1140`). See Direction B for the render detail.

Backend `GET /sessions` (`sessions.py:345-431`) filters by `user_id` + optional `status`/`part`/`search`/
`date_from`/`date_to` (`sessions.py:388-399`). **No deletion/hidden filter today.** The home metrics
aggregator (`student_home_aggregator.py:133-176`) likewise has **no** deletion filter.

→ Retention must add `hidden_at IS NULL` filtering to **both** `GET /sessions` and the home aggregator,
or hidden sessions will keep appearing in metrics.

### A — Proposed schema (migration 078 draft)

```sql
-- 078_session_retention.sql
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,   -- touched on each GET /sessions/{id}
  ADD COLUMN IF NOT EXISTS hidden_at        TIMESTAMPTZ,   -- set at 7d; filters out of history list
  ADD COLUMN IF NOT EXISTS purged_at        TIMESTAMPTZ;   -- set at 30d; audio + heavy cols scrubbed

CREATE INDEX IF NOT EXISTS idx_sessions_retention
  ON sessions (hidden_at, purged_at);   -- sweep job scans by these
```

**Expiry rule (both-timer, Andy default):** `expiry_anchor = LEAST(created_at, last_accessed_at)`;
hide when `now() ≥ anchor + 7d`, purge when `now() ≥ hidden_at + 23d` (= 30d from anchor).
Note `created_at` is referenced via `started_at` in code — confirm the actual column name in 16.2
(another pre-tracked-schema unknown).

---

## Section 3 — Direction B: Deletion-warning UI (proposal)

### B1. Where it attaches (corrected)

Commission assumed `frontend/pages/dashboard.html` + `frontend/js/dashboard.js`. **Neither exists**
(removed in Sprint 5.1). The integration point is **`speaking.html`**, function `renderHistory()`
(`1048-1094`), one `<tr class="session-row">` per session (`speaking.html:1083-1091`):
date · part · mode-badge · topic · band · view-button.

### B2/B3. Reusable UI already present

- **Badges:** `.av-badge` + variants `.av-badge-warning` / `.av-badge-error`
  (`frontend/css/aver-design/components.css:281-328`).
- **Banner:** `.ds-warning-banner` (amber, left-border) (`frontend/css/ds.css:634-655`).
- **Toast:** `.av-toast` (`components.css:647-672`).
- **Tokens:** `--av-warning #B45309` / `--av-warning-soft`, `--av-error #B91C1C` / `--av-error-soft`
  (`frontend/css/aver-design/tokens.css`); legacy `--ds-warning-*` in `ds.css:42-53`.

→ No new component needed — reuse `.av-badge-warning` for the per-row chip and `.ds-warning-banner`
for the aggregate banner.

### B — Proposal

- **Timing (w4 both):** per-row chip appears once `hidden_at IS NULL AND now ≥ anchor+4d`
  ("Sắp ẩn sau N ngày"); a top banner aggregates when any session is within the window
  ("N phiên sắp bị ẩn — tải báo cáo ngay").
- **Source of truth:** backend returns `days_until_hidden` / `days_until_purged` computed lazily
  (A4 safety net) on each `GET /sessions` row — frontend renders, never computes policy.
- **CTA:** reinforce existing **"Tải báo cáo PDF"** (result.html:190) + a new **"Tải audio"** link.
  ("Pin/gia hạn" extension is **out of scope** per commission §VIII.)
- Email notification (s3) **out of scope** (SMTP infra).

---

## Section 4 — Direction C: Google Drive integration — feasibility verdict

### C1. Auth state (significant — and a caveat the commission missed)

Auth is **already Supabase Google OAuth**: `login.html:364-369` calls
`signInWithOAuth({ provider: 'google' })`; JWT passed as `Authorization: Bearer` via
`api.js:26-30`. A second layer is the **access-code activation** system
(`POST /auth/activate`, `auth.py:230-387`). So **a Google identity already exists for every user** —
this materially de-risks Drive vs. building OAuth from scratch.

**BUT** (commission C3 understated this): Supabase Google sign-in today requests only basic profile
scopes and does **not** retain a Drive-scoped refresh token. Server-side upload to a user's Drive
**later** (e.g. from a cron or a deferred job) requires:
1. requesting `https://www.googleapis.com/auth/drive.file` at sign-in with
   `access_type=offline` + `prompt=consent`, **and**
2. capturing & persisting the `provider_refresh_token` (Supabase exposes it transiently in the session;
   it is **not** stored by default).

This is **incremental authorization + token retention**, not a free "scope expansion." It is the
single biggest complexity in Direction C.

### C2/C3. No existing Drive surface; deps absent

- Repo-wide search for `drive` / `gapi` / `googleapis` / `google-api-python-client`: **no integration.**
  (`google-generativeai` and `google-cloud-texttospeech` in `requirements.txt` are Gemini/TTS, unrelated.)
- Frontend has **no bundler** — third-party JS via CDN `<script>` (Tailwind, Supabase SDK). Google
  Identity Services / Picker would load the same way.
- Backend would need `google-api-python-client` + `google-auth-oauthlib` added.

### C4. Artifacts ready to upload

PDF export (`export.py`, **working** — see Direction D), audio download (`practice.js:1069`),
vocab export (`vocabulary_bank.py:847`), essay docx (`admin_writing.py:346`). Plenty to upload.

### C — VERDICT: **FEASIBLE — but COMPLEX-DEFER to a dedicated 16.5/17.x sub-cluster**

No hard blocker (OAuth foundation + artifacts exist), but the provider-refresh-token retention +
incremental-scope flow + Drive SDK wiring puts this at **~450-700 LOC across 2 sprints**, above the
clean single-sprint bar. **Recommend: sequence it last (16.5+), and only after a one-time check that
Andy's Google Cloud project has the Drive API enabled and an OAuth consent screen configured** (not
verifiable from the repo — **escalation item**). Simpler interim win available: a client-side
"download then drag to Drive" is zero-integration; true one-click upload is the deferred work.

---

## Section 5 — Direction D: PDF refactor scope

### D1. Current pipeline — **WORKING (ReportLab), NOT broken** ⚠️ commission inversion

- Button "Tải báo cáo PDF" → `result.html:190-193`; handler `downloadPdf()` `result.html:870-900`
  fetches **`GET /sessions/{id}/export/pdf`**.
- Endpoint `export.py:25-77` → `generate_session_pdf()` → **`services/pdf_generator.py`**.
- **Library = ReportLab** (`pdf_generator.py:1-9, 18-32`), pure-Python, **zero system deps**.
  `reportlab==4.4.10` in `requirements.txt`; `nixpacks.toml:21` installs `fonts-dejavu-core` for VN glyphs.
- **There is no 503.** `export.py:59` generates and streams a real PDF. The migration off WeasyPrint
  happened in commit `a1208a2b`. **`main.py:104-105`'s "returns 503 until WeasyPrint deps installed"
  comment is STALE documentation debt** — and so is CLAUDE.md's "Known limitations" entry. Direction D
  is **content enrichment + polish**, NOT a tech-stack rescue.

### D2. Current PDF content (`pdf_generator.py:302-407`, `464-597`)

Header (logo + metadata + overall band) → per-criterion score table → per-question blocks
(transcript, practice strengths/grammar/vocab/pronunciation-*issues-list*, corrections, sample answer;
test-mode per-criterion feedback + band-7 model) → strengths/improvements footer. No `@media print`
for speaking (only `writing-result.css` has one) — fully backend-generated.

### D3. Drift vs. `result.html` (Sprint 15.3.1) — what's stale

| Feature | result.html | PDF | Status |
|---|---|---|---|
| Pronunciation score pills (Overall/Fluency/Accuracy/Completeness) | ✅ (776-789) | ❌ | **stale** |
| Phoneme drill-down accordion (weak words, IPA, tips) | ✅ (792-813, S15.3.1) | ❌ | **stale** |
| Structured grammar errors (LanguageTool `grammar_check`) | ✅ (614-616) | ❌ | **stale** |
| Practice grammar/vocab issues, corrections, sample answer | ✅ | ✅ | in sync |

PDF currently shows only a flat `pronunciation_issues` text list (`pdf_generator.py:531-536`) — no
phoneme granularity, no numeric pronunciation pills, no structured grammar section.

### D — Scope

Add to `pdf_generator.py`: (1) pronunciation score pills, (2) a phoneme weak-word section sourced
from `pronunciation_payload` (mirror `PronunciationDrilldown.extractWeakWordsFromPayload`),
(3) structured grammar-error section, (4) logo/typography/footer polish, (5) **delete the stale
`main.py:104-105` comment** + fix CLAUDE.md known-limitations. Lightweight runtime (no Puppeteer) —
**no cost concern.** Lowest-risk, highest-immediate-value → **Sprint 16.1.**

---

## Section 6 — Sprint sequence + LOC estimates (β user-value-first)

| Sprint | Direction | Scope | LOC (empirical) | Time-box |
|---|---|---|---|---|
| **16.1** | D — PDF refactor | enrich `pdf_generator.py` (pronun pills, phoneme section, grammar), polish, kill stale comment | **250-400** | 0.5 day |
| **16.2** | A pt.1 — retention schema + soft-hide | migration 078, lazy expiry compute, filter `GET /sessions` + home aggregator, `last_accessed_at` touch | **220-350** | 0.5-1 day |
| **16.3** | B — warning UI | `renderHistory()` chip + banner, CTA, consume `days_until_*` | **120-220** | 0.5 day |
| **16.4** | A pt.2 — sweep job | `jobs/retention_sweep` (Storage `remove()` + responses scrub), Railway cron, idempotency, dry-run, logging | **220-350** | 1 day |
| **16.5+** | C — Drive (conditional) | incremental-scope OAuth + refresh-token retention + upload service + UI | **450-700** | 2 sprints |

**Cluster total ex-Drive: ~810-1320 LOC (4 sprints). With Drive: ~1260-2020 LOC (6 sprints).**
Below the mind-side ~1300-2300 estimate — chiefly because Direction D is enrichment, not a rewrite.

---

## Section 7 — Risks per direction

- **A — data loss (irreversible).** Mitigated by soft-hide→23d-buffer→scrub split, scrub-in-place
  (rows survive, only audio + heavy cols removed), and an idempotent dry-run-first sweep.
- **A — FK RESTRICT (`grammar_recommendations`).** Drove the scrub-in-place design (A5); ignoring it
  would make row-deletion fail in production.
- **A — legacy data at deploy.** Every existing session is already >7d old → would all hide/purge at
  once. **Mitigation:** seed `last_accessed_at = now()` on deploy (grace), or gate the first sweep
  behind a one-time backfill. **Flag for 16.2.**
- **A — Storage cleanup needs app layer.** pg_cron can't delete Storage binaries → Railway cron (A4).
- **B — coupling to A.** Warning UI is meaningless without 16.2's `hidden_at`/expiry fields → strict
  16.2-before-16.3 order.
- **C — provider-token retention + Google Cloud project config.** Escalation: confirm Drive API
  enabled + consent screen before committing 16.5.
- **D — phoneme payload shape.** PDF must mirror the same `pronunciation_payload` extraction
  result.html uses, incl. the legacy-session graceful fallback (pre-15.1 word-granularity).
- **Cluster — production attention split** with cluster-15.x observation items (IS-15.1/2/3).
  Mitigated: 16.0 is Discovery, no deploys.

---

## Section 8 — Sprint 16.1 commission preview (PDF refactor — first feature sprint)

**Goal:** bring the PDF report to parity with `result.html` (Sprint 15.3.1) and polish its UI.

**Files:** `backend/services/pdf_generator.py` (primary), `backend/main.py` (delete stale comment,
lines 104-105), root `CLAUDE.md` + `frontend/CLAUDE.md`-adjacent known-limitations note (WeasyPrint fix).
No new endpoint, no migration, no frontend change.

**Acceptance:**
1. PDF renders pronunciation pills (Overall/Fluency/Accuracy/Completeness) from `responses.pronunciation_*`.
2. PDF renders a weak-word phoneme section from `pronunciation_payload`, with the same graceful
   fallback as `PronunciationDrilldown.extractWeakWordsFromPayload` (legacy sessions degrade to
   word-granularity, no crash — Pattern #29).
3. PDF renders the structured `grammar_check` (LanguageTool) errors section.
4. Logo + footer (averlearning.com) + VN typography (DejaVu already installed) verified.
5. Stale `main.py:104-105` WeasyPrint comment removed; CLAUDE.md known-limitations corrected.
6. Generate a sample PDF for one practice + one test + one legacy session; visually confirm no regressions.

**LOC:** 250-400. **Out of scope:** Drive upload, any retention logic, frontend changes.

---

## Section 9 — Pattern #42 spec-error ledger (honest count)

Commissions are AI-drafted hypotheses; code pre-flight is authoritative. **5 material spec errors
found** (2 high-impact, inverting Directions D and B integration points):

| # | Impact | Commission claim | Empirical reality |
|---|---|---|---|
| 1 | **HIGH** | Direction D / CLAUDE.md: PDF uses **WeasyPrint**, fails on Railway (**503**, missing cairo/pango) | PDF uses **ReportLab** (pure-Python, zero deps); `export.py:59` streams a real PDF; `nixpacks.toml:21` has fonts; **no 503**. `main.py:104-105` comment is stale. → D is enrichment, not rescue. |
| 2 | **MEDIUM** | PF-2 / B1: session list in `dashboard.html` + `dashboard.js` | Both files **don't exist** (removed Sprint 5.1). History is in **`speaking.html`** `renderHistory()` (1048-1094) via `GET /sessions?limit=200`. |
| 3 | **MEDIUM** | C3: Drive is "scope expansion only," additive, no conflict | Supabase Google OAuth exists but does **not** retain a Drive-scoped refresh token; needs **incremental auth + token persistence** → COMPLEX-DEFER, not single-sprint. |
| 4 | LOW | PF-1: "PR #282 merged on main" | Latest merge is **PR #281**; Sprint 15.3.1 (`5d8b2482`) is an **unmerged** commit on the feature branch. PR #282 doesn't exist. |
| 5 | LOW | PF-1 closure-artifact paths: `15_x/retrospective.md`, `phase_b_backlog.md`, `HANDOFF_..._2026-05-25.md` | Actual: `CLUSTER_15_X_RETROSPECTIVE.md`, `PHASE_B_BACKLOG_2026_05_25.md`, `HANDOFF_PROJECT_FULL_2026_05_25.md` (underscores, not dashes). |

**Non-error discoveries** (commission asked, code answered): aggregate bands live on `sessions`
(not a `grading_scores` column); `grammar_recommendations` FK is RESTRICT and constrains the
hard-delete design (A5); only soft-delete precedent is `user_vocabulary.is_archived` (A3).

---

## Appendix — Acceptance-criteria self-check (commission §VI)

✅ 4 directions empirically scoped with file:line · ✅ retention schema draft (078) ·
✅ job mechanism recommended empirically (Railway cron, A4) · ✅ Direction C verdict explicit
(FEASIBLE/complex-defer) · ✅ PDF state documented (ReportLab, working) · ✅ sprint sequence + LOC ·
✅ 16.1 preview drafted · ✅ Pattern #42 ledger (5 errors) · ✅ risks per direction ·
✅ Andy defaults baked (soft-hide-7d/delete-30d, both-timer, conditional-Drive, β order) ·
✅ doc ≤ 800 LOC.

**Escalations for Andy/mind:** (1) Supabase Storage usage figure (A2 — cost baseline). (2) Railway
cron capability on current plan (A4). (3) Google Cloud project: Drive API enabled + consent screen (C).
