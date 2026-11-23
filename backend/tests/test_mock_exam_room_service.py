"""MOCKORG-0086 G09-T33: timeline, extra time, room messages, release, score
edits and analysis (mock_exam_room_service + the admin routes).

In-memory fake of the PostgREST client; migrations 447/448 themselves are
covered on a real PostgreSQL by test_migration_447_448_mock_exam_events.py.
"""
from __future__ import annotations

import asyncio
import copy
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from services import mock_exam_audience_service as aud
from services import mock_exam_room_service as room
from services import mock_exam_service as exam_svc
from services import mock_review_workflow as wf


def U(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


EXAM, ADMIN = U(900), U(1)
S_DONE, S_NO_SPEAK, S_NO_REVIEW, S_TIMED_OUT, S_VOID = U(101), U(102), U(103), U(104), U(105)
NOW = datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc)


JSONB = {"extra_seconds", "final_bands", "payload"}


def _match(row, col, val):
    if col in JSONB:
        # PostgREST sends the filter value as text and Postgres parses it as
        # JSON: a Python dict (repr with single quotes) fails there, so fail here.
        if not isinstance(val, str):
            raise RuntimeError(f"22P02 invalid input syntax for type json: {val!r}")
        return row.get(col) == json.loads(val)
    if "->>" in col:
        base, key = col.split("->>", 1)
        got = (row.get(base) or {}).get(key)
        return got is not None and str(got) == str(val)
    if isinstance(val, (dict, list)):
        return row.get(col) == val
    return str(row.get(col)) == str(val)


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self._limit = None

    def select(self, *_a, **_k): self.op = "select"; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, col, val): self.filters.append(lambda r: _match(r, col, val)); return self
    def neq(self, col, val): self.filters.append(lambda r: not _match(r, col, val)); return self
    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals); return self
    def order(self, *_a, **_k): return self
    def limit(self, n): self._limit = n; return self

    def execute(self):
        if self.table in self.db.down:
            raise RuntimeError(f"{self.table} unavailable")
        rows = self.db.tables.setdefault(self.table, [])
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for row in new:
                row = {"id": str(uuid.uuid4()), "created_at": NOW.isoformat(), **copy.deepcopy(row)}
                if self.table == "mock_exam_events" and row["kind"] == "released":
                    key = row["payload"].get("request_key")
                    if any(r["kind"] == "released" and r["exam_id"] == row["exam_id"]
                           and r["payload"].get("request_key") == key for r in rows):
                        raise RuntimeError("duplicate key uq_mock_exam_events_release_key")
                rows.append(row)
                out.append(row)
            self.db.writes.append((self.table, "insert", len(new)))
            data = out
        elif self.op == "update":
            for r in match:
                r.update(copy.deepcopy(self.payload))
            self.db.writes.append((self.table, "update", len(match)))
            data = match
        else:
            data = match[: self._limit] if self._limit else match
        return type("R", (), {"data": copy.deepcopy(data)})()


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list] = {}
        self.writes: list = []
        self.rpcs: list = []
        self.down: set = set()
        self.rpc_error = None

    def table(self, name):
        return _Q(self, name)

    def rpc(self, name, params):
        db = self

        class _R:
            def execute(self_inner):
                db.rpcs.append((name, params))
                if db.rpc_error:
                    raise RuntimeError(db.rpc_error)
                review = next(r for r in db.tables["mock_exam_reviews"]
                              if r["sitting_id"] == params["p_sitting_id"])
                review["final_bands"] = params["p_new"]
                return type("R", (), {"data": {"final_bands": params["p_new"]}})()
        return _R()

    def events(self, kind=None):
        return [e for e in self.tables.get("mock_exam_events", []) if kind in (None, e["kind"])]


