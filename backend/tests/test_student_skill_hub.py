"""LEARNERCORE-0063 T25: GET /api/student/skill-hub (FR-111..118, plan T25 tests).

In-memory fake Supabase (select count / eq / in_ / gt / is_ null / or_ / order /
limit / range). The fake does not simulate SQL: `or_` (Listening audio-ready
filter) is recorded and ignored.
"""

from __future__ import annotations

import asyncio
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from services import student_skill_hub as hub
from services import student_today as st

NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)
UID = "u1"


class _Res:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class _Q:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.order_by, self.limit_n, self.rng = [], None, None, None
        self.counted = False

    def select(self, *_a, count=None, **_k):
        self.counted = count == "exact"
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
        return self

    def gt(self, f, v):
        def ok(r):
            val = r.get(f)
            if val is None:
                return False
            if isinstance(val, (int, float)):
                return val > v
            return st._parse_ts(val) > st._parse_ts(v)
        self.filters.append(ok)
        return self

    def is_(self, f, _v):
        self.filters.append(lambda r: r.get(f) is None)
        return self

    def or_(self, _expr):
        return self

    def order(self, f, desc=False):
        self.order_by = (f, desc)
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError(f"{self.table} down")
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        count = len(rows) if self.counted else None
        if self.order_by:
            f, desc = self.order_by
            rows.sort(key=lambda r: str(r.get(f) or ""), reverse=desc)
        if self.rng:
            rows = rows[self.rng[0]: self.rng[1] + 1]
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        return _Res([dict(r) for r in rows], count)


class _DB:
    def __init__(self, tables=None, fail=()):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.fail = set(fail)

    def table(self, name):
        return _Q(self, name)


def _ts(days=0, hours=0, minutes=0):
    return (NOW - timedelta(days=days, hours=hours, minutes=minutes)).isoformat()


class _ChargePlan:
    def __init__(self, metered, reason):
        self.metered, self.reason = metered, reason


class _CreditUnavailable(Exception):
    pass


@pytest.fixture
def wire(monkeypatch):
    """Fake G04 modules (services.credits, routers.me_access: #2485) and the
    T13 assigned reader; returns a setter for plan/balance/assigned."""
    state = {"plan": _ChargePlan(True, "entitlement"), "total": 0, "assigned": (False, [], False),
             "starters": {"speaking": None, "writing": None, "listening": None, "reading": None}}

    def plan(user_id, feature, **_k):
        if isinstance(state["plan"], Exception):
            raise state["plan"]
        return state["plan"]

    def balance(_uid):
        if isinstance(state["total"], Exception):
            raise state["total"]
        return {"total": state["total"], "items": []}

    def assigned(*_a, **_k):
        if isinstance(state["assigned"], Exception):
            raise state["assigned"]
        return state["assigned"]

    credits = types.ModuleType("services.credits")
    credits.charge_plan, credits.CreditUnavailable = plan, _CreditUnavailable
    me = types.ModuleType("routers.me_access")
    me.fetch_credit_balance = balance
    monkeypatch.setitem(sys.modules, "services.credits", credits)
    monkeypatch.setitem(sys.modules, "routers.me_access", me)
    monkeypatch.setattr(st, "_visible_assignments_for", assigned)

    async def starter_values():
        if isinstance(state["starters"], Exception):
            raise state["starters"]
        return state["starters"]

    monkeypatch.setattr(hub, "_starter_values", starter_values)
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_BANK_ENABLED", True, raising=False)
    return state


def _run(db, skill):
    return asyncio.run(hub.get_skill_hub_concurrent(lambda: db, UID, skill, now=NOW))


