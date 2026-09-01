-- Migration: 210_dictation_session_idempotency.sql
-- Mô tả: durable receipt for retry-safe Listening Dictation completion.
--
-- A browser can lose the HTTP acknowledgement after the session row has been
-- committed.  The client-generated UUID lets POST retries reconcile to the
-- same canonical row instead of creating a duplicate completion report.

ALTER TABLE dictation_sessions
    ADD COLUMN IF NOT EXISTS client_request_id UUID,
    ADD COLUMN IF NOT EXISTS submission_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dictation_sessions_user_client_request
    ON dictation_sessions (user_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN dictation_sessions.client_request_id IS
    'Client-generated completion receipt. Unique per learner when present.';
COMMENT ON COLUMN dictation_sessions.submission_fingerprint IS
    'SHA-256 of the canonical completion payload; rejects request-id reuse with changed content.';
