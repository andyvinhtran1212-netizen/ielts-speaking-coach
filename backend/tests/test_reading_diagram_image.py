"""Sprint 20.14f-α — diagram / flow-chart image upload tests.

Covers:
  * services/reading_image.py — pure-function validation + storage path
  * routers/admin_reading.py — upload + delete endpoints, variant guard
  * routers/reading_student.py — _stamp_diagram_image_urls signs URLs
    for diagram/flow questions with a stored path

The Supabase storage client is mocked (no real bucket calls). The
admin auth path is mocked the same way the other admin_reading tests
patch it (see test_reading_l3.py for the pattern).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from services.reading_image import (
    InvalidImageError,
    MAX_BYTES,
    MIN_BYTES,
    detect_format,
    upload_diagram_image,
)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}


def _client() -> TestClient:
    from main import app
    return TestClient(app)


# ── Magic-byte sniff ─────────────────────────────────────────────────


def test_detect_format_png():
    assert detect_format(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8) == "png"


def test_detect_format_jpg():
    assert detect_format(b"\xff\xd8\xff" + b"\x00" * 12) == "jpg"


def test_detect_format_webp():
    # RIFF + 4 length bytes + WEBP marker at offset 8.
    assert detect_format(b"RIFF\x10\x00\x00\x00WEBP" + b"\x00" * 8) == "webp"


def test_detect_format_gif_rejected():
    # GIF magic — not in the accept set, should return None.
    assert detect_format(b"GIF89a" + b"\x00" * 12) is None


def test_detect_format_bmp_rejected():
    assert detect_format(b"BM" + b"\x00" * 14) is None


def test_detect_format_too_short_rejected():
    assert detect_format(b"\x89PNG") is None
    assert detect_format(b"") is None
    assert detect_format(None) is None


# ── upload_diagram_image — validation (no storage call) ──────────────


def test_upload_rejects_too_small():
    fake_supabase = MagicMock()
    with pytest.raises(InvalidImageError) as e:
        upload_diagram_image(
            contents=b"x" * 50,
            question_id="q1",
            test_id="t1",
            supabase=fake_supabase,
        )
    assert e.value.http_status == 400
    fake_supabase.storage.from_.assert_not_called()


def test_upload_rejects_too_large():
    fake_supabase = MagicMock()
    with pytest.raises(InvalidImageError) as e:
        upload_diagram_image(
            contents=b"\x89PNG\r\n\x1a\n" + b"x" * (MAX_BYTES + 1),
            question_id="q1",
            test_id="t1",
            supabase=fake_supabase,
        )
    assert e.value.http_status == 413
    fake_supabase.storage.from_.assert_not_called()


def test_upload_rejects_unsupported_format():
    fake_supabase = MagicMock()
    # 200 bytes of GIF — fails the magic-byte sniff.
    with pytest.raises(InvalidImageError) as e:
        upload_diagram_image(
            contents=b"GIF89a" + b"x" * 200,
            question_id="q1",
            test_id="t1",
            supabase=fake_supabase,
        )
    assert e.value.http_status == 415
    fake_supabase.storage.from_.assert_not_called()


# ── upload_diagram_image — happy path (storage call mocked) ──────────


def test_upload_png_returns_metadata_bundle(monkeypatch):
    monkeypatch.setenv("READING_IMAGES_BUCKET", "test-bucket")
    fake_supabase = MagicMock()
    fake_supabase.storage.from_.return_value.upload.return_value = {"ok": True}

    png_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 200
    meta = upload_diagram_image(
        contents=png_bytes,
        question_id="q-uuid-1",
        test_id="t-uuid-1",
        supabase=fake_supabase,
        uploaded_by="admin-uuid",
    )

    # Storage path follows the documented format:
    # tests/<test_uuid>/diagrams/<q_uuid>-manual-<timestamp>.<ext>
    assert meta["image_storage_path"].startswith("tests/t-uuid-1/diagrams/q-uuid-1-manual-")
    assert meta["image_storage_path"].endswith(".png")
    assert meta["image_size_bytes"] == len(png_bytes)
    assert meta["image_format"] == "png"
    assert meta["image_source"] == "manual_upload"
    assert meta["image_uploaded_by"] == "admin-uuid"
    assert "image_uploaded_at" in meta

    # The upload call used the bucket from config + a PNG content-type.
    fake_supabase.storage.from_.return_value.upload.assert_called_once()
    args, _kwargs = fake_supabase.storage.from_.return_value.upload.call_args
    assert args[1] == png_bytes
    assert args[2]["content-type"] == "image/png"


def test_upload_jpg_content_type_is_image_jpeg(monkeypatch):
    fake_supabase = MagicMock()
    fake_supabase.storage.from_.return_value.upload.return_value = {"ok": True}
    jpg_bytes = b"\xff\xd8\xff" + b"x" * 200
    meta = upload_diagram_image(
        contents=jpg_bytes,
        question_id="q1",
        test_id="t1",
        supabase=fake_supabase,
    )
    assert meta["image_format"] == "jpg"
    args, _ = fake_supabase.storage.from_.return_value.upload.call_args
    # The "jpg" extension maps to "image/jpeg" content-type (mirrors
    # the listening upload path).
    assert args[2]["content-type"] == "image/jpeg"


# ── Admin endpoint variant guard ─────────────────────────────────────


def _mock_supabase_query_for_question(question_type: str, q_id: str = "q-uuid-1",
                                       passage_id: str = "p-uuid-1"):
    """Build a chainable Supabase select() mock that returns one row
    with the given question_type. Mirrors the pattern in test_reading_l3
    so the admin endpoint's `_fetch_question_or_404` lookup sees a row."""
    def _builder():
        q_query = MagicMock()
        q_query.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{
                "id": q_id,
                "q_num": 38,
                "question_type": question_type,
                "payload": {},
                "passage_id": passage_id,
            }]
        )
        p_query = MagicMock()
        p_query.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{"test_id": "t-uuid-1"}]
        )
        update_query = MagicMock()
        update_query.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        return q_query, p_query, update_query
    return _builder


