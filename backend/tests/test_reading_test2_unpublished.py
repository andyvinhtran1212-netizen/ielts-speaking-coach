"""Team content plan 2026-10-27 B3/P1 — Reading Test 2 (AVR-READ-002) is unpublished.

The seed is a functional Phase B renderer sample, not learner-grade content.
It stays in the repo as an importer/renderer fixture but must ship with
``published: false`` so an import writes ``status='draft'``. These tests lock:

  * the seed itself stays unpublished (a casual flip back fails CI);
  * the import plan maps it to ``draft`` for the test row AND every passage;
  * with only a draft row in the DB, the learner list omits it (200) and the
    detail / boot / start / resume routes answer 404 — never 500.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import build_reading_test_payloads, parse_reading_test


_SEED = Path(__file__).parent.parent / "content" / "reading" / "l3-academic-reading-test-2.md"
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _plan() -> dict:
    return build_reading_test_payloads(parse_reading_test(_SEED.read_text(encoding="utf-8")))


# ── Seed + import plan ────────────────────────────────────────────────


def test_avr_read_002_seed_ships_unpublished():
    parsed = parse_reading_test(_SEED.read_text(encoding="utf-8"))
    assert parsed.test_id == "AVR-READ-002"
    assert parsed.published is False


def test_avr_read_002_import_plan_writes_draft_for_test_and_passages():
    plan = _plan()
    assert plan["test_row"]["status"] == "draft"
    assert len(plan["passage_rows"]) == 3
    assert {row["status"] for row in plan["passage_rows"]} == {"draft"}


# ── Learner routes against a draft-only row ───────────────────────────


class _Query:
    """Minimal PostgREST-style builder that really applies eq filters, so the
    assertion is about the rows a route can see, not about a call chain."""

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filters: list[tuple[str, object]] = []
        self._count = False

    def select(self, _cols, count=None):
        self._count = count == "exact"
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        data = [r for r in self._rows if all(r.get(c) == v for c, v in self._filters)]
        return type("Res", (), {"data": data, "count": len(data) if self._count else None})()


class _DB:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name):
        if name not in self._tables:
            raise AssertionError(f"unexpected table read: {name}")
        return _Query(self._tables[name])

    def rpc(self, name, _params):
        raise AssertionError(f"draft test must 404 before policy RPC {name}")


def _draft_db() -> _DB:
    test_row = {**_plan()["test_row"], "id": "avr-002-uuid", "test_type": "full",
                "is_public": True, "exam_only": False, "metadata": {},
                "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}
    published_peer = {**test_row, "id": "avr-001-uuid", "test_id": "AVR-READ-001",
                      "title": "Academic Reading — Test 1", "status": "published"}
    rows = [test_row, published_peer]
    return _DB({"reading_tests": rows, "reading_public_practice_catalog": rows})


def test_learner_list_omits_unpublished_test_2():
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", _draft_db()):
        r = _client().get("/api/reading/test", headers=_AUTH)

    assert r.status_code == 200, r.text
    ids = [item["test_id"] for item in r.json()["items"]]
    assert ids == ["AVR-READ-001"]
    assert r.json()["total"] == 1


def test_learner_direct_routes_404_for_unpublished_test_2():
    calls = [
        ("get", "/api/reading/test/AVR-READ-002"),
        ("get", "/api/reading/test/AVR-READ-002/boot"),
        ("post", "/api/reading/test/AVR-READ-002/attempts"),
        ("get", "/api/reading/test/AVR-READ-002/attempts/in-progress"),
        ("post", "/api/reading/test/AVR-READ-002/unlock"),
    ]
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", _draft_db()):
        client = _client()
        for method, path in calls:
            kwargs = {"headers": _AUTH}
            if path.endswith("/unlock"):
                kwargs["json"] = {}
            r = getattr(client, method)(path, **kwargs)
            assert r.status_code == 404, (path, r.status_code, r.text)
