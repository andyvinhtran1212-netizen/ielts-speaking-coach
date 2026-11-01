"""Tests for GeminiWritingGrader (Sprint W1 Phase 3).

All tests mock the Gemini SDK — no real network IO. Smoke test against the
live API lives at tests/smoke/test_gemini_smoke.py and is opt-in via
`pytest -m smoke`.
"""

import json
from unittest.mock import patch

import pytest

from models.writing_feedback import GraderConfig
from services.gemini_writing_grader import (
    AISafetyBlockError,
    APIRetryFailedError,
    GeminiWritingGrader,
    InvalidJSONError,
    MODEL_PRICING,
)


# Reusable Gemini-shaped JSON payload that satisfies WritingFeedback
VALID_FEEDBACK = {
    "overallBandScore": 6.5,
    "overallBandScoreSummary": "Bài đạt mức Band 6.5",
    "keyTakeaways": {
        "strengths": ["Diễn đạt rõ ràng"],
        "areasForImprovement": ["Cần đa dạng cấu trúc câu"],
    },
    "criteriaFeedback": {
        "mainCriterion":     {"title": "Task Response",       "explanation": "...", "feedback": "...", "bandScore": 6},
        "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "...", "feedback": "...", "bandScore": 6},
        "lexicalResource":   {"title": "Lexical Resource",     "explanation": "...", "feedback": "...", "bandScore": 7},
        "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "...", "feedback": "...", "bandScore": 6},
    },
    "mistakeAnalysis": [
        {
            "original":    "I has been study",
            "mistakeType": "Grammar",
            "explanation": "Sai trợ động từ và thể của 'study'",
            "suggestion":  "I have been studying",
            "criterion":   "Grammatical Range",
        }
    ],
    "aiContentAnalysis": {"likelihood": 5, "explanation": "Bài tự nhiên"},
    "improvedEssay": "Improved version of the essay…",
}


@pytest.fixture
def grader():
    """Grader with stubbed API key + genai.configure mocked."""
    with patch("services.gemini_writing_grader.settings") as mock_settings, \
         patch("services.gemini_writing_grader.genai.configure"):
        mock_settings.GEMINI_API_KEY = "test-key-fake"
        yield GeminiWritingGrader()


# ── grade_essay happy path ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_grade_essay_returns_valid_result(grader):
    """Mocked Gemini call returns a parseable result."""
    json_payload = json.dumps(VALID_FEEDBACK)
    usage = {"input_tokens": 3000, "output_tokens": 2000}

    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        config = GraderConfig(
            task_type="task2",
            prompt_text="Some prompt",
            essay_text="Some essay",
            analysis_level=3,
        )
        result = await grader.grade_essay(config)

    assert result.feedback.overallBandScore == 6.5
    assert len(result.feedback.mistakeAnalysis) == 1
    assert result.model_used == "gemini-2.5-pro"
    assert result.tokens_input == 3000
    assert result.tokens_output == 2000
    assert result.cost_usd is not None
    assert result.grading_duration_ms >= 0
    # Default flipped to v2 (config.py, 2026-07-10 audit finding #1) → stamps
    # "v2.3". v1-stamping is still covered explicitly by
    # test_grade_essay_picks_up_version_change_without_restart below.
    assert result.prompt_version == "v2.3"


@pytest.mark.asyncio
async def test_grade_essay_safety_block_propagates(grader):
    """Safety block from inner call surfaces unchanged (no retry)."""
    with patch.object(
        grader, "_call_with_retry",
        side_effect=AISafetyBlockError("blocked"),
    ):
        config = GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
        )
        with pytest.raises(AISafetyBlockError):
            await grader.grade_essay(config)


@pytest.mark.asyncio
async def test_grade_essay_retry_failure_propagates(grader):
    """APIRetryFailedError from inner call surfaces unchanged."""
    with patch.object(
        grader, "_call_with_retry",
        side_effect=APIRetryFailedError("3 retries failed"),
    ):
        config = GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
        )
        with pytest.raises(APIRetryFailedError):
            await grader.grade_essay(config)


# ── _parse_response defensive JSON extraction ────────────────────────

def test_parse_response_valid_json(grader):
    text = json.dumps(VALID_FEEDBACK)
    feedback = grader._parse_response(text)
    assert feedback.overallBandScore == 6.5


def test_parse_response_with_extra_text(grader):
    """Spec: extract outermost { … } even when Gemini wraps with prose."""
    text = "Here's the analysis:\n" + json.dumps(VALID_FEEDBACK) + "\nLet me know."
    feedback = grader._parse_response(text)
    assert feedback.overallBandScore == 6.5


def test_parse_response_no_json_raises(grader):
    with pytest.raises(InvalidJSONError):
        grader._parse_response("This is not JSON")


def test_parse_response_invalid_schema_raises(grader):
    """Valid JSON but missing required fields → InvalidJSONError."""
    text = json.dumps({"overallBandScore": 7.0})
    with pytest.raises(InvalidJSONError):
        grader._parse_response(text)


def test_parse_response_coerces_bare_list_wrapped_fields(grader):
    """Gemini sometimes drops the wrapper and emits sentenceStructureAnalysis /
    lexicalAnalysis as a bare list. The parser wraps it back into the canonical
    dict so a shape slip doesn't sink the whole grading (W-L3 hardening; the
    field turned on at L3, but L4/L5 had the same latent risk)."""
    payload = dict(VALID_FEEDBACK)
    payload["sentenceStructureAnalysis"] = [
        {"original": "A. B.", "rewritten": "A, which B.", "explanation": "combine"}
    ]
    payload["lexicalAnalysis"] = [
        {"original": "good", "context": "good idea", "suggestions": ["sound", "valid", "cogent"],
         "category": "Generic adjective"}
    ]
    # Both fields would raise a dict_type / model ValidationError pre-coercion;
    # success here means the bare list was wrapped before validation.
    feedback = grader._parse_response(json.dumps(payload))
    # sentenceStructureAnalysis is Optional[dict] — stays a wrapped dict.
    assert feedback.sentenceStructureAnalysis["sentenceUpgrades"][0]["original"] == "A. B."
    # lexicalAnalysis is a typed LexicalAnalysis model after validation.
    assert feedback.lexicalAnalysis.wordsToUpgrade[0].original == "good"


