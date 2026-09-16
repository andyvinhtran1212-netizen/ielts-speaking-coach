from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "267_atomic_course_assessment_bank_replace.sql").read_text(encoding="utf-8")


def test_course_assessment_replace_keeps_questions_and_metadata_in_one_transaction():
    assert "CREATE OR REPLACE FUNCTION public.quiz_replace_course_assessment_bank" in SQL
    replace_at = SQL.index("v_written := public.quiz_replace_questions")
    metadata_at = SQL.index("UPDATE public.quiz_banks", replace_at)
    assert replace_at < metadata_at
    assert "jsonb_array_length(p_rows) <> v_words_count" in SQL


def test_course_assessment_replace_is_private_and_keeps_bank_private():
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "is_published = FALSE" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
