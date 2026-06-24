"""V-admin — vocab admin console CRUD (list / get / patch / delete).

Supabase mocked (no live DB). Covers: auth gate, list (filter+search+paginate),
get, patch (+ reload G1), delete (+ reload G1), edit-headword-keeps-slug, and the
schema-aware col-match (#538) — every VocabUpdate field is a real mig-110 column.
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ID = "11111111-1111-1111-1111-111111111111"
_ROW = {"id": _ID, "slug": "holistic", "headword": "Holistic", "category": "health",
        "gloss_vi": "Toàn diện", "audio_status": "pending"}


def _client():
    from main import app
    return TestClient(app)


def _chain(data, count=None):
    """A self-returning query mock whose .execute() yields data (+ optional count)."""
    q = MagicMock()
    for m in ("select", "eq", "ilike", "order", "range", "limit", "update", "delete", "in_"):
        getattr(q, m).return_value = q
    q.execute.return_value = MagicMock(data=data, count=count)
    return q


# ── auth ────────────────────────────────────────────────────────────────


def test_list_requires_auth():
    assert _client().get("/admin/vocabulary").status_code == 401


# ── list ────────────────────────────────────────────────────────────────


def test_list_returns_words_with_total():
    db = MagicMock(); db.table.return_value = _chain([_ROW], count=1)
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db):
        r = _client().get("/admin/vocabulary?category=health&q=hol&limit=10&offset=0", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["words"][0]["slug"] == "holistic"
    assert body["total"] == 1 and body["limit"] == 10
    # category filter + headword search both applied to the query
    q = db.table.return_value
    q.eq.assert_any_call("category", "health")
    q.ilike.assert_any_call("headword", "%hol%")


# ── get ─────────────────────────────────────────────────────────────────


def test_get_returns_full_row():
    db = MagicMock(); db.table.return_value = _chain([_ROW])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db):
        r = _client().get(f"/admin/vocabulary/{_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 200 and r.json()["id"] == _ID


def test_get_404_when_missing():
    db = MagicMock(); db.table.return_value = _chain([])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db):
        r = _client().get(f"/admin/vocabulary/{_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 404


# ── patch (+ reload G1) ──────────────────────────────────────────────────


def test_patch_updates_field_and_reloads():
    updated = dict(_ROW, gloss_vi="Tổng thể, toàn diện")
    db = MagicMock(); db.table.return_value = _chain([updated])
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _client().patch(f"/admin/vocabulary/{_ID}", json={"gloss_vi": "Tổng thể, toàn diện"}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    # only the sent field is written (partial update) ...
    sent = db.table.return_value.update.call_args[0][0]
    assert sent == {"gloss_vi": "Tổng thể, toàn diện"}
    assert "slug" not in sent and "headword" not in sent
    reload.assert_called_once()      # G1 — public grid reflects the edit


def test_patch_headword_does_not_touch_slug():
    db = MagicMock(); db.table.return_value = _chain([dict(_ROW, headword="Holistic!")])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", MagicMock()):
        r = _client().patch(f"/admin/vocabulary/{_ID}", json={"headword": "Holistic!"}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    sent = db.table.return_value.update.call_args[0][0]
    assert sent == {"headword": "Holistic!"}   # slug NOT regenerated (stable URL key)


def test_patch_empty_body_400():
    db = MagicMock(); db.table.return_value = _chain([_ROW])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", MagicMock()):
        r = _client().patch(f"/admin/vocabulary/{_ID}", json={}, headers=_ADMIN_AUTH)
    assert r.status_code == 400


# ── delete (+ reload G1) ─────────────────────────────────────────────────


def test_delete_removes_and_reloads():
    db = MagicMock(); db.table.return_value = _chain([_ROW])
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _client().delete(f"/admin/vocabulary/{_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 200 and r.json()["id"] == _ID
    db.table.return_value.delete.assert_called()
    reload.assert_called_once()


def test_delete_404_when_missing():
    db = MagicMock(); db.table.return_value = _chain([])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", MagicMock()):
        r = _client().delete(f"/admin/vocabulary/{_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 404


# ── schema-aware col-match (#538) ────────────────────────────────────────


def test_vocab_update_fields_are_all_real_columns():
    from routers.admin_vocab import VocabUpdate
    migdir = Path(__file__).parent.parent / "migrations"
    mig = (migdir / "110_vocab_cards.sql").read_text("utf-8")
    block = re.search(r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+vocab_cards\s*\((.*?)\n\);",
                      mig, re.IGNORECASE | re.DOTALL).group(1)
    cols = {m.group(1) for m in re.finditer(r'^\s*"?([a-z_]+)"?\s', block, re.MULTILINE)}
    # + additive ALTER TABLE … ADD COLUMN (e.g. 111 syllables)
    for p in sorted(migdir.glob("*.sql")):
        for m in re.finditer(r'ALTER\s+TABLE\s+vocab_cards\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z_]+)"?',
                             p.read_text("utf-8"), re.IGNORECASE):
            cols.add(m.group(1))
    fields = set(VocabUpdate.model_fields.keys())
    missing = fields - cols
    assert not missing, f"VocabUpdate writes columns vocab_cards lacks: {missing}"


# ── bulk-delete (V-admin topic management) ────────────────────────────────

_ID2 = "22222222-2222-2222-2222-222222222222"


def test_bulk_delete_requires_auth():
    assert _client().post("/admin/vocabulary/bulk-delete", json={"ids": [_ID]}).status_code == 401


def test_bulk_delete_removes_many_and_reloads_once():
    # both ids come back from the delete → deleted_count 2, nothing not_found.
    db = MagicMock(); db.table.return_value = _chain([{"id": _ID}, {"id": _ID2}])
    reload = MagicMock()
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", reload):
        r = _client().post("/admin/vocabulary/bulk-delete", json={"ids": [_ID, _ID2]}, headers=_ADMIN_AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted_count"] == 2
    assert body["not_found"] == []
    db.table.return_value.delete.assert_called_once()      # one query, not a loop
    db.table.return_value.in_.assert_called_once_with("id", [_ID, _ID2])
    reload.assert_called_once()                              # G1 — one reload for the batch


def test_bulk_delete_reports_not_found_without_500():
    # DB returns only one of the two requested → the other is not_found, no error.
    db = MagicMock(); db.table.return_value = _chain([{"id": _ID}])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", MagicMock()):
        r = _client().post("/admin/vocabulary/bulk-delete", json={"ids": [_ID, _ID2]}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["deleted_count"] == 1
    assert r.json()["not_found"] == [_ID2]


def test_bulk_delete_empty_ids_400():
    db = MagicMock(); db.table.return_value = _chain([])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.vocab_service.reload", MagicMock()):
        r = _client().post("/admin/vocabulary/bulk-delete", json={"ids": []}, headers=_ADMIN_AUTH)
    assert r.status_code == 400


def test_bulk_delete_rejects_non_uuid_422():
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/vocabulary/bulk-delete", json={"ids": ["not-a-uuid"]}, headers=_ADMIN_AUTH)
    assert r.status_code == 422