def _bands(**kw):
    out = {"listening": 6.5, "reading": 7.0, "writing": 6.0, "speaking": 6.5}
    out.update(kw)
    return out


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    fake.tables["mock_exams"] = [{
        "id": EXAM, "title": "Thi thử tháng 12", "status": "published", "exam_mode": "retake",
        "is_open": True, "skills": None,
    }]
    fake.tables["mock_exam_sittings"] = [
        {"id": S_DONE, "mock_exam_id": EXAM, "user_id": U(201), "status": "submitted",
         "released_skills": [], "extra_seconds": {}},
        {"id": S_NO_SPEAK, "mock_exam_id": EXAM, "user_id": U(202), "status": "speaking_pending",
         "released_skills": [], "extra_seconds": {}},
        {"id": S_NO_REVIEW, "mock_exam_id": EXAM, "user_id": U(203), "status": "in_progress",
         "released_skills": [], "extra_seconds": {}},
        # Self-paced sitting that ran out of time: auto-submitted, reviewed.
        {"id": S_TIMED_OUT, "mock_exam_id": EXAM, "user_id": U(204), "status": "submitted",
         "released_skills": [], "extra_seconds": {}},
        {"id": S_VOID, "mock_exam_id": EXAM, "user_id": U(205), "status": "void",
         "released_skills": [], "extra_seconds": {}},
    ]
    fake.tables["mock_exam_reviews"] = [
        {"id": U(301), "sitting_id": S_DONE, "status": "reviewed", "final_bands": _bands(overall=6.5)},
        {"id": U(302), "sitting_id": S_NO_SPEAK, "status": "queued",
         "final_bands": {"listening": 6.0, "reading": 6.5, "writing": None, "speaking": None}},
        {"id": U(304), "sitting_id": S_TIMED_OUT, "status": "reviewed",
         "final_bands": _bands(writing=5.5, overall=6.5)},
    ]
    fake.tables["mock_exam_events"] = []
    fake.tables["mock_exam_room_messages"] = []
    for mod in (room, aud, exam_svc, wf):
        monkeypatch.setattr(mod, "supabase_admin", fake)
    flags = {"mock_exam_audiences": True, "mock_partial_release": False,
             "mock_exam_audiences_learner": True}
    monkeypatch.setattr(aud.runtime_flags, "is_enabled",
                        lambda key, default=False, on_error=False: flags.get(key, default))
    fake.flags = flags

    def bulk(ids, admin_id):
        released, skipped = [], []
        for sid in ids:
            r = next(r for r in fake.tables["mock_exam_reviews"] if r["sitting_id"] == sid)
            r["status"] = "released"
            released.append(sid)
        fake.bulk_calls.append(list(ids))
        return {"released": released, "skipped": skipped}
    fake.bulk_calls = []
    monkeypatch.setattr(wf, "bulk_release_sittings", bulk)
    monkeypatch.setattr(wf, "resolve_display_names", lambda ids: {i: "Tên" for i in ids})
    monkeypatch.setattr(wf, "required_skills_for_sitting",
                        lambda sid: ["listening", "reading", "writing", "speaking"])
    monkeypatch.setattr(exam_svc, "_section_duration_seconds", lambda exam, s: 3600)
    monkeypatch.setattr(room, "_now", lambda: NOW)
    return fake


def _exam(db):
    return db.tables["mock_exams"][0]


def _sitting(db, sid):
    return next(s for s in db.tables["mock_exam_sittings"] if s["id"] == sid)


def _review(db, sid):
    return next(r for r in db.tables["mock_exam_reviews"] if r["sitting_id"] == sid)


def _err(call):
    with pytest.raises(room.AudienceError) as e:
        call()
    return e.value


# --- flag -------------------------------------------------------------------

def test_flag_off_refuses_every_entry_point_and_writes_no_timeline(db):
    db.flags["mock_exam_audiences"] = False
    for call in (
        lambda: room.list_events(EXAM),
        lambda: room.add_extra_time(EXAM, S_DONE, "reading", 60, "mất điện", ADMIN),
        lambda: room.send_room_message(EXAM, "xin chào", ADMIN),
        lambda: room.release(EXAM, "complete_only", "Thi thử tháng 12", "k" * 12, ADMIN),
        lambda: room.score_edit(S_DONE, "writing", 6.5, "chấm lại", ADMIN),
        lambda: room.analysis(EXAM),
    ):
        e = _err(call)
        assert e.code == "audiences_disabled" and e.status == 409
    assert room.record_event_quietly(EXAM, "room_opened") is False
    assert db.writes == []


def test_quiet_event_never_raises_when_the_timeline_is_down(db):
    db.down.add("mock_exam_events")
    assert room.record_event_quietly(EXAM, "room_opened", actor_id=ADMIN) is False


def test_unknown_event_kind_is_refused():
    with pytest.raises(ValueError):
        room.record_event(EXAM, "made_up")


# --- release (FR-148) ---------------------------------------------------------

