"""Atomic content-catalog snapshot guards for the forward-only replacement."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations" /
       "301_admin_exam_content_page_snapshot.sql").read_text(encoding="utf-8")


def test_filtered_page_rows_associations_and_total_share_one_statement():
    assert "WITH source AS (" in SQL
    assert "filtered AS MATERIALIZED" in SQL
    assert "page_rows AS (" in SQL
    assert SQL.index("filtered AS MATERIALIZED") < SQL.index("LIMIT p_limit OFFSET p_offset")
    assert SQL.index("LIMIT p_limit OFFSET p_offset") < SQL.index("page_rows AS (")
    assert "'rows', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page_rows)" in SQL
    assert "'total', (SELECT pg_catalog.count(*) FROM filtered)" in SQL
    assert "FROM public.exam_content_cohorts AS link" in SQL
    assert "FROM public.mock_exams AS exam" in SQL
    for field in ("course_level", "status", "exam_only", "is_public", "publish_ready"):
        assert field in SQL


def test_snapshot_replacement_is_private_and_forward_only():
    signature = (
        "public.fn_admin_exam_content_page_ids(\n"
        "    text, text, uuid, boolean, boolean, text, text, integer, integer\n"
        ")"
    )
    assert "CREATE OR REPLACE FUNCTION public.fn_admin_exam_content_page_ids" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = pg_catalog, public" in SQL
    assert f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon, authenticated" in SQL
    assert f"GRANT EXECUTE ON FUNCTION {signature} TO service_role" in SQL
    assert "DROP TABLE" not in SQL and "DROP COLUMN" not in SQL
