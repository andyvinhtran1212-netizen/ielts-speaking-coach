"""Care notes on a learner (ADMINIA-0074 FR-032; plan 5.4; G09-T35; mig 442).

A note has its author, time, text, an optional next step and due day, and
when it was marked done. Its author may edit or remove it (soft) for
``CARE_NOTE_EDIT_HOURS`` (Q16, default 24); after that, or for anyone else,
it can only be marked done or not done. The window is enforced by the same
UPDATE that changes the row (filters on ``author_id`` and ``created_at``),
so a page left open past the window cannot slip an edit through.

``students.persona_notes`` is shown as the oldest item, ``is_initial`` and
never editable, while no stored row is the initial note. It is not written to
the table (plan 5.4).

Admin only in this package (Q16 b): no teacher reads or writes notes, and the
learner summary gives ``latest_note`` to an admin only.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from database import supabase_admin
from services.admin_learner_directory import Person

TABLE = "learner_care_notes"
_COLS = ("id, student_id, user_id, author_id, body, next_action, due_on, done_at, done_by, is_initial, "
         "created_at, deleted_at")
_PAGE = 1000
_CHUNK = 200


class NoteNotFound(LookupError):
    pass


class NoteLocked(PermissionError):
    pass


def edit_hours() -> int:
    try:
        value = int(os.getenv("CARE_NOTE_EDIT_HOURS", "24"))
    except ValueError:
        return 24
    return max(0, value)


def _now(now: Optional[datetime]) -> datetime:
    return now or datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _cutoff(now: datetime) -> str:
    return (now - timedelta(hours=edit_hours())).isoformat()


def _paged(build) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().order("id").range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _student_ids(person: Person) -> list[str]:
    """Every profile of the learner: an account may hold an archived one too."""
    ids = {person.student_id} if person.student_id else set()
    if person.user:
        uid = str(person.user["id"])
        ids |= {str(r["id"]) for r in _paged(lambda: supabase_admin.table("students").select("id")
                                             .eq("user_id", uid)) if r.get("id")}
    return sorted(ids)


def _rows(person: Person) -> list[dict]:
    rows: dict[str, dict] = {}
    ids = _student_ids(person)
    for start in range(0, len(ids), _CHUNK):
        chunk = ids[start:start + _CHUNK]
        for r in _paged(lambda c=chunk: supabase_admin.table(TABLE).select(_COLS)
                        .in_("student_id", c).is_("deleted_at", "null")):
            rows[str(r["id"])] = r
    if person.user:
        uid = str(person.user["id"])
        for r in _paged(lambda: supabase_admin.table(TABLE).select(_COLS)
                        .eq("user_id", uid).is_("deleted_at", "null")):
            rows[str(r["id"])] = r
    return sorted(rows.values(), key=lambda r: (_parse(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
                                                str(r["id"])), reverse=True)


def _names(ids: set[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    ordered = sorted(i for i in ids if i)
    for start in range(0, len(ordered), _CHUNK):
        for u in (supabase_admin.table("users").select("id, display_name, email")
                  .in_("id", ordered[start:start + _CHUNK]).execute().data or []):
            names[str(u["id"])] = (u.get("display_name") or "").strip() or (u.get("email") or "")
    return names


def _editable(row: dict, viewer_id: Optional[str], now: datetime) -> bool:
    created = _parse(row.get("created_at"))
    return bool(viewer_id and str(row.get("author_id")) == str(viewer_id) and not row.get("is_initial")
                and created is not None and created > now - timedelta(hours=edit_hours()))


def _out(row: dict, names: dict[str, str], viewer_id: Optional[str], now: datetime) -> dict[str, Any]:
    return {"id": str(row["id"]), "author_name": names.get(str(row.get("author_id"))),
            "created_at": row.get("created_at"), "body": row.get("body") or "",
            "next_action": row.get("next_action"), "due_on": row.get("due_on"),
            "done_at": row.get("done_at"), "is_initial": bool(row.get("is_initial")),
            "editable": _editable(row, viewer_id, now)}


def _initial(person: Person) -> Optional[dict[str, Any]]:
    """``students.persona_notes`` as the virtual first note, or ``None``."""
    if not person.student_id:
        return None
    rows = (supabase_admin.table("students").select("id, persona_notes, created_at")
            .eq("id", person.student_id).limit(1).execute().data or [])
    text = ((rows[0].get("persona_notes") if rows else None) or "").strip()
    if not text:
        return None
    return {"id": None, "author_name": None, "created_at": rows[0].get("created_at"), "body": text,
            "next_action": None, "due_on": None, "done_at": None, "is_initial": True, "editable": False}


def list_notes(person: Person, viewer_id: Optional[str], *, now: Optional[datetime] = None) -> list[dict[str, Any]]:
    """Newest first; the initial note (stored or virtual) stays last."""
    now = _now(now)
    rows = _rows(person)
    names = _names({str(r.get("author_id") or "") for r in rows})
    items = [_out(r, names, viewer_id, now) for r in rows]
    items.sort(key=lambda i: i["is_initial"])   # stable: keeps newest first within each group
    if not any(i["is_initial"] for i in items):
        initial = _initial(person)
        if initial:
            items.append(initial)
    return items


def latest(person: Person) -> Optional[dict[str, Any]]:
    """The summary's ``latest_note`` (``{author, at, text}``): the newest
    stored note, else the initial one, else ``None``."""
    rows = _rows(person)
    if rows:
        row = rows[0]
        return {"author": _names({str(row.get("author_id") or "")}).get(str(row.get("author_id"))),
                "at": str(row.get("created_at")), "text": row.get("body") or ""}
    initial = _initial(person)
    if initial:
        return {"author": None, "at": str(initial["created_at"]), "text": initial["body"]}
    return None


def due(person: Person) -> list[dict[str, Any]]:
    """The overview's "việc đã hẹn": open notes with a due day, soonest first."""
    rows = [r for r in _rows(person) if r.get("due_on") and not r.get("done_at")]
    rows.sort(key=lambda r: (str(r["due_on"]), str(r.get("created_at") or ""), str(r["id"])))
    return [{"id": str(r["id"]), "due_on": str(r["due_on"]), "next_action": r.get("next_action"),
             "body": r.get("body") or ""} for r in rows]


