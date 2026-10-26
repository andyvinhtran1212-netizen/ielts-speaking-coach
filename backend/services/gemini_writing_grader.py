"""services/gemini_writing_grader.py — Async Gemini grader for IELTS Writing.

Wraps Google Gemini API to grade essays per TECHNICAL_SPEC. Returns Pydantic
WritingFeedback objects with retry handling, model-aware cost calculation, and
defensive JSON extraction (Gemini occasionally adds prose around the JSON
even when response_mime_type='application/json').

Sprint W1 Phase 3 — service layer only. Not yet wired into HTTP endpoints
(W2 will add /admin/writing/essays POST).

Convention notes:
  - Uses settings.GEMINI_API_KEY (matches services/gemini.py)
  - genai.configure() is idempotent; happens at module import in gemini.py
    already, so we redo it here only as defense-in-depth (safe to call twice)
  - Cost stored in writing_feedback.cost_usd (model-aware), not in
    ai_usage_logs (which uses fixed per-token constants — Sprint W1 Q2
    Option A: skip ai_usage_logger for Writing in Phase 1)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

import httpx
import google.generativeai as genai
from google.generativeai.types import GenerationConfig

from config import settings
from models.writing_feedback import (
    GraderConfig,
    GradingResult,
    GradingTier,
    Pass2Refinement,
    Pass3Rewrites,
    WritingFeedback,
    WritingFeedbackDeep,
)
from services.writing_history import format_history_for_prompt
from services.writing_prompt_loader import get_prompt_loader
from services.ai_pricing import estimate_token_cost, token_rate
from services import ai_router, ai_usage_logger
from services.gemini_compat import generation_config_kwargs
from services.writing_feedback_grounding import (
    GROUNDING_INSTRUCTION,
    UngroundedWritingFeedbackError,
    validate_writing_grounding,
)

logger = logging.getLogger(__name__)


# ── Pricing (USD per 1M tokens) — verified by Andy 2026-05-04 ────────

_WRITING_MODELS = (
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
)
# Compatibility export for tests/admin diagnostics. Values come from the same
# effective-dated catalog used by every other AI call; it is no longer a second
# hand-maintained source of truth.
MODEL_PRICING: dict[str, dict[str, float]] = {
    model: {
        "input": rate.input_per_million,
        "output": rate.output_per_million,
    }
    for model in _WRITING_MODELS
    if (rate := token_rate("google", model)) is not None
}

MAX_RETRIES = 3
INITIAL_RETRY_DELAY_S = 1.0

# Anthropic-primary attempt (services.ai_router) for the full-feedback pass.
# Output cap only bounds length; cost follows the actual response. Claude gets
# one attempt plus, when it cites text the essay does not contain, one repair
# re-ask (the Gemini loop's grounding repair). Both share CLAUDE_TOTAL_BUDGET_S:
# each call is capped at CLAUDE_TIMEOUT_S, and the repair starts only with at
# least CLAUDE_REPAIR_MIN_S left and is cut off when the budget runs out. The
# total is added to Deep pass 1 so a slow Claude path still leaves Gemini its
# original budget: 90 + 150 (pass 1) + 90 + 180 = 510 s, under the 600 s Deep
# reaper timeout (WRITING_STUCK_JOB_TIMEOUT_DEEP_SECONDS).
CLAUDE_MAX_TOKENS = 16000
CLAUDE_TIMEOUT_S = 120.0
CLAUDE_TOTAL_BUDGET_S = 150.0
CLAUDE_REPAIR_MIN_S = 30.0

# Stable marker substring for a text-only Task 1 grade. The grader prepends
# _MISSING_IMAGE_CAVEAT (built from this) to overallBandScoreSummary when it
# couldn't send the chart (D7); the grade-queue badge in essay_service matches
# this same string, so both stay in sync from one source. A test pins that the
# marker is a substring of the caveat.
MISSING_IMAGE_CAVEAT_MARKER = "Chấm không có hình"


def summary_flags_missing_image(summary: Optional[str]) -> bool:
    """True when a feedback summary carries the text-only Task 1 caveat — i.e.
    the essay was graded WITHOUT its chart. Matches the ⚠️-prefixed marker the
    grader writes in _inject_missing_image_caveat."""
    if not summary:
        return False
    s = summary.lstrip()
    return s.startswith("⚠️") and MISSING_IMAGE_CAVEAT_MARKER in s


def format_prompt_facts_block(facts: Optional[dict]) -> Optional[str]:
    """Render a reviewed Task 1 answer key (PromptImageAnalysis dict) into the
    Vietnamese prompt block that anchors Task Achievement grading. Returns None
    for an empty/malformed dict so the caller simply omits the block. Defensive
    about missing keys — a partially-filled analysis still yields a usable block."""
    if not isinstance(facts, dict):
        return None

    overview = (facts.get("overview") or "").strip()
    key_features = [str(k).strip() for k in (facts.get("key_features") or []) if str(k).strip()]
    notable = facts.get("notable_data") or []
    axes = (facts.get("axes_or_categories") or "").strip()
    note = (facts.get("grading_note") or "").strip()
    chart_type = (facts.get("chart_type") or "").strip()

    # Nothing substantive to anchor on → no block.
    if not overview and not key_features and not notable:
        return None

    lines: list[str] = [
        "## Dữ kiện biểu đồ (đã xác minh — dùng làm CHUẨN chấm Task Achievement)"
    ]
    if chart_type:
        lines.append(f"Loại biểu đồ: {chart_type}")
    if overview:
        lines.append(f"Tổng quan: {overview}")
    if key_features:
        lines.append("Điểm chính bài band-9 phải nêu:")
        lines.extend(f"- {k}" for k in key_features)
    data_lines = []
    for d in notable:
        if not isinstance(d, dict):
            continue
        label = str(d.get("label") or "").strip()
        value = str(d.get("value") or "").strip()
        unit = str(d.get("unit") or "").strip()
        if not label and not value:
            continue
        data_lines.append(f"- {label}: {value}{(' ' + unit) if unit else ''}".rstrip())
    if data_lines:
        lines.append("Số liệu mốc:")
        lines.extend(data_lines)
    if axes:
        lines.append(f"Trục/danh mục: {axes}")
    if note:
        lines.append(f"Lưu ý: {note}")
    lines.append(_facts_grading_instruction(chart_type))
    return "\n".join(lines)


def _facts_grading_instruction(chart_type: str) -> str:
    """Type-specific closing instruction for the grader. Maps and processes are
    graded on different things than data charts — spatial completeness/relations
    for maps, correct SEQUENCE for processes — so the anchor block tells the
    grader exactly what to check for the visual it's looking at."""
    base = ("Hướng dẫn: coi các dữ kiện trên là mô tả ĐÚNG của hình. Đánh giá độ "
            "chính xác và độ đầy đủ của bài viết SO VỚI các dữ kiện này. ")
    if chart_type == "process":
        return base + (
            "Đây là SƠ ĐỒ QUY TRÌNH: kiểm tra học viên có mô tả ĐỦ các bước THEO "
            "ĐÚNG THỨ TỰ không, có dùng thể BỊ ĐỘNG và từ nối trình tự (then, "
            "after that, subsequently, finally) không, và có nêu đúng tính chất "
            "tuyến tính/tuần hoàn không."
        )
    if chart_type == "map":
        return base + (
            "Đây là BẢN ĐỒ: kiểm tra học viên có mô tả ĐỦ các thay đổi không, có "
            "đúng QUAN HỆ KHÔNG GIAN / hướng (bắc/nam, cạnh, thay cho) không, và "
            "có dùng đúng THÌ (quá khứ khi mô tả thay đổi lịch sử) không. Không "
            "phạt việc thiếu số liệu — bản đồ không có số."
        )
    if chart_type in ("line", "bar", "pie", "table"):
        return base + (
            "Kiểm tra độ chính xác của các SỐ LIỆU học viên nêu theo 'Số liệu "
            "mốc', và việc có nêu overview + các xu hướng/so sánh chính không."
        )
    return base + "Nếu hình là map/process, kết hợp thêm với HÌNH."


