-- Migration: 202_response_persisted_at.sql
-- Mô tả: canonical server-authored persistence time for Speaking responses.
--
-- `responses` predates the forward migration ledger and is not guaranteed to
-- have created_at/updated_at. Gate E real-device evidence needs an immutable
-- database timestamp for the exact response submitted during the attested
-- journey; a client timestamp or a later lookup time cannot prove that.

ALTER TABLE responses
    ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

COMMENT ON COLUMN responses.persisted_at IS
    'Server-authored first persistence time for rows created after migration 202; legacy rows are backfilled at migration time. Stable across response upsert retries and used only with fresh post-deploy evidence journeys.';
