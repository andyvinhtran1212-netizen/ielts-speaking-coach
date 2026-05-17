-- Migration: 056_listening_module_foundation.sql
-- Sprint 11.1 — Listening module foundation (DEBT-LISTENING-MODULE foundation 1/5).
--
-- averlearning.com has 4 skills live (Speaking, Writing, Vocabulary, Grammar);
-- marketing claim "IELTS toàn diện" was technically incomplete without
-- Listening. Sprint 11.x cluster wires Listening as the 5th skill. Sprint 11.0
-- delivered the discovery doc (docs/sprint-11-0-listening-discovery.md);
-- this migration lands the 4-table schema from §5A.
--
-- Tables:
--   listening_content   — audio asset + transcript + metadata. Same row drives
--                         both mini-test sections AND skill exercises (FK from
--                         listening_exercises). Admin-curated, RLS-free for
--                         all-authenticated read of status='published' rows.
--   listening_exercises — one row per exercise (5 types via discriminator +
--                         JSONB payload). Admin-curated, RLS-free.
--   listening_attempts  — append-only user attempts. RLS USING auth.uid() =
--                         user_id. Analytics derive from this table.
--   listening_sessions  — mini-test parent grouping (one parent + 40 child
--                         attempts per mini test). RLS USING auth.uid() =
--                         user_id.
--
-- Andy locks (from Sprint 11.0 discovery review):
--   Q1 — All 3 audio sources (ai_elevenlabs, upload_mp3, curated_external)
--   Q2 — Mini test (4 sections) + 4 skill exercise types (dictation, gist,
--        true_false, mcq) → 5 exercise_type values total including mini_test.
--   Q3 — Pattern analytics + 1-2 AI insights per session. Schema supports via
--        ai_insights JSONB on attempts + sessions.
--   Q4 — Solo learner + AI-as-teacher. RLS user-scoped only; multi-instructor
--        visibility deferred to Phase B.
--   Q5 — ElevenLabs Creator plan. generation_cost_credits column tracks spend.
--   Q6 — Dictation first (Sprint 11.2 build target).
--
-- Storage bucket: 'listening-audio' (private, signed URLs only). MUST be
-- created via Supabase dashboard — bucket creation is NOT a migration
-- operation. Operator step (Sprint 11.1):
--   1. Supabase dashboard → Storage → New bucket
--   2. Name: 'listening-audio'
--   3. Public bucket: NO (private — signed URLs only per Sprint 11.0 §2A.L2)
--   4. RLS policy on storage.objects: SELECT for authenticated users only.
--
-- License compliance (Sprint 11.0 §4): the external_license + external_source_url
-- columns drive attribution. Premium tier (is_premium=true) + non-commercial
-- license collision is hard-blocked at the router layer, NOT enforced via
-- CHECK constraint — the check is "license string contains NC" which is
-- text-substring-sensitive and better expressed in Python (see
-- routers/listening.py admin_upload_listening Sprint 11.0 §4E).
--
-- Idempotent: re-running this migration is a no-op (IF NOT EXISTS everywhere).
-- No backfill (table is new). Forward-only — no rollback script committed.


-- ── listening_content ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listening_content (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source (Andy Q1 lock: 3 sources)
    source_type              TEXT NOT NULL CHECK (source_type IN (
                                'ai_elevenlabs',
                                'upload_mp3',
                                'curated_external'
                             )),

    -- ElevenLabs metadata (NULL unless source_type='ai_elevenlabs')
    elevenlabs_voice_id      TEXT,
    elevenlabs_model         TEXT CHECK (elevenlabs_model IN (
                                'eleven_multilingual_v2',
                                'eleven_flash_v2_5'
                             )),
    generation_cost_credits  INTEGER,

    -- Curated metadata (NULL unless source_type='curated_external'; the
    -- router enforces "set together or not at all" — Sprint 11.0 §4E)
    external_license         TEXT,
    external_source_url      TEXT,

    -- Storage (bucket-relative path; signed URL generated on read)
    audio_storage_path       TEXT NOT NULL,
    audio_duration_seconds   INTEGER NOT NULL CHECK (audio_duration_seconds > 0),
    audio_size_bytes         INTEGER NOT NULL CHECK (audio_size_bytes > 0),

    -- Linguistic metadata
    accent_tag               TEXT NOT NULL CHECK (accent_tag IN (
                                'us_general', 'uk_rp', 'au', 'ca', 'other'
                             )),
    topic_tags               TEXT[] NOT NULL DEFAULT '{}',
    cefr_level               TEXT CHECK (cefr_level IN ('A2','B1','B2','C1','C2')),
    ielts_section            INTEGER CHECK (ielts_section BETWEEN 1 AND 4),

    -- Transcript
    transcript               TEXT NOT NULL,
    -- Sprint 11.0 §5B: segment-level granularity supports replay-by-segment
    -- + per-segment highlighting in the audio player (Sprint 11.2). Shape:
    --   [{"start": 0, "end": 3.5, "text": "..."}, ...]
    transcript_segments      JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Publishing
    status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft', 'published', 'archived'
                             )),
    is_premium               BOOLEAN NOT NULL DEFAULT FALSE,

    title                    TEXT NOT NULL,
    description              TEXT,

    -- Admin
    created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_content_status_section
    ON listening_content (status, ielts_section);

CREATE INDEX IF NOT EXISTS idx_listening_content_accent
    ON listening_content (accent_tag);

-- GIN index supports topic_tags @> '{travel}' style queries (Sprint 11.4+
-- analytics + filter UI).
CREATE INDEX IF NOT EXISTS idx_listening_content_topic_tags
    ON listening_content USING GIN (topic_tags);


