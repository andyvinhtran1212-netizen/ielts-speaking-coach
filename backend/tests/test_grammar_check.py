"""
backend/tests/test_grammar_check.py — Sprint 14.8

Behavioural tests for :class:`services.grammar_check.GrammarCheckService`.

The service is the Sprint 14.8 wrapper around the
`assets/grammar-mindmap/grammar_checker.py` asset (Andy lock L1 —
wrap, don't rewrite). These tests pin the wrapper's contract:

  - Lazy init (L3) — LTBackend constructed only on first .check.
  - Cache by SHA256(transcript) (L4).
  - Top-10 cap + severity ordering (L8).
  - 15s timeout + silent skip (L9 + L10).
  - VN-learner regex still runs when LT unavailable (L11).
  - Telemetry persists with event_kind='grammar_check' (L12).
  - L16 backward compat — module import is side-effect free.

The asset's LanguageTool path needs Java; CI doesn't have it. The
tests below either:

  (a) stub the asset's `run_local_rules` + `LTBackend` so the service
      is exercised without real Java, or
  (b) skip cleanly when language_tool_python isn't installed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import grammar_check                                  # noqa: E402
from services.grammar_check import (                                # noqa: E402
    GRAMMAR_CHECK_TIMEOUT_SECONDS,
    GRAMMAR_CACHE_TTL_HOURS,
    GrammarCheckResult,
    GrammarCheckService,
    GrammarError,
    MAX_DISPLAYED_ERRORS,
    _categorise,
    _hash_transcript,
    _normalise_finding,
)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _finding(
    *,
    rule_id: str = "LOCAL_MISSING_SUBJECT",
    category: str = "GRAMMAR",
    message: str = "Missing subject",
    offset: int = 0,
    err_len: int = 4,
    replacements: list | None = None,
    tip_vi: str | None = None,
) -> dict:
    return {
        "ruleId":      rule_id,
        "category":    category,
        "message":     message,
        "offset":      offset,
        "errorLength": err_len,
        "replacements": replacements or ["He"],
        "_tip":        {"tip_vi": tip_vi, "tip_en": "", "point": "", "area": ""} if tip_vi else None,
    }


def _fake_asset_module(merged_findings: list[dict]):
    """Build a stub asset module so the service runs without Java."""
    mod = MagicMock()
    mod.run_local_rules.return_value = []
    mod.merge_findings.return_value = merged_findings
    backend = MagicMock()
    backend.check.return_value = []
    backend.mode = "offline"
    mod.LTBackend.return_value = backend
    return mod


# ── L4: hash key is deterministic + normalised ───────────────────────────────


def test_hash_transcript_normalises_case_and_whitespace():
    """Cache hits must survive trivial whitespace + case variance —
    same answer pasted twice should not burn the LT JRE twice."""
    a = _hash_transcript("Yesterday I goed to the store.")
    b = _hash_transcript("  yesterday i goed to the store.  ")
    c = _hash_transcript("YESTERDAY I GOED TO THE STORE.")
    assert a == b == c
    assert len(a) == 64  # SHA256 hex


def test_hash_transcript_empty_string_is_stable():
    assert _hash_transcript("") == _hash_transcript("   ")


# ── L8: top-10 cap + severity priority ───────────────────────────────────────


def test_max_displayed_errors_is_ten():
    """L8 — cap pinned. Future tuning is fine, but a regression to
    unlimited would overwhelm the UI panel."""
    assert MAX_DISPLAYED_ERRORS == 10


def test_run_sync_caps_displayed_at_max_and_prioritises_by_severity(monkeypatch):
    """L8 — 15 findings (mixed severity); top 10 must be the high-
    severity ones, total_count surfaces the full count for the +N more
    label."""
    # 15 findings: 5 tense (high), 5 article (medium), 5 style (low).
    merged = (
        [_finding(rule_id="LOCAL_WRONG_TENSE",         category="GRAMMAR",
                  message="tense", offset=i, err_len=2)        for i in range(0, 10, 2)] +
        [_finding(rule_id="LOCAL_ARTICLE_OMISSION",    category="GRAMMAR",
                  message="article", offset=10 + i, err_len=2) for i in range(0, 10, 2)] +
        [_finding(rule_id="",                          category="STYLE",
                  message="style", offset=20 + i, err_len=2)   for i in range(0, 10, 2)]
    )
    fake_mod = _fake_asset_module(merged)
    with patch.dict(sys.modules, {"grammar_checker": fake_mod}):
        svc = GrammarCheckService()
        result = svc._run_sync("x" * 40)
    assert result.total_count == 15
    assert result.displayed_count == 10
    # All 5 tense (high severity) must be in the displayed set; the
    # 5 style (low severity) must be dropped.
    cats = [e.category for e in result.errors]
    assert cats.count("tense") == 5
    assert cats.count("style") == 0


# ── L11: VN-learner regex always runs ────────────────────────────────────────


def test_local_rules_run_even_when_backend_is_none(monkeypatch):
    """L11 — when LTBackend is unavailable (e.g. no Java), the VI
    regex layer still produces findings. The merged output is just
    the local findings — but the service must not crash."""
    fake_mod = MagicMock()
    # Local rules return one regex-detected error.
    local = [_finding(rule_id="LOCAL_MISSING_SUBJECT", offset=0, err_len=2, tip_vi="Thiếu chủ ngữ.")]
    fake_mod.run_local_rules.return_value = local
    fake_mod.merge_findings.return_value  = local
    fake_mod.LTBackend.side_effect = RuntimeError("Java missing")

    with patch.dict(sys.modules, {"grammar_checker": fake_mod}):
        svc = GrammarCheckService()
        result = svc._run_sync("Go store yesterday.")
    assert result.total_count == 1
    assert result.errors[0].category == "missing_subject"
    # Tip text propagates from the asset's _tip block.
    assert "Thiếu chủ ngữ" in result.errors[0].explanation_vn


# ── L9 + L10: timeout silently skips ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_check_silent_skips_on_timeout(monkeypatch):
    """L10 — 15s timeout. We override the service's timeout to a tiny
    value so CI runs fast; the contract under test is "timeout → None"."""
    svc = GrammarCheckService(timeout_seconds=0.05)
    monkeypatch.setattr(grammar_check, "_cache_get", lambda _sha: None)
    monkeypatch.setattr(grammar_check, "_cache_set", lambda *_a, **_kw: None)
    monkeypatch.setattr(grammar_check, "log_fallback_events", lambda **_kw: None)

    def _slow_run(_t):
        import time as _time
        _time.sleep(1.0)
        return GrammarCheckResult()
    monkeypatch.setattr(svc, "_run_sync", _slow_run)

    result = await svc.check("Long enough transcript text here.")
    assert result is None  # silent skip


@pytest.mark.asyncio
async def test_check_silent_skips_on_worker_exception(monkeypatch):
    """L9 — any uncaught exception in the worker returns None. The
    grader/judge tasks must not be poisoned by a grammar fail."""
    svc = GrammarCheckService()
    monkeypatch.setattr(grammar_check, "_cache_get", lambda _sha: None)
    monkeypatch.setattr(grammar_check, "_cache_set", lambda *_a, **_kw: None)
    monkeypatch.setattr(grammar_check, "log_fallback_events", lambda **_kw: None)

    def _explode(_t):
        raise RuntimeError("LanguageTool died")
    monkeypatch.setattr(svc, "_run_sync", _explode)

    result = await svc.check("Non-empty transcript.")
    assert result is None


@pytest.mark.asyncio
async def test_check_short_circuits_on_empty_transcript():
    """Defensive — empty input never burns the JRE."""
    svc = GrammarCheckService()
    assert (await svc.check("")) is None
    assert (await svc.check("   \n  ")) is None


# ── L4: cache hit returns cached=True without running the backend ────────────


@pytest.mark.asyncio
async def test_check_cache_hit_returns_cached_field_true(monkeypatch):
    fake_cached = GrammarCheckResult(
        errors=[GrammarError(
            category="tense", original_text="goed", suggestion="went",
            explanation_vn="Quá khứ bất quy tắc.",
            transcript_offset_start=10, transcript_offset_end=14,
            severity="high",
        )],
        total_count=1, displayed_count=1, cached=True,
    )
    monkeypatch.setattr(grammar_check, "_cache_get", lambda _sha: fake_cached)

    svc = GrammarCheckService()
    called = {"count": 0}
    def _spy(_t):
        called["count"] += 1
        return GrammarCheckResult()
    monkeypatch.setattr(svc, "_run_sync", _spy)

    result = await svc.check("Yesterday I goed to the store.")
    assert result is not None
    assert result.cached is True
    assert called["count"] == 0  # cache hit must not invoke the worker


# ── L12: success path logs event with event_kind='grammar_check' ─────────────


@pytest.mark.asyncio
async def test_success_path_logs_event_with_grammar_check_kind(monkeypatch):
    captured: dict = {}
    def _spy(*, session_id, question_id, response_id, events, event_kind="grading"):
        captured["event_kind"]   = event_kind
        captured["events_count"] = len(list(events))

    monkeypatch.setattr(grammar_check, "log_fallback_events", _spy)
    monkeypatch.setattr(grammar_check, "_cache_get", lambda _sha: None)
    monkeypatch.setattr(grammar_check, "_cache_set", lambda *_a, **_kw: None)

    svc = GrammarCheckService()
    monkeypatch.setattr(svc, "_run_sync",
                        lambda _t: GrammarCheckResult(errors=[], total_count=0, displayed_count=0))

    await svc.check("Some transcript.")
    assert captured["event_kind"] == "grammar_check"
    assert captured["events_count"] == 1


# ── L3: backend is lazy — module import + service ctor don't load LT ─────────


def test_module_import_does_not_instantiate_backend():
    """L3 — import grammar_check should NOT pay LTBackend's Java
    cold-start. The singleton starts empty; only get_grammar_check_service
    + .check trigger init."""
    from importlib import reload
    reload(grammar_check)
    assert grammar_check._service is None


def test_service_constructor_does_not_load_backend():
    svc = GrammarCheckService()
    # _backend stays None until _ensure_backend is called.
    assert svc._backend is None


def test_get_singleton_returns_same_instance():
    grammar_check.set_grammar_check_service(None)  # reset
    a = grammar_check.get_grammar_check_service()
    b = grammar_check.get_grammar_check_service()
    assert a is b


# ── L6: schema normalisation produces the documented field set ───────────────


def test_normalise_finding_produces_required_schema_fields():
    finding = _finding(
        rule_id="LOCAL_WRONG_TENSE",
        category="GRAMMAR",
        message="tense",
        offset=12, err_len=4,    # "Yesterday I " is 12 chars; "goed" starts at 12
        replacements=["went"],
        tip_vi="Dùng quá khứ.",
    )
    transcript = "Yesterday I goed to the store."
    err = _normalise_finding(finding, transcript)
    assert err.category               == "tense"
    assert err.original_text          == "goed"
    assert err.suggestion             == "went"
    assert err.explanation_vn         == "Dùng quá khứ."
    assert err.transcript_offset_start == 12
    assert err.transcript_offset_end   == 16
    assert err.severity                == "high"


def test_normalise_finding_falls_back_to_lt_message_when_no_vi_tip():
    finding = _finding(
        rule_id="UNKNOWN_RULE",
        category="GRAMMAR",
        message="Use 'is' instead of 'are'.",
        offset=0, err_len=3,
        replacements=["is"],
        tip_vi=None,
    )
    err = _normalise_finding(finding, "are happy.")
    # When no Vietnamese tip is present, the LT English message
    # surfaces — still actionable, just untranslated.
    assert "Use 'is'" in err.explanation_vn


# ── Categorisation taxonomy ──────────────────────────────────────────────────


def test_categorise_maps_local_missing_subject_rule():
    assert _categorise({"ruleId": "LOCAL_MISSING_SUBJECT", "category": "GRAMMAR"}) == "missing_subject"


def test_categorise_maps_languagetool_typos_to_spelling():
    assert _categorise({"ruleId": "MORFOLOGIK_RULE_EN_US", "category": "TYPOS"}) == "spelling"


def test_categorise_falls_back_to_other_for_unknown():
    assert _categorise({"ruleId": "WEIRD_RULE", "category": "WEIRD"}) == "other"


# ── Constants snapshot — pin Sprint 14.8 locks ───────────────────────────────


def test_locked_constants():
    """Pin L4 (4h — was 24h, B3/Mục 20), L10 (15s), L8 (10). Future tuning is
    intentional; flipping the values silently would surprise dogfood expectations."""
    assert GRAMMAR_CHECK_TIMEOUT_SECONDS == 15.0
    assert GRAMMAR_CACHE_TTL_HOURS       == 4
    assert MAX_DISPLAYED_ERRORS          == 10
