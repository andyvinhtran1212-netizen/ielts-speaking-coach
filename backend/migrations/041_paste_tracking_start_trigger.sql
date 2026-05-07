-- Migration: 041_paste_tracking_start_trigger.sql
-- Mô tả: Sprint 2.6.1 — paste forensic logging + click-start contract.
--
-- Two columns added to capture paste events from the student
-- submit modal:
--
--   • writing_drafts.paste_events  — JSONB array, append-only,
--     reset on draft delete (which happens on submit).  Each
--     event is `{at, char_count, blocked}`.  Frontend reports
--     these via POST /paste-log; backend never validates the
--     content beyond the JSONB shape.
--
--   • writing_essays.paste_events  — same shape.  Populated at
--     submit time by copying the draft's array, so the audit
--     trail survives the draft delete.
--
--   • writing_essays.suspicious_paste — derived flag, TRUE when
--     ANY recorded event has char_count >= 50.  Cheap admin
--     filter so the moderation queue can show "everyone who
--     pasted something substantial" without scanning JSONB.
--
-- The /start endpoint introduced this sprint reuses the
-- `started_at` column added in migration 039 (Phase 2.3c-3) — no
-- new schema for the timer trigger itself, only the semantic
-- shift documented in writing_student.py:
--
--   pre-2.6.1: started_at auto-stamped by PATCH /draft on first save
--   post-2.6.1: started_at stamped by POST /start when student opens modal
--
-- The flip rules out the "delay between click and tick" canary
-- 2026-05-06 (timer banner reading '—' until first save).

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS paste_events     JSONB   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS suspicious_paste BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE writing_drafts
    ADD COLUMN IF NOT EXISTS paste_events JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Partial index — most rows are clean, so we only pay for the index
-- on the small subset Andy will be moderating.
CREATE INDEX IF NOT EXISTS idx_writing_essays_suspicious_paste
    ON writing_essays(created_at DESC)
    WHERE suspicious_paste = TRUE;

COMMENT ON COLUMN writing_essays.paste_events IS
    'Append-only JSONB array of paste events: [{at: ISO, char_count: int, blocked: bool}]. Copied from writing_drafts.paste_events at submit time.';
COMMENT ON COLUMN writing_essays.suspicious_paste IS
    'Derived flag — TRUE when any paste event recorded ≥50 chars. Drives the admin moderation filter.';
COMMENT ON COLUMN writing_drafts.paste_events IS
    'Per-draft paste log appended by POST /paste-log. Cleared with the row on submit.';