def test_complete_only_releases_finished_and_timed_out_and_skips_the_rest(db):
    out = room.release(EXAM, "complete_only", " Thi thử tháng 12 ", "req-00000001", ADMIN)
    assert db.bulk_calls == [[S_DONE, S_TIMED_OUT]]
    assert out["released"] == 2 and out["partial"] == 0 and out["replayed"] is False
    skipped = {i["sitting_id"] for i in out["skipped_items"]}
    # Missing Speaking band and never-reviewed (missed) are skipped; void is not listed.
    assert skipped == {S_NO_SPEAK, S_NO_REVIEW}
    assert _sitting(db, S_NO_SPEAK)["released_skills"] == []
    assert [e["kind"] for e in db.events()] == ["released", "release_summary"]
    assert db.events("released")[0]["payload"] == {"request_key": "req-00000001",
                                                   "mode": "complete_only"}


def test_repeat_request_key_changes_nothing(db):
    first = room.release(EXAM, "complete_only", "Thi thử tháng 12", "req-00000001", ADMIN)
    writes = list(db.writes)
    again = room.release(EXAM, "complete_only", "Thi thử tháng 12", "req-00000001", ADMIN)
    assert again["replayed"] is True
    assert (again["released"], again["skipped"]) == (first["released"], first["skipped"])
    assert db.writes == writes and len(db.bulk_calls) == 1


def test_key_claimed_without_a_summary_is_reported_not_rerun(db):
    db.tables["mock_exam_events"].append({"id": U(5), "exam_id": EXAM, "kind": "released",
                                          "payload": {"request_key": "req-00000002"}})
    e = _err(lambda: room.release(EXAM, "complete_only", "Thi thử tháng 12", "req-00000002", ADMIN))
    assert e.code == "release_in_progress" and e.status == 409
    assert db.bulk_calls == []


def test_release_needs_the_typed_title_and_a_key(db):
    assert _err(lambda: room.release(EXAM, "complete_only", "Thi thử", "req-00000001",
                                     ADMIN)).code == "confirm_mismatch"
    assert _err(lambda: room.release(EXAM, "complete_only", "Thi thử tháng 12", "short",
                                     ADMIN)).code == "invalid_request_key"
    assert db.writes == []


def test_include_partial_is_behind_its_own_flag(db):
    e = _err(lambda: room.release(EXAM, "include_partial", "Thi thử tháng 12", "req-00000003", ADMIN))
    assert e.code == "partial_release_disabled" and e.status == 409
    assert db.writes == []


def test_include_partial_writes_released_skills_for_banded_skills(db):
    db.flags["mock_partial_release"] = True
    out = room.release(EXAM, "include_partial", "Thi thử tháng 12", "req-00000004", ADMIN)
    assert out["released"] == 2 and out["partial"] == 1
    assert _sitting(db, S_NO_SPEAK)["released_skills"] == ["listening", "reading"]
    assert [i["sitting_id"] for i in out["skipped_items"]] == [S_NO_REVIEW]
    assert _sitting(db, S_VOID)["released_skills"] == []


def test_release_with_the_timeline_down_releases_nothing(db):
    db.down.add("mock_exam_events")
    e = _err(lambda: room.release(EXAM, "complete_only", "Thi thử tháng 12", "req-00000005", ADMIN))
    assert e.code == "release_unavailable" and e.status == 503
    assert db.bulk_calls == []


# --- score edit after release (FR-148) ----------------------------------------

def test_score_edit_before_release_is_refused(db):
    e = _err(lambda: room.score_edit(S_DONE, "writing", 6.5, "chấm lại", ADMIN))
    assert e.code == "not_released" and e.status == 409
    assert db.rpcs == []


def test_score_edit_needs_a_reason_and_a_half_band(db):
    _review(db, S_DONE)["status"] = "released"
    assert _err(lambda: room.score_edit(S_DONE, "writing", 6.5, "  ", ADMIN)).code == "reason_required"
    assert _err(lambda: room.score_edit(S_DONE, "writing", 6.3, "chấm lại", ADMIN)).code == "invalid_band"
    assert _err(lambda: room.score_edit(S_DONE, "writing", 9.5, "chấm lại", ADMIN)).code == "invalid_band"
    assert db.rpcs == []


