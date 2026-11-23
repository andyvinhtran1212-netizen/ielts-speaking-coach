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


_OPEN_ENDED = object()  # a per-person window with no end: the exam is not over


def self_paced_end(exam: dict, window_ends: Iterable = ()) -> Optional[datetime]:
    """The last moment anyone may still sit a self-paced exam, or None if unknown.

    Windows are set per person (audience rows, 445; assignments and
    ``sittings.retake_open_until``, 154), so ``exam.open_until`` alone can be
    NULL or earlier than someone's own window (CR #2640). The end is the latest
    of all of them; a per-person window without an end keeps the exam open.
    """
    ends = []
    for value in window_ends:
        if value is _OPEN_ENDED:
            return None
        parsed = _ts(value)
        if parsed:
            ends.append(parsed)
    own = _ts(exam.get("open_until"))
    if own:
        ends.append(own)
    return max(ends) if ends else None


def is_over(exam: dict, now: datetime, window_ends: Iterable = ()) -> bool:
    """True when no one can sit the exam any more (the caller then reads sittings)."""
    if exam.get("status") != "published":
        return False
    if mock_exam_modes.is_live(exam.get("exam_mode") or "sequential"):
        return not exam.get("is_open") and exam.get("active_section") == "done"
    until = self_paced_end(exam, window_ends)
    return bool(until and now >= until)


def display_state(exam: dict, now: datetime, sitting_statuses: Iterable[str] = (),
                  window_ends: Iterable = ()) -> str:
    status = exam.get("status")
    if status == "draft":
        return "draft"
    if status == "archived":
        return "archived"
    if is_over(exam, now, window_ends):
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


def _window_ends(exam_ids: list[str], audiences_enabled: bool) -> dict[str, list]:
    """Every per-person window end of these self-paced exams.

    ``_OPEN_ENDED`` stands for a selected audience row with no end. A sitting
    without ``retake_open_until`` has no own window and adds nothing."""
    from database import supabase_admin
    from services import class_membership_service as membership

    out: dict[str, list] = {i: [] for i in exam_ids}
    for start in range(0, len(exam_ids), _ID_CHUNK):
        chunk = exam_ids[start:start + _ID_CHUNK]
        if audiences_enabled:
            for row in membership._paged(lambda c=chunk: supabase_admin.table("mock_exam_audiences")
                                         .select("exam_id, open_until").in_("exam_id", c)
                                         .eq("purpose", "main").eq("selected", True)):
                out.setdefault(str(row["exam_id"]), []).append(row.get("open_until") or _OPEN_ENDED)
        for row in membership._paged(lambda c=chunk: supabase_admin.table("mock_exam_assignments")
                                     .select("exam_id, open_until").in_("exam_id", c)):
            out.setdefault(str(row["exam_id"]), []).append(row.get("open_until") or _OPEN_ENDED)
        for row in membership._paged(lambda c=chunk: supabase_admin.table("mock_exam_sittings")
                                     .select("mock_exam_id, retake_open_until").in_("mock_exam_id", c)
                                     .neq("status", "void")):
            if row.get("retake_open_until"):
                out.setdefault(str(row["mock_exam_id"]), []).append(row["retake_open_until"])
    return out


def _listening_seconds(rows: list[dict]) -> dict[str, int]:
    """The seat clock of each exam's Listening (audio length + buffer, or the
    default when the test has no length), as ``_section_duration_seconds``."""
    from database import supabase_admin
    from services import mock_exam_service as exam_svc

    tests = {str(r["id"]): str(r["listening_test_id"]) for r in rows if r.get("listening_test_id")}
    lengths: dict[str, int] = {}
    ids = sorted(set(tests.values()))
    for start in range(0, len(ids), _ID_CHUNK):
        chunk = ids[start:start + _ID_CHUNK]
        for row in (supabase_admin.table("listening_tests").select("id, full_audio_duration_seconds")
                    .in_("id", chunk).execute().data or []):
            if row.get("full_audio_duration_seconds"):
                lengths[str(row["id"])] = int(row["full_audio_duration_seconds"])
    default = exam_svc._DEFAULT_LISTENING_MINUTES * 60
    return {exam_id: lengths.get(test, default) + exam_svc._LISTENING_BUFFER_SECONDS
            for exam_id, test in tests.items()}


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
    """Add ``display_state``, ``audience_count`` and ``listening_seconds`` to each row.

    A failed read gives ``None`` for the field it feeds, never a guess: an
    exam whose sittings or (self-paced) per-person windows could not be read
    has no state, and ``audience_count`` is ``None`` when the flag is off or
    the count failed (the list still loads).
    """
    import logging

    log = logging.getLogger(__name__)
    now = now or datetime.now(timezone.utc)
    self_paced = [str(r["id"]) for r in rows if r.get("status") == "published"
                  and not mock_exam_modes.is_live(r.get("exam_mode") or "sequential")]
    windows: Optional[dict[str, list]] = {}
    if self_paced:
        try:
            windows = _window_ends(self_paced, audiences_enabled)
        except Exception as exc:  # noqa: BLE001
            log.warning("mock_exam_display_state window read failed: %s", type(exc).__name__)
            windows = None
    unknown = set(self_paced) if windows is None else set()
    over = [str(r["id"]) for r in rows if str(r["id"]) not in unknown
            and is_over(r, now, (windows or {}).get(str(r["id"]), ()))]
    statuses: Optional[dict[str, set[str]]] = {}
    if over:
        try:
            statuses = _sitting_statuses(over)
        except Exception as exc:  # noqa: BLE001
            log.warning("mock_exam_display_state sittings read failed: %s", type(exc).__name__)
            statuses = None
    if statuses is None:
        unknown |= set(over)
    counts: Optional[dict[str, int]] = None
    if audiences_enabled and rows:
        try:
            counts = _audience_counts([str(r["id"]) for r in rows])
        except Exception as exc:  # noqa: BLE001
            log.warning("mock_exam_display_state audience count failed: %s", type(exc).__name__)
    listening: Optional[dict[str, int]] = {}
    try:
        listening = _listening_seconds(rows)
    except Exception as exc:  # noqa: BLE001
        log.warning("mock_exam_display_state listening length read failed: %s", type(exc).__name__)
        listening = None
    out = []
    for row in rows:
        key = str(row["id"])
        state = None if key in unknown else display_state(
            row, now, (statuses or {}).get(key, ()), (windows or {}).get(key, ()))
        out.append({**row, "display_state": state,
                    "audience_count": counts.get(key, 0) if counts is not None else None,
                    # FR-143 "khoảng N phút": the Listening seat clock, null when
                    # the exam has no Listening paper or the length read failed.
                    "listening_seconds": (listening or {}).get(key)})
    return out
