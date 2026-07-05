-- ============================================================================
-- Migration 127 — knowledge_points (KP layer, Phase 0)
-- ============================================================================
--
-- The unifying layer over grammar + vocab + reading-skill. Every future exam
-- question / solution step / distractor / recommendation will point at a KP via
-- `kp_refs`, so a single learner profile can span all four skills instead of
-- living in parallel silos (grammar_recommendations, quiz_word_stats, SRS).
--
-- A KP holds NO content — it is only a POINTER to an asset that already exists:
--   * grammar → a Grammar Wiki article slug (+ optional deep-link anchor)
--   * vocab   → a vocab_cards headword slug
--   * skill   → one of the 8 closed reading skill_tags
-- Because the target lives in three different stores (markdown files, the
-- vocab_cards table, and a Python enum) there is no FK to enforce here.
-- Integrity is guaranteed instead by:
--   1. scripts/seed_knowledge_points.py — seeds ONLY from live assets.
--   2. CI ref-drift (test_grammar_wiki_ref_drift + verify_anchor_drift.py,
--      extended in Phase 0.6) — every kp_ref must resolve to a real KP, and
--      every KP must resolve to a real asset.
--
-- anchor is NOT NULL DEFAULT '' (not nullable) on purpose: Postgres treats NULLs
-- as DISTINCT in a UNIQUE constraint, so a nullable anchor would allow duplicate
-- article-level rows (grammar,'articles',NULL) × N. Empty string = "whole
-- article / no anchor" and makes the UNIQUE + upsert-on-conflict deterministic.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor BEFORE merge,
-- THEN run:  cd backend && python -m scripts.seed_knowledge_points
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_points (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What kind of asset this KP points at.
    kp_type     TEXT NOT NULL CHECK (kp_type IN ('grammar', 'vocab', 'skill')),

    -- The pointer. For grammar/vocab this is the article/card slug; for skill
    -- it is the reading skill_tag (e.g. 'inference').
    ref_slug    TEXT NOT NULL,

    -- Optional deep-link section within a grammar article (reuses the
    -- feedback-anchor-mapping anchor convention, e.g.
    -- 'present-perfect.common-mistake.past-simple-where-pp-needed').
    -- '' means article-level / no anchor. See header for why NOT NULL.
    anchor      TEXT NOT NULL DEFAULT '',

    -- Band/CEFR level so the personal roadmap can topo-order KPs. May be ''.
    level       TEXT NOT NULL DEFAULT '',

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Identity: one KP per (type, slug, anchor). Lets the seed upsert idempotently.
    CONSTRAINT knowledge_points_identity_key UNIQUE (kp_type, ref_slug, anchor)
);

-- Roadmap / recommendation lookups filter by type first, then slug.
CREATE INDEX IF NOT EXISTS idx_kp_type      ON knowledge_points (kp_type);
CREATE INDEX IF NOT EXISTS idx_kp_type_slug ON knowledge_points (kp_type, ref_slug);
