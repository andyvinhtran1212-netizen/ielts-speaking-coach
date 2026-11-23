"""Việc cần làm / Việc của tôi (ADMINIA-0074 FR-090…093, FR-104; plan 5.4;
G09-T06). Read only.

:func:`build` returns the body of ``GET /admin/attention`` (``cohort_ids``
None) or ``GET /instructor/attention`` (a teacher's classes from
``services.staff_scope``). One function per queue row; each row fails on its
own:

* a source that cannot be read → ``count=None, error=True``;
* a package that has not shipped → ``count=None, unavailable=True``;
* never a stand-in 0.

Sources (all read at request time, nothing cached):

* ``exams_today`` (admin) — published ``mock_exams`` whose ``open_from`` falls
  on today in Vietnam time.
* ``writing_review`` — live Writing essays a person still has to look at:
  AI-graded (``graded``) or AI-failed (``failed``, also ``ai_failed``). Age is
  from when the current AI grade was written (``writing_feedback_current``;
  a failed essay: from when it was submitted), against
  ``writing_review_hours``. A teacher counts only work given to one of their
  current classes (``writing_assignments.cohort_id``) that they can also
  open (``instructor_access.assert_essay_owned`` rule), as quick search does.
* ``assignments_overdue`` — published class assignments past their deadline
  with at least one learner who has not handed in (``learner_attention``'s
  hand-in rule, so the ledger-repair evidence is honoured); archived classes
  are left out.
* ``regrade_new`` — ``essay_regrade_requests`` still ``pending``, against
  ``regrade_hours``; a teacher counts those on the same essays.
* ``feedback_open`` (admin) — ``user_feedback`` still ``new``, against
  ``feedback_unanswered_hours``.
* Not shipped yet, so ``unavailable``: ``speaking_mock_pending`` (T38),
  ``course_tests_awaiting_release`` (GOI-11 E), ``care_due_today`` (mig 442),
  ``incident_groups_open`` (T07), and the G04 rows ``enrollments_reported``,
  ``entitlements_expiring``, ``classes_unmetered``.

Blocks: ``classes_week`` (lessons in the next 7 Vietnam days),
``attention_learners`` (``learner_attention.compute``, the directory's rule,
at most 8, most reasons first then by name) and, for admins, ``ops_week``.

Logs name the block and the exception type only: no learner data.
"""

from __future__ import annotations

import logging
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from database import supabase_admin
from services import admin_learner_directory as directory
from services import learner_attention
from services.class_membership_service import active_memberships_for_cohorts

logger = logging.getLogger(__name__)

VN = timezone(timedelta(hours=7))
ATTENTION_LIMIT = 8
WEEK_DAYS = 7
_ID_CHUNK = 200
_REVIEW_STATUSES = ("graded", "failed")

# Rows and blocks only an admin gets (FR-104).
ADMIN_ONLY_QUEUES = ("exams_today", "enrollments_reported", "incident_groups_open",
                     "feedback_open", "classes_unmetered")
# Rows whose source ships with a later package.
UNAVAILABLE = ("speaking_mock_pending", "course_tests_awaiting_release", "care_due_today",
               "incident_groups_open", "enrollments_reported", "entitlements_expiring",
               "classes_unmetered")


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _chunks(ids: list[str]):
    for offset in range(0, len(ids), _ID_CHUNK):
        yield ids[offset:offset + _ID_CHUNK]


def _queue(count: int, oldest: Optional[datetime], limit_hours: Optional[int], now: datetime,
           *, overdue: Optional[bool] = None) -> dict[str, Any]:
    if overdue is None:
        overdue = bool(count and oldest is not None and limit_hours is not None
                       and now - oldest >= timedelta(hours=limit_hours))
    return {"count": count, "oldest_at": oldest, "overdue": overdue, "error": False, "unavailable": False}


def _failed_queue(**extra: Any) -> dict[str, Any]:
    return {"count": None, "oldest_at": None, "overdue": False, "error": True, "unavailable": False, **extra}


def _unavailable_queue(**extra: Any) -> dict[str, Any]:
    return {"count": None, "oldest_at": None, "overdue": False, "error": False, "unavailable": True, **extra}


