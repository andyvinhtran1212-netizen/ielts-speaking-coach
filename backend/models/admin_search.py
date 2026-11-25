"""Response shapes of quick search (ADMINIA-0074 FR-075, FR-102; plan 5.4;
G09-T05)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class SearchIn(BaseModel):
    """The query travels in the JSON body, never in the URL, so no access or
    platform HTTP log can keep a learner's name or e-mail."""
    q: str = Field(default="", max_length=128)


class SearchHit(BaseModel):
    title: str
    meta: Optional[str]
    href: str


class InstructorSearchOut(BaseModel):
    learners: list[SearchHit] = Field(max_length=3)
    classes: list[SearchHit] = Field(max_length=3)
    submissions: list[SearchHit] = Field(max_length=3)
    # Groups whose read failed: empty here because unreadable, not because
    # nothing matched.
    sources_failed: list[str]
    unavailable: list[Literal["orders"]]


class AdminSearchOut(InstructorSearchOut):
    content: list[SearchHit] = Field(max_length=3)
    # G04 enrollment orders. G04 has no read API yet: always empty and named
    # in ``unavailable``.
    orders: list[SearchHit] = Field(max_length=3)
