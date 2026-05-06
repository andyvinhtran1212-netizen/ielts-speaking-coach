"""Tests for /admin/writing/prompts/* — Phase 2.3a-1 prompts library.

Mirrors the test pattern from test_admin_writing.py:
  • TestClient on the real app (not Depends overrides).
  • Auth gate: a missing Authorization header returns 401 BEFORE
    Pydantic body validation runs.
  • Pydantic body validation: invalid task_type / difficulty /
    short prompt_text → 422.
  • Happy path: patch routers.admin_writing_prompts.require_admin
    with AsyncMock and routers.admin_writing_prompts.supabase_admin
    with a MagicMock chain so we don't touch the real DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_PROMPT_ID  = "00000000-0000-0000-0000-00000000bbbb"


def _valid_create_body() -> dict:
    return {
        "task_type":   "task2",
        "prompt_text": "Some people believe that climate change is the most pressing issue of our time. Discuss both views and give your opinion.",
        "title":       "Climate change priority",
        "difficulty":  "intermediate",
        "tags":        ["environment", "opinion"],
    }


# ── Auth gate ────────────────────────────────────────────────────────


def test_list_prompts_requires_auth_header():
    """Missing Authorization → 401 before any DB call."""
    r = _client().get("/admin/writing/prompts")
    assert r.status_code == 401


def test_create_prompt_requires_auth_header():
    r = _client().post("/admin/writing/prompts", json=_valid_create_body())
    assert r.status_code == 401


# ── Pydantic body validation ─────────────────────────────────────────


def test_create_prompt_rejects_invalid_task_type():
    body = _valid_create_body()
    body["task_type"] = "task3"
    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/prompts", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_prompt_rejects_short_prompt_text():
    """min_length=10 keeps placeholder strings out of the library."""
    body = _valid_create_body()
    body["prompt_text"] = "too short"
    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/prompts", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_prompt_rejects_invalid_difficulty():
    body = _valid_create_body()
    body["difficulty"] = "expert"  # not in {beginner, intermediate, advanced}
    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/prompts", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── Happy paths (DB stubbed) ─────────────────────────────────────────


def test_list_prompts_admin_returns_array():
    """Filter chain returns an array under {"prompts": [...]} key."""
    mock_db = MagicMock()
    chain = (mock_db.table.return_value
             .select.return_value
             .order.return_value
             .limit.return_value
             .eq.return_value
             .eq.return_value
             .eq.return_value)
    chain.execute.return_value = MagicMock(data=[
        {"id": _PROMPT_ID, "task_type": "task2",
         "title": "Sample", "is_active": True},
    ])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _client().get(
            "/admin/writing/prompts?task_type=task2&difficulty=intermediate",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    body = r.json()
    assert "prompts" in body
    assert isinstance(body["prompts"], list)
    assert body["prompts"][0]["title"] == "Sample"


def test_create_prompt_stamps_created_by_and_returns_201():
    """POST returns 201 + the inserted row, and `created_by` is
    auto-stamped to the calling admin's user id."""
    mock_db = MagicMock()
    insert_chain = mock_db.table.return_value.insert.return_value
    # Echo whatever payload was passed in so we can assert created_by
    # made it into the insert call.
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": _PROMPT_ID, **_valid_create_body(),
         "created_by": _ADMIN_USER["id"], "is_active": True},
    ])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/prompts",
            json=_valid_create_body(),
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    assert r.json()["title"] == "Climate change priority"
    assert r.json()["created_by"] == _ADMIN_USER["id"]

    # The handler must include `created_by` in the insert payload.
    insert_call_payload = mock_db.table.return_value.insert.call_args[0][0]
    assert insert_call_payload["created_by"] == _ADMIN_USER["id"]


def test_get_prompt_not_found_returns_404():
    """Empty rows from Supabase → 404 (not a silent empty body)."""
    mock_db = MagicMock()
    chain = (mock_db.table.return_value
             .select.return_value
             .eq.return_value
             .limit.return_value)
    chain.execute.return_value = MagicMock(data=[])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _client().get(
            f"/admin/writing/prompts/{_PROMPT_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 404


def test_patch_prompt_partial_update_only_writes_provided_fields():
    """PATCH with `{title: ...}` must only push `title` into the
    update payload, not the full Pydantic model with None defaults
    for the other columns (which would clobber existing data)."""
    mock_db = MagicMock()
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[
        {"id": _PROMPT_ID, "title": "New title", "is_active": True},
    ])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/prompts/{_PROMPT_ID}",
            json={"title": "New title"},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    assert r.json()["title"] == "New title"

    # The handler must call .update({"title": "New title"}) — NOT
    # {"title": ..., "task_type": None, "prompt_text": None, ...}.
    update_payload = mock_db.table.return_value.update.call_args[0][0]
    assert update_payload == {"title": "New title"}


