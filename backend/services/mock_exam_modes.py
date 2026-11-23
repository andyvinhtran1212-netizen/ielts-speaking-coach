"""Mock exam mode names and the self-paced timeline (MOCKORG-0086 plan 5.5).

Pure module: no database, no clock of its own. Callers pass ``now`` and the
section durations they already resolved (``mock_exam_service`` owns the
listening audio lookup), so admin (G09-T31) and learner (G08-T22) code compute
the same timeline from the same function.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Mapping, Optional

LIVE = "live"
SELF_PACED = "self_paced"
_LEGACY_TO_NEW = {"sequential": LIVE, "retake": SELF_PACED}
_NEW_TO_LEGACY = {new: old for old, new in _LEGACY_TO_NEW.items()}
MODES = frozenset({LIVE, SELF_PACED})

# Fixed section order; Speaking is not part of the timed chain.
SECTION_ORDER = ("listening", "reading", "writing")

NOT_STARTED = "not_started"
IN_PROGRESS = "in_progress"
SUBMITTED = "submitted"
MISSED = "missed"


def normalize(mode: Optional[str]) -> Optional[str]:
    """Map the legacy names (``sequential``, ``retake``) to ``live``/``self_paced``.
    New names pass through; anything else returns None (callers reject it)."""
    if mode is None:
        return None
    text = str(mode).strip()
    if text in MODES:
        return text
    return _LEGACY_TO_NEW.get(text)


def legacy_name(mode: Optional[str]) -> Optional[str]:
    """The legacy name the learner API keeps returning until G08 switches."""
    new = normalize(mode)
    return _NEW_TO_LEGACY.get(new) if new else None


def is_live(mode: Optional[str]) -> bool:
    return normalize(mode) == LIVE


def is_self_paced(mode: Optional[str]) -> bool:
    return normalize(mode) == SELF_PACED


@dataclass(frozen=True)
class SectionWindow:
    section: str
    starts_at: datetime
    deadline: datetime  # starts_at + duration + extra
    ends_at: datetime   # min(submitted_at, deadline) once known, else deadline
    submitted_at: Optional[datetime]


@dataclass(frozen=True)
class SelfPacedTimeline:
    state: str  # not_started | in_progress | submitted | missed
    started_at: Optional[datetime] = None
    current_section: Optional[str] = None
    section_time_left_seconds: Optional[int] = None
    expected_end_at: Optional[datetime] = None
    sections: tuple[SectionWindow, ...] = field(default_factory=tuple)
    # Sections whose computed start has passed but the sitting has no
    # ``<section>_started_at`` yet: the server stamps them (contract point 2).
    due_start_stamps: tuple[str, ...] = field(default_factory=tuple)
    # Sections past their deadline without ``<section>_submitted_at``: the
    # server auto-submits them (contract point 3).
    due_auto_submit: tuple[str, ...] = field(default_factory=tuple)


def _ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def sitting_sections(sitting: Mapping, exam: Mapping) -> list[str]:
    """Timed sections of this sitting in the fixed order: the sitting's own
    skills when present, else the exam's ``skills`` (NULL = all three)."""
    own = sitting.get("assigned_skills") or sitting.get("skills")
    pool = own if own else (exam.get("skills") or SECTION_ORDER)
    chosen = {str(s) for s in pool}
    return [s for s in SECTION_ORDER if s in chosen]


def self_paced_timeline(
    sitting: Mapping,
    exam: Mapping,
    now: datetime,
    *,
    durations: Mapping[str, int],
    gap_seconds: int = 0,
    open_until=None,
) -> SelfPacedTimeline:
    """Where a self-paced sitting stands at ``now`` (plan 5.5, points 1–8).

    - One start for the whole test: ``<first section>_started_at``.
    - Each next section starts at min(submit, deadline) of the previous one,
      plus ``gap_seconds`` (``MOCK_SELF_PACED_GAP_SECONDS``, default 0).
    - A section past its deadline counts as ended even when nobody submitted it
      (the clock never stops); it is listed in ``due_auto_submit``.
    - No state between two sections: once started it is ``in_progress`` (with
      exactly one current section) or ``submitted``.
    - Not started and the window (``open_until``) has closed → ``missed``.
      Started before the window closed → runs to the end regardless.
    - Extra time: ``sitting["extra_seconds"][section]`` lengthens that section
      and so moves every later section and ``expected_end_at``.
    """
    now = _ts(now)
    if now is None:
        raise ValueError("now is required")
    sections = sitting_sections(sitting, exam)
    if not sections:
        return SelfPacedTimeline(state=SUBMITTED)
    started = _ts(sitting.get(f"{sections[0]}_started_at"))
    if started is None:
        closes = _ts(open_until)
        state = MISSED if closes is not None and now >= closes else NOT_STARTED
        return SelfPacedTimeline(state=state)

    extra = sitting.get("extra_seconds") or {}
    gap = timedelta(seconds=max(0, int(gap_seconds or 0)))
    windows: list[SectionWindow] = []
    due_stamps: list[str] = []
    due_submit: list[str] = []
    current: Optional[str] = None
    time_left: Optional[int] = None
    cursor = started
    for index, section in enumerate(sections):
        if index:
            cursor = cursor + gap
        length = int(durations.get(section) or 0) + max(0, int(extra.get(section) or 0))
        deadline = cursor + timedelta(seconds=length)
        submitted = _ts(sitting.get(f"{section}_submitted_at"))
        if submitted is not None and submitted < cursor:
            submitted = cursor  # a stamp earlier than its own start ends it at once
        ends = min(submitted, deadline) if submitted is not None else deadline
        windows.append(SectionWindow(section, cursor, deadline, ends, submitted))
        if index and cursor <= now and not sitting.get(f"{section}_started_at"):
            due_stamps.append(section)
        if submitted is None and deadline <= now:
            due_submit.append(section)
        if current is None and now < ends:
            current = section
            time_left = max(0, int((deadline - max(now, cursor)).total_seconds()))
        cursor = ends

    expected_end = windows[-1].deadline if windows[-1].submitted_at is None else windows[-1].ends_at
    return SelfPacedTimeline(
        state=IN_PROGRESS if current else SUBMITTED,
        started_at=started,
        current_section=current,
        section_time_left_seconds=time_left,
        expected_end_at=expected_end,
        sections=tuple(windows),
        due_start_stamps=tuple(due_stamps),
        due_auto_submit=tuple(due_submit),
    )