def _base_tables():
    return {
        "students": [{"id": "s1", "user_id": UID}],
        "topics": [{"id": f"t{i}", "title": f"Topic {i}", "is_active": True, "part": 1 + i % 3}
                   for i in range(9)],
        "writing_prompts": [
            {"id": "p1", "is_active": True, "exam_only": False, "task_type": "task2", "title": "Cities"},
            {"id": "p2", "is_active": True, "exam_only": False, "task_type": "task1_academic"},
            {"id": "p3", "is_active": True, "exam_only": True, "task_type": "task2"},
        ],
        "listening_public_practice_catalog": [
            {"id": "L1", "status": "published", "is_public": True, "scoring_policy": "diagnostic", "test_type": "full"},
            {"id": "L2", "status": "published", "is_public": True, "scoring_policy": "diagnostic", "test_type": "mini"},
        ],
        "reading_public_practice_catalog": [
            {"id": "R1", "status": "published", "is_public": True, "test_type": "full"},
            {"id": "R2", "status": "published", "is_public": True, "test_type": "full"},
        ],
        "listening_tests": [{"id": "L1", "title": "Cam 18 Test 1", "test_type": "full"},
                            {"id": "L2", "title": "Mini 1", "test_type": "mini"}],
        "reading_tests": [{"id": "R1", "test_id": "cam18-1", "title": "Cam 18 R1", "test_type": "full"},
                          {"id": "R2", "test_id": "cam18-2", "title": "Cam 18 R2", "test_type": "full"}],
    }


# ── credits / metering (FR-116, HOLD patch) ───────────────────────────────────


@pytest.mark.parametrize("skill", ["speaking", "writing"])
def test_metering_metered_not_metered_unknown_with_zero_balance(wire, skill):
    db = _DB(_base_tables())
    wire["total"] = 0
    out = _run(db, skill)
    assert out["credits"] == {"total": 0, "metering": "metered"}
    assert "credits" not in out["degraded"]

    wire["plan"] = _ChargePlan(False, "legacy_class")
    assert _run(db, skill)["credits"] == {"total": 0, "metering": "not_metered"}

    wire["plan"] = _CreditUnavailable("charge_plan_read")
    out = _run(db, skill)
    assert out["credits"] == {"total": 0, "metering": "unknown"}
    assert "credits" in out["degraded"]


@pytest.mark.parametrize("skill", ["listening", "reading"])
def test_listening_and_reading_have_no_credits(wire, skill):
    out = _run(_DB(_base_tables()), skill)
    assert out["credits"] is None and "credits" not in out["degraded"]


def test_no_g04_source_yet_means_no_credit_line_and_no_degraded(wire, monkeypatch):
    monkeypatch.setitem(sys.modules, "services.credits", None)  # import raises ImportError
    out = _run(_DB(_base_tables()), "speaking")
    assert out["credits"] is None and "credits" not in out["degraded"]


def test_a_broken_g04_module_degrades_instead_of_hiding_silently(wire, monkeypatch):
    # The module exists but the name does not (a real import bug after #2485
    # merges): that is not "source not there yet", so the part degrades.
    monkeypatch.setitem(sys.modules, "services.credits", types.ModuleType("services.credits"))
    out = _run(_DB(_base_tables()), "speaking")
    assert out["credits"] is None and out["degraded"] == ["credits"]


def test_an_unrelated_missing_module_inside_g04_degrades(wire, monkeypatch):
    def boom(*_a, **_k):
        raise ModuleNotFoundError("No module named 'services.other'", name="services.other")

    import builtins
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "services.credits":
            boom()
        return real_import(name, *a, **k)

    monkeypatch.delitem(sys.modules, "services.credits")
    monkeypatch.setattr(builtins, "__import__", fake_import)
    out = _run(_DB(_base_tables()), "writing")
    assert out["credits"] is None and out["degraded"] == ["credits"]


def test_a_failed_balance_read_hides_the_line_and_degrades(wire):
    wire["total"] = RuntimeError("rpc down")
    out = _run(_DB(_base_tables()), "writing")
    assert out["credits"] is None and out["degraded"] == ["credits"]


# ── resume (FR-112) ───────────────────────────────────────────────────────────


