"""Only authored Grammar lessons may feed any public Grammar surface."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException
from starlette.requests import Request

from services import grammar_content as gc


def _write(root: Path, relative: str, metadata: dict | None, body="Lesson body.") -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    prefix = "---\n" + yaml.safe_dump(metadata, allow_unicode=True) + "---\n" if metadata is not None else ""
    path.write_text(prefix + body, encoding="utf-8")
    return path


def _metadata(slug="lesson", category="foundations", **fields):
    return {"slug": slug, "category": category, "title": "Bài học hợp lệ", "status": "complete", **fields}


@pytest.fixture
def content_root(tmp_path, monkeypatch):
    root = tmp_path / "content"
    root.mkdir()
    groups = root / "_groups.yaml"
    groups.write_text(yaml.safe_dump({"groups": [{
        "slug": "foundation", "title": "Foundation", "articles": [
            {"slug": "lesson", "category": "foundations"},
            {"slug": "tense", "category": "tenses"},
        ],
    }]}), encoding="utf-8")
    monkeypatch.setattr(gc, "CONTENT_DIR", root)
    monkeypatch.setattr(gc, "GROUPS_FILE", groups)
    return root


@pytest.mark.parametrize("relative,metadata,body", [
    ("foundations/unreviewed.md", None, "Operational prose without lesson metadata"),
    ("speaking_bank/internal.md", _metadata("internal"), "Admin import policy"),
    ("foundations/docs/internal.md", _metadata("internal"), "Nested operational notes"),
    ("foundations/_private/internal.md", _metadata("internal"), "Private notes"),
    ("foundations/readme.md", _metadata("readme"), "Operational readme with forged lesson metadata"),
    ("foundations/manifest.md", _metadata("manifest"), "Manifest"),
    ("foundations/lesson.md", _metadata(category="tenses"), "Wrong folder"),
    ("foundations/lesson.md", _metadata(slug="different"), "Wrong route identity"),
    ("foundations/lesson.md", _metadata(content_type="documentation"), "Internal doc type"),
    ("foundations/lesson.md", _metadata(content_type="reading_passage_l1"), "Reading passage"),
    ("foundations/lesson.md", _metadata(content_type="listening"), "Listening content"),
    ("foundations/lesson.md", _metadata(content_type="exam"), "Exam bank"),
    ("foundations/lesson.md", _metadata(status="approved"), "Unknown lifecycle state"),
    ("foundations/lesson.md", _metadata(status=None), "Missing explicit status"),
    ("foundations/lesson.md", _metadata(title=[]), "Non-string identity"),
    ("foundations/lesson.md", _metadata(title="   "), "Blank title"),
    ("foundations/lesson.md", _metadata(), ""),
])
def test_non_lessons_are_absent_from_all_shared_indexes(content_root, relative, metadata, body):
    _write(content_root, relative, metadata, body)
    service = gc.GrammarContentService()
    assert service.articles_by_slug == {}
    assert service.get_home_data()["total_articles"] == 0
    assert service.get_home_data()["categories"] == []
    assert service.search("operational") == []
    assert service.get_article("foundations", "lesson") is None
    assert service.get_article_by_slug("lesson") is None
    assert service.get_category("foundations") is None
    assert service.get_roadmap("foundations") is None
    assert service._resolve_related(["lesson", "readme", "internal", "manifest"]) == []
    assert service.get_compare("lesson-vs-internal") is None


@pytest.mark.parametrize("raw", ["---\n[one, two]\n---\nBody", "---\ntitle: Missing closing delimiter\nBody"])
def test_invalid_frontmatter_fails_closed(content_root, raw):
    path = content_root / "foundations/lesson.md"
    path.parent.mkdir()
    path.write_text(raw, encoding="utf-8")
    assert gc.GrammarContentService().articles_by_slug == {}


def test_symlink_cannot_publish_external_notes(content_root, tmp_path):
    external = _write(tmp_path, "external.md", _metadata("external"))
    folder = content_root / "foundations"
    folder.mkdir()
    (folder / "external.md").symlink_to(external)
    assert gc.GrammarContentService().articles_by_slug == {}


def test_duplicate_slug_is_not_silently_reassigned(content_root, caplog):
    _write(content_root, "foundations/lesson.md", _metadata())
    _write(content_root, "tenses/lesson.md", _metadata(category="tenses"))
    service = gc.GrammarContentService()
    assert service.get_article_by_slug("lesson") is None
    assert service.articles_by_category == {}
    assert "duplicate public slugs excluded: lesson" in caplog.text


@pytest.mark.parametrize("status", ["complete", "updating", "draft"])
def test_supported_editorial_states_are_preserved(content_root, status):
    _write(content_root, "foundations/lesson.md", _metadata(status=status))
    service = gc.GrammarContentService()
    assert service.get_article("foundations", "lesson")["status"] == status
    assert service.get_article_by_slug("lesson")["status"] == status


def test_category_manifest_can_register_future_lessons(content_root):
    manifest = yaml.safe_load(gc.GROUPS_FILE.read_text())
    manifest["groups"][0]["articles"].append({"slug": "new-lesson", "category": "new-category"})
    gc.GROUPS_FILE.write_text(yaml.safe_dump(manifest), encoding="utf-8")
    _write(content_root, "new-category/new-lesson.md", _metadata("new-lesson", "new-category"))
    assert gc.GrammarContentService().get_article("new-category", "new-lesson")


def test_invalid_category_manifest_fails_closed_with_operational_error(content_root, caplog):
    _write(content_root, "foundations/lesson.md", _metadata())
    gc.GROUPS_FILE.write_text("groups: invalid", encoding="utf-8")
    assert gc.GrammarContentService().articles_by_slug == {}
    assert "invalid groups manifest; no public categories" in caplog.text


@pytest.mark.parametrize("field,value", [
    ("order", []), ("order", {}), ("order", True), ("order", "1"),
    ("tags", "not-a-list"), ("tags", {"internal": "notes"}), ("tags", [42]),
    ("common_error_tags", [False]), ("pathways", "core"), ("prerequisites", {}),
    ("related_pages", "next"), ("band_relevance", [6.5]),
    ("level", {}), ("difficulty", []),
    ("speaking_relevance", True), ("writing_relevance", {}),
    ("last_updated", []), ("last_updated", {}),
])
def test_invalid_optional_wire_metadata_cannot_break_or_enter_shared_catalog(
    content_root, caplog, field, value,
):
    _write(content_root, "foundations/lesson.md", _metadata(**{field: value}))
    _write(content_root, "foundations/valid.md", _metadata("valid", order=2))
    service = gc.GrammarContentService()
    assert set(service.articles_by_slug) == {"valid"}
    assert service.get_article("foundations", "lesson") is None
    assert len(service.get_category("foundations")["articles"]) == 1
    assert len(service.search("lesson")) == 1
    assert "excluded invalid lesson" in caplog.text


@pytest.mark.parametrize("status", ["complete", "updating", "draft"])
def test_legitimate_date_and_missing_optional_fields_keep_the_public_contract(content_root, status):
    from models.grammar_content import GrammarSourceArticleDocument
    _write(content_root, "foundations/lesson.md", _metadata(
        status=status, last_updated=date(2026, 9, 30),
    ))
    service = gc.GrammarContentService()
    article = service.articles_by_slug["lesson"]
    validated = GrammarSourceArticleDocument.model_validate(article, strict=True)
    assert validated.status == status
    assert validated.last_updated == "2026-09-30"
    assert validated.order == 999
    assert validated.tags == []
    assert validated.level == ""


def test_valid_lesson_keeps_navigation_and_rejects_internal_reference(content_root):
    _write(content_root, "foundations/lesson.md", _metadata(
        related_pages=["next", "internal"], next_articles=["next", "internal"],
        common_error_tags=["agreement"], pathways=["core"], compare_with=["next", "internal"], prerequisites=["next", "internal"],
    ))
    _write(content_root, "foundations/next.md", _metadata("next"))
    _write(content_root, "speaking_bank/internal.md", _metadata("internal"))
    service = gc.GrammarContentService()
    article = service.get_article("foundations", "lesson")
    assert article and article["html"] == "<p>Lesson body.</p>"
    assert [row["slug"] for row in article["related_pages"]] == ["next"]
    assert [row["slug"] for row in article["next_articles"]] == ["next"]
    assert service.get_article("tenses", "lesson") is None
    assert len(service.get_articles_by_error_tag("agreement")) == 1
    assert len(service.get_articles_by_pathway("core")) == 1
    assert service.get_compare("lesson-vs-next")
    assert service.get_compare("lesson-vs-internal") is None
    assert "internal" not in json.dumps(article)
    assert "internal" not in json.dumps(service.get_compare("lesson-vs-next"))
    # Do not hide authoring drift from source audits while filtering public links.
    assert service.articles_by_slug["lesson"]["next_articles"] == ["next", "internal"]
    # The public sitemap derives article URLs exclusively from this home data.
    assert "internal" not in json.dumps(service.get_home_data())


@pytest.mark.asyncio
async def test_removed_document_detail_is_404_without_database_or_auth(monkeypatch):
    from routers import grammar
    request = Request({"type": "http", "method": "GET", "path": "/api/grammar/article/speaking_bank/README", "headers": []})
    service = gc.GrammarContentService()
    monkeypatch.setattr(grammar, "grammar_service", service)
    with pytest.raises(HTTPException) as error:
        await grammar.get_article("speaking_bank", "README", request)
    assert error.value.status_code == 404


def test_real_catalog_preserves_all_authored_lessons_and_references():
    service = gc.GrammarContentService()
    assert len(service.articles_by_slug) == 137
    assert "README" not in service.articles_by_slug
    assert "speaking_bank" not in service.articles_by_category
    for article in service.articles_by_slug.values():
        assert article["category"] in service.grammar_categories
        assert article["status"] == "complete"
        for field in ("related_pages", "next_articles", "compare_with", "prerequisites"):
            assert all(ref in service.articles_by_slug for ref in article[field])
