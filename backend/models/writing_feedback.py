"""Pydantic models for Writing Coach AI grader output.

Matches TECHNICAL_SPEC.md Section 4 schema. Schema serializes/deserializes via
the `feedback_json` JSONB column on `writing_feedback` (migration 033).

Conditional analysis fields populate based on `analysis_level`:
  Level 1 — only mistakeAnalysis (others = None)
  Level 2 — + coherenceAnalysis
  Level 3 — + ideaDevelopmentAnalysis, counterargumentAnalysis (T2 only)
  Level 4-5 — + lexicalAnalysis, sentenceStructureAnalysis
"""

from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, conint, confloat, model_validator


# ── Sprint 2.7a — grading tier ────────────────────────────────────────

class GradingTier(str, Enum):
    """Grading depth tier (Sprint 2.7a foundation; Quick removed 2.7a.1).

    standard   — Pro model, full 12-section analysis. The only tier that
                 runs an actual Gemini call today.
    quick      — Removed in Sprint 2.7a.1. The 5-section subset conflicted
                 with Levels L3-L5 which target sections Quick dropped
                 (counterargument, lexical, sentence-structure). The enum
                 value stays so legacy rows + Postgres `grading_tier_enum`
                 don't need a destructive migration; the API layer rejects
                 with 400 and the grader raises ValueError as defence-in-
                 depth.
    deep       — Pro multi-pass + sentence rewrite. Sprint 2.7b (reserved).
    instructor — AI Standard + human edit + note. Sprint 2.7c (reserved).

    Reserved values raise NotImplementedError in the grader until 2.7b/c
    land. Legacy enum value stays so migration 044 + the database enum
    type don't churn; pruning Postgres enum values is a destructive,
    multi-step operation we explicitly chose not to do (TECH_DEBT #36).
    """
    QUICK = "quick"          # removed 2.7a.1; enum value retained
    STANDARD = "standard"
    DEEP = "deep"
    INSTRUCTOR = "instructor"


# ── Sub-types ─────────────────────────────────────────────────────────

class SuggestionInstructionExample(BaseModel):
    """Suggestion với hướng dẫn + ví dụ cụ thể.

    Tolerant of Gemini occasionally returning a plain string instead of the
    {instruction, example} object the schema requires. Strings are coerced
    to {instruction: <str>, example: ""}; the prompt's strict-format rules
    drive the correct shape long-term while this validator absorbs edge
    cases (W2.1 patch — production essay f5b9e78b regression).
    """
    instruction: str
    example: str = ""

    @model_validator(mode="before")
    @classmethod
    def _coerce_string_to_object(cls, data):
        if isinstance(data, str):
            return {"instruction": data, "example": ""}
        return data


class CriteriaFeedback(BaseModel):
    """Feedback cho 1 trong 4 IELTS criteria."""
    title: str
    explanation: str
    feedback: str
    bandScore: conint(ge=0, le=9)


class CriteriaFeedbackBundle(BaseModel):
    """All 4 IELTS criteria scores bundled."""
    mainCriterion: CriteriaFeedback           # Task Response (T2) hoặc Task Achievement (T1)
    coherenceCohesion: CriteriaFeedback
    lexicalResource: CriteriaFeedback
    grammaticalRange: CriteriaFeedback


class KeyTakeaways(BaseModel):
    strengths: List[str]
    areasForImprovement: List[str]


class MistakeAnalysis(BaseModel):
    original: str
    mistakeType: str
    explanation: str
    suggestion: str
    criterion: str


class IdeaDevelopmentAnalysis(BaseModel):
    paragraph: int
    originalIdea: str
    issue: str
    explanation: str
    suggestion: SuggestionInstructionExample


class CoherenceAnalysisItem(BaseModel):
    location: str = ""  # Default empty; Gemini sometimes omits this field
    issue: str
    explanation: str
    suggestion: SuggestionInstructionExample