def test_resume_lists_only_this_skill_newest_first_max_three(wire):
    t = _base_tables()
    future = (NOW + timedelta(days=1)).isoformat()
    t["sessions"] = [{"id": f"S{i}", "user_id": UID, "status": "in_progress", "part": 1,
                      "started_at": _ts(hours=i), "resume_expires_at": future} for i in range(4)]
    t["listening_test_attempts"] = [{"id": "LA", "user_id": UID, "status": "in_progress",
                                     "test_id": "L1", "started_at": _ts(), "resume_expires_at": future}]
    out = _run(_DB(t), "speaking")
    assert [r["kind"] for r in out["resume"]] == ["speaking"] * 3
    assert [r["href"].split("session_id=")[1] for r in out["resume"]] == ["S0", "S1", "S2"]
    assert all(r["state"] == "in_progress" for r in out["resume"])

    out = _run(_DB(t), "listening")
    assert [r["title"] for r in out["resume"]] == ["Cam 18 Test 1"]


def test_writing_resume_is_the_newest_unsubmitted_draft(wire):
    t = _base_tables()
    t["writing_assignments"] = [{"id": "A1", "prompt_id": "p1", "status": "in_progress"},
                                {"id": "A2", "prompt_id": "p2", "status": "in_progress"}]
    t["writing_drafts"] = [
        {"assignment_id": "A1", "student_id": "s1", "word_count": 120, "updated_at": _ts(hours=1)},
        {"assignment_id": "A2", "student_id": "s1", "word_count": 40, "updated_at": _ts(hours=3)},
        {"assignment_id": "A9", "student_id": "other", "word_count": 400, "updated_at": _ts()},
    ]
    out = _run(_DB(t), "writing")
    assert out["resume"] == [{"kind": "writing", "title": "Cities", "state": "draft",
                              "href": "/writing/dashboard?view=all&assignment_id=A1",
                              "updated_at": _ts(hours=1)}]


# ── starter (FR-112, FR-126; T25s) ───────────────────────────────────────────

RT = "11111111-2222-3333-4444-555555555555"
ST = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _reading_paper(**over):
    row = {"id": RT, "test_id": "R-01", "title": "Cambridge 19 Test 1", "status": "published",
           "exam_only": False, "is_public": True, "public_practice_enabled": True}
    return {**row, **over}


def _with_starter_papers(tables):
    tables["reading_public_practice_catalog"] = [_reading_paper()]
    tables["topics"].append({"id": ST, "title": "Hometown", "is_active": True, "part": 2})
    return tables


def test_starter_is_null_when_unset_even_for_a_first_visit(wire):
    out = _run(_DB(_base_tables()), "reading")
    assert out["resume"] == [] and out["history"] == [] and out["starter"] is None


def test_reading_starter_shows_for_a_first_visit(wire):
    wire["starters"] = {**wire["starters"], "reading": {"test_uuid": RT}}
    out = _run(_DB(_with_starter_papers(_base_tables())), "reading")
    assert out["starter"] == {
        "title": "Cambridge 19 Test 1", "meta": "Reading · đề đầy đủ", "uses_credit": False,
        "href": "/core-player/launch?surface=reading_exam&test_id=R-01"}


def test_starter_is_null_after_the_paper_closes(wire):
    wire["starters"] = {**wire["starters"], "reading": {"test_uuid": RT}}
    tables = _with_starter_papers(_base_tables())
    for closed in (_reading_paper(status="draft"), _reading_paper(is_public=False)):
        tables["reading_public_practice_catalog"] = [closed]
        assert _run(_DB(tables), "reading")["starter"] is None
    # Held for an exam (or exam_only): the catalog view (mig 306) leaves it out.
    tables["reading_public_practice_catalog"] = []
    assert _run(_DB(tables), "reading")["starter"] is None


def test_speaking_starter_carries_session_params(wire):
    wire["starters"] = {**wire["starters"], "speaking": {"topic_id": ST}}
    out = _run(_DB(_with_starter_papers(_base_tables())), "speaking")
    assert out["starter"] == {
        "title": "Hometown", "meta": "Speaking Part 2", "uses_credit": True,
        "href": "/speaking?view=all",
        "session_params": {"mode": "practice", "part": 2, "topic": "Hometown"}}


