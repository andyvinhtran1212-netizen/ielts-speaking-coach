"""Public keyword search is accent-insensitive with unchanged ranking/display."""
from __future__ import annotations

import unicodedata

import pytest

from services import grammar_content as gc


@pytest.mark.parametrize("query,expected", [
    ("câu điều kiện", "cau dieu kien"),
    ("ĐỘNG TỪ", "dong tu"),
    (unicodedata.normalize("NFD", "câu điều kiện"), "cau dieu kien"),
    ("  câu\tđiều\n  kiện  ", "cau dieu kien"),
    ("Present SIMPLE", "present simple"),
])
def test_unicode_and_whitespace_fold_consistently(query, expected):
    assert gc._normalise_search(query) == expected


@pytest.mark.parametrize("variants", [
    ["câu điều kiện", "cau dieu kien", "CÂU ĐIỀU KIỆN", unicodedata.normalize("NFD", "câu điều kiện"), " câu  điều\tkiện "],
    ["động từ", "dong tu", "ĐỘNG TỪ", unicodedata.normalize("NFD", "động từ")],
    ["present simple", "Present Simple", " present\tsimple "],
])
def test_real_corpus_variants_return_identical_ranked_payloads(variants):
    service = gc.GrammarContentService()
    expected = service.search(variants[0])
    assert expected
    for query in variants[1:]:
        assert service.search(query) == expected
    for result in expected:
        original = service.articles_by_slug[result["slug"]]
        assert result["title"] == original["title"]
        assert result["summary"] == original["summary"]


def test_field_weights_apply_to_folded_corpus_and_keep_original_text(tmp_path, monkeypatch):
    monkeypatch.setattr(gc, "CONTENT_DIR", tmp_path)
    folder = tmp_path / "foundations"
    folder.mkdir()
    for slug, extra, body in [
        ("title", "title: Câu điều kiện\n", "Unrelated body"),
        ("summary", "title: Summary\nsummary: Câu điều kiện\n", "Unrelated body"),
        ("tags", "title: Tags\ntags: [câu điều kiện]\n", "Unrelated body"),
        ("body", "title: Body\n", "Câu điều kiện"),
    ]:
        (folder / f"{slug}.md").write_text(
            f"---\nslug: {slug}\ncategory: foundations\nstatus: complete\n{extra}---\n{body}", encoding="utf-8")
    service = gc.GrammarContentService()
    results = service.search("cau dieu kien")
    assert [row["slug"] for row in results] == ["title", "summary", "tags", "body"]
    assert results == service.search("CÂU ĐIỀU KIỆN")
    assert results[0]["title"] == "Câu điều kiện"
    body_index = next(row for row in service.search_index if row["slug"] == "body")
    # Recommendation matchers still receive their original accented body text.
    assert "câu điều kiện" in body_index["text"]


@pytest.mark.parametrize("query", ["", "   ", "a", "á", "\u0301", "unfindable-sentinel-grammar-query"])
def test_empty_short_and_no_match_queries_remain_empty(query):
    assert gc.grammar_service.search(query) == []
