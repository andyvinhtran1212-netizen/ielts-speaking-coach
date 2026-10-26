-- A-06: READ-ONLY inventory: plain SELECTs, no temp tables or side effects.
-- Data is NOT changed by this PR. Staging --apply needs lead approval;
-- production correction needs Vinh's approval. This task runs nothing on prod.
--
-- Heuristic, NOT proof: UTC hour 08/09 or 18..23, minute 00/30, second 00
-- resembles VN wall time stored without offset (reported 23:00Z / 08:30Z).
-- FALSE POSITIVES: genuine UTC input, browser-converted admin input, legitimate
-- early-morning VN deadlines. FALSE NEGATIVES: other hours/minutes. Confirm
-- intended times with teacher/QA before selecting ANY repair. Never mass-shift.
--
-- Replace affected_before with the actual first fixed deployment instant before
-- operational use. Default is a bounded 2026-10-26 VN snapshot, NOT a deployment
-- claim. created_at cannot identify later edits: pre-cutoff rows edited after
-- deployment also need manual review. Current users.role only INFERs source:
-- historical role changes/admin impersonation cannot be distinguished.
-- writing_assignments.due_at (mig 106) has no current application writer found:
-- legacy/manual review only. ALL class_assignments.due_at are EXCLUDED from
-- candidates: create/edit use compose_due_at, already correct. Summary counts
-- include those exclusions. There is no persisted request-path/TZ provenance.
--
-- Late-joiner writing copies inherit template deadlines: review the WHOLE
-- assignment_group_id + prompt_id, including copies created after cutoff.
-- Legacy NULL groups are grouped by prompt only: verify cohort/IDs manually.
-- Mock availability windows are FOLLOW-UP ONLY, not repaired by this tool/PR:
-- mock_exams.open_from/open_until, mock_exam_assignments.open_from/open_until,
-- and inherited mock_exam_sittings.retake_open_from/retake_open_until.
WITH params AS (
    SELECT TIMESTAMPTZ '2026-10-27 00:00:00+07:00' AS affected_before
), deadlines AS (
    SELECT 'writing_assignments'::text AS table_name, w.id,
           v.column_name, v.deadline_at, w.assignment_group_id,
           w.prompt_id, w.created_at,
           CASE WHEN v.column_name = 'due_at' THEN 'legacy_due_at_untraced'
                WHEN u.role = 'instructor' THEN 'instructor_inferred'
                WHEN u.role = 'admin' THEN 'admin_or_impersonation_inferred'
                ELSE 'unknown_assigner' END AS source_path
    FROM public.writing_assignments w
    LEFT JOIN public.users u ON u.id = w.assigned_by
    CROSS JOIN LATERAL (VALUES ('deadline', w.deadline), ('due_at', w.due_at))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
    UNION ALL
    SELECT 'class_assignments', c.id, 'due_at', c.due_at, NULL::uuid,
           c.content_id, c.created_at, 'class_ledger_compose_due_at_EXCLUDED'
    FROM public.class_assignments c WHERE c.due_at IS NOT NULL
    UNION ALL
    SELECT 'mock_exam_assignments', m.id, v.column_name, v.deadline_at,
           m.assignment_group_id, m.exam_id, m.created_at, 'mock_retake_FOLLOW_UP'
    FROM public.mock_exam_assignments m
    CROSS JOIN LATERAL (VALUES ('open_from', m.open_from), ('open_until', m.open_until))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
    UNION ALL
    SELECT 'mock_exams', e.id, v.column_name, v.deadline_at, NULL::uuid,
           e.id, e.created_at, 'mock_exam_window_FOLLOW_UP'
    FROM public.mock_exams e
    CROSS JOIN LATERAL (VALUES ('open_from', e.open_from), ('open_until', e.open_until))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
), classified AS (
    SELECT d.*, d.created_at < p.affected_before AS is_before_cutoff,
           CASE WHEN d.table_name = 'class_assignments' THEN 'excluded_correct_class_ledger'
                WHEN d.created_at >= p.affected_before THEN 'after_inventory_cutoff'
                WHEN EXTRACT(HOUR FROM d.deadline_at AT TIME ZONE 'UTC') IN (8,9,18,19,20,21,22,23)
                 AND EXTRACT(MINUTE FROM d.deadline_at AT TIME ZONE 'UTC') IN (0,30)
                 AND EXTRACT(SECOND FROM d.deadline_at AT TIME ZONE 'UTC') = 0
                THEN CASE WHEN d.table_name LIKE 'mock_%' THEN 'follow_up_clock_pattern'
                          ELSE 'suspected_naive_vn_REQUIRES_QA' END
                ELSE 'other_clock_pattern' END AS category
    FROM deadlines d CROSS JOIN params p
)
-- Summary counts deadline VALUES; a row may have multiple deadline columns.
SELECT table_name, column_name, source_path, category,
       COUNT(*) AS deadline_values, COUNT(DISTINCT id) AS rows,
       COUNT(DISTINCT assignment_group_id) AS assignment_groups
