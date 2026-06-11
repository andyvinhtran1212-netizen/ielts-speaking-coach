-- Migration: 099_access_code_audit.sql
-- Mã kích hoạt Phase B (final) — entitlement-edit audit trail.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- patch_access_code and the revoke / remove-user / reassign / refill / hard-delete
-- endpoints mutated entitlements with NO audit (mig 081 only stamped
-- revoked_at/assigned_by on the assignment row). This append-only log records
-- WHO changed WHAT and WHEN for every entitlement mutation.
--
-- Design:
--   - APPEND-ONLY: the app only ever INSERTs; never UPDATE/DELETE a row.
--   - NO foreign keys on code_id / target_user_id ON PURPOSE — the audit must
--     SURVIVE a hard-delete of the code (or a user deletion); a cascade would
--     erase the very history we keep.
--   - before/after store ONLY the changed fields (not whole rows) — compact and
--     avoids leaking unrelated data.
--   - never touches access_codes.used_*/is_used (immutable redemption fields).

CREATE TABLE IF NOT EXISTS access_code_audit (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id  UUID,                       -- admin who performed the action (auth context, never body)
    action         TEXT        NOT NULL,       -- create | edit | revoke | remove_user | reassign | refill | hard_delete
    code_id        UUID,                       -- the access code acted on (no FK: survive hard-delete)
    target_user_id UUID,                       -- the user removed/reassigned (NULL for code-level actions)
    before         JSONB,                      -- changed fields only, pre-state (NULL for create)
    after          JSONB,                      -- changed fields only, post-state (NULL for delete)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read path: "history of one code", newest first.
CREATE INDEX IF NOT EXISTS idx_access_code_audit_code_id
    ON access_code_audit (code_id, created_at DESC);

-- ── Reverse (run manually if needed) ──────────────────────────────────────────
-- DROP TABLE IF EXISTS access_code_audit;
