"""Real 305 report guard plus 381 stamp/cascade on disposable local PG17.

trg_01_guard_dictation_report_policy and trg_content_namespace_stamp coexist:
report evidence stays immutable while the namespace flag can become true.
"""
from namespace_pg17 import MA, MB, bootstrap, local_pg17, migration


def test_dictation_report_seal_allows_namespace_cascade_and_fk_erasure():
    dependencies = """
ALTER TABLE public.dictation_attempts ADD COLUMN units_snapshot jsonb;
ALTER TABLE public.dictation_sessions ADD COLUMN attempt_id uuid;
CREATE TABLE public.dictation_attempt_answers(attempt_id uuid, sentence_idx integer, user_transcript text,
    diff jsonb, score numeric, correct_words integer, total_words integer);
"""
    with local_pg17("dictation-stack") as pg:
        pg.psql(bootstrap() + dependencies + migration("305_dictation_frozen_grading_policy.sql") + """
INSERT INTO public.listening_tests(id,test_id) VALUES('00000000-0000-0000-0000-000000000001','report-source');
INSERT INTO public.dictation_sessions(id,test_id,test_id_external,user_id) VALUES(
 '10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','report-source',gen_random_uuid());
CREATE TEMP TABLE report_before AS SELECT to_jsonb(s) AS report FROM public.dictation_sessions s;
""" + migration(MA) + migration(MB) + """
UPDATE public.listening_tests SET metadata='{"blackeye":{}}' WHERE test_id='report-source';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT restricted FROM public.dictation_sessions LIMIT 1), '305 permits cascade stamp');
    PERFORM pg_temp.assert_true((SELECT to_jsonb(s)-'restricted'=b.report FROM public.dictation_sessions s CROSS JOIN report_before b), '305 report fields unchanged');
    PERFORM pg_temp.expect_state('UPDATE public.dictation_sessions SET user_id=gen_random_uuid()', '55000');
END $$;
DELETE FROM public.listening_tests WHERE test_id='report-source';
DO $$ BEGIN
    PERFORM pg_temp.assert_true((SELECT restricted AND test_id IS NULL FROM public.dictation_sessions LIMIT 1), '305 canonical FK erasure retains flag');
    PERFORM pg_temp.assert_true((SELECT to_jsonb(s)-'restricted'-'test_id'=b.report-'test_id' FROM public.dictation_sessions s CROSS JOIN report_before b), '305 frozen report after erasure');
END $$;
""")
