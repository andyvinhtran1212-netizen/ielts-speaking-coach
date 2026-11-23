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
    state = {"items": [], "members": [], "error": False}

    def list_access(user_id):
        if state["error"]:
            raise RuntimeError("entitlements down")
        return state["items"]

    monkeypatch.setattr(rp.ent, "list_access", list_access)
    monkeypatch.setattr(rp.ent, "fetch_membership_course_ids", lambda user_id: list(state["members"]))
    return state


@pytest.fixture
def sweep_db(monkeypatch):
    """A sweep run on FakeDB: flag row, entitlements and class tables, sessions."""
    db = FakeDB(tables={
        "runtime_flags": [{"key": rp.FLAG, "enabled": True}],
        "entitlements": [], "students": [], "student_cohort_memberships": [], "cohorts": [],
        "sessions": [], "responses": [], "course_products": [{"id": "p1", "kind": "online"}],
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
    rpc = {"answer": None}

    def purge(params):
        """Stand-in for 505: the PG test covers its own checks and locks."""
        if rpc["answer"] is not None:
            return rpc["answer"]
        session = next(x for x in db.tables["sessions"] if x["id"] == params["p_session_id"])
        rows = [r for r in db.tables["responses"] if r["session_id"] == session["id"]]
        for r in rows:
            r.update(transcript=None, raw_transcript_text=None, feedback=None, pronunciation_payload=None)
        session["content_purged_at"] = _iso(NOW)
        return {"status": "purged", "responses": len(rows)}

    db.handlers = {"fn_retention_purge_content": purge}
    db.purge_rpc = rpc
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
    # G04-T10b: the sweep now purges it, through the locked 505 RPC only
    # (no direct update of responses from Python).
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(45)))
    sweep_db.tables["sessions"].append(_session("s70", 70))
    sweep_db.tables["responses"].append({"id": "r1", "session_id": "s70", "transcript": "hi",
                                         "raw_transcript_text": "hi", "feedback": {}, "pronunciation_payload": None})
    assert _swept(sweep_db) == ["s70"]
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"], res["kept"]) == (1, 1, 0)
    assert [(name, params["p_session_id"], params["p_after_expiry_days"]) for name, params in sweep_db.rpcs] \
        == [("fn_retention_purge_content", "s70", 45)]
    assert not any(t == "responses" and op == "update" for t, op in sweep_db.calls)
    assert sweep_db.tables["responses"][0]["transcript"] is None
    monkeypatch.setattr(sweep, "DRY_RUN", True)
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
    assert rp.content_windows([USER], NOW, db=sweep_db)[USER].mode == "until"
    assert _swept(sweep_db) == ["s100"]                               # until, closed: purged by 505


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


# ── HOLD FR-048 (PR #2550): the window is re-read at the purge itself ─────


