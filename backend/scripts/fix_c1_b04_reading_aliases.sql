\set ON_ERROR_STOP on

-- One-off, idempotent production repair for C1-B04 short Reading.
--
-- Root cause: three semantically correct answers were stored as one display
-- string each, while the canonical course grader only accepts variants listed
-- in answer.accepted.  The repair updates the live answer key, the three
-- immutable submission snapshots already affected, and their aggregate class
-- item scores.  No attempt answers, timestamps, pass events, or other banks are
-- changed.
--
-- Dry-run (default):
--   psql "$DATABASE_URL" -v commit=false -f backend/scripts/fix_c1_b04_reading_aliases.sql
-- Commit:
--   psql "$DATABASE_URL" -v commit=true  -f backend/scripts/fix_c1_b04_reading_aliases.sql

BEGIN;

DO $$
DECLARE
    bank_count INT;
    submission_count INT;
    unexpected_attempts INT;
BEGIN
    SELECT count(*) INTO bank_count
      FROM quiz_banks
     WHERE id = 'e0689cdc-949a-41b0-a04f-bf676be9018d'
       AND code = 'C1-B04';
    IF bank_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one C1-B04 bank, found %', bank_count;
    END IF;

    SELECT count(*) INTO submission_count
      FROM course_section_submissions
     WHERE id IN (
        '6e747368-14f0-434d-90fd-010aa44786a9',
        '8ec1b8ea-d12b-4df0-afa1-15d3d08a7322',
        'e3a43ed3-cb3a-4842-b46a-216b3883195a'
     )
       AND bank_id = 'e0689cdc-949a-41b0-a04f-bf676be9018d'
       AND section = 'reading';
    IF submission_count <> 3 THEN
        RAISE EXCEPTION 'Expected three affected Reading submissions, found %', submission_count;
    END IF;

    SELECT count(*) INTO unexpected_attempts
      FROM class_assignment_items
     WHERE id IN (
        '5f29cc36-f944-4655-8dbc-502a7f88d73b',
        '46709bfb-f08c-4565-99d3-9d3dc0896439',
        '71a6b9f8-15ca-48e1-9967-a8096c0d3692'
     )
       AND jsonb_array_length(COALESCE(mastery -> 'attempts', '[]'::jsonb)) <> 1;
    IF unexpected_attempts <> 0 THEN
        RAISE EXCEPTION 'Refusing repair: an affected class item no longer has exactly one attempt';
    END IF;
END $$;

