"""Tests for Sprint 13.4 — admin CRUD endpoints on listening_tests.

Pins:
  * GET /admin/listening/tests — list + status filter + search + audio_ready
  * GET /admin/listening/tests/{id} — detail bundles sections + content_ids
  * PATCH /admin/listening/tests/{id} — metadata allow-list
  * PATCH /admin/listening/tests/{id}/status — transitions
  * DELETE /admin/listening/tests/{id} — soft-archive cascade to sections
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router


# ── Fake Supabase client with the surface this router uses ───────────────────


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    """Mimics Supabase python client chains: select/insert/update/delete/eq/
    in_/ilike/order/range/limit/execute. State is per-query; commits land
    on the parent fake's tables.
    """

    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._mode = "select"
        self._payload: dict | None = None
        self._filters_eq: list[tuple[str, object]] = []
        self._filters_in: list[tuple[str, list]] = []
        self._filters_ilike: list[tuple[str, str]] = []
        self._range: tuple[int, int] | None = None
        self._order: str | None = None
        self._desc: bool = False

    def select(self, *_a, **kw):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, col, val):
        self._filters_eq.append((col, val))
        return self

    def in_(self, col, vals):
        self._filters_in.append((col, list(vals)))
        return self

    def ilike(self, col, pattern):
        self._filters_ilike.append((col, pattern))
        return self

    def order(self, col, desc=False):
        self._order = col
        self._desc = desc
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def limit(self, *_a, **_kw):
        return self

    def _match(self, row: dict) -> bool:
        for col, val in self._filters_eq:
            if row.get(col) != val:
                return False
        for col, vals in self._filters_in:
            if row.get(col) not in vals:
                return False
        for col, pattern in self._filters_ilike:
            pat = pattern.replace("%", "").lower()
            val = str(row.get(col) or "").lower()
            if pat not in val:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.name, [])
        if self._mode == "insert":
            payloads = (
                self._payload if isinstance(self._payload, list) else [self._payload]
            )
            for p in payloads:
                rows.append(dict(p))
            return _Resp(payloads)
        if self._mode == "update":
            matched = [r for r in rows if self._match(r)]
            for r in matched:
                r.update(self._payload or {})
            return _Resp(matched)
        if self._mode == "delete":
            keep = [r for r in rows if not self._match(r)]
            removed = [r for r in rows if self._match(r)]
            self.fake.tables[self.name] = keep
            return _Resp(removed)
        # select
        matched = [r for r in rows if self._match(r)]
        if self._order:
            matched.sort(
                key=lambda r: r.get(self._order) or "",
                reverse=self._desc,
            )
        count = len(matched)
        if self._range:
            start, end = self._range
            matched = matched[start:end + 1]
        return _Resp(matched, count=count)


class _FakeAdmin:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "listening_tests":    [],
            "listening_content":  [],
            "listening_exercises": [],
        }

    def table(self, name):
        return _Query(self, name)


def _patch(monkeypatch):
    fake = _FakeAdmin()
    monkeypatch.setattr(listening_router, "supabase_admin", fake)

    async def _fake_admin(_authz):
        return {"id": "admin-1", "email": "admin@example.com"}
    monkeypatch.setattr(listening_router, "require_admin", _fake_admin)
    return fake, "Bearer fake-admin"


def _run(coro):
    return asyncio.run(coro)


def _seed_test(fake: _FakeAdmin, **overrides) -> dict:
    row = {
        "id":              str(uuid4()),
        "test_id":         "ILR-LIS-001",
        "title":           "Cambridge Pilot 01",
        "version":         "1.0",
        "band_target":     5.5,
        "accent_profile":  ["BrE"],
        "themes":          {"s1": "Cookery"},
        "status":          "draft",
        "created_at":      "2026-05-20T00:00:00Z",
    }
    row.update(overrides)
    fake.tables["listening_tests"].append(row)
    return row


def _seed_section(fake: _FakeAdmin, test_id: str, section_num: int,
                  audio_path: str | None = None) -> dict:
    row = {
        "id":                 str(uuid4()),
        "test_id":            test_id,
        "section_num":        section_num,
        "title":              f"Section {section_num}",
        "status":             "draft",
        "audio_storage_path": audio_path,
        "transcript":         "stub",
    }
    fake.tables["listening_content"].append(row)
    return row


# ── GET /tests list ─────────────────────────────────────────────────────────


def test_list_tests_with_status_filter_and_audio_count(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t1 = _seed_test(fake, test_id="ILR-LIS-001", status="draft")
    t2 = _seed_test(fake, test_id="ILR-LIS-002", status="published")

    # Test 1 has 2/4 sections with audio; Test 2 has 4/4.
    _seed_section(fake, t1["id"], 1, audio_path="cam01/s1.mp3")
    _seed_section(fake, t1["id"], 2, audio_path="cam01/s2.mp3")
    _seed_section(fake, t1["id"], 3, audio_path=None)
    _seed_section(fake, t1["id"], 4, audio_path=None)
    for n in range(1, 5):
        _seed_section(fake, t2["id"], n, audio_path=f"cam02/s{n}.mp3")

    out_all = _run(listening_router.admin_list_listening_tests(
        status="all", search="", limit=20, offset=0, authorization=authz,
    ))
    assert out_all["total"] == 2
    by_test = {r["test_id"]: r for r in out_all["items"]}
    assert by_test["ILR-LIS-001"]["audio_ready_count"] == 2
    assert by_test["ILR-LIS-001"]["section_count"] == 4
    assert by_test["ILR-LIS-002"]["audio_ready_count"] == 4

    out_published = _run(listening_router.admin_list_listening_tests(
        status="published", search="", limit=20, offset=0, authorization=authz,
    ))
    assert [r["test_id"] for r in out_published["items"]] == ["ILR-LIS-002"]


# ── GET /tests/{id} detail ─────────────────────────────────────────────────


def test_get_test_detail_bundles_sections_and_content_ids(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)
    s1 = _seed_section(fake, t["id"], 1, audio_path="cam/s1.mp3")
    s2 = _seed_section(fake, t["id"], 2, audio_path=None)
    fake.tables["listening_exercises"].extend([
        {"id": str(uuid4()), "content_id": s1["id"]},
        {"id": str(uuid4()), "content_id": s1["id"]},
        {"id": str(uuid4()), "content_id": s2["id"]},
    ])

    out = _run(listening_router.admin_get_listening_test(
        test_id=t["id"], authorization=authz,
    ))
    assert out["id"] == t["id"]
    assert len(out["sections"]) == 2
    assert out["content_ids"] == [s1["id"], s2["id"]]
    section_one = next(s for s in out["sections"] if s["section_num"] == 1)
    assert section_one["audio_ready"] is True
    assert section_one["exercise_count"] == 2


def test_get_test_detail_404_on_unknown(monkeypatch):
    _, authz = _patch(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_get_listening_test(
            test_id="missing", authorization=authz,
        ))
    assert excinfo.value.status_code == 404


# ── PATCH /tests/{id} metadata ─────────────────────────────────────────────


def test_patch_test_metadata_partial_update(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)

    body = listening_router.ListeningTestPatchRequest(
        title="Updated title",
        band_target=6.5,
        accent_profile=["BrE", "AmE"],
    )
    out = _run(listening_router.admin_patch_listening_test(
        test_id=t["id"], body=body, authorization=authz,
    ))
    assert out["title"] == "Updated title"
    assert out["band_target"] == 6.5
    assert out["accent_profile"] == ["BrE", "AmE"]
    # Unchanged fields preserved.
    assert out["version"] == "1.0"


def test_patch_test_metadata_rejects_duplicate_test_id(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t1 = _seed_test(fake, test_id="ILR-LIS-001")
    _seed_test(fake, test_id="ILR-LIS-002")

    body = listening_router.ListeningTestPatchRequest(test_id="ILR-LIS-002")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_listening_test(
            test_id=t1["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422
    assert "đã tồn tại" in str(excinfo.value.detail)


def test_patch_test_metadata_rejects_bad_band(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)
    body = listening_router.ListeningTestPatchRequest(band_target=10.0)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_listening_test(
            test_id=t["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


# ── PATCH /tests/{id}/status ────────────────────────────────────────────────


def test_patch_test_status_transitions(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake, status="draft")
    body = listening_router.ListeningTestStatusPatchRequest(status="published")

    out = _run(listening_router.admin_patch_listening_test_status(
        test_id=t["id"], body=body, authorization=authz,
    ))
    assert out["status"] == "published"
    # State persisted on the fake.
    assert fake.tables["listening_tests"][0]["status"] == "published"


def test_patch_test_status_rejects_unknown_value(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake)
    body = listening_router.ListeningTestStatusPatchRequest(status="garbage")
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_patch_listening_test_status(
            test_id=t["id"], body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422


# ── DELETE /tests/{id} soft archive ────────────────────────────────────────


def test_delete_test_archives_test_and_sections(monkeypatch):
    fake, authz = _patch(monkeypatch)
    t = _seed_test(fake, status="published")
    _seed_section(fake, t["id"], 1, audio_path="a.mp3")
    _seed_section(fake, t["id"], 2, audio_path="b.mp3")

    out = _run(listening_router.admin_delete_listening_test(
        test_id=t["id"], authorization=authz,
    ))
    assert out["status"] == "archived"
    # Parent + every section row flipped.
    assert fake.tables["listening_tests"][0]["status"] == "archived"
    for s in fake.tables["listening_content"]:
        assert s["status"] == "archived"


def test_delete_test_404_on_unknown(monkeypatch):
    _, authz = _patch(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_delete_listening_test(
            test_id="missing", authorization=authz,
        ))
    assert excinfo.value.status_code == 404