class ContextInsertion(BaseModel):
    """Where + why a counterargument should be inserted.

    Tolerant of Gemini's occasional bare-string returns or partial dicts
    (W3.3 patch — production essay 1eccf880 regression where the field
    came through as part of a hallucinated parent shape).
    """
    insertionPoint: str = ""
    reasoning: str = ""

    @model_validator(mode="before")
    @classmethod
    def _coerce_string_or_partial(cls, data):
        if isinstance(data, str):
            return {"insertionPoint": data, "reasoning": ""}
        if data is None or not isinstance(data, dict):
            return {"insertionPoint": "", "reasoning": ""}
        return data


class CounterargumentAnalysis(BaseModel):
    """Counterargument feedback (Task 2 only).

    W3.3 patch: Gemini occasionally returns a hallucinated shape
    (e.g. {"promptType": "Discuss both views..."}) rather than the
    full {isPresent, feedback, suggestion, context} contract. We
    drop unknown fields, default missing required ones, and never
    crash the grading pipeline on this section alone — a partial
    counterargumentAnalysis is much less harmful than a failed essay.
    """
    isPresent: bool = False
    feedback: str = ""
    suggestion: str = ""
    context: ContextInsertion = Field(default_factory=ContextInsertion)

    @model_validator(mode="before")
    @classmethod
    def _normalize_malformed(cls, data):
        if data is None or not isinstance(data, dict):
            return {
                "isPresent": False,
                "feedback": "",
                "suggestion": "",
                "context": {"insertionPoint": "", "reasoning": ""},
            }
        # Pick known fields, drop unknown (e.g. Gemini's "promptType").
        # Missing fields fall back to the field defaults above.
        return {
            "isPresent":  data.get("isPresent", False),
            "feedback":   data.get("feedback", ""),
            "suggestion": data.get("suggestion", ""),
            "context":    data.get("context", {"insertionPoint": "", "reasoning": ""}),
        }


class WordToUpgradeItem(BaseModel):
    original: str
    context: str
    suggestions: List[str]
    category: str


class LexicalAnalysis(BaseModel):
    wordsToUpgrade: List[WordToUpgradeItem]


class AIContentAnalysis(BaseModel):
    likelihood: conint(ge=0, le=100)
    explanation: str


# ── Main schema ───────────────────────────────────────────────────────

class WritingFeedback(BaseModel):
    """Full IELTS writing analysis output từ Gemini.

    Matches TECHNICAL_SPEC.md Section 4. Conditional fields populate per
    analysis_level (Level 1 minimal → Level 5 full).
    """

    # Required for all levels
    overallBandScore: confloat(ge=0, le=9)
    overallBandScoreSummary: str
    keyTakeaways: KeyTakeaways
    criteriaFeedback: CriteriaFeedbackBundle
    mistakeAnalysis: List[MistakeAnalysis]
    aiContentAnalysis: AIContentAnalysis
    improvedEssay: str

    # Conditional (None on Level 1)
    ideaDevelopmentAnalysis: Optional[List[IdeaDevelopmentAnalysis]] = None
    coherenceAnalysis: Optional[List[CoherenceAnalysisItem]] = None
    counterargumentAnalysis: Optional[CounterargumentAnalysis] = None
    lexicalAnalysis: Optional[LexicalAnalysis] = None

    # `sentenceStructureAnalysis` carries TWO shapes since Phase 1.5c
    # (2026-05-06 PM):
    #
    #   • Legacy (level 4/5, no history block):
    #       {"sentenceUpgrades": [{original, rewritten, explanation}, ...]}
    #     Emitted by the L4/L5 system prompts (system_l4_*.md +
    #     system_l5_*.md).  Consumed by writing_word_exporter +
    #     templates/writing/output.html.j2 which both detect this
    #     shape via the `sentenceUpgrades` key.
    #
    #   • Phase 1.5c (history-aware, ≥5 graded essays):
    #       {"summary", "common_issues":[{pattern,count,examples}],
    #        "complexity_indicator", "current_essay_observation",
    #        "focus_theme":{title, why, this_week_practice}}
    #     Emitted when format_history_for_prompt's SS block instructs
    #     Gemini to override the legacy shape.  Consumed by the
    #     student-facing renderer in writing-result.html.
    #
    # Field is `Optional[dict]` rather than a strict Pydantic class so
    # both shapes parse without a Union type — every consumer
    # discriminates on the `summary` vs `sentenceUpgrades` key.
    sentenceStructureAnalysis: Optional[dict] = None

    # Phase 1.5 forward-compatibility — None on Phase 1.
    # Phase 1.5a (recurringPatterns): the grader prompt now instructs
    # Gemini to emit `{summary, improvements, stillRecurring}` when the
    # student has ≥5 graded essays; otherwise this stays null.
    bandTrajectoryAnalysis: Optional[dict] = None
    recurringPatterns: Optional[dict] = None