def test_admin_upload_endpoint_rejects_wrong_question_type():
    """variant guard: only diagram_label_completion / flow_chart_completion
    can take an image. mcq_single → 422."""
    q_query, p_query, _ = _mock_supabase_query_for_question("mcq_single")()
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        # The endpoint hits supabase_admin.table("reading_questions")
        # only — the variant guard fires before any storage call.
        supa.table.return_value = q_query
        resp = _client().post(
            "/admin/reading/questions/q-uuid-1/upload-diagram-image",
            headers=_ADMIN_AUTH,
            files={"image_file": ("d.png", b"\x89PNG\r\n\x1a\n" + b"x" * 200, "image/png")},
        )
    assert resp.status_code == 422
    assert "diagram_label_completion" in resp.text


def test_admin_upload_endpoint_404_on_missing_question():
    """No row found → 404 before any storage call."""
    q_query = MagicMock()
    q_query.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.return_value = q_query
        resp = _client().post(
            "/admin/reading/questions/missing-uuid/upload-diagram-image",
            headers=_ADMIN_AUTH,
            files={"image_file": ("d.png", b"\x89PNG\r\n\x1a\n" + b"x" * 200, "image/png")},
        )
    assert resp.status_code == 404


def test_admin_upload_endpoint_415_on_unsupported_format():
    """GIF input → 415 even though variant + question exist."""
    q_query = MagicMock()
    q_query.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{
            "id": "q-uuid-1", "q_num": 38,
            "question_type": "diagram_label_completion",
            "payload": {}, "passage_id": "p-uuid-1",
        }]
    )
    p_query = MagicMock()
    p_query.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"test_id": "t-uuid-1"}]
    )
    def table_router(name):
        if name == "reading_questions":
            return q_query
        if name == "reading_passages":
            return p_query
        return MagicMock()
    with patch("routers.admin_reading.require_admin") as req_admin, \
         patch("routers.admin_reading.supabase_admin") as supa:
        async def _ok(_): return _ADMIN_USER
        req_admin.side_effect = _ok
        supa.table.side_effect = table_router
        supa.storage.from_.return_value.upload.return_value = {"ok": True}
        resp = _client().post(
            "/admin/reading/questions/q-uuid-1/upload-diagram-image",
            headers=_ADMIN_AUTH,
            files={"image_file": ("d.gif", b"GIF89a" + b"x" * 200, "image/gif")},
        )
    assert resp.status_code == 415


# ── reading_student _stamp_diagram_image_urls ────────────────────────


def test_stamp_diagram_image_urls_signs_when_path_present():
    from routers.reading_student import _stamp_diagram_image_urls
    questions = [
        {
            "q_num": 38, "question_type": "diagram_label_completion",
            "payload": {"template": {"image_storage_path": "tests/t1/diagrams/q1.png"}},
        },
        # Non-diagram type — must not be touched.
        {
            "q_num": 1, "question_type": "mcq_single",
            "payload": {"template": {"image_storage_path": "shouldnt-fire.png"}},
        },
        # diagram WITHOUT storage_path — no image_url surfaces.
        {
            "q_num": 39, "question_type": "flow_chart_completion",
            "payload": {"template": {}},
        },
    ]
    with patch("routers.reading_student.supabase_admin") as supa:
        supa.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://signed.example/q38.png?token=abc",
        }
        _stamp_diagram_image_urls(questions)

    assert questions[0]["payload"]["image_url"] == "https://signed.example/q38.png?token=abc"
    # mcq_single must be untouched even if it happened to have a path.
    assert "image_url" not in questions[1]["payload"]
    # flow_chart without storage_path → no image_url.
    assert "image_url" not in questions[2]["payload"]
