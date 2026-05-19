-- Migration: 063_lemma_overrides.sql
-- Sprint 12.6 — manual lemma overrides for the vocab capture pipeline.
--
-- spaCy's en_core_web_sm (services/lemmatizer.py, Sprint 10.1) gets
-- ~98% of English lemmas right, but stumbles on:
--   - Vietnamese/loanword captures the user spoke ("phở", "bánh mì")
--   - Proper nouns that lowercase to common nouns ("the Crown" → "crown")
--   - IELTS-relevant idioms split per-token ("on cloud nine")
--   - Domain-specific compounds spaCy treats as separate ("data scientist")
--
-- This table lets admins ship one-off mappings without retraining the
-- model. The lemmatize() helper checks here first, then falls back to
-- spaCy, so adding/removing an override is hot — no service restart.
--
-- Idempotent: re-running this migration is a no-op.

CREATE TABLE IF NOT EXISTS lemma_overrides (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_word TEXT NOT NULL UNIQUE,
    lemma         TEXT NOT NULL,
    pos_tag       TEXT,
    notes         TEXT,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Hot path: lemmatize() looks up the lowercased surface form on every
-- vocab capture, so an index on original_word is mandatory.
CREATE INDEX IF NOT EXISTS idx_lemma_overrides_word
    ON lemma_overrides (original_word);

-- RLS — admin-only writes. The lemmatize() helper reads via the admin
-- client so RLS doesn't gate the override lookup itself.
ALTER TABLE lemma_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage lemma overrides" ON lemma_overrides;
CREATE POLICY "Admins manage lemma overrides"
    ON lemma_overrides FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() AND users.role = 'admin'
        )
    );

COMMENT ON TABLE lemma_overrides IS
    'Sprint 12.6 — admin-managed manual mappings for the vocab capture '
    'lemmatizer. Checked before spaCy in services/lemmatizer.lemmatize().';

COMMENT ON COLUMN lemma_overrides.original_word IS
    'Sprint 12.6 — the lowercased surface form the user spoke/wrote. '
    'UNIQUE so a given input has exactly one override.';

COMMENT ON COLUMN lemma_overrides.lemma IS
    'Sprint 12.6 — the canonical form the override maps to. May equal '
    'original_word verbatim when admins want to suppress spaCy''s '
    'incorrect stemming (e.g. preserve "data" instead of "datum").';

COMMENT ON COLUMN lemma_overrides.pos_tag IS
    'Sprint 12.6 — optional POS tag (VERB/NOUN/ADJ/…) returned alongside '
    'the lemma. NULL means "let spaCy classify the POS even though the '
    'lemma is overridden" — useful when the lemma is right but the '
    'multi-word handling is what spaCy got wrong.';
