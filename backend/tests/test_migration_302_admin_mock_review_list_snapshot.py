"""Atomic Mock list/Review gate guards for the forward-only replacement."""

from pathlib import Path


SQL = (Path(__file__).parents[1] / "migrations" /
       "302_admin_mock_review_list_snapshot.sql").read_text(encoding="utf-8")


def test_full_exam_rows_and_actionable_review_gate_share_one_statement():
    assert "FROM public.mock_exams AS exam" in SQL
    assert "pg_catalog.to_jsonb(exam)" in SQL
    assert "'review_eligible'" in SQL
    assert "exam.status <> 'published' OR exam.exam_mode = 'retake'" in SQL
    assert "exam.is_open IS FALSE AND exam.active_section = 'done'" in SQL
    assert "FROM public.mock_exam_sittings AS sitting" in SQL
    assert "JOIN public.mock_exam_reviews AS review" in SQL
    assert "review.status IN ('queued', 'claimed', 'edited', 'reviewed')" in SQL
    assert "ORDER BY exam.created_at DESC, exam.id DESC" in SQL
    assert "'exams', COALESCE(" in SQL


def test_snapshot_routine_is_private_and_forward_only():
    signature = "public.fn_admin_mock_exams_with_review_eligibility()"
    assert f"CREATE OR REPLACE FUNCTION {signature}" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = pg_catalog, public" in SQL
    assert f"REVOKE ALL ON FUNCTION {signature}" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert f"GRANT EXECUTE ON FUNCTION {signature}" in SQL
    assert "TO service_role" in SQL
    assert "DROP TABLE" not in SQL and "DROP COLUMN" not in SQL
