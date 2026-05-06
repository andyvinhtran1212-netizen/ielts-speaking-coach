"""Pydantic models for Writing Coach AI grader output.

Matches TECHNICAL_SPEC.md Section 4 schema. Schema serializes/deserializes via
the `feedback_json` JSONB column on `writing_feedback` (migration 033).

Conditional analysis fields populate based on `analysis_level`:
  Level 1 — only mistakeAnalysis (others = None)
  Level 2 — + coherenceAnalysis
  Level 3 — + ideaDevelopmentAnalysis, counterargumentAnalysis (T2 only)
  Level 4-5 — + lexicalAnalysis, sentenceStructureAnalysis
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, conint, confloat, model_validator


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
    """Wrapper around feedback + metadata."""

    feedback: WritingFeedback

    model_used: str
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    cost_usd: Optional[float] = None
    grading_duration_ms: int
    prompt_version: str
