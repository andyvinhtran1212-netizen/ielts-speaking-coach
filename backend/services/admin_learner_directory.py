"""One learner directory over ``users`` and ``students`` (ADMINIA-0074
FR-09-020…022, FR-09-029; plan 5.4; G09-T03). Read only.

* One row per person: a ``students`` profile and the ``users`` account it is
  linked to (``students.user_id``) are one person. ``ref`` is ``u-<users.id>``
  for anyone with an account and ``s-<students.id>`` for a profile without one;
  an ``s-`` ref of a profile that has an account resolves with
  ``canonical_ref = u-…`` (the page then redirects).
* Staff accounts (``admin``/``instructor``) are hidden by default
  (``roles``). Staging test data is hidden as ``GET /admin/students`` hides it
  (``services.test_data_visibility``).
* Course kind, courses and credits come from G04, which has no read API yet:
  those fields are ``null`` and their filters are refused, never guessed.

Every function here is synchronous; routes call them through
``asyncio.to_thread``.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from fastapi import HTTPException

from database import supabase_admin
from services import learner_attention, test_data_visibility
from services.class_membership_service import active_memberships_for_students

logger = logging.getLogger(__name__)

PAGE_SIZE = 25
DEFAULT_ROLES = frozenset({"user", "student"})
_REF_RE = re.compile(r"^([us])-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
_PAGE = 1000
_ID_CHUNK = 200
_RECENT_BANDS = 4

_STUDENT_COLS = "id, user_id, student_code, full_name, target_band, target_date, archived_at, created_at"
_USER_COLS = "id, email, display_name, role, is_active, last_seen_at, created_at, target_band, exam_date"


@dataclass
class Person:
    user: Optional[dict]
    student: Optional[dict]

    @property
    def ref(self) -> str:
        return f"u-{self.user['id']}" if self.user else f"s-{self.student['id']}"

    @property
    def student_id(self) -> Optional[str]:
        return str(self.student["id"]) if self.student else None

    @property
    def name(self) -> str:
        if self.student and (self.student.get("full_name") or "").strip():
            return self.student["full_name"].strip()
        user = self.user or {}
        return (user.get("display_name") or "").strip() or (user.get("email") or "")

    def attention_input(self) -> dict[str, Any]:
        return {"key": self.ref, "student_id": self.student_id, "has_account": self.user is not None,
                "last_active_at": (self.user or {}).get("last_seen_at"),
                "account_created_at": (self.user or {}).get("created_at")}


def fold(text: Any) -> str:
    """Lower case without Vietnamese accents, for search and sorting."""
    value = unicodedata.normalize("NFD", str(text or "")).replace("đ", "d").replace("Đ", "D")
    return "".join(ch for ch in value if not unicodedata.combining(ch)).lower().strip()


def sort_key(person: Person) -> tuple[str, str, str]:
    """By given name (the last word of a Vietnamese full name), then the full
    name, then the ref so equal names keep a stable order across pages."""
    folded = fold(person.name)
    return (folded.split()[-1] if folded else "", folded, person.ref)


def _paged(build) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _profile_rank(student: dict) -> tuple[bool, str]:
    return (student.get("archived_at") is None, str(student.get("created_at") or ""))


def _merge(students: list[dict], users: list[dict]) -> list[Person]:
    """One person per account; several profiles on one account → the active,
    most recent profile. Profiles without an account are people of their own.
    A profile linked to an account not in ``users`` (staff or hidden) is left
    out with that account."""
    by_user: dict[str, dict] = {}
    for s in students:
        uid = str(s.get("user_id") or "")
        if uid and (uid not in by_user or _profile_rank(s) > _profile_rank(by_user[uid])):
            by_user[uid] = s
    people = [Person(user=u, student=by_user.get(str(u["id"]))) for u in users]
    return people + [Person(user=None, student=s) for s in students if not s.get("user_id")]


def load_people(*, roles: Iterable[str] = DEFAULT_ROLES, hide_test: bool = False) -> list[Person]:
    roles = set(roles)
    students = _paged(lambda: supabase_admin.table("students").select(_STUDENT_COLS).order("id"))
    all_users = _paged(lambda: supabase_admin.table("users").select(_USER_COLS).order("id"))
    hidden_students: set[str] = set()
    hidden_users: set[str] = set()
    if hide_test:
        hidden_users = {str(u["id"]) for u in all_users if test_data_visibility.is_test_email(u.get("email"))}
        hidden_students = {str(s["id"]) for s in students if test_data_visibility.is_test_student(s, hidden_users)}
    staff_or_filtered = {str(u["id"]) for u in all_users if (u.get("role") or "user") not in roles}
    users = [u for u in all_users if str(u["id"]) not in hidden_users and str(u["id"]) not in staff_or_filtered]
    students = [s for s in students if str(s["id"]) not in hidden_students
                and str(s.get("user_id") or "") not in staff_or_filtered | hidden_users]
    people = _merge(students, users)
    if not roles & DEFAULT_ROLES:
        people = [p for p in people if p.user is not None]
    return people


def parse_ref(ref: str) -> tuple[str, str]:
    match = _REF_RE.match(str(ref or "").lower())
    if not match:
        raise HTTPException(404, "Không tìm thấy học viên")
    return match.group(1), match.group(2)


def resolve(ref: str) -> Person:
    """The person behind ``ref`` (staff included: a direct link still opens)."""
    kind, value = parse_ref(ref)
    if kind == "u":
        users = supabase_admin.table("users").select(_USER_COLS).eq("id", value).limit(1).execute().data or []
        if not users:
            raise HTTPException(404, "Không tìm thấy học viên")
        students = (supabase_admin.table("students").select(_STUDENT_COLS)
                    .eq("user_id", value).execute().data or [])
        return _merge(students, users)[0]
    students = supabase_admin.table("students").select(_STUDENT_COLS).eq("id", value).limit(1).execute().data or []
    if not students:
        raise HTTPException(404, "Không tìm thấy học viên")
    uid = students[0].get("user_id")
    if uid:
        users = supabase_admin.table("users").select(_USER_COLS).eq("id", str(uid)).limit(1).execute().data or []
        if users:
            return Person(user=users[0], student=students[0])
    return Person(user=None, student=students[0])


def cohorts_of(people: Iterable[Person]) -> dict[str, list[dict]]:
    """Active classes per student id, ``[{id, name}]``. Raises on a failed read."""
    ids = [p.student_id for p in people if p.student_id]
    memberships = active_memberships_for_students(supabase_admin, ids) if ids else []
    cohort_ids = list({str(m["cohort_id"]) for m in memberships if m.get("cohort_id")})
    names: dict[str, Optional[str]] = {}
    for offset in range(0, len(cohort_ids), _ID_CHUNK):
        chunk = cohort_ids[offset:offset + _ID_CHUNK]
        for row in supabase_admin.table("cohorts").select("id, name").in_("id", chunk).execute().data or []:
            names[str(row["id"])] = row.get("name")
    out: dict[str, list[dict]] = {}
    for m in memberships:
        cid = str(m.get("cohort_id") or "")
        if cid:
            out.setdefault(str(m["student_id"]), []).append({"id": cid, "name": names.get(cid)})
    for rows in out.values():
        rows.sort(key=lambda c: fold(c["name"]))
    return out


def code_owner_user_ids(q: str) -> set[str]:
    """Accounts that hold the activation code ``q`` (exact, any case), by the
    canonical ownership rule: a code's active ``user_code_assignments`` rows
    when it has any, else its legacy ``used_by``. A former holder of a code
    that was reassigned is not an owner. A failed assignment read raises (the
    caller fails), it never falls back to ``used_by``."""
    codes = (supabase_admin.table("access_codes").select("id, used_by")
             .ilike("code", q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
             .limit(5).execute().data or [])
    ids = [str(c["id"]) for c in codes]
    active: dict[str, set[str]] = {}
    if ids:
        rows = (supabase_admin.table("user_code_assignments").select("code_id, user_id")
                .in_("code_id", ids).eq("is_active", True).execute().data or [])
        for r in rows:
            if r.get("user_id"):
                active.setdefault(str(r.get("code_id")), set()).add(str(r["user_id"]))
    owners: set[str] = set()
    for c in codes:
        held = active.get(str(c["id"]))
        if held:
            owners |= held
        elif c.get("used_by"):
            owners.add(str(c["used_by"]))
    return owners


def _matches(person: Person, needle: str, code_owners: set[str]) -> bool:
    student, user = person.student or {}, person.user or {}
    haystack = (fold(person.name), fold(user.get("email")), fold(student.get("student_code")),
                fold(user.get("display_name")))
    return any(needle in h for h in haystack) or (user and str(user.get("id")) in code_owners)


def learner_row(person: Person, cohorts: Optional[list[dict]], attention: list[dict]) -> dict[str, Any]:
    user, student = person.user, person.student
    return {
        "ref": person.ref,
        "name": person.name,
        "email": (user or {}).get("email") or None,
        "student_code": (student or {}).get("student_code") or None,
        "account_state": "none" if user is None else ("active" if user.get("is_active", True) else "locked"),
        "profile_state": "none" if student is None else ("archived" if student.get("archived_at") else "active"),
        "kind": None, "courses": None, "credits_left": None,   # G04
        "cohorts": cohorts,
        "attention": attention,
        "last_active_at": (user or {}).get("last_seen_at") or None,
    }


def directory(*, q: Optional[str], cohort_id: Optional[str], archived: bool, attention: Optional[str],
              roles: Iterable[str], page: int, hide_test: bool,
              thresholds: Optional[dict[str, Optional[int]]]) -> dict[str, Any]:
    people = load_people(roles=roles, hide_test=hide_test)
    people = [p for p in people if bool(p.student and p.student.get("archived_at")) == archived]
    failed: list[str] = []

    if q:
        needle = fold(q)
        owners: set[str] = set()
        if " " not in q.strip() and len(q.strip()) >= 4:
            try:
                owners = code_owner_user_ids(q.strip())
            except Exception as exc:
                logger.warning("learner directory: activation-code lookup failed (%s)", type(exc).__name__)
                failed.append("activation_codes")
        people = [p for p in people if _matches(p, needle, owners)]

    cohorts: Optional[dict[str, list[dict]]]
    try:
        cohorts = cohorts_of(people)
    except Exception as exc:
        if cohort_id:
            raise
        logger.warning("learner directory: class lookup failed (%s)", type(exc).__name__)
        cohorts, failed = None, failed + ["cohorts"]
    if cohort_id:
        people = [p for p in people if p.student_id and any(c["id"] == cohort_id for c in cohorts.get(p.student_id, []))]

    people.sort(key=sort_key)
    if attention:
        result = learner_attention.compute([p.attention_input() for p in people], thresholds)
        failed += result.sources_failed
        if result.sources_failed:
            raise HTTPException(503, {"code": "attention_unavailable",
                                      "message": "Chưa tính được danh sách cần chú ý. Thử lại sau ít phút."})
        people = [p for p in people if any(attention == "any" or r["code"] == attention
                                           for r in result.reasons[p.ref])]
        page_people = people[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
    else:
        page_people = people[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        result = learner_attention.compute([p.attention_input() for p in page_people], thresholds)
        failed += result.sources_failed

    items = [learner_row(p, None if cohorts is None else cohorts.get(p.student_id or "", []),
                         result.reasons.get(p.ref, [])) for p in page_people]
    return {"items": items, "total": len(people), "page": page, "page_size": PAGE_SIZE,
            "sources_failed": sorted(set(failed))}


# ── Summary (CHUAN-ADMIN mục H: exactly seven fields) ─────────────────────

def _num(value: Any) -> Optional[float]:
    try:
        return None if value is None else round(float(value), 1)
    except (TypeError, ValueError):
        return None


def goal_of(person: Person) -> dict[str, Any]:
    """The admin goal (``students``) and the learner's own (``users``)."""
    admin = {"target_band": _num((person.student or {}).get("target_band")),
             "exam_date": (person.student or {}).get("target_date") or None}
    learner = {"target_band": _num((person.user or {}).get("target_band")),
               "exam_date": (person.user or {}).get("exam_date") or None}
    has_admin = any(v is not None for v in admin.values())
    has_learner = any(v is not None for v in learner.values())
    if not has_admin and not has_learner:
        return {"target_band": None, "exam_date": None, "source": "none"}
    if has_admin and has_learner:
        source = "both_equal" if admin == learner else "conflict"
        return {**admin, "source": source}
    return {**(admin if has_admin else learner), "source": "admin" if has_admin else "learner"}


