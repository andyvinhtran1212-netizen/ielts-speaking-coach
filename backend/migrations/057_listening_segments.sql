-- Migration: 057_listening_segments.sql
-- Sprint 11.3 — Segmented dictation v2 (DEBT-LISTENING-MODULE 3/5).
--
-- Sprint 11.2 shipped single-pass dictation: one audio + one transcript
-- submission. Dogfood on 2026-05-18 (smoke content 7ad9cce9...) surfaced
-- falsification #62 — IELTS dictation practice is SEGMENTED (sentence-
-- by-sentence) per the DailyDictation.com / Cambridge IELTS standard.
-- 15s+ single-pass dictation is fatiguing and doesn't match how IELTS
-- prep platforms actually work.
--
-- This migration adds the segments JSONB column on listening_exercises
-- + segment_idx column on listening_attempts so a single dictation
-- exercise can iterate N segments and grade each independently.
--
-- Segments shape (validated server-side, NOT in DB CHECK because the
-- contiguous-idx + monotonic-times rule is array-cross-row and CHECK
-- can't express it cleanly):
--   [
--     {"idx": 0, "start_sec": 0.0,  "end_sec": 3.5, "transcript": "..."},
--     {"idx": 1, "start_sec": 3.5,  "end_sec": 7.2, "transcript": "..."},
--     ...
--   ]
--
-- Idempotent: re-running is a no-op (IF NOT EXISTS everywhere).
--
-- ── Sprint 11.5.1 hotfix — intentional spec divergence notes ────────
-- Codex audit (2026-05-18 DEBT-LISTENING-MODULE) flagged two surface
-- deltas vs the Sprint 11.3 spec wording. Both are intentional and
-- documented here so future contributors don't "fix" them:
--
-- 1. NO `segments_required_for_dictation` CHECK constraint.
--    Spec implied a DB-level "dictation rows must have non-empty
--    segments[]" check. We rejected that:
--      (a) the segments shape rule (contiguous idx, monotonic times,
--          non-overlap, end_sec <= content.duration) is array-cross-row
--          and CHECK can't express it cleanly — partial CHECKs would be
--          weaker than the server-side `_validate_dictation_segments`;
--      (b) Sprint 11.2 legacy whole-transcript dictation rows exist
--          with empty segments[] and rely on the router fallback to
--          content.transcript — a NOT NULL/non-empty CHECK would break
--          them and force an immediate backfill we don't want yet.
--    Canonical validation lives in `_validate_dictation_segments` in
--    backend/routers/listening.py (called on every upsert).
--
-- 2. NO unique index on (user_id, exercise_id, segment_idx).
--    Spec mentioned a "first-attempt-per-segment uniqueness" index.
--    We rejected a UNIQUE INDEX explicitly (see lines 69-72 below):
--    blocking resubmissions at the DB layer would break the UX (users
--    must be able to retry a segment after a wrong answer). The
--    first-attempt rule is enforced at AGGREGATION time, not INSERT —
--    Sprint 11.5.1 hotfix added `_first_attempt_only()` in listening.py
--    which dedupes by (exercise_id, segment_idx) keeping earliest
--    created_at. INSERTs are append-only by design.
--
-- 3. Smoke backfill seeds 4 segments (not 3 as one spec draft hinted).
--    The Sprint 11.1 smoke audio is 15s / ~244 chars / 4 sentences;
--    4 segments matches the natural sentence count. 3 would have
--    forced an unnatural split. The seed is for dogfood smoke only;
--    production segments are author-defined via the admin editor.


-- ── listening_exercises.segments ───────────────────────────────────
-- Empty array '[]' default keeps Sprint 11.2 attempts working — the
-- attempt router falls back to content.transcript when segments is
-- empty (deprecated path; will be removed once smoke + production
-- content are all migrated to segmented form).
ALTER TABLE listening_exercises
    ADD COLUMN IF NOT EXISTS segments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN listening_exercises.segments IS
    'Sprint 11.3 — array of {idx, start_sec, end_sec, transcript} for '
    'dictation exercises. Empty array for non-dictation types AND for '
    'legacy single-pass dictation rows from Sprint 11.2. Validated '
    'server-side: idx contiguous from 0, start_sec < end_sec, end_sec '
    '<= parent content.audio_duration_seconds, non-overlapping.';


-- ── listening_attempts.segment_idx ─────────────────────────────────
-- NULL for non-dictation attempts AND for legacy whole-transcript
-- attempts. NOT NULL would force a backfill for the Sprint 11.2
-- attempts already in the table.
ALTER TABLE listening_attempts
    ADD COLUMN IF NOT EXISTS segment_idx INTEGER NULL;

COMMENT ON COLUMN listening_attempts.segment_idx IS
    'Sprint 11.3 — 0-indexed segment within the parent exercise.segments '
    'array. NULL for legacy whole-transcript attempts (Sprint 11.2) and '
    'for non-dictation modes.';

-- Index for analytics walks (Sprint 11.6 aggregator):
--   SELECT score FROM listening_attempts WHERE exercise_id=? AND segment_idx=?
CREATE INDEX IF NOT EXISTS idx_listening_attempts_exercise_segment
    ON listening_attempts (exercise_id, segment_idx)
    WHERE segment_idx IS NOT NULL;

-- First-attempt-per-segment uniqueness (Sprint 10.3 carryover applied
-- per-segment). A partial unique index over user+exercise+segment lets
-- a user resubmit (each subsequent row is_first_attempt could be modelled
-- in a separate first_attempts table later; for Sprint 11.3 we treat
-- the FIRST INSERT per (user, exercise, segment) as canonical and rely
-- on the router-level prior-check rather than a DB-level uniqueness
-- constraint that would block resubmission entirely).
--
-- We deliberately DO NOT create a UNIQUE INDEX over (user, exercise,
-- segment) — that would prevent resubmissions which the UX allows.
-- Router enforces first-attempt-canonical semantics via a prior-attempt
-- lookup before each INSERT.


-- ── Smoke content backfill ──────────────────────────────────────────
-- The Sprint 11.1 smoke row (id=7ad9cce9-82bc-4cab-8f1c-f9ebc173521c,
-- "Smoke US Female", 15s, ~244 chars) is the canonical test target for
-- Sprint 11.3 dictation flows. This backfill inserts a published
-- dictation exercise with 4 manually-chosen segments slicing the 15s
-- audio. Times approximated (~3.75s per segment); transcript text
-- pulled verbatim from the content row's transcript split on sentence
-- boundaries.
--
-- Idempotent: ON CONFLICT DO NOTHING — re-running the migration does
-- not duplicate the seed row.
INSERT INTO listening_exercises (
    id,
    content_id,
    exercise_type,
    payload,
    order_num,
    status,
    segments
)
SELECT
    'b5e9c2a0-1111-2222-3333-7ad9cce95001'::uuid,
    c.id,
    'dictation',
    '{}'::jsonb,
    1,
    'published',
    jsonb_build_array(
        jsonb_build_object(
            'idx', 0,
            'start_sec', 0.0,
            'end_sec', LEAST(4.0, c.audio_duration_seconds * 0.25),
            'transcript', 'Hello, this is a smoke test sample.'
        ),
        jsonb_build_object(
            'idx', 1,
            'start_sec', LEAST(4.0, c.audio_duration_seconds * 0.25),
            'end_sec', LEAST(8.0, c.audio_duration_seconds * 0.5),
            'transcript', 'It is generated by ElevenLabs.'
        ),
        jsonb_build_object(
            'idx', 2,
            'start_sec', LEAST(8.0, c.audio_duration_seconds * 0.5),
            'end_sec', LEAST(12.0, c.audio_duration_seconds * 0.75),
            'transcript', 'The voice belongs to Sarah, a US female voice.'
        ),
        jsonb_build_object(
            'idx', 3,
            'start_sec', LEAST(12.0, c.audio_duration_seconds * 0.75),
            'end_sec', c.audio_duration_seconds,
            'transcript', 'This audio confirms the render pipeline works.'
        )
    )
FROM listening_content c
WHERE c.id = '7ad9cce9-82bc-4cab-8f1c-f9ebc173521c'::uuid
ON CONFLICT (id) DO NOTHING;


-- Documentation comments ───────────────────────────────────────────────

COMMENT ON INDEX idx_listening_attempts_exercise_segment IS
    'Sprint 11.3 — partial index for per-segment analytics aggregation. '
    'WHERE segment_idx IS NOT NULL keeps the index small (legacy whole-'
    'transcript attempts are excluded).';