# ── Sprint 2.7b — Deep tier (multi-pass + sentence rewrite) ───────────

class SentenceRewrite(BaseModel):
    """Pass 3 output: a rewrite of one sentence that contained mistakes.

    Sprint 2.7b. The rewrite addresses every mistake whose index appears
    in `mistakes_addressed` and stays close to the student's original
    register (per Rule 5 — improved-essay realism cap of +1.5 bands).
    `mistakes_addressed` indexes into the merged `mistakeAnalysis` list
    on the parent `WritingFeedbackDeep`.
    """
    original_sentence: str
    rewritten_sentence: str
    mistakes_addressed: List[int] = Field(default_factory=list)
    rationale: str = ""


class CriterionAdjustments(BaseModel):
    """Pass 2 band-score adjustments. Each field is the new value the
    refinement pass wants applied (or None to leave Pass 1's score
    unchanged). Names mirror the nested CriteriaFeedbackBundle keys.
    """
    overall: Optional[float] = None
    mainCriterion: Optional[int] = None
    coherenceCohesion: Optional[int] = None
    lexicalResource: Optional[int] = None
    grammaticalRange: Optional[int] = None


class Pass2Refinement(BaseModel):
    """Pass 2 (refinement) Gemini output — Sprint 2.7b.

    The refinement pass is a delta against Pass 1, not a re-grade.
    Empty arrays + all-None adjustments mean "Pass 1 was correct, no
    changes" — that is the expected outcome for ~well-written essays
    and the prompt explicitly tells the model never to invent changes
    just to look productive.
    """
    band_score_adjustments: CriterionAdjustments = Field(default_factory=CriterionAdjustments)
    added_mistakes: List[MistakeAnalysis] = Field(default_factory=list)
    removed_mistake_indexes: List[int] = Field(default_factory=list)
    rationale: str = ""


class Pass3Rewrites(BaseModel):
    """Pass 3 (sentence rewrite) Gemini output — Sprint 2.7b."""
    sentence_rewrites: List[SentenceRewrite] = Field(default_factory=list)


class WritingFeedbackDeep(WritingFeedback):
    """Deep tier output — Sprint 2.7b.

    Extends WritingFeedback (the Standard 12-section schema) with two
    Deep-only fields. Subclassing keeps the existing persistence path
    (`fb.criteriaFeedback.mainCriterion.bandScore` etc.) unchanged
    when the row was graded in Deep — `essay_service._bg_grade_essay`
    pulls from the same nested fields.

      sentenceRewrites    — Pass 3 output, one rewrite per sentence
                            that contained a mistake.
      pass2_refinements   — raw Pass 2 output (adjustments + rationale)
                            stored alongside for transparency. Frontend
                            shows the rationale string; the rest is
                            kept for audit/debugging.
    """
    sentenceRewrites: List[SentenceRewrite] = Field(default_factory=list)
    pass2_refinements: Optional[Pass2Refinement] = None


# ── Input/config types ────────────────────────────────────────────────