class _Ctx:
    """One request. Shared reads are memoised so two rows never disagree."""

    def __init__(self, *, now: datetime, thresholds: Optional[dict[str, Optional[int]]],
                 cohort_ids: Optional[frozenset[str]], viewer_id: Optional[str], hide_test: bool):
        self.now = now
        self.thresholds = thresholds
        self.cohort_ids = cohort_ids
        self.viewer_id = viewer_id
        self.hide_test = hide_test
        self.failed: list[str] = []
        self._memo: dict[str, Any] = {}

    @property
    def is_admin(self) -> bool:
        return self.cohort_ids is None

    def limit(self, key: str) -> Optional[int]:
        return (self.thresholds or {}).get(key)

    def memo(self, key: str, fn: Callable[[], Any]) -> Any:
        if key not in self._memo:
            self._memo[key] = fn()
        return self._memo[key]


# ── Essays a person still has to look at ─────────────────────────────────

def _owned_essay_ids(ctx: _Ctx, essays: list[dict]) -> set[str]:
    """The essays of ``essays`` that are work of one of the teacher's current
    classes (a ``writing_assignments`` row with ``cohort_id`` in
    ``ctx.cohort_ids``, FR-104) AND that the teacher can open
    (``instructor_access.assert_essay_owned``: that class assignment was given
    by them, or the essay's learner has ``students.instructor_id`` = them).
    Same rule as quick search (``admin_search._teacher_essays``). A teacher
    with no class gets nothing, whatever they gave earlier. Every read is
    paged and chunked."""
    me = ctx.viewer_id
    if not me or not ctx.cohort_ids:
        return set()
    classes = sorted(ctx.cohort_ids)
    ids = sorted({str(e["id"]) for e in essays if e.get("id")})
    in_class: set[str] = set()
    given_by_me: set[str] = set()
    for chunk in _chunks(ids):
        rows = directory._paged(lambda c=chunk: supabase_admin.table("writing_assignments")
                                .select("id, essay_id, assigned_by").in_("essay_id", c)
                                .in_("cohort_id", classes).order("id"))
        for r in rows:
            if r.get("essay_id"):
                in_class.add(str(r["essay_id"]))
                if str(r.get("assigned_by")) == me:
                    given_by_me.add(str(r["essay_id"]))
    students = sorted({str(e["student_id"]) for e in essays if e.get("student_id")
                       and str(e["id"]) in in_class and str(e["id"]) not in given_by_me})
    mine: set[str] = set()
    for chunk in _chunks(students):
        rows = directory._paged(lambda c=chunk: supabase_admin.table("students")
                                .select("id").eq("instructor_id", me).in_("id", c).order("id"))
        mine |= {str(r["id"]) for r in rows if r.get("id")}
    return given_by_me | {str(e["id"]) for e in essays
                          if str(e.get("id")) in in_class and str(e.get("student_id")) in mine}


def _scope_essays(ctx: _Ctx, rows: list[dict], key: str = "id") -> list[dict]:
    if ctx.is_admin or ctx.viewer_id is None:
        return rows
    owned = _owned_essay_ids(ctx, [{"id": r.get(key), "student_id": r.get("student_id")} for r in rows])
    return [r for r in rows if str(r.get(key)) in owned]


def review_essays(ctx: _Ctx) -> list[dict]:
    """``[{id, student_id, status, created_at}]`` awaiting a person, in scope."""
    def read() -> list[dict]:
        rows = directory._paged(lambda: supabase_admin.table("writing_essays")
                                .select("id, student_id, status, created_at")
                                .in_("status", list(_REVIEW_STATUSES)).is_("deleted_at", "null").order("id"))
        return _scope_essays(ctx, rows)
    return ctx.memo("review_essays", read)