def _writing_bands(student_id: str) -> list[float]:
    rows = (supabase_admin.table("writing_essays")
            .select("id, status, is_flagged, delivered_at, "
                    "writing_feedback:writing_feedback_current(overall_band_score)")
            .eq("student_id", student_id).eq("status", "delivered").is_("deleted_at", "null")
            .is_("sitting_id", "null")   # a mock-exam essay is exam work (FR-104)
            .order("delivered_at", desc=True).limit(12).execute().data or [])
    bands: list[float] = []
    for row in rows:
        if row.get("is_flagged"):
            continue
        fb = row.get("writing_feedback")
        fb = fb[0] if isinstance(fb, list) and fb else fb
        band = _num(fb.get("overall_band_score")) if isinstance(fb, dict) else None
        if band is not None:
            bands.append(band)
        if len(bands) >= _RECENT_BANDS:
            break
    return bands


def _speaking_bands(user_id: str) -> list[float]:
    # Practice sessions only: a mock-exam Speaking session (sitting_id set)
    # is exam work, not a practice band (FR-104).
    rows = (supabase_admin.table("sessions").select("id, overall_band, started_at")
            .eq("user_id", user_id).eq("status", "completed").not_.is_("overall_band", "null")
            .is_("sitting_id", "null")
            .order("started_at", desc=True).limit(_RECENT_BANDS).execute().data or [])
    return [b for b in (_num(r.get("overall_band")) for r in rows) if b is not None]


