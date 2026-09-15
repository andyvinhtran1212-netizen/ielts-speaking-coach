from pathlib import Path


SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "270_atomic_timed_course_session_creation.sql").read_text(encoding="utf-8")


def test_every_requested_session_is_created_under_the_authorization_locks():
    lock_at = SQL.index("FOR UPDATE OF cai, ca, scm")
    access_at = SQL.index("v_status <> 'published'", lock_at)
    expiry_at = SQL.index("timed_course_assignment_expired", access_at)
    insert_at = SQL.index("IF v_session_id IS NULL AND p_create_if_missing", expiry_at)
    assert lock_at < access_at < expiry_at < insert_at
    assert "p_kind TEXT DEFAULT 'run'" in SQL
    assert "p_create_if_missing BOOLEAN DEFAULT FALSE" in SQL
    assert "p_item_id, p_kind" in SQL


def test_retake_entitlement_and_open_session_adoption_are_inside_the_rpc():
    assert "v_prior_action IS DISTINCT FROM 'retake'" in SQL
    assert "v_prior_action IN ('retake', 'passed', 'timed_out')" in SQL
    assert "COALESCE(qs.kind, 'run') = p_kind" in SQL
    assert "qs.ended_at IS NULL" in SQL
    assert "FOR UPDATE;" in SQL


def test_new_signature_replaces_the_old_overload_and_stays_backend_only():
    drop_at = SQL.index("DROP FUNCTION IF EXISTS")
    create_at = SQL.index("CREATE FUNCTION")
    assert drop_at < create_at
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path = public, pg_temp" in SQL
    assert "FROM PUBLIC, anon, authenticated" in SQL
    assert "TO service_role" in SQL
    assert "NOTIFY pgrst, 'reload schema'" in SQL
