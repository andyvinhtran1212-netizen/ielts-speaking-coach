"""Wire contracts for admin-owned sets and private, frozen study sessions."""
from typing import Literal, Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mode = Literal["flashcards", "learn", "cloze", "test"]
Rating = Literal["again", "hard", "good", "easy"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SetSave(StrictModel):
    expected_version: int = Field(ge=0)
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(default="", max_length=2000)
    card_ids: list[UUID] = Field(default_factory=list, max_length=200)
    library: bool = False
    course_ids: list[UUID] = Field(default_factory=list, max_length=50)
    cohort_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_members(self):
        if len(set(self.card_ids)) != len(self.card_ids):
            raise ValueError("Một từ chỉ xuất hiện một lần trong bộ.")
        return self


class SetAction(StrictModel):
    expected_version: int = Field(ge=1)
    action: Literal["publish", "archive"]


class SharedCard(StrictModel):
    id: str
    slug: str = ""
    category: str = ""
    headword: str
    gloss_vi: str = ""
    definition_en: str = ""
    pronunciation: str = ""
    part_of_speech: str = ""
    level: str = ""
    example: str = ""
    audio_headword: str = ""
    audio_example: str = ""


class CardCreate(StrictModel):
    headword: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=120)
    gloss_vi: str = Field(min_length=1, max_length=1000)
    definition_en: str = Field(default="", max_length=1000)
    pronunciation: str = Field(default="", max_length=160)
    part_of_speech: str = Field(default="", max_length=80)
    level: str = Field(default="", max_length=20)
    example: str = Field(default="", max_length=2000)


class ProgressOut(StrictModel):
    card_id: str
    familiar: bool = False
    recall_attempts: int = 0
    recall_correct: int = 0
    next_review_at: str | None = None
    review_count: int = 0


class PublishedSetInfo(StrictModel):
    title: str
    library: bool
    course_ids: list[str]
    cohort_ids: list[str]


class SetOut(StrictModel):
    id: str
    title: str
    description: str = ""
    status: Literal["draft", "published", "archived"]
    version: int
    published_revision: int = 0
    library: bool
    course_ids: list[str]
    cohort_ids: list[str]
    card_ids: list[str]
    cards: list[SharedCard] = Field(default_factory=list)
    progress: list[ProgressOut] = Field(default_factory=list)
    mode_counts: dict[Mode, int] = Field(default_factory=dict)
    published: PublishedSetInfo | None = None


class AudienceOption(StrictModel):
    id: str
    name: str
    course_id: str | None = None


class SessionBrief(StrictModel):
    id: str
    set_id: str
    title: str
    mode: Mode
    completed: bool
    answered: int
    total: int
    correct: int | None = None
    created_at: str


class CatalogOut(StrictModel):
    sets: list[SetOut]
    courses: list[AudienceOption]
    cohorts: list[AudienceOption]
    sessions: list[SessionBrief] = Field(default_factory=list)


class CardSearchOut(StrictModel):
    cards: list[SharedCard]


class SessionStart(StrictModel):
    client_id: UUID
    mode: Mode
    review_only: bool = False


class StudyItem(StrictModel):
    card_id: str
    prompt: str
    card: SharedCard | None = None


class AnswerOut(StrictModel):
    index: int
    answer: str = ""
    expected: str = ""
    correct: bool | None = None
    rating: Rating | None = None


class SessionOut(StrictModel):
    id: str
    set_id: str
    title: str
    revision: int
    mode: Mode
    items: list[StudyItem]
    answers: list[AnswerOut]
    completed: bool
    correct: int | None = None


class StudyAnswer(StrictModel):
    client_id: UUID
    index: int = Field(ge=0, le=199)
    answer: str = Field(default="", max_length=200)
    rating: Rating | None = None


class TestSubmit(StrictModel):
    client_id: UUID
    answers: list[Annotated[str, Field(max_length=200)]] = Field(max_length=200)


class LearnerOutcome(StrictModel):
    user_id: str
    name: str
    sessions: list[SessionBrief]


class OutcomesOut(StrictModel):
    learners: list[LearnerOutcome]
