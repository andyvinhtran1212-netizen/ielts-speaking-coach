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
    # A lesson item (skill "course") with an empty ledger but some linked lesson
    # work: whether it was handed in, and when, is the ledger repair's call
    # (all sections, late work allowed), which a read cannot make. Such an item
    # is left out of past_due, and the learner's history is not decided.
    unconfirmed: bool = False

    @property
    def overdue(self) -> list[dict[str, Any]]:
        return [row for row in self.past_due if row["missing"]]


@dataclass
class AttentionResult:
    reasons: dict[str, list[dict[str, str]]]      # learner key -> [{code, text}], heaviest first
    sources_failed: list[str]
    history: dict[str, AssignmentHistory]          # student id -> history (when read)
    # Learners whose late streak a read cannot decide (a lesson item, see
    # AssignmentHistory.unconfirmed). Their other reasons are still decided.
    undecided: set[str] = field(default_factory=set)
    # Sources that could not be read at all: nothing they feed is decided.
    unread: list[str] = field(default_factory=list)


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


def _read_items(ids: list[str]) -> list[dict]:
    items: list[dict] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        items.extend(_paged(lambda c=chunk: supabase_admin.table("class_assignment_items")
                            .select("id, assignment_id, student_id, state, submitted_at")
                            .in_("student_id", c).order("id")))
    return items


# Durable Speaking hand-in evidence the class ledger is repaired from
# (reconcile_ledger_from_sessions). ``(table, time column, extra filter)``.
# Reading/Listening hand-ins are decided by the repair's own read-only half,
# class_assignment_service.test_attempt_handins (drill dictation, blackeye
# tests, deadline, archive), so both always agree.
_EVIDENCE = (
    ("sessions", "completed_at", ("status", "completed")),
)
# Lesson work linked to a lesson item; it can only say "something was done".
_LESSON_WORK = (("quiz_sessions", "ended_at"), ("course_writing_submissions", "created_at"))


def _evidence_at(item_ids: list[str], sources=_EVIDENCE) -> dict[str, datetime]:
    """Earliest durable hand-in per class item whose ledger ``submitted_at`` is
    still empty: a completed Speaking session or a submitted Reading/Listening
    attempt linked to the item. Read only: a GET never repairs the ledger (the
    class pages do), it only refuses to read a failed ledger write as missing
    work. Raises on a failed read."""
    found: dict[str, datetime] = {}
    for table, col, extra in sources:
        for offset in range(0, len(item_ids), _ID_CHUNK):
            chunk = item_ids[offset:offset + _ID_CHUNK]

            def build(c=chunk, t=table, tc=col, x=extra):
                q = (supabase_admin.table(t).select(f"id, class_assignment_item_id, {tc}")
                     .in_("class_assignment_item_id", c))
                if x:
                    q = q.eq(*x)
                return q.order("id")

            for row in _paged(build):
                at = _parse(row.get(col))
                key = str(row.get("class_assignment_item_id") or "")
                if at is not None and key and (key not in found or at < found[key]):
                    found[key] = at
    return found


def _archived_cohorts(cohort_ids: set[str]) -> set[str]:
    found: set[str] = set()
    ids = sorted(cohort_ids)
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        for row in _paged(lambda c=chunk: supabase_admin.table("cohorts")
                          .select("id, is_active, archived_at").in_("id", c).order("id")):
            if row.get("is_active") is False and row.get("archived_at"):
                found.add(str(row["id"]))
    return found


