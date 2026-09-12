from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "259_atomic_exam_scope_assignment.sql").read_text(encoding="utf-8")


def test_scope_and_assignment_share_one_database_transaction():
    body = SQL[SQL.index("CREATE OR REPLACE FUNCTION"):]
    assert "INSERT INTO public.exam_content_cohorts" in body
    assert "public.fn_create_class_assignment" in body
    assert body.index("INSERT INTO public.exam_content_cohorts") < body.index(
        "public.fn_create_class_assignment", body.index("RETURN QUERY"))
    assert "ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING" in body


def test_rpc_rejects_cross_skill_or_unpublished_content():
    assert "p_skill IS DISTINCT FROM p_scope_kind" in SQL
    assert "p_scope_kind NOT IN ('reading', 'listening')" in SQL
    assert "status = 'published'" in SQL
    assert "exam_content_not_published" in SQL


def test_rpc_is_service_role_only():
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