def q_writing_review(ctx: _Ctx) -> dict[str, Any]:
    essays = review_essays(ctx)
    graded = sorted(str(e["id"]) for e in essays if e.get("status") == "graded")
    graded_at: dict[str, datetime] = {}
    for chunk in _chunks(graded):
        for row in directory._paged(lambda c=chunk: supabase_admin.table("writing_feedback_current")
                                    .select("essay_id, created_at").in_("essay_id", c).order("essay_id")):
            at = _parse(row.get("created_at"))
            key = str(row.get("essay_id") or "")
            if at is not None and key and (key not in graded_at or at > graded_at[key]):
                graded_at[key] = at
    anchors = [graded_at.get(str(e["id"])) or _parse(e.get("created_at")) for e in essays]
    anchors = [a for a in anchors if a is not None]
    out = _queue(len(essays), min(anchors) if anchors else None, ctx.limit("writing_review_hours"), ctx.now)
    out["ai_failed"] = sum(1 for e in essays if e.get("status") == "failed")
    return out


def q_regrade_new(ctx: _Ctx) -> dict[str, Any]:
    rows = directory._paged(lambda: supabase_admin.table("essay_regrade_requests")
                            .select("id, essay_id, created_at").eq("status", "pending").order("id"))
    if not ctx.is_admin and ctx.viewer_id is not None and rows:
        essay_ids = sorted({str(r["essay_id"]) for r in rows if r.get("essay_id")})
        essays: list[dict] = []
        for chunk in _chunks(essay_ids):
            essays += directory._paged(lambda c=chunk: supabase_admin.table("writing_essays")
                                       .select("id, student_id").in_("id", c).order("id"))
        owned = _owned_essay_ids(ctx, essays)
        rows = [r for r in rows if str(r.get("essay_id")) in owned]
    times = [t for t in (_parse(r.get("created_at")) for r in rows) if t is not None]
    return _queue(len(rows), min(times) if times else None, ctx.limit("regrade_hours"), ctx.now)


def q_feedback_open(ctx: _Ctx) -> dict[str, Any]:
    rows = directory._paged(lambda: supabase_admin.table("user_feedback")
                            .select("id, created_at").eq("status", "new").order("id"))
    times = [t for t in (_parse(r.get("created_at")) for r in rows) if t is not None]
    return _queue(len(rows), min(times) if times else None, ctx.limit("feedback_unanswered_hours"), ctx.now)


def vn_today(now: datetime) -> date:
    return now.astimezone(VN).date()


def q_exams_today(ctx: _Ctx) -> dict[str, Any]:
    start = datetime.combine(vn_today(ctx.now), datetime.min.time(), tzinfo=VN)
    end = start + timedelta(days=1)
    rows = directory._paged(lambda: supabase_admin.table("mock_exams")
                            .select("id, open_from").eq("status", "published")
                            .gte("open_from", start.isoformat()).lt("open_from", end.isoformat()).order("id"))
    times = [t for t in (_parse(r.get("open_from")) for r in rows) if t is not None]
    return _queue(len(rows), min(times) if times else None, None, ctx.now, overdue=False)


# ── Class assignments ─────────────────────────────────────────────────────

def _past_due_assignments(ctx: _Ctx) -> list[dict]:
    def read() -> list[dict]:
        if ctx.cohort_ids is not None and not ctx.cohort_ids:
            return []

        def build():
            q = (supabase_admin.table("class_assignments").select("id, cohort_id, due_at, status")
                 .eq("status", "published").lt("due_at", ctx.now.isoformat()))
            if ctx.cohort_ids is not None:
                q = q.in_("cohort_id", sorted(ctx.cohort_ids))
            return q.order("id")
        return directory._paged(build)
    return ctx.memo("past_due", read)


def _past_due_work(ctx: _Ctx) -> dict[str, list[dict]]:
    """``learner_attention.class_work`` rows of the past-due assignments,
    grouped by assignment id."""
    def read() -> dict[str, list[dict]]:
        assignments = {str(a["id"]) for a in _past_due_assignments(ctx) if a.get("id")}
        if not assignments:
            return {}
        students: set[str] = set()
        for chunk in _chunks(sorted(assignments)):
            for item in directory._paged(lambda c=chunk: supabase_admin.table("class_assignment_items")
                                         .select("id, assignment_id, student_id").in_("assignment_id", c).order("id")):
                if item.get("student_id"):
                    students.add(str(item["student_id"]))
        work = learner_attention.class_work(sorted(students), ctx.now, ctx.cohort_ids) if students else {}
        out: dict[str, list[dict]] = {}
        for rows in work.values():
            for row in rows:
                if row["assignment_id"] in assignments:
                    out.setdefault(row["assignment_id"], []).append(row)
        return out
    return ctx.memo("past_due_work", read)