def test_speaking_starter_hidden_when_topic_inactive(wire):
    wire["starters"] = {**wire["starters"], "speaking": {"topic_id": ST}}
    tables = _with_starter_papers(_base_tables())
    tables["topics"][-1]["is_active"] = False
    assert _run(_DB(tables), "speaking")["starter"] is None


def test_starter_read_failure_hides_only_the_starter(wire):
    wire["starters"] = RuntimeError("down")
    out = _run(_DB(_with_starter_papers(_base_tables())), "reading")
    assert out["starter"] is None and "starter" not in out["degraded"]
    assert out["degraded"] == []


# ── suggestions (FR-113) ──────────────────────────────────────────────────────


def _assigned(item_id, skill, *, due=None, submitted=None, missing=False, title=None):
    return {"item_id": item_id, "submitted_at": submitted, "is_missing": missing,
            "assignment": {"skill": skill, "title": title or item_id, "due_at": due}}


def test_suggestions_follow_source_order_cap_three_and_skill(wire):
    t = _base_tables()
    t["listening_test_attempts"] = [
        {"id": f"a{i}", "user_id": UID, "status": "submitted", "test_id": "L1", "submitted_at": _ts(days=i)}
        for i in range(3)]
    wire["assigned"] = (True, [
        _assigned("x-late", "listening", due=_ts(days=1), missing=True),
        _assigned("x-soon", "listening", due=(NOW + timedelta(days=2)).isoformat()),
        _assigned("x-done", "listening", submitted=_ts()),
        _assigned("x-writing", "writing"),
    ], False)
    out = _run(_DB(t), "listening")
    kinds = [s["kind"] for s in out["suggestions"]]
    assert kinds == ["assigned", "assigned", "least_practised"]
    assert [s["title"] for s in out["suggestions"][:2]] == ["x-late", "x-soon"]
    assert out["suggestions"][0]["why"] == "Bài lớp giao, đã quá hạn"
    least = out["suggestions"][2]
    assert least["title"] == "Mini test" and least["href"] == "/listening/mini-test"

    wire["assigned"] = (True, [_assigned(f"y{i}", "listening") for i in range(5)], False)
    assert [s["kind"] for s in _run(_DB(t), "listening")["suggestions"]] == ["assigned"] * 3


def test_no_source_means_no_suggestions(wire):
    t = _base_tables()
    t["listening_test_attempts"] = [{"id": "a1", "user_id": UID, "status": "submitted",
                                     "test_id": "L1", "submitted_at": _ts()}]  # fewer than 3
    assert _run(_DB(t), "listening")["suggestions"] == []


# ── catalog (FR-114) ──────────────────────────────────────────────────────────


def test_catalog_done_is_null_before_any_attempt(wire):
    out = _run(_DB(_base_tables()), "writing")
    assert out["catalog"] == [
        {"group": "task1", "label": "Task 1", "count": 1, "done": None,
         "href": "/writing/dashboard?view=all&tab=prompt-bank"},
        {"group": "task2", "label": "Task 2", "count": 1, "done": None,
         "href": "/writing/dashboard?view=all&tab=prompt-bank"},
    ]
    assert out["catalog_href"] == "/writing/dashboard?view=all&tab=prompt-bank"


def test_catalog_counts_distinct_papers_done(wire):
    t = _base_tables()
    t["reading_test_attempts"] = [
        {"id": "r1", "user_id": UID, "status": "submitted", "test_id": "R1", "submitted_at": _ts(days=2)},
        {"id": "r2", "user_id": UID, "status": "submitted", "test_id": "R1", "submitted_at": _ts(days=1)},
        {"id": "r3", "user_id": UID, "status": "submitted", "test_id": "R2", "submitted_at": _ts(),
         "sitting_id": "mock"},  # a mock sitting is Thi thử, not self-practice
    ]
    out = _run(_DB(t), "reading")
    assert [(g["group"], g["count"], g["done"]) for g in out["catalog"]] == [("full", 2, 1), ("mini", 0, 0)]


