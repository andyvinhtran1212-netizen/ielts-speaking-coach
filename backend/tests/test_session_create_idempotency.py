"""Contract pins for migration 201 + POST /sessions idempotency."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "migrations" / "201_session_create_idempotency.sql").read_text()
ROUTER = (ROOT / "routers" / "sessions.py").read_text()


def test_v2_rpc_exists_without_replacing_legacy_rpc():
    assert "CREATE OR REPLACE FUNCTION fn_create_session_daily_capped_v2(" in SQL
    assert "DROP FUNCTION" not in SQL.upper()
    assert (ROOT / "migrations" / "126_create_session_daily_capped_rpc.sql").exists()


def test_replay_lookup_precedes_daily_quota_and_checks_payload_identity():
    lookup = SQL.index("SELECT * INTO v_existing")
    quota = SQL.index("SELECT count(*) INTO v_count")
    insert = SQL.index("INSERT INTO sessions")
    assert lookup < quota < insert
    for field in ("user_id", "mode", "part", "topic"):
        assert f"v_existing.{field} IS DISTINCT FROM p_{field}" in SQL
    assert "RAISE EXCEPTION 'session_id_conflict'" in SQL


def test_client_uuid_is_the_inserted_primary_key_and_retry_return_value():
    assert "RETURN NEXT v_existing" in SQL
    assert "INSERT INTO sessions (id, user_id, mode, part, topic, status)" in SQL
    assert "VALUES (p_session_id, p_user_id, p_mode, p_part, p_topic, 'in_progress')" in SQL


def test_router_selects_v2_only_when_client_session_id_is_present():
    assert 'client_session_id: UUID | None = None' in ROUTER
    assert '"fn_create_session_daily_capped_v2"' in ROUTER
    assert 'rpc_params["p_session_id"] = str(body.client_session_id)' in ROUTER
    assert 'if "session_id_conflict" in str(e):' in ROUTER


def test_full_test_part_replay_is_resolved_before_quota_and_after_unique_race():
    initial_lookup = ROUTER.index(
        "replay_session = _find_replayable_full_test_part(user_id, full_test_attempt_id, body)"
    )
    quota_lookup = ROUTER.index("quota = get_user_session_quota(user_id)")
    conflict_reconcile = ROUTER.index(
        "replay_session = _find_replayable_full_test_part(\n                        user_id, full_test_attempt_id, body,"
    )
    assert initial_lookup < quota_lookup < conflict_reconcile