def q_assignments_overdue(ctx: _Ctx) -> dict[str, Any]:
    work = _past_due_work(ctx)
    dues: list[datetime] = []
    for rows in work.values():
        # An undecided lesson item is neither counted as missing nor as handed in.
        if any(not r["handed_in"] and not r["unconfirmed"] for r in rows):
            due = rows[0]["due_at"]
            if due is not None:
                dues.append(due)
    return _queue(len(dues), min(dues) if dues else None, None, ctx.now, overdue=bool(dues))


# ── Blocks ────────────────────────────────────────────────────────────────

def _lesson(row: dict) -> dict[str, Any]:
    return {"lesson_id": str(row["id"]), "lesson_no": row.get("lesson_no"),
            "date": row.get("lesson_date"), "starts_at": row.get("starts_at")}


def classes_week(ctx: _Ctx) -> list[dict[str, Any]]:
    if ctx.cohort_ids is not None and not ctx.cohort_ids:
        return []
    ids = sorted(ctx.cohort_ids) if ctx.cohort_ids is not None else None

    def cohorts_build(c=None):
        q = supabase_admin.table("cohorts").select("id, name, is_active, archived_at")
        if c is not None:
            q = q.in_("id", c)
        return q.order("id")

    cohort_rows = ([r for chunk in _chunks(ids) for r in directory._paged(lambda c=chunk: cohorts_build(c))]
                   if ids is not None else directory._paged(cohorts_build))
    live = {str(r["id"]): r for r in cohort_rows
            if r.get("id") and not (r.get("is_active") is False and r.get("archived_at"))}
    if not live:
        return []
    today = vn_today(ctx.now)
    lessons: list[dict] = []
    for chunk in _chunks(sorted(live)):
        lessons += directory._paged(lambda c=chunk: supabase_admin.table("class_lessons")
                                    .select("id, cohort_id, lesson_no, lesson_date, starts_at")
                                    .in_("cohort_id", c).gte("lesson_date", today.isoformat())
                                    .lt("lesson_date", (today + timedelta(days=WEEK_DAYS)).isoformat())
                                    .order("id"))
    by_cohort: dict[str, list[dict]] = {}
    for row in lessons:
        if row.get("id") and row.get("lesson_date") and str(row.get("cohort_id")) in live:
            by_cohort.setdefault(str(row["cohort_id"]), []).append(row)
    if not by_cohort:
        return []

    published: list[dict] = []
    for chunk in _chunks(sorted(by_cohort)):
        published += directory._paged(lambda c=chunk: supabase_admin.table("class_assignments")
                                      .select("id, cohort_id, lesson_id, created_at")
                                      .in_("cohort_id", c).eq("status", "published").order("id"))
    lessons_given = {str(a["lesson_id"]) for a in published if a.get("lesson_id")}
    latest: dict[str, dict] = {}
    for a in published:
        cid = str(a.get("cohort_id"))
        if cid not in latest or (str(a.get("created_at") or ""), str(a["id"])) > (
                str(latest[cid].get("created_at") or ""), str(latest[cid]["id"])):
            latest[cid] = a

    # Essays still to review that were given to the class (writing_assignments.cohort_id).
    pending: dict[str, set[str]] = {}
    essay_ids = sorted(str(e["id"]) for e in review_essays(ctx))
    for chunk in _chunks(essay_ids):
        for row in directory._paged(lambda c=chunk: supabase_admin.table("writing_assignments")
                                    .select("id, essay_id, cohort_id").in_("essay_id", c).order("id")):
            if row.get("cohort_id") and row.get("essay_id"):
                pending.setdefault(str(row["cohort_id"]), set()).add(str(row["essay_id"]))

    out: list[dict[str, Any]] = []
    for cid, rows in by_cohort.items():
        rows.sort(key=lambda r: (str(r["lesson_date"]), str(r.get("starts_at") or ""), r.get("lesson_no") or 0, str(r["id"])))
        first = rows[0]
        following = rows[1] if len(rows) > 1 and str(first["lesson_date"]) == today.isoformat() else None
        out.append({
            "cohort_id": cid, "name": live[cid].get("name"),
            "next_lesson": _lesson(first),
            "following_lesson": _lesson(following) if following else None,
            "has_assignment": str(first["id"]) in lessons_given,
            "pending_review": len(pending.get(cid, set())),
            "last_assignment_id": str(latest[cid]["id"]) if cid in latest else None,
        })
    out.sort(key=lambda c: (str(c["next_lesson"]["date"]), str(c["next_lesson"]["starts_at"] or ""),
                            directory.fold(c["name"]), c["cohort_id"]))
    return out