def test_11_access_granted_after_selection_keeps_the_content(flag, access, sweep_db, monkeypatch):
    """A learner on today's rule (no entitlements row) is selected, then gets
    a course before the purge: the guard re-reads the window (now ``open``)
    and keeps the content. A failed re-read keeps it too; unchanged → purged.
    ``until`` learners are purged only through the 505 RPC (see test_4)."""
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    sweep_db.tables["sessions"].append(_session("s70", 70))
    sweep_db.tables["responses"].append({"id": "r1", "session_id": "s70", "transcript": "hello",
                                         "raw_transcript_text": "hello", "feedback": {"x": 1},
                                         "pronunciation_payload": None})
    selected = sweep._eligible

    def select_then_grant(*args, **kwargs):
        rows = selected(*args, **kwargs)
        assert [r["id"] for r in rows] == ["s70"]                      # the batch says purge
        sweep_db.tables["entitlements"].append(_ent_row("e2", expires=NOW + timedelta(days=180)))
        return rows

    monkeypatch.setattr(sweep, "_eligible", select_then_grant)
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"], res["kept"]) == (1, 0, 1)
    assert sweep_db.tables["responses"][0]["transcript"] == "hello"
    assert sweep_db.tables["sessions"][0]["content_purged_at"] is None
    assert not any(t == "responses" and op == "update" for t, op in sweep_db.calls)

    # A course that ended 10 days ago, granted mid-run (until, window still
    # open for 35 days), is kept as well.
    sweep_db.tables["entitlements"].clear()

    def select_then_expired_grant(*args, **kwargs):
        rows = selected(*args, **kwargs)
        sweep_db.tables["entitlements"].append(_ent_row("e3", expires=_ago(10)))
        return rows

    monkeypatch.setattr(sweep, "_eligible", select_then_expired_grant)
    assert sweep.sweep_content()["kept"] == 1
    sweep_db.tables["entitlements"].clear()

    # The guard reads the window fresh: an unreadable window at purge time keeps it too.
    monkeypatch.setattr(sweep, "_eligible", selected)
    real_windows = rp.content_windows
    calls = {"n": 0}

    def windows(user_ids, now=None, *, db=None):
        calls["n"] += 1
        sweep_db.legacy["error"] = calls["n"] > 1                     # batch ok, purge-time read fails
        return real_windows(user_ids, now, db=db)

    monkeypatch.setattr(sweep.retention_policy, "content_windows", windows)
    res = sweep.sweep_content()
    assert (res["purged"], res["kept"]) == (0, 1)
    assert sweep_db.tables["responses"][0]["transcript"] == "hello"

    # Control: nothing changed between selection and purge → purged (today's rule).
    monkeypatch.setattr(sweep.retention_policy, "content_windows", real_windows)
    sweep_db.legacy["error"] = False
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"], res["kept"]) == (1, 1, 0)
    assert sweep_db.tables["responses"][0]["transcript"] is None
    assert sweep_db.tables["sessions"][0]["content_purged_at"] is not None


# ── Codex P1 (PR #2550): a live class on the SAME course as an expired row ─


def test_12_a_live_class_on_the_same_course_as_an_expired_row_stays_open(flag, access, sweep_db):
    """``build_access`` lists the course once (plan 5.18, display), dropping
    the membership; retention must still see the live class."""
    access["items"] = _items(_ent_row("e1", expires=_ago(200)), members=["c1"])
    assert [i.source for i in access["items"]] == ["enrollment_order"]   # membership deduplicated
    access["members"] = ["c1"]
    assert rp.content_window(USER) == OPEN_WINDOW
    assert rp.window_view(access["items"], NOW, USER) == (None, 45)
    assert rp.window_view(access["items"], NOW)[0] is not None           # without the re-read: a cut-off
    sweep_db.tables["students"].append({"id": "st1", "user_id": USER})
    sweep_db.tables["student_cohort_memberships"].append(
        {"id": "m1", "student_id": "st1", "cohort_id": "k1", "is_active": True})
    sweep_db.tables["cohorts"].append({"id": "k1", "course_id": "c1", "archived_at": None})
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(200)))
    sweep_db.tables["sessions"].append(_session("s100", 100))
    assert rp.content_windows([USER], NOW, db=sweep_db)[USER] == OPEN_WINDOW
    assert _swept(sweep_db) == []
    access["members"] = []
    assert rp.content_window(USER).mode == "until"


# ── SA R1 Medium (PR #2550): lists longer than one PostgREST response ──────