def test_score_edit_recomputes_overall_and_sends_the_bands_it_read(db):
    _review(db, S_DONE)["status"] = "released"
    out = room.score_edit(S_DONE, "writing", 7.5, "chấm lại Task 2", ADMIN)
    name, params = db.rpcs[0]
    assert name == "fn_mock_exam_score_edit"
    assert params["p_expected"] == _bands(overall=6.5)
    # 6.5 + 7.0 + 7.5 + 6.5 = 27.5 / 4 = 6.875 → 7.0
    assert params["p_new"]["writing"] == 7.5 and params["p_new"]["overall"] == 7.0
    assert params["p_reason"] == "chấm lại Task 2" and params["p_exam_id"] == EXAM
    assert out["old_band"] == 6.0 and out["new_band"] == 7.5


def test_concurrent_score_edit_is_a_conflict(db):
    _review(db, S_DONE)["status"] = "released"
    db.rpc_error = "mock_score_edit_conflict"
    e = _err(lambda: room.score_edit(S_DONE, "writing", 7.5, "chấm lại", ADMIN))
    assert e.code == "score_edit_conflict" and e.status == 409


# --- extra time (FR-146) --------------------------------------------------------

def _start_reading(db, sid=S_DONE, minutes_ago=10):
    s = _sitting(db, sid)
    s.update({"status": "in_progress", "assigned_skills": ["listening", "reading", "writing"],
              "listening_started_at": (NOW - timedelta(minutes=70 + minutes_ago)).isoformat(),
              "listening_submitted_at": (NOW - timedelta(minutes=minutes_ago)).isoformat()})
    return s


def test_extra_time_needs_a_reason(db):
    _start_reading(db)
    e = _err(lambda: room.add_extra_time(EXAM, S_DONE, "reading", 300, " ", ADMIN))
    assert e.code == "reason_required" and e.status == 422
    with pytest.raises(ValidationError):
        from routers import admin_mock_exams as r
        r.ExtraTimeBody(sitting_id=S_DONE, section="reading", seconds=300, reason="")


def test_extra_time_on_a_submitted_section_is_refused(db):
    _start_reading(db)
    e = _err(lambda: room.add_extra_time(EXAM, S_DONE, "listening", 300, "mất mạng", ADMIN))
    assert e.code == "section_not_running" and e.status == 409
    assert e.extra["current_section"] == "reading"
    assert _sitting(db, S_DONE)["extra_seconds"] == {}


def test_extra_time_adds_up_and_is_logged(db):
    _start_reading(db)
    room.add_extra_time(EXAM, S_DONE, "reading", 300, "mất mạng", ADMIN)
    out = room.add_extra_time(EXAM, S_DONE, "reading", 120, "mất mạng lần hai", ADMIN)
    assert out["extra_seconds"] == {"reading": 420}
    assert [e["payload"]["total_seconds"] for e in db.events("extra_time")] == [300, 420]
    assert db.events("extra_time")[0]["sitting_id"] == S_DONE


def test_extra_time_in_a_live_room_waits_for_the_owner(db):
    _exam(db)["exam_mode"] = "sequential"
    _start_reading(db)
    e = _err(lambda: room.add_extra_time(EXAM, S_DONE, "reading", 300, "mất mạng", ADMIN))
    assert e.code == "live_extra_time_unsupported" and e.status == 409


# --- room messages ----------------------------------------------------------------

def test_room_message_only_in_an_open_live_room(db):
    assert _err(lambda: room.send_room_message(EXAM, "hi", ADMIN)).code == "live_only"
    _exam(db)["exam_mode"] = "live"
    _exam(db)["is_open"] = False
    assert _err(lambda: room.send_room_message(EXAM, "hi", ADMIN)).code == "room_closed"
    _exam(db)["is_open"] = True
    out = room.send_room_message(EXAM, "  Còn 5 phút  ", ADMIN)
    assert out["body"] == "Còn 5 phút" and out["event_logged"] is True
    assert db.events("room_message")[0]["payload"]["message_id"] == out["id"]


# --- timeline and analysis -------------------------------------------------------

def test_events_filter_by_kind_and_refuse_unknown_kinds(db):
    room.record_event(EXAM, "room_opened", actor_id=ADMIN)
    room.record_event(EXAM, "extra_time", {"seconds": 60}, actor_id=ADMIN, sitting_id=S_DONE)
    items = room.list_events(EXAM, ["extra_time"])["items"]
    assert [i["kind"] for i in items] == ["extra_time"] and items[0]["actor_name"] == "Tên"
    assert _err(lambda: room.list_events(EXAM, ["nope"])).code == "invalid_kind"