def _people(ctx: _Ctx) -> list[directory.Person]:
    def read() -> list[directory.Person]:
        people = [p for p in directory.load_people(hide_test=ctx.hide_test)
                  if not (p.student and p.student.get("archived_at"))]
        if ctx.cohort_ids is None:
            return people
        members = {str(m["student_id"]) for m in
                   (active_memberships_for_cohorts(supabase_admin, sorted(ctx.cohort_ids)) if ctx.cohort_ids else [])
                   if m.get("student_id")}
        return [p for p in people if p.student_id in members]
    return ctx.memo("people", read)


def _attention(ctx: _Ctx) -> learner_attention.AttentionResult:
    def read() -> learner_attention.AttentionResult:
        people = _people(ctx)
        sids = [p.student_id for p in people if p.student_id]
        history: Any
        try:
            history = learner_attention.assignment_history(sids, ctx.now, ctx.cohort_ids) if sids else {}
        except Exception as exc:
            logger.warning("staff_attention: block=assignment_history failed (%s)", type(exc).__name__)
            history = None
        return learner_attention.compute([p.attention_input() for p in people], ctx.thresholds,
                                         now=ctx.now, history=history)
    return ctx.memo("attention", read)


def attention_learners(ctx: _Ctx) -> Optional[list[dict[str, Any]]]:
    result = _attention(ctx)
    for source in result.sources_failed:
        name = f"attention_learners.{source}"
        if name not in ctx.failed:
            ctx.failed.append(name)
    if result.unread:
        return None
    people = [p for p in _people(ctx) if result.reasons.get(p.ref)]
    people.sort(key=lambda p: (-len(result.reasons[p.ref]), directory.sort_key(p)))
    top = people[:ATTENTION_LIMIT]
    cohorts = directory.cohorts_of(top) if top else {}
    out = []
    for p in top:
        mine = [c for c in cohorts.get(p.student_id or "", [])
                if ctx.cohort_ids is None or c["id"] in ctx.cohort_ids]
        out.append({"ref": p.ref, "name": p.name, "cohort": mine[0] if mine else None,
                    "reasons": result.reasons[p.ref]})
    return out


def on_time_rate(ctx: _Ctx) -> Optional[dict[str, Any]]:
    """Share of class items due in the last 7 days handed in by their deadline."""
    since = ctx.now - timedelta(days=WEEK_DAYS)
    by_cohort: dict[str, list[int]] = {}
    for rows in _past_due_work(ctx).values():
        for r in rows:
            due = r["due_at"]
            if due is None or due < since or r["unconfirmed"]:
                continue
            on_time = r["handed_in"] and (r["submitted_at"] is None or r["submitted_at"] <= due)
            tally = by_cohort.setdefault(r["cohort_id"], [0, 0])
            tally[0] += int(on_time)
            tally[1] += 1
    total = sum(t[1] for t in by_cohort.values())
    if not total:
        return None
    lowest = min(by_cohort, key=lambda c: (by_cohort[c][0] / by_cohort[c][1], c))
    return {"value": round(sum(t[0] for t in by_cohort.values()) / total, 4), "lowest_cohort_id": lowest or None}


def inactive_learners(ctx: _Ctx) -> Optional[int]:
    result = _attention(ctx)
    if result.unread or ctx.limit("inactive_days") is None:
        return None
    return sum(1 for reasons in result.reasons.values() if any(r["code"] == "inactive" for r in reasons))


