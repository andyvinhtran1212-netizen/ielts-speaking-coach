-- Migration 199: Route Vocabulary Wiki card reports into the shared admin inbox.
--
-- user_feedback is the canonical destination for learner-submitted reports.
-- Vocabulary reports reuse test_id as a stable polymorphic content key:
--   vocabulary:<category>/<slug>
-- No new column is needed; only the existing skill constraint must be widened.

ALTER TABLE user_feedback
    DROP CONSTRAINT IF EXISTS user_feedback_skill_check;

ALTER TABLE user_feedback
    ADD CONSTRAINT user_feedback_skill_check
    CHECK (skill IN ('reading', 'listening', 'vocabulary'));

-- Preserve the reports submitted before this cutover. Reusing the analytics
-- event UUID as the feedback UUID makes this backfill idempotent.
INSERT INTO user_feedback (
    id, type, skill, attempt_id, test_id, q_num, category, note, status,
    created_by, anon_id, created_at
)
SELECT
    ae.id,
    'report',
    'vocabulary',
    NULL,
    'vocabulary:' || (ae.event_data->>'category') || '/' || (ae.event_data->>'slug'),
    NULL,
    CASE ae.event_data->>'reason'
        WHEN 'audio' THEN 'audio_issue'
        WHEN 'content' THEN 'content_issue'
        ELSE 'other'
    END,
    NULL,
    'new',
    u.id,
    NULL,
    ae.created_at
FROM analytics_events ae
LEFT JOIN users u ON u.id = ae.user_id
WHERE ae.event_name = 'vocab_card_flagged'
  AND COALESCE(ae.event_data->>'category', '') <> ''
  AND COALESCE(ae.event_data->>'slug', '') <> ''
ON CONFLICT (id) DO NOTHING;
