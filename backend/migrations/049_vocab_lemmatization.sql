-- Migration: 049_vocab_lemmatization.sql
-- Sprint 10.1 — server-side lemmatization foundation.
--
-- Adds 4 shadow columns to user_vocabulary so the capture pipeline can
-- store a dictionary-form `lemma` alongside the verbatim `surface_form`
-- the learner produced. Sprint 10.0 discovery flagged that the existing
-- Guard 6 dedup catches near-duplicates via Levenshtein ≤ 2 + prefix
-- root + ~9 semantic clusters, but irregular forms (ran/run, went/go)
-- slip through. The lemmatizer service (services/lemmatizer.py) uses
-- spaCy en_core_web_sm to compute lemma + POS; Guard 6 grows a primary
-- lemma-equality check that fires before the fallback 3.
--
-- DUAL-WRITE WINDOW: the `headword` column stays canonical for now and
-- the existing UNIQUE (user_id, lower(headword)) constraint stays in
-- place. Sprint 10.6 will flip the dedup constraint to (user_id, lemma)
-- after the backfill has populated every alive row. This migration is
-- additive only — no DROP, no ALTER on existing columns, no constraint
-- change. Safe to re-run; safe to roll back forward by leaving the
-- columns in place (they'll just stay NULL).
--
-- lemma_version is the schema-side bump pointer for the lemmatizer's
-- rule set. When the lemmatizer.py implementation changes meaningfully
-- (spaCy upgrade, custom rule additions), bump lemma_version() in the
-- service and the backfill job re-walks every row whose stored version
-- is below the current value.

ALTER TABLE user_vocabulary
    ADD COLUMN IF NOT EXISTS surface_form  TEXT,
    ADD COLUMN IF NOT EXISTS lemma         TEXT,
    ADD COLUMN IF NOT EXISTS pos           TEXT,
    ADD COLUMN IF NOT EXISTS lemma_version INTEGER DEFAULT 1;

-- Partial index supports the Sprint 10.1 Guard 6 lemma-equality lookup
-- without touching the existing UNIQUE-on-headword index. Filters out
-- archived rows so dedup ignores soft-deleted items (consistent with
-- the rest of the read-path filters).
CREATE INDEX IF NOT EXISTS idx_user_vocabulary_user_lemma
    ON user_vocabulary (user_id, lemma)
    WHERE lemma IS NOT NULL AND is_archived = false;