class GraderConfig(BaseModel):
    """Configuration for grade_essay() call."""

    task_type: Literal['task1_academic', 'task1_general', 'task2']
    # Defense-in-depth size caps — router validates first; this layer
    # protects direct callers (BG re-grade, future scripts) (W2.2 audit).
    prompt_text: str = Field(..., max_length=5000)
    essay_text:  str = Field(..., max_length=10000)

    analysis_level: conint(ge=1, le=5)
    form_of_address: Literal['bạn', 'em', 'anh', 'chị'] = 'em'
    selected_model: Literal['gemini-2.5-pro', 'gemini-2.5-flash'] = 'gemini-2.5-pro'

    # Sprint 2.7a — grading depth tier. Default 'standard' so historical
    # callers and existing tests keep their pre-2.7a behaviour. Quick
    # tier overrides `selected_model` internally inside the grader (Quick
    # always uses GEMINI_FLASH_MODEL regardless of this field's value).
    grading_tier: GradingTier = GradingTier.STANDARD

    # Phase 1.5a (recurring-patterns aggregator): pre-aggregated dict
    # produced by services.writing_history.get_recurring_patterns(),
    # consumed by services.writing_history.format_history_for_prompt()
    # inside _build_user_prompt. None when the student has <5 essays
    # OR when the history lookup failed (degrade-to-no-history is
    # intentional — see writing_history.py).
    history: Optional[dict] = None

    # Phase 1.5b (band-trajectory aggregator): pre-aggregated dict
    # produced by services.writing_history.get_band_trajectory(),
    # passed alongside `history` into format_history_for_prompt().
    # Same threshold + degrade-on-failure semantics. Kept as a
    # parallel field rather than nested under `history` so the
    # Phase 1.5a contract on `history` stays unchanged.
    trajectory: Optional[dict] = None

    # Phase 1.5c (sentence-structure history aggregator): pre-aggregated
    # dict produced by services.writing_history.get_sentence_structure_history().
    # Mirrors `history` / `trajectory` — same threshold, same
    # degrade-on-failure. Drives Gemini's emission of the structured
    # Phase-1.5c shape on `feedback_json.sentenceStructureAnalysis`
    # (overriding the L4/L5 system prompt's legacy `{sentenceUpgrades:
    # [...]}` shape — see `format_history_for_prompt` for the
    # explicit override instruction).
    sentence_structure: Optional[dict] = None


class GradingResult(BaseModel):
    """Wrapper around feedback + metadata.

    `feedback` is a WritingFeedback. Sprint 2.7a accepted WritingFeedbackQuick
    here too via a BaseModel union; Sprint 2.7a.1 removed Quick so the
    only live shape is WritingFeedback again. The base-class type hint
    is preserved (rather than narrowed to `WritingFeedback`) so future
    Deep/Instructor tier subclasses can flow through without re-touching
    this signature.
    """

    feedback: BaseModel

    model_used: str
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    cost_usd: Optional[float] = None
    grading_duration_ms: int
    prompt_version: str

    # Sprint 2.7a — surface tier on the result so callers (essay_service
    # persistence, future telemetry) can introspect without re-reading
    # the writing_essays row. Mirrors the value on GraderConfig.
    grading_tier: GradingTier = GradingTier.STANDARD

    # Sprint 2.7b — Deep tier per-pass metadata (timing, tokens, cost,
    # counts of refinements/rewrites). Empty {} for Standard tier; the
    # existing flat fields (model_used, tokens_input/output, cost_usd,
    # grading_duration_ms) cover Standard's single-pass story. Persisted
    # to `writing_essays.grading_tier_metadata` JSONB column. Keys
    # documented on that column's COMMENT (migration 046).
    tier_metadata: dict = Field(default_factory=dict)

    # Allow the BaseModel union (WritingFeedback OR WritingFeedbackDeep
    # in 2.7b; previously WritingFeedbackQuick before 2.7a.1's revert)
    # to flow through without strict-mode rejecting the subclass.
    model_config = {"arbitrary_types_allowed": True}
