"""Signed playback choices; no transcripts, keys or voice authoring."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class SourceAudioVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    variant_id: Literal["original", "kokoro-v1"]
    label_vi: str
    synthetic: bool
    duration_seconds: float = Field(gt=0)
    url: str | None
    note_vi: str


class SourceAudioResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: int = Field(ge=1, le=80)
    variants: list[SourceAudioVariant]
