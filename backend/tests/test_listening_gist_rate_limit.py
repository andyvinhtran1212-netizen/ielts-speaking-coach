"""W-03 — per-user rate limit on Listening gist grading.

POST /api/listening/attempts with mode=gist makes one paid Claude call per
attempt. Two caps (values in config.py):

  * LISTENING_GIST_MAX_PER_MINUTE (default 6) — per-worker sliding minute window;
  * LISTENING_GIST_DAILY_LIMIT_PER_USER (default 60) — count of today's
    ai_usage_logs rows with feature="listening_gist".

Both answer 429 BEFORE the grader runs; <= 0 disables a cap; a ledger lookup
error fails open. Other attempt modes (dictation, T/F, MCQ) are not limited.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from config import settings
from routers import listening

LEARNER = {"id": "learner-1", "email": "l@example.test"}
OTHER = {"id": "learner-2", "email": "o@example.test"}


@pytest.fixture
def gist(monkeypatch):
    state = {"user": LEARNER, "graded": [], "today": 0, "count_queries": []}

    async def _auth(_authorization):
        return state["user"]

    def _target(body):
        return {"id": "ex-1", "exercise_type": body.mode}, {"id": "c-1", "transcript": "t"}

    def _grade(*, user_id, body, exercise_row):
        state["graded"].append((user_id, body.mode))
        return {"mode": body.mode, "score": 90}

    monkeypatch.setattr(listening, "get_supabase_user", _auth)
    monkeypatch.setattr(listening, "_resolve_attempt_target", _target)
    monkeypatch.setattr(listening, "_grade_and_save_gist", _grade)
    monkeypatch.setattr(listening, "_grade_and_save_dictation",
                        lambda **kw: _grade(user_id=kw["user_id"], body=kw["body"], exercise_row=None))

    def _count(user_id):
        state["count_queries"].append(user_id)
        return state["today"]

    monkeypatch.setattr(listening, "_count_gist_gradings_today", _count)
    monkeypatch.setattr(settings, "LISTENING_GIST_MAX_PER_MINUTE", 6)
    monkeypatch.setattr(settings, "LISTENING_GIST_DAILY_LIMIT_PER_USER", 60)
    client = TestClient(main.app)

    def post(mode="gist"):
        return client.post("/api/listening/attempts", headers={"Authorization": "Bearer t"},
                           json={"mode": mode, "content_id": "c-1", "user_transcript": "gist"})

    state["post"] = post
    return state


def test_defaults_are_documented_values():
    assert type(settings).model_fields["LISTENING_GIST_MAX_PER_MINUTE"].default == 6
    assert type(settings).model_fields["LISTENING_GIST_DAILY_LIMIT_PER_USER"].default == 60


def test_burst_over_the_minute_cap_is_429_before_grading(gist):
    for _ in range(6):
        assert gist["post"]().status_code == 200
    resp = gist["post"]()
    assert resp.status_code == 429
    detail = resp.json()["detail"]
    assert detail["error"] == "rate_limit_exceeded" and detail["exercise_type"] == "LISTENING_GIST"
    assert detail["limit"] == 6 and 1 <= detail["retry_after"] <= 60
    assert 1 <= int(resp.headers["Retry-After"]) <= 60
    assert len(gist["graded"]) == 6                     # the 7th never reached Claude


def test_minute_window_is_per_user_and_slides(gist, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(listening.time, "monotonic", lambda: clock[0])
    for _ in range(6):
        assert gist["post"]().status_code == 200
    assert gist["post"]().status_code == 429
    gist["user"] = OTHER
    assert gist["post"]().status_code == 200            # another learner is unaffected
    gist["user"] = LEARNER
    clock[0] += 61
    assert gist["post"]().status_code == 200            # window slid


def test_daily_cap_from_the_usage_ledger(gist):
    gist["today"] = 60
    resp = gist["post"]()
    assert resp.status_code == 429
    detail = resp.json()["detail"]
    assert detail["limit"] == 60 and detail["used"] == 60 and detail["reset_at"]
    assert gist["graded"] == [] and gist["count_queries"] == ["learner-1"]
    gist["today"] = 59
    assert gist["post"]().status_code == 200


def test_rejected_daily_attempts_do_not_consume_the_minute_window(gist):
    gist["today"] = 60
    for _ in range(8):
        assert gist["post"]().status_code == 429
    gist["today"] = 0
    assert gist["post"]().status_code == 200


def test_non_gist_modes_are_not_limited(gist):
    gist["today"] = 10_000
    for _ in range(10):
        assert gist["post"]("dictation").status_code == 200
    assert gist["count_queries"] == []


@pytest.mark.parametrize("setting", ["LISTENING_GIST_MAX_PER_MINUTE", "LISTENING_GIST_DAILY_LIMIT_PER_USER"])
def test_non_positive_setting_disables_that_cap(gist, monkeypatch, setting):
    monkeypatch.setattr(settings, setting, 0)
    daily_off = setting == "LISTENING_GIST_DAILY_LIMIT_PER_USER"
    gist["today"] = 10_000 if daily_off else 0
    # With only the daily cap off, the minute cap (6) still applies.
    for _ in range(6 if daily_off else 8):
        assert gist["post"]().status_code == 200


class _Ledger:
    def __init__(self, count=None, fail=False):
        self.count, self.fail, self.filters = count, fail, []

    def table(self, name):
        self.filters.append(("table", name)); return self

    def select(self, *_a, **k):
        self.filters.append(("count", k.get("count"))); return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val)); return self

    def gte(self, col, val):
        self.filters.append(("gte", col, val)); return self

    def execute(self):
        if self.fail:
            raise RuntimeError("ledger down")
        return type("R", (), {"count": self.count, "data": []})()


def test_daily_count_reads_only_this_users_gist_rows_since_utc_midnight(monkeypatch):
    ledger = _Ledger(count=7)
    monkeypatch.setattr(listening, "supabase_admin", ledger)
    assert listening._count_gist_gradings_today("learner-1") == 7
    assert ("table", "ai_usage_logs") in ledger.filters
    assert ("eq", "user_id", "learner-1") in ledger.filters
    assert ("eq", "feature", "listening_gist") in ledger.filters
    (gte,) = [f for f in ledger.filters if f[0] == "gte"]
    assert gte[1] == "created_at" and gte[2].endswith("T00:00:00+00:00")


def test_ledger_lookup_error_fails_open(monkeypatch):
    monkeypatch.setattr(listening, "supabase_admin", _Ledger(fail=True))
    assert listening._count_gist_gradings_today("learner-1") == 0