def test_analysis_hides_distribution_below_the_threshold(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: {"sitting_id": sid})
    monkeypatch.setattr(room, "_min_papers", lambda: None)
    out = room.analysis(EXAM)
    assert out["band_distribution"] == {s: None for s in room.SKILLS}
    # Median hidden under the same threshold as the distribution (CR #2612).
    assert out["band_median"] == {s: None for s in room.SKILLS}
    # No marked attempt, essay or earlier exam in this fixture (G09-T33b).
    assert out["top_wrong"] == {"listening": None, "reading": None}
    assert out["by_question_type"] == {"listening": None, "reading": None}
    assert out["vs_previous"] is None and out["writing_criteria_median"] is None
    assert out["sources_failed"] == []
    monkeypatch.setattr(room, "_min_papers", lambda: 2)
    out = room.analysis(EXAM)
    assert out["band_distribution"]["writing"] == [{"band": 5.5, "count": 1}, {"band": 6.0, "count": 1}]
    # queued review's listening band is not counted; only 2 graded papers.
    assert out["band_distribution"]["listening"] == [{"band": 6.5, "count": 2}]
    assert len(out["pacing"]) == 4


# --- router -------------------------------------------------------------------------

@pytest.fixture
def admin(monkeypatch):
    from routers import admin_mock_exams as r

    async def fake(_auth):
        return {"id": ADMIN}
    monkeypatch.setattr(r, "require_admin", fake)
    return r


def test_router_maps_service_errors(admin, db):
    with pytest.raises(HTTPException) as e:
        asyncio.run(admin.release_exam(
            EXAM, admin.ExamReleaseBody(mode="complete_only", confirm_title="x", request_key="req-00000001"),
            authorization="x"))
    assert e.value.status_code == 422 and e.value.detail["code"] == "confirm_mismatch"


def test_router_open_writes_a_timeline_row_only_with_the_flag(admin, db, monkeypatch):
    monkeypatch.setattr(exam_svc, "set_open", lambda eid, is_open, actor: {"id": eid, "is_open": is_open,
                                                                           "exam_mode": "sequential"})
    asyncio.run(admin.set_open(EXAM, admin.OpenBody(is_open=True), authorization="x"))
    assert [e["kind"] for e in db.events()] == ["room_opened"]
    db.flags["mock_exam_audiences"] = False
    asyncio.run(admin.set_open(EXAM, admin.OpenBody(is_open=False), authorization="x"))
    assert [e["kind"] for e in db.events()] == ["room_opened"]


def test_router_open_survives_a_timeline_failure(admin, db, monkeypatch):
    monkeypatch.setattr(exam_svc, "set_open", lambda eid, is_open, actor: {"id": eid, "is_open": is_open,
                                                                           "exam_mode": "sequential"})
    db.down.add("mock_exam_events")
    out = asyncio.run(admin.set_open(EXAM, admin.OpenBody(is_open=True), authorization="x"))
    assert out["is_open"] is True


def test_router_live_monitor_carries_the_idle_threshold(admin, db, monkeypatch):
    monkeypatch.setattr(exam_svc, "admin_live_monitor", lambda eid: {"students": []})
    monkeypatch.setattr(room, "idle_threshold_minutes", lambda: 5)
    out = asyncio.run(admin.live_monitor(EXAM, authorization="x"))
    assert out["idle_threshold_minutes"] == 5


# --- analysis sources (G09-T33b, FR-147) -------------------------------------------

def _gd(*rows):
    return [{"q_num": q, "correct": c, "user_answer": a, "expected": e} for q, c, a, e in rows]


