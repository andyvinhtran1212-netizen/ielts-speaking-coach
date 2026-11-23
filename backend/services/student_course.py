"""services/student_course.py — the Lộ trình page payload (LEARNERCORE-0063 T15,
amendment 1, FR-030…FR-037).

    GET /api/student/course -> get_course_concurrent(...)

Read-only, apart from the class-ledger reconcile that the shared assignment
reader performs for every caller (the FR-078 exception, amendment 3, #2484):
`assigned_open` reuses T13's count so the page and Today can never disagree.
Every query filters by the caller and runs on the service role, one worker
thread per part. A part that raises lands in `degraded` and keeps its empty
default. A source owned by a package that is not merged yet (G04 course
access and catalogue, COURSELESSON-0064 progress) is a `_..._for` join point
that returns None; None means "not there yet": an empty value, NOT degraded.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from services import student_today

logger = logging.getLogger(__name__)

_DEGRADABLE = ("online", "other_products", "class", "assigned_open")


# ── join points for other packages (None until wired) ─────────────────────────


def _courses_for(user_id: str) -> Optional[Dict[str, Any]]:  # G04 GET /api/me/courses
    """The `GET /api/me/courses` body of G04 (0055 plan 5.9) for this user."""
    return None


def _catalog_for() -> Optional[List[Dict[str, Any]]]:  # G04 GET /api/courses items
    """The public catalogue items of G04 (0055 plan 5.9)."""
    return None


def _lesson_progress_for(user_id: str, course_code: str) -> Optional[Dict[str, Any]]:
    """COURSELESSON-0064: {"done", "total", "last_at"} for one course."""
    return None


# ── online group (FR-031, FR-037) ─────────────────────────────────────────────


def _int_or_none(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _progress(user_id: str, course_code: str) -> Tuple[Optional[Dict[str, int]], Optional[datetime]]:
    try:
        raw = _lesson_progress_for(user_id, course_code)
    except Exception as exc:  # noqa: BLE001
        # Progress is a decoration of the row; a failure hides it, never the course.
        logger.warning("[course] lesson progress failed: %s", exc.__class__.__name__)
        return None, None
    if not isinstance(raw, dict):
        return None, None
    done, total = _int_or_none(raw.get("done")), _int_or_none(raw.get("total"))
    if done is None or total is None or total <= 0 or done < 0:
        return None, None
    return {"done": min(done, total), "total": total}, student_today._parse_ts(raw.get("last_at"))


def build_online(user_id: str, access: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Online rows (active first by days_left, then expired, newest expiry
    first), the class re-practice grants, and the default selected course."""
    items = (access or {}).get("items") if isinstance(access, dict) else None
    if not isinstance(items, list):
        return {"online": [], "repractice": [], "selected": None}
    active: List[Tuple[Tuple, Dict[str, Any], Optional[datetime]]] = []
    expired: List[Tuple[Tuple, Dict[str, Any], Optional[datetime]]] = []
    repractice: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict) or not item.get("course_code"):
            continue
        code = str(item["course_code"])
        state = item.get("state")
        if item.get("kind") in ("class", "repractice"):
            if state == "active":
                repractice.append({"course_code": code, "title": item.get("title") or code})
            continue
        if item.get("kind") != "online" or state not in ("active", "expired"):
            continue  # revoked or unknown: not shown
        progress, last_at = _progress(user_id, code)
        credits = item.get("credits") if isinstance(item.get("credits"), dict) else {}
        row = {
            "course_code": code,
            "product_slug": item.get("product_slug"),
            "title": item.get("title") or code,
            "state": state,
            "days_left": _int_or_none(item.get("days_left")) if state == "active" else None,
            "expires_at": item.get("expires_at"),
            "can_renew": bool(item.get("can_renew")),
            "progress": progress,
            # This grant's own balance (0055 5.9), never the account total.
            "credits_left": _int_or_none(credits.get("balance")),
        }
        if state == "active":
            days = row["days_left"]
            active.append(((days is None, days or 0, row["title"]), row, last_at))
        else:
            expires = student_today._parse_ts(row["expires_at"])
            stamp = -expires.timestamp() if expires else 0.0
            expired.append(((expires is None, stamp, row["title"]), row, last_at))
    active.sort(key=lambda entry: entry[0])
    expired.sort(key=lambda entry: entry[0])
    online = [row for _key, row, _at in active] + [row for _key, row, _at in expired]
    studied = [(at, row["course_code"]) for _key, row, at in active if at is not None]
    if studied:
        selected = max(studied, key=lambda pair: pair[0])[1]
    else:
        selected = online[0]["course_code"] if online else None
    return {"online": online, "repractice": repractice, "selected": selected}


