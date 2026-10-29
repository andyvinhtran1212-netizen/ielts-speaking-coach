"""AIOPS-0024 FR-001/002/004/008 — admin AI dashboard endpoints, no network."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app
from routers import admin as admin_router
from routers import admin_ai
from services import admin_ai_dashboard as dashboard
from services import ai_model_overrides as overrides

ADMIN = {"id": "00000000-0000-0000-0000-00000000a001", "email": "owner@example.com"}
ENDPOINTS = [
    ("get", "/admin/ai/models", None),
    ("patch", "/admin/ai/models/writing_grading", {"preferred_provider": "gemini"}),
    ("get", "/admin/ai/usage?window=7d", None),
    ("get", "/admin/ai/failures?window=30d", None),
]


# ── Fake async Supabase client ─────────────────────────────────────────────


class _Query:
    def __init__(self, client, name, params=None):
        self.client, self.name, self.params, self.calls = client, name, params, []

    def __getattr__(self, method):
        def _chain(*args, **kwargs):
            self.calls.append((method, args, kwargs))
            return self
        return _chain

    def execute(self):
        self.client.executed.append((self.name, self.params, self.calls))
        error = self.client.errors.get(self.name)
        if error is not None:
            raise error
        data = self.client.data.get(self.name, [])
        for method, args, _ in self.calls:
            if method == "range":
                data = data[args[0]:args[1] + 1]
        return SimpleNamespace(data=data)


class FakeClient:
    def __init__(self):
        self.data: dict = {}
        self.errors: dict = {}
        self.executed: list = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Query(self, name, params)

    def writes(self):
        return [(name, calls) for name, _, calls in self.executed
                if any(m in ("upsert", "insert", "update", "delete") for m, _, _ in calls)]


class _Missing(Exception):
    code = "PGRST202"


@pytest.fixture
def db(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(admin_ai, "_client", lambda: client)
    monkeypatch.setattr(overrides, "_client", lambda: client)
    overrides.reset()
    yield client
    overrides.reset()


@pytest.fixture
def as_admin():
    with patch.object(admin_ai, "require_admin", new=AsyncMock(return_value=ADMIN)):
        yield


# ── Permission (FR-004/FR-009) ─────────────────────────────────────────────


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_non_admin_is_refused_by_the_real_admin_check(db, method, path, body):
    users = SimpleNamespace(data=[{"role": "student"}])
    table = SimpleNamespace(select=lambda *_a, **_k: table, eq=lambda *_a, **_k: table,
                            limit=lambda *_a, **_k: table, execute=lambda: users)
    with patch.object(admin_router, "get_supabase_user", new=AsyncMock(return_value={"id": "u-1"})), \
         patch.object(admin_router, "supabase_admin", SimpleNamespace(table=lambda _name: table)):
        response = TestClient(app).request(method.upper(), path, json=body,
                                           headers={"Authorization": "Bearer t"})
    assert response.status_code == 403
    assert db.executed == []


@pytest.mark.parametrize("method, path, body", ENDPOINTS)
def test_missing_token_is_refused(db, method, path, body):
    async def _deny(_authorization):
        raise HTTPException(401, "missing token")

    with patch.object(admin_router, "get_supabase_user", new=_deny):
        response = TestClient(app).request(method.upper(), path, json=body)
    assert response.status_code == 401
    assert db.executed == []


# ── Models in use (FR-001) ─────────────────────────────────────────────────


def test_models_endpoint_reports_chain_models_and_sources(db, as_admin, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "g")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_SPEAKING_GRADING", "gemini")
    overrides._set_for_tests({"course_writing": overrides.Override(
        feature="course_writing", preferred_provider="gemini", updated_by=ADMIN["id"])})
    db.data["users"] = [{"id": ADMIN["id"], "email": ADMIN["email"]}]

    body = TestClient(app).get("/admin/ai/models").json()
    features = {f["feature"]: f for f in body["features"]}
    assert list(features) == list(overrides.EXISTING_PROVIDERS)

    writing = features["writing_grading"]
    assert [(s["provider"], s["model"]) for s in writing["effective_order"]][0] == (
        "anthropic", "claude-sonnet-5-5")
    assert writing["effective_order"][1]["provider"] == "gemini"
    assert writing["preferred_provider"]["value"] == "anthropic"

    course = features["course_writing"]
    assert [s["provider"] for s in course["effective_order"]] == ["gemini", "anthropic"]
    assert course["preferred_provider"] == {"value": "gemini", "source": "db_override"}
    assert course["override"]["updated_by_email"] == ADMIN["email"]

    speaking = features["speaking_grading"]
    assert [s["slot"] for s in speaking["effective_order"]] == [
        "grading_primary", "claude_haiku", "claude_sonnet"]
    assert speaking["effective_order"][0]["model"] == settings.SPEAKING_GRADING_MODEL
    assert speaking["allowed_providers"] == ["anthropic", "gemini"]

    assert body["anthropic_models"] == list(overrides.ANTHROPIC_MODEL_ALLOWLIST)
    assert body["anthropic_key_configured"] is True
    assert body["store"]["status"] == "ok"


def test_listening_audit_on_a_claude_model_is_reported_as_direct_and_not_controllable(db, as_admin, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "LISTENING_AUDIT_MODEL", "claude-sonnet-5")
    body = TestClient(app).get("/admin/ai/models").json()
    listening = next(f for f in body["features"] if f["feature"] == "listening_audit")
    assert listening["allowed_providers"] == []
    assert "LISTENING_AUDIT_MODEL=claude-sonnet-5" in listening["routing_note"]
    assert [(s["provider"], s["slot"], s["model"]) for s in listening["effective_order"]] == [
        ("anthropic", "direct", "claude-sonnet-5")]

    response = TestClient(app).patch("/admin/ai/models/listening_audit",
                                     json={"preferred_provider": "gemini", "anthropic_model": "claude-haiku-5-5"})
    assert response.status_code == 422 and response.json()["detail"]["field"] == "feature"
    assert db.writes() == []
    # Clearing a stale row is still allowed.
    assert TestClient(app).patch("/admin/ai/models/listening_audit", json={}).status_code == 200
    assert [table for table, _ in db.writes()] == ["ai_model_overrides"]


def test_models_endpoint_without_the_migration_still_answers(db, as_admin):
    db.errors["ai_model_override_audit"] = _Missing("Could not find the table")
    body = TestClient(app).get("/admin/ai/models").json()
    assert body["recent_changes"] == [] and body["recent_changes_error"] == "not_migrated"
    assert body["store"]["status"] == "not_loaded"
    assert len(body["features"]) == 6


def _env_settings(monkeypatch, **env):
    """A Settings built from the process environment the way production builds
    it, so ``model_fields_set`` (the ``env`` vs ``code_default`` label) is real.
    Routing variables not named in ``env`` are cleared first."""
    import os

    from config import Settings

    for name in list(os.environ):
        if name.startswith(("AI_PROVIDER_ORDER", "ANTHROPIC_MODEL_")) or name in (
                "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "SPEAKING_GRADING_MODEL"):
            monkeypatch.delenv(name)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    s = Settings(_env_file=None)
    monkeypatch.setattr(admin_ai, "settings", s)
    return s


@pytest.mark.parametrize("order, source", [("gemini,anthropic", "env"), (None, "code_default")])
def test_models_endpoint_labels_the_global_env_order(db, as_admin, monkeypatch, order, source):
    env = {"ANTHROPIC_API_KEY": "k", "GEMINI_API_KEY": "g"}
    if order:
        env["AI_PROVIDER_ORDER"] = order
    _env_settings(monkeypatch, **env)

    body = TestClient(app).get("/admin/ai/models").json()
    features = {f["feature"]: f for f in body["features"]}
    first = "gemini" if order else "anthropic"
    for feature, view in features.items():
        assert view["preferred_provider"] == {"value": first, "source": source}, feature
        assert view["effective_order"][0]["provider"] == first, feature
        assert view["anthropic_model"]["source"] == "code_default", feature

    assert [s["provider"] for s in features["writing_grading"]["effective_order"]] == (
        ["gemini", "anthropic"] if order else ["anthropic", "gemini"])
    # Speaking: the Claude primary moves behind the Gemini chain, not out of it.
    assert [s["slot"] for s in features["speaking_grading"]["effective_order"]] == (
        ["grading_primary", "claude_haiku", "claude_sonnet", "anthropic_primary"] if order
        else ["anthropic_primary", "grading_primary", "claude_haiku", "claude_sonnet"])


def test_models_endpoint_without_an_anthropic_key(db, as_admin, monkeypatch):
    _env_settings(monkeypatch, ANTHROPIC_API_KEY="", GEMINI_API_KEY="g")

    body = TestClient(app).get("/admin/ai/models").json()
    assert body["anthropic_key_configured"] is False
    features = {f["feature"]: f for f in body["features"]}
    for feature, view in features.items():
        # The configured preference is reported before the missing-key rule...
        assert view["preferred_provider"] == {"value": "anthropic", "source": "code_default"}, feature
        if feature == "speaking_grading":
            continue
        # ...while the chain that actually runs drops Anthropic.
        assert [(s["provider"], s["available"]) for s in view["effective_order"]] == [
            ("gemini", True)], feature

    speaking = features["speaking_grading"]["effective_order"]
    # No Claude primary slot; the Claude fallbacks stay listed but unavailable.
    assert [(s["provider"], s["slot"], s["available"]) for s in speaking] == [
        ("gemini", "grading_primary", True),
        ("anthropic", "claude_haiku", False),
        ("anthropic", "claude_sonnet", False),
    ]


def test_models_endpoint_when_the_override_store_is_unavailable(db, as_admin, monkeypatch):
    import asyncio

    _env_settings(monkeypatch, ANTHROPIC_API_KEY="k", GEMINI_API_KEY="g")
    overrides._set_for_tests({"course_writing": overrides.Override(
        feature="course_writing", preferred_provider="gemini", updated_by=ADMIN["id"])})
    db.errors["ai_model_overrides"] = RuntimeError("connection reset")
    assert asyncio.run(overrides.refresh()) == "unavailable"

    body = TestClient(app).get("/admin/ai/models").json()
    assert body["store"]["status"] == "unavailable"
    assert body["store"]["last_error"] == "RuntimeError"
    assert body["store"]["last_refreshed_at"] is not None   # the earlier good snapshot
    course = next(f for f in body["features"] if f["feature"] == "course_writing")
    # The failed refresh drops the stored row: env/code defaults apply, nothing
    # is labelled db_override.
    assert course["override"] is None
    assert course["preferred_provider"] == {"value": "anthropic", "source": "code_default"}
    assert [s["provider"] for s in course["effective_order"]] == ["anthropic", "gemini"]
    assert all(f["preferred_provider"]["source"] != "db_override" for f in body["features"])


# ── Control (FR-004) ───────────────────────────────────────────────────────


@pytest.mark.parametrize("path, body, field", [
    ("/admin/ai/models/course_writing", {"preferred_provider": "openai"}, "preferred_provider"),
    ("/admin/ai/models/course_writing", {"anthropic_model": "claude-unknown"}, "anthropic_model"),
    ("/admin/ai/models/whisper_stt", {"preferred_provider": "anthropic"}, "feature"),
])
def test_invalid_values_are_rejected_without_a_write(db, as_admin, path, body, field):
    response = TestClient(app).patch(path, json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["field"] == field
    assert db.writes() == []


def test_unknown_body_fields_are_rejected(db, as_admin):
    response = TestClient(app).patch("/admin/ai/models/course_writing",
                                   json={"preferred_provider": "gemini", "updated_by": "someone"})
    assert response.status_code == 422
    assert db.writes() == []


def test_save_records_the_actor_and_returns_canonical_state(db, as_admin):
    db.data["ai_model_overrides"] = [{"feature": "writing_grading", "preferred_provider": "gemini",
                                      "anthropic_model": "claude-haiku-5-5",
                                      "updated_by": ADMIN["id"], "updated_at": "2026-10-26T05:00:00Z"}]
    db.data["ai_model_override_audit"] = [{
        "id": 7, "feature": "writing_grading", "action": "insert", "old_preferred_provider": None,
        "new_preferred_provider": "gemini", "old_anthropic_model": None,
        "new_anthropic_model": "claude-haiku-5-5", "changed_by": ADMIN["id"],
        "changed_at": "2026-10-26T05:00:00Z"}]
    db.data["users"] = [{"id": ADMIN["id"], "email": ADMIN["email"]}]

    response = TestClient(app).patch("/admin/ai/models/writing_grading",
                                   json={"preferred_provider": "gemini",
                                         "anthropic_model": "claude-haiku-5-5"})
    assert response.status_code == 200, response.text
    [(table, calls)] = db.writes()
    assert table == "ai_model_overrides"
    upsert = next(args[0] for method, args, _ in calls if method == "upsert")
    assert upsert["updated_by"] == ADMIN["id"]

    body = response.json()
    writing = next(f for f in body["features"] if f["feature"] == "writing_grading")
    assert writing["preferred_provider"] == {"value": "gemini", "source": "db_override"}
    assert writing["anthropic_model"] == {"value": "claude-haiku-5-5", "source": "db_override"}
    assert body["recent_changes"][0]["changed_by_email"] == ADMIN["email"]


def test_store_failure_is_a_visible_503(db, as_admin):
    db.errors["ai_model_overrides"] = _Missing("Could not find the table ai_model_overrides")
    response = TestClient(app).patch("/admin/ai/models/course_writing",
                                   json={"preferred_provider": "gemini"})
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "ai_override_store_unavailable"
    assert response.json()["detail"]["status"] == "not_migrated"


# ── Usage (FR-002) ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("now, key, start", [
    ("2026-10-26T16:59:59+00:00", "today", "2026-10-25T17:00:00+00:00"),  # 23:59:59 Saigon
    ("2026-10-26T17:00:00+00:00", "today", "2026-10-26T17:00:00+00:00"),  # 00:00 next day
    ("2026-10-26T05:00:00+00:00", "7d", "2026-10-19T17:00:00+00:00"),
    ("2026-10-26T05:00:00+00:00", "30d", "2026-09-26T17:00:00+00:00"),
])
def test_windows_start_at_saigon_midnight(now, key, start):
    begin, end = dashboard.window_bounds(key, datetime.fromisoformat(now))
    assert begin == datetime.fromisoformat(start)
    assert end == datetime.fromisoformat(now)


USAGE_ROWS = [
    {"feature": "writing_grading", "service": "claude", "model": "claude-sonnet-5-5",
     "status": "success", "cost_source": "catalog_estimate",
     "pricing_version": "anthropic:claude-sonnet-5-5:2026-09-28:open", "calls": 4,
     "input_tokens": 4000, "output_tokens": 2000, "thinking_tokens": 0,
     "cache_read_tokens": 8000, "cache_write_tokens": 1000, "audio_seconds": 0,
     "text_chars": 0, "cost_usd": 0.05, "priced_calls": 4, "last_at": "2026-10-26T04:00:00Z"},
    {"feature": "writing_grading", "service": "claude", "model": "claude-sonnet-5-5",
     "status": "error", "cost_source": "unpriced", "pricing_version": None, "calls": 2,
     "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cache_read_tokens": 0,
     "cache_write_tokens": 0, "audio_seconds": 0, "text_chars": 0, "cost_usd": None,
     "priced_calls": 0, "last_at": "2026-10-26T04:01:00Z"},
    {"feature": "writing_grading", "service": "gemini", "model": "gemini-3.8-flash",
     "status": "success", "cost_source": "catalog_estimate",
     "pricing_version": "google:gemini-3.8-flash:2026-09-02:2026-12-31", "calls": 1,
     "input_tokens": 1000, "output_tokens": 500, "thinking_tokens": 200,
     "cache_read_tokens": 0, "cache_write_tokens": 0, "audio_seconds": 0, "text_chars": 0,
     "cost_usd": 0.004, "priced_calls": 1, "last_at": "2026-10-26T04:02:00Z"},
    {"feature": None, "service": "gemini", "model": "gemini-2.5-flash", "status": "success",
     "cost_source": "catalog_estimate", "pricing_version": None, "calls": 2,
     "input_tokens": 1_000_000, "output_tokens": 0, "thinking_tokens": 0,
     "cache_read_tokens": 0, "cache_write_tokens": 0, "audio_seconds": 0, "text_chars": 0,
     "cost_usd": 9.99, "priced_calls": 2, "last_at": "2026-10-26T04:03:00Z"},
    {"feature": "speaking_grading", "service": "gemini", "model": "gemini-9-unknown",
     "status": "success", "cost_source": "unpriced", "pricing_version": None, "calls": 3,
     "input_tokens": 10, "output_tokens": 10, "thinking_tokens": 0, "cache_read_tokens": 0,
     "cache_write_tokens": 0, "audio_seconds": 0, "text_chars": 0, "cost_usd": None,
     "priced_calls": 0, "last_at": "2026-10-26T04:04:00Z"},
]


def test_usage_aggregation_per_feature_and_provider():
    result = dashboard.aggregate_usage(USAGE_ROWS)
    totals = result["totals"]
    assert totals["calls"] == 12 and totals["failed_calls"] == 2
    assert totals["input_tokens"] == 1_005_010
    assert totals["cache_read_tokens"] == 8000 and totals["cache_write_tokens"] == 1000
    assert totals["thinking_tokens"] == 200
    # Legacy row re-priced from raw units (1M gemini-2.5-flash input = $0.30),
    # never from its stale stored value.
    assert totals["cost_usd"] == pytest.approx(0.05 + 0.004 + 0.30)
    assert totals["legacy_calls"] == 2
    assert totals["unpriced_calls"] == 3  # failed attempts are failures, not unpriced
    assert totals["priced_calls"] == 7

    features = {g["feature"]: g for g in result["by_feature"]}
    assert set(features) == {"writing_grading", "unattributed", "speaking_grading"}
    assert features["writing_grading"]["calls"] == 7
    assert features["writing_grading"]["failed_calls"] == 2
    providers = {g["provider"]: g for g in result["by_provider"]}
    assert set(providers) == {"anthropic", "gemini"}
    assert providers["anthropic"]["cost_usd"] == pytest.approx(0.05)
    assert providers["gemini"]["calls"] == 6


def _rollup_row(row):
    """A legacy ledger row as the rollup returns it (one row per call)."""
    return {"feature": row["feature"], "service": row["service"], "model": row["model"],
            "status": "success", "cost_source": "catalog_estimate", "pricing_version": None,
            "calls": 1, "input_tokens": row.get("input_tokens", 0), "output_tokens": 0,
            "thinking_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0,
            "audio_seconds": 0, "text_chars": row.get("text_chars", 0), "cost_usd": None,
            "priced_calls": 0, "last_at": row["created_at"]}


@pytest.mark.parametrize("ledger", [
    # Haiku 5.5: two 60k-input calls, each below the 100k-prompt multiplier.
    [{"feature": "course_writing", "service": "claude", "model": "claude-haiku-5-5",
      "input_tokens": 60_000, "created_at": f"2026-10-26T0{h}:00:00+00:00"} for h in (2, 3)],
    # ElevenLabs across a price change (Oct 11 vs Oct 12).
    [{"feature": None, "service": "elevenlabs", "model": "eleven_multilingual_v2",
      "text_chars": 1000, "created_at": f"2026-10-{d}T05:00:00+00:00"} for d in (11, 12)],
])
def test_legacy_usage_cost_equals_the_per_row_ledger_estimate(ledger):
    from services.ai_pricing import effective_logged_cost

    expected = sum(effective_logged_cost({**row, "cost_source": "catalog_estimate"})[0]
                   for row in ledger)
    result = dashboard.aggregate_usage([_rollup_row(row) for row in ledger])
    assert result["totals"]["cost_usd"] == pytest.approx(expected)
    assert result["totals"]["legacy_calls"] == 2
    assert expected == pytest.approx(0.012 if ledger[0]["service"] == "claude" else 0.18)


def test_usage_endpoint_pages_through_the_complete_rollup(db, as_admin, monkeypatch):
    monkeypatch.setattr(dashboard, "RPC_PAGE", 2)
    db.data["fn_admin_ai_usage_rollup"] = USAGE_ROWS
    response = TestClient(app).get("/admin/ai/usage?window=7d")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["totals"]["calls"] == 12
    assert body["window"]["key"] == "7d" and body["window"]["timezone"] == "Asia/Saigon"
    rpc_calls = [params for name, params, _ in db.executed if name == "fn_admin_ai_usage_rollup"]
    assert len(rpc_calls) == 3  # 2 + 2 + 1 rows
    start = datetime.fromisoformat(rpc_calls[0]["p_start"])
    assert start.astimezone(dashboard.SAIGON).hour == 0


class _UnorderedRollupQuery(_Query):
    """An RPC as PostgreSQL runs it: a rollup without ORDER BY may return its
    groups in a different order on every request; ``.order`` makes it total."""

    def execute(self):
        order = [args[0] for method, args, _ in self.calls if method == "order"]
        rows = list(self.client.data.get(self.name, []))
        if order:
            rows.sort(key=lambda r: tuple((r.get(c) is None, str(r.get(c) or "")) for c in order))
        else:
            shift = len(self.client.executed) % len(rows)
            rows = rows[shift:] + rows[:shift]
        self.client.data, saved = {**self.client.data, self.name: rows}, self.client.data
        try:
            return super().execute()
        finally:
            self.client.data = saved


def test_usage_pages_a_total_order_so_pages_neither_repeat_nor_drop_groups(db, as_admin, monkeypatch):
    # Codex P2 on 30c830309: legacy rows come back one per ledger row, so a
    # long window pages; each page is a new request with its own group order.
    legacy = [{**_rollup_row({"feature": "course_writing", "service": "claude",
                              "model": "claude-haiku-5-5", "input_tokens": 1000 * (i + 1),
                              "created_at": f"2026-10-26T0{i}:00:00+00:00"}),
               "ledger_id": f"00000000-0000-0000-0000-00000000000{i}"} for i in range(7)]
    rows = [{**row, "ledger_id": None} for row in USAGE_ROWS] + legacy
    expected = dashboard.aggregate_usage(rows)
    monkeypatch.setattr(dashboard, "RPC_PAGE", 3)
    monkeypatch.setattr(db, "rpc", lambda name, params: _UnorderedRollupQuery(db, name, params))
    db.data["fn_admin_ai_usage_rollup"] = rows

    body = TestClient(app).get("/admin/ai/usage?window=30d").json()
    assert body["totals"]["calls"] == expected["totals"]["calls"] == 12 + 7
    assert body["totals"]["input_tokens"] == expected["totals"]["input_tokens"]
    assert body["totals"]["legacy_calls"] == expected["totals"]["legacy_calls"] == 9
    assert body["totals"]["cost_usd"] == pytest.approx(expected["totals"]["cost_usd"])
    pages = [calls for name, _, calls in db.executed if name == "fn_admin_ai_usage_rollup"]
    assert len(pages) == 5  # 3 + 3 + 3 + 3 + 1 groups
    for calls in pages:
        assert [(a[0], k) for m, a, k in calls if m == "order"] == [
            (column, {"nullsfirst": False}) for column in dashboard.USAGE_ROLLUP_ORDER]


def test_failure_rollup_pages_in_its_group_key_order(db, as_admin, monkeypatch):
    monkeypatch.setattr(dashboard, "RPC_PAGE", 1)
    monkeypatch.setattr(db, "rpc", lambda name, params: _UnorderedRollupQuery(db, name, params))
    db.data["fn_admin_ai_failure_rollup"] = [
        {"feature": "course_writing", "provider": "anthropic", "error_type": t,
         "outcome": "fallback", "failures": n} for t, n in (("rate_limit", 5), ("timeout", 1), ("server", 3))]
    body = TestClient(app).get("/admin/ai/failures?window=today").json()
    assert body["totals"]["total"] == 9
    assert body["by_provider_feature"][0]["by_error_type"] == {"rate_limit": 5, "timeout": 1, "server": 3}
    pages = [calls for name, _, calls in db.executed if name == "fn_admin_ai_failure_rollup"]
    assert all([a[0] for m, a, _ in calls if m == "order"] == list(dashboard.FAILURE_ROLLUP_ORDER)
               for calls in pages)


def test_usage_endpoint_states(db, as_admin):
    assert TestClient(app).get("/admin/ai/usage?window=year").status_code == 422
    db.errors["fn_admin_ai_usage_rollup"] = _Missing("Could not find the function fn_admin_ai_usage_rollup")
    response = TestClient(app).get("/admin/ai/usage")
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "ai_dashboard_not_migrated"
    db.errors["fn_admin_ai_usage_rollup"] = RuntimeError("timeout")
    assert TestClient(app).get("/admin/ai/usage").json()["detail"]["error_code"] == "ai_usage_unavailable"


# ── Failures (FR-008) ──────────────────────────────────────────────────────


def test_failure_aggregation_and_recent_list(db, as_admin):
    db.data["fn_admin_ai_failure_rollup"] = [
        {"feature": "course_writing", "provider": "anthropic", "error_type": "rate_limit",
         "outcome": "fallback", "failures": 5},
        {"feature": "course_writing", "provider": "anthropic", "error_type": "timeout",
         "outcome": "fallback", "failures": 1},
        {"feature": "speaking_grading", "provider": "gemini", "error_type": "timeout",
         "outcome": "retry", "failures": 2},
        {"feature": "speaking_grading", "provider": "gemini", "error_type": "timeout",
         "outcome": "final", "failures": 1},
    ]
    db.data["ai_provider_failures"] = [{
        "id": 9, "created_at": "2026-10-26T04:00:00+00:00", "feature": "course_writing",
        "provider": "anthropic", "model": "claude-haiku-5-5", "route_slot": None,
        "attempt": None, "error_type": "rate_limit", "error_code": "rate_limited",
        "outcome": "fallback"}]
    body = TestClient(app).get("/admin/ai/failures?window=today").json()
    assert body["store_status"] == "ok"
    assert body["totals"] == {"total": 9, "retry": 2, "fallback": 6, "final": 1}
    first = body["by_provider_feature"][0]
    assert (first["provider"], first["feature"], first["total"]) == ("anthropic", "course_writing", 6)
    assert first["by_error_type"] == {"rate_limit": 5, "timeout": 1}
    assert body["recent"][0]["error_type"] == "rate_limit"

    rollup = next(params for name, params, _ in db.executed if name == "fn_admin_ai_failure_rollup")
    recent_query = next(calls for name, _, calls in db.executed if name == "ai_provider_failures")
    # Newest first, inside the same [start, end) window the rollup counted.
    assert [(m, a, k) for m, a, k in recent_query if m != "select"] == [
        ("gte", ("created_at", rollup["p_start"]), {}),
        ("lt", ("created_at", rollup["p_end"]), {}),
        ("order", ("created_at",), {"desc": True}),
        ("order", ("id",), {"desc": True}),
        ("limit", (50,), {}),
    ]


@pytest.mark.parametrize("now, key, start", [
    ("2026-10-26T16:59:59+00:00", "today", "2026-10-25T17:00:00+00:00"),  # 23:59:59 Saigon
    ("2026-10-26T17:00:00+00:00", "today", "2026-10-26T17:00:00+00:00"),  # 00:00 next day
    ("2026-10-26T05:00:00+00:00", "7d", "2026-10-19T17:00:00+00:00"),
    ("2026-10-26T05:00:00+00:00", "30d", "2026-09-26T17:00:00+00:00"),
])
def test_recent_failures_query_uses_the_saigon_window(db, as_admin, monkeypatch, now, key, start):
    fixed = datetime.fromisoformat(now)
    real_bounds = dashboard.window_bounds
    monkeypatch.setattr(dashboard, "window_bounds", lambda k, n=None: real_bounds(k, n or fixed))

    body = TestClient(app).get(f"/admin/ai/failures?window={key}").json()
    assert body["store_status"] == "ok"
    assert datetime.fromisoformat(body["window"]["start"].replace("Z", "+00:00")) == datetime.fromisoformat(start)
    assert datetime.fromisoformat(body["window"]["end"].replace("Z", "+00:00")) == fixed

    rollup = next(params for name, params, _ in db.executed if name == "fn_admin_ai_failure_rollup")
    assert rollup == {"p_start": start, "p_end": now}
    recent_query = next(calls for name, _, calls in db.executed if name == "ai_provider_failures")
    assert ("gte", ("created_at", start), {}) in recent_query
    assert ("lt", ("created_at", now), {}) in recent_query


def test_failures_before_migration_is_an_explicit_state(db, as_admin):
    db.errors["fn_admin_ai_failure_rollup"] = _Missing("Could not find the function")
    response = TestClient(app).get("/admin/ai/failures")
    assert response.status_code == 200
    assert response.json()["store_status"] == "not_migrated"
    assert response.json()["recent"] == []


def test_dashboard_reads_never_block_on_the_override_store(db):
    # describe_feature only reads the in-process snapshot.
    from config import settings

    db.errors["ai_model_overrides"] = RuntimeError("must not be read")
    view = dashboard.describe_feature("course_writing", settings, {})
    assert view["feature"] == "course_writing"
    assert db.executed == []
