"""
Tests for routers/health.

Direct async-function calls against the route handlers — same pattern as
tests/test_d1_e2e.py.  We mock `database.supabase_admin` to simulate
DB up / DB down / migrations missing without needing a real Supabase
connection.

Coverage:
- /health is unconditional ok with timestamp + version.
- /health/ready returns ok with all checks passing when DB + migrations +
  Gemini key are healthy.
- /health/ready returns degraded when DB query throws.
- /health/ready returns degraded when GEMINI_API_KEY is empty.
- /health/ready feature_flags block reflects current settings values (admin).
- /health/runtime anonymous body carries status + redacted placeholders only;
  the grammar_mappings inventory is admin-only.
- /health/ready anonymous body carries status codes only (no table names,
  feature-flag state or scope text).
- /health/grammar-check reuses one live probe within its TTL; a probe error
  surfaces a generic code, never the exception text.
- /api/public-stats is cached and logs (never returns) count-query errors.
- the pre-auth Supabase 502 carries a generic detail, not the transport error.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import health as health_module


async def _admin(_authorization):
    return True


async def _anonymous(_authorization):
    return False


def _run(coro):
    """Run an async coroutine to completion.

    A fresh event loop per call avoids the cross-test pollution that
    happens when a sibling test's TestClient closes the shared loop.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── /health ──────────────────────────────────────────────────────────────────


def test_health_basic_returns_ok(monkeypatch):
    """GET /health is unconditional — no DB, no env probes."""
    monkeypatch.setenv("APP_VERSION", "2026.09.13")
    out = _run(health_module.health_basic())
    assert out["status"] == "ok"
    assert "timestamp" in out and out["timestamp"]
    assert out["version"] == "2026.09.13"
    assert "release" not in out
    assert "git_branch" not in out


def test_health_basic_has_next_default_version(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    out = _run(health_module.health_basic())
    assert out["version"] == "next"


def test_health_runtime_exposes_admin_release_branch_only(monkeypatch):
    """Gate E provenance can bind the backend to staging without making its
    deployment fingerprint public."""
    async def _admin(_authorization):
        return True

    monkeypatch.setattr(health_module, "_is_admin", _admin)
    monkeypatch.setattr(health_module.grammar_service, "_load_mappings", lambda: {})
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "a" * 40)
    monkeypatch.setenv("RAILWAY_GIT_BRANCH", "staging")

    out = _run(health_module.health_runtime("Bearer admin"))
    assert out["git_sha"] == "a" * 40
    assert out["git_branch"] == "staging"


def test_health_runtime_redacts_release_branch_for_anonymous(monkeypatch):
    async def _anonymous(_authorization):
        return False

    monkeypatch.setattr(health_module, "_is_admin", _anonymous)
    monkeypatch.setattr(health_module.grammar_service, "_load_mappings", lambda: {})
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "b" * 40)
    monkeypatch.setenv("RAILWAY_GIT_BRANCH", "staging")

    out = _run(health_module.health_runtime(None))
    assert out["git_sha"] == health_module._REDACTED
    assert out["git_branch"] == health_module._REDACTED


def test_health_runtime_anonymous_gets_status_only(monkeypatch):
    """PC-J229 — the grammar-mapping inventory (counts, sentinel ids) is
    admin-only; an anonymous caller sees status, timestamp and redacted
    placeholders, nothing else."""
    monkeypatch.setattr(health_module, "_is_admin", _anonymous)
    monkeypatch.setattr(
        health_module.grammar_service,
        "_load_mappings",
        lambda: {"slug": [{"mapping_id": sid} for sid in health_module._SPRINT_6_SENTINEL_IDS]},
    )
    monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", "dep-123")

    out = _run(health_module.health_runtime(None))
    redacted = health_module._REDACTED
    assert out == {
        "status": "ok",
        "timestamp": out["timestamp"],
        "git_sha": redacted,
        "git_branch": redacted,
        "deployment_id": redacted,
        "service_name": redacted,
        "environment_name": redacted,
        "grammar_mappings": redacted,
    }
    assert out["timestamp"]
    body = repr(out)
    for leaked in ("mappings_match", "active_count", "sentinel_presence", "dep-123",
                   *health_module._SPRINT_6_SENTINEL_IDS):
        assert leaked not in body


