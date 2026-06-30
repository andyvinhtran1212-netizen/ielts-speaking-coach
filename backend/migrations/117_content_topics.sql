-- ============================================================================
-- Migration 117 — content_topics (topic-centric content spine) + vocab_cards.topic_id
-- ============================================================================
-- Pha 0 of the Quick-Check quiz / topic-centric content plan
-- (docs/research/QUICK_CHECK_QUIZ_AND_TOPIC_CONTENT_PLAN.md).
--
-- A "topic" (chủ đề) is the organizing spine: vocab cards (now) + vocab quiz
-- banks + grammar exercises (later) all hang off a topic. `skill_area` scopes a
-- topic to one content area so a vocab "work-career" topic and a future grammar
-- topic with the same theme slug never collide (UNIQUE is per skill_area).
--
-- vocab_cards.category is KEPT as the source of truth for the public wiki + CI;
-- topic_id is an additive organizing layer on top (FK SET NULL so dropping a
-- topic never deletes cards).
--
-- ADDITIVE. Apply by hand in the Supabase SQL editor BEFORE merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_topics (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    slug         TEXT NOT NULL,
    skill_area   TEXT NOT NULL DEFAULT 'vocab',   -- 'vocab' | 'grammar' | … (later)
    title        TEXT NOT NULL,
    title_vi     TEXT,
    description  TEXT,
    "order"      INT  NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (skill_area, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_topics_skill_area
    ON content_topics (skill_area, "order");

-- updated_at auto-bump (reuses the project-wide trigger fn from mig 033).
DROP TRIGGER IF EXISTS trg_content_topics_updated_at ON content_topics;
CREATE TRIGGER trg_content_topics_updated_at
    BEFORE UPDATE ON content_topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: SELECT public (topics drive public browse); writes service-role only.
ALTER TABLE content_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_topics_public_read ON content_topics;
CREATE POLICY content_topics_public_read ON content_topics
    FOR SELECT USING (true);

-- ── vocab_cards → topic link (additive, nullable) ───────────────────────────
ALTER TABLE vocab_cards
    ADD COLUMN IF NOT EXISTS topic_id UUID
    REFERENCES content_topics (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vocab_cards_topic_id ON vocab_cards (topic_id);

-- ── Backfill: one vocab topic per existing DISTINCT category; link cards ─────
-- slug + title both seed from the category slug; admins can rename title/title_vi
-- later via the topic console. Idempotent (ON CONFLICT + WHERE topic_id IS NULL).
INSERT INTO content_topics (slug, skill_area, title)
    SELECT DISTINCT category, 'vocab', category
    FROM vocab_cards
    WHERE category IS NOT NULL AND category <> ''
    ON CONFLICT (skill_area, slug) DO NOTHING;

UPDATE vocab_cards vc
    SET topic_id = ct.id
    FROM content_topics ct
    WHERE ct.skill_area = 'vocab'
      AND ct.slug = vc.category
      AND vc.topic_id IS NULL;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- ALTER TABLE vocab_cards DROP COLUMN IF EXISTS topic_id;
-- DROP TABLE IF EXISTS content_topics;
