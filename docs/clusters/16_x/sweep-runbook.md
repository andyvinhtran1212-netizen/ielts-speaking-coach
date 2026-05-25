# Sprint 16.4 — Retention Sweep: deploy + go-live runbook

The sweep code (`backend/jobs/retention_sweep.py`) ships in this PR, **dry-run by
default** (`RETENTION_SWEEP_DRY_RUN` defaults to `true`). Merging is safe — nothing
is deleted until the env var is explicitly flipped. The steps below are the
**operator (Andy) actions** that Code cannot perform from here (no Railway / prod
Supabase access): creating the cron service, watching live logs, and the go-live flip.

## What it does (v2 — Sprint 16.2.1 thresholds)
- **Audio (15d):** delete Storage recordings under `audio-responses/<user>/<session>/`,
  NULL `responses.audio_url` + `audio_storage_path`, stamp `sessions.audio_purged_at`.
- **Content (60d):** NULL `responses.transcript` / `raw_transcript_text` / `feedback` /
  `pronunciation_payload`, stamp `sessions.content_purged_at`.
- **Never touched:** `sessions.band_*`, `responses.overall_band` / `final_overall_band` /
  `final_band_p` / `pronunciation_score…` (component scores kept forever). Sessions rows
  are never DELETEd (FK RESTRICT → scrub-in-place).
- Eligibility uses the same `services.retention.compute_expiry` the UI uses (anchor =
  `max(started_at, last_accessed_at)`), so it never purges a session the UI shows as safe.

## Railway cron service (operator)
The sweep is a **separate Railway service** on the same repo (the web service is
untouched — no root `railway.json` added, so the existing nixpacks web deploy is
unaffected). In the Railway dashboard:
1. New service → same GitHub repo, root directory `backend/`.
2. Start command: `python -m jobs.retention_sweep`
3. Cron schedule: `0 3 * * *` (daily 03:00 UTC ≈ 10:00 Vietnam — low load).
4. Env: copy `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service role — needed for Storage
   delete + cross-user reads). Leave `RETENTION_SWEEP_DRY_RUN` **unset** (defaults true).
5. The process exits when done (Railway cron contract); exit code is non-zero if any
   session errored, so a failed run is visible.

## Dogfood + go-live (Pattern #19)
- **Phase 1 (Day 1):** deploy dry-run; wait for the 03:00 UTC run; confirm the log line
  `[sweep] done dry_run=True | audio eligible=N purged=N objects=N … | content …`.
- **Phase 2 (Day 2-3):** spot-check the eligible sessions in the log are genuinely
  >15d / >60d by `max(started_at, last_accessed_at)`. Confirm Storage usage unchanged
  (no live deletion). To exercise it on demand, age a test session:
  `UPDATE sessions SET last_accessed_at = NOW() - INTERVAL '20 days', started_at = NOW() - INTERVAL '20 days' WHERE id = '<test>';`
- **Phase 3 (Day 4) — GO-LIVE:** set `RETENTION_SWEEP_DRY_RUN=false` on the cron service.
  Next 03:00 UTC run deletes. Verify: Storage bucket size drops; a sample swept session
  has `audio_url IS NULL` but `overall_band` intact; the result page shows scores, no audio.
- **Phase 4 (Day 5+):** watch daily logs ~1-2 weeks; confirm storage growth is contained.

**Rollback:** flip `RETENTION_SWEEP_DRY_RUN=true` (or pause the service). Already-purged
data is not recoverable, but the sweep stops immediately.

## Notes
- **No grace-extension migration** this sprint: migration 078 already reset
  `last_accessed_at = NOW()` for all pre-existing sessions, so they already carry a fresh
  15d/60d window; a second bump would be redundant and would blind the Phase 1-2 dry-run
  (it needs real eligible sessions to verify). See PR #289 ledger.
- **Storage-first ordering** (not the spec's SQL-first): capture paths → `remove()` →
  scrub DB → stamp. Orphan-safe + idempotent; the only cost is a sub-second window where
  `audio_url` 404s on an already-expiring session. See PR ledger.
- Idempotent: re-running is safe (`*_purged_at IS NOT NULL` sessions are skipped; a
  partial failure retries cleanly next run, no orphans).