def test_health_runtime_expected_count_matches_mapping_file(monkeypatch):
    """BL-24 — cce1f566b added M051–M064 without bumping the constant, so
    staging reported mappings_match=false (61 vs 47) for five months. The
    YAML is the source of truth: adding or deferring a mapping must update
    `_EXPECTED_MAPPING_COUNT` in the same change. Counted here straight from
    the file with the loader's own filter, not through `_load_mappings`."""
    import yaml
    from services.grammar_content import MAPPING_FILE, GrammarContentService

    data = yaml.safe_load(MAPPING_FILE.read_text(encoding="utf-8"))
    active_ids = [
        m["mapping_id"] for m in data["mappings"]
        if m.get("mapping_id") and m.get("target_file") and not m.get("deferred_until")
    ]
    assert len(active_ids) == len(set(active_ids)), "duplicate mapping_id"
    assert health_module._EXPECTED_MAPPING_COUNT == len(active_ids), (
        "feedback-anchor-mapping.yaml changed; update _EXPECTED_MAPPING_COUNT "
        "in routers/health.py with the reason"
    )

    # The inventory is admin-only since PC-J229.
    monkeypatch.setattr(health_module, "_is_admin", _admin)
    # A fresh instance so another test's cached or patched index cannot leak in.
    monkeypatch.setattr(health_module, "grammar_service", GrammarContentService())
    out = _run(health_module.health_runtime("Bearer admin"))
    assert "mappings" not in out
    assert out["grammar_mappings"]["active_count"] == len(active_ids)
    assert out["grammar_mappings"]["mappings_match"] is True
    assert out["grammar_mappings"]["sprint_6_loaded"] is True


# ── /health/ready ────────────────────────────────────────────────────────────


class _OkBuilder:
    """A chainable PostgREST builder stub that always succeeds."""
    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def execute(self, *_a, **_k):
        class _R:
            data, count = [], 0
        return _R()


class _OkClient:
    def table(self, *_a, **_k):
        return _OkBuilder()


class _FailingClient:
    """Raises on every .table() call — simulates DB unreachable."""
    def table(self, *_a, **_k):
        raise RuntimeError("simulated supabase outage")


def test_health_ready_all_ok(monkeypatch):
    """Healthy DB + Gemini key set → status ok, every check ok."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")
    monkeypatch.setattr(health_module, "_is_admin", _admin)

    out = _run(health_module.health_ready(authorization="Bearer admin-token"))
    assert out["status"] == "ok"
    assert out["checks"]["database"]["status"] == "ok"
    assert out["checks"]["migrations"]["status"] == "ok"
    # All critical tables are listed in the verified array.
    assert set(out["checks"]["migrations"]["verified"]) == set(health_module._CRITICAL_TABLES)
    assert out["checks"]["gemini_api"]["status"] == "ok"
    assert out["checks"]["feature_flags"]["status"] == "ok"
    assert health_module._CRITICAL_COLUMNS["advanced_vocab_rewrite_submissions"] == (
        "id,bank_id,user_id,class_assignment_item_id,answers,content_snapshot,"
        "feedback,status,model,prompt_version,error_code,provider_started_at,"
        "completed_at,created_at,updated_at"
    )


def test_health_ready_degrades_on_db_failure(monkeypatch):
    """When supabase_admin raises, both DB and migrations checks fail and
    overall status drops to degraded — but the endpoint still returns 200
    so external probes can distinguish "down" from "degraded".

    S4: the raw DB error string is fingerprinting detail — redacted for
    anonymous callers, so `error` must NOT be present without admin auth.
    """
    monkeypatch.setattr(health_module, "supabase_admin", _FailingClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")

    out = _run(health_module.health_ready())  # anonymous
    assert out["status"] == "degraded"
    assert out["checks"]["database"]["status"] == "fail"
    assert "error" not in out["checks"]["database"], "DB error string must be admin-only"
    assert out["checks"]["migrations"]["status"] == "fail"
    # Table names map the schema — anonymous monitors get the status code only.
    assert "missing" not in out["checks"]["migrations"]
    assert "simulated supabase outage" not in repr(out)


def test_health_ready_exposes_db_error_to_admin(monkeypatch):
    """S4: an authenticated admin still gets the full DB error string + the
    per-table error detail — redaction only applies to anonymous callers."""
    monkeypatch.setattr(health_module, "supabase_admin", _FailingClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")

    async def _fake_is_admin(_auth):
        return True
    monkeypatch.setattr(health_module, "_is_admin", _fake_is_admin)

    out = _run(health_module.health_ready(authorization="Bearer admin-token"))
    assert out["checks"]["database"]["status"] == "fail"
    assert "error" in out["checks"]["database"], "admin should see the DB error string"
    assert any(":" in m for m in out["checks"]["migrations"]["missing"])


def test_health_ready_flags_missing_gemini_key(monkeypatch):
    """Missing GEMINI_API_KEY → status degraded but DB still reads ok."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "")

    out = _run(health_module.health_ready())
    assert out["status"] == "degraded"
    assert out["checks"]["database"]["status"] == "ok"
    assert out["checks"]["gemini_api"]["status"] == "missing_key"


