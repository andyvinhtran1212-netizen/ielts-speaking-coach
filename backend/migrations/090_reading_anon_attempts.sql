-- Migration: 090_reading_anon_attempts.sql
-- reading-access-tracking Part B — shareable links + ANONYMOUS attempts.
-- Forward-only. Lesson-17 dry-run reasoning: every statement is safe on the
-- existing rows — DROP NOT NULL keeps the FK (FKs permit NULL) and every
-- current attempt keeps its user_id; ADD COLUMN IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS are idempotent and default the new columns to NULL. No numeric
-- casts are involved (no type changes), so there is nothing to ::numeric-cast.
--
-- A share-link taker has no account, so an attempt may be ANONYMOUS:
--   • user_id      → now NULLABLE (NULL = anonymous attempt; a real user_id
--                    still marks an authenticated attempt, unchanged).
--   • anon_id      → an unguessable capability token (secrets.token_urlsafe);
--                    the ONLY ownership credential for an anonymous attempt
--                    (echoed back on submit / review). It is NOT an auth claim
--                    and NOT guessable — ownership is enforced in the router.
--   • share_token  → the share-link token this attempt came through.
--   • anon_src     → a SALTED hash of the client IP (privacy: NEVER the raw
--                    IP), for the Part C dashboard's coarse "distinct sources"
--                    estimate. Salt = READING_ANON_SALT (server env).

ALTER TABLE reading_test_attempts
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE reading_test_attempts
    ADD COLUMN IF NOT EXISTS anon_id     TEXT,
    ADD COLUMN IF NOT EXISTS share_token TEXT,
    ADD COLUMN IF NOT EXISTS anon_src    TEXT;

CREATE INDEX IF NOT EXISTS idx_reading_test_attempts_anon
    ON reading_test_attempts (anon_id);

-- RLS is DELIBERATELY left user-scoped (user_id = auth.uid()). Anonymous rows
-- (user_id IS NULL) are therefore invisible to BOTH the anon-key and any
-- authenticated client via PostgREST — they are reachable ONLY through the
-- backend (service-role, which bypasses RLS), where the router enforces
-- anon_id ownership. This is strictly MORE restrictive than loosening RLS to
-- expose NULL-owner rows, so the policy is intentionally NOT changed.
-- (The partial unique index uniq_reading_test_attempts_active on
-- (user_id, test_id) WHERE status='in_progress' excludes NULL user_id rows —
-- Postgres treats NULLs as distinct — so anonymous attempts are not bound by
-- the one-active-per-user invariant, which is correct.)

COMMENT ON COLUMN reading_test_attempts.anon_id IS
    'reading-access-tracking B — unguessable capability token (secrets) that '
    'owns an anonymous (share-link) attempt. Router-enforced; never an auth claim.';
COMMENT ON COLUMN reading_test_attempts.share_token IS
    'reading-access-tracking B — the share-link token this attempt was opened with.';
COMMENT ON COLUMN reading_test_attempts.anon_src IS
    'reading-access-tracking B — SALTED hash of the client IP (READING_ANON_SALT). '
    'NEVER the raw IP. Coarse dedupe for the attempts dashboard (Part C).';
