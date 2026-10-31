"""PC-J114 — POST /instructor/assignments/fan-out input bounds (PC-J100 step c).

`FanOutBody` now matches the admin fan-out: 1–20 prompt ids (repeats dropped,
order kept), instructions ≤ 2000 chars, analysis_level 1–5. Out-of-range input
is refused with 422 BEFORE any DB call; before the fix analysis_level 0/6
reached the mig-104 CHECK and surfaced as a 500, and a repeated prompt id
inserted the same prompt twice per student.

Reuses the filtering fake from test_instructor_routes_isolation (read only).
"""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from tests.test_instructor_routes_isolation import B, CB, PB, SB, _FakeSB, _seed, _u

URL = "/instructor/assignments/fan-out"
HDR = {"Authorization": "Bearer x"}


class _CountingSB(_FakeSB):
    """Filtering fake that also records every table() access."""

    def __init__(self, store):
        super().__init__(store)
        self.calls: list[str] = []

    def table(self, name):
        self.calls.append(name)
        return super().table(name)


@contextlib.contextmanager
def _as_b(store):
    fake = _CountingSB(store)
    targets = [
        "routers.instructor.supabase_admin",
        "services.instructor_access.supabase_admin",
        "services.essay_service.supabase_admin",
        "services.instructor_workflow.supabase_admin",
    ]
    with contextlib.ExitStack() as es:
        es.enter_context(patch("routers.instructor.require_instructor",
                               new=AsyncMock(return_value={"id": B})))
        for t in targets:
            es.enter_context(patch(t, fake))
        from main import app
        yield TestClient(app), fake


def _store_with_prompts(n: int) -> tuple[dict, list[str]]:
    """Seed + `n` extra prompts owned by B (ids beyond the isolation seed)."""
    store = _seed()
    ids = [_u(1000 + i) for i in range(n)]
    store["writing_prompts"].extend(
        {"id": pid, "created_by": B, "title": f"P{i}", "task_type": "task2", "prompt_text": "x"}
        for i, pid in enumerate(ids)
    )
    return store, ids


@pytest.mark.parametrize("override", [
    pytest.param({"prompt_ids": []}, id="prompt_ids-empty"),
    pytest.param({"prompt_ids": [_u(1000 + i) for i in range(21)]}, id="prompt_ids-21"),
    pytest.param({"instructions": "x" * 2001}, id="instructions-2001"),
    pytest.param({"analysis_level": 0}, id="analysis_level-0"),
    pytest.param({"analysis_level": 6}, id="analysis_level-6"),
])
def test_out_of_bounds_body_is_422_before_any_db_call(override):
    store, _ids = _store_with_prompts(21)
    before = [dict(r) for r in store["writing_assignments"]]
    body = {"prompt_ids": [PB], "cohort_id": CB, **override}
    with _as_b(store) as (client, fake):
        r = client.post(URL, json=body, headers=HDR)
    assert r.status_code == 422, r.text
    assert fake.calls == []                              # refused before any read or write
    assert store["writing_assignments"] == before


def test_upper_bounds_are_accepted():
    store, _ids = _store_with_prompts(0)
    with _as_b(store) as (client, _fake):
        r = client.post(URL, json={"prompt_ids": [PB], "cohort_id": CB,
                                   "instructions": "x" * 2000, "analysis_level": 5},
                        headers=HDR)
    assert r.status_code == 201, r.text
    created = [a for a in store["writing_assignments"] if a.get("assignment_group_id") == r.json()["group_id"]]
    assert [(a["instructions"], a["analysis_level"]) for a in created] == [("x" * 2000, 5)]


def test_twenty_prompts_fan_out_one_row_each():
    store, ids = _store_with_prompts(20)
    with _as_b(store) as (client, _fake):
        r = client.post(URL, json={"prompt_ids": ids, "cohort_id": CB}, headers=HDR)
    assert r.status_code == 201, r.text
    assert r.json()["created_count"] == 20               # 1 student (SB) × 20 prompts
    created = [a for a in store["writing_assignments"] if a.get("assignment_group_id") == r.json()["group_id"]]
    assert [a["prompt_id"] for a in created] == ids
    assert {a["student_id"] for a in created} == {SB}


def test_repeated_prompt_ids_are_deduplicated_in_order():
    store, (p1, p2) = _store_with_prompts(2)
    with _as_b(store) as (client, _fake):
        r = client.post(URL, json={"prompt_ids": [p2, PB, p2, p1, PB], "cohort_id": CB},
                        headers=HDR)
    assert r.status_code == 201, r.text
    assert r.json()["created_count"] == 3                # not 5: one row per distinct prompt
    created = [a for a in store["writing_assignments"] if a.get("assignment_group_id") == r.json()["group_id"]]
    assert [a["prompt_id"] for a in created] == [p2, PB, p1]   # first-seen order kept


def test_unknown_fields_are_still_ignored():
    """No extra="forbid": an older client sending a stray field keeps working."""
    store, _ids = _store_with_prompts(0)
    with _as_b(store) as (client, _fake):
        r = client.post(URL, json={"prompt_ids": [PB], "cohort_id": CB, "legacy_flag": True},
                        headers=HDR)
    assert r.status_code == 201, r.text


# ── PC-J115: single-student assign (`AssignBody`) gets the same bounds ────────

ASSIGN_URL = "/instructor/assignments"


@pytest.mark.parametrize("override", [
    pytest.param({"instructions": "x" * 2001}, id="instructions-2001"),
    pytest.param({"analysis_level": 0}, id="analysis_level-0"),
    pytest.param({"analysis_level": 6}, id="analysis_level-6"),
])
def test_assign_out_of_bounds_body_is_422_before_any_db_call(override):
    store = _seed()
    before = [dict(r) for r in store["writing_assignments"]]
    body = {"prompt_id": PB, "student_id": SB, **override}
    with _as_b(store) as (client, fake):
        r = client.post(ASSIGN_URL, json=body, headers=HDR)
    assert r.status_code == 422, r.text
    assert fake.calls == []                              # refused before any read or write
    assert store["writing_assignments"] == before


@pytest.mark.parametrize("instructions,level", [
    pytest.param("x" * 2000, 5, id="upper"),
    pytest.param(None, 1, id="lower"),
])
def test_assign_boundary_values_are_accepted(instructions, level):
    store = _seed()
    with _as_b(store) as (client, _fake):
        r = client.post(ASSIGN_URL, json={"prompt_id": PB, "student_id": SB,
                                          "instructions": instructions, "analysis_level": level},
                        headers=HDR)
    assert r.status_code == 201, r.text
    assert (r.json()["instructions"], r.json()["analysis_level"]) == (instructions, level)
    created = [a for a in store["writing_assignments"] if a.get("id") == r.json()["id"]]
    assert [(a["instructions"], a["analysis_level"]) for a in created] == [(instructions, level)]


def test_assign_default_level_and_unknown_fields_still_accepted():
    """Default analysis_level stays 3; no extra="forbid" on AssignBody either."""
    store = _seed()
    with _as_b(store) as (client, _fake):
        r = client.post(ASSIGN_URL, json={"prompt_id": PB, "student_id": SB, "legacy_flag": True},
                        headers=HDR)
    assert r.status_code == 201, r.text
    assert r.json()["analysis_level"] == 3
