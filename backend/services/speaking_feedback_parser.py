"""services/speaking_feedback_parser.py — Speaking feedback TEXT-as-JSON parser.

`responses.feedback` is a TEXT column containing JSON-as-string (legacy schema —
the table predates the project's JSONB convention). This module provides safe
parsing with graceful fallback so dashboards / aggregators never crash on a
single malformed row.

Future migration path (Sprint 5.x): when `responses.feedback_json` (JSONB) is
populated by the grading pipeline, switch the parser to read JSONB first and
fall back to TEXT parsing for legacy rows. Audit 2026-05-08: the JSONB column
does NOT currently exist on the responses table, so any "feedback_json"-aware
code path here would be dead until that migration ships. Out of scope for 5.0.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class GrammarRecommendation(BaseModel):
    """One grammar-wiki recommendation entry inside the feedback JSON."""
    issue: str
    slug: str
    category: str
    title: str
    score: float = 0.0
    anchor: Optional[str] = None


class FeedbackCorrection(BaseModel):
    """One mistake + correction + explanation triple."""
    original: str
    corrected: str
    explanation: str


class SpeakingFeedback(BaseModel):
    """Parsed speaking feedback. Every field is optional / has a default so a
    partially-parsed row is still usable downstream (renderer can just skip
    empty sections).

    `parse_failed` is the sentinel the dashboard uses to decide whether to
    show "feedback unavailable" UX vs the normal feedback render. Spec called
    this `_parse_failed`, but Pydantic v2 reserves leading-underscore field
    names for `PrivateAttr`; renamed to `parse_failed` (no underscore) so it
    parses as a regular field.
    """
    grammar_issues: list[str] = Field(default_factory=list)
    vocabulary_issues: list[str] = Field(default_factory=list)
    pronunciation_issues: list[str] = Field(default_factory=list)
    corrections: list[FeedbackCorrection] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    sample_answer: Optional[str] = None
    overall_band: Optional[float] = None
    grammar_recommendations: list[GrammarRecommendation] = Field(default_factory=list)

    parse_failed: bool = False


def parse_speaking_feedback(feedback_text: Optional[str]) -> SpeakingFeedback:
    """Parse `responses.feedback` TEXT into a structured `SpeakingFeedback`.

    Returns an instance with `parse_failed=True` when:
      - feedback_text is None or empty/whitespace
      - the JSON is malformed
      - the top-level value isn't a dict
      - strict Pydantic validation fails (lenient extraction is then used,
        and `parse_failed` is still set so callers know the result is partial)

    Never raises — the speaking dashboard must always render *something* even
    for old rows that pre-date the current feedback shape. A `logger.warning`
    is emitted for every fallback path so production monitoring can spot
    drift before it shows up in the UI.
    """
    if not feedback_text or not feedback_text.strip():
        return SpeakingFeedback(parse_failed=True)

    try:
        data = json.loads(feedback_text)
    except json.JSONDecodeError as e:
        logger.warning(
            "[speaking-feedback] JSON parse failed: %s. Text length: %d",
            e, len(feedback_text),
        )
        return SpeakingFeedback(parse_failed=True)

    if not isinstance(data, dict):
        logger.warning(
            "[speaking-feedback] Top-level value not a dict; got %s",
            type(data).__name__,
        )
        return SpeakingFeedback(parse_failed=True)

    try:
        return SpeakingFeedback(**data)
    except Exception as e:  # noqa: BLE001 — we want every validation failure
        logger.warning(
            "[speaking-feedback] Pydantic validation failed: %s. "
            "Falling back to lenient parse.",
            e,
        )
        return _lenient_parse(data)


def _lenient_parse(data: dict) -> SpeakingFeedback:
    """Best-effort field extraction when strict validation rejects the dict.

    Each list field is filtered to the items that match the expected shape;
    individual malformed items are dropped, the rest are kept. The
    `parse_failed` flag stays `True` so callers can distinguish a clean
    parse from a salvage parse — useful for monitoring + UX hints
    ("we recovered most of the feedback but some sections may be missing").
    """
    result = SpeakingFeedback(parse_failed=True)

    # Simple list-of-string fields.
    for field in ("grammar_issues", "vocabulary_issues",
                  "pronunciation_issues", "strengths"):
        value = data.get(field)
        if isinstance(value, list):
            setattr(result, field, [str(item) for item in value if item])

    # Scalar fields.
    if isinstance(data.get("sample_answer"), str):
        result.sample_answer = data["sample_answer"]
    if isinstance(data.get("overall_band"), (int, float)):
        result.overall_band = float(data["overall_band"])

    # Nested objects: keep only items that have ALL required keys + parse cleanly.
    corrections = data.get("corrections")
    if isinstance(corrections, list):
        kept: list[FeedbackCorrection] = []
        for item in corrections:
            if not isinstance(item, dict):
                continue
            if not all(k in item for k in ("original", "corrected", "explanation")):
                continue
            try:
                kept.append(FeedbackCorrection(**item))
            except Exception:  # noqa: BLE001
                continue
        result.corrections = kept

    recommendations = data.get("grammar_recommendations")
    if isinstance(recommendations, list):
        kept_recs: list[GrammarRecommendation] = []
        for rec in recommendations:
            if not isinstance(rec, dict):
                continue
            # `issue`, `slug`, `title`, `category` are the load-bearing fields
            # for the recommendation card; `score` + `anchor` have defaults.
            if not all(k in rec for k in ("issue", "slug", "title", "category")):
                continue
            try:
                kept_recs.append(GrammarRecommendation(**rec))
            except Exception:  # noqa: BLE001
                continue
        result.grammar_recommendations = kept_recs

    return result
