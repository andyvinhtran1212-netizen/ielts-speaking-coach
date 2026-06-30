-- ============================================================================
-- Migration 120 — seed grammar content topics (Pha 4)
-- ============================================================================
-- Grammar exercises reuse the quiz engine with skill_area='grammar'. A grammar
-- topic = a grammar CATEGORY (the on-disk content/<category>/ dirs), so admins
-- have the topic framework ready to hang exercise banks on. Banks reference
-- specific Wiki articles via quiz_questions.grammar_article_slug.
--
-- Slugs mirror the content/ directories; titles match grammar_service._prettify.
-- Idempotent (ON CONFLICT DO NOTHING) — safe to re-run. No schema change
-- (content_topics.skill_area already exists from mig 117).
--
-- ADDITIVE. Apply by hand BEFORE merge.
-- ============================================================================

INSERT INTO content_topics (slug, skill_area, title) VALUES
    ('foundations',          'grammar', 'Foundations'),
    ('parts-of-speech',      'grammar', 'Parts Of Speech'),
    ('modifiers',            'grammar', 'Modifiers'),
    ('sentence-structures',  'grammar', 'Sentence Structures'),
    ('tenses',               'grammar', 'Tenses'),
    ('verb-patterns',        'grammar', 'Verb Patterns'),
    ('grammar-for-meaning',  'grammar', 'Grammar For Meaning'),
    ('grammar-for-writing',  'grammar', 'Grammar For Writing'),
    ('ielts-grammar-lab',    'grammar', 'IELTS Grammar Lab'),
    ('error-clinic',         'grammar', 'Error Clinic')
ON CONFLICT (skill_area, slug) DO NOTHING;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DELETE FROM content_topics WHERE skill_area = 'grammar';
