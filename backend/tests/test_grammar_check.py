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


# ── Asset presence + privacy guard (2026-10-25 restore) ──────────────────────
#
# Production ran for months with ``ModuleNotFoundError: grammar_checker``
# because the grammar asset was never in the deployed image (first missing
# from the repo, then outside the backend/ build root). These tests import
# the real asset (no stub) so a stripped asset fails CI, and pin the rule that
# learner transcripts never reach the public LanguageTool API.


def _real_asset_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "assets" / "grammar-mindmap"


def test_asset_directory_is_committed():
    d = _real_asset_dir()
    assert (d / "grammar_checker.py").is_file(), "backend/assets/grammar-mindmap/grammar_checker.py missing"
    assert (d / "grammar_data.py").is_file(), "backend/assets/grammar-mindmap/grammar_data.py missing"
    # The Railway image contains only backend/; the asset must live inside it.
    backend_root = Path(__file__).resolve().parent.parent
    assert d.is_relative_to(backend_root), "grammar asset must live under backend/ to be deployed"
    from services.grammar_check import _ASSET_DIR
    assert _ASSET_DIR.resolve() == d.resolve()


def test_real_asset_local_rules_catch_known_bad_transcript():
    """L11 with the REAL asset: the VI-learner regex layer must import and
    flag a subject-verb-agreement error without Java or any stub."""
    for name in ("grammar_checker", "grammar_data"):
        sys.modules.pop(name, None)
    svc = GrammarCheckService()
    svc._ensure_asset_on_path()
    import grammar_checker as gc  # noqa: E402 — real asset, no stub
    findings = gc.run_local_rules("She go to school every day.")
    assert findings, "real asset returned no local findings for a known-bad transcript"
    assert all("offset" in f and "errorLength" in f for f in findings)


def test_backend_rejected_when_asset_starts_in_online_mode():
    """Privacy: an LTBackend that could only start its online path is refused
    and reported as languagetool_offline_unavailable."""
    fake_mod = MagicMock()
    backend = MagicMock()
    backend.mode = "online"
    fake_mod.LTBackend.return_value = backend
    with patch.dict(sys.modules, {"grammar_checker": fake_mod}):
        svc = GrammarCheckService()
        assert svc._ensure_backend() is None
    assert svc._backend_init_failed is True
    assert svc._backend_init_reason == "languagetool_offline_unavailable"


def test_offline_backend_has_online_fallback_disabled():
    """Privacy: the accepted offline instance gets its _check_online replaced
    so a mid-call flip cannot POST the transcript to api.languagetool.org."""
    fake_mod = MagicMock()
    backend = MagicMock()
    backend.mode = "offline"
    fake_mod.LTBackend.return_value = backend
    with patch.dict(sys.modules, {"grammar_checker": fake_mod}):
        svc = GrammarCheckService()
        got = svc._ensure_backend()
    assert got is backend
    with pytest.raises(RuntimeError, match="online fallback is disabled"):
        got._check_online("any transcript")


def test_run_sync_retires_backend_that_flipped_to_online():
    """If the asset flips to online mid-call, its findings are dropped and the
    backend is retired so later requests stay local-only."""
    local = [_finding(rule_id="LOCAL_MISSING_SUBJECT", offset=0, err_len=2)]
    fake_mod = MagicMock()
    fake_mod.run_local_rules.return_value = local
    fake_mod.merge_findings.side_effect = lambda text, lt, loc: list(lt) + list(loc)
    backend = MagicMock()
    backend.mode = "offline"

    def _flip(text):
        backend.mode = "online"
        return [_finding(rule_id="LT_RULE", category="GRAMMAR", offset=5, err_len=2)]

    backend.check.side_effect = _flip
    fake_mod.LTBackend.return_value = backend
    with patch.dict(sys.modules, {"grammar_checker": fake_mod}):
        svc = GrammarCheckService()
        result = svc._run_sync("He go to school.")
    assert svc._backend is None
    assert svc._backend_init_reason == "languagetool_offline_unavailable"
    # merge_findings received an empty LT list — only the local finding survives.
    assert result.total_count == 1
    assert result.errors[0].category == "missing_subject"


