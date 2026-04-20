-- Migration 016: Add subtopic column to questions table
-- Required for Full Test Part 1 — stores the per-question subtopic label
-- (3 subtopics × 3 questions = 9 per full-test session).
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to run on already-migrated DBs.

ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS subtopic text;