-- Live bank: future submissions are graded flexibly, and the two concept-label
-- questions explicitly request an English answer instead of Vietnamese typing.
WITH patched_answers AS (
    SELECT jsonb_agg(
        CASE answer ->> 'id'
            WHEN 'TM20-B04-DOC-06' THEN answer || jsonb_build_object(
                'answer', 'adverb',
                'accepted', jsonb_build_array('adverb', 'trạng từ', 'trạng từ (adverb)'))
            WHEN 'TM20-B04-DOC-07' THEN answer || jsonb_build_object(
                'answer', 'tall / wide',
                'accepted', jsonb_build_array('tall', 'wide'))
            WHEN 'TM20-B04-DOC-09' THEN answer || jsonb_build_object(
                'answer', 'before',
                'accepted', jsonb_build_array(
                    'before', 'before the main verb', 'trước', 'đứng trước',
                    'trước động từ chính'))
            ELSE answer
        END
        ORDER BY ord
    ) AS value
    FROM quiz_banks bank
    CROSS JOIN LATERAL jsonb_array_elements(bank.meta #> '{short_reading,answers}')
        WITH ORDINALITY AS rows(answer, ord)
    WHERE bank.id = 'e0689cdc-949a-41b0-a04f-bf676be9018d'
), patched_groups AS (
    SELECT jsonb_agg(
        CASE WHEN grp ->> 'id' = 'structure' THEN
            jsonb_set(grp, '{questions}', (
                SELECT jsonb_agg(
                    CASE question ->> 'id'
                        WHEN 'TM20-B04-DOC-06' THEN question || jsonb_build_object(
                            'prompt', 'Trong câu **"Cars move quickly"**, từ **quickly** thuộc từ loại nào? Trả lời bằng tiếng Anh: **adjective** hay **adverb**?')
                        WHEN 'TM20-B04-DOC-09' THEN question || jsonb_build_object(
                            'prompt', 'Trạng từ **often** đứng ở vị trí nào so với động từ chính trong **"People ___ meet friends"**? Trả lời bằng tiếng Anh: **before** hay **after**?')
                        ELSE question
                    END
                    ORDER BY question_ord
                )
                FROM jsonb_array_elements(grp -> 'questions')
                    WITH ORDINALITY AS questions(question, question_ord)
            ))
        ELSE grp END
        ORDER BY group_ord
    ) AS value
    FROM quiz_banks bank
    CROSS JOIN LATERAL jsonb_array_elements(bank.meta #> '{short_reading,question_groups}')
        WITH ORDINALITY AS groups(grp, group_ord)
    WHERE bank.id = 'e0689cdc-949a-41b0-a04f-bf676be9018d'
)
UPDATE quiz_banks
   SET meta = jsonb_set(
                  jsonb_set(meta, '{short_reading,answers}', patched_answers.value),
                  '{short_reading,question_groups}', patched_groups.value),
       updated_at = now()
  FROM patched_answers, patched_groups
 WHERE quiz_banks.id = 'e0689cdc-949a-41b0-a04f-bf676be9018d';

-- Historical rows: preserve the learner's original answers while correcting
-- the frozen answer key that produced the false negatives.
WITH patched AS (
    SELECT submission.id,
           jsonb_agg(
               CASE answer ->> 'id'
                   WHEN 'TM20-B04-DOC-06' THEN answer || jsonb_build_object(
                       'answer', 'adverb',
                       'accepted', jsonb_build_array('adverb', 'trạng từ', 'trạng từ (adverb)'))
                   WHEN 'TM20-B04-DOC-07' THEN answer || jsonb_build_object(
                       'answer', 'tall / wide',
                       'accepted', jsonb_build_array('tall', 'wide'))
                   WHEN 'TM20-B04-DOC-09' THEN answer || jsonb_build_object(
                       'answer', 'before',
                       'accepted', jsonb_build_array(
                           'before', 'before the main verb', 'trước', 'đứng trước',
                           'trước động từ chính'))
                   ELSE answer
               END
               ORDER BY ord
           ) AS answer_key
      FROM course_section_submissions submission
      CROSS JOIN LATERAL jsonb_array_elements(submission.answer_key)
          WITH ORDINALITY AS rows(answer, ord)
     WHERE submission.id IN (
        '6e747368-14f0-434d-90fd-010aa44786a9',
        '8ec1b8ea-d12b-4df0-afa1-15d3d08a7322',
        'e3a43ed3-cb3a-4842-b46a-216b3883195a'
     )
     GROUP BY submission.id
), snapshot_answers AS (
    SELECT submission.id,
           jsonb_agg(
               CASE answer ->> 'id'
                   WHEN 'TM20-B04-DOC-06' THEN answer || jsonb_build_object(
                       'answer', 'adverb',
                       'accepted', jsonb_build_array('adverb', 'trạng từ', 'trạng từ (adverb)'))
                   WHEN 'TM20-B04-DOC-07' THEN answer || jsonb_build_object(
                       'answer', 'tall / wide',
                       'accepted', jsonb_build_array('tall', 'wide'))
                   WHEN 'TM20-B04-DOC-09' THEN answer || jsonb_build_object(
                       'answer', 'before',
                       'accepted', jsonb_build_array(
                           'before', 'before the main verb', 'trước', 'đứng trước',
                           'trước động từ chính'))
                   ELSE answer
               END
               ORDER BY ord
           ) AS answers
      FROM course_section_submissions submission
      CROSS JOIN LATERAL jsonb_array_elements(submission.content_snapshot -> 'answers')
          WITH ORDINALITY AS rows(answer, ord)
     WHERE submission.id IN (
        '6e747368-14f0-434d-90fd-010aa44786a9',
        '8ec1b8ea-d12b-4df0-afa1-15d3d08a7322',
        'e3a43ed3-cb3a-4842-b46a-216b3883195a'
     )
     GROUP BY submission.id
)
UPDATE course_section_submissions submission
   SET answer_key = patched.answer_key,
       content_snapshot = jsonb_set(
           submission.content_snapshot, '{answers}', snapshot_answers.answers),
       correct = CASE submission.id
           WHEN 'e3a43ed3-cb3a-4842-b46a-216b3883195a' THEN 9
           ELSE 10
       END,
       score = CASE submission.id
           WHEN 'e3a43ed3-cb3a-4842-b46a-216b3883195a' THEN 90.00
           ELSE 100.00
       END
  FROM patched, snapshot_answers
 WHERE submission.id = patched.id
   AND submission.id = snapshot_answers.id;

-- Aggregate class truth. Each affected item has exactly one attempt (guarded
-- above), so path attempts[0] is canonical for this repair.
UPDATE class_assignment_items
   SET score = CASE id
           WHEN '5f29cc36-f944-4655-8dbc-502a7f88d73b' THEN 88.9
           WHEN '46709bfb-f08c-4565-99d3-9d3dc0896439' THEN 92.6
           WHEN '71a6b9f8-15ca-48e1-9967-a8096c0d3692' THEN 86.5
       END,
       mastery = jsonb_set(
           jsonb_set(
               jsonb_set(
                   mastery,
                   '{attempts,0,sections,reading,correct}',
                   to_jsonb(CASE id
                       WHEN '71a6b9f8-15ca-48e1-9967-a8096c0d3692' THEN 9
                       ELSE 10
                   END)),
               '{attempts,0,sections,reading,pct}',
               to_jsonb(CASE id
                   WHEN '71a6b9f8-15ca-48e1-9967-a8096c0d3692' THEN 90.0
                   ELSE 100.0
               END)),
           '{attempts,0,pct}',
           to_jsonb(CASE id
               WHEN '5f29cc36-f944-4655-8dbc-502a7f88d73b' THEN 88.9
               WHEN '46709bfb-f08c-4565-99d3-9d3dc0896439' THEN 92.6
               WHEN '71a6b9f8-15ca-48e1-9967-a8096c0d3692' THEN 86.5
           END)),
       updated_at = now()
 WHERE id IN (
    '5f29cc36-f944-4655-8dbc-502a7f88d73b',
    '46709bfb-f08c-4565-99d3-9d3dc0896439',
    '71a6b9f8-15ca-48e1-9967-a8096c0d3692'
 );

SELECT id, correct, score,
       answer_key #> '{5,accepted}' AS q6_accepted,
       answer_key #> '{6,accepted}' AS q7_accepted,
       answer_key #> '{8,accepted}' AS q9_accepted
  FROM course_section_submissions
 WHERE id IN (
    '6e747368-14f0-434d-90fd-010aa44786a9',
    '8ec1b8ea-d12b-4df0-afa1-15d3d08a7322',
    'e3a43ed3-cb3a-4842-b46a-216b3883195a'
 )
 ORDER BY id;

SELECT id, score,
       mastery #>> '{attempts,0,sections,reading,correct}' AS reading_correct,
       mastery #>> '{attempts,0,sections,reading,pct}' AS reading_pct,
       mastery #>> '{attempts,0,pct}' AS total_pct
  FROM class_assignment_items
 WHERE id IN (
    '5f29cc36-f944-4655-8dbc-502a7f88d73b',
    '46709bfb-f08c-4565-99d3-9d3dc0896439',
    '71a6b9f8-15ca-48e1-9967-a8096c0d3692'
 )
 ORDER BY id;

\if :commit
COMMIT;
\echo 'COMMIT applied.'
\else
ROLLBACK;
\echo 'DRY-RUN only; transaction rolled back.'
\endif
