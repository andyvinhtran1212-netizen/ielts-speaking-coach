"""COURSEACCESS-0055 T010 (G04-T10) — retention by course access (plan 5.14,
FR-029, FR-048). One named test per case 1–10 of the task sheet."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from config import Settings
from jobs import retention_sweep as sweep
from routers import me_access
from routers import sessions as sessions_module
from routers import writing_student as ws
from services import entitlements as ent
from services import retention
from services import retention_policy as rp
from services.retention import DEFAULT_WINDOW, OPEN_WINDOW, ContentWindow, RetentionPolicy, compute_expiry
from tests._commerce_fake_db import FakeDB
from tests.test_retention import _LIST_DEFAULTS, _patch, _run

NOW = datetime.now(timezone.utc).replace(microsecond=0)
USER = "u1"
STUDENT = {"id": "st1", "user_id": USER, "full_name": "Minh Anh", "student_code": "S1"}


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _session(sid: str, age_days: float, **extra) -> dict:
    return {"id": sid, "user_id": USER, "status": "completed", "started_at": _iso(_ago(age_days)),
            "resume_expires_at": None, "last_accessed_at": None, "audio_purged_at": None,
            "content_purged_at": None, **extra}


def _ent_row(eid: str, *, expires: datetime | None, starts: datetime | None = None, status="active",
             revoked: datetime | None = None, user=USER) -> dict:
    return {"id": eid, "user_id": user, "product_id": "p1", "course_id": "c1", "source": "enrollment_order",
            "status": status, "starts_at": _iso(starts or _ago(400)), "expires_at": _iso(expires) if expires else None,
            "credits_expire_at": None, "credits_closed_at": None, "review_mode": None,
            "revoked_at": _iso(revoked) if revoked else None, "created_at": _iso(_ago(400))}


def _items(*rows, members=(), legacy=()) -> list[ent.AccessItem]:
    products = {"p1": {"id": "p1", "kind": "online", "features": ["speaking", "writing"]}}
    return ent.build_access(list(rows), products, list(members), list(legacy), NOW)


LIVE_CODE = {"id": "code1", "permissions": ["practice_full"], "session_limit": None, "is_revoked": False,
             "is_active": True, "expires_at": None, "product_id": None}


@pytest.fixture
def flag(monkeypatch):
    state = {"on": True, "error": False}

    def enabled():
        if state["error"]:
            raise RuntimeError("flags down")
        return state["on"]

    monkeypatch.setattr(rp, "enabled", enabled)
    return state


@pytest.fixture
def access(monkeypatch):
    state = {"items": [], "error": False}

    def list_access(user_id):
        if state["error"]:
            raise RuntimeError("entitlements down")
        return state["items"]

    monkeypatch.setattr(rp.ent, "list_access", list_access)
    return state


@pytest.fixture
def sweep_db(monkeypatch):
    """A sweep run on FakeDB: flag row, entitlements and class tables, sessions."""
    db = FakeDB(tables={
        "runtime_flags": [{"key": rp.FLAG, "enabled": True}],
        "entitlements": [], "students": [], "student_cohort_memberships": [], "cohorts": [],
        "sessions": [], "responses": [],
    })
    monkeypatch.setattr(sweep, "supabase_admin", db)
    monkeypatch.setattr(sweep, "DRY_RUN", True)
    monkeypatch.setattr(rp.ent, "fetch_products", lambda ids: {"p1": {"id": "p1", "kind": "online"}})
    legacy = {"rows": [], "error": False}

    def fetch_legacy(user_id):
        if legacy["error"]:
            raise RuntimeError("codes down")
        return legacy["rows"]

    monkeypatch.setattr(rp.ent, "fetch_legacy_code_rows", fetch_legacy)
    db.legacy = legacy
    return db


def _swept(db) -> list[str]:
    return [s["id"] for s in sweep._eligible("content_purged_at", retention.RETENTION_CONTENT_DAYS,
                                              "is_content_purged", per_user=True)]


def _writing(student=STUDENT, essays=None, monkeypatch=None):
    db = FakeDB(tables={"writing_essays": essays or [], "writing_feedback_current": []})
    monkeypatch.setattr(ws, "supabase_admin", db)
    return db


ESSAY = {"id": "e1", "student_id": "st1", "task_type": "task2", "prompt_text": "Some people think...",
         "status": "graded", "created_at": _iso(_ago(200)), "delivered_at": None, "student_first_viewed_at": None,
         "is_flagged": False, "flag_reasons": [], "deleted_at": None}


# ── 1 ────────────────────────────────────────────────────────────────────


def test_1_no_env_and_flag_off_is_todays_behaviour(flag, access, monkeypatch):
    assert Settings().RETENTION_AUDIO_DAYS == 15 and retention.RETENTION_AUDIO_DAYS == 15
    assert retention.RETENTION_CONTENT_DAYS == 60
    flag["on"] = False
    access["items"] = _items(_ent_row("e1", expires=_ago(100)))
    assert rp.content_window(USER) == DEFAULT_WINDOW
    for age in (0, 14, 15, 59, 60, 61, 200):
        row = _session("s", age)
        assert compute_expiry(row, NOW) == compute_expiry(row, NOW, RetentionPolicy(window=DEFAULT_WINDOW))
    assert rp.window_view(access["items"], NOW) == (None, None)
    built = me_access.build_my_courses([], {"items": [], "total": 0}, {}, {}, NOW)
    assert (built["content_visible_until"], built["content_days_after_expiry"]) == (None, None)
    rec = _patch(monkeypatch, {"sessions": [_session("s1", 1)]})
    _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=False))
    assert ("content_purged_at", "null") in rec["is_"]
    assert any("started_at.gte." in q and "last_accessed_at.gte." in q for q in rec["or_"])


# ── 2 ────────────────────────────────────────────────────────────────────


def test_2_audio_days_come_from_config_and_never_exceed_60(caplog):
    assert Settings(RETENTION_AUDIO_DAYS="60").RETENTION_AUDIO_DAYS == 60
    sixty = RetentionPolicy(audio_days=retention.audio_days_from(60))
    assert compute_expiry(_session("s", 40), NOW, sixty)["is_audio_purged"] is False
    assert compute_expiry(_session("s", 61), NOW, sixty)["is_audio_purged"] is True
    with caplog.at_level(logging.WARNING, logger="services.retention"):
        assert retention.audio_days_from(Settings(RETENTION_AUDIO_DAYS="90").RETENTION_AUDIO_DAYS) == 60
    assert "above the 60-day ceiling" in caplog.text
    # The window never touches audio: an open learner's 100-day session has no audio.
    assert compute_expiry(_session("s", 100), NOW, RetentionPolicy(window=OPEN_WINDOW))["is_audio_purged"] is True


# ── 3 ────────────────────────────────────────────────────────────────────


def test_3_a_live_course_means_no_content_cut_off(flag, access, sweep_db, monkeypatch):
    access["items"] = _items(_ent_row("e1", expires=NOW + timedelta(days=30)))
    window = rp.content_window(USER)
    assert window == OPEN_WINDOW
    e = compute_expiry(_session("s", 100), NOW, RetentionPolicy(window=window))
    assert (e["is_hidden"], e["is_content_purged"], e["days_until_content_purge"]) == (False, False, None)
    assert e["is_audio_purged"] is True                      # audio still on its own clock
    assert rp.window_view(access["items"], NOW) == (None, 45)
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=NOW + timedelta(days=30)))
    sweep_db.tables["sessions"].append(_session("s100", 100))
    assert _swept(sweep_db) == []
    rec = _patch(monkeypatch, {"sessions": [_session("s1", 100)]})
    out = _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=False))
    assert "or_" not in rec and out[0]["retention"]["is_hidden"] is False


# ── 4 ────────────────────────────────────────────────────────────────────


def test_4_content_stays_45_days_after_the_last_course_then_hides(flag, access, sweep_db, monkeypatch):
    access["items"] = _items(_ent_row("e1", expires=_ago(44)))
    window = rp.content_window(USER)
    assert window.mode == "until" and window.visible_until == _ago(44) + timedelta(days=45)
    e = compute_expiry(_session("s", 70), NOW, RetentionPolicy(window=window))
    assert e["is_hidden"] is False and e["days_until_content_purge"] == 1
    until, days = rp.window_view(access["items"], NOW)
    assert days == 45 and until == (_ago(44) + timedelta(days=45)).isoformat().replace("+00:00", "Z")

    access["items"] = _items(_ent_row("e1", expires=_ago(45)))
    window = rp.content_window(USER)
    assert compute_expiry(_session("s", 70), NOW, RetentionPolicy(window=window))["is_hidden"] is True
    # Speaking history lists nothing, and the count agrees.
    rec = _patch(monkeypatch, {"sessions": []})
    _run(sessions_module.list_sessions(**_LIST_DEFAULTS, include_hidden=False))
    assert ("id", "null") in rec["is_"] and "or_" not in rec
    # The sweep (DRY_RUN) lists the session.
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(45)))
    sweep_db.tables["sessions"].append(_session("s70", 70))
    assert _swept(sweep_db) == ["s70"]
    assert sweep.sweep_content()["eligible"] == 1 and not any(op == "update" for _, op in sweep_db.calls)
    # Writing: hidden at read time only.
    _writing(essays=[dict(ESSAY)], monkeypatch=monkeypatch)
    assert asyncio.run(ws.list_my_essays(student=dict(STUDENT)))["essays"] == []
    for call in (ws.get_my_essay, ws.export_my_essay_docx):
        with pytest.raises(HTTPException) as err:
            asyncio.run(call("e1", student=dict(STUDENT)))
        assert err.value.status_code == 410 and err.value.detail["error_code"] == "content_expired"
    assert ws.router.prefix == "/api/writing"


# ── 5 ────────────────────────────────────────────────────────────────────


def test_5_two_courses_count_from_the_one_that_ended_last(flag, access):
    access["items"] = _items(_ent_row("old", expires=_ago(100)), _ent_row("recent", expires=_ago(10)))
    window = rp.content_window(USER)
    assert window == ContentWindow("until", _ago(10) + timedelta(days=45))
    assert not rp.window_closed(window, NOW)


# ── 6 ────────────────────────────────────────────────────────────────────


def test_6_a_revoked_course_ends_when_it_was_revoked(flag, access):
    access["items"] = _items(_ent_row("e1", status="revoked", revoked=_ago(50), expires=NOW + timedelta(days=100)))
    window = rp.content_window(USER)
    assert window == ContentWindow("until", _ago(50) + timedelta(days=45))
    assert rp.window_closed(window, NOW)
    assert compute_expiry(_session("s", 30), NOW, RetentionPolicy(window=window))["is_hidden"] is True


# ── 7 ────────────────────────────────────────────────────────────────────


def test_7_enrolling_again_shows_the_old_work_again(flag, access, monkeypatch):
    access["items"] = _items(_ent_row("old", expires=_ago(100)),
                             _ent_row("renewed", starts=_ago(1), expires=NOW + timedelta(days=180)))
    assert rp.content_window(USER) == OPEN_WINDOW
    db = _writing(essays=[dict(ESSAY)], monkeypatch=monkeypatch)
    assert [e["id"] for e in asyncio.run(ws.list_my_essays(student=dict(STUDENT)))["essays"]] == ["e1"]
    assert db.tables["writing_essays"][0]["deleted_at"] is None          # nothing was ever deleted


# ── 8 ────────────────────────────────────────────────────────────────────


def test_8_never_enrolled_keeps_todays_rule_and_a_live_old_code_is_open(flag, access, sweep_db, monkeypatch):
    access["items"] = _items()
    window = rp.content_window(USER)
    assert window == DEFAULT_WINDOW
    assert compute_expiry(_session("s", 61), NOW, RetentionPolicy(window=window))["is_hidden"] is True
    assert compute_expiry(_session("s", 59), NOW, RetentionPolicy(window=window))["is_hidden"] is False
    _writing(essays=[dict(ESSAY)], monkeypatch=monkeypatch)
    assert len(asyncio.run(ws.list_my_essays(student=dict(STUDENT)))["essays"]) == 1
    # Only a live legacy code, no entitlements row → open; the sweep keeps a 61-day session.
    access["items"] = _items(legacy=[LIVE_CODE])
    assert rp.content_window(USER) == OPEN_WINDOW
    sweep_db.legacy["rows"] = [LIVE_CODE]
    sweep_db.tables["sessions"].append(_session("s61", 61))
    assert _swept(sweep_db) == []
    sweep_db.legacy["rows"] = []                               # the code is gone → today's rule
    assert _swept(sweep_db) == ["s61"]


# ── 9 ────────────────────────────────────────────────────────────────────


def test_9_a_class_member_on_an_old_code_is_never_cut_off(flag, access, sweep_db):
    access["items"] = _items(members=["c-class"])
    assert rp.content_window(USER) == OPEN_WINDOW
    # Moved to an entitlement (5.18) and still in the class: an expired row does not cut them off.
    access["items"] = _items(_ent_row("e1", expires=_ago(200)), members=["c-class"])
    assert rp.content_window(USER) == OPEN_WINDOW
    sweep_db.tables["students"].append({"id": "st1", "user_id": USER})
    sweep_db.tables["student_cohort_memberships"].append({"student_id": "st1", "cohort_id": "k1", "is_active": True})
    sweep_db.tables["cohorts"].append({"id": "k1", "course_id": "c-class", "archived_at": None})
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(200)))
    sweep_db.tables["sessions"].append(_session("s100", 100))
    assert rp.content_windows([USER], NOW, db=sweep_db)[USER] == OPEN_WINDOW
    assert _swept(sweep_db) == []
    sweep_db.tables["cohorts"][0]["archived_at"] = _iso(_ago(1))   # class archived → expired row rules
    assert _swept(sweep_db) == ["s100"]


# ── 10 ───────────────────────────────────────────────────────────────────


def test_10_a_failed_lookup_hides_nothing_new_and_the_sweep_skips(flag, access, sweep_db, caplog):
    access["error"] = True
    assert rp.content_window(USER) == DEFAULT_WINDOW                 # read time: today's rule
    flag["error"] = True
    assert rp.content_window(USER) == DEFAULT_WINDOW
    assert rp.window_view([], NOW) == (None, None)
    sweep_db.tables["sessions"].append(_session("s100", 100))
    sweep_db.broken.add("entitlements")
    with caplog.at_level(logging.WARNING):
        assert _swept(sweep_db) == []
    assert "content skipped=1" in caplog.text
    sweep_db.broken.clear()
    sweep_db.broken.add("runtime_flags")                             # flag unreadable: purge nobody
    assert _swept(sweep_db) == []
    sweep_db.broken.clear()
    sweep_db.legacy["error"] = True                                  # one learner's codes unreadable
    assert rp.content_windows([USER], NOW, db=sweep_db) == {USER: None}
    sweep_db.legacy["error"] = False
    sweep_db.tables["runtime_flags"][0]["enabled"] = False           # flag off: today's rule purges
    assert _swept(sweep_db) == ["s100"]