def test_done_never_exceeds_count(wire):
    t = _base_tables()
    t["reading_test_attempts"] = [
        # R9 is a class-assigned paper, not in the public catalogue.
        {"id": f"r{i}", "user_id": UID, "status": "submitted", "test_id": tid, "submitted_at": _ts(days=i)}
        for i, tid in enumerate(["R1", "R2", "R9"])]
    t["reading_tests"].append({"id": "R9", "title": "Class paper", "test_type": "full"})
    out = _run(_DB(t), "reading")
    full = out["catalog"][0]
    assert (full["count"], full["done"]) == (2, 2)

    t["topics"].append({"id": "t-off", "title": "Old topic", "is_active": False, "part": 1})
    t["sessions"] = [
        {"id": f"s{i}", "user_id": UID, "status": "completed", "part": 1, "mode": "practice",
         "topic": topic, "completed_at": _ts(days=i)}
        for i, topic in enumerate(["Topic 0", "Topic 3", "Old topic", "Unlisted"])]
    part1 = _run(_DB(t), "speaking")["catalog"][0]
    assert (part1["count"], part1["done"]) == (3, 2)


def test_writing_done_stays_null_after_essays(wire):
    t = _base_tables()
    t["writing_essays"] = [
        {"id": f"e{i}", "student_id": "s1", "task_type": "task2", "status": "delivered",
         "created_at": _ts(days=i)} for i in range(5)]
    out = _run(_DB(t), "writing")
    assert [(g["count"], g["done"]) for g in out["catalog"]] == [(1, None), (1, None)]
    assert all("keys" not in g for g in out["catalog"])


def test_speaking_full_test_is_one_history_entry_with_combined_band(wire):
    t = _base_tables()
    t["sessions"] = [
        {"id": f"ft{p}", "user_id": UID, "status": "completed", "part": p, "mode": "test_full",
         "topic": f"T{p}", "full_test_attempt_id": "A1", "overall_band": band,
         "completed_at": _ts(minutes=10 - p)}
        for p, band in ((1, 6.0), (2, 6.5), (3, 7.0))
    ] + [{"id": "p1", "user_id": UID, "status": "completed", "part": 1, "mode": "practice",
          "topic": "Topic 0", "overall_band": 5.5, "completed_at": _ts(days=1)}]
    history = _run(_DB(t), "speaking")["history"]
    assert [h["kind"] for h in history] == ["Full test", "Part 1"]
    assert history[0]["result"]["band"] == 6.5
    assert history[0]["href"] == "/full-test-result?session_id=ft1"


def test_speaking_full_test_with_a_part_still_grading_is_pending(wire):
    t = _base_tables()
    t["sessions"] = [
        {"id": "ft1", "user_id": UID, "status": "completed", "part": 1, "mode": "test_full",
         "full_test_attempt_id": "A1", "overall_band": 6.0, "completed_at": _ts()},
        {"id": "ft2", "user_id": UID, "status": "processing", "part": 2, "mode": "test_full",
         "full_test_attempt_id": "A1", "overall_band": None, "completed_at": None},
    ]
    history = _run(_DB(t), "speaking")["history"]
    assert len(history) == 1 and history[0]["result"]["pending"] is True
    assert history[0]["result"]["band"] is None


def test_writing_history_reads_without_review_mode_column(wire):
    t = _base_tables()
    t["writing_essays"] = [{"id": "e1", "student_id": "s1", "task_type": "task2", "status": "submitted",
                            "created_at": _ts()}]  # no review_mode key: before mig 384
    out = _run(_DB(t), "writing")
    assert "history" not in out["degraded"]
    assert out["history"][0]["source"] == "teacher_review"