def review_wait_median_hours(ctx: _Ctx) -> Optional[float]:
    """Median hours from the first AI grade to the review, over essays
    reviewed in the last 7 days."""
    since = (ctx.now - timedelta(days=WEEK_DAYS)).isoformat()
    essays = directory._paged(lambda: supabase_admin.table("writing_essays")
                              .select("id, admin_reviewed_at").gte("admin_reviewed_at", since)
                              .is_("deleted_at", "null").order("id"))
    reviewed = {str(e["id"]): _parse(e.get("admin_reviewed_at")) for e in essays if e.get("id")}
    first: dict[str, datetime] = {}
    for chunk in _chunks(sorted(reviewed)):
        # GV-1a version-management read: the first AI grade is the essay's
        # earliest version row, so every version is read, not the current view.
        for row in directory._paged(lambda c=chunk: supabase_admin.table("writing_feedback")
                                    .select("id, essay_id, created_at").in_("essay_id", c).order("id")):
            at, key = _parse(row.get("created_at")), str(row.get("essay_id") or "")
            if at is not None and key and (key not in first or at < first[key]):
                first[key] = at
    waits = [(reviewed[k] - first[k]).total_seconds() / 3600 for k in reviewed
             if reviewed[k] is not None and k in first and reviewed[k] >= first[k]]
    return round(statistics.median(waits), 1) if waits else None


# ── Assembly ──────────────────────────────────────────────────────────────

_QUEUES: dict[str, Callable[[_Ctx], dict[str, Any]]] = {
    "exams_today": q_exams_today,
    "writing_review": q_writing_review,
    "assignments_overdue": q_assignments_overdue,
    "regrade_new": q_regrade_new,
    "feedback_open": q_feedback_open,
}
QUEUE_ORDER = ("exams_today", "writing_review", "speaking_mock_pending", "course_tests_awaiting_release",
               "assignments_overdue", "regrade_new", "enrollments_reported", "care_due_today",
               "incident_groups_open", "feedback_open", "entitlements_expiring", "classes_unmetered")


def _attempt(ctx: _Ctx, name: str, fn: Callable[[], Any], on_error: Any) -> Any:
    try:
        return fn()
    except Exception as exc:
        logger.warning("staff_attention: block=%s failed (%s)", name, type(exc).__name__)
        ctx.failed.append(name)
        return on_error


def build(*, cohort_ids: Optional[frozenset[str]], viewer_id: Optional[str], hide_test: bool,
          thresholds: Optional[dict[str, Optional[int]]], now: Optional[datetime] = None) -> dict[str, Any]:
    """``cohort_ids`` None: the admin body. Otherwise the teacher body for
    those classes, and ``viewer_id`` is the teacher (for the essays they can
    open). ``thresholds`` None: they could not be read, so nothing is marked
    overdue by age and ``thresholds`` is named in ``sources_failed``."""
    ctx = _Ctx(now=now or datetime.now(timezone.utc), thresholds=thresholds, cohort_ids=cohort_ids,
               viewer_id=viewer_id, hide_test=hide_test)
    if thresholds is None:
        ctx.failed.append("thresholds")
    admin = cohort_ids is None
    queues: dict[str, Any] = {}
    for key in QUEUE_ORDER:
        if not admin and key in ADMIN_ONLY_QUEUES:
            continue
        extra = {"ai_failed": None} if key == "writing_review" else {}
        if key in UNAVAILABLE:
            queues[key] = _unavailable_queue(**extra)
        else:
            queues[key] = _attempt(ctx, key, lambda k=key: _QUEUES[k](ctx), _failed_queue(**extra))

    out: dict[str, Any] = {
        "queues": queues,
        "classes_week": _attempt(ctx, "classes_week", lambda: classes_week(ctx), None),
        "attention_learners": _attempt(ctx, "attention_learners", lambda: attention_learners(ctx), None),
    }
    if admin:
        out["ops_week"] = {
            "on_time_rate": _attempt(ctx, "ops_week.on_time_rate", lambda: on_time_rate(ctx), None),
            "inactive_learners": _attempt(ctx, "ops_week.inactive_learners", lambda: inactive_learners(ctx), None),
            "review_wait_median_hours": _attempt(ctx, "ops_week.review_wait_median_hours",
                                                 lambda: review_wait_median_hours(ctx), None),
        }
    out["sources_failed"] = list(dict.fromkeys(ctx.failed))
    out["generated_at"] = ctx.now
    return out
