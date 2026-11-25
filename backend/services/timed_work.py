"""Timed work a learner account is in the middle of (COURSEACCESS-0055 plan 5.13).

``active_timed_work(user_id)`` answers "is this account doing something with a
running clock right now?" for the single-session gate: a claim from another
device, and "sign out everywhere", must never end that work (FR-040, FR-041).

Sources (spec G04-T09 step 2):
  (a) a seated mock-exam sitting with an unsubmitted section whose server clock
      is still running (``mock_exam_service`` timing helpers);
  (b) an opened, unsubmitted class-assignment item whose frozen
      ``timed_expires_at`` (mig 280) is in the future;
  (c) a Reading test attempt ``in_progress`` inside ``reading_tests.time_limit_minutes``.
Not covered yet, by design: Listening attempts (``listening_test_attempts`` has
no time-limit column; a Listening section inside a mock exam is covered by
(a)), and Speaking full tests / timed practice (no server-side clock to read
until G08 lands its exam room).

Every lookup error RAISES: the caller treats an unknown answer as "timed work
in progress" and never displaces a session it is unsure about. ``minutes_left``
comes from the server clock and is rounded up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from database import supabase_admin
from services import mock_exam_service


@dataclass(frozen=True)
class TimedWork:
    title: str
    minutes_left: int

    def as_dict(self, device_label: Optional[str] = None) -> dict:
        return {"title": self.title, "device_label": device_label, "minutes_left": self.minutes_left}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _minutes(seconds: float) -> int:
    return max(1, math.ceil(seconds / 60))


def _parse(value) -> Optional[datetime]:
    return mock_exam_service._parse_ts(value)


def mock_exam_work(user_id: str) -> Optional[TimedWork]:
    sittings = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "user_id", str(user_id)).in_("status", list(mock_exam_service._LIVE_STATUSES)).execute().data or []
    for sitting in sittings:
        exam_rows = supabase_admin.table("mock_exams").select("*").eq(
            "id", str(sitting.get("mock_exam_id"))).limit(1).execute().data or []
        if not exam_rows:
            continue
        exam = exam_rows[0]
        retake = mock_exam_service.is_retake(exam)
        for section in mock_exam_service._sitting_sections(sitting, exam):
            if sitting.get(f"{section}_submitted_at"):
                continue
            remaining = (mock_exam_service.retake_time_remaining_seconds(sitting, exam, section)
                         if retake else mock_exam_service.section_time_remaining_seconds(exam, section))
            if remaining:
                return TimedWork(title=str(exam.get("title") or "Bài thi thử"), minutes_left=_minutes(remaining))
    return None


def class_item_work(user_id: str) -> Optional[TimedWork]:
    students = supabase_admin.table("students").select("id").eq("user_id", str(user_id)).execute().data or []
    student_ids = [str(s["id"]) for s in students if s.get("id")]
    if not student_ids:
        return None
    now = _now()
    items = supabase_admin.table("class_assignment_items").select(
        "timed_expires_at, class_assignments(title)",
    ).in_("student_id", student_ids).is_("submitted_at", "null").gt(
        "timed_expires_at", now.isoformat()).execute().data or []
    best: Optional[TimedWork] = None
    for item in items:
        expires = _parse(item.get("timed_expires_at"))
        if not expires or expires <= now:
            continue
        parent = item.get("class_assignments") or {}
        if isinstance(parent, list):
            parent = parent[0] if parent else {}
        work = TimedWork(title=str(parent.get("title") or "Bài tập có giờ"),
                         minutes_left=_minutes((expires - now).total_seconds()))
        if best is None or work.minutes_left > best.minutes_left:
            best = work
    return best


def reading_attempt_work(user_id: str) -> Optional[TimedWork]:
    attempts = supabase_admin.table("reading_test_attempts").select(
        "started_at, reading_tests(title, time_limit_minutes)",
    ).eq("user_id", str(user_id)).eq("status", "in_progress").execute().data or []
    now = _now()
    best: Optional[TimedWork] = None
    for attempt in attempts:
        test = attempt.get("reading_tests") or {}
        if isinstance(test, list):
            test = test[0] if test else {}
        started = _parse(attempt.get("started_at"))
        limit = test.get("time_limit_minutes")
        if not started or not isinstance(limit, int) or limit <= 0:
            continue
        left = (started + timedelta(minutes=limit) - now).total_seconds()
        if left <= 0:
            continue
        work = TimedWork(title=str(test.get("title") or "Bài Reading"), minutes_left=_minutes(left))
        if best is None or work.minutes_left > best.minutes_left:
            best = work
    return best


def active_timed_work(user_id: str) -> Optional[TimedWork]:
    """The first running timed work of ``user_id`` or None. Raises on any
    lookup error (see module docstring)."""
    # Looked up at call time so a test can replace one source.
    for source in (mock_exam_work, class_item_work, reading_attempt_work):
        work = source(user_id)
        if work is not None:
            return work
    return None