# ── _calculate_cost (planner-verified pricing) ───────────────────────

def test_calculate_cost_pro_model(grader):
    """gemini-2.5-pro: 3000 input @ $1.25/M + 2000 output @ $10/M."""
    cost = grader._calculate_cost("gemini-2.5-pro", tokens_in=3000, tokens_out=2000)
    expected = (3000 / 1_000_000) * 1.25 + (2000 / 1_000_000) * 10.00
    assert abs(cost - expected) < 1e-6


def test_calculate_cost_flash_model(grader):
    """gemini-2.5-flash: 3000 input @ $0.30/M + 2000 output @ $2.50/M."""
    cost = grader._calculate_cost("gemini-2.5-flash", tokens_in=3000, tokens_out=2000)
    expected = (3000 / 1_000_000) * 0.30 + (2000 / 1_000_000) * 2.50
    assert abs(cost - expected) < 1e-6


def test_calculate_cost_unknown_model_returns_none(grader):
    assert grader._calculate_cost("gpt-4", tokens_in=3000, tokens_out=2000) is None


def test_calculate_cost_missing_tokens_returns_none(grader):
    assert grader._calculate_cost("gemini-2.5-pro", tokens_in=None, tokens_out=2000) is None
    assert grader._calculate_cost("gemini-2.5-pro", tokens_in=3000, tokens_out=None) is None


def test_pricing_table_has_all_selectable_models(grader):
    """Pricing table must cover every selectable model — pricing is required
    for cost telemetry; a missing entry silently returns None cost."""
    assert "gemini-2.5-pro" in MODEL_PRICING
    assert "gemini-2.5-flash" in MODEL_PRICING
    assert "gemini-3.5-flash" in MODEL_PRICING  # W-MM step 0 — observation option
    assert "gemini-3.8-flash" in MODEL_PRICING
    for model, prices in MODEL_PRICING.items():
        assert "input" in prices and "output" in prices
        assert prices["input"] > 0 and prices["output"] > 0


def test_calculate_cost_gemini_3_5_flash(grader):
    """gemini-3.5-flash: 3000 input @ $1.50/M + 2000 output @ $9.00/M."""
    cost = grader._calculate_cost("gemini-3.5-flash", tokens_in=3000, tokens_out=2000)
    expected = (3000 / 1_000_000) * 1.50 + (2000 / 1_000_000) * 9.00
    assert abs(cost - expected) < 1e-6


def test_usage_metadata_folds_thinking_into_output(grader):
    """Gemini thinking tokens are billed as output but reported separately —
    _usage_from_metadata folds thoughts_token_count into output_tokens so cost
    isn't understated for thinking-by-default models (e.g. 3.5 Flash)."""
    from types import SimpleNamespace
    um = SimpleNamespace(prompt_token_count=3000, candidates_token_count=2000,
                         thoughts_token_count=500)
    usage = grader._usage_from_metadata(um)
    assert usage["input_tokens"] == 3000
    assert usage["output_tokens"] == 2500      # 2000 candidates + 500 thinking
    assert usage["thinking_tokens"] == 500


def test_usage_metadata_no_thinking_field(grader):
    """No thinking (field absent or None) → output = candidates; None → {}."""
    from types import SimpleNamespace
    um = SimpleNamespace(prompt_token_count=1000, candidates_token_count=800)
    usage = grader._usage_from_metadata(um)
    assert usage["output_tokens"] == 800
    assert usage["thinking_tokens"] == 0
    assert grader._usage_from_metadata(None) == {}


def test_grader_config_accepts_gemini_3_5_flash():
    """GraderConfig must accept gemini-3.5-flash as a selectable model
    (W-MM step 0). Pin so a Literal narrowing can't silently drop it."""
    cfg = GraderConfig(
        task_type="task2", prompt_text="p", essay_text="e", analysis_level=3,
        selected_model="gemini-3.5-flash",
    )
    assert cfg.selected_model == "gemini-3.5-flash"


def test_grader_config_accepts_gemini_3_8_flash():
    cfg = GraderConfig(
        task_type="task2", prompt_text="p", essay_text="e", analysis_level=3,
        selected_model="gemini-3.8-flash",
    )
    assert cfg.selected_model == "gemini-3.8-flash"


# ── Phase 1.5a: history injection in user prompt ─────────────────────


def test_build_user_prompt_injects_authoritative_word_count(grader):
    """Bug-2 fix: the prompt carries the backend-computed word count and
    tells the model NOT to self-count, so Rule 2 caps apply to the real
    number (LLM self-counting under-counts → unfair Task Response penalty)."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="one two three four five",
        analysis_level=3,
        word_count=287,
    )
    prompt = grader._build_user_prompt(config)
    assert "287 từ" in prompt
    assert "Số từ (đã đếm chính xác)" in prompt
    assert "không tự đếm" in prompt.lower()


def test_build_user_prompt_word_count_falls_back_to_split(grader):
    """A direct caller that omits word_count (None) still gets a count —
    the builder splits essay_text itself, so the LLM is never asked to
    self-count."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="alpha beta gamma delta",   # 4 words
        analysis_level=3,
        word_count=None,
    )
    prompt = grader._build_user_prompt(config)
    assert "4 từ" in prompt


