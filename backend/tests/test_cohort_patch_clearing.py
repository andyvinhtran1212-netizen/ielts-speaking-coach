"""PATCH /admin/cohorts/{id} — xoá trường tuỳ chọn phải THẬT SỰ xoá (GĐ 1a).

Codex review on the GĐ 1a branch: the handler wrote `code_prefix` and
`description` only when they were not None, so sending an explicit `null` was
dropped. Because the same request also carries `name`, the UPDATE still
succeeded and the endpoint returned 200 — the admin cleared a field, was told it
saved, and watched the old value come back on reload. A silent no-op, which is
the failure mode this project's rules single out.

The bug was latent while the old form sent only changed fields; the GĐ 1 class
edit form sends all four on every save, which made it reachable.

`name` is deliberately NOT clearable — a class must have one — so it keeps the
is-not-None test, and that asymmetry is pinned here too.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import cohorts as mod


COHORT = "aaaaaaaa-0000-0000-0000-000000000001"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Recorder:
    def __init__(self, store):
        self.store = store

    def select(self, *_a, **_kw): return self
    def limit(self, *_a): return self
    def eq(self, *_a): return self

    def update(self, payload):
        self.store["payload"] = payload
        return self

    def execute(self):
        return _Resp([{"id": COHORT}])


async def _patch(body) -> dict:
    store: dict = {}
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})), \
         patch.object(mod, "supabase_admin") as db:
        db.table.side_effect = lambda _n: _Recorder(store)
        await mod.update_cohort(COHORT, body, None)
    return store["payload"]


@pytest.mark.asyncio
async def test_explicit_null_clears_the_code_prefix():
    payload = await _patch(mod.CohortPatchRequest(name="C2-K12", code_prefix=None))
    assert "code_prefix" in payload, (
        "an explicit null was dropped — the save reports success and the old "
        "prefix reappears on reload"
    )
    assert payload["code_prefix"] is None


@pytest.mark.asyncio
async def test_explicit_null_clears_the_description():
    payload = await _patch(mod.CohortPatchRequest(name="C2-K12", description=None))
    assert "description" in payload and payload["description"] is None


@pytest.mark.asyncio
async def test_explicit_null_still_unassigns_the_course():
    payload = await _patch(mod.CohortPatchRequest(name="C2-K12", course_id=None))
    assert "course_id" in payload and payload["course_id"] is None


@pytest.mark.asyncio
async def test_omitted_fields_are_left_alone():
    """Clearing must be opt-in: a request that never mentions a field must not
    wipe it. This is the flip side of the fix and the thing it could break."""
    payload = await _patch(mod.CohortPatchRequest(name="Chỉ đổi tên"))
    assert payload["name"] == "Chỉ đổi tên"
    for field in ("code_prefix", "description", "course_id"):
        assert field not in payload, f"{field} was written despite not being sent"


@pytest.mark.asyncio
async def test_values_are_written_through_unchanged():
    payload = await _patch(mod.CohortPatchRequest(
        name="C2-K12", code_prefix="C2K12", description="Sáng T3/T5",
        course_id="cccccccc-0000-0000-0000-000000000003",
    ))
    assert payload["code_prefix"] == "C2K12"
    assert payload["description"] == "Sáng T3/T5"
    assert payload["course_id"] == "cccccccc-0000-0000-0000-000000000003"


@pytest.mark.asyncio
async def test_an_entirely_empty_patch_is_still_rejected():
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})):
        with pytest.raises(Exception) as exc:
            await mod.update_cohort(COHORT, mod.CohortPatchRequest(), None)
    assert "400" in str(exc.value) or "Không có trường nào" in str(exc.value)


@pytest.mark.asyncio
async def test_name_is_not_clearable():
    """A class must have a name, so `name: null` is a no-op rather than a wipe —
    and with nothing else in the body that leaves the patch empty (400)."""
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin"})):
        with pytest.raises(Exception) as exc:
            await mod.update_cohort(COHORT, mod.CohortPatchRequest(name=None), None)
    assert "400" in str(exc.value) or "Không có trường nào" in str(exc.value)
