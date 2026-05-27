"""Tests for the Sprint 19.1B writing tips library.

Covers both halves of the feature:
  • Admin CRUD  — /admin/writing/tips/*   (routers/admin_writing_tips.py)
  • Student read — /api/writing/tips[/{slug}] (routers/writing_student.py)

Mirrors the test pattern from test_admin_writing_prompts.py:
  • TestClient on the real app.
  • Auth gate: missing Authorization → 401 before any DB call.
  • Pydantic body validation → 422.
  • Happy paths patch require_admin / get_supabase_user (AsyncMock) and
    supabase_admin (MagicMock chain) so we never touch a real DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_USER_AUTH  = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER       = {"id": "00000000-0000-0000-0000-00000000cccc", "email": "student@x"}
_TIP_ID     = "00000000-0000-0000-0000-00000000bbbb"


def _valid_create_body() -> dict:
    return {
        "title":         "Cách viết mở bài Task 2",
        "body_markdown": "# Mở bài\n\nParaphrase đề bài rồi nêu **luận điểm**.",
        "task_type":     "task_2",
        "category":      "structure",
        "published":     True,
        "display_order": 1,
    }


# ── slugify (Vietnamese-aware, no external dep) ───────────────────────


def test_slugify_handles_vietnamese_diacritics():
    from routers.admin_writing_tips import _slugify
    assert _slugify("Cách viết mở bài Task 2") == "cach-viet-mo-bai-task-2"
    assert _slugify("Sửa lỗi đại từ") == "sua-loi-dai-tu"          # đ → d
    assert _slugify("   ") == "tip"                                  # all-blank fallback
    assert _slugify("!!!###") == "tip"                              # all-punctuation fallback


# ── Admin: auth gate ──────────────────────────────────────────────────


def test_admin_list_tips_requires_auth():
    assert _client().get("/admin/writing/tips").status_code == 401


def test_admin_create_tip_requires_auth():
    assert _client().post("/admin/writing/tips", json=_valid_create_body()).status_code == 401


# ── Admin: Pydantic validation ────────────────────────────────────────


def test_admin_create_rejects_invalid_task_type():
    body = _valid_create_body(); body["task_type"] = "task1_academic"  # tips enum is task_1/task_2/both
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/tips", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_admin_create_rejects_empty_body():
    body = _valid_create_body(); body["body_markdown"] = ""
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/tips", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── Admin: happy paths (DB stubbed) ───────────────────────────────────


def test_admin_list_returns_tips_array():
    mock_db = MagicMock()
    chain = (mock_db.table.return_value.select.return_value
             .order.return_value.order.return_value.limit.return_value)
    chain.execute.return_value = MagicMock(data=[
        {"id": _TIP_ID, "title": "T", "task_type": "task_2", "published": True},
    ])
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _client().get("/admin/writing/tips", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert isinstance(r.json()["tips"], list)
    assert r.json()["tips"][0]["title"] == "T"


def test_admin_create_auto_slugs_and_stamps_created_by():
    mock_db = MagicMock()
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": _TIP_ID, **_valid_create_body(),
         "slug": "cach-viet-mo-bai-task-2", "created_by": _ADMIN_USER["id"]},
    ])
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _client().post("/admin/writing/tips", json=_valid_create_body(), headers=_ADMIN_AUTH)
    assert r.status_code == 201
    sent = mock_db.table.return_value.insert.call_args[0][0]
    # Slug auto-generated from the title; created_by stamped from auth.
    assert sent["slug"] == "cach-viet-mo-bai-task-2"
    assert sent["created_by"] == _ADMIN_USER["id"]


def test_admin_create_slug_collision_returns_409():
    mock_db = MagicMock()
    mock_db.table.return_value.insert.return_value.execute.side_effect = Exception(
        'duplicate key value violates unique constraint "writing_tips_slug_key" (23505)'
    )
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _client().post("/admin/writing/tips", json=_valid_create_body(), headers=_ADMIN_AUTH)
    assert r.status_code == 409


def test_admin_patch_published_false_is_not_dropped_as_unset():
    """published=False / display_order=0 are valid values, not 'unset' —
    they must reach the update payload (regression guard for the
    exclude_unset filter)."""
    mock_db = MagicMock()
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[{"id": _TIP_ID, "published": False}])
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _client().patch(f"/admin/writing/tips/{_TIP_ID}",
                            json={"published": False}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    payload = mock_db.table.return_value.update.call_args[0][0]
    assert payload == {"published": False}


def test_admin_delete_is_hard_delete():
    mock_db = MagicMock()
    del_chain = mock_db.table.return_value.delete.return_value.eq.return_value
    del_chain.execute.return_value = MagicMock(data=[{"id": _TIP_ID}])
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _client().delete(f"/admin/writing/tips/{_TIP_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    mock_db.table.return_value.delete.assert_called_once()


# ── Student: published-only reads ─────────────────────────────────────


def test_user_list_tips_requires_auth():
    assert _client().get("/api/writing/tips").status_code == 401


def test_user_list_tips_filters_published_true():
    mock_db = MagicMock()
    chain = (mock_db.table.return_value.select.return_value
             .eq.return_value.order.return_value.order.return_value.limit.return_value)
    chain.execute.return_value = MagicMock(data=[
        {"id": _TIP_ID, "title": "Tip", "task_type": "both", "body_markdown": "x"},
    ])
    with patch("routers.writing_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.writing_student.supabase_admin", mock_db):
        r = _client().get("/api/writing/tips", headers=_USER_AUTH)
    assert r.status_code == 200
    assert r.json()["tips"][0]["title"] == "Tip"
    # The published gate is applied as .eq("published", True).
    eq_call = mock_db.table.return_value.select.return_value.eq
    assert eq_call.call_args[0] == ("published", True)


def test_user_get_tip_by_slug_404_when_missing():
    mock_db = MagicMock()
    chain = (mock_db.table.return_value.select.return_value
             .eq.return_value.eq.return_value.limit.return_value)
    chain.execute.return_value = MagicMock(data=[])
    with patch("routers.writing_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.writing_student.supabase_admin", mock_db):
        r = _client().get("/api/writing/tips/nonexistent-slug", headers=_USER_AUTH)
    assert r.status_code == 404
