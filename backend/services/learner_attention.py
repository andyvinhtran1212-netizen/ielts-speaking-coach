"""Why a learner needs attention (ADMINIA-0074 FR-09-029; plan 5.4; G09-T03).

ONE function, :func:`compute`, decides the "Cần chú ý" reasons for the
directory (column and filter), the learner summary, the profile, Việc cần làm
(T06) and the teacher area. Callers never re-derive a reason themselves.

Reasons, heaviest first (a status line shows at most two):

* ``late_streak`` — the learner's most recent N class assignments whose
  deadline has passed were all late or not handed in, N =
  ``late_streak_count`` from Cài đặt › Ngưỡng vận hành (T22).
* ``inactive`` — no activity for ``inactive_days``. Activity is the account's
  ``users.last_seen_at`` (falling back to when the account was created); a
  profile with no account has no activity signal and never gets this reason.
* ``course_expiring`` / ``low_credits`` — need the G04 entitlement and credit
  reads, which do not exist yet, so they are never raised (not guessed).

A threshold set to "off" (``None``) disables its reason. A source that cannot
be read is named in ``sources_failed`` and its reason is left out; callers say
so instead of showing "Đang ổn".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from database import supabase_admin

logger = logging.getLogger(__name__)

ORDER = ("late_streak", "inactive", "course_expiring", "low_credits")
_ID_CHUNK = 200
_PAGE = 1000


@dataclass
class AssignmentHistory:
    """The deadline-passed class assignments of one learner, newest first."""
    past_due: list[dict[str, Any]] = field(default_factory=list)  # {title, due_at, late, missing}

    @property
    def overdue(self) -> list[dict[str, Any]]:
        return [row for row in self.past_due if row["missing"]]


@dataclass
class AttentionResult:
    reasons: dict[str, list[dict[str, str]]]      # learner key -> [{code, text}], heaviest first
    sources_failed: list[str]
    history: dict[str, AssignmentHistory]          # student id -> history (when read)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _paged(build) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def assignment_history(student_ids: Iterable[str], now: datetime) -> dict[str, AssignmentHistory]:
    """Every published class assignment item whose deadline has passed, per
    student, newest deadline first. Raises when either table cannot be read."""
    ids = list(dict.fromkeys(str(s) for s in student_ids if s))
    items: list[dict] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        items.extend(_paged(lambda c=chunk: supabase_admin.table("class_assignment_items")
                            .select("id, assignment_id, student_id, state, submitted_at")
                            .in_("student_id", c).order("id")))
    assignment_ids = list({str(i["assignment_id"]) for i in items if i.get("assignment_id")})
    assignments: dict[str, dict] = {}
    for offset in range(0, len(assignment_ids), _ID_CHUNK):
        chunk = assignment_ids[offset:offset + _ID_CHUNK]
        for row in _paged(lambda c=chunk: supabase_admin.table("class_assignments")
                          .select("id, cohort_id, title, due_at, status").in_("id", c).order("id")):
            assignments[str(row["id"])] = row

    out = {sid: AssignmentHistory() for sid in ids}
    for item in items:
        a = assignments.get(str(item.get("assignment_id")))
        if not a or a.get("status") != "published":
            continue
        due = _parse(a.get("due_at"))
        if due is None or due > now:
            continue
        submitted = _parse(item.get("submitted_at"))
        handed_in = submitted is not None or item.get("state") in ("submitted", "graded")
        out.setdefault(str(item["student_id"]), AssignmentHistory()).past_due.append({
            "title": a.get("title") or "", "due_at": due,
            "cohort_id": str(a.get("cohort_id") or ""),
            "missing": not handed_in,
            "late": not handed_in or (submitted is not None and submitted > due),
        })
    for history in out.values():
        history.past_due.sort(key=lambda r: r["due_at"], reverse=True)
    return out


def only_cohorts(history: dict[str, AssignmentHistory], cohort_ids: frozenset[str]) -> dict[str, AssignmentHistory]:
    """The same histories keeping only the work of ``cohort_ids`` (a teacher's
    classes, FR-102): another teacher's class work never reaches them."""
    return {sid: AssignmentHistory([r for r in h.past_due if r.get("cohort_id") in cohort_ids])
            for sid, h in history.items()}


def _late_streak(history: AssignmentHistory) -> int:
    streak = 0
    for row in history.past_due:
        if not row["late"]:
            break
        streak += 1
    return streak


_UNREAD = object()


def compute(learners: Iterable[dict[str, Any]], thresholds: Optional[dict[str, Optional[int]]],
            *, now: Optional[datetime] = None, history: Any = _UNREAD) -> AttentionResult:
    """Reasons for each learner.

    ``learners``: ``{key, student_id?, last_active_at?, account_created_at?,
    has_account}``. ``thresholds``: the T22 values, or ``None`` when they could
    not be read (then nothing is decided and ``thresholds`` is reported failed).
    ``history``: an :func:`assignment_history` result the caller already read,
    or ``None`` when that read failed; by default it is read here.
    """
    now = now or datetime.now(timezone.utc)
    people = list(learners)
    reasons: dict[str, list[dict[str, str]]] = {p["key"]: [] for p in people}
    if thresholds is None:
        return AttentionResult(reasons, ["thresholds"], {})
    failed: list[str] = []

    if history is _UNREAD:
        student_ids = [p["student_id"] for p in people if p.get("student_id")]
        try:
            history = assignment_history(student_ids, now) if student_ids else {}
        except Exception as exc:
            logger.warning("learner_attention: assignment history unavailable (%s)", type(exc).__name__)
            history = None
    if history is None:
        failed.append("assignments")
        history = {}

    late_n = thresholds.get("late_streak_count")
    idle_days = thresholds.get("inactive_days")
    for p in people:
        found: dict[str, str] = {}
        sid = p.get("student_id")
        if late_n is not None and sid and "assignments" not in failed:
            streak = _late_streak(history.get(str(sid), AssignmentHistory()))
            if streak >= late_n:
                found["late_streak"] = f"trễ {streak} bài liên tiếp"
        if idle_days is not None and p.get("has_account"):
            seen = _parse(p.get("last_active_at")) or _parse(p.get("account_created_at"))
            if seen is not None:
                days = (now - seen).days
                if days >= idle_days:
                    found["inactive"] = f"không hoạt động {days} ngày"
        reasons[p["key"]] = [{"code": code, "text": found[code]} for code in ORDER if code in found]
    return AttentionResult(reasons, failed, history)


def status_line(reasons: list[dict[str, str]], failed: list[str]) -> dict[str, Any]:
    """``{level, reasons}`` for a summary: at most the two heaviest reasons.
    ``level`` is ``None`` when nothing was found but a source failed, so an
    unread learner is never shown as "Đang ổn"."""
    if reasons:
        return {"level": "attention", "reasons": reasons[:2]}
    return {"level": None if failed else "ok", "reasons": []}
