"""Atomic row-snapshot guards for the forward-only Writing page replacement."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations" /
       "300_admin_writing_queue_page_snapshot.sql").read_text(encoding="utf-8")


def test_page_ids_rows_and_total_share_one_filtered_statement():
    assert "WITH filtered AS MATERIALIZED" in SQL
    assert "page_rows AS (" in SQL
    assert SQL.index("WITH filtered AS MATERIALIZED") < SQL.index("LIMIT v_limit OFFSET v_offset")
    assert SQL.index("LIMIT v_limit OFFSET v_offset") < SQL.index("page_rows AS (")
    assert "'essay_ids'" in SQL
    assert "'essay_rows'" in SQL
    assert "'total', (SELECT pg_catalog.count(*) FROM filtered)" in SQL
    assert "JOIN public.writing_essays AS essay ON essay.id = page.id" in SQL
    assert "JOIN public.students AS student ON student.id = essay.student_id" in SQL
    assert "pg_catalog.min(assignment.deadline)" in SQL
    assert "essay.student_id, essay.task_type, essay.status" in SQL


def test_page_snapshot_replacement_is_private_and_forward_only():
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
    assert "DROP TABLE" not in SQL and "DROP COLUMN" not in SQL
