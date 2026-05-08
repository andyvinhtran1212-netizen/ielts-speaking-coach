"""services/speaking_feedback_parser.py — Speaking feedback TEXT-as-JSON parser.

`responses.feedback` is a TEXT column containing JSON-as-string (legacy schema —
the table predates the project's JSONB convention). This module provides safe
parsing with graceful fallback so dashboards / aggregators never crash on a
single malformed row.

Sprint 5.0.1: production has TWO intentional feedback shapes, not one. The
mode of the parent session decides which shape the grader emits:

  mode='practice'                  → Shape A (SpeakingFeedbackPractice):
                                     analytical issues + corrections
                                     + sample answer + grammar recommendations.
  mode='test_full' / 'test_part'   → Shape B (SpeakingFeedbackTest):
                                     IELTS-rubric 4 criteria + per-criterion
                                     feedback + improvements + improved response.

Distribution at audit time (2026-05-08):
  Shape A — 427 rows  (~35%, practice mode)
  Shape B — 801 rows  (~65%, test modes)
  Anomaly —  ~8 rows  (practice mode emitting Shape B fields). Out of scope —
            the dispatcher defaults the both-signatures case to Shape B.

Both shapes are intentional production designs, not legacy migrations. Sprint
5.1 dashboard renders them with different layouts.

Future migration path: when `responses.feedback_json` (JSONB) is populated by
the grading pipeline, switch to JSONB-first reads with TEXT fallback for
legacy rows. Audit 2026-05-08: the JSONB column does NOT currently exist.
"""

from __future__ import annotations

import json
import logging
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ── Shape A — Practice mode ───────────────────────────────────────────


class GrammarRecommendation(BaseModel):
    """One grammar-wiki recommendation entry inside Shape A feedback."""
    issue: str
    slug: str
    category: str
    title: str
    score: float = 0.0
    anchor: Optional[str] = None


class FeedbackCorrection(BaseModel):
    """One mistake + correction + explanation triple (Shape A only)."""
    original: str
    corrected: str
    explanation: str


class SpeakingFeedbackPractice(BaseModel):
    """Shape A — practice-mode grading.

    Analytical: lists of issues, sentence-level corrections, a model
    sample answer, and grammar-wiki recommendations. The dashboard
    renders this with issue cards + a "compare your answer to this"
    sample. `parse_failed=True` marks salvage parses; consumers can
    use it to decide whether to show a "feedback unavailable" hint.
    """
    # Discriminator field. Lets consumers `match` / `switch` on
    # `result.shape` instead of (or in addition to) `isinstance` —
    # useful for serialisation paths that don't preserve types.
    shape: Literal["practice"] = "practice"

    grammar_issues: list[str] = Field(default_factory=list)
    vocabulary_issues: list[str] = Field(default_factory=list)
    pronunciation_issues: list[str] = Field(default_factory=list)
    corrections: list[FeedbackCorrection] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    sample_answer: Optional[str] = None
    overall_band: Optional[float] = None
    grammar_recommendations: list[GrammarRecommendation] = Field(default_factory=list)

    # `parse_failed` (no leading underscore — Pydantic v2 reserves
    # leading-underscore field names for PrivateAttr). Set to True on
    # any fallback / lenient parse so callers can tell a clean parse
    # apart from a salvage parse.
    parse_failed: bool = False


# ── Shape B — Test mode ───────────────────────────────────────────────


class SpeakingFeedbackTest(BaseModel):
    """Shape B — test-mode grading (test_full / test_part).

    IELTS-rubric 4 criteria with per-criterion feedback strings, a
    short improvements list, and a single improved-response rewrite.
    Per-criterion bands are 0.0–9.0 floats (Speaking allows
    half-bands at the criterion level too, unlike Writing).
    """
    shape: Literal["test"] = "test"

    # Per-criterion bands.
    band_fc: Optional[float] = None       # Fluency & Coherence
    band_lr: Optional[float] = None       # Lexical Resource
    band_gra: Optional[float] = None      # Grammatical Range & Accuracy
    band_p: Optional[float] = None        # Pronunciation
    overall_band: Optional[float] = None

    # Per-criterion feedback strings.
    fc_feedback: Optional[str] = None
    lr_feedback: Optional[str] = None
    gra_feedback: Optional[str] = None
    p_feedback: Optional[str] = None

    # Common shape elements.
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    improved_response: Optional[str] = None

    parse_failed: bool = False


