"""services/student_today.py — the new Today page payload (LEARNERCORE-0063 T13).

    GET  /api/student/today        -> get_today_concurrent(...)
    POST /api/student/today/seen   -> advance_seen_cursor(...)

GET writes nothing of its own; POST writes only the caller's seen cursor.
The one write GET can trigger is the ledger reconcile that
routers.class_student._visible_assignments already performs for every caller
of /api/class/my-assignments (reconcile_test_attempts, reconcile_course_items).
That exception is FR-078 as amended by 0063 amendment 3 (#2484), so #2484
merges before this module. Every query filters explicitly by the
caller (`user_id` / `student_id`), runs on the service role like
services/student_home_aggregator, and each part runs in its own worker thread.
A part that raises lands in `degraded` and keeps its empty default; a source
that does not exist yet (another work package not merged) returns empty and is
NOT degraded (FR-026). Join points for those packages are the `_..._for`
functions below: each returns the empty value until its package wires it.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
ASSIGNED_LIMIT = 5
RESUME_LIMIT = 4
NEW_RESULTS_LIMIT = 2
NEW_RESULTS_DEFAULT_WINDOW = timedelta(days=7)  # empty cursor (open question 5)
NEW_RESULTS_SCAN = 50  # per source, oldest first after the cursor
SEEN_FUTURE_SLACK = timedelta(minutes=1)
SEEN_KEY_RE = re.compile(r"^(writing|speaking):[A-Za-z0-9_-]{1,64}$")

# Core-player runtime admission (frontend/lib/core-player-affinity.mjs): the
# server-side launcher picks the renderer, so Today never pins one itself.
CORE_PLAYER_LAUNCH = "/core-player/launch"

_TASK_LABELS = {"task1_academic": "Writing Task 1", "task1_general": "Writing Task 1",
                "task2": "Writing Task 2"}


# ── time helpers ──────────────────────────────────────────────────────────────


def _parse_ts(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _end_of_tomorrow_vn(now: datetime) -> datetime:
    today = now.astimezone(VN_TZ).date()
    return datetime.combine(today + timedelta(days=2), datetime.min.time(), VN_TZ)


def _launch(surface: str, **query: str) -> str:
    return f"{CORE_PLAYER_LAUNCH}?{urlencode({'surface': surface, **query})}"


# ── assigned (FR-020, FR-022) ─────────────────────────────────────────────────


def _visible_assignments_for(user_id: str, account_name: str, now: datetime):
    """Thin wrapper over routers.class_student (unchanged): returns
    (has_class, rows, stale). Imported here to avoid an import cycle. `stale`
    is the router's own flag (a ledger refresh or the Writing lookup failed);
    the page then marks `assigned` degraded, as /api/class/me sets
    homework_stale.

    _visible_assignments reconciles the class ledger as it reads (the FR-078
    exception of amendment 3, #2484); nothing else in this module writes."""
    from routers.class_student import _student_for_user, _visible_assignments
    from services.class_archive_service import active_cohort_ids_for_student
    from database import supabase_admin

    student = _student_for_user(user_id, account_name)
    if not student:
        return False, [], False
    cohort_ids = active_cohort_ids_for_student(supabase_admin, student)
    if not cohort_ids:
        return False, [], False
    rows, stale = _visible_assignments(student, now, cohort_ids)
    return True, rows, bool(stale)


def build_assigned(rows: List[Dict[str, Any]], now: datetime) -> Dict[str, Any]:
    horizon = _end_of_tomorrow_vn(now)
    soon: List[Tuple[Tuple, Dict[str, Any]]] = []
    later = 0
    for row in rows:
        if row.get("submitted_at"):
            continue
        due = _parse_ts((row.get("assignment") or {}).get("due_at"))
        overdue = bool(row.get("is_missing")) or (due is not None and due < now)
        if overdue or (due is not None and due < horizon):
            key = (0 if overdue else 1, due or horizon, str(row.get("item_id") or ""))
            soon.append((key, row))
        else:
            later += 1
    soon.sort(key=lambda pair: pair[0])
    return {
        "assigned": [row for _key, row in soon[:ASSIGNED_LIMIT]],
        "assigned_due_soon": len(soon),
        "assigned_due_later": later,
        "assigned_total_open": len(soon) + later,
    }


# ── resume (FR-023) ───────────────────────────────────────────────────────────

_RESUME_SOURCES = (
    # (kind, table, extra columns)
    ("speaking", "sessions", "part, mode"),
    ("reading", "reading_test_attempts", "test_id"),
    ("listening", "listening_test_attempts", "test_id"),
    ("dictation", "dictation_attempts", "test_id, section_num"),
)


def _titles(sb, table: str, ids: List[str]) -> Dict[str, str]:
    if not ids:
        return {}
    rows = sb.table(table).select("id, title").in_("id", ids).execute().data or []
    return {str(r["id"]): r.get("title") or "" for r in rows}


def _reading_codes(sb, ids: List[str]) -> Dict[str, str]:
    if not ids:
        return {}
    rows = sb.table("reading_tests").select("id, test_id").in_("id", ids).execute().data or []
    return {str(r["id"]): str(r["test_id"]) for r in rows if r.get("test_id")}


def build_resume(sb, user_id: str, now: datetime) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for kind, table, extra in _RESUME_SOURCES:
        rows = (
            sb.table(table)
            .select(f"id, status, started_at, resume_expires_at, {extra}")
            .eq("user_id", user_id)
            .eq("status", "in_progress")
            .gt("resume_expires_at", _iso(now))
            .order("started_at", desc=True)
            .limit(RESUME_LIMIT)
            .execute()
        ).data or []
        if kind == "speaking":
            for r in rows:
                part = r.get("part")
                title = f"Speaking Part {part}" if part else "Speaking"
                items.append(_resume_item(kind, title, r,
                                          _launch("speaking", session_id=str(r["id"]))))
            continue
        tests_table = "reading_tests" if kind == "reading" else "listening_tests"
        test_ids = sorted({str(r["test_id"]) for r in rows if r.get("test_id")})
        titles = _titles(sb, tests_table, test_ids)
        # reading_test_attempts.test_id is the reading_tests row UUID, but the
        # reading player resolves ?test_id= against reading_tests.test_id (the
        # public code, mig 086), as class_student's start route does.
        codes = _reading_codes(sb, test_ids) if kind == "reading" else {}
        for r in rows:
            test_id = str(r.get("test_id") or "")
            if not test_id:
                continue
            title = titles.get(test_id) or {"reading": "Bài Reading", "listening": "Bài Listening",
                                            "dictation": "Chép chính tả"}[kind]
            if kind == "reading":
                code = codes.get(test_id)
                if not code:
                    continue  # no live paper to resume into: never a 404 link
                href = _launch("reading_exam", test_id=code)
            elif kind == "listening":
                href = _launch("listening_test", id=test_id)
            else:
                query = {"test_id": test_id}
                if r.get("section_num"):
                    query["section"] = str(r["section_num"])
                href = _launch("listening_dictation", **query)
            items.append(_resume_item(kind, title, r, href))
    items.sort(key=lambda item: item.pop("_started") or datetime.min.replace(tzinfo=timezone.utc),
               reverse=True)
    return items[:RESUME_LIMIT]


def _resume_item(kind: str, title: str, row: Dict[str, Any], href: str) -> Dict[str, Any]:
    return {"kind": kind, "title": title, "progress": None, "href": href,
            "expires_at": row.get("resume_expires_at"),
            "_started": _parse_ts(row.get("started_at"))}


# ── goal (FR-070) ─────────────────────────────────────────────────────────────


def build_goal(sb, user_id: str, now: datetime) -> Optional[Dict[str, Any]]:
    rows = (sb.table("users").select("target_band, exam_date").eq("id", user_id)
            .limit(1).execute()).data or []
    if not rows or rows[0].get("target_band") is None:
        return None
    exam_raw = rows[0].get("exam_date")
    exam: Optional[date] = None
    if exam_raw:
        try:
            exam = date.fromisoformat(str(exam_raw)[:10])
        except ValueError:
            exam = None
    weeks_left = None
    if exam is not None:
        days = (exam - now.astimezone(VN_TZ).date()).days
        weeks_left = math.ceil(days / 7) if days >= 0 else None
    return {"target_band": float(rows[0]["target_band"]),
            "exam_date": exam.isoformat() if exam else None,
            "weeks_left": weeks_left}


# ── new results (FR-025, FR-078) ──────────────────────────────────────────────


def _cursor(sb, user_id: str) -> Tuple[Optional[datetime], str]:
    rows = (sb.table("users").select("today_seen_at, today_seen_key").eq("id", user_id)
            .limit(1).execute()).data or []
    if not rows:
        return None, ""
    return _parse_ts(rows[0].get("today_seen_at")), rows[0].get("today_seen_key") or ""


def build_new_results(sb, user_id: str, now: datetime) -> Dict[str, Any]:
    seen_at, seen_key = _cursor(sb, user_id)
    floor = seen_at if seen_at is not None else now - NEW_RESULTS_DEFAULT_WINDOW
    candidates: List[Tuple[datetime, str, Dict[str, Any]]] = []

    student_ids = [str(r["id"]) for r in (
        sb.table("students").select("id").eq("user_id", user_id).execute().data or [])]
    if student_ids:
        essays = (
            sb.table("writing_essays")
            .select("id, task_type, delivered_at")
            .in_("student_id", student_ids)
            .eq("status", "delivered")
            .gte("delivered_at", _iso(floor))
            .order("delivered_at")
            .limit(NEW_RESULTS_SCAN)
            .execute()
        ).data or []
        for e in essays:
            ts = _parse_ts(e.get("delivered_at"))
            if ts is None:
                continue
            key = f"writing:{e['id']}"
            candidates.append((ts, key, {
                "kind": "writing", "title": _TASK_LABELS.get(e.get("task_type"), "Writing"),
                "returned_at": _iso(ts), "key": key,
                "href": f"/writing/result?{urlencode({'essay_id': str(e['id'])})}",
            }))

    sessions = (
        sb.table("sessions")
        .select("id, part, completed_at, overall_band")
        .eq("user_id", user_id)
        .eq("status", "completed")
        .not_.is_("overall_band", "null")
        .gte("completed_at", _iso(floor))
        .order("completed_at")
        .limit(NEW_RESULTS_SCAN)
        .execute()
    ).data or []
    for s in sessions:
        ts = _parse_ts(s.get("completed_at"))
        if ts is None:
            continue
        key = f"speaking:{s['id']}"
        part = s.get("part")
        candidates.append((ts, key, {
            "kind": "speaking", "title": f"Speaking Part {part}" if part else "Speaking",
            "returned_at": _iso(ts), "key": key,
            "href": f"/result?{urlencode({'id': str(s['id'])})}",
        }))

    if seen_at is not None:
        candidates = [c for c in candidates if (c[0], c[1]) > (seen_at, seen_key)]
    candidates.sort(key=lambda c: (c[0], c[1]))
    shown = candidates[:NEW_RESULTS_LIMIT]
    cursor = None
    if shown:
        newest = shown[-1]
        cursor = {"seen_until": _iso(newest[0]), "seen_key": newest[1]}
    return {"new_results": [c[2] for c in reversed(shown)], "new_results_cursor": cursor}


def validate_seen(seen_until: datetime, seen_key: str, now: datetime) -> Optional[str]:
    if seen_until.tzinfo is None:
        return "seen_until_timezone_required"
    if seen_until > now + SEEN_FUTURE_SLACK:
        return "seen_until_in_future"
    if not SEEN_KEY_RE.match(seen_key or ""):
        return "seen_key_invalid"
    return None


def _quoted(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def advance_seen_cursor(sb, user_id: str, seen_until: datetime, seen_key: str) -> None:
    """One conditional UPDATE of the caller's own row: the cursor only moves
    forward in tuple order (today_seen_at, coalesce(today_seen_key, ''));
    an older or equal pair is a no-op, so the call is idempotent.

    Python orders seen_key by code point while PostgREST `lt` uses the DB
    collation. For keys of the form `speaking:<uuid>` / `writing:<uuid>` both
    give the same order: the prefixes differ at the first letter and a uuid
    has `-` at fixed positions, so no collation rule can reorder two keys."""
    at = _quoted(_iso(seen_until))
    key = _quoted(seen_key)
    (
        sb.table("users")
        .update({"today_seen_at": _iso(seen_until), "today_seen_key": seen_key})
        .eq("id", user_id)
        .or_(
            "today_seen_at.is.null,"
            f"today_seen_at.lt.{at},"
            f"and(today_seen_at.eq.{at},or(today_seen_key.is.null,today_seen_key.lt.{key}))"
        )
        .execute()
    )


# ── join points for other packages (empty until wired) ────────────────────────


def _access_for(user_id: str) -> List[Dict[str, Any]]:      # G04 GET /api/me/courses
    return []


def _credits_for(user_id: str) -> Optional[Dict[str, Any]]:  # G04 GET /api/me/credits
    return None


def _orders_open_for(user_id: str) -> List[Dict[str, Any]]:  # G04 enrollment orders
    return []


def _trial_today_left_for(user_id: str) -> Optional[int]:   # TRIALCAP-0080
    return None


def _repeat_error_for(user_id: str) -> Optional[Dict[str, Any]]:  # GOI-12 error book
    return None


def _next_lesson_for(user_id: str) -> Optional[Dict[str, Any]]:  # COURSELESSON-0064
    return None


def _open_surveys_for(user_id: str) -> List[Dict[str, Any]]:  # GOI-13
    return []


def _mock_exams_for(user_id: str) -> List[Dict[str, Any]]:  # G08-T22
    return []


def _safe_repeat_error(user_id: str) -> Optional[Dict[str, Any]]:
    """FR-071: None, an exception or a malformed value all mean "no block";
    the error book never lands in `degraded`."""
    try:
        value = _repeat_error_for(user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[today] repeat_error source failed: %s", exc.__class__.__name__)
        return None
    if not isinstance(value, dict):
        return None
    try:
        return {"label": str(value["label"]), "count": int(value["count"]),
                "of": int(value["of"]), "review_href": value.get("review_href"),
                "total_errors": int(value["total_errors"])}
    except (KeyError, TypeError, ValueError):
        return None


# ── state and banner (FR-019, FR-029) ─────────────────────────────────────────


def derive_state(*, has_class: bool, access: List[Dict[str, Any]],
                 orders_open: List[Dict[str, Any]], has_lesson_progress: bool = False) -> str:
    online_live = [a for a in access
                   if a.get("kind") == "online" and a.get("state") in ("active", "expiring")]
    if online_live and not has_lesson_progress:
        return "first_day" if _next_lesson_tables_exist() else "learning"
    if online_live or has_class or any(a.get("state") in ("active", "expiring") for a in access):
        return "learning"
    if any(o.get("status") in ("awaiting_transfer", "transfer_reported", "needs_info")
           for o in orders_open):
        return "order_pending"
    return "no_course"


def _next_lesson_tables_exist() -> bool:
    return False  # before COURSELESSON-0064 there is never a first_day


def derive_banner(state: str, access: List[Dict[str, Any]], credits: Optional[Dict[str, Any]],
                  orders_open: List[Dict[str, Any]]) -> Optional[str]:
    if state not in ("learning", "first_day"):
        return None
    online = [a for a in access if a.get("kind") == "online"]
    if online and all(a.get("state") == "expired" for a in online):
        return "expired"
    renewing = any(o.get("kind") == "renewal" for o in orders_open)
    if any(a.get("can_renew") and a.get("state") != "expired" for a in online) and not renewing:
        return "expiring"
    if credits is not None and credits.get("total") == 0 and credits.get("has_source", True):
        return "out_of_credits"
    return None


# ── assembly ──────────────────────────────────────────────────────────────────

_DEGRADABLE = ("assigned", "resume", "goal", "new_results")


async def get_today_concurrent(
    make_sb: Callable[[], Any], user_id: str, *, name: str, account_name: str = "",
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    parts: Dict[str, Callable[[], Any]] = {
        "assigned": lambda: _visible_assignments_for(user_id, account_name, now),
        "resume": lambda: build_resume(make_sb(), user_id, now),
        "goal": lambda: build_goal(make_sb(), user_id, now),
        "new_results": lambda: build_new_results(make_sb(), user_id, now),
    }
    outcomes = await asyncio.gather(*(asyncio.to_thread(fn) for fn in parts.values()),
                                    return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome
    results = dict(zip(parts, outcomes))
    return assemble_today(results, user_id=user_id, name=name, now=now)


def assemble_today(results: Dict[str, Any], *, user_id: str, name: str,
                   now: datetime) -> Dict[str, Any]:
    degraded: List[str] = []

    def take(key: str, default: Any) -> Any:
        value = results.get(key)
        if isinstance(value, Exception):
            logger.warning("[today] part %s failed: %s", key, value.__class__.__name__)
            degraded.append(key)
            return default
        return value

    has_class, rows, assigned_stale = take("assigned", (False, [], False))
    if assigned_stale and "assigned" not in degraded:
        # The rows may carry provisional labels; the block shows its own
        # degraded state instead of passing them off as current (FR-026).
        degraded.append("assigned")
    assigned = build_assigned(rows, now)
    access = _access_for(user_id)
    credits = _credits_for(user_id)
    orders_open = _orders_open_for(user_id)
    state = derive_state(has_class=has_class, access=access, orders_open=orders_open)
    new = take("new_results", {"new_results": [], "new_results_cursor": None})
    return {
        "student": {"name": name},
        "next_lesson": _next_lesson_for(user_id),
        **assigned,
        "resume": take("resume", []),
        "state": state,
        "banner": derive_banner(state, access, credits, orders_open),
        "access": access,
        "credits": credits,
        "orders_open": orders_open,
        "goal": take("goal", None),
        "new_results": new["new_results"],
        "new_results_cursor": new["new_results_cursor"],
        "repeat_error": _safe_repeat_error(user_id),
        "trial_today_left": _trial_today_left_for(user_id) if state == "no_course" else None,
        "open_surveys": _open_surveys_for(user_id),
        "mock_exams": _mock_exams_for(user_id),
        "degraded": [key for key in _DEGRADABLE if key in degraded],
    }