def summary(person: Person, thresholds: Optional[dict[str, Optional[int]]],
            *, now: Optional[datetime] = None,
            cohort_ids: Optional[frozenset[str]] = None) -> tuple[dict[str, Any], list[str]]:
    """``(summary, sources_failed)``. A failed source leaves its field
    ``null`` (and is named); an empty one is an empty list, never a guess.

    ``cohort_ids`` is a teacher's scope (``None`` for an admin). With it, the
    classes, the overdue work and the late streak come only from those
    classes (FR-102): a learner in two teachers' classes shows each teacher
    only their own class."""
    now = now or datetime.now(timezone.utc)
    failed: list[str] = []

    try:
        cohorts: Optional[list[dict]] = cohorts_of([person]).get(person.student_id or "", [])
    except Exception:
        cohorts, failed = None, failed + ["cohorts"]
    if cohorts is not None and cohort_ids is not None:
        cohorts = [c for c in cohorts if str(c.get("id")) in cohort_ids]

    overdue: Optional[dict[str, Any]] = {"count": 0, "latest_title": None}
    history = {}
    if person.student_id:
        try:
            history = learner_attention.assignment_history([person.student_id], now, cohort_ids)
        except Exception:
            history, overdue = None, None
        else:
            if history[person.student_id].unconfirmed:
                # A lesson item's hand-in cannot be confirmed by a read: say so.
                failed.append("assignments")
                overdue = None
            rows = history[person.student_id].overdue
            if overdue is not None:
                overdue = {"count": len(rows), "latest_title": rows[0]["title"] if rows else None}
    result = learner_attention.compute([person.attention_input()], thresholds, now=now, history=history)
    failed += result.sources_failed

    bands: dict[str, Optional[list[float]]] = {"writing": [], "speaking": []}
    if cohort_ids is not None:
        # A teacher sees only their classes' work (FR-102). Practice bands
        # belong to no class, so a teacher gets none of them.
        bands = {"writing": None, "speaking": None}
    elif person.student_id:
        try:
            bands["writing"] = _writing_bands(person.student_id)
        except Exception:
            bands["writing"], failed = None, failed + ["writing"]
    if person.user and cohort_ids is None:
        try:
            bands["speaking"] = _speaking_bands(str(person.user["id"]))
        except Exception:
            bands["speaking"], failed = None, failed + ["speaking"]

    return {
        "name": person.name,
        "cohorts": cohorts,
        "courses": None,   # G04
        "status": learner_attention.status_line(result.reasons.get(person.ref, []), result.sources_failed),
        "goal": goal_of(person),
        "overdue": overdue,
        "recent_bands": bands,
        "last_active_at": (person.user or {}).get("last_seen_at") or None,
        "latest_note": None,   # care notes arrive with G09-T35 (migration 442)
    }, sorted(set(failed))


def in_cohorts(person: Person, cohort_ids: frozenset[str]) -> bool:
    """Whether the learner is an active member of one of ``cohort_ids``.
    Raises on a failed read (the caller fails closed)."""
    if not person.student_id:
        return False
    rows = active_memberships_for_students(supabase_admin, [person.student_id])
    return any(str(r.get("cohort_id")) in cohort_ids for r in rows)