def test_module_not_found_is_reported_as_asset_missing():
    """Health must say the asset is missing, not blame the JRE."""
    import builtins
    real_import = builtins.__import__

    def _no_asset(name, *a, **kw):
        if name == "grammar_checker":
            raise ModuleNotFoundError("No module named 'grammar_checker'", name="grammar_checker")
        return real_import(name, *a, **kw)

    sys.modules.pop("grammar_checker", None)
    with patch("builtins.__import__", side_effect=_no_asset):
        svc = GrammarCheckService()
        assert svc._ensure_backend() is None
    assert svc._backend_init_reason == "asset_missing"


def test_health_message_distinguishes_asset_missing(monkeypatch):
    svc = GrammarCheckService()
    svc._backend_init_failed = True
    svc._backend_init_reason = "asset_missing"
    monkeypatch.setattr(grammar_check, "get_grammar_check_service", lambda: svc)
    monkeypatch.setattr(svc, "check", AsyncMock(return_value=None))
    monkeypatch.setattr(svc, "_ensure_backend", lambda: None)
    out = asyncio.run(grammar_check.grammar_check_health())
    assert out["status"] == "degraded"
    assert out["init_failure_reason"] == "asset_missing"
    assert "assets/grammar-mindmap" in out["messages"][0]
    assert "JRE" not in out["messages"][0]


def test_real_asset_rule_ids_map_to_taxonomy():
    """The committed asset's LOCAL_ ids must not all collapse into the generic
    'grammar' bucket — severity ranking depends on the taxonomy key."""
    for name in ("grammar_checker", "grammar_data"):
        sys.modules.pop(name, None)
    GrammarCheckService()._ensure_asset_on_path()
    import grammar_checker as gc  # noqa: E402
    cases = {
        "She go to school every day.":  "subject_verb_agreement",
        "They was happy yesterday.":    "subject_verb_agreement",
        "Yesterday I go to the market.": "tense",
        "I can to swim.":               "verb_form",
        "I beautiful.":                 "copula",
    }
    for sentence, expected in cases.items():
        findings = gc.run_local_rules(sentence)
        assert findings, sentence
        assert expected in {_categorise(f) for f in findings}, (sentence, [f["ruleId"] for f in findings])


# ── Local-rule false-positive suppression (PR #1690 review) ──────────────────


def _real_local(sentence: str) -> list[dict]:
    for name in ("grammar_checker", "grammar_data"):
        sys.modules.pop(name, None)
    GrammarCheckService()._ensure_asset_on_path()
    import grammar_checker as gc  # noqa: E402
    return grammar_check._suppress_local_false_positives(sentence, gc.run_local_rules(sentence))


@pytest.mark.parametrize("sentence", [
    "I know where she is going.",
    "I like what you do.",
    "Tell me what you are doing.",
    "She asked me why I was late. I told her the truth.",
    "What she does is important.",  # declarative subject clause
    "Where he lives doesn't matter. What I did was wrong.",
])
def test_embedded_clauses_do_not_trigger_question_inversion(sentence):
    assert not [f for f in _real_local(sentence) if f["ruleId"] == "LOCAL_QUESTION_WORD_S_AUX_SHOULD_INVERT"], sentence


@pytest.mark.parametrize("sentence", [
    "Where you are going?",
    "What you are doing?",
    "I was tired. Where you are going?",
    "Where you are going",  # speech transcript without the question mark
    "What she does?",
    "What you are doing is that?",
])
def test_direct_questions_still_trigger_question_inversion(sentence):
    assert [f for f in _real_local(sentence) if f["ruleId"] == "LOCAL_QUESTION_WORD_S_AUX_SHOULD_INVERT"], sentence


@pytest.mark.parametrize("sentence", [
    "I appreciate your kind words.",
    "Your beautiful garden is lovely.",
    "Thank you for your amazing support.",
])
def test_possessive_noun_phrases_do_not_trigger_your_youre(sentence):
    assert not [f for f in _real_local(sentence) if f["ruleId"] == "LOCAL_YOUR_WELCOME_ADJ_SHOULD_BE_YOU_RE"], sentence


