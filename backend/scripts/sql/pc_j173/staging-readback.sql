-- STAGING ONLY: zjphffoujxkpltixsbzj. Read-only content inventory, no learner data.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT jsonb_build_object(
    'observed_at', now(),
    'read_only', current_setting('transaction_read_only'),
    'original_paper_count', (SELECT count(*) FROM public.reading_tests WHERE test_id = 'ILR-RDG-001'),
    'papers', (
        SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'test_id', t.test_id, 'status', t.status,
            'mock_content_revision', t.mock_content_revision, 'updated_at', t.updated_at,
            'question_count', (SELECT count(*) FROM public.reading_questions q
                JOIN public.reading_passages p ON p.id = q.passage_id WHERE p.test_id = t.id),
            'questions_md5', (SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY q.id)::text)
                FROM public.reading_questions q JOIN public.reading_passages p ON p.id = q.passage_id
                WHERE p.test_id = t.id),
            'answers_md5', (SELECT md5(jsonb_agg(jsonb_build_object('id', q.id, 'answer', q.answer) ORDER BY q.id)::text)
                FROM public.reading_questions q JOIN public.reading_passages p ON p.id = q.passage_id
                WHERE p.test_id = t.id)
        ) ORDER BY t.test_id) FROM public.reading_tests t
        WHERE (t.id = '97d1ed4f-bcba-4ccf-a0ef-1c943ca6410b' AND t.test_id = 'MOCK0016-20261005-ILR001-REV01')
           OR (t.id = 'cc548c72-11c1-4798-83be-ffaa8db55423' AND t.test_id = 'MOCK0016-20261006-ILR001-REV02')
    ),
    'q19_to_q22', (
        SELECT jsonb_agg(jsonb_build_object('test_code', t.test_id, 'row', to_jsonb(q)) ORDER BY t.test_id, q.q_num)
        FROM public.reading_questions q JOIN public.reading_passages p ON p.id = q.passage_id
        JOIN public.reading_tests t ON t.id = p.test_id
        WHERE t.id IN ('97d1ed4f-bcba-4ccf-a0ef-1c943ca6410b', 'cc548c72-11c1-4798-83be-ffaa8db55423')
          AND q.q_num BETWEEN 19 AND 22
    )
) AS result;
ROLLBACK;
