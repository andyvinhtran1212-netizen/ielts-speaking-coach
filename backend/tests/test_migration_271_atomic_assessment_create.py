from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "271_atomic_course_assessment_bank_create.sql").read_text(encoding="utf-8")


def test_bank_insert_and_question_replacement_share_one_rpc_transaction():
    insert_at = SQL.index("INSERT INTO public.quiz_banks")
    replace_at = SQL.index("public.quiz_replace_course_assessment_bank", insert_at)
    return_at = SQL.index("RETURN QUERY", replace_at)
    assert insert_at < replace_at < return_at
    assert "RETURNS TABLE(bank_id UUID, written INTEGER)" in SQL


def test_atomic_create_is_private_and_service_role_only():
    assert "'course'" in SQL
    assert "FALSE" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
    assert "NOTIFY pgrst, 'reload schema'" in SQL
