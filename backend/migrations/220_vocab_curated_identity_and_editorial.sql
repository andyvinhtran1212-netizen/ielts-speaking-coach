-- ============================================================================
-- Migration 220 — Curated Vocab Wiki identity, versions and editorial workflow
-- ============================================================================
--
-- `vocab_cards` remains the broad reference library. A curated learning unit has
-- a different identity: sense + construction + communicative function + context.
-- This migration adds that identity without changing any legacy card contract.
-- Published versions are immutable by application convention; a unit points to
-- the currently published version so rollback is a pointer change, not a rewrite.
--
-- ADDITIVE + idempotent. Apply after migration 219.
-- ============================================================================

ALTER TABLE knowledge_points
    DROP CONSTRAINT IF EXISTS knowledge_points_kp_type_check;
ALTER TABLE knowledge_points
    ADD CONSTRAINT knowledge_points_kp_type_check
    CHECK (kp_type IN ('grammar', 'vocab', 'vocab_unit', 'skill'));

CREATE TABLE IF NOT EXISTS vocab_learning_units (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kp_id                        UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE RESTRICT,
    unit_slug                    TEXT NOT NULL UNIQUE,
    display_headword             TEXT NOT NULL,
    unit_type                    TEXT NOT NULL DEFAULT 'learning_unit'
                                     CHECK (unit_type IN ('learning_unit', 'clinic')),
    sense_key                    TEXT NOT NULL,
    construction_key             TEXT NOT NULL,
    communicative_function       TEXT NOT NULL,
    context_key                  TEXT NOT NULL,
    target_level                 TEXT NOT NULL,
    problem_tags                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    learner_tags                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                       TEXT NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft', 'published', 'archived')),
    current_published_version_id UUID,
    created_by                   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_learning_units_kp_key UNIQUE (kp_id),
    CONSTRAINT vocab_learning_units_identity_key UNIQUE (
        sense_key, construction_key, communicative_function, context_key
    )
);

CREATE TABLE IF NOT EXISTS vocab_unit_versions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id          UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    version_number   INTEGER NOT NULL CHECK (version_number > 0),
    schema_version   INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'in_review', 'published', 'archived')),
    content          JSONB NOT NULL,
    content_hash     TEXT NOT NULL,
    sources          JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_note      TEXT,
    authored_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    published_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_unit_versions_number_key UNIQUE (unit_id, version_number),
    CONSTRAINT vocab_unit_versions_hash_key UNIQUE (unit_id, content_hash)
);

ALTER TABLE vocab_learning_units
    DROP CONSTRAINT IF EXISTS vocab_learning_units_current_version_fkey;
ALTER TABLE vocab_learning_units
    ADD CONSTRAINT vocab_learning_units_current_version_fkey
    FOREIGN KEY (current_published_version_id)
    REFERENCES vocab_unit_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS vocab_card_unit_map (
    card_id       UUID NOT NULL REFERENCES vocab_cards(id) ON DELETE CASCADE,
    unit_id       UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    relation      TEXT NOT NULL DEFAULT 'reference'
                      CHECK (relation IN ('reference', 'contrast', 'prerequisite')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (card_id, unit_id, relation)
);

CREATE TABLE IF NOT EXISTS vocab_unit_version_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id    UUID NOT NULL REFERENCES vocab_unit_versions(id) ON DELETE CASCADE,
    reviewer_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    review_type   TEXT NOT NULL
                      CHECK (review_type IN ('language', 'pedagogy', 'assessment')),
    decision      TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_unit_version_reviews_reviewer_key
        UNIQUE (version_id, reviewer_id, review_type)
);

