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

import google.generativeai as genai
from google.generativeai.types import GenerationConfig

from config import settings
from models.writing_feedback import GraderConfig, GradingResult, WritingFeedback
from services.writing_prompt_loader import get_prompt_loader

logger = logging.getLogger(__name__)


# ── Pricing (USD per 1M tokens) — verified by Andy 2026-05-04 ────────

MODEL_PRICING: dict[str, dict[str, float]] = {
    "gemini-2.5-pro":   {"input": 1.25, "output": 10.00},
    "gemini-2.5-flash": {"input": 0.30, "output":  2.50},
}

MAX_RETRIES = 3
INITIAL_RETRY_DELAY_S = 1.0


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
        self.prompt_loader = get_prompt_loader()

    async def grade_essay(self, config: GraderConfig) -> GradingResult:
        """Grade an essay per config. Returns GradingResult with feedback + metadata.

        Raises:
            AISafetyBlockError — content blocked by safety filter (no retry made)
            APIRetryFailedError — all 3 retries exhausted
            InvalidJSONError — response not valid JSON / schema mismatch
        """
        start = time.time()

        system_prompt = self.prompt_loader.load(
            level=config.analysis_level,
            form_of_address=config.form_of_address,
        )
        user_prompt = self._build_user_prompt(config)

        response_text, usage = await self._call_with_retry(
            model_name=config.selected_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )

        feedback = self._parse_response(response_text)

        duration_ms = int((time.time() - start) * 1000)
        cost = self._calculate_cost(
            model=config.selected_model,
            tokens_in=usage.get("input_tokens"),
            tokens_out=usage.get("output_tokens"),
        )

        return GradingResult(
            feedback=feedback,
            model_used=config.selected_model,
            tokens_input=usage.get("input_tokens"),
            tokens_output=usage.get("output_tokens"),
            cost_usd=cost,
            grading_duration_ms=duration_ms,
            prompt_version=self.prompt_loader.PROMPT_VERSION,
        )

    # ── Internal helpers ──────────────────────────────────────────────

    def _build_user_prompt(self, config: GraderConfig) -> str:
        """Build user message containing essay context."""
        parts: list[str] = []

        # Phase 1.5 forward-compat: history context (None on Phase 1)
        if config.history:
            parts.append(self._format_history(config.history))

        parts.append(f"## Loại bài (Task Type)\n{config.task_type}")
        parts.append(f"## Đề bài (Prompt)\n{config.prompt_text}")
        parts.append(f"## Bài viết của học viên\n{config.essay_text}")
        parts.append("Hãy phân tích bài viết theo schema JSON đã quy định.")

        return "\n\n".join(parts)

    def _format_history(self, history: list[dict]) -> str:
        """Format student history for Phase 1.5 (unused on Phase 1)."""
        items: list[str] = []
        for i, essay in enumerate(history, 1):
            items.append(
                f"### Bài #{i}\n"
                f"Band: {essay.get('overall_band')}\n"
                f"Date: {essay.get('created_at')}\n"
                f"Snippet: {(essay.get('essay_text') or '')[:300]}..."
            )
        return "## Lịch sử các bài trước\n" + "\n\n".join(items)

    async def _call_with_retry(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
    ) -> tuple[str, dict]:
        """Call Gemini with exponential backoff retry."""

        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_prompt,
        )
        generation_config = GenerationConfig(
            response_mime_type="application/json",
            temperature=0.3,
        )

        last_error: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                response = await asyncio.to_thread(
                    model.generate_content,
                    user_prompt,
                    generation_config=generation_config,
                )

                # Safety block detection (no retry)
                if not response.candidates:
                    raise AISafetyBlockError("Gemini blocked response (no candidates)")
                finish_reason = response.candidates[0].finish_reason
                if finish_reason and getattr(finish_reason, "name", "") == "SAFETY":
                    raise AISafetyBlockError("Gemini safety filter triggered")

                response_text = response.text or ""
                if len(response_text.strip()) < 10:
                    raise InvalidJSONError("Empty/near-empty response from Gemini")

                usage: dict = {}
                if hasattr(response, "usage_metadata") and response.usage_metadata is not None:
                    usage["input_tokens"] = response.usage_metadata.prompt_token_count
                    usage["output_tokens"] = response.usage_metadata.candidates_token_count

                return response_text, usage

            except AISafetyBlockError:
                # Don't retry safety blocks
                raise
            except Exception as e:
                last_error = e
                logger.warning(
                    "Gemini grading attempt %d/%d failed: %s",
                    attempt + 1, MAX_RETRIES, e,
                )
                if attempt < MAX_RETRIES - 1:
                    delay = INITIAL_RETRY_DELAY_S * (2 ** attempt)
                    await asyncio.sleep(delay)

        raise APIRetryFailedError(f"All {MAX_RETRIES} retries failed: {last_error}")

    def _parse_response(self, response_text: str) -> WritingFeedback:
        """Parse Gemini JSON response → WritingFeedback.

        Defensively extracts the outermost {...} even if Gemini adds prose
        around the JSON despite response_mime_type='application/json'.
        """
        first = response_text.find("{")
        last = response_text.rfind("}")
        if first == -1 or last == -1 or last < first:
            raise InvalidJSONError("No JSON object found in response")

        json_str = response_text[first:last + 1]

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise InvalidJSONError(f"JSON parse failed: {e}") from e

        try:
            return WritingFeedback(**data)
        except Exception as e:
            raise InvalidJSONError(f"Schema validation failed: {e}") from e

    def _calculate_cost(
        self,
        model: str,
        tokens_in: Optional[int],
        tokens_out: Optional[int],
    ) -> Optional[float]:
        """USD cost from token usage. Returns None when usage is missing."""
        if tokens_in is None or tokens_out is None:
            return None

        pricing = MODEL_PRICING.get(model)
        if not pricing:
            return None

        cost = (tokens_in / 1_000_000) * pricing["input"]
        cost += (tokens_out / 1_000_000) * pricing["output"]
        return round(cost, 6)


# ── Singleton accessor ───────────────────────────────────────────────

_grader_instance: Optional[GeminiWritingGrader] = None


def get_grader() -> GeminiWritingGrader:
    """Singleton accessor — shared across the app."""
    global _grader_instance
    if _grader_instance is None:
        _grader_instance = GeminiWritingGrader()
    return _grader_instance
