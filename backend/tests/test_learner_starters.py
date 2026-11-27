"""LEARNERCORE-0063 FR-126 (T25s): the starter paper of each skill —
services/learner_starters.py and GET/PATCH /admin/settings/learner-starters.

Reuses the in-memory fn_admin_settings_merge fake of test_admin_settings.py.
The public-practice catalog views are plain tables here: the view's own
exclusions (exam hold, exam_only) are covered by a paper missing from it.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import admin_settings
from services import learner_starters
from tests.test_admin_settings import ADMIN, TEACHER, _DB, _Query

LT = "11111111-2222-3333-4444-555555555555"
RT = "22222222-3333-4444-5555-666666666666"
ST = "33333333-4444-5555-6666-777777777777"
MISSING = "44444444-5555-6666-7777-888888888888"


def _listening(**over):
    return {"id": LT, "title": "Listening A", "status": "published", "exam_only": False,
            "is_public": True, "public_practice_enabled": True,
            "full_audio_storage_path": "a.mp3", "assembled_audio_storage_path": None, **over}


def _reading(**over):
    return {"id": RT, "test_id": "R-01", "title": "Reading A", "status": "published",
            "exam_only": False, "is_public": True, "public_practice_enabled": True, **over}


class _ColumnQuery(_Query):
    """Honours the selected columns, as PostgREST does, so a field the code
    reads but never selects shows up as missing."""

    def select(self, columns="*", *_a, **_k):
        self.columns = None if columns.strip() == "*" else [c.strip() for c in columns.split(",")]
        return self

    def execute(self):
        res = super().execute()
        cols = getattr(self, "columns", None)
        if cols and isinstance(res.data, list):
            res.data = [{c: r.get(c) for c in cols if c in r} for r in res.data]
        return res


class _ColumnDB(_DB):
    def table(self, name):
        return _ColumnQuery(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = _ColumnDB()
    fake.tables.update({
        "listening_public_practice_catalog": [_listening()],
        "reading_public_practice_catalog": [_reading()],
        "topics": [{"id": ST, "title": "Hometown", "part": 1, "is_active": True}],
    })
    monkeypatch.setattr(learner_starters, "supabase_admin", fake)
    monkeypatch.setattr(admin_settings, "supabase_admin", fake)
    learner_starters.clear_cache()
    yield fake
    learner_starters.clear_cache()


@pytest.fixture
def client(monkeypatch, db):
    who = {"role": "admin"}

    async def require_admin(_auth):
        if who["role"] != "admin":
            raise HTTPException(403, "admin only")
        return ADMIN

    async def require_instructor(_auth):
        if who["role"] == "student":
            raise HTTPException(403, "staff only")
        return ADMIN if who["role"] == "admin" else TEACHER

    monkeypatch.setattr(admin_settings, "require_admin", require_admin)
    monkeypatch.setattr(admin_settings, "require_instructor", require_instructor)
    app = FastAPI()
    app.include_router(admin_settings.router)
    c = TestClient(app)
    c.who = who
    return c


URL = "/admin/settings/learner-starters"


def _patch(client, changes, reason="Đề mở đầu cho học viên mới"):
    return client.patch(URL, json={"changes": changes, "reason": reason})


def _stored(db):
    rows = [r for r in db.tables["admin_settings"] if r["key"] == "learner_starters"]
    return rows[0]["value"] if rows else None


# ── read ─────────────────────────────────────────────────────────────────────


def test_unset_reads_as_four_nulls_and_a_teacher_may_read(client):
    client.who["role"] = "teacher"
    res = client.get(URL)
    assert res.status_code == 200
    assert res.json()["items"] == [
        {"skill": s, "value": None, "title": None, "available": None}
        for s in ("speaking", "writing", "listening", "reading")]


def test_a_student_cannot_read(client):
    client.who["role"] = "student"
    assert client.get(URL).status_code == 403


def test_a_wrong_shape_in_storage_reads_as_null(db, client):
    db.tables["admin_settings"].append({"key": "learner_starters", "value": {
        "reading": {"test_uuid": "not-a-uuid"}, "listening": {"test_uuid": LT, "x": 1},
        "speaking": "oops"}})
    items = {i["skill"]: i for i in client.get(URL).json()["items"]}
    assert all(i["value"] is None for i in items.values())


def test_read_failure_without_a_copy_is_503(db, client):
    db.fail.add("admin_settings")
    res = client.get(URL)
    assert res.status_code == 503 and res.json()["detail"]["code"] == "learner_starters_unavailable"


# ── write ────────────────────────────────────────────────────────────────────


def test_a_teacher_cannot_write(db, client):
    client.who["role"] = "teacher"
    assert _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}]).status_code == 403
    assert db.calls == []


def test_reason_is_required(db, client):
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}], reason="   ")
    assert res.status_code == 422 and res.json()["detail"]["code"] == "reason_required"
    assert db.calls == []


def test_valid_write_stores_only_the_requested_skills_and_one_log_row(db, client):
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}},
                          {"skill": "speaking", "value": {"topic_id": ST}}])
    assert res.status_code == 200, res.text
    # A missing skill reads as null (FR-126); nothing is padded.
    assert _stored(db) == {"speaking": {"topic_id": ST}, "reading": {"test_uuid": RT}}
    assert db.calls[0]["p_changes"] == {"reading": {"test_uuid": RT}, "speaking": {"topic_id": ST}}
    log = db.tables["admin_settings_log"]
    assert len(log) == 1 and log[0]["reason"] == "Đề mở đầu cho học viên mới"
    assert log[0]["actor_id"] == ADMIN["id"]
    items = {i["skill"]: i for i in res.json()["items"]}
    assert items["reading"] == {"skill": "reading", "value": {"test_uuid": RT},
                                "title": "Reading A", "available": True}
    assert items["speaking"]["title"] == "Hometown"
    # A fresh read (no cache) answers the same.
    learner_starters.clear_cache()
    assert client.get(URL).json() == res.json()


@pytest.mark.parametrize("skill,table,row", [
    ("reading", "reading_public_practice_catalog", _reading(status="draft")),
    ("reading", "reading_public_practice_catalog", _reading(is_public=False)),
    ("listening", "listening_public_practice_catalog", _listening(status="draft")),
    ("listening", "listening_public_practice_catalog", _listening(is_public=False)),
    ("listening", "listening_public_practice_catalog",
     _listening(full_audio_storage_path=None)),
    # exam_only / held for an exam: absent from the catalog view (mig 306).
    ("reading", "reading_public_practice_catalog", None),
    ("listening", "listening_public_practice_catalog", None),
])
def test_paper_not_open_is_refused_and_nothing_written(db, client, skill, table, row):
    db.tables[table] = [row] if row else []
    ident = RT if skill == "reading" else LT
    res = _patch(client, [{"skill": skill, "value": {"test_uuid": ident}}])
    assert res.status_code == 422
    assert res.json()["detail"] == {"code": "starter_paper_unavailable",
                                    "message": learner_starters.UNAVAILABLE[1], "skill": skill}
    assert db.calls == [] and db.tables["admin_settings_log"] == []


def test_inactive_or_missing_topic_is_refused(db, client):
    db.tables["topics"][0]["is_active"] = False
    assert _patch(client, [{"skill": "speaking", "value": {"topic_id": ST}}]).json()["detail"]["code"] \
        == "starter_paper_unavailable"
    assert _patch(client, [{"skill": "speaking", "value": {"topic_id": MISSING}}]).json()["detail"]["code"] \
        == "starter_paper_unavailable"
    assert db.calls == []


def test_writing_starter_is_unsupported_but_clearing_it_is_fine(db, client):
    res = _patch(client, [{"skill": "writing", "value": {"prompt_id": "p1"}}])
    assert res.status_code == 422 and res.json()["detail"]["code"] == "starter_unsupported"
    assert db.calls == []
    assert _patch(client, [{"skill": "writing", "value": None}]).status_code == 200
    assert _stored(db) == {"writing": None}


def test_one_bad_change_refuses_the_whole_save(db, client):
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}},
                          {"skill": "listening", "value": {"test_uuid": MISSING}}])
    assert res.status_code == 422 and res.json()["detail"]["skill"] == "listening"
    assert db.calls == []


@pytest.mark.parametrize("change,code", [
    ({"skill": "vocab", "value": None}, "unknown_skill"),
    ({"skill": "reading", "value": {"test_uuid": "abc"}}, "invalid_value"),
    ({"skill": "reading", "value": {"topic_id": ST}}, "invalid_value"),
    ({"skill": "reading", "value": {"test_uuid": RT, "extra": "x"}}, "invalid_value"),
])
def test_bad_values_are_refused(db, client, change, code):
    res = _patch(client, [change])
    assert res.status_code == 422 and res.json()["detail"]["code"] == code
    assert db.calls == []


def test_duplicate_skill_is_refused(db, client):
    res = _patch(client, [{"skill": "reading", "value": None}, {"skill": "reading", "value": None}])
    assert res.json()["detail"]["code"] == "duplicate_skill"


def test_saving_the_same_value_again_is_no_changes(db, client):
    assert _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}]).status_code == 200
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}])
    assert res.status_code == 422 and res.json()["detail"]["code"] == "no_changes"
    assert len(db.tables["admin_settings_log"]) == 1


def test_clearing_keeps_the_other_skills(db, client):
    _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}},
                    {"skill": "listening", "value": {"test_uuid": LT}}])
    assert _patch(client, [{"skill": "reading", "value": None}]).status_code == 200
    assert _stored(db)["listening"] == {"test_uuid": LT} and _stored(db)["reading"] is None


def test_write_failure_is_503_and_nothing_cached(db, client):
    db.fail.add("fn_admin_settings_merge")
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}])
    assert res.status_code == 503 and res.json()["detail"]["code"] == "settings_write_failed"
    db.fail.clear()
    assert all(i["value"] is None for i in client.get(URL).json()["items"])


def test_a_starter_that_closed_shows_unavailable_to_the_admin(db, client):
    _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}])
    db.tables["reading_public_practice_catalog"] = []
    items = {i["skill"]: i for i in client.get(URL).json()["items"]}
    assert items["reading"]["value"] == {"test_uuid": RT} and items["reading"]["available"] is False


def test_log_names_the_starters_section_and_skill_labels(db, client):
    _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}])
    log = client.get("/admin/settings/log", params={"section": "starters"}).json()["items"]
    assert len(log) == 1 and log[0]["section"] == "starters"
    labels = {c["key"]: c["label"] for c in log[0]["changes"]}
    assert labels["reading"] == "Reading"


def test_two_first_saves_of_different_skills_keep_both(db, client):
    """Regression: padding missing skills with null from a read taken outside
    the merge's lock let the second first-save clear the first one."""
    assert _patch(client, [{"skill": "speaking", "value": {"topic_id": ST}}]).status_code == 200
    learner_starters.clear_cache()
    assert _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}}]).status_code == 200
    assert _stored(db) == {"speaking": {"topic_id": ST}, "reading": {"test_uuid": RT}}
    assert [c["p_changes"] for c in db.calls] == [{"speaking": {"topic_id": ST}},
                                                   {"reading": {"test_uuid": RT}}]
    log = db.tables["admin_settings_log"]
    assert log[1]["old_value"] == {"speaking": {"topic_id": ST}}


def test_titles_come_from_the_catalog_even_though_open_papers_omits_them(db, client):
    res = _patch(client, [{"skill": "reading", "value": {"test_uuid": RT}},
                          {"skill": "listening", "value": {"test_uuid": LT}}])
    items = {i["skill"]: i for i in res.json()["items"]}
    assert items["reading"]["title"] == "Reading A" and items["listening"]["title"] == "Listening A"
    values = asyncio.run(learner_starters.get())
    assert learner_starters.starter_for(db, "listening", values)["title"] == "Listening A"
    assert learner_starters.starter_for(db, "reading", values)["title"] == "Reading A"
