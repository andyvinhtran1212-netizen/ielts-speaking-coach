# Writing grading reliability — stuck-job recovery, retry ledger & model fallback

**Sprint W-MM** · status: **implemented** (`feat/writing-grading-reaper-fallback`)

## 1. Trigger / inspection

Essay `ac21294e-51b1-4bd4-9399-5f40bd005641` appeared to "fail grading many
times". The DB told a different story:

| field | value |
|---|---|
| `writing_essays.status` | `grading` (stuck since 2026-06-27, ~2 days) |
| `error_message` | `None` |
| `regrade_count` | `0` |
| `writing_jobs` | **one** row — `status=running`, `attempt_count=0`, `error_log=[]`, `started_at` set, `completed_at=null` |

**Root cause — orphaned job, silent.** `_bg_grade_essay` runs as an *in-process*
FastAPI `BackgroundTask` on Railway. It writes `status=grading` / `job=running`,
then the process died mid-grade (Railway deploy/restart on 2026-06-27, OOM, or a
hang past the platform's shutdown grace). Because the process was *killed* rather
than raising, the `except → _mark_failed` path never ran → no `error_message`,
job stuck `running` forever. The admin UI shows a perpetual "đang chấm", which
reads as "failed many times".

### Pre-existing gaps confirmed in code
1. The grader's `MAX_RETRIES=3` (`_call_with_retry`, exponential backoff) are
   **in-process, within a single `grade_essay` call** — they do not survive a
   process death.
2. `writing_jobs.attempt_count` / `max_attempts` columns existed but were
   **never written** by the writing flow — no job-level attempt ledger.
3. **No reaper / watchdog** to detect & recover stuck jobs.
4. **No model fallback** — if the configured model keeps failing, nothing else
   is tried.

## 2. Design

Three asks → three components. No schema migration needed — `attempt_count`,
`max_attempts`, `error_log` already exist on `writing_jobs`.

### C1 — Per-essay retry counter
`_bg_grade_essay` increments `writing_jobs.attempt_count` at the start of every
job-level attempt (read-modify-write is race-free: one BG task per essay at a
time). The grader's 3 in-call retries stay folded inside **one** attempt — they
are transient-API re-rolls, not a fresh grading run.

### C2 — Persist data for later tuning
`_record_attempt_failure` **appends** (never overwrites) a record per failed
attempt to `writing_jobs.error_log`:

```json
{ "attempt": 1, "model": "gemini-2.5-pro", "kind": "StuckTimeout",
  "message": "...", "at": "2026-06-29T15:29:00Z" }
```

This gives a full per-essay failure history and, aggregated, a **per-model
failure rate** — the empirical input for tuning the fallback policy and model
selection. (Success metrics — `model_used`, tokens, cost, `grading_duration_ms`
— are already persisted on `writing_feedback`.) `_mark_failed` no longer writes
`error_log`, so the ledger survives the terminal write.

### C3 — Reaper + fallback threshold
**Reaper** (`reap_stuck_grading_jobs`, a startup async loop, interval
`WRITING_REAPER_INTERVAL_SECONDS=120`s): sweeps `writing_jobs` in
`queued`/`running` older than the tier timeout (standard `360`s, deep `600`s —
deep runs 3 sequential passes). Staleness is measured on the latest **claim
time** — `started_at` (refreshed on every requeue), falling back to `created_at`
for never-started `queued` jobs. This is what stops a freshly-requeued retry
(immutable old `created_at`, fresh `started_at`) from being re-reaped before its
own window elapses, which would spawn a duplicate grading task. The DB prefilter
still uses `created_at` (≤ `started_at`, so nothing truly stale is missed); the
precise per-tier check runs in code. For each stuck job it records a
`StuckTimeout` attempt, then:
- **attempts remain** → requeue (`job→queued`, schedule a re-run);
- **attempts exhausted** → `_mark_failed`, restoring the pre-regrade good status
  if one was persisted (see below) so a previously graded/reviewed/delivered
  essay isn't stranded in `failed`.

**Stale-worker fencing (lease guard).** The grader call has no wall-clock
timeout, so a worker can still be running when the reaper declares its job stuck
and launches a retry. Every terminal write — the success persist (feedback
version + `graded`) and the failure paths (`_handle_grade_failure`, the
safety-block branch) — is gated on `_owns_job(job_id, attempt_no)`, which is true
only while no newer attempt has advanced `attempt_count` past this worker's. A
superseded worker silently abandons its result, so the LATEST attempt is always
authoritative and a hung worker can never clobber the retry's grade (or overwrite
a good essay with a late failure). All regrade callers (admin **and** instructor)
pass `restore_status` so a reaper takeover restores the prior good grade.

