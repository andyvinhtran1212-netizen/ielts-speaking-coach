from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "269_serialize_course_assignment_bank_revision.sql").read_text(encoding="utf-8")


def test_course_assignment_locks_and_revalidates_bank_before_insert():
    function_at = SQL.index("CREATE OR REPLACE FUNCTION public.fn_create_class_assignment")
    body = SQL[function_at:]
    lock_at = body.index("FOR UPDATE")
    revision_at = body.index("quiz_course_bank_assignment_revision", lock_at)
    mismatch_at = body.index("course_bank_revision_mismatch", revision_at)
    insert_at = body.index("INSERT INTO public.class_assignments", mismatch_at)
    assert lock_at < revision_at < mismatch_at < insert_at
    assert "p_content_config ->> 'bank_revision'" in body


def test_revision_covers_questions_and_active_pronunciation_shape():
    revision_body = SQL[:SQL.index(
        "CREATE OR REPLACE FUNCTION public.fn_create_class_assignment"
    )]
    assert "to_jsonb(qb)" in revision_body
    assert "to_jsonb(qq)" in revision_body
    assert 'ORDER BY qq."order" NULLS LAST, qq.id' in revision_body
    assert "to_jsonb(cps)" in revision_body
    assert "cps.is_active" in revision_body


def test_revision_and_creation_rpcs_remain_service_role_only():
    assert SQL.count("FROM PUBLIC, anon, authenticated") == 2
    assert SQL.count("TO service_role") == 2
    assert SQL.count("SECURITY DEFINER") == 2
    assert SQL.count("SET search_path = public, pg_temp") == 2
