"""The learner profile's Tổng quan tab (ADMINIA-0074 FR-024, FR-030, FR-031;
plan 5.4 ``GET /admin/learners/{ref}/overview``; G09-T04).

Each block is its own function. A block whose source cannot be read is
``None`` and its name goes to ``sources_failed``; the other blocks still
answer. Nothing here guesses: a value with no source yet (G04 courses and
credits, G09-T35 care notes, term milestones) is ``None``, not ``0`` or ``[]``.

* ``alerts``  — the reasons of ``learner_attention.compute`` (the one
  attention function, FR-029), plus the codes that were checked and did not
  fire (``checked_off``). ``course_expiring`` and ``low_credits`` need G04 and
  are neither open nor checked off.
* ``goal``    — the admin's goal (``students.target_band/target_date``) and the
  learner's own (``users.target_band/exam_date``) side by side (FR-030). A
  difference is ``conflict``, never an alert. ``estimated_band`` is the Overall
  of the learner's latest released mock exam that has all four skills.
* ``continuity`` — an 8 × 7 grid of Vietnam-time days (Monday first, the
  current week last, days after today ``None``), the current streak and the
  minutes of recorded study time this week and last week (FR-031).
* ``scores``  — grammar lesson accuracy, Writing, Speaking practice and mock
  Overall bands over time.

Synchronous; the router calls each block through ``asyncio.to_thread``.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

from database import supabase_admin
from services import learner_attention
from services.admin_learner_directory import Person

logger = logging.getLogger(__name__)

VN = ZoneInfo("Asia/Ho_Chi_Minh")
WEEKS = 8
_PAGE = 1000
_ID_CHUNK = 200
_SKILLS = ("listening", "reading", "writing", "speaking")
_FINISHED = (None, "completed", "time_cap")   # quiz_sessions.ended_by of a finished run

_ACTIONS = {
    "late_streak": "Xem bài được giao",
    "inactive": "Gửi nhắc",
    "course_expiring": "Xem khoá và quyền",
    "low_credits": "Xem lượt chấm",
}


def _paged(build: Callable[[], Any]) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _num(value: Any) -> Optional[float]:
    try:
        return None if value is None else round(float(value), 1)
    except (TypeError, ValueError):
        return None


def _iso(value: Any) -> Optional[str]:
    parsed = _parse(value)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if parsed else None


# ── 1 · Alerts ─────────────────────────────────────────────────────────────

def alerts(person: Person, thresholds: Optional[dict], *, now: datetime) -> dict[str, Any]:
    """Raises when the thresholds or the class work cannot be read: an
    unchecked learner is never shown as "Không có cảnh báo"."""
    if thresholds is None:
        raise RuntimeError("thresholds unavailable")
    result = learner_attention.compute([person.attention_input()], thresholds, now=now)
    if result.unread:
        raise RuntimeError("attention sources unread: " + ",".join(result.unread))
    reasons = result.reasons.get(person.ref, [])
    fired = {r["code"] for r in reasons}
    checked: list[str] = []
    # A lesson item a read cannot decide leaves only the late streak
    # undecided: it is neither open nor checked off, and the other reasons
    # still show.
    undecided = ["late_streak"] if person.ref in result.undecided else []
    if thresholds.get("late_streak_count") is not None and person.student_id and not undecided:
        checked.append("late_streak")
    if thresholds.get("inactive_days") is not None and person.user is not None:
        checked.append("inactive")
    return {
        "open": [{"code": r["code"], "text": r["text"], "action": _ACTIONS[r["code"]]} for r in reasons],
        "checked_off": [code for code in checked if code not in fired],
        "undecided": undecided,
    }


# ── 2 · Goal ───────────────────────────────────────────────────────────────

def _released_sittings(user_id: str) -> list[str]:
    return [str(s["id"]) for s in _paged(lambda: supabase_admin.table("mock_exam_sittings").select("id")
                                         .eq("user_id", user_id).eq("status", "released").order("id"))
            if s.get("id")]


def _released_mock_overall(user_id: str) -> Optional[float]:
    ids = _released_sittings(user_id)
    if not ids:
        return None
    reviews: list[dict] = []
    for offset in range(0, len(ids), _ID_CHUNK):
        chunk = ids[offset:offset + _ID_CHUNK]
        reviews.extend(_paged(lambda c=chunk: supabase_admin.table("mock_exam_reviews")
                              .select("id, sitting_id, status, final_bands, released_at")
                              .in_("sitting_id", c).eq("status", "released").order("id")))
    reviews.sort(key=lambda r: _parse(r.get("released_at")) or datetime.min.replace(tzinfo=timezone.utc),
                 reverse=True)
    for review in reviews:
        bands = review.get("final_bands") or {}
        if all(_num(bands.get(skill)) is not None for skill in _SKILLS) and _num(bands.get("overall")) is not None:
            return _num(bands["overall"])
    return None


def goal(person: Person) -> dict[str, Any]:
    student, user = person.student or {}, person.user or {}
    admin = {"target_band": _num(student.get("target_band")), "target_date": student.get("target_date") or None}
    learner = {"target_band": _num(user.get("target_band")), "exam_date": user.get("exam_date") or None}
    has_admin = any(v is not None for v in admin.values())
    has_learner = any(v is not None for v in learner.values())
    # A field set on one side only is not a conflict: only a field both sides
    # hold with different values is (the same rule as fn_learner_goal_resolve).
    pairs = ((admin["target_band"], learner["target_band"]), (admin["target_date"], learner["exam_date"]))
    conflict = bool(has_admin and has_learner and any(
        a is not None and b is not None and a != b for a, b in pairs))
    estimated = _released_mock_overall(str(user["id"])) if person.user else None
    return {"admin": admin, "learner": learner, "conflict": conflict, "estimated_band": estimated}


# ── 3 · Continuity ─────────────────────────────────────────────────────────

# (table, owner column, time column, seconds column or None). Writing essays
# are left out: an admin hands them in for the learner.
_ACTIVITY = (
    ("quiz_sessions", "user_id", "started_at", "duration_sec"),
    ("reading_test_attempts", "user_id", "submitted_at", "time_spent_seconds"),
    ("listening_test_attempts", "user_id", "submitted_at", "audio_duration_listened_seconds"),
    ("listening_attempts", "user_id", "created_at", None),
)


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _activity(person: Person, since: datetime, until: Optional[datetime]) -> list[tuple[datetime, float]]:
    """Every study instant of the learner in ``[since, until)`` with its
    recorded seconds (0 when the source has no duration)."""
    lo = since.isoformat()
    hi = until.isoformat() if until else None
    out: list[tuple[datetime, float]] = []

    def window(q, col):
        q = q.gte(col, lo)
        return q.lt(col, hi) if hi else q

    def add(ts: Any, secs: Any = None) -> None:
        when = _parse(ts)
        if when is None:
            return
        try:
            seconds = max(float(secs), 0.0) if secs else 0.0
        except (TypeError, ValueError):
            seconds = 0.0
        out.append((when, seconds))

    if person.user:
        uid = str(person.user["id"])
        for table, owner, col, secs_col in _ACTIVITY:
            cols = ", ".join(c for c in ("id", col, secs_col) if c)
            for row in _paged(lambda t=table, o=owner, c=col, s=cols:
                              window(supabase_admin.table(t).select(s).eq(o, uid), c).order("id")):
                add(row.get(col), row.get(secs_col) if secs_col else None)
        # Speaking sessions mark their day; their time is the length of the
        # recorded answers. One read serves both.
        sessions = _paged(lambda: window(supabase_admin.table("sessions").select("id, started_at")
                                         .eq("user_id", uid), "started_at").order("id"))
        for row in sessions:
            add(row.get("started_at"))
        session_ids = [str(r["id"]) for r in sessions]
        for offset in range(0, len(session_ids), _ID_CHUNK):
            chunk = session_ids[offset:offset + _ID_CHUNK]
            for row in _paged(lambda c=chunk: supabase_admin.table("responses")
                              .select("id, created_at, duration_seconds").in_("session_id", c).order("id")):
                if row.get("duration_seconds"):
                    add(row.get("created_at"), row["duration_seconds"])
    if person.student_id:
        for row in _paged(lambda: window(supabase_admin.table("class_assignment_items")
                                         .select("id, submitted_at").eq("student_id", person.student_id),
                                         "submitted_at").order("id")):
            add(row.get("submitted_at"))
    return out


# A streak longer than the grid is read further back, 8 weeks at a time, up
# to this many extra windows (about two years).
_STREAK_WINDOWS = 13


def continuity(person: Person, *, now: datetime) -> dict[str, Any]:
    today = now.astimezone(VN).date()
    first = _week_start(today) - timedelta(weeks=WEEKS - 1)

    def start_of(day: date) -> datetime:
        return datetime.combine(day, datetime.min.time(), VN).astimezone(timezone.utc)

    this_week, last_week = _week_start(today), _week_start(today) - timedelta(weeks=1)
    days: set[date] = set()
    seconds = {this_week: 0.0, last_week: 0.0}
    for when, secs in _activity(person, start_of(first), None):
        day = when.astimezone(VN).date()
        if first <= day <= today:
            days.add(day)
        week = _week_start(day)
        if week in seconds:
            seconds[week] += secs

    weeks = []
    for w in range(WEEKS):
        start = first + timedelta(weeks=w)
        weeks.append([None if (start + timedelta(days=d)) > today else (start + timedelta(days=d)) in days
                      for d in range(7)])
    # The streak counts back from today, or from yesterday when today has no
    # activity yet (a learner who studied every day is not at 0 at 7 AM).
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    # Reached the start of the grid: the streak may go on before it.
    window_end = first
    for _ in range(_STREAK_WINDOWS):
        if cursor >= window_end:
            break
        window_start = window_end - timedelta(weeks=WEEKS)
        older = {when.astimezone(VN).date()
                 for when, _secs in _activity(person, start_of(window_start), start_of(window_end))}
        while cursor in older:
            streak += 1
            cursor -= timedelta(days=1)
        window_end = window_start
    return {"weeks": weeks, "streak_days": streak,
            "minutes_this_week": int(seconds[this_week] // 60),
            "minutes_last_week": int(seconds[last_week] // 60)}


# ── 4 · Assigned work ──────────────────────────────────────────────────────

def assigned(person: Person, *, now: datetime) -> dict[str, Any]:
    """Class work over :func:`learner_attention.class_work` (the same rows and
    hand-in rule as the attention status). The three counts are over work
    whose deadline has passed; ``open`` is work not yet due and not handed
    in. Read only."""
    on_time = late = missing = undecided = 0
    open_rows: list[dict] = []
    overdue: list[dict] = []
    rows = learner_attention.class_work([person.student_id], now).get(person.student_id, []) \
        if person.student_id else []
    for it in rows:
        due, submitted = it["due_at"], it["submitted_at"]
        row = {"assignment_id": it["assignment_id"], "title": it["title"], "due_at": _iso(due)}
        if it["unconfirmed"]:
            undecided += 1
            continue
        if due is not None and now > due:
            if not it["handed_in"]:
                missing += 1
                overdue.append({**row, "days_overdue": (now - due).days, "last_reminded_at": None})
            elif submitted is not None and submitted > due:
                late += 1
            else:
                on_time += 1
        elif not it["handed_in"]:
            open_rows.append(row)
    overdue.sort(key=lambda r: r["days_overdue"], reverse=True)
    open_rows.sort(key=lambda r: r["due_at"] or "~")
    return {"on_time": on_time, "late": late, "missing": missing, "undecided": undecided,
            "open": open_rows, "overdue": overdue}


# ── 5 · Scores over time ───────────────────────────────────────────────────

def scores(person: Person) -> dict[str, Any]:
    grammar: list[dict] = []
    speaking: list[dict] = []
    mock: list[dict] = []
    writing: list[dict] = []
    if person.user:
        uid = str(person.user["id"])
        runs = _paged(lambda: supabase_admin.table("quiz_sessions")
                      .select("id, bank_id, ended_at, ended_by, accuracy, kind").eq("user_id", uid).order("id"))
        # A paused or abandoned run also has ended_at and a partial accuracy
        # (quiz_service): only a finished run is a score.
        runs = [r for r in runs if (r.get("kind") or "run") == "run" and r.get("ended_at")
                and r.get("ended_by") in _FINISHED and r.get("accuracy") is not None]
        bank_ids = list({str(r["bank_id"]) for r in runs if r.get("bank_id")})
        banks: dict[str, dict] = {}
        for offset in range(0, len(bank_ids), _ID_CHUNK):
            chunk = bank_ids[offset:offset + _ID_CHUNK]
            for b in (supabase_admin.table("quiz_banks").select("id, skill_area, lesson_no")
                      .in_("id", chunk).execute().data or []):
                banks[str(b["id"])] = b
        for r in runs:
            bank = banks.get(str(r.get("bank_id")))
            if bank and bank.get("skill_area") == "grammar":
                grammar.append({"at": _iso(r["ended_at"]), "pct": round(float(r["accuracy"]) * 100),
                                "lesson_no": bank.get("lesson_no")})
        for s in _paged(lambda: supabase_admin.table("sessions").select("id, started_at, overall_band")
                        .eq("user_id", uid).eq("status", "completed").not_.is_("overall_band", "null")
                        .is_("sitting_id", "null").order("id")):
            band = _num(s.get("overall_band"))
            if band is not None:
                speaking.append({"at": _iso(s.get("started_at")), "band": band})
        sittings = _released_sittings(uid)
        for offset in range(0, len(sittings), _ID_CHUNK):
            chunk = sittings[offset:offset + _ID_CHUNK]
            for rv in _paged(lambda c=chunk: supabase_admin.table("mock_exam_reviews")
                             .select("id, sitting_id, final_bands, released_at")
                             .in_("sitting_id", c).eq("status", "released").order("id")):
                band = _num((rv.get("final_bands") or {}).get("overall"))
                if band is not None and rv.get("released_at"):
                    mock.append({"at": _iso(rv["released_at"]), "band": band})
    if person.student_id:
        for e in _paged(lambda: supabase_admin.table("writing_essays")
                        .select("id, is_flagged, delivered_at, "
                                "writing_feedback:writing_feedback_current(overall_band_score)")
                        .eq("student_id", person.student_id).eq("status", "delivered")
                        .is_("deleted_at", "null").is_("sitting_id", "null").order("id")):
            if e.get("is_flagged") or not e.get("delivered_at"):
                continue
            fb = e.get("writing_feedback")
            fb = fb[0] if isinstance(fb, list) and fb else fb
            band = _num(fb.get("overall_band_score")) if isinstance(fb, dict) else None
            if band is not None:
                writing.append({"at": _iso(e["delivered_at"]), "band": band})
    for series in (grammar, writing, speaking, mock):
        series.sort(key=lambda p: p["at"] or "")
    # Mid-term and end-of-term markers have no source yet: None, not [].
    return {"grammar": grammar, "writing": writing, "speaking": speaking, "mock": mock, "milestones": None}


def side() -> dict[str, Any]:
    """Right column. Care notes arrive with G09-T35; courses and credits with
    G04's read API. Until then each is ``None`` (never 0)."""
    return {"due_notes": None, "courses": None, "credits_left": None, "credits_carried": None}
