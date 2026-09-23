"""Static guards for migration 297's bounded admin queue contract."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations" /
       "297_admin_writing_queue_page.sql").read_text(encoding="utf-8")


def test_queue_rpc_composes_every_filter_before_pagination():
    function = SQL[SQL.index("CREATE OR REPLACE FUNCTION"):]
    assert "JOIN public.students AS student" in function
    assert "FROM public.student_cohort_memberships AS membership" in function
    assert "membership.is_active" in function
    assert "FROM public.writing_assignments AS assignment" in function
    assert "assignment.deadline < pg_catalog.now()" in function
    assert "essay.status <> 'delivered'" in function
    assert "essay.sitting_id IS NOT NULL" in function
    assert "pg_catalog.strpos" in function
    assert function.index("WITH filtered AS MATERIALIZED") < function.index("LIMIT v_limit OFFSET v_offset")


def test_queue_rpc_returns_only_a_bounded_id_page_and_exact_total():
    assert "LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)" in SQL
    assert "'essay_ids'" in SQL
    assert "'total', (SELECT pg_catalog.count(*) FROM filtered)" in SQL
    assert "uuid[]" not in SQL
    assert "idx_writing_assignments_essay_deadline" in SQL


def test_queue_rpc_is_backend_only_and_idempotent():
    signature = (
        "public.fn_admin_writing_queue_page(\n"
        "    text, uuid, boolean, text, boolean, integer, integer\n"
        ")"
    )
    assert "CREATE OR REPLACE FUNCTION public.fn_admin_writing_queue_page" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = pg_catalog, public" in SQL
    assert f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated" in SQL
    assert f"GRANT EXECUTE ON FUNCTION {signature} TO service_role" in SQL
    assert "DROP TABLE" not in SQL
    assert "DROP COLUMN" not in SQL
