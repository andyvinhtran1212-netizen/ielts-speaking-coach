-- Migration 002: Topic Question Library
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Purpose:
--   Creates a reusable topic question library so admin can pre-generate/manage
--   questions per topic. The question-generation route will check this library
--   first before calling Gemini.
--
-- Changes:
--   1. Add last_rotated_at to topics table
--   2. Create topic_questions table (per-topic question store)

-- 1. Extend topics table
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS last_rotated_at timestamptz;

-- 2. Topic question library
CREATE TABLE IF NOT EXISTS topic_questions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id            uuid        NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    part                smallint    NOT NULL CHECK (part IN (1, 2, 3)),
    order_num           smallint    NOT NULL DEFAULT 0,
    question_text       text        NOT NULL,
    question_type       text        NOT NULL DEFAULT '',
    -- Part 2 cue card fields (NULL for Part 1 / Part 3)
    cue_card_bullets    jsonb,
    cue_card_reflection text,
    is_active           boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_questions_topic_part
    ON topic_questions (topic_id, part, order_num);
