"""Admin Giáo viên table and profile (ADMINIA-0074 FR-106, G09-T40).

Three read-only facts per teacher, each from an existing source of truth:

* classes: :func:`services.staff_scope.classes_taught_by` (``cohorts.instructor_id``,
  the same column that decides a teacher's access);
* Writing waiting per class: :func:`services.essay_service.count_queue`, the
  admin Writing queue's own RPC. "Chờ duyệt" is ``graded`` + ``reviewed``
  (the queue's needs-review lanes) + ``failed`` (AI lỗi, FR-012); mock essays
  are left out because they go to the mock review queue. "Quá hạn" is the
  queue's own ``overdue`` filter (not delivered, past the assignment deadline);
* review speed: ``instructor_reviews`` rows this teacher delivered in the last
  30 days, from the AI-graded row's ``created_at`` to ``delivered_at``. Fewer
  than :data:`SPEED_MIN_REVIEWS` → ``None`` (the sheet: "chưa đủ dữ liệu thì
  để trống").

A source that fails gives ``None`` for that field only, never 0, and is
logged; the page writes "chưa có". Pending mock Speaking grading is not
assigned to classes anywhere yet, so it is always ``None`` here.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from database import supabase_admin
from services import essay_service
from services.staff_scope import classes_taught_by

logger = logging.getLogger(__name__)

PENDING_STATUSES = ("graded", "reviewed", "failed")
SPEED_WINDOW_DAYS = 30
SPEED_MIN_REVIEWS = 5
_MAX_WORKERS = 8


def _class_counts(cohort_id: str) -> dict:
    """{writing_pending, writing_overdue} for one class; None where unreadable."""
    out: dict = {"writing_pending": None, "writing_overdue": None}
    try:
        out["writing_pending"] = sum(
            essay_service.count_queue(status=s, cohort_id=cohort_id, mock=False)
            for s in PENDING_STATUSES
        )
    except Exception:
        logger.warning("[admin_instructor_profiles] pending count failed cohort=%s",
                       cohort_id, exc_info=True)
    try:
        out["writing_overdue"] = essay_service.count_queue(
            cohort_id=cohort_id, mock=False, overdue=True)
    except Exception:
        logger.warning("[admin_instructor_profiles] overdue count failed cohort=%s",
                       cohort_id, exc_info=True)
    return out


def counts_for_classes(cohort_ids: Iterable[str]) -> dict[str, dict]:
    ids = sorted({str(c) for c in cohort_ids if c})
    if not ids:
        return {}
    with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(ids))) as pool:
        return dict(zip(ids, pool.map(_class_counts, ids)))


def _parse_ts(value) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def review_speed(teacher_ids: Iterable[str], *, now: Optional[datetime] = None) -> dict[str, dict]:
    """{teacher_id: {delivered_30d, in_progress, avg_review_hours}}.

    Raises when ``instructor_reviews`` cannot be read; the caller turns that
    into ``None`` fields.
    """
    ids = sorted({str(t) for t in teacher_ids if t})
    out = {t: {"delivered_30d": 0, "in_progress": 0, "avg_review_hours": None} for t in ids}
    if not ids:
        return out
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(days=SPEED_WINDOW_DAYS)).isoformat()
    delivered = (
        supabase_admin.table("instructor_reviews")
        .select("claimed_by, created_at, delivered_at")
        .in_("claimed_by", ids)
        .eq("status", "delivered")
        .gte("delivered_at", since)
        .execute()
    ).data or []
    active = (
        supabase_admin.table("instructor_reviews")
        .select("claimed_by")
        .in_("claimed_by", ids)
        .in_("status", ["claimed", "edited"])
        .execute()
    ).data or []
    durations: dict[str, list[float]] = {t: [] for t in ids}
    for row in delivered:
        teacher = str(row.get("claimed_by") or "")
        if teacher not in out:
            continue
        out[teacher]["delivered_30d"] += 1
        start, end = _parse_ts(row.get("created_at")), _parse_ts(row.get("delivered_at"))
        if start and end and end >= start:
            durations[teacher].append((end - start).total_seconds() / 3600)
    for row in active:
        teacher = str(row.get("claimed_by") or "")
        if teacher in out:
            out[teacher]["in_progress"] += 1
    for teacher, values in durations.items():
        if len(values) >= SPEED_MIN_REVIEWS:
            out[teacher]["avg_review_hours"] = round(sum(values) / len(values), 1)
    return out


def _sum_or_none(values: list) -> Optional[int]:
    return None if any(v is None for v in values) else sum(values)


def teacher_overview(teacher_ids: Iterable[str]) -> dict[str, dict]:
    """Per teacher: classes (with per-class counts), totals and review speed.

    ``classes`` is ``None`` when the class read failed; totals over classes
    are ``None`` when any class count is unreadable.
    """
    ids = sorted({str(t) for t in teacher_ids if t})
    try:
        classes = classes_taught_by(ids)
    except Exception:
        logger.warning("[admin_instructor_profiles] class lookup failed", exc_info=True)
        classes = None
    try:
        speed = review_speed(ids)
    except Exception:
        logger.warning("[admin_instructor_profiles] review speed failed", exc_info=True)
        speed = None
    counts = counts_for_classes(
        c["id"] for rows in (classes or {}).values() for c in rows)

    out: dict[str, dict] = {}
    for teacher in ids:
        rows = None if classes is None else [
            {**c, **counts.get(c["id"], {"writing_pending": None, "writing_overdue": None}),
             "speaking_mock_pending": None}
            for c in classes.get(teacher, [])
        ]
        teacher_speed = (speed or {}).get(teacher) or {
            "delivered_30d": None, "in_progress": None, "avg_review_hours": None}
        out[teacher] = {
            "classes": rows,
            "writing_pending": None if rows is None else _sum_or_none([r["writing_pending"] for r in rows]),
            "writing_overdue": None if rows is None else _sum_or_none([r["writing_overdue"] for r in rows]),
            "delivered_30d": teacher_speed["delivered_30d"],
            "in_progress": teacher_speed["in_progress"],
            "avg_review_hours": teacher_speed["avg_review_hours"],
        }
    return out
