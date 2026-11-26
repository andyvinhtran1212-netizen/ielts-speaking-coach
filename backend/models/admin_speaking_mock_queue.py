"""Response shape of the mock-exam Speaking queue (ADMINIA-0074 plan 5.4;
G09-T38). See ``services/speaking_mock_queue.py`` for what each field means."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class MockQueueExam(BaseModel):
    id: str
    title: str


class MockQueueRef(BaseModel):
    id: str
    name: str


class MockQueueItem(BaseModel):
    sitting_id: str
    exam: MockQueueExam
    name: str
    cohort: Optional[MockQueueRef]
    submitted_at: str
    waited_hours: int
    # None when the thresholds could not be read: never a guess.
    overdue: Optional[bool]
    # No stored "too short" / "inaudible" field yet: always empty.
    flags: list[str]
    claimed_by: Optional[MockQueueRef]


class MockQueue(BaseModel):
    items: list[MockQueueItem]
    # The speaking_mock_hours threshold used for `overdue`; None if unreadable.
    overdue_hours: Optional[int]