def build_other_products(catalog: Optional[List[Dict[str, Any]]],
                         owned_slugs: List[str]) -> List[Dict[str, Any]]:
    if not isinstance(catalog, list):
        return []
    owned = {slug for slug in owned_slugs if slug}
    rows = []
    for item in catalog:
        if not isinstance(item, dict) or not item.get("slug"):
            continue
        if item.get("status") not in ("open", "coming_soon") or item["slug"] in owned:
            continue
        rows.append({"slug": item["slug"], "title": item.get("title") or item["slug"],
                     "status": item["status"], "starts_at": item.get("expected_open_on")})
    return rows


# ── class group (FR-032) ──────────────────────────────────────────────────────


def _teacher_name(sb, cohort_id: str) -> Optional[str]:
    """cohorts.instructor_id (mig 441, G09-T24) -> users.display_name. The
    column is not on every database yet; any failure is "no name", never an
    error of the class block."""
    try:
        rows = (sb.table("cohorts").select("instructor_id").eq("id", cohort_id)
                .limit(1).execute().data) or []
        instructor = rows[0].get("instructor_id") if rows else None
        if not instructor:
            return None
        users = (sb.table("users").select("display_name").eq("id", instructor)
                 .limit(1).execute().data) or []
        name = (users[0].get("display_name") or "").strip() if users else ""
        return name or None
    except Exception as exc:  # noqa: BLE001
        logger.info("[course] teacher name unavailable: %s", exc.__class__.__name__)
        return None


def _class_for(user_id: str, account_name: str) -> Optional[Dict[str, Any]]:
    """The class shown on the page: active (not archived) classes in the same
    order as GET /api/class/me (the learner's primary class first, then by
    name). Imported in the body, like T13, to avoid an import cycle."""
    from routers.class_student import _student_for_user
    from services.class_archive_service import active_cohort_ids_for_student
    from database import thread_supabase_admin

    sb = thread_supabase_admin()  # own client per worker thread (PC-J05 D1b)
    student = _student_for_user(user_id, account_name)
    if not student:
        return None
    cohort_ids = active_cohort_ids_for_student(sb, student)
    if not cohort_ids:
        return None
    rows = (sb.table("cohorts").select("id, name, course_id")
            .in_("id", cohort_ids).execute().data) or []
    if not rows:
        return None
    primary = str(student.get("cohort_id") or "")
    rows.sort(key=lambda row: (str(row.get("id")) != primary, (row.get("name") or "").casefold()))
    first = rows[0]
    course_title = None
    if first.get("course_id"):
        crows = (sb.table("courses").select("id, name").eq("id", first["course_id"])
                 .limit(1).execute().data) or []
        course_title = crows[0].get("name") if crows else None
    return {
        "name": first.get("name"),
        "teacher_name": _teacher_name(sb, str(first.get("id"))),
        "course_title": course_title,
        "repractice": [],
    }


def _assigned_open_for(user_id: str, account_name: str, now: datetime) -> Tuple[int, bool]:
    """T13's count (`assigned_total_open`), from the same reader."""
    _has_class, rows, stale = student_today._visible_assignments_for(user_id, account_name, now)
    return student_today.build_assigned(rows, now)["assigned_total_open"], stale


# ── assembly ──────────────────────────────────────────────────────────────────


async def get_course_concurrent(user_id: str, *, account_name: str = "",
                                now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    parts: Dict[str, Callable[[], Any]] = {
        "online": lambda: _courses_for(user_id),
        "other_products": _catalog_for,
        "class": lambda: _class_for(user_id, account_name),
        "assigned_open": lambda: _assigned_open_for(user_id, account_name, now),
    }
    outcomes = await asyncio.gather(*(asyncio.to_thread(fn) for fn in parts.values()),
                                    return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome
    return assemble_course(dict(zip(parts, outcomes)), user_id=user_id)


def assemble_course(results: Dict[str, Any], *, user_id: str) -> Dict[str, Any]:
    degraded: List[str] = []

    def take(key: str, default: Any) -> Any:
        value = results.get(key)
        if isinstance(value, Exception):
            logger.warning("[course] part %s failed: %s", key, value.__class__.__name__)
            degraded.append(key)
            return default
        return value

    online = build_online(user_id, take("online", None))
    other = build_other_products(take("other_products", None),
                                 [row.get("product_slug") for row in online["online"]])
    klass = take("class", None)
    if isinstance(klass, dict):
        klass = {**klass, "repractice": online["repractice"]}
    assigned_open, stale = take("assigned_open", (0, False))
    if stale and "assigned_open" not in degraded:
        degraded.append("assigned_open")  # the count may miss the newest hand-in
    return {
        "online": online["online"],
        "other_products": other,
        "class": klass,
        "assigned_open": assigned_open,
        "has_online": bool(online["online"]),
        "has_class": klass is not None,
        "selected": online["selected"],
        "degraded": [key for key in _DEGRADABLE if key in degraded],
    }
