from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _load_module(rel_path: str, name: str):
    path = ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_audit_mapping_coverage_excludes_reading_content():
    audit = _load_module("backend/scripts/audit_mapping_coverage.py", "audit_mapping_coverage")
    articles = audit.collect_articles()
    slugs = {a["slug"] for a in articles}

    assert "return-of-the-wolves" not in slugs
    assert "a-short-history-of-tea" not in slugs
    assert "skim-climate-change-coral-reefs" not in slugs
    # 107 prior + 4 word-formation articles (parts-of-speech, 2026-07-05:
    # noun/adjective suffixes, verbs-and-adverbs, determiners-overview). Reading
    # content stays excluded — guarded by the negative asserts above; this count
    # is the tripwire, bump it when grammar articles land.
    assert len(articles) == 131, f"Expected grammar-only denominator of 131, got {len(articles)}"


def test_verify_anchor_drift_declared_anchor_inventory_excludes_reading():
    drift = _load_module("backend/scripts/verify_anchor_drift.py", "verify_anchor_drift")
    declared = drift.collect_declared_anchors()

    assert not any(path.startswith("backend/content/reading/") for path in declared.values())


def test_draft_articles_promoted_to_complete():
    grammar_content = _load_module("backend/services/grammar_content.py", "grammar_content")
    service = grammar_content.grammar_service

    for slug in (
        "grammatical-collocations",
        "discourse-markers-spoken",
        "pronunciation-grammar-link",
    ):
        article = service.articles_by_slug.get(slug)
        assert article is not None, f"Missing promoted article {slug!r}"
        assert article.get("status") == "complete", (
            f"Expected {slug!r} to be complete after Sprint 21.3, got {article.get('status')!r}"
        )
