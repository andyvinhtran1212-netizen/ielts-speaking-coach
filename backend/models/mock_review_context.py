"""Display provenance, without private answer-policy or snapshot contents."""
from typing import Literal

from pydantic import BaseModel

ContextProvenance = Literal["submission_snapshot", "verified_original_revision",
                            "current_content_fallback", "unavailable"]


class ReviewContextReference(BaseModel):
    provenance: ContextProvenance
    possibly_changed: bool
    paper_revision: int | None = None
    policy_revision: int | None = None
    context_sha256: str | None = None