# Type alias for the function return + consumer type hints. Two
# distinct Pydantic models (rather than one superset with Optional
# fields) keep the type semantics honest — Shape A consumers get
# autocomplete only on Shape A fields, and isinstance narrowing
# works cleanly in mypy/pyright.
SpeakingFeedback = Union[SpeakingFeedbackPractice, SpeakingFeedbackTest]


# ── Shape detection ───────────────────────────────────────────────────
#
# Signature keys are EXCLUSIVE to one shape — they don't appear in the
# other. Common fields (`overall_band`, `strengths`) are NOT used for
# detection because they're ambiguous. Detection MUST be deterministic
# even when a row is sparse (e.g., a Shape B row that only got
# `band_fc` populated before the grader bailed).

SHAPE_A_SIGNATURE_KEYS: frozenset[str] = frozenset({
    "grammar_issues",
    "vocabulary_issues",
    "corrections",
})

SHAPE_B_SIGNATURE_KEYS: frozenset[str] = frozenset({
    "band_fc", "band_lr", "band_gra", "band_p",
    "fc_feedback", "lr_feedback", "gra_feedback", "p_feedback",
})


def _detect_shape(data: dict) -> Optional[Literal["practice", "test"]]:
    """Identify the feedback shape from the top-level keys of `data`.

    Returns:
      "practice" — at least one Shape A signature key, no Shape B keys
      "test"     — at least one Shape B signature key, no Shape A keys
                   (also: BOTH signatures present — anomaly fallback)
      None       — neither signature present (unknown shape; caller
                   may fall back to a lenient Shape A attempt as
                   the legacy default).

    Anomaly: ~8 production rows (mode='practice' but Shape B fields
    present) get classified as "test" — Shape B is the more recent,
    rubric-aligned grading flow, so falling back to it preserves
    more information. The decision is logged so monitoring can spot
    if the count grows.
    """
    has_a = any(key in data for key in SHAPE_A_SIGNATURE_KEYS)
    has_b = any(key in data for key in SHAPE_B_SIGNATURE_KEYS)

    if has_a and has_b:
        logger.warning(
            "[speaking-feedback] both shape signatures present (anomaly); "
            "defaulting to 'test'. Top-level keys: %s",
            sorted(data.keys())[:12],
        )
        return "test"
    if has_a:
        return "practice"
    if has_b:
        return "test"
    return None


# ── Public API ────────────────────────────────────────────────────────


