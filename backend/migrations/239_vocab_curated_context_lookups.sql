-- ============================================================================
-- Migration 239 — Exact authored-context links to curated vocabulary units
-- ============================================================================
--
-- This is deliberately not a dictionary index. Editors may map an authored
-- Reading glossary term to exactly one curated learning unit. Missing,
-- ambiguous, inactive, or unpublished targets produce no learner CTA.
--
-- ADDITIVE + idempotent. Apply after migration 238.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vocab_context_lookup_terms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surface_scope   TEXT NOT NULL
                        CHECK (surface_scope IN ('reading_glossary')),
    term            TEXT NOT NULL
                        CHECK (char_length(term) BETWEEN 1 AND 160),
    normalized_term TEXT NOT NULL
                        CHECK (char_length(normalized_term) BETWEEN 1 AND 160)
                        CHECK (normalized_term = btrim(normalized_term)),
    unit_id         UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    rationale_vi    TEXT NOT NULL
                        CHECK (char_length(rationale_vi) BETWEEN 20 AND 500),
    source_key      TEXT NOT NULL
                        CHECK (char_length(source_key) BETWEEN 3 AND 120)
                        CHECK (source_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_context_lookup_terms_scope_term_key
        UNIQUE (surface_scope, normalized_term)
);

CREATE INDEX IF NOT EXISTS idx_vocab_context_lookup_terms_active
    ON vocab_context_lookup_terms(surface_scope, normalized_term, unit_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_vocab_context_lookup_terms_source
    ON vocab_context_lookup_terms(source_key, surface_scope, status);
CREATE INDEX IF NOT EXISTS idx_vocab_context_lookup_terms_creator
    ON vocab_context_lookup_terms(created_by)
    WHERE created_by IS NOT NULL;

DROP TRIGGER IF EXISTS trg_vocab_context_lookup_terms_updated_at
    ON vocab_context_lookup_terms;
CREATE TRIGGER trg_vocab_context_lookup_terms_updated_at
    BEFORE UPDATE ON vocab_context_lookup_terms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vocab_context_lookup_terms ENABLE ROW LEVEL SECURITY;

-- The browser never reads this editorial catalog directly. The backend uses
-- service-role access, applies cohort/read gates, and returns safe unit summaries.
REVOKE ALL ON TABLE vocab_context_lookup_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vocab_context_lookup_terms TO service_role;

COMMIT;
