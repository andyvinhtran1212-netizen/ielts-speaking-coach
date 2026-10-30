"""Slow vocabulary I/O must leave the event loop available to other requests."""

import asyncio
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest

from models.vocabulary_sets import SessionStart
from routers import advanced_vocab, kp, vocab_units, vocabulary_sets
from services import advanced_vocab_rewrite_grader, advanced_vocab_service as advanced


class SlowIO:
    def __init__(self):
        self.started = threading.Event()
        self.finished = threading.Event()

    def __call__(self):
        self.started.set()
        time.sleep(0.5)
        self.finished.set()


def responsive(call, slow):
    async def scenario():
        started = time.perf_counter()
        request = asyncio.create_task(call())
        try:
            # The timer is registered before the handler starts. Blocking the
            # loop delays this independent coroutine by the full I/O duration.
            await asyncio.sleep(0.02)
            elapsed = time.perf_counter() - started
            during_io = slow.started.is_set() and not slow.finished.is_set()
        finally:
            result = await request
        return result, elapsed, during_io

    result, elapsed, during_io = asyncio.run(scenario())
    assert elapsed < 0.2, f"light coroutine waited {elapsed:.3f}s behind vocabulary I/O"
    assert during_io, "light coroutine must finish while the slow operation is running"
    return result


async def learner(_authorization):
    return {"id": "learner"}


class Query:
    def __init__(self, execute):
        self.execute = execute

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def update(self, *_args): return self