def parse_speaking_feedback(feedback_text: Optional[str]) -> SpeakingFeedback:
    """Parse `responses.feedback` TEXT into the appropriate shape model.

    Auto-detects Shape A (practice) or Shape B (test) and returns the
    matching Pydantic model. Use `isinstance(result, SpeakingFeedbackTest)`
    or `result.shape == "test"` to narrow downstream.

    Returns a `SpeakingFeedbackPractice(parse_failed=True)` (the
    legacy default, preserves Sprint 5.0 behaviour for callers that
    don't yet care about Shape B) when:
      - feedback_text is None / empty / whitespace
      - JSON is malformed
      - top-level value isn't a dict
      - shape can't be detected (no signature keys present at all)

    Returns a Shape-specific model with `parse_failed=True` when the
    shape was detected but strict Pydantic validation rejected the
    payload — the lenient extractor then runs to salvage what it can.

    Never raises. The Speaking dashboard always gets a renderable
    object even for old rows that pre-date the current shape.
    """
    if not feedback_text or not feedback_text.strip():
        return SpeakingFeedbackPractice(parse_failed=True)

    try:
        data = json.loads(feedback_text)
    except json.JSONDecodeError as e:
        logger.warning(
            "[speaking-feedback] JSON parse failed: %s. Length: %d",
            e, len(feedback_text),
        )
        return SpeakingFeedbackPractice(parse_failed=True)

    if not isinstance(data, dict):
        logger.warning(
            "[speaking-feedback] Top-level value not a dict; got %s",
            type(data).__name__,
        )
        return SpeakingFeedbackPractice(parse_failed=True)

    shape = _detect_shape(data)

    if shape is None:
        # Unknown shape — preserve Sprint 5.0's default behaviour
        # (return a Shape A salvage parse with parse_failed=True).
        # Logging here so monitoring can spot if "no signature"
        # rows start accumulating (could mean a third shape is
        # being introduced quietly).
        logger.warning(
            "[speaking-feedback] shape undetectable; falling back to "
            "lenient practice parse. Top-level keys: %s",
            sorted(data.keys())[:12],
        )
        return _lenient_parse_practice(data)

    if shape == "practice":
        return _parse_practice(data)
    return _parse_test(data)


# ── Per-shape strict + lenient parsers ────────────────────────────────


def _parse_practice(data: dict) -> SpeakingFeedbackPractice:
    """Strict Pydantic parse for Shape A; lenient salvage on failure."""
    try:
        return SpeakingFeedbackPractice(**data)
    except Exception as e:  # noqa: BLE001 — every validation failure
        logger.warning(
            "[speaking-feedback] practice strict parse failed: %s. "
            "Falling back to lenient.",
            e,
        )
        return _lenient_parse_practice(data)


def _parse_test(data: dict) -> SpeakingFeedbackTest:
    """Strict Pydantic parse for Shape B; lenient salvage on failure."""
    try:
        return SpeakingFeedbackTest(**data)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[speaking-feedback] test strict parse failed: %s. "
            "Falling back to lenient.",
            e,
        )
        return _lenient_parse_test(data)


def _lenient_parse_practice(data: dict) -> SpeakingFeedbackPractice:
    """Best-effort Shape A salvage. Drops malformed nested items
    individually; keeps the rest. `parse_failed` stays True so
    callers can distinguish a clean parse from a salvage parse.
    """
    result = SpeakingFeedbackPractice(parse_failed=True)

    for field in ("grammar_issues", "vocabulary_issues",
                  "pronunciation_issues", "strengths"):
        value = data.get(field)
        if isinstance(value, list):
            setattr(result, field, [str(item) for item in value if item])

    if isinstance(data.get("sample_answer"), str):
        result.sample_answer = data["sample_answer"]
    if isinstance(data.get("overall_band"), (int, float)):
        result.overall_band = float(data["overall_band"])

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
            if not all(k in rec for k in ("issue", "slug", "title", "category")):
                continue
            try:
                kept_recs.append(GrammarRecommendation(**rec))
            except Exception:  # noqa: BLE001
                continue
        result.grammar_recommendations = kept_recs

    return result


def _lenient_parse_test(data: dict) -> SpeakingFeedbackTest:
    """Best-effort Shape B salvage. Drops fields with the wrong type;
    keeps anything coercible.
    """
    result = SpeakingFeedbackTest(parse_failed=True)

    # Numeric band fields. Reject strings ("5.0") — they're typically
    # an upstream serialisation bug and silently coercing them hides
    # the data-quality problem.
    for field in ("band_fc", "band_lr", "band_gra", "band_p", "overall_band"):
        value = data.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            setattr(result, field, float(value))

    for field in ("fc_feedback", "lr_feedback", "gra_feedback",
                  "p_feedback", "improved_response"):
        value = data.get(field)
        if isinstance(value, str):
            setattr(result, field, value)

    for field in ("strengths", "improvements"):
        value = data.get(field)
        if isinstance(value, list):
            setattr(result, field, [str(item) for item in value if item])

    return result