def test_13_rows_past_the_response_cap_are_read_before_any_purge(flag, access, sweep_db, monkeypatch):
    """With a 3-row cap, the live row is the 5th: an unpaged read would see
    only expired rows and purge a learner who is studying."""
    sweep_db.max_rows = 3
    monkeypatch.setattr(rp, "_PAGE", 3)
    for n in range(4):
        sweep_db.tables["entitlements"].append(_ent_row(f"e{n}", expires=_ago(300 + n)))
    sweep_db.tables["entitlements"].append(_ent_row("e9", expires=NOW + timedelta(days=90)))
    sweep_db.tables["sessions"].append(_session("s100", 100))
    assert rp.content_windows([USER], NOW, db=sweep_db)[USER] == OPEN_WINDOW
    assert _swept(sweep_db) == []
    pages = [c for c in sweep_db.calls if c == ("entitlements", "select")]
    assert len(pages) >= 2
    # Class rows are paged the same way.
    sweep_db.tables["entitlements"].pop()
    sweep_db.tables["students"].append({"id": "st1", "user_id": USER})
    for n in range(4):
        sweep_db.tables["student_cohort_memberships"].append(
            {"id": f"m{n}", "student_id": "st1", "cohort_id": f"k{n}", "is_active": True})
        sweep_db.tables["cohorts"].append({"id": f"k{n}", "course_id": f"c{n}",
                                           "archived_at": _iso(_ago(5)) if n < 3 else None})
    assert rp.content_windows([USER], NOW, db=sweep_db)[USER] == OPEN_WINDOW


# ── Codex P2 (PR #2585 on #2550 code): candidates past the first page ──────


def test_14_kept_sessions_filling_a_page_do_not_starve_later_candidates(flag, access, sweep_db):
    """1,000 old sessions of learners on a live course fill the first capped
    response; the default learner's expired session comes after them in id
    order and must still be found (pages are read in a stable id order)."""
    sweep_db.max_rows = 1000
    for n in range(1000):
        user = f"open{n:04d}"
        sweep_db.tables["entitlements"].append(_ent_row(f"e{n}", expires=NOW + timedelta(days=30), user=user))
        sweep_db.tables["sessions"].append(_session(f"a{n:04d}", 100, user_id=user))
    sweep_db.tables["sessions"].append(_session("z-default", 100, user_id="default-learner"))
    assert _swept(sweep_db) == ["z-default"]
    assert sum(1 for c in sweep_db.calls if c == ("sessions", "select")) == 3   # 1,000 + 1 + empty
    # Audio pages the same way (no window involved).
    eligible = sweep._eligible("audio_purged_at", retention.RETENTION_AUDIO_DAYS, "is_audio_purged")
    assert len(eligible) == 1001 and eligible[-1]["id"] == "z-default"


# ── G04-T10b: with the flag on, the purge goes through 505 only ─────────────


def _old_session_with_content(db, sid="s70", age=70):
    db.tables["sessions"].append(_session(sid, age))
    db.tables["responses"].append({"id": "r-" + sid, "session_id": sid, "transcript": "hello",
                                   "raw_transcript_text": "hello", "feedback": {"x": 1},
                                   "pronunciation_payload": None})


def test_15_a_kept_answer_from_the_rpc_keeps_the_content(flag, access, sweep_db, monkeypatch):
    """505 re-checks under the learner's locks: when it says kept (a grant
    that committed after the Python re-read), nothing is scrubbed."""
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    _old_session_with_content(sweep_db)
    sweep_db.purge_rpc["answer"] = {"status": "kept", "reason": "window_open"}
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"], res["kept"], res["errors"]) == (1, 0, 1, [])
    assert sweep_db.tables["responses"][0]["transcript"] == "hello"
    assert not any(op == "update" and t in ("responses",) for t, op in sweep_db.calls)


def test_16_flag_on_without_505_purges_nothing_and_never_falls_back(flag, access, sweep_db, monkeypatch):
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    _old_session_with_content(sweep_db, "s70")
    _old_session_with_content(sweep_db, "s80", 80)
    sweep_db.purge_rpc["answer"] = RuntimeError(
        "{'code': 'PGRST202', 'message': 'Could not find the function public.fn_retention_purge_content'}")
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"], res["kept"], res["errors"]) == (2, 0, 2, [])
    assert len(sweep_db.rpcs) == 1                                    # stops at the first answer
    assert all(r["transcript"] == "hello" for r in sweep_db.tables["responses"])
    assert not any(t == "responses" and op == "update" for t, op in sweep_db.calls)
    # Any other RPC failure is that session's error, and the next one is tried.
    sweep_db.rpcs.clear()
    sweep_db.purge_rpc["answer"] = RuntimeError("deadlock detected")
    res = sweep.sweep_content()
    assert res["purged"] == 0 and len(res["errors"]) == 2 and len(sweep_db.rpcs) == 2


