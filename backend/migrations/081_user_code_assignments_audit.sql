-- Migration: 081_user_code_assignments_audit.sql
-- Sprint 17.5 — Reassignment / refill / cohort-member audit trail (Direction E).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Adds an audit trail to user_code_assignments so reassign / cohort-remove /
-- issue actions record WHEN a row was revoked, WHO did it, and WHY. Existing rows
-- stay NULL (no audit history for pre-17.5 actions). The immutable access_codes
-- redemption fields (is_used / used_by / used_at) are untouched by all 17.5 flows.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE user_code_assignments
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID,   -- admin user_id who performed the action
  ADD COLUMN IF NOT EXISTS reason      TEXT;

CREATE INDEX IF NOT EXISTS idx_uca_revoked_at
  ON user_code_assignments (revoked_at) WHERE revoked_at IS NOT NULL;

-- ── Reverse (run manually if needed) ───────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_uca_revoked_at;
-- ALTER TABLE user_code_assignments
--   DROP COLUMN IF EXISTS reason,
--   DROP COLUMN IF EXISTS assigned_by,
--   DROP COLUMN IF EXISTS revoked_at;