def assignment_history(student_ids: Iterable[str], now: datetime,
                       cohort_ids: Optional[frozenset[str]] = None) -> dict[str, AssignmentHistory]:
    """Every published class assignment item whose deadline has passed, per
    student, newest deadline first. An empty ledger row with durable on-time
    evidence (see :func:`_evidence_at`) counts as handed in. Read only.
    ``cohort_ids`` (a teacher's scope) keeps only those classes' work, before
    any evidence is read; it is filtered in the query. Work of an archived
    class (``is_active`` false and ``archived_at`` set, as
    ``class_archive_service`` reads it) is left out: it is history, not
    something the learner can still hand in. Raises when a table cannot be
    read."""
    ids = list(dict.fromkeys(str(s) for s in student_ids if s))
    if cohort_ids is not None and not cohort_ids:
        return {sid: AssignmentHistory() for sid in ids}
    items = _read_items(ids)
    assignment_ids = list({str(i["assignment_id"]) for i in items if i.get("assignment_id")})
    assignments: dict[str, dict] = {}
    for offset in range(0, len(assignment_ids), _ID_CHUNK):
        chunk = assignment_ids[offset:offset + _ID_CHUNK]

        def build(c=chunk):
            q = supabase_admin.table("class_assignments").select(
                "id, cohort_id, title, skill, due_at, status, content_config").in_("id", c)
            if cohort_ids is not None:
                q = q.in_("cohort_id", sorted(cohort_ids))
            return q.order("id")

        for row in _paged(build):
            assignments[str(row["id"])] = row
    archived = _archived_cohorts({str(a.get("cohort_id")) for a in assignments.values() if a.get("cohort_id")})
    assignments = {k: a for k, a in assignments.items() if str(a.get("cohort_id")) not in archived}
    items = [i for i in items if str(i.get("assignment_id")) in assignments]
    unledgered = [str(i["id"]) for i in items if not i.get("submitted_at") and i.get("id")]
    lesson = {str(i["id"]) for i in items if str(i["id"]) in set(unledgered)
              and assignments[str(i["assignment_id"])].get("skill") == "course"}
    others = [i for i in unledgered if i not in lesson]
    evidence = _evidence_at(others) if others else {}
    if others:
        from services.class_assignment_service import test_attempt_handins

        pending = [{"id": str(i["id"]), "assignment_id": str(i["assignment_id"])}
                   for i in items if str(i["id"]) in set(others)]
        for item_id, hit in test_attempt_handins(supabase_admin, list(assignments.values()), pending).items():
            at = _parse(hit.get("when"))
            if at is not None and (item_id not in evidence or at < evidence[item_id]):
                evidence[item_id] = at
    lesson_work = _evidence_at(sorted(lesson), tuple((t, c, None) for t, c in _LESSON_WORK)) if lesson else {}

    out = {sid: AssignmentHistory() for sid in ids}
    for item in items:
        a = assignments.get(str(item.get("assignment_id")))
        if not a or a.get("status") != "published":
            continue
        due = _parse(a.get("due_at"))
        if due is None or due > now:
            continue
        submitted = _parse(item.get("submitted_at"))
        history = out.setdefault(str(item["student_id"]), AssignmentHistory())
        if submitted is None and str(item.get("id")) in lesson_work:
            history.unconfirmed = True
            continue
        if submitted is None:
            # A Speaking or Reading/Listening hand-in on time whose ledger write
            # failed counts as on time. One after the deadline stays missing, as
            # the ledger repair (which refuses late completions there) leaves it.
            proof = evidence.get(str(item.get("id")))
            if proof is not None and proof <= due:
                submitted = proof
        handed_in = submitted is not None or item.get("state") in ("submitted", "graded")
        history.past_due.append({
            "title": a.get("title") or "", "due_at": due,
            "cohort_id": str(a.get("cohort_id") or ""),
            "missing": not handed_in,
            "late": not handed_in or (submitted is not None and submitted > due),
        })
    for history in out.values():
        history.past_due.sort(key=lambda r: r["due_at"], reverse=True)
    return out


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
        return AttentionResult(reasons, ["thresholds"], {}, unread=["thresholds"])
    failed: list[str] = []

    if history is _UNREAD:
        student_ids = [p["student_id"] for p in people if p.get("student_id")]
        try:
            history = assignment_history(student_ids, now) if student_ids else {}
        except Exception as exc:
            logger.warning("learner_attention: assignment history unavailable (%s)", type(exc).__name__)
            history = None
    history_read = history is not None
    if history is None:
        failed.append("assignments")
        history = {}

    unread = list(failed)
    undecided: set[str] = set()
    late_n = thresholds.get("late_streak_count")
    idle_days = thresholds.get("inactive_days")
    for p in people:
        found: dict[str, str] = {}
        sid = p.get("student_id")
        mine = history.get(str(sid), AssignmentHistory()) if sid else AssignmentHistory()
        if mine.unconfirmed:
            undecided.add(p["key"])
            if "assignments" not in failed:
                failed.append("assignments")
        # Undecided only for this learner: the others' streaks are still read.
        if late_n is not None and sid and history_read and not mine.unconfirmed:
            streak = _late_streak(mine)
            if streak >= late_n:
                found["late_streak"] = f"trễ {streak} bài liên tiếp"
        if idle_days is not None and p.get("has_account"):
            seen = _parse(p.get("last_active_at")) or _parse(p.get("account_created_at"))
            if seen is not None:
                days = (now - seen).days
                if days >= idle_days:
                    found["inactive"] = f"không hoạt động {days} ngày"
        reasons[p["key"]] = [{"code": code, "text": found[code]} for code in ORDER if code in found]
    return AttentionResult(reasons, failed, history, undecided, unread)


def status_line(reasons: list[dict[str, str]], failed: list[str]) -> dict[str, Any]:
    """``{level, reasons}`` for a summary: at most the two heaviest reasons.
    ``level`` is ``None`` when nothing was found but a source failed, so an
    unread learner is never shown as "Đang ổn"."""
    if reasons:
        return {"level": "attention", "reasons": reasons[:2]}
    return {"level": None if failed else "ok", "reasons": []}
