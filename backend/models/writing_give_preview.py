"""Response contract for the read-only Writing give duplicates preview (BL-18)."""

from pydantic import BaseModel, ConfigDict, Field


class DuplicatesPreviewOut(BaseModel):
    """Target students of a give that has not been sent yet, and which of them
    already hold one of its prompts (the give's future `duplicates_warning`)."""

    model_config = ConfigDict(extra="forbid")

    student_count: int = Field(ge=0)
    duplicate_student_ids: list[str]