def _clean(value: Optional[str]) -> Optional[str]:
    text = (value or "").strip()
    return text or None


def add(person: Person, author_id: str, *, body: str, next_action: Optional[str] = None,
        due_on: Optional[date] = None, now: Optional[datetime] = None) -> dict[str, Any]:
    now = _now(now)
    row = {"student_id": person.student_id, "user_id": str(person.user["id"]) if person.user else None,
           "author_id": author_id, "body": body.strip(), "next_action": _clean(next_action),
           "due_on": due_on.isoformat() if due_on else None, "source": "manual"}
    stored = (supabase_admin.table(TABLE).insert(row).execute().data or [])
    if not stored:
        raise RuntimeError("care note insert returned no row")
    return _out(stored[0], _names({author_id}), author_id, now)


def _get(note_id: str) -> dict:
    rows = (supabase_admin.table(TABLE).select(_COLS).eq("id", note_id).is_("deleted_at", "null")
            .limit(1).execute().data or [])
    if not rows:
        raise NoteNotFound()
    return rows[0]


def update(note_id: str, viewer_id: str, changes: dict[str, Any], *,
           now: Optional[datetime] = None) -> dict[str, Any]:
    """``changes`` holds only the fields the admin sent. Text and due day need
    the author inside the edit window (else :class:`NoteLocked`); ``done``
    alone is always allowed. Nothing is written on a refusal."""
    now = _now(now)
    row = _get(note_id)
    values: dict[str, Any] = {}
    content = {k: changes[k] for k in ("body", "next_action", "due_on") if k in changes}
    if "body" in content:
        values["body"] = content["body"].strip()
    if "next_action" in content:
        values["next_action"] = _clean(content["next_action"])
    if "due_on" in content:
        values["due_on"] = content["due_on"].isoformat() if content["due_on"] else None
    if "done" in changes:
        if changes["done"] and not row.get("done_at"):
            values.update(done_at=now.isoformat(), done_by=viewer_id)
        elif not changes["done"]:
            values.update(done_at=None, done_by=None)
    if content and (row.get("is_initial") or not _editable(row, viewer_id, now)):
        raise NoteLocked()
    if values:
        values["updated_at"] = now.isoformat()
        q = supabase_admin.table(TABLE).update(values).eq("id", note_id).is_("deleted_at", "null")
        if content:
            # The window is checked again by the write itself.
            q = q.eq("author_id", viewer_id).gt("created_at", _cutoff(now)).eq("is_initial", False)
        if not (q.execute().data or []):
            _get(note_id)   # removed meanwhile → NoteNotFound
            raise NoteLocked()
    fresh = _get(note_id)
    return _out(fresh, _names({str(fresh.get("author_id") or "")}), viewer_id, now)


def remove(note_id: str, viewer_id: str, *, now: Optional[datetime] = None) -> None:
    """Soft delete, by the author inside the edit window only."""
    now = _now(now)
    row = _get(note_id)
    if row.get("is_initial") or not _editable(row, viewer_id, now):
        raise NoteLocked()
    done = (supabase_admin.table(TABLE).update({"deleted_at": now.isoformat(), "updated_at": now.isoformat()})
            .eq("id", note_id).is_("deleted_at", "null").eq("author_id", viewer_id)
            .gt("created_at", _cutoff(now)).eq("is_initial", False).execute().data or [])
    if not done:
        _get(note_id)
        raise NoteLocked()