def test_build_user_prompt_omits_history_when_none(grader):
    """No history → prompt has only essay sections, no Vietnamese
    history block. Pinning this protects the new-student path
    (<5 essays) from accidentally getting a polluted prompt."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history=None,
    )
    prompt = grader._build_user_prompt(config)
    assert "Lịch sử lỗi" not in prompt
    assert "recurringPatterns" not in prompt


def test_build_user_prompt_injects_history_when_present(grader):
    """Patterns dict via config.history → prompt includes the
    Vietnamese block + the recurringPatterns output schema instruction
    so Gemini knows what shape to emit.

    Phase 1.5b: heading is now "Lịch sử của học viên này" (broader,
    covers both patterns + trajectory). The patterns block sits under
    the "### Lỗi LẶP LẠI" sub-heading.
    """
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history={
            "essays_analyzed": 5,
            "patterns": [
                {"mistakeType": "Grammar - Article", "count": 7,
                 "examples": ["the others"], "criterion": "GRA"},
            ],
        },
    )
    prompt = grader._build_user_prompt(config)
    assert "Lịch sử của học viên" in prompt
    assert "Lỗi LẶP LẠI" in prompt
    assert "Grammar - Article" in prompt
    assert "(7x)" in prompt
    assert "recurringPatterns" in prompt
    # Essay sections still come AFTER the history block.
    assert prompt.index("Lịch sử của học viên") < prompt.index("Bài viết của học viên")


# ── Sprint 2.6.1 — version routing pinning ──────────────────────────
#
# RED finding from Sprint 2.6 audit (2026-05-07): the grader cached
# `prompt_loader = get_prompt_loader()` at __init__, but `get_grader()`
# is a process-wide singleton — so flipping
# `WRITING_PROMPT_VERSION` on Railway had no effect until the next
# process restart, defeating the documented A/B hot-flip contract.
# These tests pin: (1) env-var change mid-process flips the stamp,
# (2) the stamp matches the loader actually used (no drift between
# prompt sent and version recorded).


@pytest.fixture
def reset_loader_cache():
    """Clear the per-version singleton cache so the test's
    monkeypatched WRITING_PROMPT_VERSION drives fresh resolution.
    Without this, an earlier test could have populated the cache and
    masked a regression where the grader still bypasses the env var."""
    import services.writing_prompt_loader as wpl
    saved = dict(wpl._loader_instances)
    wpl._loader_instances.clear()
    yield
    wpl._loader_instances.clear()
    wpl._loader_instances.update(saved)


@pytest.mark.asyncio
async def test_grade_essay_picks_up_version_change_without_restart(
    grader, monkeypatch, reset_loader_cache,
):
    """Sprint 2.6.1: a mid-process WRITING_PROMPT_VERSION flip must
    take effect on the very next grade_essay() call. Pin against
    regression where the grader caches the loader at __init__."""
    from config import settings

    json_payload = json.dumps(VALID_FEEDBACK)
    usage = {"input_tokens": 1, "output_tokens": 1}

    config = GraderConfig(
        task_type="task2", prompt_text="P", essay_text="E", analysis_level=1,
    )

    # First call: env=v1 → stamp v1.1
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v1")
    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        result_v1 = await grader.grade_essay(config)
    assert result_v1.prompt_version == "v1.1", (
        f"Expected v1.1, got {result_v1.prompt_version}"
    )

    # Flip env var (simulates Railway env update without redeploy).
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    # Same grader instance, but next call must pick up v2.
    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        result_v2 = await grader.grade_essay(config)
    # Stamp value moved to v2.2 for source grounding and v2.3 for the
    # mistakeAnalysis minimum below band 8.5;
    # the env-flip behaviour pinned by this test is independent of which
    # specific stamp v2 maps to today.
    assert result_v2.prompt_version == "v2.3", (
        f"Expected v2.3 after env flip, got {result_v2.prompt_version}. "
        f"Likely regression: grader cached loader at __init__."
    )


@pytest.mark.asyncio
async def test_grade_essay_stamp_matches_loader_used(
    grader, monkeypatch, reset_loader_cache,
):
    """Defensive: stamp comes from the same loader that produced the
    prompt, not a separate read of settings. Prevents future drift
    where the prompt is v1 but the recorded version is v2."""
    from config import settings
    import services.writing_prompt_loader as wpl

    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    json_payload = json.dumps(VALID_FEEDBACK)
    usage = {"input_tokens": 1, "output_tokens": 1}

    config = GraderConfig(
        task_type="task2", prompt_text="P", essay_text="E", analysis_level=1,
    )
    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        result = await grader.grade_essay(config)

    # Stamp must equal the v2 loader's PROMPT_VERSION property — not
    # whatever the env happens to read at stamping time. The current
    # stamp is "v2.3" (grounding + mistake minimum); the
    # property-equality assertion above survives any future bump.
    assert result.prompt_version == wpl.get_prompt_loader(version="v2").PROMPT_VERSION
    assert result.prompt_version == "v2.3"


def test_build_user_prompt_injects_trajectory_when_present(grader):
    """Phase 1.5b: trajectory dict via config.trajectory → prompt
    includes the band-trajectory block + bandTrajectoryAnalysis output
    schema instruction. Patterns optional — this fixture exercises the
    trajectory-only path (e.g. a student with steady essays but no
    repeating mistake types)."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history=None,
        trajectory={
            "essays_analyzed":    5,
            "average_last_5":     6.5,
            "trend":              "improving",
            "trend_delta":        0.4,
            "criteria_breakdown": [
                {"criterion": "Task Response", "average": 7.0, "trend": "improving"},
            ],
        },
    )
    prompt = grader._build_user_prompt(config)
    assert "Diễn biến band điểm"     in prompt
    assert "6.5"                     in prompt
    assert "improving"               in prompt
    assert "Task Response"           in prompt
    assert "bandTrajectoryAnalysis"  in prompt
    assert "current_band"            in prompt


# ── Parse robustness (Claude has no JSON response mode) ──────────────

def test_parse_response_reads_a_fenced_object_with_a_trailing_note(grader):
    text = "```json\n" + json.dumps(VALID_FEEDBACK) + "\n```\n\nGhi chú: {không phải JSON}"
    assert grader._parse_response(text).overallBandScore == 6.5


def test_parse_response_accepts_a_raw_newline_inside_a_string(grader):
    text = json.dumps(VALID_FEEDBACK, ensure_ascii=False).replace(
        "Improved version of the essay…", "Paragraph one.\nParagraph two.")
    assert "Paragraph one.\nParagraph" in text          # a raw control character
    assert grader._parse_response(text).improvedEssay == "Paragraph one.\nParagraph two."


