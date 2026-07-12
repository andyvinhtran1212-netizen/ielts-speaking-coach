-- ============================================================================
-- Migration 151 — mock exam SEQUENTIAL section gating (additive over 150)
-- ============================================================================
--
-- Product decision (2026-07-12): reverses the "all-at-once, one total timer"
-- model from migration 150. The three seated sections now open ONE AT A TIME,
-- admin-gated: Listening → (admin sees all submitted, opens Reading) →
-- Reading → (admin opens Writing) → Writing. Each section has its OWN
-- server-authoritative start timestamp and duration, shared across every
-- sitting under the exam (one classroom clock, not one clock per student).
--
--   • Listening duration = the test's audio length + a small buffer (computed
--     at read time from listening_tests.full_audio_duration_seconds — not
--     stored here).
--   • Reading duration   = reading_minutes (admin-configurable, default 60).
--   • Writing duration   = writing_minutes (admin-configurable, no fixed
--     real-world analogue — admin sets it per exam).
--
-- total_minutes (mig 150) is left in place, unused by the new gating logic,
-- as an informational "estimated total" the create-exam UI can still show.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS active_section TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS reading_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS writing_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS listening_started_at TIMESTAMPTZ;
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS reading_started_at   TIMESTAMPTZ;
ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS writing_started_at    TIMESTAMPTZ;

ALTER TABLE mock_exams
    DROP CONSTRAINT IF EXISTS mock_exams_active_section_check;
ALTER TABLE mock_exams
    ADD CONSTRAINT mock_exams_active_section_check CHECK (active_section IN (
        'not_started', 'listening', 'reading', 'writing', 'done'));

COMMENT ON COLUMN mock_exams.active_section IS
'Admin-driven cursor over the seated LRW sequence. Advances one-way via
POST /admin/mock-exams/{id}/advance — not_started → listening → reading →
writing → done (skipping any section the exam has no test/prompt for).';
COMMENT ON COLUMN mock_exams.reading_minutes IS
'Reading section duration in minutes (admin-configurable, default 60).';
COMMENT ON COLUMN mock_exams.writing_minutes IS
'Writing section duration in minutes (admin-configurable).';
COMMENT ON COLUMN mock_exams.listening_started_at IS
'Server timestamp when the admin opened Listening — the shared countdown
anchor for every sitting under this exam (one classroom clock).';
COMMENT ON COLUMN mock_exams.reading_started_at IS
'Server timestamp when the admin opened Reading (shared countdown anchor).';
COMMENT ON COLUMN mock_exams.writing_started_at IS
'Server timestamp when the admin opened Writing (shared countdown anchor).';