def _with_attempts(db):
    for sid, aid in ((S_DONE, U(601)), (S_TIMED_OUT, U(602)), (S_NO_SPEAK, U(603))):
        _sitting(db, sid)["reading_attempt_id"] = aid
    db.tables["reading_test_attempts"] = [
        {"id": U(601), "test_id": U(700), "status": "submitted", "paper_revision": None,
         "grading_details": _gd((1, True, "A", "A"), (2, False, "C", "B"), (3, False, "", "TRUE"))},
        {"id": U(602), "test_id": U(700), "status": "submitted", "paper_revision": None,
         "grading_details": _gd((1, False, "D", "A"), (2, False, "C", "B"), (3, True, "TRUE", "TRUE"))},
        # Still being worked on: not counted.
        {"id": U(603), "test_id": U(700), "status": "in_progress", "paper_revision": None,
         "grading_details": _gd((1, False, "X", "A"))},
    ]
    db.tables["reading_passages"] = [{"id": U(710), "test_id": U(700), "library": "l3_test",
                                      "passage_order": 1}]
    db.tables["reading_questions"] = [
        {"q_num": 1, "question_type": "mcq_single", "passage_id": U(710), "answer": {"answer": "A"}},
        {"q_num": 2, "question_type": "mcq_single", "passage_id": U(710), "answer": {"answer": "B"}},
        {"q_num": 3, "question_type": "tfng", "passage_id": U(710), "answer": {"answer": "TRUE"}},
    ]


