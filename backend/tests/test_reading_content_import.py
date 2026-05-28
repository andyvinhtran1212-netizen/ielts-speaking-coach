"""Tests for the Sprint 20.1 reading content import (cluster 20.x).

  • services/content_import_service.py — L1 passage parse + validate +
    build (pure, no DB). Shares _split_frontmatter/slugify with writing.
  • POST /admin/reading/content/import — dry-run vs commit, auth, upsert
    into reading_passages (NOT writing_tips).

Mirrors test_content_import.py: TestClient on the real app, auth + supabase
patched with AsyncMock / MagicMock so no real DB is touched.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import (
    FrontmatterError,
    build_reading_passage_payload,
    parse_reading_passage,
    slugify,
    validate_reading_passage,
)


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}

_L1_MD = """---
content_type: reading_passage_l1
title: The Return of the Wolves
slug: return-of-the-wolves
difficulty_level: intermediate
topic_tags: [environment, animals]
estimated_minutes: 6
published: true
glossary:
  - term: apex predator
    definition: an animal at the top of a food chain
    example: Wolves are apex predators.
  - term: ecosystem
    definition: a community of interacting living things
---
When wolves were reintroduced to Yellowstone in 1995, the **ecosystem** changed.
"""


# ── Parse ─────────────────────────────────────────────────────────────


def test_parse_l1_splits_frontmatter_and_body():
    p = parse_reading_passage(_L1_MD)
    assert p.content_type == "reading_passage_l1"
    assert p.title == "The Return of the Wolves"
    assert p.slug == "return-of-the-wolves"
    assert p.difficulty_level == "intermediate"
    assert p.published is True
    assert "Yellowstone" in p.body_markdown


def test_parse_l1_coerces_tags_and_glossary():
    p = parse_reading_passage(_L1_MD)
    assert p.topic_tags == ["environment", "animals"]
    assert isinstance(p.glossary, list) and len(p.glossary) == 2
    assert p.glossary[0]["term"] == "apex predator"
    assert p.estimated_minutes == 6


def test_parse_l1_without_frontmatter_raises():
    try:
        parse_reading_passage("Just a passage, no frontmatter.")
        assert False, "expected FrontmatterError"
    except FrontmatterError:
        pass


# ── Validate ──────────────────────────────────────────────────────────


def test_validate_clean_l1_has_no_errors():
    assert validate_reading_passage(parse_reading_passage(_L1_MD)) == []


def test_validate_rejects_bad_content_type():
    md = _L1_MD.replace("content_type: reading_passage_l1", "content_type: tip")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "content_type" in fields


def test_validate_rejects_bad_difficulty_level():
    md = _L1_MD.replace("difficulty_level: intermediate", "difficulty_level: expert")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "difficulty_level" in fields


def test_validate_rejects_bad_slug_format():
    md = _L1_MD.replace("slug: return-of-the-wolves", "slug: Bad Slug!")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "slug" in fields


def test_validate_rejects_glossary_item_missing_definition():
    md = _L1_MD.replace(
        "  - term: ecosystem\n    definition: a community of interacting living things",
        "  - term: ecosystem",
    )
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "glossary" in fields


def test_validate_rejects_non_list_glossary():
    md = _L1_MD.split("glossary:")[0] + "glossary: not-a-list\n---\nBody here.\n"
    p = parse_reading_passage(md)
    assert p.glossary == []  # coerced for build-safety
    fields = {e["field"] for e in validate_reading_passage(p)}
    assert "glossary" in fields  # but flagged via raw_frontmatter


def test_validate_rejects_non_url_image():
    md = _L1_MD.replace("published: true", "published: true\nimage_url: not-a-url")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "image_url" in fields


def test_validate_empty_body_rejected():
    md = _L1_MD.rsplit("---", 1)[0] + "---\n   \n"
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "body_markdown" in fields


# ── Build payload ─────────────────────────────────────────────────────


def test_build_payload_maps_to_reading_passages_row():
    p = parse_reading_passage(_L1_MD)
    payload = build_reading_passage_payload(p, p.slug)
    assert payload["library"] == "l1_vocab"
    assert payload["status"] == "published"           # published: true → status
    assert payload["slug"] == "return-of-the-wolves"
    assert payload["difficulty_level"] == "intermediate"
    assert payload["topic_tags"] == ["environment", "animals"]
    assert isinstance(payload["glossary"], list) and len(payload["glossary"]) == 2
    assert payload["body_markdown"].startswith("When wolves")  # raw, unsanitized
    assert "created_by" not in payload                # router stamps on insert only


def test_build_payload_draft_when_unpublished():
    md = _L1_MD.replace("published: true", "published: false")
    p = parse_reading_passage(md)
    assert build_reading_passage_payload(p, p.slug)["status"] == "draft"


def test_slugify_shared_with_writing():
    # Same slugify the writing import uses (Vietnamese-aware, no dep).
    assert slugify("The Return of the Wolves") == "the-return-of-the-wolves"


# ── Endpoint: auth + dry-run + commit (DB stubbed) ────────────────────


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("passage.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/reading/content/import" + qs, files=files, headers=headers or {})


def test_import_requires_auth():
    assert _upload(_L1_MD).status_code == 401


def test_import_dry_run_does_not_touch_db():
    mock_db = MagicMock()
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L1_MD, "?dry_run=true", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["committed_id"] is None
    assert body["validation_errors"] == []
    assert body["parsed_data"]["library"] == "l1_vocab"
    mock_db.table.return_value.insert.assert_not_called()


def test_import_validation_error_blocks_commit():
    bad = _L1_MD.replace("content_type: reading_passage_l1", "content_type: nope")
    mock_db = MagicMock()
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(bad, "?dry_run=false", _ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["committed_id"] is None
    assert any(e["field"] == "content_type" for e in r.json()["validation_errors"])
    mock_db.table.return_value.insert.assert_not_called()


def test_import_commit_new_slug_inserts_into_reading_passages():
    mock_db = MagicMock()
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[])           # no existing slug → insert
    ins = mock_db.table.return_value.insert.return_value
    ins.execute.return_value = MagicMock(data=[{"id": "new-id"}])

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L1_MD, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    assert r.json()["action"] == "created"
    assert r.json()["committed_id"] == "new-id"
    # Upserts into reading_passages (+ reading_questions, Sprint 20.2), NEVER
    # writing_tips (table-separation watch-item).
    table_names = {c.args[0] for c in mock_db.table.call_args_list}
    assert "reading_passages" in table_names
    assert "writing_tips" not in table_names
    sent = mock_db.table.return_value.insert.call_args[0][0]
    # _L1_MD has no questions block, so the only insert is the passage row.
    assert sent["created_by"] == _ADMIN_USER["id"]
    assert sent["library"] == "l1_vocab"


def test_import_commit_existing_slug_updates_without_restamping_author():
    mock_db = MagicMock()
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[{"id": "existing-id"}])
    upd = mock_db.table.return_value.update.return_value.eq.return_value
    upd.execute.return_value = MagicMock(data=[{"id": "existing-id"}])

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L1_MD, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    assert r.json()["action"] == "updated"
    assert r.json()["committed_id"] == "existing-id"
    upd_payload = mock_db.table.return_value.update.call_args[0][0]
    assert "created_by" not in upd_payload
