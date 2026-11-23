"""The learner's Nhật ký hệ thống tab (ADMINIA-0074 FR-027; plan 5.4
``GET /admin/learners/{ref}/log``; G09-T04c).

Append-only sources, merged newest first:

* ``access_code`` — ``access_code_audit`` rows about the learner's account
  (``target_user_id``), plus the reassign rows a code left the learner by
  (``before.assigned_user``).
* ``role`` / ``security`` — ``staff_security_audit`` (``target_user_id``):
  ``role_changed`` is ``role``, every other event is ``security``.
* ``class`` — ``class_action_log`` rows about the learner's student rows
  (``student_id``); Black Eye assignments stay hidden as on the class log.
* ``goal`` — ``learner_goal_events`` (mig 452, FR-030).
* ``entitlement`` / ``credit`` / ``order`` — G04's events. G09 reads them
  through G04's read API, which does not exist yet: they are named in
  ``sources_unavailable`` and never shown as an empty history.

Care notes are never a source. Each source is read on its own: a failed read
names the source in ``sources_failed`` and the other sources still answer.
A learner's history is short, so every source is read in full (paged) and the
merge is cut into pages by a keyset cursor over ``(at, source, id)``; a row
written between two pages lands at the top and never shifts a later page.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from database import supabase_admin
from services import admin_learner_log_text as text
from services.admin_learner_directory import Person

logger = logging.getLogger(__name__)

SOURCES = ("access_code", "security", "class", "role", "entitlement", "credit", "order", "goal")
UNAVAILABLE = ("entitlement", "credit", "order")
PAGE_SIZE = 50
_PAGE = 1000
_CHUNK = 200


class BadCursor(ValueError):
    pass


def _paged(build: Callable[[], Any]) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().order("id").range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _chunks(ids: list[str]):
    for start in range(0, len(ids), _CHUNK):
        yield ids[start:start + _CHUNK]


def _at(value: Any) -> Optional[str]:
    """One fixed UTC form, so instants compare as strings."""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _student_ids(person: Person) -> list[str]:
    ids = {person.student_id} if person.student_id else set()
    if person.user:
        uid = str(person.user["id"])
        ids |= {str(r["id"]) for r in _paged(lambda: supabase_admin.table("students").select("id")
                                             .eq("user_id", uid)) if r.get("id")}
    return sorted(ids)


# ── Sources: each returns [(at, row_id, actor_id, text)] ─────────────────

def _access_code(person: Person) -> list[tuple]:
    if not person.user:
        return []
    uid = str(person.user["id"])
    cols = "id, actor_user_id, action, code_id, target_user_id, before, after, created_at"
    rows = {str(r["id"]): (r, True) for r in _paged(
        lambda: supabase_admin.table("access_code_audit").select(cols).eq("target_user_id", uid))}
    for r in _paged(lambda: supabase_admin.table("access_code_audit").select(cols)
                    .eq("action", "reassign").eq("before->>assigned_user", uid)):
        rows.setdefault(str(r["id"]), (r, False))
    code_ids = sorted({str(r["code_id"]) for r, _ in rows.values() if r.get("code_id")})
    codes: dict[str, str] = {}
    for chunk in _chunks(code_ids):
        for c in (supabase_admin.table("access_codes").select("id, code").in_("id", chunk).execute().data or []):
            codes[str(c["id"])] = c.get("code")
    return [(r.get("created_at"), rid, r.get("actor_user_id"),
             text.access_code(str(r.get("action") or ""), code=codes.get(str(r.get("code_id"))),
                              before=r.get("before"), after=r.get("after"), received=received))
            for rid, (r, received) in rows.items()]


def _staff_security(person: Person, *, role: bool) -> list[tuple]:
    if not person.user:
        return []
    uid = str(person.user["id"])

    def build():
        q = (supabase_admin.table("staff_security_audit")
             .select("id, occurred_at, event, actor_user_id, before, after").eq("target_user_id", uid))
        return q.eq("event", "role_changed") if role else q.neq("event", "role_changed")

    return [(r.get("occurred_at"), str(r["id"]), r.get("actor_user_id"),
             text.security(str(r.get("event") or ""), before=r.get("before"), after=r.get("after")))
            for r in _paged(build)]


def _class(person: Person, student_ids: list[str]) -> list[tuple]:
    from services import listening_blackeye as blackeye

    rows: list[dict] = []
    for chunk in _chunks(student_ids):
        rows.extend(_paged(lambda c=chunk: supabase_admin.table("class_action_log")
                           .select("id, action, cohort_id, assignment_id, assignment_title, student_id, "
                                   "actor_user_id, created_at")
                           .in_("student_id", c)))
    hidden: set[str] = set()
    for cohort in sorted({str(r["cohort_id"]) for r in rows if r.get("cohort_id")}):
        hidden |= set(blackeye.hidden_assignment_ids(supabase_admin, cohort_id=cohort))
    return [(r.get("created_at"), str(r["id"]), r.get("actor_user_id"),
             text.class_action(str(r.get("action") or ""), title=r.get("assignment_title")))
            for r in rows if str(r.get("assignment_id")) not in hidden]


def _goal(person: Person, student_ids: list[str]) -> list[tuple]:
    rows: dict[str, dict] = {}
    cols = "id, student_id, user_id, used, after, actor_id, created_at"
    for chunk in _chunks(student_ids):
        for r in _paged(lambda c=chunk: supabase_admin.table("learner_goal_events").select(cols).in_("student_id", c)):
            rows[str(r["id"])] = r
    if person.user:
        uid = str(person.user["id"])
        for r in _paged(lambda: supabase_admin.table("learner_goal_events").select(cols).eq("user_id", uid)):
            rows[str(r["id"])] = r
    return [(r.get("created_at"), rid, r.get("actor_id"), text.goal(str(r.get("used") or ""), after=r.get("after")))
            for rid, r in rows.items()]


# ── Merge and page ───────────────────────────────────────────────────────

def _encode(item: dict) -> str:
    raw = json.dumps([item["at"], item["source"], item["id"]], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode(cursor: str) -> tuple[str, str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        at, source, rid = json.loads(raw)
    except Exception as exc:
        raise BadCursor() from exc
    if not all(isinstance(v, str) for v in (at, source, rid)) or source not in SOURCES:
        raise BadCursor()
    return at, source, rid


def _after(item: dict, cursor: tuple[str, str, str]) -> bool:
    """True when ``item`` comes after ``cursor`` in the order newest first,
    then source, then id descending."""
    at, source, rid = cursor
    if item["at"] != at:
        return item["at"] < at
    if item["source"] != source:
        return item["source"] > source
    return item["id"] < rid


def log(person: Person, *, kind: Optional[str] = None, cursor: Optional[str] = None,
        page_size: int = PAGE_SIZE) -> dict[str, Any]:
    after = _decode(cursor) if cursor else None
    wanted = [kind] if kind else list(SOURCES)
    failed: list[str] = []
    items: list[dict] = []
    student_ids: Optional[list[str]] = None

    def students() -> list[str]:
        nonlocal student_ids
        if student_ids is None:
            student_ids = _student_ids(person)
        return student_ids

    readers: dict[str, Callable[[], list[tuple]]] = {
        "access_code": lambda: _access_code(person),
        "security": lambda: _staff_security(person, role=False),
        "role": lambda: _staff_security(person, role=True),
        "class": lambda: _class(person, students()),
        "goal": lambda: _goal(person, students()),
    }
    rows: list[tuple[str, tuple]] = []
    for source in wanted:
        if source in UNAVAILABLE:
            continue
        try:
            rows.extend((source, r) for r in readers[source]())
        except Exception as exc:
            logger.warning("learner log: source %s failed (%s)", source, type(exc).__name__)
            failed.append(source)

    actor_ids = sorted({str(r[2]) for _s, r in rows if r[2]})
    names: dict[str, str] = {}
    try:
        for chunk in _chunks(actor_ids):
            for u in (supabase_admin.table("users").select("id, display_name, email")
                      .in_("id", chunk).execute().data or []):
                names[str(u["id"])] = (u.get("display_name") or "").strip() or (u.get("email") or "")
    except Exception as exc:
        # The lines still answer; who did them is then unknown, and said so.
        logger.warning("learner log: actor names failed (%s)", type(exc).__name__)
        failed.append("actors")

    for source, (at, rid, actor, line) in rows:
        stamp = _at(at)
        if stamp is None:
            continue
        items.append({"id": str(rid), "at": stamp, "source": source,
                      "actor_name": names.get(str(actor)) if actor else None, "text": line})
    items.sort(key=lambda i: i["id"], reverse=True)
    items.sort(key=lambda i: i["source"])
    items.sort(key=lambda i: i["at"], reverse=True)
    if after:
        items = [i for i in items if _after(i, after)]
    page = items[:page_size]
    more = len(items) > page_size
    return {"items": page, "next_cursor": _encode(page[-1]) if more and page else None,
            "sources_failed": sorted(set(failed)),
            "sources_unavailable": [s for s in UNAVAILABLE if s in wanted]}