def test_delete_soft_deletes_via_is_active_false():
    """DELETE flips is_active to false; row is NOT physically removed.

    Phase 2.3c-1 extends this to also clear `prompt_image_url` /
    `prompt_image_public_id` and clean up the Cloudinary asset
    when one exists. The orchestration is:

        1. SELECT prompt_image_public_id (404 if missing)
        2. UPDATE is_active=false + null both image columns
        3. (best-effort) Cloudinary delete by public_id

    For this test we use a text-only prompt (no image) so the
    Cloudinary path is exercised via the next test.
    """
    mock_db = MagicMock()
    # Step 1 — pre-read returns a row with no image.
    select_chain = (mock_db.table.return_value.select.return_value
                    .eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[
        {"prompt_image_public_id": None},
    ])
    # Step 2 — UPDATE returns the soft-deleted row.
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[
        {"id": _PROMPT_ID, "is_active": False},
    ])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db), \
         patch("routers.admin_writing_prompts.delete_prompt_image") as mock_del:
        r = _client().delete(
            f"/admin/writing/prompts/{_PROMPT_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    assert "deactivated" in r.json()["message"].lower()

    # Soft delete = update with the 3-key payload, NOT a hard delete().
    update_payload = mock_db.table.return_value.update.call_args[0][0]
    assert update_payload == {
        "is_active":              False,
        "prompt_image_url":       None,
        "prompt_image_public_id": None,
    }
    mock_db.table.return_value.delete.assert_not_called()
    # No public_id on the row → no Cloudinary delete.
    mock_del.assert_not_called()


def test_delete_also_cleans_up_cloudinary_when_image_exists():
    """Soft-delete on a prompt that has an image must call
    `delete_prompt_image(public_id)` so the Cloudinary asset isn't
    orphaned on the free tier (storage is the binding cost). The
    cleanup is best-effort — failure here doesn't block the
    soft-delete response."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value.select.return_value
                    .eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[
        {"prompt_image_public_id": "aver/writing/prompt_images/abc"},
    ])
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[
        {"id": _PROMPT_ID, "is_active": False},
    ])

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db), \
         patch("routers.admin_writing_prompts.delete_prompt_image") as mock_del:
        r = _client().delete(
            f"/admin/writing/prompts/{_PROMPT_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    mock_del.assert_called_once_with("aver/writing/prompt_images/abc")


# ── Phase 2.3c-1 — image upload + image-on-create ───────────────────


def test_upload_image_happy_path_returns_url_and_public_id():
    """Admin uploads a PNG, gets back the Cloudinary URL +
    public_id. The admin UI then passes both through the next
    create/PATCH so the row stores them."""
    fake_response = {
        "url":       "https://res.cloudinary.com/x/image/upload/test.png",
        "public_id": "aver/writing/prompt_images/abc",
        "width":     1024,
        "height":    768,
    }

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.upload_prompt_image",
                return_value=fake_response) as mock_upload:
        # PNG signature so the SDK call shape is realistic, even
        # though we mock at the service boundary.
        files = {"file": ("chart.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64,
                          "image/png")}
        r = _client().post(
            "/admin/writing/prompts/upload-image",
            files=files,
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    body = r.json()
    assert body["url"]       == fake_response["url"]
    assert body["public_id"] == fake_response["public_id"]
    assert body["width"]     == 1024
    # filename_hint forwarded so the service can log it.
    assert mock_upload.call_args.kwargs["filename_hint"] == "chart.png"


def test_upload_image_rejects_non_image_content_type():
    """text/plain → 400 BEFORE the upload service is touched."""
    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.upload_prompt_image") as mock_upload:
        files = {"file": ("notes.txt", b"hello", "text/plain")}
        r = _client().post(
            "/admin/writing/prompts/upload-image",
            files=files,
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 400
    mock_upload.assert_not_called()


def test_upload_image_requires_auth_header():
    """Missing Authorization → 401 before any upload-service call."""
    with patch("routers.admin_writing_prompts.upload_prompt_image") as mock_upload:
        files = {"file": ("chart.png", b"\x89PNG\r\n\x1a\n", "image/png")}
        r = _client().post("/admin/writing/prompts/upload-image", files=files)

    assert r.status_code == 401
    mock_upload.assert_not_called()


def test_create_prompt_persists_image_fields_when_provided():
    """POST /prompts with image_url + public_id sends both into the
    Supabase insert payload. Pinning this protects the data path
    from a future regression that drops the new fields from the
    Pydantic model_dump()."""
    mock_db = MagicMock()
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[{
        "id":        _PROMPT_ID,
        "task_type": "task1_academic",
        "title":     "Bar chart prompt",
        "prompt_image_url":       "https://cdn/x.png",
        "prompt_image_public_id": "aver/writing/prompt_images/x",
        "is_active": True,
    }])

    payload = {
        "task_type":              "task1_academic",
        "prompt_text":             "The chart shows the proportion of energy produced from various sources.",
        "title":                   "Bar chart prompt",
        "prompt_image_url":        "https://res.cloudinary.com/x/image/upload/x.png",
        "prompt_image_public_id":  "aver/writing/prompt_images/x",
    }

    with patch("routers.admin_writing_prompts.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_prompts.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/prompts",
            json=payload,
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201

    sent = mock_db.table.return_value.insert.call_args[0][0]
    assert sent["prompt_image_url"]       == payload["prompt_image_url"]
    assert sent["prompt_image_public_id"] == payload["prompt_image_public_id"]
    # Audit field still stamped from the auth context.
    assert sent["created_by"] == _ADMIN_USER["id"]
