"""Display provenance, without private answer-policy or snapshot contents."""
from typing import Literal

from pydantic import BaseModel, Field

ContextProvenance = Literal["submission_snapshot", "verified_original_revision",
                            "current_content_fallback", "unavailable"]


class ReviewContextReference(BaseModel):
    provenance: ContextProvenance
    possibly_changed: bool
    paper_revision: int | None = None
    policy_revision: int | None = None
    context_sha256: str | None = None
    field_provenance: dict[str, ContextProvenance] = Field(default_factory=dict)
