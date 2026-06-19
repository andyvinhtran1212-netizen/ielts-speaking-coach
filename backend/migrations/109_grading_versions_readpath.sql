-- ============================================================================
-- Migration 109 — Grading versions, READ-PATH foundation (GV-1a)
-- ============================================================================
--
-- Adds the version columns + current-version pointer + the read-path VIEW that
-- GV-1a repoints every current-band read through. Does NOT touch the regrade
-- path (still DELETE→INSERT, destructive — that becomes versioned in GV-1b).
--
-- IDEMPOTENT over the GV-1 spike DDL (the spike already added
-- writing_feedback.version, writing_essays.current_version, and the view) —
-- every statement is ADD COLUMN IF NOT EXISTS / DROP … IF EXISTS / CREATE OR
-- REPLACE, so a re-run (or running after the spike) is safe.
--
-- SAFE ON PROD: all existing rows are version=1, current_version=1, so the view
-- returns exactly today's single row per essay → 0 behaviour change until
-- GV-1b actually creates v2/v3 rows.
--
-- Apply by hand in the Supabase SQL editor (runs as table owner).
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE writing_feedback ADD COLUMN IF NOT EXISTS version        INT NOT NULL DEFAULT 1;
ALTER TABLE writing_feedback ADD COLUMN IF NOT EXISTS source         TEXT;   -- ai_pro|ai_flash|partial|composed (GV-1b)
ALTER TABLE writing_feedback ADD COLUMN IF NOT EXISTS parent_version INT;    -- lineage (GV-1b)
ALTER TABLE writing_feedback ADD COLUMN IF NOT EXISTS provenance     JSONB;  -- compose audit (GV-1b)
ALTER TABLE writing_essays   ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1;

-- ── UNIQUE swap: (essay_id) → (essay_id, version) ────────────────────────────
-- migrations/033:150 declared essay_id as an inline column UNIQUE, which Postgres
-- auto-names `writing_feedback_essay_id_key`. Drop it and re-key on the pair so
-- GV-1b can insert ≤3 versions per essay. (drop-if-exists + add = idempotent.)
-- ⚠ If your DB named the old constraint differently, the DROP IF EXISTS is a
--   no-op and the old single-column UNIQUE survives — verify in the SQL editor
--   that writing_feedback has UNIQUE(essay_id, version) afterwards.
ALTER TABLE writing_feedback DROP CONSTRAINT IF EXISTS writing_feedback_essay_id_key;
ALTER TABLE writing_feedback DROP CONSTRAINT IF EXISTS writing_feedback_essay_id_version_key;
ALTER TABLE writing_feedback ADD  CONSTRAINT writing_feedback_essay_id_version_key UNIQUE (essay_id, version);

-- ── Cap: ≤3 versions per essay (DB-enforced, race-proof; composite UNIQUE alone
--    only keys the version number, it does NOT bound the budget) ──────────────
ALTER TABLE writing_feedback DROP CONSTRAINT IF EXISTS writing_feedback_version_range_chk;
ALTER TABLE writing_feedback ADD  CONSTRAINT writing_feedback_version_range_chk CHECK (version BETWEEN 1 AND 3);

-- ── Read-path view: the one current row per essay ────────────────────────────
CREATE OR REPLACE VIEW writing_feedback_current AS
  SELECT wf.*
  FROM writing_feedback wf
  JOIN writing_essays e ON e.id = wf.essay_id AND wf.version = e.current_version;

-- ── Reverse (run manually if needed) ─────────────────────────────────────────
-- DROP VIEW IF EXISTS writing_feedback_current;
-- ALTER TABLE writing_feedback DROP CONSTRAINT IF EXISTS writing_feedback_version_range_chk;
-- ALTER TABLE writing_feedback DROP CONSTRAINT IF EXISTS writing_feedback_essay_id_version_key;
-- ALTER TABLE writing_feedback ADD  CONSTRAINT writing_feedback_essay_id_key UNIQUE (essay_id);
-- ALTER TABLE writing_feedback DROP COLUMN IF EXISTS provenance, DROP COLUMN IF EXISTS parent_version,
--   DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS version;
-- ALTER TABLE writing_essays DROP COLUMN IF EXISTS current_version;
