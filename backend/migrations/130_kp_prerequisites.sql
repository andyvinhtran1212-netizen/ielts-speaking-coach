-- ============================================================================
-- Migration 130 — kp_prerequisites (Phase 2, the roadmap graph)
-- ============================================================================
--
-- The prerequisite DAG among Knowledge Points, materialized from the Grammar
-- Wiki frontmatter `prerequisites:` that already exists (106 articles, 375
-- edges). One row per edge: "to learn `kp_id`, first master `prereq_kp_id`".
-- Seeded by scripts/seed_kp_prerequisites.py (grammar article-level KPs only,
-- anchor='').
--
-- The personal roadmap (services/kp_roadmap.py) topo-sorts the subgraph of a
-- learner's weak KPs plus their not-yet-strong prerequisites, so lessons are
-- ordered prereq-first.
--
-- Both columns FK knowledge_points (mig 127) → no dangling edges; ON DELETE
-- CASCADE keeps the graph clean if a KP is ever removed. A self-edge is rejected.
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor BEFORE merge,
-- THEN run:  cd backend && python -m scripts.seed_kp_prerequisites
-- ============================================================================

CREATE TABLE IF NOT EXISTS kp_prerequisites (
    kp_id        UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    prereq_kp_id UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (kp_id, prereq_kp_id),
    CONSTRAINT kp_prerequisites_no_self CHECK (kp_id <> prereq_kp_id)
);

-- Roadmap walks the graph both ways: "what does X require" (by kp_id) and
-- "what unlocks once Y is mastered" (by prereq_kp_id).
CREATE INDEX IF NOT EXISTS idx_kp_prereq_kp     ON kp_prerequisites (kp_id);
CREATE INDEX IF NOT EXISTS idx_kp_prereq_prereq ON kp_prerequisites (prereq_kp_id);