@pytest.mark.parametrize("slow_at", ["audience", "execute"])
def test_catalog_keeps_loop_responsive(monkeypatch, slow_at):
    slow = SlowIO()
    monkeypatch.setattr(vocabulary_sets, "get_supabase_user", learner)

    def audience(*_args):
        if slow_at == "audience":
            slow()
        return [], []

    def execute():
        if slow_at == "execute":
            slow()
        return SimpleNamespace(data=[])

    monkeypatch.setattr(vocabulary_sets.svc, "audience", audience)
    monkeypatch.setattr(vocabulary_sets.svc, "paged", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(vocabulary_sets.svc, "published_rows", lambda *_args: {})
    monkeypatch.setattr(vocabulary_sets, "db", SimpleNamespace(table=lambda _name: Query(execute)))
    result = responsive(lambda: vocabulary_sets.catalog("token"), slow)
    assert result.model_dump() == {"sets": [], "courses": [], "cohorts": [], "sessions": []}


@pytest.mark.parametrize("slow_at", ["get_set", "execute", "rpc"])
def test_start_keeps_loop_responsive_and_rpc_order(monkeypatch, slow_at):
    slow, calls = SlowIO(), []
    set_id = uuid4()
    body = SessionStart(client_id=uuid4(), mode="learn")
    row = {"id": str(set_id), "published_revision": 1}
    card = {"id": str(uuid4()), "headword": "acquire", "gloss_vi": "tiếp thu"}

    def step(name):
        calls.append(name)
        if name == slow_at:
            slow()

    def get_set(_db, requested_set, user_id):
        assert (requested_set, user_id) == (str(set_id), "learner")
        step("get_set")
        return row

    def execute():
        step("execute")
        return SimpleNamespace(data=[])

    def revision(_db, requested_row):
        assert requested_row == row
        step("revision")
        return {"cards": [card]}

    def rpc(_db, name, payload):
        assert name == "fn_start_vocabulary_session"
        assert payload["p_user"] == "learner"
        assert payload["p_payload"] == body.model_dump(mode="json")
        step("rpc")
        return {"id": str(body.client_id), "set_id": str(set_id), "title": "Test set",
                "revision": 1, "mode": "learn", "items": payload["p_items"],
                "answers": [], "completed": False}

    monkeypatch.setattr(vocabulary_sets, "get_supabase_user", learner)
    monkeypatch.setattr(vocabulary_sets, "db", SimpleNamespace(table=lambda _name: Query(execute)))
    monkeypatch.setattr(vocabulary_sets.svc, "get_set", get_set)
    monkeypatch.setattr(vocabulary_sets.svc, "revision", revision)
    monkeypatch.setattr(vocabulary_sets.svc, "rpc", rpc)
    result = responsive(lambda: vocabulary_sets.start(set_id, body, "token"), slow)
    assert result.id == str(body.client_id) and not result.completed
    assert result.items[0].card is None
    assert calls == ["get_set", "execute", "revision", "rpc"]


@pytest.mark.parametrize("slow_at", ["gate", "flag", "get_today"])
def test_today_keeps_loop_responsive_including_gates(monkeypatch, slow_at):
    slow, calls = SlowIO(), []

    def step(name):
        calls.append(name)
        if name == slow_at:
            slow()

    def cohort(user_id):
        assert user_id == "learner"
        step("gate")
        return True

    def flag(key, *, default):
        assert default is False
        calls.append(key)
        if key == "vocab_unit_recommendations":
            step("flag")
        return True

    def today(user_id, *, include_recommendations):
        assert user_id == "learner" and include_recommendations is True
        step("get_today")
        return {"queue": [], "recommendations": []}

    monkeypatch.setattr(vocab_units, "get_supabase_user", learner)
    monkeypatch.setattr(vocab_units, "is_vocab_curated_enabled", cohort)
    monkeypatch.setattr(vocab_units.runtime_flags, "is_enabled", flag)
    monkeypatch.setattr(vocab_units.vocab_units, "get_today", today)
    result = responsive(lambda: vocab_units.get_my_vocab_today("token"), slow)
    assert result == {"queue": [], "recommendations": []}
    assert calls == ["gate", "vocab_units_read", "vocab_unit_recommendations", "flag", "get_today"]


def test_advanced_lesson_keeps_loop_responsive(monkeypatch):
    slow = SlowIO()
    bank_id, item_id = uuid4(), uuid4()

    def lesson(**kwargs):
        assert kwargs == {"user_id": "learner", "bank_id": str(bank_id), "item_id": str(item_id)}
        slow()
        return {"lesson_id": "ADV-T01"}

    monkeypatch.setattr(advanced_vocab, "get_supabase_user", learner)
    monkeypatch.setattr(advanced, "learner_lesson", lesson)
    result = responsive(lambda: advanced_vocab.lesson(bank_id, item_id, "token"), slow)
    assert result == {"lesson_id": "ADV-T01"}


def test_kp_roadmap_keeps_loop_responsive(monkeypatch):
    slow = SlowIO()

    def roadmap(user_id):
        assert user_id == "learner"
        slow()
        return {"mode": "static", "nodes": []}

    monkeypatch.setattr(kp, "get_supabase_user", learner)
    monkeypatch.setattr(kp.kp_roadmap, "build_roadmap", roadmap)
    assert responsive(lambda: kp.get_my_roadmap("token"), slow) == {"mode": "static", "nodes": []}


@pytest.mark.parametrize("slow_at", ["section", "claim", "save", "progress", "replay"])
def test_controlled_rewrite_keeps_loop_responsive_around_async_grading(monkeypatch, slow_at):
    slow, calls = SlowIO(), []
    loop_thread = threading.get_ident()
    answers = {f"rewrite-{i:02}": f"Answer {i}" for i in range(1, 21)}
    prompts = [{"item_id": key, "prompt": key} for key in answers]
    submission = {"answers": answers, "status": "completed", "feedback": None}

    def step(name):
        calls.append(name)
        if name == slow_at:
            slow()

    def section(*_args):
        step("section")

    def claim():
        step("claim")
        return SimpleNamespace(data={"should_grade": slow_at != "replay", "submission": submission})

    def save():
        step("save")
        return SimpleNamespace(data=[submission])

    def replay(_item_id):
        step("replay")
        return submission

    def progress(_item_id):
        step("progress")
        return {}

    async def grade(items, *, user_id):
        assert threading.get_ident() == loop_thread
        assert len(items) == 20 and user_id == "learner"
        calls.append("grade")
        await asyncio.sleep(0)
        return None, "test-model", None

    monkeypatch.setattr(advanced_vocab, "get_supabase_user", learner)
    monkeypatch.setattr(advanced, "_assigned_lesson", lambda **_kwargs: ({}, {}, {"lesson_id": "ADV-T01"}))
    monkeypatch.setattr(advanced, "_require_section", section)
    monkeypatch.setattr(advanced, "controlled_rewrite_parts", lambda _lesson: {"prompts": prompts, "solutions": []})
    monkeypatch.setattr(advanced, "_rewrite_submission", replay)
    monkeypatch.setattr(advanced, "_progress", progress)
    monkeypatch.setattr(advanced, "_admin", lambda: SimpleNamespace(
        rpc=lambda *_args: Query(claim), table=lambda _name: Query(save),
    ))
    monkeypatch.setattr(advanced_vocab_rewrite_grader, "grade_rewrites", grade)
    body = advanced_vocab.ControlledRewriteCompleteBody(bank_id="bank", item_id="item", answers=answers)
    result = responsive(lambda: advanced_vocab.complete_controlled_rewrite(body, "token"), slow)
    assert result.submission.answers == answers
    assert result.submission.status == "completed"
    assert calls == (["section", "claim", "replay", "progress"] if slow_at == "replay"
                     else ["section", "claim", "grade", "save", "progress"])