**Config persistence.** `schedule_grading_job` writes
`max_attempts = settings.WRITING_GRADING_MAX_ATTEMPTS` onto each new job (so the
env knob governs retries, not just the DB column default) and, for a **regrade**,
persists the pre-regrade status into `job_payload.restore_status`. `_bg_grade_essay`
and the reaper both read this so an out-of-process reaper takeover restores the
prior good grade on terminal failure — matching the in-process
`restore_status_on_fail` behaviour.

**Fallback threshold — "bao nhiêu lần thì đổi model"** (`WRITING_GRADING_MAX_ATTEMPTS=3`):

| attempt | model | rationale |
|---|---|---|
| 1 | configured (e.g. Pro for L4) + 3 in-call retries | first try |
| 2 (requeue) | **same** model | most failures are transient infra, not model-specific — cheapest correct retry |
| 3 (final) | **`WRITING_FALLBACK_MODEL`** (`gemini-2.5-flash`) | a model/region-specific failure can still deliver *a* result — continuity over marginal quality |

→ **Fallback fires on the 3rd attempt** (after the primary model has failed
twice at job level). `validate_level_coverage` only warns, never raises, so a
fallback that drops higher-level sections still delivers a (partial) grade —
strictly better than an essay stuck in `grading` forever. The real model used is
persisted via `result.model_used`, so cost/quality analysis sees the model that
actually graded.

## 3. Kill-switches (env; settings load at process start → Railway change restarts the service)

| var | default | effect |
|---|---|---|
| `WRITING_REAPER_ENABLED` | `true` | turn the sweep off |
| `WRITING_REAPER_INTERVAL_SECONDS` | `120` | sweep cadence |
| `WRITING_STUCK_JOB_TIMEOUT_SECONDS` | `360` | standard-tier staleness |
| `WRITING_STUCK_JOB_TIMEOUT_DEEP_SECONDS` | `600` | deep-tier staleness |
| `WRITING_GRADING_MAX_ATTEMPTS` | `3` | job-level attempt cap |
| `WRITING_GRADING_FALLBACK_ENABLED` | `true` | always keep primary model when `false` |
| `WRITING_FALLBACK_MODEL` | `gemini-2.5-flash` | final-attempt model |

## 4. Files

- `backend/config.py` — the 7 knobs above.
- `backend/services/essay_service.py` — `_model_for_attempt`, `_record_attempt_failure`,
  `_schedule_requeue`, `_handle_grade_failure`, `reap_stuck_grading_jobs`, `_parse_ts`;
  `_bg_grade_essay` attempt-counting + fallback model; `_mark_failed` no longer
  overwrites `error_log`.
- `backend/main.py` — reaper startup loop.
- `backend/tests/test_essay_service.py` — fallback-policy, attempt-counting,
  requeue/terminal, and reaper tests.

## 5. Surfacing in the admin UI

`get_essay_status` returns the retry ledger (`attempt_count`, `max_attempts`,
`attempt_failures`, `last_failure`) and the status page
(`frontend/pages/admin/writing/status.html`) shows
"🔄 Lần chấm N/M · K lần lỗi đã ghi nhận (gần nhất: <kind> trên <model>)" once a
grade has been retried at the job level — so an admin sees the grade
self-recovered instead of guessing why it's slow.

## 6. Follow-ups (not in this patch)

- Once enough `error_log` data accrues, compute per-model failure rates and
  revisit `WRITING_FALLBACK_MODEL` / the level-aware default (ties into the
  grade-rating quality work, PR #619).