-- ── listening_exercises ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listening_exercises (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id      UUID NOT NULL REFERENCES listening_content(id) ON DELETE CASCADE,

    exercise_type   TEXT NOT NULL CHECK (exercise_type IN (
                        'dictation', 'gist', 'true_false', 'mcq', 'mini_test'
                    )),

    -- Per-type payload — schema differs per exercise_type. See
    -- docs/sprint-11-0-listening-discovery.md §5B for per-type shape.
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Order within a set (mini test Q1-Q40 ordered).
    order_num       INTEGER NOT NULL DEFAULT 1,

    cefr_level      TEXT CHECK (cefr_level IN ('A2','B1','B2','C1','C2')),

    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft', 'published', 'archived'
                    )),

    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_exercises_content
    ON listening_exercises (content_id);

CREATE INDEX IF NOT EXISTS idx_listening_exercises_type_status
    ON listening_exercises (exercise_type, status);


-- ── listening_attempts ──────────────────────────────────────────────
-- Append-only per-attempt log. Analytics aggregator (Sprint 11.5) walks
-- this for accuracy + pattern detection.
CREATE TABLE IF NOT EXISTS listening_attempts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id              UUID NOT NULL REFERENCES listening_exercises(id) ON DELETE CASCADE,

    -- User answer shape depends on exercise_type — JSONB lets one table
    -- serve all 5 types (vs inventing 5 attempt tables). Examples:
    --   dictation:  {"text": "the user typed this"}
    --   mcq:        {"selected_index": 2}
    --   true_false: {"answers": [true, false, true]}
    user_answer              JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- is_correct = NULL for partial-credit grading (dictation word-level).
    -- score carries the precise value (e.g. 4.50 for 4.5/5 words correct).
    is_correct               BOOLEAN,
    score                    NUMERIC(4,2),

    -- Sprint 11.0 §5B pattern-analytics signals
    replay_count             INTEGER NOT NULL DEFAULT 0,
    audio_play_completed     BOOLEAN NOT NULL DEFAULT FALSE,

    -- Linkage to mini-test parent (NULL for standalone skill exercises).
    listening_session_id     UUID,
    time_to_answer_seconds   INTEGER,

    -- Sprint 11.0 §5B: light AI insight signal (Andy Q3). Filled by a
    -- background job after mini-test completion ONLY; skill exercises are
    -- too small to warrant per-attempt AI analysis.
    ai_insights              JSONB,

    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_attempts_user_created
    ON listening_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listening_attempts_session
    ON listening_attempts (listening_session_id)
    WHERE listening_session_id IS NOT NULL;

ALTER TABLE listening_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their listening attempts" ON listening_attempts;
CREATE POLICY "Users own their listening attempts"
    ON listening_attempts FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ── listening_sessions (mini-test grouping) ─────────────────────────
-- Created when a user starts a mini test (4 sections × ~10 questions =
-- 40 child listening_attempts per parent row). Skill exercises do NOT
-- create a session row.
CREATE TABLE IF NOT EXISTS listening_sessions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 4 listening_content IDs for the 4 sections (UUID array preserves order).
    section_content_ids      UUID[] NOT NULL,

    started_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at             TIMESTAMP WITH TIME ZONE,

    total_questions          INTEGER NOT NULL DEFAULT 40,
    correct_count            INTEGER,
    band_estimate            NUMERIC(2,1),

    -- Sprint 11.0 §5B per-section breakdown. Shape:
    --   {"section_1": {"correct":8, "total":10}, ...}
    section_scores           JSONB,

    -- Sprint 11.0 §5B mini-test-scope AI insights.
    ai_insights              JSONB,

    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_created
    ON listening_sessions (user_id, created_at DESC);

ALTER TABLE listening_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their listening sessions" ON listening_sessions;
CREATE POLICY "Users own their listening sessions"
    ON listening_sessions FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ── Documentation comments ─────────────────────────────────────────
COMMENT ON TABLE listening_content IS
    'Sprint 11.1 — audio asset + transcript + metadata. Admin-curated, RLS-'
    'free table; user-scoped clients SELECT status=published only via the '
    'router. Bucket: listening-audio (private, signed URLs).';

COMMENT ON TABLE listening_exercises IS
    'Sprint 11.1 — one row per exercise across 5 types (dictation, gist, '
    'true_false, mcq, mini_test). Multiple exercises can reference the same '
    'listening_content row; payload JSONB shape differs per exercise_type — '
    'see discovery doc §5B.';

COMMENT ON TABLE listening_attempts IS
    'Sprint 11.1 — append-only user attempts. RLS user-scoped. Analytics '
    'aggregator (Sprint 11.5) walks this for accuracy + pattern detection.';

COMMENT ON TABLE listening_sessions IS
    'Sprint 11.1 — mini-test parent grouping. One row per mini test; 40 child '
    'listening_attempts per parent. Skill exercises do NOT create a session row.';

COMMENT ON COLUMN listening_content.is_premium IS
    'Sprint 11.0 §4E — premium-tier gate. Cannot be TRUE when external_license '
    'contains "NC" (non-commercial). Router enforces; no DB CHECK because the '
    'substring rule is text-sensitive.';

COMMENT ON COLUMN listening_content.audio_storage_path IS
    'Bucket-relative path in listening-audio bucket (private). Router generates '
    'a signed URL with 3600s TTL on each GET.';

COMMENT ON COLUMN listening_content.transcript_segments IS
    'Sprint 11.0 §5B — segment-level granularity for replay-by-segment + '
    'per-segment highlighting (Sprint 11.2 audio player). Shape: '
    '[{"start": 0, "end": 3.5, "text": "..."}, ...]';
