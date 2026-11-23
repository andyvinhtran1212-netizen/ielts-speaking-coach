"""GET /api/student/assigned (LEARNERCORE-0063 amendment 3, T30a).

The new "Bài được giao" page reads the same list as /api/class/my-assignments,
through the T13 wrapper over ``routers.class_student._visible_assignments``
(that function, ``_decorate`` and the hand-in rules are not changed here), and
adds four fields per row so the page never derives them in the browser:

- ``accepting``: does the server still take a hand-in for this row, by the rule
  that already guards it. Class ledger rows (speaking, listening, reading,
  grammar, vocab, course) use ``is_accepting_submissions``, and a course row
  must also have a playable ``course_action``; a Writing give uses
  the Writing submit route's own rule, which has no deadline cutoff (a late
  essay is still taken while the give is ``pending``/``in_progress``).
- ``group``: overdue | todo | awaiting_review | returned (FR-096, plan.md).
- ``action``: start | resume | review_submitted | result | self_practice | none
  (FR-097), matching the target the current /my-class page opens.
- ``self_practice_available``: an unsubmitted row that no longer accepts, of a
  self-practice skill, whose paper is open to public self-practice right now
  (``class_self_practice.paper_open_for_self_practice``, T30b). Writing stays
  false until G08 ships its self-practice prompt bank.

Read-only except for the ledger reconcile ``_visible_assignments`` performs
itself (FR-103 exception, HOLD patch approved 23/11).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from services.class_assignment_service import is_accepting_submissions
from services import student_today

logger = logging.getLogger(__name__)

# The same set `_visible_assignments` uses to keep a submitted course row as
# work still owed (routers/class_student.py `_COURSE_WORK_ACTIONS`).
COURSE_WORK_ACTIONS = frozenset({"start", "continue", "retake", "retry_full", "expired_pending"})
# The course actions that open the player for new work (start_assignment).
COURSE_PLAYABLE_ACTIONS = frozenset({"start", "continue", "retake", "retry_full"})
SELF_PRACTICE_SKILLS = frozenset({"speaking", "writing", "listening", "reading"})
# Writing submit route: only these give states take a draft or a hand-in
# (routers/writing_student.py `_ACTIVE_ASSIGNMENT_STATES`).
WRITING_ACTIVE_STATES = frozenset({"pending", "in_progress"})
_WRITING_AWAITING = frozenset({"submitted", "graded"})


def _skill(row: Dict[str, Any]) -> str:
    return str((row.get("assignment") or {}).get("skill") or "")


def accepting_for(row: Dict[str, Any], now: datetime) -> bool:
    """Does the server still take a hand-in for this row (FR-099)?"""
    if row.get("submitted_at") and _skill(row) != "course":
        return False
    if _skill(row) == "writing":
        return str(row.get("state") or "") in WRITING_ACTIVE_STATES
    if _skill(row) == "course" and row.get("course_action") not in COURSE_PLAYABLE_ACTIONS:
        # `course_action` is the course rule's own verdict: `expired_pending`
        # (the timer ran out, the hand-in is being collected), `review` and
        # `closed` take no new work even before the deadline.
        return False
    assignment = row.get("assignment") or {}
    # `_visible_assignments` only returns ledger rows whose assignment is open
    # (published and revealed), so the remaining gate is the deadline, read by
    # the same function every hand-in route calls.
    return is_accepting_submissions(
        {"id": assignment.get("id"), "status": "published", "due_at": assignment.get("due_at")},
        now=now,
    )


def group_for(row: Dict[str, Any], accepting: bool) -> str:
    """FR-096 and the HOLD patch: a course row the server still counts as work
    is to-do even when it has a submitted_at (a failed attempt reopened by an
    extended deadline)."""
    if _skill(row) == "course" and row.get("course_action") in COURSE_WORK_ACTIONS:
        return "todo" if accepting else "overdue"
    if not row.get("submitted_at"):
        return "overdue" if (not accepting or row.get("is_missing")) else "todo"
    if _skill(row) == "writing" and row.get("review_state") in _WRITING_AWAITING:
        return "awaiting_review"
    if _skill(row) == "course" and row.get("release_state") == "awaiting_release":
        # COURSETESTRELEASE-0082, once it ships the field; absent today.
        return "awaiting_review"
    return "returned"


def _grammar_lesson(row: Dict[str, Any]) -> bool:
    config = (row.get("assignment") or {}).get("content_config") or {}
    return isinstance(config, dict) and config.get("assignment_type") == "grammar_lesson"


def action_for(row: Dict[str, Any], accepting: bool, self_practice: bool) -> str:
    """FR-097: the one button a row offers, with the same target the current
    /my-class page opens (lib/my-class-model.mjs `assignmentAction`)."""
    skill = _skill(row)
    submitted = bool(row.get("submitted_at"))
    missing = bool(row.get("is_missing"))
    state = str(row.get("state") or "")
    if skill == "writing":
        if row.get("review_state") == "returned" and row.get("result_path"):
            return "result"
        if submitted:
            return "review_submitted"
        return "start" if accepting else ("self_practice" if self_practice else "none")
    if skill == "course":
        # `expired_pending` opens the read-only "Đang thu bài" lane, as the
        # current /my-class page does.
        mapped = {"start": "start", "continue": "resume", "retake": "start",
                  "retry_full": "start", "review": "result",
                  "expired_pending": "review_submitted"}
        course_action = row.get("course_action") or ("review" if submitted else "start")
        action = mapped.get(course_action, "none")
        # Never offer new work the server would refuse.
        return "none" if action in ("start", "resume") and not accepting else action
    if skill == "grammar" and _grammar_lesson(row) and (submitted or (missing and state == "opened")):
        return "result"
    if skill in ("speaking", "listening", "reading") and submitted:
        return "result"
    if skill == "speaking" and missing and state != "assigned":
        # Existing rule: an overdue Speaking task with a started session opens
        # that session read-only (spec edge case "Bài Speaking quá hạn").
        return "result"
    if not submitted and accepting:
        return "resume" if state == "opened" else "start"
    if not submitted and self_practice:
        return "self_practice"
    return "none"


def _self_practice_open_ids(rows: List[Dict[str, Any]], user_id: Optional[str] = None) -> Set[str]:
    """Item ids whose paper is open for public self-practice right now (T30b,
    `class_self_practice.paper_open_for_self_practice`, one read per skill for
    the whole list). A failed read hides the button rather than failing the
    page: the route re-checks at call time anyway."""
    from database import supabase_admin
    from services.class_self_practice import paper_open_for_self_practice
    try:
        return paper_open_for_self_practice(supabase_admin, rows, user_id)
    except Exception as exc:
        logger.warning("[student-assigned] self-practice paper read failed: %s", exc)
        return set()


def decorate(rows: List[Dict[str, Any]], now: datetime,
             open_ids: Optional[Callable[[List[Dict[str, Any]]], Set[str]]] = None,
             user_id: Optional[str] = None,
             ) -> List[Dict[str, Any]]:
    open_ids = open_ids or (lambda candidates: _self_practice_open_ids(candidates, user_id))
    candidates: List[Dict[str, Any]] = []
    flags: List[Tuple[Dict[str, Any], bool]] = []
    for row in rows:
        accepting = accepting_for(row, now)
        flags.append((row, accepting))
        if not row.get("submitted_at") and not accepting and _skill(row) in SELF_PRACTICE_SKILLS:
            candidates.append(row)
    candidate_ids = {str(row.get("item_id")) for row in candidates}
    available = (open_ids(candidates) & candidate_ids) if candidates else set()
    out = []
    for row, accepting in flags:
        self_practice = str(row.get("item_id")) in available
        out.append({
            **row,
            "group": group_for(row, accepting),
            "action": action_for(row, accepting, self_practice),
            "accepting": accepting,
            "self_practice_available": self_practice,
        })
    return out


_LESSON_CHUNK = 200


def _lesson_links(rows: List[Dict[str, Any]]) -> Tuple[Dict[str, Optional[str]], bool]:
    """FR-123 (amendment 6, T30c): `{assignment_id: lesson_id}` from the
    `class_assignments.lesson_id` column (mig 177), for the class rows already
    in the list and the caller's own classes only. Writing gives live in
    `writing_assignments`, which has no lesson column, so they are skipped
    (always null). `content_config.lesson_id` (a grammar lesson code) is never
    read here. Returns `(links, ok)`; a failed read is `({}, False)`."""
    ids: List[str] = []
    cohorts: Set[str] = set()
    for row in rows:
        assignment = row.get("assignment") or {}
        if _skill(row) == "writing" or not assignment.get("id"):
            continue
        ids.append(str(assignment["id"]))
        if assignment.get("cohort_id"):
            cohorts.add(str(assignment["cohort_id"]))
    ids = list(dict.fromkeys(ids))
    if not ids or not cohorts:
        return {}, True
    from database import supabase_admin
    links: Dict[str, Optional[str]] = {}
    try:
        for start in range(0, len(ids), _LESSON_CHUNK):
            chunk = ids[start:start + _LESSON_CHUNK]
            data = (
                supabase_admin.table("class_assignments").select("id, lesson_id")
                .in_("id", chunk).in_("cohort_id", sorted(cohorts)).execute().data
            ) or []
            for r in data:
                lesson = r.get("lesson_id")
                links[str(r.get("id"))] = str(lesson) if lesson else None
    except Exception as exc:
        logger.warning("[student-assigned] lesson link read failed: %s", exc)
        return {}, False
    return links, True


def with_lesson_ids(items: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], bool]:
    """Adds `lesson_id` (str | None) to every row; `ok` is False when the read failed."""
    links, ok = _lesson_links(items)
    out = []
    for row in items:
        assignment = row.get("assignment") or {}
        lesson = None if _skill(row) == "writing" else links.get(str(assignment.get("id") or ""))
        out.append({**row, "lesson_id": lesson})
    return out, ok


def get_assigned(user_id: str, account_name: str, now: datetime) -> Dict[str, Any]:
    """The whole payload. A failed list read lands in `degraded` (the page says
    the list could not be read) rather than an empty "no work" answer."""
    degraded: List[str] = []
    has_class, items, stale = False, [], False
    try:
        has_class, rows, stale = student_today._visible_assignments_for(user_id, account_name, now)
        items = decorate(rows, now, user_id=user_id)
    except Exception as exc:
        logger.warning("[student-assigned] list read failed user=%s: %s", user_id, exc)
        degraded.append("items")
    else:
        items, links_ok = with_lesson_ids(items)
        if not links_ok:
            degraded.append("lesson_links")
    return {
        "has_class": has_class,
        "items": items,
        "repractice": [],
        "homework_stale": bool(stale),
        "degraded": degraded,
    }
