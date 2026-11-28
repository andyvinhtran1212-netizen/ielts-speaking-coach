"""MOCKORG-0086 plan 5.5 compatibility layer (G09-T31 PR1).

Before migration 446 the database holds only ``sequential``/``retake``; after
it, only ``live``/``self_paced``. The backend must read both, accept both from
the admin API, keep writing the legacy name until 446, and keep answering the
legacy name on ``exam_mode`` with the new one on ``exam_mode_v2``.
"""
from __future__ import annotations

import asyncio

import pytest

from routers import admin_mock_exams as admin_router
from services import mock_exam_service as svc


@pytest.mark.parametrize("stored, retake", [
    ("retake", True), ("self_paced", True),
    ("sequential", False), ("live", False), (None, False),
])
def test_is_retake_reads_both_names(stored, retake):
    assert svc.is_retake({"exam_mode": stored}) is retake


@pytest.mark.parametrize("stored, legacy, new", [
    ("sequential", "sequential", "live"),
    ("live", "sequential", "live"),
    ("retake", "retake", "self_paced"),
    ("self_paced", "retake", "self_paced"),
])
def test_admin_list_row_answers_legacy_and_new_names(stored, legacy, new):
    row = admin_router.AdminMockExamListRow.model_validate({
        "id": "e1", "code": "C", "title": "T", "status": "published",
        "exam_mode": stored, "is_open": False, "active_section": "not_started",
        "created_at": "2026-11-23T00:00:00Z", "review_eligible": False,
    }).model_dump()
    assert row["exam_mode"] == legacy
    assert row["exam_mode_v2"] == new


@pytest.fixture
def admin(monkeypatch):
    async def fake_require_admin(_auth):
        return {"id": "admin-1"}
    monkeypatch.setattr(admin_router, "require_admin", fake_require_admin)


@pytest.mark.parametrize("sent, stored", [
    ("live", "sequential"), ("self_paced", "retake"),
    ("sequential", "sequential"), ("retake", "retake"),
])
def test_create_accepts_both_names_and_stores_the_legacy_one(admin, monkeypatch, sent, stored):
    seen = {}
    monkeypatch.setattr(svc, "admin_create_exam",
                        lambda payload, actor: seen.update(payload) or {"id": "e1"})
    body = admin_router.ExamCreate(code="C1", title="T", exam_mode=sent)
    asyncio.run(admin_router.create_exam(body, authorization="Bearer x"))
    assert seen["exam_mode"] == stored


def test_create_default_mode_is_live_stored_as_sequential(admin, monkeypatch):
    seen = {}
    monkeypatch.setattr(svc, "admin_create_exam",
                        lambda payload, actor: seen.update(payload) or {"id": "e1"})
    asyncio.run(admin_router.create_exam(admin_router.ExamCreate(code="C1", title="T"),
                                         authorization="Bearer x"))
    assert seen["exam_mode"] == "sequential"


@pytest.mark.parametrize("bad", ["", "open", "SELF_PACED", "self-paced"])
def test_create_rejects_unknown_mode_names(bad):
    with pytest.raises(ValueError):
        admin_router.ExamCreate(code="C1", title="T", exam_mode=bad)


def test_patch_maps_new_name_before_the_service(admin, monkeypatch):
    seen = {}

    async def fake_write(_exam_id, fn, exam_id, patch, actor):
        seen.update(patch)
        return {"id": exam_id}
    monkeypatch.setattr(admin_router, "_assignment_write", fake_write)
    asyncio.run(admin_router.update_exam(
        "e1", admin_router.ExamPatch(exam_mode="self_paced"), authorization="Bearer x"))
    assert seen == {"exam_mode": "retake"}


class _Rpc:
    def __init__(self, calls):
        self.calls = calls

    def rpc(self, name, params):
        self.calls.append((name, params))
        return self

    def execute(self):
        class R:
            data = {"id": "e1", "exam_mode": "retake"}
        return R()


def test_update_same_mode_under_new_name_is_not_a_mode_change(monkeypatch):
    calls = []
    monkeypatch.setattr(svc, "get_published_exam_by_id",
                        lambda _id: {"id": "e1", "exam_mode": "retake", "status": "draft"})
    monkeypatch.setattr(svc, "supabase_admin", _Rpc(calls))
    out = svc.admin_update_exam("e1", {"exam_mode": "self_paced"})
    assert calls == []
    assert out["exam_mode"] == "retake"


def test_mode_change_rpc_gets_the_legacy_name(monkeypatch):
    calls = []
    monkeypatch.setattr(svc, "get_published_exam_by_id",
                        lambda _id: {"id": "e1", "exam_mode": "sequential", "status": "draft"})
    monkeypatch.setattr(svc, "supabase_admin", _Rpc(calls))
    svc.admin_update_exam("e1", {"exam_mode": "self_paced"})
    assert calls == [("fn_set_exam_mode", {"p_exam_id": "e1", "p_mode": "retake"})]


class _Select:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def execute(self):
        class R:
            pass
        r = R()
        r.data = self.rows
        return r


@pytest.mark.parametrize("stored, legacy, new", [
    ("sequential", "sequential", "live"), ("live", "sequential", "live"),
    ("retake", "retake", "self_paced"), ("self_paced", "retake", "self_paced"),
])
def test_learner_exam_list_answers_legacy_and_new_names(monkeypatch, stored, legacy, new):
    """PR2: after 446 stores the new name, the full-test entry page still reads
    ``exam_mode == 'retake'`` for a self-paced exam."""
    monkeypatch.setattr(svc, "supabase_admin", _Select([{
        "id": "e1", "code": "C", "title": "T", "exam_mode": stored, "is_open": True,
        "active_section": "listening", "cohort_id": None}]))
    monkeypatch.setattr(svc, "_retake_assigned_exam_ids", lambda _u: {"e1"})
    monkeypatch.setattr(svc, "live_sitting_for_user", lambda _u: None)
    [row] = svc.list_open_exams("u1")
    assert (row["exam_mode"], row["exam_mode_v2"]) == (legacy, new)


@pytest.mark.parametrize("stored, legacy, new", [
    ("live", "sequential", "live"), ("self_paced", "retake", "self_paced"),
])
def test_admin_write_responses_answer_both_names(admin, monkeypatch, stored, legacy, new):
    async def fake_write(_exam_id, fn, exam_id, patch, actor):
        return {"id": exam_id, "exam_mode": stored}
    monkeypatch.setattr(admin_router, "_assignment_write", fake_write)
    monkeypatch.setattr(svc, "admin_create_exam", lambda payload, actor: {"id": "e1", "exam_mode": stored})
    monkeypatch.setattr(svc, "set_open", lambda exam_id, is_open, actor: {"id": exam_id, "exam_mode": stored})
    outs = [
        asyncio.run(admin_router.update_exam("e1", admin_router.ExamPatch(title="T2"),
                                             authorization="Bearer x")),
        asyncio.run(admin_router.create_exam(admin_router.ExamCreate(code="C1", title="T"),
                                             authorization="Bearer x")),
        asyncio.run(admin_router.set_open("e1", admin_router.OpenBody(is_open=True),
                                          authorization="Bearer x")),
    ]
    for out in outs:
        assert (out["exam_mode"], out["exam_mode_v2"]) == (legacy, new)