def test_17_flag_off_keeps_todays_unlocked_purge_and_never_calls_505(flag, access, sweep_db, monkeypatch):
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    sweep_db.tables["runtime_flags"][0]["enabled"] = False
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=NOW + timedelta(days=90)))  # ignored when off
    _old_session_with_content(sweep_db)
    res = sweep.sweep_content()
    assert (res["eligible"], res["purged"]) == (1, 1) and sweep_db.rpcs == []
    assert sweep_db.tables["responses"][0]["transcript"] is None


# ── CR block on #2624: one flag decision picks the purge path ─────────────


def test_18_a_failed_flag_read_after_selection_purges_nothing(flag, access, sweep_db, monkeypatch):
    """Candidates come back with the flag on; the run's own flag read then
    fails and the re-read at purge time recovers. Neither path may run: no
    unlocked scrub, no RPC, everything kept and logged."""
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(100)))     # until, window closed
    _old_session_with_content(sweep_db, "s150", 150)
    real_flag, real_eligible, state = rp._flag_from, sweep._eligible, {"selected": False, "failed": False}

    def eligible(*a, **k):
        out = real_eligible(*a, **k)
        state["selected"] = True
        return out

    def flag_from(db):
        if state["selected"] and not state["failed"]:
            state["failed"] = True
            raise RuntimeError("runtime_flags timeout")
        return real_flag(db)

    monkeypatch.setattr(sweep, "_eligible", eligible)
    monkeypatch.setattr(sweep.retention_policy, "_flag_from", flag_from)
    res = sweep.sweep_content()
    assert state["failed"] and (res["eligible"], res["purged"], res["kept"], res["errors"]) == (1, 0, 1, [])
    assert sweep_db.rpcs == []
    assert not any(t == "responses" and op == "update" for t, op in sweep_db.calls)
    assert sweep_db.tables["responses"][0]["transcript"] == "hello"


def test_19_a_flag_turned_on_after_a_confirmed_off_never_sends_a_course_learner_unlocked(
        flag, access, sweep_db, monkeypatch):
    """Flag confirmed off for the run (unlocked path), then turned on before
    the purge-time re-read: a learner whose window is now by course access is
    kept, not scrubbed without the locks."""
    monkeypatch.setattr(sweep, "DRY_RUN", False)
    sweep_db.tables["runtime_flags"][0]["enabled"] = False
    sweep_db.tables["entitlements"].append(_ent_row("e1", expires=_ago(100)))
    _old_session_with_content(sweep_db, "s150", 150)
    real = sweep._window_purge_on

    def decide():
        answer = real()
        sweep_db.tables["runtime_flags"][0]["enabled"] = True
        return answer

    monkeypatch.setattr(sweep, "_window_purge_on", decide)
    res = sweep.sweep_content()
    assert (res["purged"], res["kept"]) == (0, 1) and sweep_db.rpcs == []
    assert sweep_db.tables["responses"][0]["transcript"] == "hello"

def test_14b_a_response_cap_below_the_page_size_does_not_end_the_read_early(flag, access, sweep_db):
    """CR nit on #2585: with max-rows 3 and pages of 1,000, every response is
    short; the read goes on until an empty page and skips no row."""
    sweep_db.max_rows = 3
    for n in range(7):
        sweep_db.tables["sessions"].append(_session(f"s{n}", 100, user_id=f"d{n}"))
    assert _swept(sweep_db) == [f"s{n}" for n in range(7)]
    eligible = sweep._eligible("audio_purged_at", retention.RETENTION_AUDIO_DAYS, "is_audio_purged")
    assert [r["id"] for r in eligible] == [f"s{n}" for n in range(7)]
