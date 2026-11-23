"""Admin list state of a mock exam (MOCKORG-0086 FR-140, plan 5.4).

One word per exam for the "Kỳ thi" list: Nháp → Đã lên lịch (live) / Đang mở
(self-paced) → Đang diễn ra → Chờ chấm → Đã trả kết quả. Derived from the
persisted exam row and its sittings only; nothing here writes.

Two states the spec's chain does not name are returned honestly instead of
being forced into a neighbour: ``ended`` (the exam is over and nobody's paper
is waiting or released, e.g. nobody sat it) and ``archived``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

from services import mock_exam_modes

# Sitting statuses (mig 146/150): finished and waiting for a teacher, or released.
_WAITING = frozenset({"lrw_submitted", "speaking_pending", "all_submitted", "under_review", "reviewed"})
_RUNNING_SECTIONS = frozenset({"listening", "reading", "writing"})


def _ts(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_over(exam: dict, now: datetime) -> bool:
    """True when no one can sit the exam any more (the caller then reads sittings)."""
    if exam.get("status") != "published":
        return False
    if mock_exam_modes.is_live(exam.get("exam_mode") or "sequential"):
        return not exam.get("is_open") and exam.get("active_section") == "done"
    until = _ts(exam.get("open_until"))
    return bool(until and now >= until)


def display_state(exam: dict, now: datetime, sitting_statuses: Iterable[str] = ()) -> str:
    status = exam.get("status")
    if status == "draft":
        return "draft"
    if status == "archived":
        return "archived"
    if is_over(exam, now):
        statuses = set(sitting_statuses)
        if statuses & _WAITING:
            return "grading"
        return "released" if "released" in statuses else "ended"
    if mock_exam_modes.is_live(exam.get("exam_mode") or "sequential"):
        if exam.get("is_open") or exam.get("active_section") in _RUNNING_SECTIONS:
            return "running"
        return "scheduled"
    opens = _ts(exam.get("open_from"))
    return "scheduled" if opens and now < opens else "open"


_ID_CHUNK = 100


def _sitting_statuses(exam_ids: list[str]) -> dict[str, set[str]]:
    from database import supabase_admin
    from services import class_membership_service as membership

    out: dict[str, set[str]] = {i: set() for i in exam_ids}
    for start in range(0, len(exam_ids), _ID_CHUNK):
        chunk = exam_ids[start:start + _ID_CHUNK]
        for row in membership._paged(lambda c=chunk: supabase_admin.table("mock_exam_sittings")
                                     .select("mock_exam_id, status").in_("mock_exam_id", c)
                                     .neq("status", "void")):
            out.setdefault(str(row["mock_exam_id"]), set()).add(row.get("status") or "")
    return out


def _audience_counts(exam_ids: list[str]) -> dict[str, int]:
    from database import supabase_admin
    from services import class_membership_service as membership

    out: dict[str, int] = {i: 0 for i in exam_ids}
    for start in range(0, len(exam_ids), _ID_CHUNK):
        chunk = exam_ids[start:start + _ID_CHUNK]
        for row in membership._paged(lambda c=chunk: supabase_admin.table("mock_exam_audiences")
                                     .select("exam_id").in_("exam_id", c)
                                     .eq("purpose", "main").eq("selected", True)):
            key = str(row["exam_id"])
            out[key] = out.get(key, 0) + 1
    return out


def enrich_admin_list(rows: list[dict], *, audiences_enabled: bool,
                      now: Optional[datetime] = None) -> list[dict]:
    """Add ``display_state`` and ``audience_count`` to each admin list row.

    A failed read gives ``None`` for the field it feeds, never a guess: an
    exam whose sittings could not be read has no state, and ``audience_count``
    is ``None`` when the flag is off or the count failed (the list still loads).
    """
    import logging

    log = logging.getLogger(__name__)
    now = now or datetime.now(timezone.utc)
    over = [str(r["id"]) for r in rows if is_over(r, now)]
    statuses: Optional[dict[str, set[str]]] = {}
    if over:
        try:
            statuses = _sitting_statuses(over)
        except Exception as exc:  # noqa: BLE001
            log.warning("mock_exam_display_state sittings read failed: %s", type(exc).__name__)
            statuses = None
    counts: Optional[dict[str, int]] = None
    if audiences_enabled and rows:
        try:
            counts = _audience_counts([str(r["id"]) for r in rows])
        except Exception as exc:  # noqa: BLE001
            log.warning("mock_exam_display_state audience count failed: %s", type(exc).__name__)
    out = []
    for row in rows:
        key = str(row["id"])
        if key in over and statuses is None:
            state = None
        else:
            state = display_state(row, now, (statuses or {}).get(key, ()))
        out.append({**row, "display_state": state,
                    "audience_count": counts.get(key, 0) if counts is not None else None})
    return out
