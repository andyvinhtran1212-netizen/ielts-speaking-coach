"""Frozen-cohort classifier reviewed against actual PostgreSQL and quiz engine.

Internal rows contain owned identifiers solely for the private bounded receipt.
Public admin responses aggregate reason counts. No mastery/purpose backfill.
"""
CLASSIFY_OWNERS_SQL = r"""
WITH
b AS (
  SELECT id, code, meta,
    code IN ('G-parts-of-speech-verbs',
      'G-sentence-structures-passive-voice', 'G-tenses-past-continuous',
      'G-tenses-present-continuous', 'G-tenses-present-perfect-continuous',
      'G-tenses-present-simple', 'G-grammar-for-reading-participle-clauses',
      'G-grammar-for-reading-long-sentence-untangling',
      'G-grammar-for-reading-reduced-relative-clauses', 'G-tenses-past-perfect',
      'G-foundations-phrase-vs-clause', 'G-error-clinic-dangling-modifiers')
    AND skill_area = 'grammar' AND is_published
    AND jsonb_typeof(meta) = 'object'
    AND meta->'correct_to_master' = '2'::jsonb
    AND meta->'require_distinct_skill' = 'true'::jsonb
    AND meta->'require_production_to_master' = 'true'::jsonb AS valid_meta
  FROM quiz_banks WHERE id = CAST(:bank_id AS uuid)
),
q AS (
  -- Match normalizeQuizBank/createEngine supported-input pool construction.
  -- Do NOT filter counts_toward_mastery here: it affects earned credits, not
  -- which item keys the engine puts into its required word queue.
  SELECT qq.* FROM quiz_questions qq JOIN b ON b.id = qq.bank_id
  WHERE qq.input IN ('choice', 'text', 'boolean', 'syllable')
),
pool AS (SELECT DISTINCT item_key FROM q WHERE btrim(item_key) <> ''),
s AS (
  SELECT qs.* FROM quiz_sessions qs JOIN b ON b.id = qs.bank_id
  WHERE qs.created_at <= CAST(:cutover_at AS timestamptz)
),
a AS (
  SELECT qa.* FROM quiz_attempts qa JOIN b ON b.id = qa.bank_id
  WHERE qa.created_at <= CAST(:cutover_at AS timestamptz)
),
w AS (SELECT ws.* FROM quiz_word_stats ws JOIN b ON b.id = ws.bank_id),
actors AS (
  SELECT user_id FROM s UNION SELECT user_id FROM a UNION SELECT user_id FROM w
),
completion_hint AS (
  -- Persisted client summary is a conservative ambiguity signal, never a
  -- substitute for the actual persisted mastery formula or proof of purpose.
  SELECT user_id, max(ended_at) AS hinted_at FROM s
  WHERE ended_by = 'completed' AND ended_at IS NOT NULL
    AND words_mastered = (SELECT count(*) FROM pool)
    AND words_carried_over = 0 AND total_questions > 0
  GROUP BY user_id
),
checked_stats AS (
  SELECT w.*, ls.started_at AS lineage_started_at,
    NOT COALESCE(jsonb_typeof(w.skills_passed) = 'array', false)
    OR w.credit_count < 0 OR w.correct_count < 0 OR w.wrong_count < 0
    OR w.status NOT IN ('testing', 'provisional', 'mastered', 'carried_over')
    OR ls.id IS NULL OR ls.user_id <> w.user_id OR ls.bank_id <> w.bank_id
    OR p.item_key IS NULL
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(w.skills_passed) = 'array' THEN w.skills_passed
        ELSE '[]'::jsonb END) v
      WHERE jsonb_typeof(v) <> 'string' OR btrim(v #>> '{}') = ''
        OR NOT EXISTS (SELECT 1 FROM q
          WHERE q.item_key = w.item_key AND q.skill = (v #>> '{}'))
    ) AS invalid,
    (SELECT count(DISTINCT v) FROM jsonb_array_elements(CASE
      WHEN jsonb_typeof(w.skills_passed) = 'array' THEN w.skills_passed
      ELSE '[]'::jsonb END) v) AS distinct_skills
  FROM w LEFT JOIN s ls ON ls.id = w.last_session_id
  LEFT JOIN pool p ON p.item_key = w.item_key
),
mastery AS (
  SELECT u.user_id, count(p.item_key) AS total,
    count(p.item_key) FILTER (WHERE COALESCE(cs.distinct_skills, 0) >= 2
      AND COALESCE(cs.production_done, false)) AS mastered,
    count(cs.item_key) AS present_pool_stats
  FROM actors u CROSS JOIN pool p
  LEFT JOIN checked_stats cs ON cs.user_id = u.user_id AND cs.item_key = p.item_key
  GROUP BY u.user_id
),
facts AS (
  SELECT u.user_id, COALESCE(m.total, 0) AS total,
    COALESCE(m.total - m.mastered, 0) AS remaining,
    (SELECT count(*) FROM s WHERE s.user_id = u.user_id) AS sessions,
    (SELECT count(*) FROM w WHERE w.user_id = u.user_id) AS stat_rows,
    (SELECT count(*) FROM a WHERE a.user_id = u.user_id) AS attempt_rows,
    EXISTS (SELECT 1 FROM s WHERE s.user_id = u.user_id
      AND s.ended_at IS NULL AND s.ended_by IS NULL) AS has_open,
    EXISTS (SELECT 1 FROM s WHERE s.user_id = u.user_id
      AND s.ended_at IS NOT NULL AND s.ended_by = 'paused') AS has_paused,
    EXISTS (SELECT 1 FROM s WHERE s.user_id = u.user_id
      AND s.ended_at IS NOT NULL AND s.ended_by = 'completed'
      AND s.words_carried_over > 0) AS has_completed_carryover,
    EXISTS (SELECT 1 FROM checked_stats cs WHERE cs.user_id = u.user_id
      AND cs.invalid) AS malformed_or_orphan_stats,
    EXISTS (SELECT 1 FROM a LEFT JOIN s ON s.id = a.session_id
      WHERE a.user_id = u.user_id AND (s.id IS NULL OR s.user_id <> a.user_id
        OR s.bank_id <> a.bank_id OR NOT EXISTS (
          SELECT 1 FROM pool WHERE pool.item_key = a.item_key))) AS malformed_or_orphan_attempt,
    EXISTS (SELECT 1 FROM s WHERE s.user_id = u.user_id
      AND ((s.ended_at IS NULL) <> (s.ended_by IS NULL)
        OR COALESCE(s.kind, 'run') <> 'run'
        OR s.ended_by NOT IN ('completed', 'paused', 'time_cap'))) AS conflicting_session,
    ch.hinted_at,
    EXISTS (SELECT 1 FROM checked_stats cs
      WHERE cs.user_id = u.user_id AND NOT cs.invalid
        AND cs.lineage_started_at > ch.hinted_at) AS post_hint_work,
    EXISTS (SELECT 1 FROM a WHERE a.user_id = u.user_id
      AND (ch.hinted_at IS NULL OR a.created_at > ch.hinted_at)
      AND NOT EXISTS (SELECT 1 FROM checked_stats cs
        WHERE cs.user_id = a.user_id AND cs.item_key = a.item_key)) AS missing_attempted_pool_stats
  FROM actors u LEFT JOIN mastery m ON m.user_id = u.user_id
  LEFT JOIN completion_hint ch ON ch.user_id = u.user_id
),
classified AS (
  SELECT user_id, CASE
    WHEN NOT COALESCE((SELECT valid_meta FROM b), false)
      OR total = 0 THEN 'unknown_bank_or_metadata'
    WHEN malformed_or_orphan_stats OR malformed_or_orphan_attempt
      OR conflicting_session THEN 'unknown_malformed_or_orphan'
    WHEN sessions = 0 AND stat_rows = 0 AND attempt_rows = 0
      THEN 'never_started'
    WHEN sessions = 0 THEN 'unknown_progress_without_admission'
    WHEN remaining = 0 THEN 'genuinely_mastered'
    WHEN hinted_at IS NOT NULL AND NOT post_hint_work
      THEN 'unknown_reset_or_review'
    WHEN missing_attempted_pool_stats THEN 'unknown_missing_progress'
    WHEN has_open THEN 'provably_unfinished_in_progress'
    WHEN has_paused THEN 'provably_unfinished_paused'
    WHEN has_completed_carryover THEN 'provably_unfinished_completed_with_carryover'
    ELSE 'provably_unfinished_terminal_carryover'
  END AS classification FROM facts
)
SELECT user_id,classification FROM classified ORDER BY user_id;

"""