def test_health_ready_exposes_feature_flag_state(monkeypatch):
    """The feature_flags block mirrors current settings (booleans only —
    never secrets), so a single curl confirms whether dogfood flags are on."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")
    monkeypatch.setattr(health_module.settings, "VOCAB_BANK_FEATURE_FLAG_ENABLED", True)
    monkeypatch.setattr(health_module.settings, "D1_ENABLED", True)
    monkeypatch.setattr(health_module.settings, "D3_ENABLED", False)
    monkeypatch.setattr(health_module.settings, "FLASHCARD_ENABLED", True)

    monkeypatch.setattr(health_module, "_is_admin", _admin)

    flags = _run(health_module.health_ready(authorization="Bearer admin-token"))["checks"]["feature_flags"]
    assert flags["vocab_bank_enabled"] is True
    assert flags["d1_enabled"] is True
    assert flags["d3_enabled"] is False
    assert flags["flashcard_enabled"] is True


def test_health_ready_anonymous_returns_status_codes_only(monkeypatch):
    """GC/F15: anonymous callers learn the verdict, not the schema inventory
    or which feature flags are switched on."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")
    monkeypatch.setattr(health_module, "_is_admin", _anonymous)

    out = _run(health_module.health_ready(authorization=None))
    assert out["status"] == "ok"
    for name, check in out["checks"].items():
        assert set(check) == {"status"}, f"{name} leaks {sorted(check)}"
    body = repr(out)
    for table in health_module._CRITICAL_TABLES:
        assert f"'{table}'" not in body


# ── /health/grammar-check ────────────────────────────────────────────────────


@pytest.fixture
def _fresh_grammar_probe(monkeypatch):
    monkeypatch.setattr(health_module, "_grammar_probe_cache", None)
    # Each test runs its own event loop; a lock that once waited is bound to it.
    monkeypatch.setattr(health_module, "_grammar_probe_lock", asyncio.Lock())
    yield


def test_grammar_check_probe_is_reused_within_ttl(monkeypatch, _fresh_grammar_probe):
    """GC-1: anonymous polling must not run a live LanguageTool check per hit."""
    from services import grammar_check

    calls = []

    async def _probe():
        calls.append(1)
        return {"status": "healthy", "sample_error_count": 3, "messages": []}

    monkeypatch.setattr(grammar_check, "grammar_check_health", _probe)
    first = _run(health_module.health_grammar_check())
    second = _run(health_module.health_grammar_check())
    assert len(calls) == 1
    assert first["status"] == second["status"] == "healthy"
    assert second["checked_at"] == first["checked_at"]
    assert second["grammar_check"]["sample_error_count"] == 3

    # Once the TTL lapses the next call runs a fresh live probe.
    stamp, payload = health_module._grammar_probe_cache
    monkeypatch.setattr(
        health_module, "_grammar_probe_cache",
        (stamp - health_module._GRAMMAR_PROBE_TTL_SECONDS - 1, payload),
    )
    _run(health_module.health_grammar_check())
    assert len(calls) == 2


