-- ACCOUNTDATA-0100 T001 gates 2 and 3: read-only catalog check.
-- Run with: psql "$URL" -X -v ON_ERROR_STOP=1 -A -F $'\t' -f account_data_catalog_check.sql
-- Reads only the catalog and key names / counts. Never prints a row value.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '## 1 user-pointing columns (FR-006 rule) in public'
SELECT c.table_name, c.column_name, c.data_type
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
 WHERE c.table_schema = 'public'
   AND (c.column_name IN ('user_id', 'learner_id', 'student_id', 'used_by') OR c.column_name LIKE '%\_user\_id')
 ORDER BY 1, 2;

\echo '## 2 foreign keys to public.users, auth.users, public.students'
SELECT cl.relname AS tbl, a.attname AS col, ft.relnamespace::regnamespace || '.' || ft.relname AS target,
       con.confdeltype AS on_delete
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid AND cl.relnamespace = 'public'::regnamespace
  JOIN pg_class ft ON ft.oid = con.confrelid
  JOIN LATERAL unnest(con.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
 WHERE con.contype = 'f'
   AND con.confrelid IN ('public.users'::regclass, 'auth.users'::regclass, 'public.students'::regclass)
 ORDER BY 1, 2;

\echo '## 3 every foreign key between public tables (child, column, parent, on_delete)'
SELECT cl.relname AS child, a.attname AS col, ft.relname AS parent, con.confdeltype AS on_delete
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid AND cl.relnamespace = 'public'::regnamespace
  JOIN pg_class ft ON ft.oid = con.confrelid AND ft.relnamespace = 'public'::regnamespace
  JOIN LATERAL unnest(con.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
 WHERE con.contype = 'f'
 ORDER BY 3, 1, 2;

\echo '## 4 columns of users, students, sessions, responses, ai_usage_logs, enrollment_orders, enrollment_order_events, entitlement_events and the audit logs'
SELECT table_name, column_name, data_type, is_nullable, (column_default IS NOT NULL) AS has_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('users', 'students', 'sessions', 'responses', 'ai_usage_logs', 'ai_budget_reservations',
                      'enrollment_orders', 'enrollment_order_events', 'entitlement_events',
                      'access_code_audit', 'class_action_log', 'class_lifecycle_audit',
                      'student_lifecycle_audit', 'staff_security_audit', 'staff_privilege_evidence',
                      'credit_ledger', 'credit_reservations', 'credit_covered_requests',
                      'user_code_assignments', 'student_cohort_memberships', 'exercise_book_cohort_grant_log')
 ORDER BY 1, ordinal_position;

\echo '## 5 top-level JSON keys (name and count only) in jsonb columns of kept logs'
DO $$
DECLARE r record; k record;
BEGIN
    FOR r IN
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'jsonb'
           AND table_name IN ('access_code_audit', 'class_action_log', 'class_lifecycle_audit',
                              'student_lifecycle_audit', 'staff_security_audit', 'staff_privilege_evidence',
                              'entitlement_events', 'ai_usage_logs', 'credit_ledger', 'credit_reservations',
                              'credit_covered_requests', 'exercise_book_cohort_grant_log')
         ORDER BY 1, 2
    LOOP
        FOR k IN EXECUTE format(
            'SELECT key, count(*) AS n FROM public.%I t, '
            'LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(t.%I) = ''object'' THEN t.%I ELSE ''{}''::jsonb END) key '
            'GROUP BY key ORDER BY key', r.table_name, r.column_name, r.column_name)
        LOOP
            RAISE NOTICE 'jsonkey	%	%	%	%', r.table_name, r.column_name, k.key, k.n;
        END LOOP;
    END LOOP;
END $$;

\echo '## 6 non-empty free-text counts in kept tables (count only)'
SELECT 'enrollment_orders.learner_note' AS col, count(*) FILTER (WHERE learner_note IS NOT NULL) FROM public.enrollment_orders
UNION ALL SELECT 'enrollment_order_events.note', count(*) FILTER (WHERE note IS NOT NULL) FROM public.enrollment_order_events;

\echo '## 7 storage buckets and object counts'
SELECT b.id, b.public, count(o.id) AS objects
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
 GROUP BY b.id, b.public ORDER BY 1;

\echo '## 8 top-level prefixes in audio-responses and writing-images (first path segment shape only)'
SELECT bucket_id,
       CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$' THEN '<uuid>' ELSE split_part(name, '/', 1) END AS first_segment,
       count(*)
  FROM storage.objects WHERE bucket_id IN ('audio-responses', 'writing-images')
 GROUP BY 1, 2 ORDER BY 1, 3 DESC;

ROLLBACK;