def test_parse_response_schema_error_names_fields_without_model_text(grader):
    data = json.loads(json.dumps(VALID_FEEDBACK))
    data["criteriaFeedback"]["mainCriterion"]["bandScore"] = "MODEL-WROTE-THIS"
    with pytest.raises(InvalidJSONError) as err:
        grader._parse_response(json.dumps(data))
    message = str(err.value)
    assert "criteriaFeedback.mainCriterion.bandScore: int_parsing" in message
    assert "MODEL-WROTE-THIS" not in message


# ── Claude attempt + grounding repair ────────────────────────────────

GROUNDED_ESSAY = "Governments should invest in dedicated bus lanes and employment centres."


GROUNDED_MISTAKE = {"original": "invest in dedicated bus lanes", "mistakeType": "Word Choice",
                    "explanation": "...", "suggestion": "invest heavily in dedicated bus lanes",
                    "criterion": "Lexical Resource"}


def _claude_feedback(claim: str, mistakes: list | None = None) -> str:
    data = json.loads(json.dumps(VALID_FEEDBACK))
    data["mistakeAnalysis"] = [GROUNDED_MISTAKE] if mistakes is None else mistakes
    data["criteriaFeedback"]["lexicalResource"]["feedback"] = claim
    return json.dumps(data)


GOOD_CLAUDE = _claude_feedback("Em dùng 'dedicated bus lanes' phù hợp.")
UNGROUNDED_CLAUDE = _claude_feedback("Em dùng 'subsidies' tự nhiên.")