def test_grammar_check_probe_concurrent_callers_share_one_probe(monkeypatch, _fresh_grammar_probe):
    from services import grammar_check

    calls = []

    async def _probe():
        calls.append(1)
        await asyncio.sleep(0.01)
        return {"status": "healthy", "sample_error_count": 2, "messages": []}

    monkeypatch.setattr(grammar_check, "grammar_check_health", _probe)

    async def _burst():
        return await asyncio.gather(*(health_module.health_grammar_check() for _ in range(5)))

    outs = _run(_burst())
    assert len(calls) == 1
    assert all(o["status"] == "healthy" for o in outs)


def test_grammar_check_probe_error_is_generic(monkeypatch, _fresh_grammar_probe):
    """GC-2: the exception text stays in the server log; the public body
    carries a stable error code (the CI smoke gate keys on status=error)."""
    from services import grammar_check

    class _Boom:
        def _ensure_backend(self):
            raise RuntimeError("/srv/internal/LanguageTool-6.4 at 10.0.0.7:8081 refused")

    monkeypatch.setattr(grammar_check, "get_grammar_check_service", lambda: _Boom())
    out = _run(health_module.health_grammar_check())
    assert out["status"] == "error"
    assert out["grammar_check"]["error_code"] == "probe_failed"
    body = repr(out)
    assert "10.0.0.7" not in body and "/srv/internal" not in body


# ── /api/public-stats ────────────────────────────────────────────────────────


class _CountBuilder:
    def __init__(self, calls, count):
        self._calls, self._count = calls, count
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def execute(self, *_a, **_k):
        self._calls.append(1)
        class _R:
            pass
        r = _R()
        r.count = self._count
        return r


def _main_module():
    import main
    return main


def test_public_stats_is_cached(monkeypatch):
    main = _main_module()
    calls = []

    class _Client:
        def table(self, name):
            return _CountBuilder(calls, 7 if name == "users" else 3)

    monkeypatch.setattr(main, "supabase_admin", _Client())
    monkeypatch.setattr(main, "_public_stats_cache", None)
    assert main.public_stats() == {"total_users": 7, "sessions_completed": 3}
    assert main.public_stats() == {"total_users": 7, "sessions_completed": 3}
    assert len(calls) == 2, "second call must be served from the cache"


def test_public_stats_failure_is_logged_not_returned(monkeypatch, caplog):
    main = _main_module()
    monkeypatch.setattr(main, "supabase_admin", _FailingClient())
    monkeypatch.setattr(main, "_public_stats_cache", None)
    with caplog.at_level("ERROR"):
        out = main.public_stats()
    assert out == {"total_users": None, "sessions_completed": None}
    assert "simulated supabase outage" in caplog.text
    # The failure is held briefly, then retried.
    expires_at, _ = main._public_stats_cache
    assert expires_at - main.perf_counter() <= main._PUBLIC_STATS_FAILURE_TTL_SECONDS


# ── pre-auth Supabase transport failure (502) ────────────────────────────────


def test_auth_transport_error_502_is_generic(monkeypatch):
    import httpx
    from fastapi import HTTPException
    from routers import auth as auth_module

    class _Client:
        cookies = httpx.Cookies()

        async def get(self, url, **_k):
            raise httpx.ConnectError("[Errno -2] cannot resolve abcdinternal.supabase.co", request=httpx.Request("GET", url))

    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _Client())
    monkeypatch.setattr(auth_module.activation_gate, "remembered_user", lambda _t: None)
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.get_supabase_user("Bearer some-token"))
    assert exc.value.status_code == 502
    assert "supabase.co" not in exc.value.detail
    assert "Errno" not in exc.value.detail
