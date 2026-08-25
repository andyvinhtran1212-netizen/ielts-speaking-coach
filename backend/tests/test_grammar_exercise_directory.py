from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grammar


def test_exercise_directory_enriches_bank_from_article_truth(monkeypatch):
    article = grammar.grammar_service.get_article_by_slug("present-perfect")
    assert article is not None
    monkeypatch.setattr(grammar, "_published_grammar_banks", lambda: [{
        "id": "bank-1",
        "code": "G-tenses-present-perfect",
        "title": "Present Perfect",
        "words_count": 12,
        "topic_id": None,
    }])
    payload = asyncio.run(grammar.list_exercises())
    bank = payload["banks"][0]
    assert bank["slug"] == "present-perfect"
    assert bank["category"] == "tenses"
    assert bank["level"] == article["level"]
    assert bank["summary"] == article["summary"]


def test_exercise_directory_keeps_unmatched_bank_visible(monkeypatch):
    monkeypatch.setattr(grammar, "_published_grammar_banks", lambda: [{
        "id": "legacy-bank", "code": "G-legacy-unknown", "title": "Legacy",
    }])
    bank = asyncio.run(grammar.list_exercises())["banks"][0]
    assert bank["id"] == "legacy-bank"
    assert bank["slug"] is None
    assert bank["category"] is None