CREATE TABLE IF NOT EXISTS vocab_pathways (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pathway_slug   TEXT NOT NULL UNIQUE,
    title_vi       TEXT NOT NULL,
    description_vi TEXT NOT NULL,
    target_level   TEXT NOT NULL,
    learner_tags   JSONB NOT NULL DEFAULT '[]'::jsonb,
    status         TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'published', 'archived')),
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vocab_pathway_units (
    pathway_id     UUID NOT NULL REFERENCES vocab_pathways(id) ON DELETE CASCADE,
    unit_id        UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    sequence       INTEGER NOT NULL CHECK (sequence > 0),
    rationale_vi   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pathway_id, unit_id),
    CONSTRAINT vocab_pathway_units_sequence_key UNIQUE (pathway_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_vocab_learning_units_status_level
    ON vocab_learning_units(status, target_level);
CREATE INDEX IF NOT EXISTS idx_vocab_unit_versions_unit_status
    ON vocab_unit_versions(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_vocab_card_unit_map_unit
    ON vocab_card_unit_map(unit_id);
CREATE INDEX IF NOT EXISTS idx_vocab_unit_reviews_version
    ON vocab_unit_version_reviews(version_id);
CREATE INDEX IF NOT EXISTS idx_vocab_pathway_units_unit
    ON vocab_pathway_units(unit_id);

DROP TRIGGER IF EXISTS trg_vocab_learning_units_updated_at ON vocab_learning_units;
CREATE TRIGGER trg_vocab_learning_units_updated_at
    BEFORE UPDATE ON vocab_learning_units
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vocab_unit_versions_updated_at ON vocab_unit_versions;
CREATE TRIGGER trg_vocab_unit_versions_updated_at
    BEFORE UPDATE ON vocab_unit_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vocab_unit_version_reviews_updated_at ON vocab_unit_version_reviews;
CREATE TRIGGER trg_vocab_unit_version_reviews_updated_at
    BEFORE UPDATE ON vocab_unit_version_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vocab_pathways_updated_at ON vocab_pathways;
CREATE TRIGGER trg_vocab_pathways_updated_at
    BEFORE UPDATE ON vocab_pathways
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION fn_guard_published_vocab_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'published_vocab_version_is_immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_vocab_version ON vocab_unit_versions;
CREATE TRIGGER trg_guard_published_vocab_version
    BEFORE UPDATE OR DELETE ON vocab_unit_versions
    FOR EACH ROW EXECUTE FUNCTION fn_guard_published_vocab_version();

CREATE OR REPLACE FUNCTION fn_guard_published_vocab_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
BEGIN
    IF EXISTS (
        SELECT 1 FROM vocab_unit_versions
         WHERE id = v_version_id AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'published_vocab_review_is_immutable';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_vocab_review ON vocab_unit_version_reviews;
CREATE TRIGGER trg_guard_published_vocab_review
    BEFORE INSERT OR UPDATE OR DELETE ON vocab_unit_version_reviews
    FOR EACH ROW EXECUTE FUNCTION fn_guard_published_vocab_review();

-- All reads/writes go through the backend service-role client. Public means
-- public HTTP API, not direct anon PostgREST access.
ALTER TABLE vocab_learning_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_unit_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_card_unit_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_unit_version_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_pathway_units ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fn_create_vocab_learning_unit(
    p_unit_slug                TEXT,
    p_display_headword         TEXT,
    p_unit_type                TEXT,
    p_sense_key                TEXT,
    p_construction_key         TEXT,
    p_communicative_function   TEXT,
    p_context_key              TEXT,
    p_target_level             TEXT,
    p_problem_tags             JSONB,
    p_learner_tags             JSONB,
    p_created_by               UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_kp    knowledge_points%ROWTYPE;
    v_unit  vocab_learning_units%ROWTYPE;
BEGIN
    INSERT INTO knowledge_points (kp_type, ref_slug, anchor, level)
    VALUES ('vocab_unit', p_unit_slug, '', p_target_level)
    RETURNING * INTO v_kp;

    INSERT INTO vocab_learning_units (
        kp_id, unit_slug, display_headword, unit_type, sense_key,
        construction_key, communicative_function, context_key, target_level,
        problem_tags, learner_tags, created_by
    ) VALUES (
        v_kp.id, p_unit_slug, p_display_headword, p_unit_type, p_sense_key,
        p_construction_key, p_communicative_function, p_context_key, p_target_level,
        COALESCE(p_problem_tags, '[]'::jsonb),
        COALESCE(p_learner_tags, '[]'::jsonb), p_created_by
    )
    RETURNING * INTO v_unit;

    RETURN to_jsonb(v_unit);
END;
$$;

REVOKE ALL ON FUNCTION fn_create_vocab_learning_unit(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_create_vocab_learning_unit(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, UUID
) TO service_role;