FROM classified
GROUP BY table_name, column_name, source_path, category
ORDER BY table_name, column_name, source_path, category;

WITH params AS (
    SELECT TIMESTAMPTZ '2026-10-27 00:00:00+07:00' AS affected_before
), deadlines AS (
    SELECT 'writing_assignments'::text AS table_name, w.id,
           v.column_name, v.deadline_at, w.assignment_group_id,
           w.prompt_id, w.created_at,
           CASE WHEN v.column_name = 'due_at' THEN 'legacy_due_at_untraced'
                WHEN u.role = 'instructor' THEN 'instructor_inferred'
                WHEN u.role = 'admin' THEN 'admin_or_impersonation_inferred'
                ELSE 'unknown_assigner' END AS source_path
    FROM public.writing_assignments w
    LEFT JOIN public.users u ON u.id = w.assigned_by
    CROSS JOIN LATERAL (VALUES ('deadline', w.deadline), ('due_at', w.due_at))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
    UNION ALL
    SELECT 'class_assignments', c.id, 'due_at', c.due_at, NULL::uuid,
           c.content_id, c.created_at, 'class_ledger_compose_due_at_EXCLUDED'
    FROM public.class_assignments c WHERE c.due_at IS NOT NULL
    UNION ALL
    SELECT 'mock_exam_assignments', m.id, v.column_name, v.deadline_at,
           m.assignment_group_id, m.exam_id, m.created_at, 'mock_retake_FOLLOW_UP'
    FROM public.mock_exam_assignments m
    CROSS JOIN LATERAL (VALUES ('open_from', m.open_from), ('open_until', m.open_until))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
    UNION ALL
    SELECT 'mock_exams', e.id, v.column_name, v.deadline_at, NULL::uuid,
           e.id, e.created_at, 'mock_exam_window_FOLLOW_UP'
    FROM public.mock_exams e
    CROSS JOIN LATERAL (VALUES ('open_from', e.open_from), ('open_until', e.open_until))
        AS v(column_name, deadline_at)
    WHERE v.deadline_at IS NOT NULL
), classified AS (
    SELECT d.*, d.created_at < p.affected_before AS is_before_cutoff,
           CASE WHEN d.table_name = 'class_assignments' THEN 'excluded_correct_class_ledger'
                WHEN d.created_at >= p.affected_before THEN 'after_inventory_cutoff'
                WHEN EXTRACT(HOUR FROM d.deadline_at AT TIME ZONE 'UTC') IN (8,9,18,19,20,21,22,23)
                 AND EXTRACT(MINUTE FROM d.deadline_at AT TIME ZONE 'UTC') IN (0,30)
                 AND EXTRACT(SECOND FROM d.deadline_at AT TIME ZONE 'UTC') = 0
                THEN CASE WHEN d.table_name LIKE 'mock_%' THEN 'follow_up_clock_pattern'
                          ELSE 'suspected_naive_vn_REQUIRES_QA' END
                ELSE 'other_clock_pattern' END AS category
    FROM deadlines d CROSS JOIN params p
)
-- Review groups and every original/copy before choosing explicit selectors.
SELECT d.table_name, d.column_name, d.source_path, d.category,
       d.assignment_group_id, d.prompt_id AS prompt_or_exam_or_content_id,
       (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS created_vn_date,
       COUNT(*) AS rows,
       jsonb_agg(jsonb_build_object(
           'id', d.id, 'old', d.deadline_at, 'proposed_minus_7h', d.deadline_at - INTERVAL '7 hours',
           'created_at', d.created_at, 'is_before_cutoff', d.is_before_cutoff
       ) ORDER BY d.created_at, d.id) AS review_only
FROM classified d
WHERE d.category IN ('suspected_naive_vn_REQUIRES_QA', 'follow_up_clock_pattern')
   OR (d.table_name = 'writing_assignments'
       AND EXISTS (
           SELECT 1 FROM classified candidate
           WHERE candidate.table_name = d.table_name
             AND candidate.column_name = d.column_name
             AND candidate.assignment_group_id IS NOT DISTINCT FROM d.assignment_group_id
             AND candidate.prompt_id = d.prompt_id
             AND candidate.category = 'suspected_naive_vn_REQUIRES_QA'
       ))
GROUP BY d.table_name, d.column_name, d.source_path, d.category,
         d.assignment_group_id, d.prompt_id,
         (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
ORDER BY d.table_name, d.source_path, d.assignment_group_id, d.prompt_id, created_vn_date;
