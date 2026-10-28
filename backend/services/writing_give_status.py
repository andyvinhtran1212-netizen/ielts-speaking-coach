"""services/writing_give_status.py — what a writing give's state MEANS, decided
once for every surface (PC-J08: W-07 + A-S3).

Three surfaces show the same `writing_assignments` row: the learner's /my-class
(`class_student`), the admin cohort matrix (`admin_writing_cohorts`) and the
/instructor matrix (`instructor`). Each used to derive "late" on its own, and
/my-class never knew whether the essay had been graded or returned. These
helpers are the single rule they all read.

Deadline column: `writing_assignments.deadline` is the one every give path
writes. `due_at` (mig 106, "W-1, nullable") is written by no code path and is
deliberately NOT read here — it is deprecated in favour of `deadline`.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Mapping, Optional

from services.cohort_assignment_service import parse_deadline

logger = logging.getLogger(__name__)

# The learner-facing review lifecycle of a writing give.
NOT_SUBMITTED = "not_submitted"
SUBMITTED = "submitted"
GRADED = "graded"        # graded (AI and/or teacher) but NOT returned yet
RETURNED = "returned"    # essay delivered to the learner

_GRADED_ESSAY_STATUSES = frozenset({"graded", "reviewed"})


def _instant(value, *, row_id, field: str) -> Optional[datetime]:
    """Parsed UTC instant; a malformed stored value reads as absent (logged
    with the row id only) so one bad row can never fail a whole page."""
    try:
        return parse_deadline(value)
    except (TypeError, ValueError):
        logger.warning("[writing-give] malformed %s on row %s; ignoring", field, row_id)
        return None


def writing_give_timing(assignment: Mapping[str, Any], now: datetime) -> tuple[bool, bool]:
    """(is_late, is_missing) for one `writing_assignments` row.

    is_late    — handed in strictly after `deadline` ("Nộp trễ").
    is_missing — nothing handed in and `deadline` has passed ("Quá hạn").
    Both compare parsed instants, never ISO strings (offsets differ).
    """
    row_id = assignment.get("id")
    due = _instant(assignment.get("deadline"), row_id=row_id, field="deadline")
    submitted = _instant(assignment.get("submitted_at"), row_id=row_id, field="submitted_at")
    is_late = bool(submitted and due and submitted > due)
    is_missing = bool(not assignment.get("submitted_at") and due and due < now)
    return is_late, is_missing


def writing_review_state(assignment: Mapping[str, Any],
                         essay: Optional[Mapping[str, Any]]) -> str:
    """not_submitted | submitted | graded | returned.

    The essay row is canonical — it is what /writing/result gates feedback on —
    so a `writing_assignments.status` that lagged behind (rows graded before the
    #1740 sync existed) cannot under-report a returned essay. Without an essay
    row we never claim more than "submitted": grading/return is not inferred
    from evidence we did not read.
    """
    if not assignment.get("submitted_at"):
        return NOT_SUBMITTED
    status = (essay or {}).get("status")
    if status == "delivered":
        return RETURNED
    if status in _GRADED_ESSAY_STATUSES:
        return GRADED
    return SUBMITTED


def writing_result_path(essay_id) -> Optional[str]:
    """The learner's result page for a submitted essay."""
    return f"/writing/result?essay_id={essay_id}" if essay_id else None
