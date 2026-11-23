"""G09-T35 (ADMINIA-0074 FR-032): care notes on a learner.

Runs the real service (services/learner_care_notes.py) and routes
(routers/admin_care_notes.py) over the in-memory stand-in of
test_admin_learners, with real inserts and updates on the care-notes table
(the SQL table itself is tested in test_migration_442_learner_care_notes.py).
Made-up people only; no AI or network call.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.admin_learner_profile import CareNoteIn, CareNotePatch
from routers import admin_care_notes as mod
from routers import admin_learner_profile as profile_mod
from routers import admin_learners as learners_mod
from services import admin_learner_profile as profile
from services import learner_care_notes as notes
from test_admin_learners import (NOW, S_LAN, S_OFFLINE, S_OLD, U_ADMIN, U_LAN, U_MINH, U_TEACH, _as, _DB,
                                 _Query, _Resp)
from test_admin_learners import db as _learners_db  # noqa: F401  (fixture, used through `db`)

U_ADMIN_2 = "10000000-0000-0000-0000-0000000000a2"


class _CareQuery(_Query):
    """The stand-in with writes that really change the care-notes rows."""

    def __init__(self, fake, name):
        super().__init__(fake, name)
        self._insert = None
        self._update = None

    def insert(self, row):
        self._insert = dict(row)
        return self

    def update(self, values):
        self._update = dict(values)
        return self

    def gt(self, c, v):
        return self._add(lambda r: r.get(c) is not None and str(r.get(c)) > str(v))

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        rows = self.db.rows.setdefault(self.name, [])
        if self._insert is not None:
            row = {"id": str(uuid.uuid4()), "created_at": self.db.clock().isoformat(), "updated_at": None,
                   "deleted_at": None, "done_at": None, "done_by": None, "is_initial": False,
                   "source": "manual", **self._insert}
            rows.append(row)
            return _Resp([dict(row)])
        if self._update is not None:
            hit = [r for r in rows if all(f(r) for f in self.filters)]
            for r in hit:
                r.update(self._update)
            return _Resp([dict(r) for r in hit])
        return super().execute()


@pytest.fixture
def db(_learners_db, monkeypatch):
    fake = _learners_db
    fake.clock = lambda: NOW
    fake.rows["users"].append({"id": U_ADMIN_2, "email": "admin2@example.test", "display_name": "Quản trị 2",
                               "role": "admin", "is_active": True, "last_seen_at": None, "created_at": None})
    plain = fake.table
    fake.table = lambda name: _CareQuery(fake, name) if name == notes.TABLE else plain(name)
    for module in (notes, profile):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN}))
    monkeypatch.setattr(profile_mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN}))
    return fake


def _as_admin(monkeypatch, uid):
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": uid}))


def _list(ref):
    return asyncio.run(mod.list_care_notes(ref, "Bearer x"))["items"]


def _add(ref, body="Gọi hỏi lịch học", **kw):
    return asyncio.run(mod.add_care_note(ref, CareNoteIn(body=body, **kw), "Bearer x"))["note"]


def _patch(note_id, **kw):
    return asyncio.run(mod.patch_care_note(uuid.UUID(note_id), CareNotePatch(**kw), "Bearer x"))["note"]


def _delete(note_id):
    return asyncio.run(mod.delete_care_note(uuid.UUID(note_id), "Bearer x"))


def _status(fn, *args, **kw) -> tuple[int, str]:
    with pytest.raises(HTTPException) as caught:
        fn(*args, **kw)
    detail = caught.value.detail
    return caught.value.status_code, detail.get("code") if isinstance(detail, dict) else str(detail)


def _row(db, note_id):
    return next(r for r in db.rows[notes.TABLE] if r["id"] == note_id)


def _age(db, note_id, **kw):
    _row(db, note_id)["created_at"] = (NOW - timedelta(**kw)).isoformat()


def _student(db, sid):
    return next(r for r in db.rows["students"] if r["id"] == sid)


# ── Read ───────────────────────────────────────────────────────────────────

def test_no_notes_is_an_empty_list(db):
    assert _list(f"u-{U_LAN}") == []
    assert _list(f"s-{S_OFFLINE}") == []


def test_persona_notes_is_the_initial_note_and_is_never_editable(db):
    _student(db, S_LAN)["persona_notes"] = "  Đi làm ca tối, thích học cuối tuần.  "
    items = _list(f"u-{U_LAN}")
    assert items == [{"id": None, "author_name": None, "created_at": _student(db, S_LAN)["created_at"],
                      "body": "Đi làm ca tối, thích học cuối tuần.", "next_action": None, "due_on": None,
                      "done_at": None, "is_initial": True, "editable": False}]
    # Nothing was written: it is built at read time (plan 5.4).
    assert db.rows.get(notes.TABLE, []) == []
    # Newer notes come first; the initial note stays last.
    _add(f"u-{U_LAN}")
    assert [i["is_initial"] for i in _list(f"u-{U_LAN}")] == [False, True]
    # A blank persona note is no note.
    _student(db, S_OFFLINE)["persona_notes"] = "   "
    assert _list(f"s-{S_OFFLINE}") == []


def test_a_stored_initial_note_replaces_the_virtual_one(db):
    _student(db, S_LAN)["persona_notes"] = "Ghi chú cũ"
    db.rows[notes.TABLE] = [{"id": str(uuid.uuid4()), "student_id": S_LAN, "user_id": U_LAN, "author_id": U_ADMIN,
                             "body": "Ghi chú ban đầu đã chép", "next_action": None, "due_on": None,
                             "done_at": None, "done_by": None, "is_initial": True,
                             "created_at": NOW.isoformat(), "deleted_at": None}]
    items = _list(f"u-{U_LAN}")
    assert [(i["body"], i["is_initial"], i["editable"]) for i in items] == [("Ghi chú ban đầu đã chép", True, False)]


def test_notes_are_found_by_profile_and_by_account(db):
    # An account with an active and an archived profile: notes on either
    # profile and on the account are the same learner's.
    _add(f"u-{U_MINH}", body="trên tài khoản")
    db.rows[notes.TABLE].append({**db.rows[notes.TABLE][0], "id": str(uuid.uuid4()), "user_id": None,
                                 "student_id": S_OLD, "body": "trên hồ sơ cũ",
                                 "created_at": (NOW - timedelta(days=40)).isoformat()})
    assert [i["body"] for i in _list(f"u-{U_MINH}")] == ["trên tài khoản", "trên hồ sơ cũ"]
    assert _list(f"u-{U_LAN}") == []


# ── Add ────────────────────────────────────────────────────────────────────

def test_add_stores_the_note_for_profile_and_account(db):
    note = _add(f"u-{U_LAN}", body="  Hẹn gọi lại  ", next_action="  Gọi điện  ", due_on=date(2026, 11, 25))
    assert note == {"id": note["id"], "author_name": "Quản trị", "created_at": NOW.isoformat(),
                    "body": "Hẹn gọi lại", "next_action": "Gọi điện", "due_on": "2026-11-25", "done_at": None,
                    "is_initial": False, "editable": True}
    row = _row(db, note["id"])
    assert (row["student_id"], row["user_id"], row["author_id"], row["source"]) == (S_LAN, U_LAN, U_ADMIN, "manual")
    # A learner with no account yet: the note hangs on the profile.
    offline = _add(f"s-{S_OFFLINE}", next_action="   ")
    assert _row(db, offline["id"])["user_id"] is None and offline["next_action"] is None


def test_body_must_have_text_and_a_patch_must_change_something():
    for bad in ("", "   ", "x" * 4001):
        with pytest.raises(ValidationError):
            CareNoteIn(body=bad)
    with pytest.raises(ValidationError):
        CareNoteIn(body="ok", next_action="x" * 501)
    with pytest.raises(ValidationError):
        CareNoteIn(body="ok", author_id=U_ADMIN)   # the author is never taken from the body
    for bad in ({}, {"body": None}, {"body": "  "}, {"done": None}, {"author_id": U_ADMIN}):
        with pytest.raises(ValidationError):
            CareNotePatch(**bad)


def test_unknown_learner_is_404(db):
    assert _status(_add, "u-10000000-0000-0000-0000-0000000000ff")[0] == 404


# ── Edit, done, remove ─────────────────────────────────────────────────────

def test_the_author_edits_inside_the_window(db):
    nid = _add(f"u-{U_LAN}", due_on=date(2026, 11, 25))["id"]
    _age(db, nid, hours=23)
    note = _patch(nid, body="Đã đổi", next_action="Nhắn Zalo", due_on=None)
    assert (note["body"], note["next_action"], note["due_on"], note["editable"]) == ("Đã đổi", "Nhắn Zalo", None, True)
    # Fields not sent stay as they are.
    assert _patch(nid, next_action=None)["body"] == "Đã đổi"


def test_after_the_window_only_done_can_change(db):
    nid = _add(f"u-{U_LAN}", next_action="Gọi")["id"]
    _age(db, nid, hours=25)
    assert _list(f"u-{U_LAN}")[0]["editable"] is False
    before = dict(_row(db, nid))
    assert _status(_patch, nid, body="sửa muộn") == (409, "note_locked")
    assert _status(_patch, nid, body="sửa muộn", done=True) == (409, "note_locked")   # all or nothing
    assert _row(db, nid) == before
    done = _patch(nid, done=True)
    assert done["done_at"] and _row(db, nid)["done_by"] == U_ADMIN
    # Marking done twice keeps the first time; undo clears both.
    assert _patch(nid, done=True)["done_at"] == done["done_at"]
    undone = _patch(nid, done=False)
    assert undone["done_at"] is None and _row(db, nid)["done_by"] is None
    assert _status(_delete, nid) == (409, "note_locked")


def test_the_window_follows_the_setting(db, monkeypatch):
    nid = _add(f"u-{U_LAN}")["id"]
    _age(db, nid, hours=3)
    monkeypatch.setenv("CARE_NOTE_EDIT_HOURS", "2")
    assert _status(_patch, nid, body="x") == (409, "note_locked")
    monkeypatch.setenv("CARE_NOTE_EDIT_HOURS", "4")
    assert _patch(nid, body="x")["body"] == "x"


def test_another_admin_can_mark_done_but_not_edit_or_remove(db, monkeypatch):
    nid = _add(f"u-{U_LAN}")["id"]
    _as_admin(monkeypatch, U_ADMIN_2)
    assert _list(f"u-{U_LAN}")[0]["editable"] is False
    assert _status(_patch, nid, body="không phải của tôi") == (409, "note_locked")
    assert _status(_delete, nid) == (409, "note_locked")
    assert _patch(nid, done=True)["done_at"] is not None
    assert _row(db, nid)["done_by"] == U_ADMIN_2 and _row(db, nid)["body"] == "Gọi hỏi lịch học"


def test_the_write_itself_rechecks_the_window(db, monkeypatch):
    # The page (or the read) still thought the note editable; the write's own
    # filters refuse it, and nothing changes.
    nid = _add(f"u-{U_LAN}")["id"]
    _age(db, nid, hours=30)
    monkeypatch.setattr(notes, "_editable", lambda *_a: True)
    before = dict(_row(db, nid))
    assert _status(_patch, nid, body="lách") == (409, "note_locked")
    assert _status(_delete, nid) == (409, "note_locked")
    assert _row(db, nid) == before


def test_remove_is_soft_and_only_once(db):
    keep = _add(f"u-{U_LAN}", body="giữ")["id"]
    nid = _add(f"u-{U_LAN}", body="xoá")["id"]
    assert _delete(nid).status_code == 204
    assert [i["body"] for i in _list(f"u-{U_LAN}")] == ["giữ"]
    assert _row(db, nid)["deleted_at"]   # still stored, marked removed
    assert _status(_delete, nid) == (404, "note_not_found")
    assert _status(_patch, nid, done=True) == (404, "note_not_found")
    assert _status(_patch, str(uuid.uuid4()), done=True) == (404, "note_not_found")
    assert _row(db, keep)["deleted_at"] is None


def test_a_failed_read_or_write_is_503_never_an_empty_list(db):
    nid = _add(f"u-{U_LAN}")["id"]
    db.fail = {notes.TABLE}   # e.g. 442 not applied yet
    assert _status(_list, f"u-{U_LAN}") == (503, "care_notes_unavailable")
    assert _status(_add, f"u-{U_LAN}") == (503, "care_notes_unavailable")
    assert _status(_patch, nid, done=True) == (503, "care_notes_unavailable")
    assert _status(_delete, nid) == (503, "care_notes_unavailable")


# ── Summary and overview ───────────────────────────────────────────────────

def test_summary_latest_note_is_for_admins_only(db, monkeypatch):
    assert asyncio.run(learners_mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]["latest_note"] is None
    _student(db, S_LAN)["persona_notes"] = "Ghi chú ban đầu"
    out = asyncio.run(learners_mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]["latest_note"]
    assert out == {"author": None, "at": _student(db, S_LAN)["created_at"], "text": "Ghi chú ban đầu"}
    _add(f"u-{U_LAN}", body="cũ")
    db.clock = lambda: NOW + timedelta(minutes=5)
    _add(f"u-{U_LAN}", body="mới nhất")
    detail = asyncio.run(learners_mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert detail["summary"]["latest_note"] == {"author": "Quản trị", "at": (NOW + timedelta(minutes=5)).isoformat(),
                                                "text": "mới nhất"}
    assert detail["sources_failed"] == []
    # A teacher of the learner's class gets no care note (Q16 b), and no failure.
    _as(monkeypatch, db, U_TEACH)
    teacher = asyncio.run(learners_mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))
    assert teacher["summary"]["latest_note"] is None and "care_notes" not in teacher["sources_failed"]


def test_summary_names_a_failed_note_read(db):
    db.fail = {notes.TABLE}
    detail = asyncio.run(learners_mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert detail["summary"]["latest_note"] is None and "care_notes" in detail["sources_failed"]
    assert detail["summary"]["name"] == "Nguyễn Thị Lan"   # the rest still answers


def test_overview_lists_open_booked_work_soonest_first(db):
    later = _add(f"u-{U_LAN}", body="b", next_action="Gửi tài liệu", due_on=date(2026, 12, 2))
    soon = _add(f"u-{U_LAN}", body="a", next_action="Gọi", due_on=date(2026, 11, 24))
    done = _add(f"u-{U_LAN}", body="c", due_on=date(2026, 11, 20))
    _patch(done["id"], done=True)
    _add(f"u-{U_LAN}", body="không hẹn")
    out = asyncio.run(profile_mod.get_learner_overview(f"u-{U_LAN}", "Bearer x"))
    assert out["side"]["due_notes"] == [
        {"id": soon["id"], "due_on": "2026-11-24", "next_action": "Gọi", "body": "a"},
        {"id": later["id"], "due_on": "2026-12-02", "next_action": "Gửi tài liệu", "body": "b"}]
    assert "care_notes" not in out["sources_failed"]
    db.fail = {notes.TABLE}
    out = asyncio.run(profile_mod.get_learner_overview(f"u-{U_LAN}", "Bearer x"))
    assert out["side"]["due_notes"] is None and "care_notes" in out["sources_failed"]
    assert out["goal"] is not None   # the other blocks still answer


def test_two_admins_marking_done_at_once_keep_the_first(db, monkeypatch):
    # Both read the note while it was open; the other admin's write lands
    # first. The later write must not overwrite their time and name, and
    # answers the note as it now stands rather than a 409.
    nid = _add(f"u-{U_LAN}")["id"]
    stale = dict(_row(db, nid))
    first = (NOW - timedelta(seconds=1)).isoformat()
    _row(db, nid).update(done_at=first, done_by=U_ADMIN_2)
    reads = iter([stale])
    real_get = notes._get
    monkeypatch.setattr(notes, "_get", lambda i: next(reads, None) or real_get(i))
    note = _patch(nid, done=True)
    assert note["done_at"] == first
    assert (_row(db, nid)["done_at"], _row(db, nid)["done_by"]) == (first, U_ADMIN_2)
    # The same race with an edit by the author inside the window: the edit is
    # written, the first admin's done stays.
    _row(db, nid).update(done_at=None, done_by=None)
    stale = dict(_row(db, nid))
    _row(db, nid).update(done_at=first, done_by=U_ADMIN_2)
    reads = iter([stale])
    note = _patch(nid, body="Đã gọi", done=True)
    assert note["body"] == "Đã gọi" and note["done_at"] == first and _row(db, nid)["done_by"] == U_ADMIN_2
