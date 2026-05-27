"""Tests for the Sprint 19.1C content import pipeline.

  • services/content_import_service.py — parse + validate (pure, no DB)
  • POST /admin/writing/content/import — dry-run vs commit, auth, upsert

Mirrors test_admin_writing_tips.py: TestClient on the real app, auth +
supabase patched with AsyncMock / MagicMock so no real DB is touched.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import (
    FrontmatterError,
    build_db_payload,
    parse_markdown_with_frontmatter,
    slugify,
    validate_content,
)


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}

_TIP_MD = """---
content_type: tip
title: Paraphrase đề bài
task_type: task_2
published: true
---
Viết lại đề bằng **từ của em**.
"""

_SAMPLE_MD = """---
content_type: sample
title: Band 7.5 essay
task_type: task_2
target_band: 7.5
word_count: 268
prompt_id: 00000000-0000-0000-0000-000000000abc
---
Some people argue that…
"""

_OUTLINE_MD = """---
content_type: outline
title: Dàn bài Discussion
task_type: task_2
structure:
  - heading: Mở bài
    points:
      - Paraphrase
      - Thesis
  - heading: Kết bài
    points:
      - Tóm tắt
---
Áp dụng cho mọi đề discuss.
"""


# ── Parse ─────────────────────────────────────────────────────────────


def test_parse_tip_splits_frontmatter_and_body():
    p = parse_markdown_with_frontmatter(_TIP_MD)
    assert p.content_type == "tip"
    assert p.title == "Paraphrase đề bài"
    assert p.task_type == "task_2"
    assert p.published is True
    assert "từ của em" in p.body_markdown
    assert p.type_data == {}


def test_parse_sample_routes_type_keys_into_type_data():
    p = parse_markdown_with_frontmatter(_SAMPLE_MD)
    assert p.content_type == "sample"
    assert p.type_data["target_band"] == 7.5
    assert p.type_data["word_count"] == 268
    assert p.type_data["prompt_id"] == "00000000-0000-0000-0000-000000000abc"


def test_parse_outline_structure_into_type_data():
    p = parse_markdown_with_frontmatter(_OUTLINE_MD)
    assert p.content_type == "outline"
    assert isinstance(p.type_data["structure"], list)
    assert p.type_data["structure"][0]["heading"] == "Mở bài"


def test_parse_without_frontmatter_raises():
    try:
        parse_markdown_with_frontmatter("No frontmatter here.")
        assert False, "expected FrontmatterError"
    except FrontmatterError:
        pass


# ── Validate ──────────────────────────────────────────────────────────


def test_validate_clean_tip_has_no_errors():
    assert validate_content(parse_markdown_with_frontmatter(_TIP_MD)) == []


def test_validate_rejects_bad_content_type_and_task_type():
    md = _TIP_MD.replace("content_type: tip", "content_type: essay") \
                .replace("task_type: task_2", "task_type: task1_academic")
    fields = {e["field"] for e in validate_content(parse_markdown_with_frontmatter(md))}
    assert "content_type" in fields
    assert "task_type" in fields


def test_validate_sample_requires_band_and_word_count():
    md = """---
content_type: sample
title: Missing extras
task_type: task_2
---
Body.
"""
    fields = {e["field"] for e in validate_content(parse_markdown_with_frontmatter(md))}
    assert "target_band" in fields
    assert "word_count" in fields


def test_validate_outline_requires_structure():
    md = """---
content_type: outline
title: No structure
task_type: task_2
---
Body.
"""
    fields = {e["field"] for e in validate_content(parse_markdown_with_frontmatter(md))}
    assert "structure" in fields


def test_validate_rejects_bad_slug_format():
    md = _TIP_MD.replace("title: Paraphrase đề bài", "title: X\nslug: Bad Slug!")
    fields = {e["field"] for e in validate_content(parse_markdown_with_frontmatter(md))}
    assert "slug" in fields


def test_build_payload_carries_body_raw_and_type_data():
    p = parse_markdown_with_frontmatter(_SAMPLE_MD)
    payload = build_db_payload(p, slugify(p.title))
    assert payload["content_type"] == "sample"
    assert payload["body_markdown"].startswith("Some people argue")  # raw, unsanitized
    assert payload["type_data"]["word_count"] == 268
    assert payload["slug"] == "band-7-5-essay"  # '.' is a separator


# ── Endpoint: auth + dry-run + commit (DB stubbed) ────────────────────


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("content.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/writing/content/import" + qs, files=files, headers=headers or {})


def test_import_requires_auth():
    assert _upload(_TIP_MD).status_code == 401


def test_import_dry_run_does_not_touch_db():
    mock_db = MagicMock()
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _upload(_TIP_MD, "?dry_run=true", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["committed_id"] is None
    assert body["validation_errors"] == []
    assert body["parsed_data"]["content_type"] == "tip"
    mock_db.table.return_value.insert.assert_not_called()


def test_import_validation_error_blocks_commit():
    """A file with errors returns them and never writes, even at dry_run=false."""
    bad = _TIP_MD.replace("content_type: tip", "content_type: nope")
    mock_db = MagicMock()
    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _upload(bad, "?dry_run=false", _ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["committed_id"] is None
    assert any(e["field"] == "content_type" for e in r.json()["validation_errors"])
    mock_db.table.return_value.insert.assert_not_called()


def test_import_commit_new_slug_inserts():
    mock_db = MagicMock()
    # No existing row for this slug → insert path.
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[])
    ins = mock_db.table.return_value.insert.return_value
    ins.execute.return_value = MagicMock(data=[{"id": "new-id"}])

    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _upload(_TIP_MD, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    assert r.json()["action"] == "created"
    assert r.json()["committed_id"] == "new-id"
    sent = mock_db.table.return_value.insert.call_args[0][0]
    assert sent["created_by"] == _ADMIN_USER["id"]   # stamped on insert
    assert sent["content_type"] == "tip"


def test_import_commit_existing_slug_updates():
    mock_db = MagicMock()
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[{"id": "existing-id"}])
    upd = mock_db.table.return_value.update.return_value.eq.return_value
    upd.execute.return_value = MagicMock(data=[{"id": "existing-id"}])

    with patch("routers.admin_writing_tips.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_tips.supabase_admin", mock_db):
        r = _upload(_TIP_MD, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    assert r.json()["action"] == "updated"
    assert r.json()["committed_id"] == "existing-id"
    # Update path must NOT re-stamp created_by (preserve original author).
    upd_payload = mock_db.table.return_value.update.call_args[0][0]
    assert "created_by" not in upd_payload