@pytest.fixture
def writing_providers(monkeypatch):
    """Fake Claude + Gemini behind the real grader, router and ledger calls."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from config import settings as real_settings
    from services import ai_router, ai_usage_logger
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setattr(real_settings, "AI_PROVIDER_ORDER", "anthropic,openai,gemini")
    monkeypatch.setattr(real_settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "")
    state = SimpleNamespace(claude=[], claude_requests=[], gemini=[GOOD_CLAUDE],
                            gemini_calls=[], rows=[])

    def capture(coro):
        kwargs = dict(coro.cr_frame.f_locals.get("kwargs") or {})
        kwargs.setdefault("service", "claude" if coro.cr_code.co_name == "log_claude_async"
                          else "gemini")
        state.rows.append(kwargs)
        coro.close()

    async def create(**request):
        state.claude_requests.append(request)
        item = state.claude.pop(0)
        if callable(item):
            return await item()
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=item)], stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=700, output_tokens=6000,
                                  cache_read_input_tokens=0, cache_creation_input_tokens=0),
        )

    def generate(contents, **_kw):
        state.gemini_calls.append(contents)
        text = state.gemini[min(len(state.gemini_calls), len(state.gemini)) - 1]
        if isinstance(text, Exception):
            raise text
        return SimpleNamespace(
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
            text=text, usage_metadata=None,
        )

    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", capture)
    monkeypatch.setattr(ai_router, "_client",
                        lambda *_a, **_k: SimpleNamespace(messages=SimpleNamespace(create=create)))
    monkeypatch.setattr(gwg.genai, "configure", lambda **_kw: None)
    monkeypatch.setattr(gwg.genai, "GenerativeModel",
                        MagicMock(return_value=MagicMock(generate_content=generate)))
    monkeypatch.setattr(gwg.asyncio, "sleep", AsyncMock())
    state.grader = gwg.GeminiWritingGrader(api_key="test-gemini")
    return state


def _grounded_config() -> GraderConfig:
    return GraderConfig(task_type="task2", prompt_text="Transport", essay_text=GROUNDED_ESSAY,
                        analysis_level=3, selected_model="gemini-3.8-flash",
                        usage_event_prefix="writing:test")


def _claude_user_text(request: dict) -> str:
    return request["messages"][0]["content"]


@pytest.mark.asyncio
async def test_claude_ungrounded_answer_is_repaired_on_claude(writing_providers):
    state = writing_providers
    state.claude = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())

    assert result.model_used == "claude-sonnet-5-5"
    assert state.gemini_calls == []
    first, repair = (_claude_user_text(r) for r in state.claude_requests)
    assert "Regenerate the complete" not in first
    assert repair.startswith(first) and "Regenerate the complete" in repair
    assert "subsidies" in repair                    # the unsupported citation is named
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["status"] for r in claude_rows] == ["invalid_response", "success"]
    assert claude_rows[0]["error_code"] == "ungrounded_feedback"
    assert claude_rows[0]["metadata"]["error_detail"].startswith("Unsupported essay citations at")
    assert [r["usage_event_id"] for r in claude_rows] == [
        "writing:test:pass1:anthropic:1", "writing:test:pass1:anthropic:2"]
    assert len(state.rows) == 2
    assert "subsidies" not in json.dumps(state.rows, default=str)


@pytest.mark.asyncio
async def test_claude_failing_twice_leaves_the_gemini_loop_unchanged(writing_providers, monkeypatch):
    state = writing_providers
    state.gemini = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]     # Gemini needs its own repair too

    # Baseline: Gemini-only grading of the same essay.
    from config import settings as real_settings
    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "")
    baseline = await state.grader.grade_essay(_grounded_config())
    baseline_calls = list(state.gemini_calls)
    state.gemini_calls.clear()
    state.rows.clear()

    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "test-anthropic-key")
    state.claude = [UNGROUNDED_CLAUDE, UNGROUNDED_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())

    assert len(state.claude_requests) == 2
    assert result.model_used == baseline.model_used == "gemini-3.8-flash"
    assert state.gemini_calls == baseline_calls and len(baseline_calls) == 2
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["error_code"] for r in claude_rows] == ["ungrounded_feedback"] * 2
    assert [r["usage_event_id"] for r in claude_rows] == [
        "writing:test:pass1:anthropic:1", "writing:test:pass1:anthropic:2"]


@pytest.mark.asyncio
async def test_claude_invalid_json_is_not_re_asked(writing_providers):
    state = writing_providers
    state.claude = ['{"overallBandScore": 6.5, "keyTakeaways": {"strengths": []} "truncated']
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.claude_requests) == 1
    assert result.model_used == "gemini-3.8-flash" and len(state.gemini_calls) == 1
    claude_row = next(r for r in state.rows if r["service"] == "claude")
    assert claude_row["error_code"] == "invalid_json"
    assert claude_row["metadata"]["error_detail"].startswith("JSON parse failed:")


@pytest.mark.asyncio
async def test_claude_repair_needs_budget_left(writing_providers, monkeypatch):
    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(gwg, "CLAUDE_TOTAL_BUDGET_S", gwg.CLAUDE_REPAIR_MIN_S - 1)
    state.claude = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.claude_requests) == 1
    assert result.model_used == "gemini-3.8-flash"


@pytest.mark.asyncio
async def test_claude_repair_is_cut_off_at_the_budget(writing_providers, monkeypatch):
    import asyncio

    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(gwg, "CLAUDE_REPAIR_MIN_S", 0.0)
    monkeypatch.setattr(gwg, "CLAUDE_TOTAL_BUDGET_S", 0.2)

    async def hang():
        await asyncio.Event().wait()

    state.claude = [UNGROUNDED_CLAUDE, hang]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.claude_requests) == 2
    assert result.model_used == "gemini-3.8-flash" and len(state.gemini_calls) == 1
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["status"] for r in claude_rows] == ["invalid_response", "cancelled"]


# ── PC-J164: run cost counts every billed call, served model is truthful ──

# claude-sonnet-5-5: $2 / M input, $10 / M output.
def _sonnet_cost(tokens_in: int, tokens_out: int) -> float:
    return tokens_in * 2 / 1e6 + tokens_out * 10 / 1e6


def _claude_reply(text: str, tokens_in: int, tokens_out: int):
    from types import SimpleNamespace

    async def reply():
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=tokens_in, output_tokens=tokens_out,
                                  cache_read_input_tokens=0, cache_creation_input_tokens=0),
        )
    return reply


@pytest.mark.asyncio
async def test_single_accepted_call_costs_that_call(writing_providers):
    state = writing_providers
    state.claude = [GOOD_CLAUDE]                        # 700 in / 6000 out
    result = await state.grader.grade_essay(_grounded_config())

    assert result.model_used == "claude-sonnet-5-5"
    assert result.cost_usd == pytest.approx(_sonnet_cost(700, 6000))
    assert [(a["provider"], a["status"], a["served"]) for a in result.grading_attempts] == [
        ("anthropic", "success", True)]


@pytest.mark.asyncio
async def test_rejected_then_accepted_cost_is_the_sum_of_both_calls(writing_providers):
    state = writing_providers
    state.claude = [_claude_reply(UNGROUNDED_CLAUDE, 900, 9000),
                    _claude_reply(GOOD_CLAUDE, 700, 6000)]
    result = await state.grader.grade_essay(_grounded_config())

    rejected, accepted = _sonnet_cost(900, 9000), _sonnet_cost(700, 6000)
    assert result.model_used == "claude-sonnet-5-5"
    assert result.cost_usd == pytest.approx(rejected + accepted)
    # Tokens still describe the served answer; the breakdown has both calls.
    assert (result.tokens_input, result.tokens_output) == (700, 6000)
    first, second = result.grading_attempts
    assert (first["status"], first["error_code"], first["served"]) == (
        "invalid_response", "ungrounded_feedback", False)
    assert first["cost_usd"] == pytest.approx(rejected)
    assert first["pass"] == "pass1" and first["model"] == "claude-sonnet-5-5"
    assert (second["status"], second["served"]) == ("success", True)
    assert second["cost_usd"] == pytest.approx(accepted)
    assert "subsidies" not in json.dumps(result.grading_attempts)


@pytest.mark.asyncio
async def test_provider_fallback_records_the_serving_model_and_every_call(writing_providers):
    from types import SimpleNamespace

    from services.gemini_writing_grader import MODEL_PRICING

    state = writing_providers
    state.claude = [_claude_reply(UNGROUNDED_CLAUDE, 900, 9000),
                    _claude_reply(UNGROUNDED_CLAUDE, 800, 8000)]
    gemini_usage = SimpleNamespace(prompt_token_count=1000, candidates_token_count=4000,
                                   thoughts_token_count=0, total_token_count=5000)

    def generate(contents, **_kw):
        state.gemini_calls.append(contents)
        return SimpleNamespace(
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
            text=GOOD_CLAUDE, usage_metadata=gemini_usage,
        )

    from services import gemini_writing_grader as gwg
    gwg.genai.GenerativeModel.return_value.generate_content = generate
    config = _grounded_config()
    result = await state.grader.grade_essay(config)

    rate = MODEL_PRICING["gemini-3.8-flash"]
    gemini_cost = 1000 * rate["input"] / 1e6 + 4000 * rate["output"] / 1e6
    assert config.selected_model == "gemini-3.8-flash"
    assert result.model_used == "gemini-3.8-flash"          # Gemini served after Claude failed
    assert result.cost_usd == pytest.approx(
        _sonnet_cost(900, 9000) + _sonnet_cost(800, 8000) + gemini_cost)
    assert [(a["provider"], a["model"], a["status"], a["served"])
            for a in result.grading_attempts] == [
        ("anthropic", "claude-sonnet-5-5", "invalid_response", False),
        ("anthropic", "claude-sonnet-5-5", "invalid_response", False),
        ("google", "gemini-3.8-flash", "success", True),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("intervening_api_error", [False, True])
async def test_gemini_text_accessor_error_preserves_billed_usage(
    writing_providers, monkeypatch, intervening_api_error,
):
    from types import SimpleNamespace

    from config import settings as real_settings
    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "")

    class NoTextResponse:
        candidates = [SimpleNamespace(finish_reason=SimpleNamespace(name="MAX_TOKENS"))]
        usage_metadata = SimpleNamespace(
            prompt_token_count=900, candidates_token_count=0,
            thoughts_token_count=9000, total_token_count=9900,
        )

        @property
        def text(self):
            raise ValueError("MAX_TOKENS response has no text parts")

    responses = [NoTextResponse()]
    if intervening_api_error:
        responses.append(RuntimeError("Gemini unavailable before returning a response"))
    responses.append(SimpleNamespace(
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        text=GOOD_CLAUDE,
        usage_metadata=SimpleNamespace(
            prompt_token_count=700, candidates_token_count=6000,
            thoughts_token_count=0, total_token_count=6700,
        ),
    ))

    def generate(contents, **_kw):
        state.gemini_calls.append(contents)
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    gwg.genai.GenerativeModel.return_value.generate_content = generate
    result = await state.grader.grade_essay(_grounded_config())

    rate = MODEL_PRICING["gemini-3.8-flash"]
    rejected_cost = (900 * rate["input"] + 9000 * rate["output"]) / 1e6
    accepted_cost = (700 * rate["input"] + 6000 * rate["output"]) / 1e6
    assert result.cost_usd == pytest.approx(rejected_cost + accepted_cost)
    assert result.model_used == "gemini-3.8-flash"
    assert (result.tokens_input, result.tokens_output) == (700, 6000)
    expected_statuses = ["error"] * (1 + intervening_api_error) + ["success"]
    assert [a["status"] for a in result.grading_attempts] == expected_statuses
    first, last = result.grading_attempts[0], result.grading_attempts[-1]
    assert (first["input_tokens"], first["output_tokens"]) == (900, 9000)
    assert first["error_code"] == "ValueError" and first["served"] is False
    assert first["cost_usd"] == pytest.approx(rejected_cost)
    assert last["cost_usd"] == pytest.approx(accepted_cost) and last["served"] is True

    rows = [r for r in state.rows if r["service"] == "gemini"]
    assert [r["status"] for r in rows] == expected_statuses
    assert [r["usage_event_id"] for r in rows] == [
        f"writing:test:pass1:api:{i + 1}" for i in range(len(expected_statuses))
    ]
    assert (rows[0]["input_tokens"], rows[0]["output_tokens"],
            rows[0]["thinking_tokens"]) == (900, 0, 9000)
    assert (rows[-1]["input_tokens"], rows[-1]["output_tokens"]) == (700, 6000)
    if intervening_api_error:
        # A failure before the next response must not reuse the prior usage.
        assert result.grading_attempts[1]["input_tokens"] is None
        assert result.grading_attempts[1]["output_tokens"] is None
        assert result.grading_attempts[1]["cost_usd"] is None
        assert rows[1].get("input_tokens") is None
        assert rows[1].get("output_tokens") is None
        assert rows[1].get("thinking_tokens") is None


# ── AIOPS-0024 FR-007: failure-log outcomes around the grounding repair ──


@pytest.fixture
def failure_rows(monkeypatch):
    from services import ai_failure_log

    rows: list[dict] = []
    monkeypatch.setattr(ai_failure_log, "schedule_usage_log",
                        lambda coro: (rows.append(coro.cr_frame.f_locals["row"]), coro.close()))
    return rows


def _outcomes(rows):
    return [(r["provider"], r["error_type"], r["outcome"]) for r in rows]


@pytest.mark.asyncio
async def test_failure_log_counts_a_successful_claude_repair_as_a_retry(writing_providers, failure_rows):
    state = writing_providers
    state.claude = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())
    assert result.model_used == "claude-sonnet-5-5"
    assert _outcomes(failure_rows) == [("anthropic", "invalid_json", "retry")]
    assert failure_rows[0]["model"] == "claude-sonnet-5-5"
    assert "subsidies" not in json.dumps(failure_rows)


@pytest.mark.asyncio
async def test_failure_log_with_claude_after_gemini_records_handover_then_retry(
    writing_providers, failure_rows, monkeypatch,
):
    from config import settings as real_settings

    state = writing_providers
    monkeypatch.setattr(real_settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "gemini,anthropic")
    state.gemini = [UNGROUNDED_CLAUDE]                  # every Gemini try is ungrounded
    state.claude = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())
    assert result.model_used == "claude-sonnet-5-5"
    assert _outcomes(failure_rows) == [
        ("gemini", "invalid_json", "fallback"),
        ("anthropic", "invalid_json", "retry"),
    ]


@pytest.mark.asyncio
async def test_failure_log_records_the_repair_budget_cut_off(writing_providers, failure_rows, monkeypatch):
    import asyncio

    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(gwg, "CLAUDE_REPAIR_MIN_S", 0.0)
    monkeypatch.setattr(gwg, "CLAUDE_TOTAL_BUDGET_S", 0.2)

    async def hang():
        await asyncio.Event().wait()

    state.claude = [UNGROUNDED_CLAUDE, hang]
    result = await state.grader.grade_essay(_grounded_config())
    assert result.model_used == "gemini-3.8-flash"
    assert _outcomes(failure_rows) == [
        ("anthropic", "invalid_json", "retry"),
        ("anthropic", "timeout", "fallback"),
    ]


# W-GROUND q-67 (owner decision 2026-10-28: keep the grading prompt
# unchanged). The L3+ prompt's sentence_structure.md example rewrite says
# "transferable skills"; Claude has credited 'transferable' to essays that
# never use it (live 72c07a2a, offline f02739d9). The validator must reject
# it and the one grounding-repair re-ask must serve a clean answer.
TRANSFERABLE_ESSAY = (
    "Remote work reduces burnout, while noisy open-plan offices distract staff. "
    "A hybrid model offers clear advantages for most companies."
)
TRANSFERABLE_MISTAKE = {"original": "offers clear advantages", "mistakeType": "Word Choice",
                        "explanation": "...", "suggestion": "brings tangible benefits",
                        "criterion": "Lexical Resource"}


@pytest.mark.asyncio
@pytest.mark.parametrize("claim", [
    # Offline f02739d9 r5 (Sonnet 5.5, current prompt), trimmed.
    "Từ vựng đủ rộng và dùng chính xác, có một số cụm tốt như 'remote work', "
    "'open-plan offices', 'transferable' ý nghĩa tương đương và 'burnout'.",
    # Live 72c07a2a shape: praised topic word.
    "Vốn từ đúng chủ đề: 'hybrid model', 'transferable' hợp ngữ cảnh.",
])
async def test_claude_transferable_prompt_example_is_rejected_then_re_asked(writing_providers, claim):
    state = writing_providers
    clean = "Vốn từ đúng chủ đề: 'remote work', 'hybrid model' hợp ngữ cảnh."
    state.claude = [_claude_feedback(claim, [TRANSFERABLE_MISTAKE]),
                    _claude_feedback(clean, [TRANSFERABLE_MISTAKE])]
    config = _grounded_config()
    config.essay_text = TRANSFERABLE_ESSAY
    result = await state.grader.grade_essay(config)

    # The word reaches Claude only through the L3 system prompt, never the essay.
    first, repair = state.claude_requests
    assert "transferable skills" in json.dumps(first["system"])
    assert "transferable" not in TRANSFERABLE_ESSAY.lower()

    assert result.model_used == "claude-sonnet-5-5" and state.gemini_calls == []
    assert result.feedback.criteriaFeedback.lexicalResource.feedback == clean
    assert "transferable" not in result.feedback.model_dump_json()
    assert "Regenerate the complete" in _claude_user_text(repair)
    assert "transferable" in _claude_user_text(repair)      # the unsupported citation is named
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["status"] for r in claude_rows] == ["invalid_response", "success"]
    assert claude_rows[0]["error_code"] == "ungrounded_feedback"
    assert claude_rows[0]["metadata"]["error_detail"].startswith(
        "Unsupported essay citations at criteriaFeedback.lexicalResource.feedback")
    assert [r["usage_event_id"] for r in claude_rows] == [
        "writing:test:pass1:anthropic:1", "writing:test:pass1:anthropic:2"]
    assert "transferable" not in json.dumps(state.rows, default=str)


def _claude_feedback_with_mistakes(originals: list[str]) -> str:
    data = json.loads(GOOD_CLAUDE)
    data["mistakeAnalysis"] = [
        {"original": o, "mistakeType": "Lexis", "explanation": "...",
         "suggestion": "A suggested rewrite.", "criterion": "Lexical Resource"}
        for o in originals
    ]
    return json.dumps(data)


def _config_with_essay_id() -> GraderConfig:
    config = _grounded_config()
    config.usage_resource_id = "essay-abc"
    return config


@pytest.mark.asyncio
async def test_claude_bounded_misquote_is_dropped_not_regraded(writing_providers):
    # Staging repro shape (a4eeb1b4): one mistakeAnalysis.original with an
    # invented subject among otherwise verbatim items.
    state = writing_providers
    state.claude = [_claude_feedback_with_mistakes(
        ["dedicated bus lanes", "it is employment centres", "Governments should invest"])]
    result = await state.grader.grade_essay(_config_with_essay_id())

    assert result.model_used == "claude-sonnet-5-5"
    assert len(state.claude_requests) == 1 and state.gemini_calls == []
    assert [m.original for m in result.feedback.mistakeAnalysis] == [
        "dedicated bus lanes", "Governments should invest"]
    (row,) = [r for r in state.rows if r["service"] == "claude"]
    assert row["status"] == "success"
    assert row["metadata"]["essay_id"] == "essay-abc"
    assert row["metadata"]["grounding_dropped"] == ["mistakeAnalysis[1]"]
    assert row["metadata"]["grounding_dropped_count"] == 1
    assert "it is employment" not in json.dumps(state.rows, default=str)


@pytest.mark.asyncio
async def test_claude_repair_rows_carry_essay_id_and_name_failed_citations(writing_providers):
    state = writing_providers
    state.claude = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    await state.grader.grade_essay(_config_with_essay_id())

    repair = _claude_user_text(state.claude_requests[1])
    assert '- criteriaFeedback.lexicalResource.feedback: "subsidies"' in repair
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["metadata"]["essay_id"] for r in claude_rows] == ["essay-abc", "essay-abc"]
    assert claude_rows[0]["metadata"]["error_detail"] == (
        "Unsupported essay citations at criteriaFeedback.lexicalResource.feedback")
    assert "grounding_dropped" not in claude_rows[1]["metadata"]


@pytest.mark.asyncio
async def test_gemini_rows_after_claude_fallback_carry_error_detail(writing_providers):
    state = writing_providers
    state.claude = [UNGROUNDED_CLAUDE, UNGROUNDED_CLAUDE]
    state.gemini = [UNGROUNDED_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_config_with_essay_id())

    assert result.model_used == "gemini-3.8-flash"
    gemini_rows = [r for r in state.rows if r["service"] == "gemini"]
    assert [r["status"] for r in gemini_rows] == ["invalid_response", "success"]
    assert gemini_rows[0]["error_code"] == "ungrounded_feedback"
    assert gemini_rows[0]["metadata"]["error_detail"].startswith("Unsupported essay citations at")
    assert all(r["metadata"]["essay_id"] == "essay-abc" for r in state.rows)


# ── mistakeAnalysis minimum below band 8.5 (missing_mistake_analysis) ─

EMPTY_CLAUDE = _claude_feedback("Em dùng 'dedicated bus lanes' phù hợp.", mistakes=[])
# Only a non-correction (original == suggestion): essay_service drops it, so
# it does not count as a real entry.
NONCORRECTION_CLAUDE = _claude_feedback("Em dùng 'dedicated bus lanes' phù hợp.", mistakes=[
    {**GROUNDED_MISTAKE, "suggestion": GROUNDED_MISTAKE["original"]}])


def _with_band(text: str, band: float) -> str:
    data = json.loads(text)
    data["overallBandScore"] = band
    return json.dumps(data)


@pytest.mark.asyncio
@pytest.mark.parametrize("first", [EMPTY_CLAUDE, NONCORRECTION_CLAUDE])
async def test_claude_empty_mistake_analysis_is_repaired_once_on_claude(writing_providers, first):
    state = writing_providers
    state.claude = [first, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_config_with_essay_id())

    assert result.model_used == "claude-sonnet-5-5" and state.gemini_calls == []
    assert len(result.feedback.mistakeAnalysis) == 1
    first_text, repair = (_claude_user_text(r) for r in state.claude_requests)
    assert repair.startswith(first_text) and "no usable mistakeAnalysis" in repair
    assert "INCLUDING the learner's errors" in repair
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert [r["status"] for r in claude_rows] == ["invalid_response", "success"]
    assert claude_rows[0]["error_code"] == "missing_mistake_analysis"
    assert claude_rows[0]["metadata"]["error_detail"] == (
        "mistakeAnalysis has no real correction at overallBandScore 6.5 (< 8.5)")
    assert "dedicated bus lanes" not in json.dumps(state.rows, default=str)


@pytest.mark.asyncio
@pytest.mark.parametrize("first", [EMPTY_CLAUDE, UNGROUNDED_CLAUDE])
async def test_claude_gets_at_most_one_repair_then_falls_back_to_gemini(writing_providers, first):
    state = writing_providers
    state.claude = [first, EMPTY_CLAUDE, GOOD_CLAUDE]       # a 3rd answer is never requested
    result = await state.grader.grade_essay(_grounded_config())

    assert len(state.claude_requests) == 2
    assert result.model_used == "gemini-3.8-flash" and len(state.gemini_calls) == 1
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert claude_rows[-1]["error_code"] == "missing_mistake_analysis"


@pytest.mark.asyncio
async def test_empty_mistake_analysis_is_accepted_at_band_8_5(writing_providers):
    state = writing_providers
    state.claude = [_with_band(EMPTY_CLAUDE, 8.5)]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.claude_requests) == 1 and result.model_used == "claude-sonnet-5-5"
    assert result.feedback.mistakeAnalysis == []
    (row,) = [r for r in state.rows if r["service"] == "claude"]
    assert row["status"] == "success" and "mistake_analysis_missing" not in row["metadata"]


@pytest.mark.asyncio
async def test_gemini_repairs_then_accepts_empty_mistakes_on_its_last_attempt(writing_providers, monkeypatch):
    from config import settings as real_settings
    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "")
    state.gemini = [EMPTY_CLAUDE]
    result = await state.grader.grade_essay(_config_with_essay_id())

    assert result.model_used == "gemini-3.8-flash"
    assert result.feedback.mistakeAnalysis == []                    # graded, not failed
    assert len(state.gemini_calls) == gwg.MAX_RETRIES               # no extra attempt
    assert "no usable mistakeAnalysis" not in state.gemini_calls[0]
    assert all("no usable mistakeAnalysis" in c for c in state.gemini_calls[1:])
    rows = [r for r in state.rows if r["service"] == "gemini"]
    assert [r["status"] for r in rows] == ["invalid_response", "invalid_response", "success"]
    assert [r.get("error_code") for r in rows[:2]] == ["missing_mistake_analysis"] * 2
    assert rows[2]["metadata"]["mistake_analysis_missing"] is True


@pytest.mark.asyncio
async def test_gemini_repair_that_lists_a_mistake_is_served(writing_providers, monkeypatch):
    from config import settings as real_settings

    state = writing_providers
    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "")
    state.gemini = [EMPTY_CLAUDE, GOOD_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.gemini_calls) == 2 and len(result.feedback.mistakeAnalysis) == 1


@pytest.mark.asyncio
async def test_gemini_returns_the_empty_answer_when_later_attempts_error(writing_providers, monkeypatch):
    from config import settings as real_settings
    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(real_settings, "ANTHROPIC_API_KEY", "")
    state.gemini = [EMPTY_CLAUDE, RuntimeError("503"), RuntimeError("503")]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.gemini_calls) == gwg.MAX_RETRIES
    assert result.model_used == "gemini-3.8-flash" and result.feedback.mistakeAnalysis == []


@pytest.mark.asyncio
async def test_claude_repair_failure_then_gemini_never_hard_fails_on_the_check(writing_providers):
    state = writing_providers
    state.claude = [EMPTY_CLAUDE, EMPTY_CLAUDE]
    state.gemini = [EMPTY_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())
    assert len(state.claude_requests) == 2
    assert result.model_used == "gemini-3.8-flash" and result.feedback.mistakeAnalysis == []


@pytest.mark.asyncio
@pytest.mark.parametrize("budget_for_repair", [True, False])
async def test_claude_as_last_provider_accepts_empty_mistakes_rather_than_fail(
        writing_providers, monkeypatch, budget_for_repair):
    from config import settings as real_settings
    from services import gemini_writing_grader as gwg

    state = writing_providers
    monkeypatch.setattr(real_settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "gemini,anthropic")
    if not budget_for_repair:
        monkeypatch.setattr(gwg, "CLAUDE_TOTAL_BUDGET_S", gwg.CLAUDE_REPAIR_MIN_S - 1)
    state.gemini = [RuntimeError("gemini down")]
    state.claude = [EMPTY_CLAUDE, EMPTY_CLAUDE]
    result = await state.grader.grade_essay(_grounded_config())

    assert len(state.gemini_calls) == gwg.MAX_RETRIES
    assert len(state.claude_requests) == (2 if budget_for_repair else 1)
    assert result.model_used == "claude-sonnet-5-5" and result.feedback.mistakeAnalysis == []
    assert result.cost_usd and result.cost_usd > 0
    claude_rows = [r for r in state.rows if r["service"] == "claude"]
    assert claude_rows[0]["error_code"] == "missing_mistake_analysis"
    if budget_for_repair:
        assert claude_rows[1]["status"] == "success"
        assert claude_rows[1]["metadata"]["mistake_analysis_missing"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("second", [EMPTY_CLAUDE, UNGROUNDED_CLAUDE])
async def test_claude_empty_answer_is_served_when_the_gemini_fallback_fails(writing_providers, second):
    # Codex #1730: Anthropic-first, Claude's answer fails only this check and
    # Gemini is down — the usable Claude answer must not end in a hard failure.
    from services import gemini_writing_grader as gwg

    state = writing_providers
    state.claude = [EMPTY_CLAUDE, second]
    state.gemini = [RuntimeError("gemini down")]
    result = await state.grader.grade_essay(_grounded_config())

    assert len(state.claude_requests) == 2
    assert len(state.gemini_calls) == gwg.MAX_RETRIES
    assert result.model_used == "claude-sonnet-5-5" and result.feedback.mistakeAnalysis == []
    assert result.cost_usd and result.cost_usd > 0
