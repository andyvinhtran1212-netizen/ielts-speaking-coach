#!/usr/bin/env bash
# READ-ONLY traffic baseline for exposure-floor calibration (plan v3 B36/§18.9).
# Counts per-flow volume over the last 14/28 days. SELECT-only — safe on prod.
# Usage (from repo root):  backend/scripts/traffic_baseline.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="$(grep '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
[[ -n "$DB_URL" ]] || { echo "DATABASE_URL not found in backend/.env" >&2; exit 1; }

echo "== target: $(echo "$DB_URL" | grep -oE '@[^:/@]+' | head -1)  ($(date -u +%FT%TZ))"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
\pset footer off
SELECT flow, d14, d28 FROM (
  SELECT 'speaking: sessions created'        AS flow, count(*) FILTER (WHERE started_at  > now()-interval '14 days') AS d14, count(*) FILTER (WHERE started_at  > now()-interval '28 days') AS d28, 1 o FROM sessions
  UNION ALL SELECT 'speaking: responses graded',        count(*) FILTER (WHERE recorded_at > now()-interval '14 days'), count(*) FILTER (WHERE recorded_at > now()-interval '28 days'), 2 FROM responses
  UNION ALL SELECT 'writing: essays submitted',         count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 3 FROM writing_essays
  UNION ALL SELECT 'reading: test attempts',            count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 4 FROM reading_test_attempts
  UNION ALL SELECT 'listening: test attempts',          count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 5 FROM listening_test_attempts
  UNION ALL SELECT 'listening: drill/mini attempts',    count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 6 FROM listening_attempts
  UNION ALL SELECT 'listening: dictation sessions',     count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 7 FROM dictation_sessions
  UNION ALL SELECT 'vocab: quiz attempts',              count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 8 FROM quiz_attempts
  UNION ALL SELECT 'vocab: quiz sessions',              count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 9 FROM quiz_sessions
  UNION ALL SELECT 'vocab: D1 exercise sessions',       count(*) FILTER (WHERE started_at  > now()-interval '14 days'), count(*) FILTER (WHERE started_at  > now()-interval '28 days'), 10 FROM d1_sessions
  UNION ALL SELECT 'vocab: flashcard reviews',          count(*) FILTER (WHERE reviewed_at > now()-interval '14 days'), count(*) FILTER (WHERE reviewed_at > now()-interval '28 days'), 11 FROM flashcard_review_log
  UNION ALL SELECT 'grammar: article views',            count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 12 FROM article_views
  UNION ALL SELECT 'grammar/exam: MCQ exam attempts',   count(*) FILTER (WHERE started_at  > now()-interval '14 days'), count(*) FILTER (WHERE started_at  > now()-interval '28 days'), 13 FROM exam_attempts
  UNION ALL SELECT 'mock: exam sittings',               count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 14 FROM mock_exam_sittings
  UNION ALL SELECT 'platform: analytics events',        count(*) FILTER (WHERE created_at  > now()-interval '14 days'), count(*) FILTER (WHERE created_at  > now()-interval '28 days'), 15 FROM analytics_events
) t ORDER BY o;

\echo == active users (distinct, 14 days) ==
SELECT 'speaking' AS flow, count(DISTINCT user_id) AS users_14d FROM sessions WHERE started_at > now()-interval '14 days'
UNION ALL SELECT 'writing', count(DISTINCT student_id) FROM writing_essays WHERE created_at > now()-interval '14 days'
UNION ALL SELECT 'reading', count(DISTINCT user_id) FROM reading_test_attempts WHERE created_at > now()-interval '14 days'
UNION ALL SELECT 'listening', count(DISTINCT user_id) FROM listening_test_attempts WHERE created_at > now()-interval '14 days';

\echo == top analytics events (14 days) ==
SELECT event_name, count(*) FROM analytics_events
WHERE created_at > now()-interval '14 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
SQL
