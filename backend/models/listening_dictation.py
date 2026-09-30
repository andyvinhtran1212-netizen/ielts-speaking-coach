"""Admin analytics read contract. Historical grades remain unchanged."""
from typing import Literal

from pydantic import BaseModel, Field


class DictationMissedWord(BaseModel):
    word: str
    count: int = Field(ge=1)


class DictationWrongWord(BaseModel):
    expected: str
    count: int = Field(ge=1)


class DictationPunctuationTrend(BaseModel):
    token: str
    count: int = Field(ge=1)


class DictationAggregateResponse(BaseModel):
    session_count: int = Field(ge=0)
    mean_accuracy: float = Field(ge=0, le=1)
    mean_accuracy_basis: Literal['mean_of_session_sentence_scores']
    trend_classification: Literal['lexical-v1']
    trend_complete_session_count: int = Field(ge=0)
    trend_unavailable_session_count: int = Field(ge=0)
    top_missed: list[DictationMissedWord]
    top_wrong: list[DictationWrongWord]
    punctuation_missed: list[DictationPunctuationTrend]
    punctuation_wrong: list[DictationPunctuationTrend]
    punctuation_missed_total: int = Field(ge=0)
    punctuation_wrong_total: int = Field(ge=0)
    missing_token_missed_total: int = Field(ge=0)
    missing_token_wrong_total: int = Field(ge=0)
