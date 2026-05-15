-- Migration: 051_vocab_pending_column.sql
-- Sprint 10.4 — Capture confirmation UI (Area 1B, Issue #1 from Sprint 10.0 discovery)
--
-- Andy complaint #1: items auto-saved to bank without user confirmation. False
-- positives only caught later via My Vocab triage (out-of-flow friction).
-- Sprint 10.4 adds a staging layer: items capture as is_pending=true, the user
-- confirms via result.html, then they flip into the bank.
--
-- Strategy (Andy Q1 lock): boolean column on user_vocabulary, no separate
-- staging table. Bank-read paths gain an `eq("is_pending", false)` filter so
-- pending rows are invisible everywhere except the new
-- GET /api/vocabulary/pending endpoint.
--
-- Auto-commit (Andy Q3 lock): items older than 24h auto-flip to is_pending=false.
-- No background scheduler in the codebase — Sprint 10.4 implements this as a
-- lazy cleanup inside GET /pending. Cost: items older than 24h sit pending until
-- next user visit. Acceptable for daily-active users; flag for re-evaluation if
-- adoption suggests longer absences.
--
-- Idempotent: IF NOT EXISTS guards both columns + index. No backfill — existing
-- 46 alive items grandfather in via the DEFAULT false on is_pending.

ALTER TABLE user_vocabulary
    ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pending_created_at TIMESTAMPTZ;

-- Partial index — pending rows are the minority (created, awaiting confirm,
-- gone within 24h). Indexing only the WHERE branch keeps the index small and
-- the auto-commit scan O(log p) where p is the pending count.
CREATE INDEX IF NOT EXISTS idx_user_vocabulary_pending
    ON user_vocabulary (user_id, is_pending, pending_created_at)
    WHERE is_pending = true;

COMMENT ON COLUMN user_vocabulary.is_pending IS
    'Sprint 10.4 — true while awaiting user confirmation in result.html. '
    'Auto-commits to false after 24h via lazy cleanup in GET /api/vocabulary/pending. '
    'Bank-read paths filter is_pending=false to keep pending items hidden.';

COMMENT ON COLUMN user_vocabulary.pending_created_at IS
    'Sprint 10.4 — captured timestamp; basis for the 24h auto-commit window. '
    'Cleared (set NULL) when is_pending flips to false.';