@pytest.mark.parametrize("sentence", [
    "Your welcome to come.",
    "Your right about that.",
    "Your so kind.",
    "I think your amazing.",
])
def test_contraction_slips_still_trigger_your_youre(sentence):
    assert [f for f in _real_local(sentence) if f["ruleId"] == "LOCAL_YOUR_WELCOME_ADJ_SHOULD_BE_YOU_RE"], sentence


_RULE_IF_WILL = "LOCAL_IF_CLAUSE_WITH_WILL_TYPE_1"
_RULE_PAST_MARKER = "LOCAL_PAST_TIME_MARKER_PRESENT_VERB"


@pytest.mark.parametrize("sentence, rule_id", [
    ("I wonder if he will come.", _RULE_IF_WILL),
    ("I'm not sure if she will agree.", _RULE_IF_WILL),
    ("Can you ask him if he will be there?", _RULE_IF_WILL),
    ("Since last year I have lived here.", _RULE_PAST_MARKER),
    ("In the last year I have been very busy.", _RULE_PAST_MARKER),
    ("in the last year I have lived here", _RULE_PAST_MARKER),
    ("Over the last year I have worked hard.", _RULE_PAST_MARKER),
    ("For the last week I have studied every day.", _RULE_PAST_MARKER),
    ("Since last year I have always been busy.", _RULE_PAST_MARKER),
    ("Since last month we have taken three tests.", _RULE_PAST_MARKER),
    ("Since last year I have worked here.", _RULE_PAST_MARKER),
    ("Since last year we have grown a lot.", _RULE_PAST_MARKER),
])
def test_asset_rules_skip_embedded_if_and_present_perfect(sentence, rule_id):
    assert not [f for f in _real_local(sentence) if f["ruleId"] == rule_id], sentence


@pytest.mark.parametrize("sentence, rule_id", [
    ("If it will rain tomorrow, I stay home.", _RULE_IF_WILL),
    ("If it will rain, I will stay home.", _RULE_IF_WILL),
    ("Yesterday I go to the market.", _RULE_PAST_MARKER),
    ("Last year I have a dog.", _RULE_PAST_MARKER),
    # Present perfect is incompatible with a finished-past marker.
    ("Yesterday I have eaten lunch.", _RULE_PAST_MARKER),
    ("Last year I have worked in London.", _RULE_PAST_MARKER),
    # A since-/in-the-phrase only exempts a real present-perfect clause
    # (Codex review on #1702).
    ("Since last year I live here.", _RULE_PAST_MARKER),
    ("Since last month we work together.", _RULE_PAST_MARKER),
    ("Since last year I have a dog.", _RULE_PAST_MARKER),
    ("In the last year I live in Hanoi.", _RULE_PAST_MARKER),
    # Adjective / noun complements of possessive "have" are not participles.
    ("Since last year I have red hair.", _RULE_PAST_MARKER),
    ("Since last year I have green eyes.", _RULE_PAST_MARKER),
    ("Since last month I have a golden ticket.", _RULE_PAST_MARKER),
])
def test_asset_rules_still_flag_conditional_will_and_past_marker(sentence, rule_id):
    assert [f for f in _real_local(sentence) if f["ruleId"] == rule_id], sentence


def test_health_probe_counts_local_rule_errors_without_languagetool(monkeypatch):
    """The CI smoke gate asserts sample_error_count > 0 on staging, where the
    offline LanguageTool server may be absent. The probe sample must therefore
    contain an error the real asset's local rules catch on their own."""
    for name in ("grammar_checker", "grammar_data"):
        sys.modules.pop(name, None)
    svc = GrammarCheckService()
    svc._ensure_asset_on_path()
    svc._backend_init_failed = True
    svc._backend_init_reason = "languagetool_offline_unavailable"
    monkeypatch.setattr(grammar_check, "get_grammar_check_service", lambda: svc)
    monkeypatch.setattr(grammar_check, "_read_cache", lambda *_a, **_k: None, raising=False)
    monkeypatch.setattr(grammar_check, "_write_cache", lambda *_a, **_k: None, raising=False)
    out = asyncio.run(grammar_check.grammar_check_health())
    assert out["init_failure_reason"] == "languagetool_offline_unavailable"
    assert out["sample_error_count"] > 0, out
