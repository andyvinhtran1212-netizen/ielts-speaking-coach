"""services/class_service.py — rollups for the merged "Lớp & Học viên" admin page.

Giai đoạn 1 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

The class list has to answer, per class and at a glance: which course is this,
how many students are on the roster, and — the one that matters — how many of
them have no account yet.

That last number is not decoration. A student row with ``students.user_id IS
NULL`` has never activated, so anything assigned to them is delivered into
silence: no error, no empty state, nothing on any screen (migration 177 header).
It is the single silent failure this whole programme rests on, so the count
travels with the class everywhere the class is shown rather than hiding one
click deep.

Two things this module refuses to do quietly:

  * **Pagination.** PostgREST caps an un-ranged select at ~1000 rows. This repo
    has shipped that bug at least three times, and its signature is always the
    same — a plausible-looking number and a green test run. A centre with 1000+
    student rows would start under-counting rosters with no symptom, so the
    student scan pages explicitly.
  * **Failure.** If the roster scan errors, the rollup reports
    ``rollup_failed: True`` instead of leaving the counts at zero. "0 học viên"
    is a claim about the class; a failed query is not entitled to make it. The
    frontend renders the difference. Same rule the access-code endpoints follow
    with ``association_lookup_failed``.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# PostgREST's own default ceiling. Pages of exactly this size mean "there may be
# more"; a short page means we reached the end.
_PAGE = 1000


def _all_students_for_cohorts(db, cohort_ids: List[str]) -> List[Dict[str, Any]]:
    """Every student row belonging to any of `cohort_ids`, paged.

    Ordered by id because an unordered range is not a stable window — without it
    two pages can repeat or skip rows, which would corrupt the very counts this
    exists to produce.
    """
    if not cohort_ids:
        return []

    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = (
            db.table("students")
            .select("id, cohort_id, user_id")
            .in_("cohort_id", cohort_ids)
            .order("id")
            .range(start, start + _PAGE - 1)
            .execute()
            .data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _roster_rollup(db, cohort_ids: List[str]) -> tuple[Dict[str, Dict[str, int]], bool]:
    """(per-cohort counts, failed?).

    On failure returns an empty mapping AND failed=True so the caller can say
    "không đọc được" rather than "0 học viên".
    """
    try:
        students = _all_students_for_cohorts(db, cohort_ids)
    except Exception as exc:
        logger.warning("[class] roster rollup failed: %s", exc)
        return {}, True

    counts: Dict[str, Dict[str, int]] = {}
    for s in students:
        cid = s.get("cohort_id")
        if not cid:
            continue
        bucket = counts.setdefault(cid, {"member_count": 0, "unactivated_count": 0})
        bucket["member_count"] += 1
        if not s.get("user_id"):
            bucket["unactivated_count"] += 1
    return counts, False


def _courses_by_id(db) -> tuple[Dict[str, Dict[str, Any]], bool]:
    """(id → course, failed?). A class whose course cannot be read shows
    "chưa gán khoá" only when the lookup SUCCEEDED and found nothing."""
    try:
        rows = (
            db.table("courses")
            .select("id, code, name, sort_order, is_active")
            .execute()
            .data
        ) or []
    except Exception as exc:
        logger.warning("[class] course lookup failed: %s", exc)
        return {}, True
    return {c["id"]: c for c in rows}, False


def _fetch_cohorts(
    db,
    *,
    is_active: Optional[bool],
    course_id: Optional[str],
) -> List[Dict[str, Any]]:
    q = db.table("cohorts").select("*")
    if is_active is True:
        q = q.eq("is_active", True)
    elif is_active is False:
        q = q.eq("is_active", False)
    if course_id:
        q = q.eq("course_id", course_id)
    return (q.order("created_at", desc=True).execute().data) or []


def list_cohorts_basic(
    db,
    *,
    is_active: Optional[bool] = None,
    course_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Just the cohort rows — no course join, no roster scan.

    This is what a cohort PICKER needs, and five admin screens use the endpoint
    that way (access-codes, users, writing-queue, mock-exams, exam-content). They
    want a handful of ids and names; making them pay for a full paginated scan of
    every student in every class would make unrelated pages slower and slower as
    the school grows, for data they never render.
    """
    return {"cohorts": _fetch_cohorts(db, is_active=is_active, course_id=course_id)}


def list_cohorts_with_rollup(
    db,
    *,
    is_active: Optional[bool] = None,
    course_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Classes for the admin list, each carrying its course and roster counts.

    Costs one paginated pass over the students of the listed classes, so it is
    opt-in (see list_cohorts_basic). `is_active=None` means no filter — the admin
    picks "Tất cả" and sees archived classes too.
    """
    cohorts = _fetch_cohorts(db, is_active=is_active, course_id=course_id)

    counts, rollup_failed = _roster_rollup(db, [c["id"] for c in cohorts])
    courses, course_lookup_failed = _courses_by_id(db)

    out = []
    for c in cohorts:
        bucket = counts.get(c["id"], {"member_count": 0, "unactivated_count": 0})
        out.append({
            **c,
            "course": courses.get(c.get("course_id")) if c.get("course_id") else None,
            # Left absent rather than zeroed when the scan failed — see module docstring.
            "member_count": None if rollup_failed else bucket["member_count"],
            "unactivated_count": None if rollup_failed else bucket["unactivated_count"],
        })

    result: Dict[str, Any] = {"cohorts": out}
    if rollup_failed:
        result["rollup_failed"] = True
    if course_lookup_failed:
        result["course_lookup_failed"] = True
    return result
