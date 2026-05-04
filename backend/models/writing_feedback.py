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

from pydantic import BaseModel, conint, confloat


# ── Sub-types ─────────────────────────────────────────────────────────

class SuggestionInstructionExample(BaseModel):
    """Suggestion với hướng dẫn + ví dụ cụ thể."""
    instruction: str
    example: str


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
    location: str
    issue: str
    explanation: str
    suggestion: SuggestionInstructionExample


class ContextInsertion(BaseModel):
    insertionPoint: str
    reasoning: str


class CounterargumentAnalysis(BaseModel):
    isPresent: bool
    feedback: str
    suggestion: str
    context: ContextInsertion


class WordToUpgradeItem(BaseModel):
    original: str
    context: str
    suggestions: List[str]
    category: str


class LexicalAnalysis(BaseModel):
    wordsToUpgrade: List[WordToUpgradeItem]


class SentenceUpgradeItem(BaseModel):
    original: str
    rewritten: str
    explanation: str


class SentenceStructureAnalysis(BaseModel):
    sentenceUpgrades: List[SentenceUpgradeItem]


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
    sentenceStructureAnalysis: Optional[SentenceStructureAnalysis] = None

    # Phase 1.5 forward-compatibility — None on Phase 1
    bandTrajectoryAnalysis: Optional[dict] = None
    recurringPatterns: Optional[List[dict]] = None


# ── Input/config types ────────────────────────────────────────────────

class GraderConfig(BaseModel):
    """Configuration for grade_essay() call."""

    task_type: Literal['task1_academic', 'task1_general', 'task2']
    prompt_text: str
    essay_text: str

    analysis_level: conint(ge=1, le=5)
    form_of_address: Literal['bạn', 'em', 'anh', 'chị'] = 'em'
    selected_model: Literal['gemini-2.5-pro', 'gemini-2.5-flash'] = 'gemini-2.5-pro'

    # Phase 1.5 forward-compatibility — unused Phase 1
    history: Optional[List[dict]] = None


class GradingResult(BaseModel):
    """Wrapper around feedback + metadata."""

    feedback: WritingFeedback

    model_used: str
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    cost_usd: Optional[float] = None
    grading_duration_ms: int
    prompt_version: str
