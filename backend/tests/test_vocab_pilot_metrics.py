"""Pilot measurement and recommendation lifecycle contracts."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import vocab_pilot_metrics

AUTH = {"Authorization": "Bearer learner.jwt"}
ADMIN_AUTH = {"Authorization": "Bearer admin.jwt"}
USER_ID = "11111111-1111-4111-8111-111111111111"
ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
RECOMMENDATION_ID = "22222222-2222-4222-8222-222222222222"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _rpc_result(data):
    result = MagicMock()
    result.data = data
    call = MagicMock()
    call.execute.return_value = result
    return call


def test_open_recommendation_uses_owned_unit_bound_rpc():
    rpc = _rpc_result([{
        "recommendation_id": RECOMMENDATION_ID,
        "status": "opened",
        "opened_at": "2026-08-27T00:00:00+00:00",
        "completed_at": None,
    }])
    with patch.object(vocab_pilot_metrics, "supabase_admin") as database:
        database.rpc.return_value = rpc
        row = vocab_pilot_metrics.open_recommendation(
            user_id=USER_ID,
            recommendation_id=RECOMMENDATION_ID,
            unit_slug="prefer-x-to-y",
        )
    assert row["status"] == "opened"
    name, payload = database.rpc.call_args.args
    assert name == "fn_open_vocab_unit_recommendation"
    assert payload["p_user"] == USER_ID
    assert payload["p_recommendation"] == RECOMMENDATION_ID
    assert payload["p_unit_slug"] == "prefer-x-to-y"


def test_metrics_service_rejects_unbounded_period_before_database_call():
    with patch.object(vocab_pilot_metrics, "supabase_admin") as database:
        try:
            vocab_pilot_metrics.get_metrics(days=365)
        except vocab_pilot_metrics.VocabPilotMetricsError as exc:
            assert "30, 90 hoặc 180" in str(exc)
        else:
            raise AssertionError("expected bounded-period failure")
    database.rpc.assert_not_called()


def test_open_route_requires_all_learner_and_recommendation_gates():
    expected = {"recommendation_id": RECOMMENDATION_ID, "status": "opened"}
    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value={"id": USER_ID})), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", return_value=True), \
         patch("routers.vocab_units.vocab_pilot_metrics.open_recommendation", return_value=expected) as opened:
        response = _client().post(
            f"/api/me/vocabulary/recommendations/{RECOMMENDATION_ID}/open",
            headers=AUTH,
            json={"unit_slug": "prefer-x-to-y"},
        )
    assert response.status_code == 200
    assert response.json() == expected
    opened.assert_called_once_with(
        user_id=USER_ID,
        recommendation_id=RECOMMENDATION_ID,
        unit_slug="prefer-x-to-y",
    )


def test_open_route_fails_closed_when_recommendations_are_disabled():
    def enabled(key, default=False):
        return key == "vocab_units_read"

    with patch("routers.vocab_units.get_supabase_user", new=AsyncMock(return_value={"id": USER_ID})), \
         patch("routers.vocab_units.is_vocab_curated_enabled", return_value=True), \
         patch("routers.vocab_units.runtime_flags.is_enabled", side_effect=enabled), \
         patch("routers.vocab_units.vocab_pilot_metrics.open_recommendation") as opened:
        response = _client().post(
            f"/api/me/vocabulary/recommendations/{RECOMMENDATION_ID}/open",
            headers=AUTH,
            json={"unit_slug": "prefer-x-to-y"},
        )
    assert response.status_code == 503
    opened.assert_not_called()


def test_admin_metrics_and_cohort_routes_use_canonical_service():
    snapshot = {"period_days": 90, "computed_at": "2026-08-27T00:00:00+00:00"}
    cohort = {"user_id": USER_ID, "vocab_curated_enabled": True}
    with patch("routers.vocab_units.require_admin", new=AsyncMock(return_value={"id": ADMIN_ID})), \
         patch("routers.vocab_units.vocab_pilot_metrics.get_metrics", return_value=snapshot) as get_metrics, \
         patch("routers.vocab_units.vocab_pilot_metrics.set_cohort_flag", return_value=cohort) as set_flag:
        metrics_response = _client().get(
            "/admin/vocabulary/pilot-metrics?days=90", headers=ADMIN_AUTH,
        )
        cohort_response = _client().post(
            f"/admin/vocabulary/pilot-cohort/{USER_ID}",
            headers=ADMIN_AUTH,
            json={"enabled": True},
        )
    assert metrics_response.status_code == 200, metrics_response.json()
    assert metrics_response.json() == snapshot
    get_metrics.assert_called_once_with(days=90)
    assert cohort_response.status_code == 200
    assert cohort_response.json() == cohort
    set_flag.assert_called_once_with(
        user_id=USER_ID, enabled=True, changed_by=ADMIN_ID,
    )


def test_migration_keeps_lifecycle_private_transactional_and_time_bounded():
    sql = (
        Path(__file__).parent.parent
        / "migrations"
        / "238_vocab_curated_pilot_metrics.sql"
    ).read_text("utf-8")
    assert "ALTER TABLE vocab_curated_cohort_events ENABLE ROW LEVEL SECURITY" in sql
    assert "AFTER INSERT ON vocab_unit_attempts" in sql
    assert "AFTER INSERT ON vocab_unit_recommendations" in sql
    assert "status IN ('pending', 'opened')" in sql
    assert "FOR UPDATE OF recommendation" in sql
    assert sql.count("'vocab-recommendation:'") == 2
    assert sql.count("pg_advisory_xact_lock") >= 2
    assert "INTERVAL '6 days'" in sql and "INTERVAL '10 days'" in sql
    assert "INTERVAL '25 days'" in sql and "INTERVAL '35 days'" in sql
    assert "GRANT EXECUTE ON FUNCTION fn_vocab_curated_pilot_metrics" in sql
    assert "TO service_role" in sql
