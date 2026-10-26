"""AIOPS-0024 FR-005/FR-006 — admin overrides in ai_router, no network.

DB override > env > code default; a preference only reorders (the fallback
chain stays); request paths read a snapshot that a background task refreshes;
any read problem falls back to env/code defaults.
"""

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest

from config import Settings
from services import ai_model_overrides as overrides
from services import ai_router
from services.ai_pricing import token_rate
from services.grading_orchestrator import (
    ANTHROPIC_PRIMARY_SLOT,
    GRADING_PROVIDER_ORDER,
    grading_provider_order,
)


@pytest.fixture(autouse=True)
def _clean_snapshot():
    overrides.reset()
    yield
    overrides.reset()


def _settings(**values) -> Settings:
    base = {"ANTHROPIC_API_KEY": "test-key", "GEMINI_API_KEY": "test-gemini"}
    return Settings(_env_file=None, **{**base, **values})


def _install(**by_feature) -> None:
    overrides._set_for_tests({
        feature: overrides.Override(feature=feature, **values)
        for feature, values in by_feature.items()
    })


# ── Fake async Supabase client ─────────────────────────────────────────────


class _Query:
    def __init__(self, client, table):
        self.client, self.table, self.calls = client, table, []

    def __getattr__(self, name):
        def _chain(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self
        return _chain

    def execute(self):
        self.client.executed.append((self.table, self.calls))
        if self.client.delay:
            time.sleep(self.client.delay)
        if self.client.error is not None:
            raise self.client.error
        return SimpleNamespace(data=self.client.rows.get(self.table, []))


class FakeClient:
    def __init__(self, rows=None, error=None, delay=0.0):
        self.rows, self.error, self.delay = rows or {}, error, delay
        self.executed: list = []

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def fake_db(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(overrides, "_client", lambda: client)
    return client


# ── Precedence (FR-005) ────────────────────────────────────────────────────


def test_without_overrides_routing_is_unchanged():
    s = _settings()
    for feature in overrides.EXISTING_PROVIDERS:
        assert ai_router.provider_order(feature, s) == ai_router._configured_order(feature, s)[0]
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("anthropic", "gemini")
    assert ai_router.effective_order("speaking_grading", "gemini", s) == ("gemini",)
    assert grading_provider_order(s) == GRADING_PROVIDER_ORDER
    assert ai_router.anthropic_model("writing_grading", s) == "claude-sonnet-5-5"


def test_preferring_gemini_keeps_claude_as_fallback():
    s = _settings()
    _install(writing_grading={"preferred_provider": "gemini"})
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("gemini", "anthropic")
    assert ai_router.anthropic_position("writing_grading", "gemini", s) == "after"
    # Other features are untouched.
    assert ai_router.effective_order("course_writing", "gemini", s) == ("anthropic", "gemini")


def test_preferring_claude_adds_it_ahead_of_an_existing_only_order():
    s = _settings(AI_PROVIDER_ORDER_COURSE_WRITING="gemini")
    assert ai_router.effective_order("course_writing", "gemini", s) == ("gemini",)
    _install(course_writing={"preferred_provider": "anthropic"})
    assert ai_router.effective_order("course_writing", "gemini", s) == ("anthropic", "gemini")


def test_speaking_slot_placement_follows_the_preference():
    s = _settings()  # code default order "gemini": no Claude slot
    _install(speaking_grading={"preferred_provider": "anthropic"})
    assert grading_provider_order(s) == (ANTHROPIC_PRIMARY_SLOT, *GRADING_PROVIDER_ORDER)

    s = _settings(AI_PROVIDER_ORDER_SPEAKING_GRADING="anthropic,gemini")
    _install(speaking_grading={"preferred_provider": "gemini"})
    assert grading_provider_order(s) == (*GRADING_PROVIDER_ORDER, ANTHROPIC_PRIMARY_SLOT)

    s = _settings()  # Gemini preference never adds a Claude slot by itself
    _install(speaking_grading={"preferred_provider": "gemini"})
    assert grading_provider_order(s) == GRADING_PROVIDER_ORDER


def test_missing_anthropic_key_still_removes_claude_from_a_preferred_order():
    s = _settings(ANTHROPIC_API_KEY="")
    _install(writing_grading={"preferred_provider": "anthropic"})
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("gemini",)
    assert ai_router.anthropic_position("writing_grading", "gemini", s) is None


def test_model_override_wins_over_env_and_code_default():
    s = _settings(ANTHROPIC_MODEL_WRITING_GRADING="claude-sonnet-5-5")
    _install(writing_grading={"anthropic_model": "claude-haiku-5-5"})
    assert ai_router.anthropic_model("writing_grading", s) == "claude-haiku-5-5"
    assert ai_router.anthropic_model_source("writing_grading", s) == "db_override"


def test_source_labels_distinguish_env_and_code_default():
    s = _settings(AI_PROVIDER_ORDER_WRITING_GRADING="gemini,anthropic",
                  ANTHROPIC_MODEL_FAST="claude-haiku-5-5")
    assert ai_router.provider_order_source("writing_grading", s) == "env"
    assert ai_router.anthropic_model_source("writing_grading", s) == "code_default"
    assert ai_router.anthropic_model_source("course_writing", s) == "env"
    assert ai_router.provider_order_source("speaking_grading", s) == "code_default"
    assert ai_router.provider_order_source("course_writing", s) == "code_default"
    _install(course_writing={"preferred_provider": "gemini"})
    assert ai_router.provider_order_source("course_writing", s) == "db_override"


# ── Allowlist (FR-004) ─────────────────────────────────────────────────────


def test_allowlisted_claude_models_are_all_priced():
    for model in overrides.ANTHROPIC_MODEL_ALLOWLIST:
        assert token_rate("anthropic", model) is not None, model


@pytest.mark.parametrize("feature, provider, model, field", [
    ("mystery_feature", None, None, "feature"),
    ("course_writing", "openai", None, "preferred_provider"),
    ("course_writing", "Anthropic", None, "preferred_provider"),
    ("course_writing", None, "claude-unknown", "anthropic_model"),
    ("course_writing", None, "gemini-3.8-flash", "anthropic_model"),
])
def test_validate_request_rejects_values_outside_the_allowlist(feature, provider, model, field):
    with pytest.raises(overrides.OverrideValidationError) as err:
        overrides.validate_request(feature, provider, model)
    assert err.value.field == field


def test_stored_values_outside_the_allowlist_are_ignored_and_flagged():
    parsed = overrides.validate_row({
        "feature": "course_writing", "preferred_provider": "openai",
        "anthropic_model": "claude-opus-9",
    })
    assert parsed.preferred_provider is None and parsed.anthropic_model is None
    assert parsed.invalid_fields == ("preferred_provider", "anthropic_model")
    assert overrides.validate_row({"feature": "not_routed"}) is None


# ── Snapshot, TTL and failure fallback (FR-006) ────────────────────────────


@pytest.mark.parametrize("configured, effective", [(5, 30.0), (45, 45.0), (600, 60.0), ("x", 30.0)])
def test_ttl_is_clamped_to_30_60_seconds(configured, effective):
    assert overrides.ttl_seconds(SimpleNamespace(AI_MODEL_OVERRIDE_TTL_SECONDS=configured)) == effective


@pytest.mark.asyncio
async def test_request_path_reads_only_the_snapshot(fake_db):
    fake_db.rows = {"ai_model_overrides": [{"feature": "writing_grading", "preferred_provider": "gemini"}]}
    s = _settings()
    # Not loaded yet: env/code defaults, and the read did not touch the DB.
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("anthropic", "gemini")
    assert fake_db.executed == []

    assert await overrides.refresh() == "ok"
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("gemini", "anthropic")
    assert len(fake_db.executed) == 1

    # A DB change is not seen until the next refresh; reads stay I/O free.
    fake_db.rows = {"ai_model_overrides": []}
    for _ in range(5):
        assert ai_router.effective_order("writing_grading", "gemini", s) == ("gemini", "anthropic")
    assert len(fake_db.executed) == 1
    await overrides.refresh()
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("anthropic", "gemini")


@pytest.mark.asyncio
async def test_refresher_applies_changes_each_ttl_window(fake_db, monkeypatch):
    sleeps: list[float] = []

    async def _sleep(seconds):
        sleeps.append(seconds)
        fake_db.rows = {"ai_model_overrides": [{"feature": "course_writing", "preferred_provider": "gemini"}]}
        if len(sleeps) == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(overrides.asyncio, "sleep", _sleep)
    with pytest.raises(asyncio.CancelledError):
        await overrides.run_refresher(SimpleNamespace(AI_MODEL_OVERRIDE_TTL_SECONDS=45))
    assert sleeps == [45.0, 45.0]
    assert overrides.get_override("course_writing").preferred_provider == "gemini"


def test_snapshot_older_than_three_windows_is_ignored(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(overrides, "_clock", lambda: now[0])
    _install(writing_grading={"preferred_provider": "gemini"})
    s = _settings()
    now[0] += 3 * 30 - 1
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("gemini", "anthropic")
    now[0] += 2
    assert overrides.store_status(s) == "stale"
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("anthropic", "gemini")


class _MissingTable(Exception):
    code = "42P01"


@pytest.mark.parametrize("error, delay, status", [
    (RuntimeError("connection reset"), 0.0, "unavailable"),
    (_MissingTable('relation "ai_model_overrides" does not exist'), 0.0, "not_migrated"),
    (None, 0.5, "unavailable"),  # timeout
])
@pytest.mark.asyncio
async def test_read_failures_fall_back_to_env_defaults(fake_db, error, delay, status):
    s = _settings()
    _install(writing_grading={"preferred_provider": "gemini"})
    fake_db.error, fake_db.delay = error, delay
    assert await overrides.refresh(timeout=0.05) == status
    assert overrides.get_override("writing_grading") is None
    assert ai_router.effective_order("writing_grading", "gemini", s) == ("anthropic", "gemini")
    assert overrides.snapshot_info(s)["status"] == status


@pytest.mark.asyncio
async def test_save_validates_before_writing_and_refreshes_after(fake_db):
    with pytest.raises(overrides.OverrideValidationError):
        await overrides.save("course_writing", preferred_provider="openai",
                             anthropic_model=None, actor_id="admin-1")
    assert fake_db.executed == []

    fake_db.rows = {"ai_model_overrides": [{"feature": "course_writing", "preferred_provider": "gemini",
                                            "anthropic_model": None, "updated_by": "admin-1"}]}
    await overrides.save("course_writing", preferred_provider="gemini",
                         anthropic_model=None, actor_id="admin-1")
    (table, calls), (refresh_table, _) = fake_db.executed
    assert table == refresh_table == "ai_model_overrides"
    method, args, kwargs = calls[0]
    assert method == "upsert" and kwargs == {"on_conflict": "feature"}
    assert {k: args[0][k] for k in ("feature", "preferred_provider", "anthropic_model", "updated_by")} == {
        "feature": "course_writing", "preferred_provider": "gemini",
        "anthropic_model": None, "updated_by": "admin-1",
    }
    assert overrides.get_override("course_writing").preferred_provider == "gemini"

    # Unchanged value: no second write (no audit noise).
    await overrides.save("course_writing", preferred_provider="gemini",
                         anthropic_model=None, actor_id="admin-2")
    assert len(fake_db.executed) == 2


@pytest.mark.asyncio
async def test_save_store_failure_is_reported_not_swallowed(fake_db):
    fake_db.error = _MissingTable("relation does not exist")
    with pytest.raises(overrides.OverrideStoreUnavailable) as err:
        await overrides.save("course_writing", preferred_provider="gemini",
                             anthropic_model=None, actor_id="admin-1")
    assert err.value.status == "not_migrated"