def test_speaking_catalog_has_three_parts_and_full_test(wire):
    out = _run(_DB(_base_tables()), "speaking")
    assert [(g["group"], g["count"]) for g in out["catalog"]] == [
        ("part1", 3), ("part2", 3), ("part3", 3), ("full_test", None)]


# ── history (FR-115, FR-077) ──────────────────────────────────────────────────


def test_history_five_newest_with_source_and_valid_result(wire):
    t = _base_tables()
    t["listening_test_attempts"] = [
        {"id": f"la{i}", "user_id": UID, "status": "submitted", "test_id": "L1", "score": 30,
         "band_estimate": 7.0, "grading_details": [{"q_num": n} for n in range(40)],
         "submitted_at": _ts(days=i)} for i in range(6)]
    t["listening_test_attempts"][0].update({"test_id": "L2", "grading_details": [{"q_num": 1}] * 10,
                                            "score": 6, "band_estimate": 4.0})
    out = _run(_DB(t), "listening")
    assert len(out["history"]) == 5
    first, second = out["history"][0], out["history"][1]
    assert first["source"] == "auto" and first["kind"] == "Mini test"
    assert first["result"] == {"band": None, "correct": 6, "total": 10, "pending": False}
    assert second["result"]["band"] == 7.0
    assert first["href"] == "/listening/review?attempt_id=la0"


def test_writing_history_class_essay_is_teacher_review(wire):
    t = _base_tables()
    t["writing_essays"] = [
        {"id": "e1", "student_id": "s1", "task_type": "task2", "status": "delivered",
         "review_mode": None, "created_at": _ts(days=1)},
        {"id": "e2", "student_id": "s1", "task_type": "task2", "status": "grading",
         "review_mode": "ai_instant", "created_at": _ts()},
    ]
    t["writing_feedback_current"] = [{"essay_id": "e1", "overall_band_score": 6.5}]
    out = _run(_DB(t), "writing")
    assert [(h["source"], h["result"]["band"], h["result"]["pending"]) for h in out["history"]] == [
        ("ai_instant", None, True), ("teacher_review", 6.5, False)]
    assert out["history"][0]["href"] is None
    assert out["history"][1]["href"] == "/writing/result?essay_id=e1"


# ── access, 422, degraded (FR-117, FR-118) ────────────────────────────────────


@pytest.mark.parametrize("skill", hub.SKILLS)
def test_access_is_never_blocked(wire, skill):
    assert _run(_DB(_base_tables()), skill)["access"] == {"blocked": False}


def test_one_failing_part_degrades_only_its_block(wire):
    out = _run(_DB(_base_tables(), fail={"listening_test_attempts"}), "listening")
    # resume, attempts (catalog + suggestions) and history all read that table
    assert out["degraded"] == ["resume", "suggestions", "catalog", "history"]
    assert out["catalog"] == [] and out["history"] == [] and out["resume"] == []

    out = _run(_DB(_base_tables(), fail={"topics"}), "speaking")
    assert out["degraded"] == ["suggestions", "catalog"] and out["catalog"] == []

    wire["assigned"] = RuntimeError("class down")
    out = _run(_DB(_base_tables()), "reading")
    assert out["degraded"] == ["suggestions"] and out["catalog"]


def test_unknown_skill_is_422(monkeypatch):
    from main import app

    async def user(_auth):
        return {"id": UID, "email": "a@example.com"}

    import routers.student_home as sh
    monkeypatch.setattr(sh, "get_supabase_user", user)
    client = TestClient(app)
    res = client.get("/api/student/skill-hub?skill=grammar", headers={"Authorization": "Bearer x"})
    assert res.status_code == 422
    with pytest.raises(ValueError):
        asyncio.run(hub.get_skill_hub_concurrent(lambda: _DB(), UID, "grammar"))


def test_response_model_accepts_every_skill_payload(wire):
    from models.student_skill_hub import StudentSkillHubResponse

    for skill in hub.SKILLS:
        StudentSkillHubResponse.model_validate(_run(_DB(_base_tables()), skill))
