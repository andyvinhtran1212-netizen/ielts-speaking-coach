"""Static guards for migration 217's additive multi-class contract."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations" /
       "217_student_cohort_memberships.sql").read_text(encoding="utf-8")


def test_migration_is_additive_and_backfills_legacy_primary_class():
    assert "CREATE TABLE IF NOT EXISTS student_cohort_memberships" in SQL
    assert "UNIQUE (student_id, cohort_id)" in SQL
    assert "SELECT id, cohort_id, true\n  FROM students" in SQL
    assert "DROP COLUMN" not in SQL
    assert "ALTER COLUMN cohort_id" not in SQL


def test_assignment_fanout_and_backfill_read_active_membership():
    create_body = SQL[SQL.index("CREATE OR REPLACE FUNCTION fn_create_class_assignment"):]
    assert "FROM student_cohort_memberships m" in create_body
    assert "m.cohort_id = p_cohort_id AND m.is_active" in create_body
    backfill_body = SQL[SQL.index("CREATE OR REPLACE FUNCTION fn_backfill_assignment_items"):]
    assert "FROM student_cohort_memberships m" in backfill_body
    assert "m.cohort_id = v_cohort AND m.is_active" in backfill_body


def test_writing_fanout_persists_exact_origin_for_multi_class_students():
    assert "ADD COLUMN IF NOT EXISTS cohort_id uuid REFERENCES cohorts(id)" in SQL
    fn = SQL[SQL.index(
        "CREATE OR REPLACE FUNCTION public.fn_create_writing_assignments_idempotent"
    ):]
    assert "student_id, cohort_id, assignment_group_id" in fn
    assert "m.cohort_id = v_cohort_id AND m.is_active" in fn
    assert fn.index("IF NOT FOUND THEN") < fn.index("PERFORM m.id"), (
        "an idempotent replay must return its first receipt before rechecking roster"
    )


def test_membership_mutations_and_assignment_rpcs_are_backend_only():
    for function in (
        "fn_add_student_cohort_membership",
        "fn_add_students_cohort_membership",
        "fn_remove_student_cohort_membership",
        "fn_create_writing_assignments_idempotent",
        "fn_create_class_assignment",
        "fn_backfill_assignment_items",
        "fn_list_writing_regrade_requests",
    ):
        assert f"REVOKE EXECUTE ON FUNCTION {function}" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
