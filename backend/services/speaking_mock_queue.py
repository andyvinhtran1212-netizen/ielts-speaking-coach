"""Mock-exam Speaking grading queue (ADMINIA-0074 FR-060, FR-065, FR-067,
FR-069; plan 5.4 ``GET /admin/speaking/mock-queue``; G09-T38 backend).

A sitting is **waiting for a Speaking grade** when all of these hold:

* it is not ``void`` or ``released``;
* Speaking is one of the skills the examiner must band for it. The rule is
  ``mock_review_workflow._required_skills_for``: the exam defines a
  ``speaking_topic_set`` and is not a retake, or a retake that assigned
  Speaking;
* the candidate's recording is in: ``speaking_completed_at`` is set and
  ``speaking_session_ids`` is not empty. Both Speaking paths
  (``mock_exam_service.record_speaking`` and ``admin_record_speaking``) write
  the two together;
* the review has no final Speaking band (``mock_exam_reviews.final_bands
  .speaking`` is null). A band typed from a live assessment sits in
  ``ai_draft.speaking`` and is not final, so that sitting still waits.

Practice Speaking sessions never appear: the queue reads only
``mock_exam_sittings``.

``submitted_at`` is ``speaking_completed_at``. ``waited_hours`` counts whole
hours from it, and ``overdue`` compares that with the ``speaking_mock_hours``
threshold (G09-T22). When the thresholds cannot be read, ``overdue`` is
``None``, never a guess. ``flags`` is always empty: no stored field says
"too short" or "inaudible" yet, and the task says to hide that column rather
than invent it.

The service is synchronous and the router runs it in a worker thread.
:func:`pending_items` is the one definition of "waiting", so the sidebar count
and "Việc cần làm" (``speaking_mock_pending``, G09-T06) can read the same
rows.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Iterable, Optional

from database import supabase_admin
from services import mock_review_workflow as wf

_EXAM_COLS = "id, title, cohort_id, " + wf._REQUIRED_SKILLS_EXAM_COLS
_SITTING_COLS = (
    "id, user_id, mock_exam_id, status, assigned_skills, "
    "speaking_completed_at, speaking_session_ids"
)
_CLOSED = ("void", "released")
_CHUNK = 200


def _parse(ts: object) -> Optional[datetime]:
    if not isinstance(ts, str) or not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _chunks(ids: list[str]) -> Iterable[list[str]]:
    for i in range(0, len(ids), _CHUNK):
        yield ids[i:i + _CHUNK]


def _rows_by_id(table: str, cols: str, ids: Iterable[str]) -> dict[str, dict]:
    wanted = sorted({str(i) for i in ids if i})
    out: dict[str, dict] = {}
    for part in _chunks(wanted):
        rows = supabase_admin.table(table).select(cols).in_("id", part).execute().data or []
        out.update({str(r["id"]): r for r in rows})
    return out


def _exams(exam_id: Optional[str], cohort_ids: Optional[frozenset[str]]) -> dict[str, dict]:
    """The exams in the caller's reach. ``cohort_ids`` None means every exam (an
    admin). A teacher sees only exams of their own classes; an exam without a
    class belongs to no teacher."""
    q = supabase_admin.table("mock_exams").select(_EXAM_COLS)
    if exam_id:
        q = q.eq("id", str(exam_id))
    if cohort_ids is not None:
        if not cohort_ids:
            return {}
        q = q.in_("cohort_id", sorted(cohort_ids))
    rows = q.execute().data or []
    return {str(r["id"]): r for r in rows}


def _sittings(exam_ids: list[str]) -> list[dict]:
    out: list[dict] = []
    for part in _chunks(exam_ids):
        out.extend(
            supabase_admin.table("mock_exam_sittings").select(_SITTING_COLS)
            .in_("mock_exam_id", part)
            .not_.in_("status", list(_CLOSED))
            .not_.is_("speaking_completed_at", "null")
            .execute().data or []
        )
    return out


def _reviews(sitting_ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for part in _chunks(sitting_ids):
        rows = supabase_admin.table("mock_exam_reviews").select(
            "sitting_id, claimed_by, final_bands",
        ).in_("sitting_id", part).execute().data or []
        out.update({str(r["sitting_id"]): r for r in rows})
    return out


def _speaking_required(exam: dict, sitting: dict) -> bool:
    return "speaking" in wf._required_skills_for(exam, sitting)


def pending_items(
    *,
    exam_id: Optional[str] = None,
    cohort_ids: Optional[frozenset[str]] = None,
    hide_user_ids: frozenset[str] = frozenset(),
    overdue_hours: Optional[int] = None,
    now: Optional[datetime] = None,
) -> list[dict]:
    """The waiting sittings, oldest submission first (module docstring)."""
    now = now or datetime.now(timezone.utc)
    exams = _exams(exam_id, cohort_ids)
    if not exams:
        return []
    candidates = []
    for s in _sittings(sorted(exams)):
        exam = exams.get(str(s.get("mock_exam_id")))
        submitted = _parse(s.get("speaking_completed_at"))
        if exam is None or submitted is None or not (s.get("speaking_session_ids") or []):
            continue
        if str(s.get("user_id")) in hide_user_ids:
            continue
        if not _speaking_required(exam, s):
            continue
        candidates.append((s, exam, submitted))
    if not candidates:
        return []

    reviews = _reviews([str(s["id"]) for s, _, _ in candidates])
    waiting = []
    for s, exam, submitted in candidates:
        rv = reviews.get(str(s["id"])) or {}
        if (rv.get("final_bands") or {}).get("speaking") is not None:
            continue
        waiting.append((s, exam, submitted, rv))
    if not waiting:
        return []

    cohorts = _rows_by_id("cohorts", "id, name", (e.get("cohort_id") for _, e, _, _ in waiting))
    names = wf.resolve_display_names(
        [s.get("user_id") for s, _, _, _ in waiting]
        + [rv.get("claimed_by") for _, _, _, rv in waiting])

    items = []
    for s, exam, submitted, rv in waiting:
        waited = max(0, math.floor((now - submitted).total_seconds() / 3600))
        cohort = cohorts.get(str(exam.get("cohort_id"))) if exam.get("cohort_id") else None
        claimed = rv.get("claimed_by")
        items.append({
            "sitting_id": str(s["id"]),
            "exam": {"id": str(exam["id"]), "title": exam.get("title") or ""},
            "name": names.get(s.get("user_id"), "—"),
            "cohort": {"id": str(cohort["id"]), "name": cohort.get("name") or ""} if cohort else None,
            "submitted_at": submitted.isoformat(),
            "waited_hours": waited,
            "overdue": None if overdue_hours is None else waited >= overdue_hours,
            "flags": [],
            "claimed_by": {"id": str(claimed), "name": names.get(claimed, "—")} if claimed else None,
        })
    items.sort(key=lambda r: (r["submitted_at"], r["sitting_id"]))
    return items