def test_top_wrong_and_question_types_from_marked_reading(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    _with_attempts(db)
    out = room.analysis(EXAM)
    top = out["top_wrong"]["reading"]
    assert [t["q_num"] for t in top] == [2, 1, 3]
    assert top[0] == {"q_num": 2, "attempted": 2, "wrong": 2, "blank": 0, "expected": "B",
                      "wrong_rate": 1.0, "top_wrong_answer": {"answer": "C", "count": 2}}
    assert top[2]["blank"] == 1 and top[2]["top_wrong_answer"] is None
    assert out["top_wrong"]["listening"] is None
    assert out["by_question_type"]["reading"] == [
        {"question_type": "mcq_single", "correct": 1, "total": 4, "rate": 0.25},
        {"question_type": "tfng", "correct": 1, "total": 2, "rate": 0.5},
    ]


def test_self_check_rows_are_not_counted(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    _sitting(db, S_DONE)["listening_attempt_id"] = U(611)
    db.tables["listening_test_attempts"] = [{
        "id": U(611), "test_id": U(720), "status": "submitted", "paper_revision": None,
        "grading_details": [{"q_num": 1, "correct": None, "self_check": True, "user_answer": "x"}],
    }]
    monkeypatch.setattr(room, "_live_key", lambda skill, test_id: [])
    out = room.analysis(EXAM)
    assert out["top_wrong"]["listening"] is None and out["by_question_type"]["listening"] is None


def test_frozen_key_wins_over_the_current_key(db, monkeypatch):
    import services.mock_paper_policy as policy
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    _with_attempts(db)
    for a in db.tables["reading_test_attempts"]:
        a["paper_revision"] = 3
    monkeypatch.setattr(policy, "frozen_answer_key",
                        lambda _db, skill, att: [{"q_num": q, "question_type": "frozen"} for q in (1, 2, 3)])
    out = room.analysis(EXAM)
    assert out["by_question_type"]["reading"] == [
        {"question_type": "frozen", "correct": 2, "total": 6, "rate": 0.333}]


def test_writing_criteria_median_per_task(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    _sitting(db, S_DONE)["essay_task2_id"] = U(801)
    _sitting(db, S_TIMED_OUT)["essay_task2_id"] = U(802)
    db.tables["writing_feedback"] = [
        {"essay_id": U(801), "band_main_criterion": 6.0, "band_coherence_cohesion": 6.5,
         "band_lexical_resource": 6.0, "band_grammatical_range": 5.5},
        {"essay_id": U(802), "band_main_criterion": 7.0, "band_coherence_cohesion": 6.5,
         "band_lexical_resource": None, "band_grammatical_range": 6.5},
    ]
    out = room.analysis(EXAM)["writing_criteria_median"]
    assert out["task1"] is None
    assert out["task2"] == {"essays": 2, "main_criterion": 6.5, "coherence_cohesion": 6.5,
                            "lexical_resource": 6.0, "grammatical_range": 6.0}


def test_vs_previous_compares_shared_learners_only(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    prev, older = U(950), U(951)
    _exam(db)["created_at"] = "2026-12-01T00:00:00+00:00"
    db.tables["mock_exams"] += [
        {"id": prev, "title": "Thi thử tháng 11", "created_at": "2026-11-01T00:00:00+00:00"},
        {"id": older, "title": "Thi thử tháng 10", "created_at": "2026-10-01T00:00:00+00:00"},
        {"id": U(952), "title": "Sau", "created_at": "2026-12-15T00:00:00+00:00"},
    ]
    db.tables["mock_exam_sittings"] += [
        {"id": U(161), "mock_exam_id": prev, "user_id": U(201), "status": "submitted"},
        {"id": U(162), "mock_exam_id": older, "user_id": U(204), "status": "submitted"},
        {"id": U(163), "mock_exam_id": U(952), "user_id": U(201), "status": "submitted"},
    ]
    db.tables["mock_exam_reviews"] += [
        {"id": U(361), "sitting_id": U(161), "status": "released", "final_bands": _bands(writing=5.0)},
        {"id": U(362), "sitting_id": U(162), "status": "released", "final_bands": _bands()},
    ]
    out = room.analysis(EXAM)["vs_previous"]
    assert out["exam_id"] == prev and out["shared_learners"] == 1
    assert out["skills"]["writing"] == {"learners": 1, "previous_median": 5.0, "median": 6.0,
                                        "delta": 1.0}


def test_a_failing_source_is_named_not_hidden(db, monkeypatch):
    monkeypatch.setattr(exam_svc, "sitting_pacing", lambda sid: None)
    _sitting(db, S_DONE)["essay_task1_id"] = U(801)
    db.down.add("writing_feedback")
    out = room.analysis(EXAM)
    assert out["writing_criteria_median"] is None
    assert out["sources_failed"] == ["writing_criteria"]
    assert out["pacing"] and out["top_wrong"] == {"listening": None, "reading": None}

# --- CR #2612 --------------------------------------------------------------------

def test_extra_time_waits_for_the_learner_clock(db):
    db.flags["mock_exam_audiences_learner"] = False
    _start_reading(db)
    e = _err(lambda: room.add_extra_time(EXAM, S_DONE, "reading", 300, "mất mạng", ADMIN))
    assert e.code == "learner_clock_not_ready" and e.status == 409
    assert _sitting(db, S_DONE)["extra_seconds"] == {} and db.events() == []


def test_extra_time_filter_is_json_text(db):
    _start_reading(db)
    _sitting(db, S_DONE)["extra_seconds"] = {"reading": 60}
    out = room.add_extra_time(EXAM, S_DONE, "reading", 60, "mất mạng", ADMIN)
    assert out["extra_seconds"] == {"reading": 120}


def test_partial_release_counts_only_rows_written(db, monkeypatch):
    db.flags["mock_partial_release"] = True
    real = _Q.execute

    def void_before_write(self):
        if self.table == "mock_exam_sittings" and self.op == "update" and "released_skills" in self.payload:
            _sitting(db, S_NO_SPEAK)["status"] = "void"
        return real(self)
    monkeypatch.setattr(_Q, "execute", void_before_write)
    out = room.release(EXAM, "include_partial", "Thi thử tháng 12", "req-00000006", ADMIN)
    assert out["partial"] == 0
    changed = [i for i in out["skipped_items"] if i["sitting_id"] == S_NO_SPEAK]
    assert changed[0]["reason_code"] == "changed"
    again = room.release(EXAM, "include_partial", "Thi thử tháng 12", "req-00000006", ADMIN)
    assert again["replayed"] is True and again["partial"] == 0
    assert any(i["reason_code"] == "changed" for i in again["skipped_items"])


def test_missed_self_paced_sitting_has_its_own_reason(db):
    s = _sitting(db, S_NO_REVIEW)
    s.update({"status": "not_started", "retake_open_until": (NOW - timedelta(days=1)).isoformat()})
    out = room.release(EXAM, "complete_only", "Thi thử tháng 12", "req-00000007", ADMIN)
    codes = {i["sitting_id"]: i["reason_code"] for i in out["skipped_items"]}
    assert codes == {S_NO_REVIEW: "missed", S_NO_SPEAK: "not_ready"}


def test_collect_event_says_queued(admin, db, monkeypatch):
    from routers import admin_mock_exams as r

    async def fake_dispatch(fn, background_tasks):
        return {"section": "reading"}
    monkeypatch.setattr(r, "_claim_then_dispatch", fake_dispatch)
    asyncio.run(r.collect_section(EXAM, background_tasks=None, from_section="reading",
                                  section=None, authorization="x"))
    ev = db.events("section_collected")[0]
    assert ev["payload"] == {"section": "reading", "from_section": "reading", "queued": True}
