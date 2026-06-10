-- 095_grammar_rec_context_check.sql
--
-- C-2.6 audit — grammar_recommendations must carry at least one context FK.
--
-- The table (migration 014) left response_id / session_id / user_id all
-- NULLABLE, so a row with no context at all is structurally possible and
-- would be unattributable (the frontend resolves recommendations by
-- response_id first, then session_id, then user_id). This CHECK guarantees
-- every row has at least one anchor.
--
-- Pre-flight (measured 2026-06-10 against prod, the one dev=prod Supabase):
--   SELECT count(*) FROM grammar_recommendations
--    WHERE response_id IS NULL AND session_id IS NULL AND user_id IS NULL;
--   → 0  (of 3060 total rows). No backfill needed; the constraint validates clean.
--
-- PLAIN ALTER, NO BEGIN/COMMIT — applied BY HAND via the Supabase SQL editor
-- (this repo has no migration runner; merging a PR does NOT execute SQL).
-- Forward-only; no old migration modified.
--
-- Apply: run manually.

ALTER TABLE grammar_recommendations
  ADD CONSTRAINT ck_grammar_rec_has_context
  CHECK (response_id IS NOT NULL OR session_id IS NOT NULL OR user_id IS NOT NULL);

-- ROLLBACK:
--   ALTER TABLE grammar_recommendations DROP CONSTRAINT ck_grammar_rec_has_context;
