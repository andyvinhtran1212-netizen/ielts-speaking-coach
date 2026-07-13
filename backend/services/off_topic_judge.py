"""
services.off_topic_judge — Sprint 14.7

LLM judge that runs *in parallel* with the main grader (Andy lock L2)
and answers one question: "Did the candidate actually try to address
the examiner's question?"

Locked design choices (Sprint 14.0 D5 corrected by Sprint 14.3 → Claude
not Gemini):

  L1  Claude Haiku 4.5 primary via the Sprint 14.3 orchestrator.
  L3  Output is binary {is_on_topic: bool, reasoning: str ≤50 từ VN} —
      not a score (defers band modification to Phase B per L4).
  L6  Reuses the same Haiku → Gemini → Sonnet fallback chain as grading,
      so judge availability degrades the same way grading does.
  L10 Generous interpretation — "broken English trying to address the
      question" still counts as on-topic. Off-topic only when the
      response is clearly unrelated.
  L11 All providers failed → silent skip (no banner, grading proceeds).
      Telemetry to grading_events with kind='off_topic_judge'.
  L13 Hard 10s timeout — slow judge must not throttle grading throughput.
  L14 No verdict caching this sprint (high transcript variance).

The judge does **not** modify bands (L4). Its single job is to enrich
the frontend feedback panel with a "Cảnh báo: chưa bám sát đề" banner
when the response was clearly off-topic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

from .grading_orchestrator import GradingOrchestrator
from .grading_providers.errors import (
    AllProvidersFailedError,
    FallbackEvent,
    NonRetryableError,
)
from .grading_telemetry import log_fallback_events

logger = logging.getLogger(__name__)


JUDGE_TIMEOUT_SECONDS: float = 10.0   # L13
REASONING_WORD_CAP:    int   = 50     # L3


# ── Public dataclass ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class OffTopicVerdict:
    is_on_topic: bool
    reasoning:   str   # VN, ≤50 words


# ── Prompt assembly ───────────────────────────────────────────────────────────


def build_judge_prompt(
    question:   str,
    transcript: str,
    part_num:   int,
) -> tuple[str, str]:
    """Return ``(system_prompt, user_message)`` for the orchestrator.

    Split mirrors the grading prompt structure so the orchestrator's
    provider adapters (which differentiate system vs user message)
    handle this call identically.
    """
    system = (
        "Bạn là examiner IELTS Speaking đánh giá xem câu trả lời của "
        "thí sinh có bám sát đề bài hay không.\n\n"
        "# Quy tắc đánh giá\n"
        "- on-topic = câu trả lời cố gắng giải quyết đề bài, kể cả khi "
        "tiếng Anh chưa hoàn chỉnh hoặc lan man.\n"
        "- off-topic = câu trả lời nói về chủ đề hoàn toàn khác hoặc né "
        "tránh câu hỏi rõ ràng.\n"
        "- Rộng lượng với người học. Nếu thí sinh ĐANG CỐ trả lời "
        "đề (dù vụng về) → vẫn coi là on-topic.\n"
        "- Off-topic chỉ khi câu trả lời rõ ràng không liên quan.\n\n"
        "# Output (strict JSON, không có text khác ngoài object)\n"
        "{\n"
        '  "is_on_topic": <true|false>,\n'
        '  "reasoning":   "<lý do ngắn gọn bằng tiếng Việt, ≤50 từ>"\n'
        "}"
    )
    user = (
        f"# Đề bài (Part {part_num})\n"
        f"{question.strip()}\n\n"
        f"# Câu trả lời của thí sinh\n"
        f"{transcript.strip()}"
    )
    return system, user


# ── Output parser ─────────────────────────────────────────────────────────────


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_judge_response(raw: str) -> OffTopicVerdict:
    """Parse the judge's raw text into a :class:`OffTopicVerdict`.

    Raises :class:`NonRetryableError` on schema / JSON failure so the
    orchestrator (if we ever re-invoke) treats parse errors as
    non-retryable — there's no benefit to retrying a model that
    misunderstood the schema, and Phase B may tighten the parser.
    """
    if not raw:
        raise NonRetryableError(
            provider="judge_parser",
            status="empty_response",
            original=ValueError("judge returned empty string"),
        )

    cleaned = _FENCE_RE.sub("", raw).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise NonRetryableError(
            provider="judge_parser",
            status="json_decode_error",
            original=exc,
        ) from exc

    is_on_topic = data.get("is_on_topic")
    if not isinstance(is_on_topic, bool):
        raise NonRetryableError(
            provider="judge_parser",
            status="schema_error",
            original=ValueError(
                f"is_on_topic must be bool, got {type(is_on_topic).__name__}"
            ),
        )

    raw_reasoning = (data.get("reasoning") or "").strip()
    words = raw_reasoning.split()
    if len(words) > REASONING_WORD_CAP:
        raw_reasoning = " ".join(words[:REASONING_WORD_CAP])

    return OffTopicVerdict(is_on_topic=is_on_topic, reasoning=raw_reasoning)


# ── Judge service ─────────────────────────────────────────────────────────────


class OffTopicJudge:
    """LLM judge fronted by the Sprint 14.3 orchestrator.

    Constructed once at app boot with the production orchestrator (the
    same instance the grader uses). Tests inject a fake orchestrator
    via the constructor.

    All public coroutines are designed to *never* raise: the contract
    with the grading endpoint is "best-effort signal, never block
    grading on judge failure" (L11).
    """

    def __init__(
        self,
        orchestrator: GradingOrchestrator,
        timeout_seconds: float = JUDGE_TIMEOUT_SECONDS,
    ):
        self._orchestrator    = orchestrator
        self._timeout_seconds = timeout_seconds

    async def judge(
        self,
        *,
        question:    str,
        transcript:  str,
        part_num:    int,
        user_id:     Optional[str] = None,
        session_id:  Optional[str] = None,
        question_id: Optional[str] = None,
        response_id: Optional[str] = None,
    ) -> Optional[OffTopicVerdict]:
        """Run the off-topic judge.

        Returns:
            :class:`OffTopicVerdict` on success.
            ``None`` if (a) all providers failed (L11), (b) the call
            exceeded ``timeout_seconds`` (L13), or (c) the empty inputs
            short-circuited the call. Callers must treat ``None`` as
            "no signal" — render no banner, log no warning to user.
        """
        from services import provider_fixtures
        if provider_fixtures.fixture_mode_enabled():
            # Deterministic on-topic verdict — the judge is a REAL Haiku call
            # otherwise, and an off-topic ruling on the fixed transcript would
            # skew the fixture band (observed live: 6.0 -> 5).
            return OffTopicVerdict(is_on_topic=True, reasoning="Fixture mode — luôn on-topic.")
        if not transcript.strip() or not question.strip():
            # Defensive — Whisper / question text validation should catch
            # this upstream, but if a junk pair slips through we skip
            # silently rather than burning a Haiku call on nonsense.
            return None

        system_prompt, user_message = build_judge_prompt(
            question, transcript, part_num,
        )

        events: list[FallbackEvent] = []
        verdict: Optional[OffTopicVerdict] = None

        try:
            verdict = await asyncio.wait_for(
                self._invoke(
                    system_prompt=system_prompt,
                    user_message=user_message,
                    user_id=user_id,
                    session_id=session_id,
                    events_sink=events,
                ),
                timeout=self._timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.info(
                "[off_topic_judge] timeout after %.1fs — silent skip (L13)",
                self._timeout_seconds,
            )
            events.append(FallbackEvent(
                provider="off_topic_judge",
                attempt=0,
                outcome="non_retryable",
                latency_ms=int(self._timeout_seconds * 1000),
                error_status="timeout",
                error_type="TimeoutError",
            ))
        except AllProvidersFailedError as exc:
            logger.info(
                "[off_topic_judge] all providers failed — silent skip (L11): %d events",
                len(exc.events),
            )
            events = list(exc.events)
        except NonRetryableError as exc:
            # Parse failure — fall through to silent skip after logging.
            logger.info(
                "[off_topic_judge] judge response unparseable (%s) — silent skip",
                exc.status,
            )
            events.append(FallbackEvent(
                provider="judge_parser",
                attempt=0,
                outcome="non_retryable",
                latency_ms=0,
                error_status=str(exc.status) if exc.status is not None else "parse_error",
                error_type=type(exc.original).__name__ if exc.original else "NonRetryableError",
            ))

        # Always persist whatever events the judge produced. Telemetry
        # writes are themselves best-effort (log_fallback_events
        # swallows DB errors), so this never blocks the response.
        if events:
            log_fallback_events(
                session_id=session_id,
                question_id=question_id,
                response_id=response_id,
                events=events,
                event_kind="off_topic_judge",
            )

        return verdict

    async def _invoke(
        self,
        *,
        system_prompt: str,
        user_message:  str,
        user_id:       Optional[str],
        session_id:    Optional[str],
        events_sink:   list[FallbackEvent],
    ) -> OffTopicVerdict:
        """Drive the orchestrator + parse the result.

        Separated from :meth:`judge` so the timeout wrapper sees a clean
        coroutine boundary and ``events_sink`` is populated even when
        the outer ``wait_for`` cancels us mid-call.
        """
        raw, events = await self._orchestrator.invoke(
            system_prompt,
            user_message,
            user_id=user_id,
            session_id=session_id,
        )
        events_sink.extend(events)
        return parse_judge_response(raw)


# ── Module-level singleton + bootstrap helper ─────────────────────────────────


_judge: OffTopicJudge | None = None


def get_judge() -> OffTopicJudge:
    """Lazy-construct the production judge using the same orchestrator
    config as the grader. Safe to call from every request handler.
    """
    global _judge
    if _judge is None:
        from config import settings as _settings
        from .grading_orchestrator import build_default
        _judge = OffTopicJudge(build_default(_settings))
    return _judge


def set_judge(judge: OffTopicJudge | None) -> None:
    """Test hook — inject a stub judge, or pass ``None`` to reset."""
    global _judge
    _judge = judge