# ── Errors ────────────────────────────────────────────────────────────

class WritingGraderError(Exception):
    """Base exception for grader errors."""


class AISafetyBlockError(WritingGraderError):
    """Gemini blocked content via safety filter (no retry)."""


class APIRetryFailedError(WritingGraderError):
    """All retries exhausted."""


class InvalidJSONError(WritingGraderError):
    """Response not parseable as valid JSON or fails schema validation."""


# ── Service ───────────────────────────────────────────────────────────

class GeminiWritingGrader:
    """Service for grading IELTS writing essays via Gemini."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        api_key = api_key or settings.GEMINI_API_KEY
        if not api_key:
            raise ValueError("GEMINI_API_KEY required (settings or constructor arg)")

        # Idempotent — safe to call even though services/gemini.py also calls it
        genai.configure(api_key=api_key)
        # Sprint 2.6.1 hotfix: the loader is intentionally NOT cached at
        # __init__. `get_grader()` is a process-wide singleton (line 263),
        # so freezing the loader here meant flipping
        # settings.WRITING_PROMPT_VERSION on Railway had no effect until
        # the next process restart — defeating the A/B hot-flip contract
        # documented in prompts/writing/v2/README.md. The loader is
        # resolved per `grade_essay()` call so env-var changes propagate.
        # `get_prompt_loader()` already maintains a per-version cache, so
        # this stays cheap (cache hit after first call per version).

    async def grade_essay(self, config: GraderConfig) -> GradingResult:
        """Grade an essay per config. Returns GradingResult with feedback + metadata.

        Tier dispatch:
          standard   — single Gemini call, full 12-section schema. The
                       only tier with a fast response time.
          deep       — Sprint 2.7b: 3-pass flow (Standard → Refine →
                       Rewrite). Pass 2/3 fall back gracefully on
                       failure with a `-deep-degraded` stamp.
          instructor — Sprint 2.7d.1: AI Standard Pass 1 + human
                       review queue. Returns the Standard grading
                       output stamped `-instructor-pending`; the
                       essay_service post-grading hook then creates
                       an instructor_reviews row. Final stamp flips
                       to `-instructor` on `instructor_workflow.deliver`.
          quick      — removed in Sprint 2.7a.1 (orthogonality conflict
                       with Levels L3-L5). Raises ValueError as
                       defence-in-depth — the API layer rejects with 400.

        Raises:
            AISafetyBlockError — content blocked by safety filter
            APIRetryFailedError — all 3 retries exhausted
            InvalidJSONError — response not valid JSON / schema mismatch
            ValueError — Quick tier (removed) or unknown tier
        """
        # Sprint 2.6.1 hotfix: resolve loader per call so a mid-process
        # WRITING_PROMPT_VERSION change is honoured. Sprint 2.7a: also
        # resolve tier per call (anti-pattern #28) — never cache tier
        # state on `self` because get_grader() is a process-wide
        # singleton and a cached tier would lock all subsequent calls.
        loader = get_prompt_loader()
        tier = config.grading_tier

        if tier == GradingTier.STANDARD:
            return await self._grade_standard(config, loader)
        if tier == GradingTier.DEEP:
            return await self._grade_deep(config, loader)
        if tier == GradingTier.INSTRUCTOR:
            return await self._grade_instructor(config, loader)
        if tier == GradingTier.QUICK:
            raise ValueError(
                "Quick tier was removed in Sprint 2.7a.1 (orthogonality "
                "conflict with Levels L3–L5). Use 'standard' tier with "
                "the appropriate Level (L1–L5) instead. Note: the API "
                "layer rejects this earlier with 400 — reaching the "
                "grader means a bypass; investigate the call site."
            )
        raise ValueError(f"Unknown grading tier: {tier!r}")

    async def _grade_instructor(
        self,
        config: GraderConfig,
        loader,
    ) -> GradingResult:
        """Instructor tier — AI Standard Pass 1 + human review queue.

        Pass 1 reuses `_grade_standard` so the AI output is identical
        to a Standard-tier grading. The only difference is the stamp:
        `-instructor-pending` flags this row as awaiting human review.
        The actual queue/claim/deliver lifecycle lives in
        `services/instructor_workflow.py`; this grader stays focused
        on the AI grading half of the flow.

        After delivery, `instructor_workflow.deliver` rewrites
        prompt_version to `<base>-instructor` (no -pending suffix) so
        a SQL filter can split the two cohorts cleanly.

        Sprint W-L3: the AI pass underneath is now the teacher's choice
        (`config.instructor_ai_tier`) — STANDARD (1-pass) or DEEP (3-pass).
        The review-queue routing is unchanged either way; only the depth of
        the AI Pass 1 differs. For DEEP, the deep stamp (`-deep`) is preserved
        in front of `-instructor-pending`, and `instructor_workflow.deliver`'s
        base-stripping keeps it through to `<base>-deep-instructor`.
        """
        if config.instructor_ai_tier == GradingTier.DEEP:
            result = await self._grade_deep(config, loader)
        else:
            result = await self._grade_standard(config, loader)
        # Mutate the stamp + tier in place. GradingResult is a Pydantic
        # model — `model_copy` would also work, but the result object
        # is freshly constructed here so direct assignment is safe.
        result.prompt_version = f"{result.prompt_version}-instructor-pending"
        result.grading_tier = GradingTier.INSTRUCTOR
        return result

    async def _grade_standard(
        self,
        config: GraderConfig,
        loader,
    ) -> GradingResult:
        """Standard tier — single Gemini call, full WritingFeedback schema.

        Extracted from the original `grade_essay()` body during Sprint
        2.7b so Deep tier (Pass 1) can reuse this exact path. The
        behaviour is bit-for-bit identical to pre-2.7b Standard grading.
        """
        start = time.time()

        system_prompt = loader.load(
            level=config.analysis_level,
            form_of_address=config.form_of_address,
        )
        model_name = config.selected_model
        stamp = loader.PROMPT_VERSION
        user_prompt = self._build_user_prompt(config)

        # Sprint 19.3.5 — Task 1 Academic multimodal: fetch the chart image
        # (essay-level snapshot) and pass it to Gemini so the model can
        # judge description accuracy, not just generic grammar/structure.
        image = await self._maybe_fetch_prompt_image(config)

        # Only pass `image` when present, so the text-only call (the common
        # path + every existing caller/mock) keeps its 3-arg signature
        # unchanged — the multimodal kwarg appears only for Task 1 charts.
        extra = {"image": image} if image is not None else {}
        response_text, usage = await self._call_with_retry(
            model_name=model_name,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            parse_schema=WritingFeedback,   # retry on truncated/malformed body
            source_essay=config.essay_text,
            source_task_type=config.task_type,
            usage_context=self._usage_context(config, "pass1"),
            anthropic_feature="writing_grading",
            **extra,
        )
        # Truthful provenance when the Anthropic-primary attempt served it.
        model_name = usage.get("served_model") or model_name

        feedback = self._parse_response(response_text, schema=WritingFeedback)

        # D7 — Task 1 Academic graded WITHOUT a chart (no URL or fetch
        # failed): surface a caveat so student + admin know content accuracy
        # wasn't assessed. Never blocks; text-only grading still delivered.
        if config.task_type == "task1_academic" and image is None:
            feedback = self._inject_missing_image_caveat(feedback)

        duration_ms = int((time.time() - start) * 1000)
        cost = usage["cost_usd"] if "cost_usd" in usage else self._calculate_cost(
            model=model_name,
            tokens_in=usage.get("input_tokens"),
            tokens_out=usage.get("output_tokens"),
        )

        return GradingResult(
            feedback=feedback,
            model_used=model_name,
            tokens_input=usage.get("input_tokens"),
            tokens_output=usage.get("output_tokens"),
            thinking_tokens=usage.get("thinking_tokens"),
            cost_usd=cost,
            grading_duration_ms=duration_ms,
            prompt_version=stamp,
            grading_tier=GradingTier.STANDARD,
        )

    # ── Sprint 2.7b — Deep tier 3-pass flow ───────────────────────────
    #
    # Pass 1: Standard grading (reuses _grade_standard)
    # Pass 2: Refinement — review Pass 1 as a delta; rare adjustments
    # Pass 3: Sentence Rewrite — rewrite each sentence containing a mistake
    #
    # Failure handling: Pass 2 or Pass 3 failure falls back to the last
    # successful state (NEVER raises) and stamps "-deep-degraded" so the
    # admin UI can flag the row + cost telemetry can split degraded vs
    # full Deep runs. Premium tier paying for 3 passes must never lose
    # the Pass 1 baseline if a downstream pass fails.

    DEEP_PASS_TIMEOUTS_S = {
        "pass1": 90,    # Standard pass; existing 3-retry pattern with backoff
        "pass2": 90,    # Refinement; smaller payload, similar retry budget
        "pass3": 180,   # Rewrite; larger output (per-sentence), more time
    }

    async def _grade_deep(
        self,
        config: GraderConfig,
        loader,
    ) -> GradingResult:
        """Deep tier — 3-pass flow with graceful per-pass degradation."""

        tier_metadata: dict = {}

        # ── Pass 1: Standard grading ──────────────────────────────────
        try:
            pass1_timeout = self.DEEP_PASS_TIMEOUTS_S["pass1"]
            if ai_router.anthropic_position("writing_grading", "gemini"):
                pass1_timeout += CLAUDE_TOTAL_BUDGET_S
            pass1 = await asyncio.wait_for(
                self._grade_standard(config, loader),
                timeout=pass1_timeout,
            )
        except (asyncio.TimeoutError, Exception) as e:
            # Pass 1 is the baseline — if it fails, we cannot degrade
            # gracefully. Re-raise so essay_service marks the job as
            # failed (the same behaviour as a pre-2.7b Standard failure).
            logger.error("[deep] Pass 1 failed: %s", e)
            raise

        tier_metadata["pass1"] = {
            # Pass 1 may be served by the Anthropic-primary attempt; passes
            # 2/3 always run on GEMINI_PRO_MODEL.
            "model":         pass1.model_used,
            "duration_ms":   pass1.grading_duration_ms,
            "tokens_input":  pass1.tokens_input,
            "tokens_output": pass1.tokens_output,
            "thinking_tokens": pass1.thinking_tokens,
            "cost_usd":      pass1.cost_usd,
        }

        # Build the eventual Deep result we'll return — we mutate this
        # as later passes succeed; if they fail, the previous state is
        # what gets returned (graceful degradation).
        merged_feedback: WritingFeedback = pass1.feedback
        deep_stamp = f"{loader.PROMPT_VERSION}-deep"
        pass2_output: Pass2Refinement | None = None

        # ── Pass 2: Refinement ────────────────────────────────────────
        pass2_start = time.time()
        try:
            pass2_output, pass2_usage = await asyncio.wait_for(
                self._run_deep_pass2(config, loader, pass1.feedback),
                timeout=self.DEEP_PASS_TIMEOUTS_S["pass2"],
            )
        except Exception as e:
            logger.warning("[deep] Pass 2 failed, degrading to Pass 1: %s", e)
            tier_metadata["pass2"] = {
                "duration_ms": int((time.time() - pass2_start) * 1000),
                "error": str(e)[:500],
            }
            tier_metadata["degraded_at"] = "pass2"
            tier_metadata["degraded_error"] = str(e)[:500]
            return self._build_deep_result(
                feedback=WritingFeedbackDeep(
                    **pass1.feedback.model_dump(),
                    sentenceRewrites=[],
                    pass2_refinements=None,
                ),
                pass1=pass1,
                pass2_cost=None,
                pass3_cost=None,
                tier_metadata=tier_metadata,
                stamp=f"{deep_stamp}-degraded",
                # Only Pass 1 produced this feedback; attribute it to the model
                # that actually served Pass 1 (Claude or Gemini).
                model_used=pass1.model_used,
            )

        pass2_cost = self._calculate_cost(
            model=settings.GEMINI_PRO_MODEL,
            tokens_in=pass2_usage.get("input_tokens"),
            tokens_out=pass2_usage.get("output_tokens"),
        )
        tier_metadata["pass2"] = {
            "duration_ms":       int((time.time() - pass2_start) * 1000),
            "tokens_input":      pass2_usage.get("input_tokens"),
            "tokens_output":     pass2_usage.get("output_tokens"),
            "thinking_tokens":   pass2_usage.get("thinking_tokens"),
            "cost_usd":          pass2_cost,
            "added_mistakes":    len(pass2_output.added_mistakes),
            "removed_mistakes":  len(pass2_output.removed_mistake_indexes),
            "refinements_count": (
                len(pass2_output.added_mistakes)
                + len(pass2_output.removed_mistake_indexes)
                + sum(
                    1
                    for v in pass2_output.band_score_adjustments.model_dump().values()
                    if v is not None
                )
            ),
        }

        # Apply Pass 2 deltas to a fresh merged-feedback copy.
        merged_feedback = self._merge_pass1_pass2(pass1.feedback, pass2_output)

        # ── Pass 3: Sentence Rewrite ──────────────────────────────────
        pass3_start = time.time()
        try:
            pass3_output, pass3_usage = await asyncio.wait_for(
                self._run_deep_pass3(config, loader, merged_feedback),
                timeout=self.DEEP_PASS_TIMEOUTS_S["pass3"],
            )
        except Exception as e:
            logger.warning(
                "[deep] Pass 3 failed, degrading to merged Pass 1+2: %s", e,
            )
            tier_metadata["pass3"] = {
                "duration_ms": int((time.time() - pass3_start) * 1000),
                "error": str(e)[:500],
            }
            tier_metadata["degraded_at"] = "pass3"
            tier_metadata["degraded_error"] = str(e)[:500]
            return self._build_deep_result(
                feedback=WritingFeedbackDeep(
                    **merged_feedback.model_dump(),
                    sentenceRewrites=[],
                    pass2_refinements=pass2_output,
                ),
                pass1=pass1,
                pass2_cost=pass2_cost,
                pass3_cost=None,
                tier_metadata=tier_metadata,
                stamp=f"{deep_stamp}-degraded",
            )

        pass3_cost = self._calculate_cost(
            model=settings.GEMINI_PRO_MODEL,
            tokens_in=pass3_usage.get("input_tokens"),
            tokens_out=pass3_usage.get("output_tokens"),
        )
        tier_metadata["pass3"] = {
            "duration_ms":    int((time.time() - pass3_start) * 1000),
            "tokens_input":   pass3_usage.get("input_tokens"),
            "tokens_output":  pass3_usage.get("output_tokens"),
            "thinking_tokens": pass3_usage.get("thinking_tokens"),
            "cost_usd":       pass3_cost,
            "rewrites_count": len(pass3_output.sentence_rewrites),
        }

        # All 3 passes succeeded — full Deep result.
        deep_feedback = WritingFeedbackDeep(
            **merged_feedback.model_dump(),
            sentenceRewrites=pass3_output.sentence_rewrites,
            pass2_refinements=pass2_output,
        )
        return self._build_deep_result(
            feedback=deep_feedback,
            pass1=pass1,
            pass2_cost=pass2_cost,
            pass3_cost=pass3_cost,
            tier_metadata=tier_metadata,
            stamp=deep_stamp,
        )

    async def _run_deep_pass2(
        self,
        config: GraderConfig,
        loader,
        pass1_feedback: WritingFeedback,
    ) -> tuple[Pass2Refinement, dict]:
        """Execute Pass 2 (refinement). Returns (parsed output, usage)."""
        system_prompt = loader.load_deep_pass2(level=config.analysis_level)
        user_prompt = json.dumps(
            {
                "task_type":    config.task_type,
                "task_prompt":  config.prompt_text,
                "essay":        config.essay_text,
                "pass1_output": pass1_feedback.model_dump(mode="json"),
            },
            ensure_ascii=False,
        )
        response_text, usage = await self._call_with_retry(
            model_name=settings.GEMINI_PRO_MODEL,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            parse_schema=Pass2Refinement,   # retry on truncated/malformed body
            source_essay=config.essay_text,
            source_task_type=config.task_type,
            usage_context=self._usage_context(config, "pass2"),
        )
        return self._parse_response(response_text, schema=Pass2Refinement), usage

    async def _run_deep_pass3(
        self,
        config: GraderConfig,
        loader,
        merged_feedback: WritingFeedback,
    ) -> tuple[Pass3Rewrites, dict]:
        """Execute Pass 3 (sentence rewrite). Returns (parsed output, usage)."""
        system_prompt = loader.load_deep_pass3(level=config.analysis_level)
        user_prompt = json.dumps(
            {
                "essay":    config.essay_text,
                "mistakes": [m.model_dump() for m in merged_feedback.mistakeAnalysis],
            },
            ensure_ascii=False,
        )
        response_text, usage = await self._call_with_retry(
            model_name=settings.GEMINI_PRO_MODEL,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            parse_schema=Pass3Rewrites,   # retry on truncated/malformed body
            source_essay=config.essay_text,
            source_task_type=config.task_type,
            usage_context=self._usage_context(config, "pass3"),
        )
        return self._parse_response(response_text, schema=Pass3Rewrites), usage

    @staticmethod
    def _merge_pass1_pass2(
        pass1_feedback: WritingFeedback,
        pass2: Pass2Refinement,
    ) -> WritingFeedback:
        """Apply Pass 2 deltas to Pass 1 feedback. Returns a new
        WritingFeedback with adjustments applied:

          - removed_mistake_indexes: dropped from mistakeAnalysis
          - added_mistakes: appended to mistakeAnalysis
          - band_score_adjustments: applied to overallBandScore +
            criteriaFeedback.<criterion>.bandScore for each non-None field

        Pass 1's data is the baseline; null/empty Pass 2 fields are no-ops.
        """
        merged = pass1_feedback.model_copy(deep=True)

        # Mistake list: drop removed indexes (defensive bounds check),
        # then append additions. removed_mistake_indexes referenced into
        # the ORIGINAL Pass 1 list, so we filter before appending.
        removed_set = {
            i for i in pass2.removed_mistake_indexes
            if 0 <= i < len(merged.mistakeAnalysis)
        }
        kept = [
            m for i, m in enumerate(merged.mistakeAnalysis)
            if i not in removed_set
        ]
        merged.mistakeAnalysis = kept + list(pass2.added_mistakes)

        # Band score adjustments — apply only the non-None ones.
        adj = pass2.band_score_adjustments
        if adj.overall is not None:
            merged.overallBandScore = adj.overall
        if adj.mainCriterion is not None:
            merged.criteriaFeedback.mainCriterion.bandScore = adj.mainCriterion
        if adj.coherenceCohesion is not None:
            merged.criteriaFeedback.coherenceCohesion.bandScore = adj.coherenceCohesion
        if adj.lexicalResource is not None:
            merged.criteriaFeedback.lexicalResource.bandScore = adj.lexicalResource
        if adj.grammaticalRange is not None:
            merged.criteriaFeedback.grammaticalRange.bandScore = adj.grammaticalRange

        return merged

    @staticmethod
    def _build_deep_result(
        feedback: WritingFeedbackDeep,
        pass1: GradingResult,
        pass2_cost: Optional[float],
        pass3_cost: Optional[float],
        tier_metadata: dict,
        stamp: str,
        model_used: Optional[str] = None,
    ) -> GradingResult:
        """Assemble the GradingResult for a Deep run.

        Aggregates token counts + cost across all completed passes (a
        degraded run has None for the failed/skipped passes' costs).
        `grading_duration_ms` is the SUM of pass1+pass2+pass3 durations
        from tier_metadata so callers can present a wall-clock latency
        without summing themselves.
        """
        total_tokens_in  = pass1.tokens_input or 0
        total_tokens_out = pass1.tokens_output or 0
        total_thinking_tokens = pass1.thinking_tokens or 0
        total_cost = (pass1.cost_usd or 0.0)
        total_duration_ms = pass1.grading_duration_ms

        for pass_key in ("pass2", "pass3"):
            meta = tier_metadata.get(pass_key, {})
            total_tokens_in  += meta.get("tokens_input") or 0
            total_tokens_out += meta.get("tokens_output") or 0
            total_thinking_tokens += meta.get("thinking_tokens") or 0
            total_cost       += meta.get("cost_usd") or 0.0
            total_duration_ms += meta.get("duration_ms") or 0

        return GradingResult(
            feedback=feedback,
            model_used=model_used or settings.GEMINI_PRO_MODEL,
            tokens_input=total_tokens_in,
            tokens_output=total_tokens_out,
            thinking_tokens=total_thinking_tokens,
            cost_usd=round(total_cost, 6),
            grading_duration_ms=total_duration_ms,
            prompt_version=stamp,
            grading_tier=GradingTier.DEEP,
            tier_metadata=tier_metadata,
        )

    # ── Internal helpers ──────────────────────────────────────────────

    def _build_user_prompt(self, config: GraderConfig) -> str:
        """Build user message containing essay context.

        Phase 1.5a/1.5b/1.5c: `config.history` (recurring patterns),
        `config.trajectory` (band trajectory), and
        `config.sentence_structure` (SS-history) are pre-aggregated
        by services.writing_history. The formatted Vietnamese block
        is injected before the essay so Gemini can populate
        `feedback_json.recurringPatterns`,
        `feedback_json.bandTrajectoryAnalysis`, and the Phase-1.5c
        structured shape on `feedback_json.sentenceStructureAnalysis`
        (overriding the L4/L5 system prompt's legacy
        `{sentenceUpgrades: [...]}` shape) against the actual
        student history.
        """
        parts: list[str] = []

        history_block = format_history_for_prompt(
            config.history, config.trajectory, config.sentence_structure,
        )
        if history_block:
            parts.append(history_block)

        parts.append(f"## Loại bài (Task Type)\n{config.task_type}")
        parts.append(f"## Đề bài (Prompt)\n{config.prompt_text}")

        # Task 1 verified answer key (reviewed) — anchors Task Achievement
        # accuracy. Present only when the caller populated prompt_image_facts
        # (feature flag ON + prompt analysis approved); the chart image is still
        # sent multimodally alongside. None → omit → pre-feature behaviour.
        facts_block = format_prompt_facts_block(config.prompt_image_facts)
        if facts_block:
            parts.append(facts_block)

        # Bug-2 fix — authoritative body word count. The model is told to USE
        # this number for the Rule 2 word-count caps and NOT to count words
        # itself (LLMs tokenize → under-count → unfair Task Response/Achievement
        # penalty). Fallback to a local split() count if a direct caller omits it.
        wc = (
            config.word_count
            if config.word_count is not None
            else len((config.essay_text or "").split())
        )
        parts.append(
            f"## Số từ (đã đếm chính xác)\n{wc} từ.\n"
            f"DÙNG con số này khi áp Rule 2 (word count caps). "
            f"TUYỆT ĐỐI không tự đếm lại số từ."
        )

        parts.append(f"## Bài viết của học viên\n{config.essay_text}")
        parts.append("Hãy phân tích bài viết theo schema JSON đã quy định.")

        return "\n\n".join(parts)

    # ── Sprint 19.3.5 — Task 1 Academic chart image (multimodal) ──────

    _IMAGE_FETCH_TIMEOUT_S = 5.0
    _IMAGE_FETCH_ATTEMPTS = 2
    _MISSING_IMAGE_CAVEAT = (
        "⚠️ " + MISSING_IMAGE_CAVEAT_MARKER +
        " — độ chính xác nội dung Task 1 Academic hạn chế. "
    )

    @staticmethod
    def _guess_image_mime(url: str) -> str:
        u = (url or "").split("?")[0].lower()
        if u.endswith((".jpg", ".jpeg")): return "image/jpeg"
        if u.endswith(".webp"):           return "image/webp"
        if u.endswith(".gif"):            return "image/gif"
        return "image/png"

    async def _maybe_fetch_prompt_image(
        self, config: GraderConfig
    ) -> Optional[tuple[bytes, str]]:
        """Fetch the Task 1 Academic chart image for multimodal grading.

        Tries the essay snapshot URL first, then the source-prompt's CURRENT
        image (`prompt_image_url_fallback`) — the latter recovers a stale
        snapshot whose object was replaced/deleted after submission, so a
        regrade grades WITH the chart instead of text-only.

        Returns (bytes, mime_type), or None when there's nothing to send —
        non-task1_academic, no URL, or every candidate fails (timeout / 404 /
        network). On None the caller falls back to text-only + caveat (D7);
        a flaky image must never fail or stall grading (cap ~10s per URL)."""
        if config.task_type != "task1_academic":
            return None

        # Snapshot first, then the live-prompt fallback. Dedup so an unchanged
        # snapshot isn't fetched twice; drop None/empty candidates.
        candidates: list[str] = []
        for url in (config.prompt_image_url, config.prompt_image_url_fallback):
            if url and url not in candidates:
                candidates.append(url)

        for url in candidates:
            got = await self._fetch_image_bytes(url)
            if got:
                return got
        return None

    async def _fetch_image_bytes(self, url: str) -> Optional[tuple[bytes, str]]:
        """Fetch one image URL with retry. Returns (bytes, mime) on success, or
        None on any failure (logged) — the caller decides whether to try the
        next candidate or fall back to text-only."""
        try:
            async with httpx.AsyncClient(timeout=self._IMAGE_FETCH_TIMEOUT_S) as client:
                last: Optional[Exception] = None
                for attempt in range(self._IMAGE_FETCH_ATTEMPTS):
                    try:
                        resp = await client.get(url)
                        if resp.status_code == 200 and resp.content:
                            mime = (resp.headers.get("content-type") or "").split(";")[0].strip()
                            if not mime.startswith("image/"):
                                mime = self._guess_image_mime(url)
                            return resp.content, mime
                        last = RuntimeError(f"HTTP {resp.status_code}")
                    except httpx.RequestError as exc:
                        last = exc
                if last:
                    raise last
        except Exception as exc:
            logger.warning(
                "[grader] Task1 image fetch failed url=%s: %s", url, exc,
            )
        return None

    @classmethod
    def _inject_missing_image_caveat(cls, feedback: WritingFeedback) -> WritingFeedback:
        """Prepend the D7 caveat to overallBandScoreSummary (the prose the
        student/admin reads first). Idempotent — a re-grade won't stack it."""
        summary = feedback.overallBandScoreSummary or ""
        if not summary.startswith("⚠️"):
            feedback.overallBandScoreSummary = cls._MISSING_IMAGE_CAVEAT + summary
        return feedback

    async def _call_with_retry(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        image: Optional[tuple[bytes, str]] = None,
        *,
        parse_schema=None,
        usage_context: dict | None = None,
        source_essay: str | None = None,
        source_task_type: str | None = None,
        anthropic_feature: str | None = None,
    ) -> tuple[str, dict]:
        """Call Gemini with exponential backoff retry.

        When ``anthropic_feature`` is set, services.ai_router decides whether the
        Claude attempt runs before the Gemini loop (default) or after it fails.
        Claude output must pass the SAME schema + grounding validation, with
        one grounding-repair re-ask (see ``_try_claude``); a Claude failure (or
        missing key) leaves the Gemini loop's behaviour unchanged. A Claude
        success returns usage with ``served_model`` and ``cost_usd``.

        Sprint 19.3.5 — `image` (bytes, mime_type) is sent as a multimodal
        inline Part alongside the text when present (Task 1 Academic chart).
        The legacy google.generativeai SDK accepts a `[text, {mime_type,
        data}]` contents list (verified on 0.8.3).

        Robustness: when `parse_schema` is set, the response is VALIDATED against
        it inside the retry loop (parse → discard). A parse failure (truncated /
        malformed JSON) therefore counts as a retryable failure and triggers a
        fresh attempt with backoff — previously parsing happened only at the call
        site, OUTSIDE this loop, so a single bad/truncated body failed hard with
        no re-roll. The caller still calls `_parse_response` on the returned text
        (kept so the existing test seam that mocks this method is unaffected; the
        re-parse is cheap and guaranteed to succeed). AISafetyBlockError stays
        non-retryable."""

        if source_essay is not None:
            system_prompt += "\n\n" + GROUNDING_INSTRUCTION
        position = (ai_router.anthropic_position(anthropic_feature, "gemini")
                    if anthropic_feature else None)
        claude_kwargs = dict(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            image=image,
            parse_schema=parse_schema,
            usage_context=usage_context,
            source_essay=source_essay,
            source_task_type=source_task_type,
        )
        if position == "first":
            served = await self._try_claude(anthropic_feature, **claude_kwargs)
            if served is not None:
                return served
        gemini_kwargs = dict(
            parse_schema=parse_schema,
            usage_context=usage_context,
            source_essay=source_essay,
            source_task_type=source_task_type,
        )
        if position != "after":
            return await self._gemini_call_with_retry(
                model_name, system_prompt, user_prompt, image, **gemini_kwargs,
            )
        # AI_PROVIDER_ORDER_<FEATURE> places Claude after Gemini: Claude is the
        # fallback once the whole Gemini loop has failed.
        try:
            return await self._gemini_call_with_retry(
                model_name, system_prompt, user_prompt, image, **gemini_kwargs,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            served = await self._try_claude(anthropic_feature, **claude_kwargs)
            if served is not None:
                return served
            raise

    async def _gemini_call_with_retry(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        image: Optional[tuple[bytes, str]] = None,
        *,
        parse_schema=None,
        usage_context: dict | None = None,
        source_essay: str | None = None,
        source_task_type: str | None = None,
    ) -> tuple[str, dict]:
        """The existing Gemini retry loop (system prompt already grounded)."""
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_prompt,
        )
        config_kwargs = generation_config_kwargs(
            model_name,
            response_mime_type="application/json",
            # Robustness: long L4/L5 feedback (~16KB+) was truncated at the
            # model's default output cap → unterminated JSON → InvalidJSONError
            # (prod char-16107 cut). Gemini 2.5 supports 64K+ output; a high cap
            # only ALLOWS longer responses — cost still tracks the real length.
            max_output_tokens=32768,
            temperature=0.3,
        )
        generation_config = GenerationConfig(**config_kwargs)

        # Single string for text-only; [text, image-part] for multimodal.
        contents = user_prompt
        if image is not None:
            img_bytes, img_mime = image
            contents = [user_prompt, {"mime_type": img_mime, "data": img_bytes}]

        last_error: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            attempt_started = time.monotonic()
            attempt_logged = False
            try:
                response = await asyncio.to_thread(
                    model.generate_content,
                    contents,
                    generation_config=generation_config,
                )
                usage = self._usage_from_metadata(
                    getattr(response, "usage_metadata", None))

                # Safety block detection (no retry)
                if not response.candidates:
                    await self._log_writing_usage(
                        model_name, usage, usage_context, attempt,
                        attempt_started, status="safety_block",
                    )
                    attempt_logged = True
                    raise AISafetyBlockError("Gemini blocked response (no candidates)")
                finish_reason = response.candidates[0].finish_reason
                if finish_reason and getattr(finish_reason, "name", "") == "SAFETY":
                    await self._log_writing_usage(
                        model_name, usage, usage_context, attempt,
                        attempt_started, status="safety_block",
                    )
                    attempt_logged = True
                    raise AISafetyBlockError("Gemini safety filter triggered")

                response_text = response.text or ""
                if len(response_text.strip()) < 10:
                    await self._log_writing_usage(
                        model_name, usage, usage_context, attempt,
                        attempt_started, status="invalid_response",
                    )
                    attempt_logged = True
                    raise InvalidJSONError("Empty/near-empty response from Gemini")

                # Validate inside the loop so a truncated/malformed body is a
                # RETRYABLE failure (re-roll with backoff), not a hard fail.
                if parse_schema is not None:
                    try:
                        parsed = self._parse_response(response_text, schema=parse_schema)
                        if source_essay is not None:
                            validate_writing_grounding(parsed, source_essay, task_type=source_task_type)
                    except Exception as validation_error:
                        await self._log_writing_usage(
                            model_name, usage, usage_context, attempt,
                            attempt_started, status="invalid_response",
                            error_code=("ungrounded_feedback" if isinstance(
                                validation_error, UngroundedWritingFeedbackError
                            ) else None),
                        )
                        attempt_logged = True
                        raise

                await self._log_writing_usage(
                    model_name, usage, usage_context, attempt,
                    attempt_started, status="success",
                )
                attempt_logged = True

                return response_text, usage

            except asyncio.CancelledError:
                if not attempt_logged:
                    await self._log_writing_usage(
                        model_name, {}, usage_context, attempt,
                        attempt_started, status="cancelled",
                    )
                raise
            except AISafetyBlockError:
                # Don't retry safety blocks
                raise
            except Exception as e:
                last_error = e
                if isinstance(e, UngroundedWritingFeedbackError):
                    repaired_prompt = user_prompt + e.repair_instruction()
                    contents = ([repaired_prompt, {"mime_type": image[1], "data": image[0]}]
                                if image is not None else repaired_prompt)
                if not attempt_logged:
                    await self._log_writing_usage(
                        model_name, {}, usage_context, attempt,
                        attempt_started, status="error",
                    )
                logger.warning(
                    "Gemini grading attempt %d/%d failed: %s",
                    attempt + 1, MAX_RETRIES, e,
                )
                if attempt < MAX_RETRIES - 1:
                    delay = INITIAL_RETRY_DELAY_S * (2 ** attempt)
                    await asyncio.sleep(delay)

        # All retries exhausted. If the persistent failure was a bad/truncated
        # body, surface InvalidJSONError (vs APIRetryFailedError for API errors)
        # for accurate telemetry — both are handled by _bg_grade_essay's except
        # (→ PR-1 status-reset, so the essay isn't stranded).
        if isinstance(last_error, (InvalidJSONError, UngroundedWritingFeedbackError)):
            raise last_error
        raise APIRetryFailedError(f"All {MAX_RETRIES} retries failed: {last_error}")

    async def _try_claude(
        self,
        feature: str,
        *,
        system_prompt: str,
        user_prompt: str,
        image: Optional[tuple[bytes, str]],
        parse_schema,
        usage_context: dict | None,
        source_essay: str | None,
        source_task_type: str | None,
    ) -> tuple[str, dict] | None:
        """Claude attempt (plus one grounding repair); None means "run the
        unchanged Gemini path"."""

        def _validate(text: str):
            if len(text.strip()) < 10:
                raise InvalidJSONError("Empty/near-empty response from Claude")
            if parse_schema is not None:
                parsed = self._parse_response(text, schema=parse_schema)
                if source_essay is not None:
                    validate_writing_grounding(parsed, source_essay, task_type=source_task_type)
            return True

        context = dict(usage_context or {})
        user_id = context.pop("user_id", None)
        session_id = context.pop("session_id", None)
        context.pop("feature", None)
        operation = context.pop("operation", None) or "grade"
        event_prefix = context.pop("usage_event_prefix", None)
        started = time.monotonic()
        prompt = user_prompt
        attempt = 1
        while True:
            if event_prefix:
                context["usage_event_id"] = f"{event_prefix}:{operation}:anthropic:{attempt}"
            call = ai_router.call_anthropic(
                feature,
                system=system_prompt,
                user=prompt,
                max_tokens=CLAUDE_MAX_TOKENS,
                operation=operation,
                validate=_validate,
                images=[image] if image is not None else (),
                user_id=user_id,
                session_id=session_id,
                usage_context=dict(context),
                timeout_seconds=CLAUDE_TIMEOUT_S,
            )
            try:
                if attempt == 1:
                    result, _ = await call
                else:
                    remaining = CLAUDE_TOTAL_BUDGET_S - (time.monotonic() - started)
                    result, _ = await asyncio.wait_for(call, timeout=remaining)
                break
            except asyncio.TimeoutError:
                logger.warning(
                    "[ai_router] feature=%s provider=anthropic repair exceeded the %.0f s "
                    "Claude budget — falling back to gemini", feature, CLAUDE_TOTAL_BUDGET_S,
                )
                return None
            except ai_router.AnthropicAttemptError as exc:
                cause = exc.__cause__
                remaining = CLAUDE_TOTAL_BUDGET_S - (time.monotonic() - started)
                repair = (attempt == 1
                          and isinstance(cause, UngroundedWritingFeedbackError)
                          and remaining >= CLAUDE_REPAIR_MIN_S)
                logger.warning(
                    "[ai_router] feature=%s provider=anthropic attempt %d failed (%s): %s — %s",
                    feature, attempt, exc.error_code,
                    str(exc)[:ai_router.ERROR_DETAIL_MAX_CHARS],
                    "re-asking Claude with the grounding repair" if repair
                    else "falling back to gemini",
                )
                if not repair:
                    return None
                # Same repair the Gemini loop applies: original prompt plus
                # the unsupported citations, never accumulated across tries.
                prompt = user_prompt + cause.repair_instruction()
                attempt += 1
        logger.info("[ai_router] feature=%s served_by=anthropic model=%s", feature, result.model)
        cost, _ = estimate_token_cost("anthropic", result.model, **result.usage)
        usage = {
            # Writing rows record total prompt tokens; the cache split is in
            # the AI usage ledger row written by ai_router.
            "input_tokens": (result.usage.get("input_tokens", 0)
                             + result.usage.get("cache_read_tokens", 0)
                             + result.usage.get("cache_write_tokens", 0)),
            "output_tokens": result.usage.get("output_tokens", 0),
            "thinking_tokens": 0,
            "served_model": result.model,
            "cost_usd": round(cost, 6) if cost is not None else None,
        }
        return result.text, usage

    @staticmethod
    def _usage_context(config: GraderConfig, operation: str) -> dict:
        return {
            "user_id": config.usage_user_id,
            "session_id": None,
            "feature": "writing_grading",
            "operation": operation,
            "resource_type": "writing_essay",
            "resource_id": config.usage_resource_id,
            "usage_event_prefix": config.usage_event_prefix,
            "metadata": {
                "student_id": config.usage_student_id,
                "task_type": config.task_type,
                "analysis_level": config.analysis_level,
                "grading_tier": str(config.grading_tier),
            },
        }

    @staticmethod
    async def _log_writing_usage(
        model_name: str,
        usage: dict,
        usage_context: dict | None,
        attempt: int,
        attempt_started: float,
        *,
        status: str,
        error_code: str | None = None,
    ) -> None:
        context = dict(usage_context or {})
        event_prefix = context.pop("usage_event_prefix", None)
        if event_prefix:
            context["usage_event_id"] = (
                f"{event_prefix}:{context.get('operation', 'call')}:api:{attempt + 1}"
            )
        if not usage:
            error_code = error_code or (
                status if status in {"error", "cancelled"} else "missing_usage"
            )
            ai_usage_logger.schedule_usage_log(ai_usage_logger.log_unpriced_usage_async(
                service="gemini",
                model=model_name,
                user_id=context.pop("user_id", None),
                session_id=context.pop("session_id", None),
                status=status,
                error_code=error_code,
                latency_ms=int((time.monotonic() - attempt_started) * 1000),
                **context,
            ))
            return
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_gemini_async(
            user_id=context.pop("user_id", None),
            session_id=context.pop("session_id", None),
            model=model_name,
            input_tokens=usage.get("input_tokens") or 0,
            output_tokens=max(
                0,
                (usage.get("output_tokens") or 0)
                - (usage.get("thinking_tokens") or 0),
            ),
            thinking_tokens=usage.get("thinking_tokens") or 0,
            status=status,
            error_code=error_code,
            latency_ms=int((time.monotonic() - attempt_started) * 1000),
            **context,
        ))

    def _parse_response(self, response_text: str, schema=WritingFeedback):
        """Parse Gemini JSON response → schema instance.

        Defensively extracts the outermost {...} even if Gemini adds prose
        around the JSON despite response_mime_type='application/json'.

        Sprint 2.7a: takes a `schema` parameter so Quick tier can parse
        into WritingFeedbackQuick (5-section subset) instead of the full
        WritingFeedback. Default is WritingFeedback so historical
        callers keep their pre-2.7a behaviour.
        """
        first = response_text.find("{")
        if first == -1 or response_text.rfind("}") < first:
            raise InvalidJSONError("No JSON object found in response")

        # Decode one object from the first brace: a ```json fence, preamble or
        # trailing note (Claude has no JSON response mode) cannot shift its end.
        # strict=False accepts a raw newline/tab inside a string value.
        try:
            data, _ = json.JSONDecoder(strict=False).raw_decode(response_text, first)
        except json.JSONDecodeError as e:
            raise InvalidJSONError(f"JSON parse failed: {e}") from e

        self._coerce_wrapped_list_shapes(data)

        try:
            return schema(**data)
        except Exception as e:
            # Field paths and error types only: pydantic's own text echoes
            # input values, i.e. model output, into logs and the usage ledger.
            raise InvalidJSONError(
                f"Schema validation failed: {ai_router.rejection_detail(e)}"
            ) from e

    @staticmethod
    def _usage_from_metadata(um) -> dict:
        """Build the token-usage dict from a Gemini usage_metadata object.

        Gemini 2.5/3.x "thinking": the output is BILLED including thinking
        tokens, but they arrive in a separate `thoughts_token_count` field
        (absent/None on models or SDK versions without thinking). Fold them
        into `output_tokens` so `_calculate_cost` reflects the real bill —
        otherwise a thinking-by-default model (e.g. 3.5 Flash) looks cheaper
        than it is. The split is kept in `thinking_tokens` for telemetry.
        Returns {} when metadata is absent (cost then degrades to None)."""
        if um is None:
            return {}

        tokens = ai_usage_logger.gemini_usage_tokens(um)
        prompt = tokens["input_tokens"]
        candidates = tokens["output_tokens"]
        thoughts = tokens["thinking_tokens"]
        return {
            "input_tokens": prompt,
            "output_tokens": candidates + thoughts,
            "thinking_tokens": thoughts,
        }

    @staticmethod
    def _coerce_wrapped_list_shapes(data: dict) -> None:
        """Tolerate the common LLM mistake of emitting a wrapped-list dict field
        as a bare list. `sentenceStructureAnalysis` ({sentenceUpgrades: [...]})
        and `lexicalAnalysis` ({wordsToUpgrade: [...]}) are dict-typed in
        WritingFeedback; Gemini sometimes drops the wrapper and returns the
        inner list directly, which fails validation and sinks the whole grading.
        Wrap a bare list back into its canonical key in-place. No-op for the
        correct dict shape, for None, or for the Phase-1.5c structured shape.

        Surfaced when sentenceStructureAnalysis turned on at L3 (Sprint W-L3),
        but the fragility was always present at L4/L5 — this hardens both.
        """
        for field, inner_key in (
            ("sentenceStructureAnalysis", "sentenceUpgrades"),
            ("lexicalAnalysis", "wordsToUpgrade"),
        ):
            val = data.get(field)
            if isinstance(val, list):
                data[field] = {inner_key: val}

    def _calculate_cost(
        self,
        model: str,
        tokens_in: Optional[int],
        tokens_out: Optional[int],
    ) -> Optional[float]:
        """USD cost from token usage. Returns None when usage is missing."""
        if tokens_in is None or tokens_out is None:
            return None

        cost, _ = estimate_token_cost(
            "google", model,
            input_tokens=tokens_in,
            # Historical writing output already includes thinking tokens.
            output_tokens=tokens_out,
        )
        return round(cost, 6) if cost is not None else None


# ── Singleton accessor ───────────────────────────────────────────────

_grader_instance: Optional[GeminiWritingGrader] = None


def get_grader() -> GeminiWritingGrader:
    """Singleton accessor — shared across the app."""
    global _grader_instance
    if _grader_instance is None:
        _grader_instance = GeminiWritingGrader()
    return _grader_instance
