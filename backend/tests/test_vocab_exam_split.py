"""Vocab exam/curated split — keeps AWL/TOEIC/THPT import vocab OUT of the
self-curated 'my vocab' surfaces (browse / flashcards / counts / search) and
serves it from a separate exam-prep area instead.

Provenance signal: a card with a non-empty `lists` (mig135) is EXAM vocab; an
empty `lists` is CURATED. Detail lookup + the KP full census still span both.

Run: pytest backend/tests/test_vocab_exam_split.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient

from services.vocab_content import VocabContentService, vocab_service


def _card(headword, slug, category, lists=None):
    return {
        "headword": headword, "slug": slug, "category": category,
        "level": "B2", "part_of_speech": "noun", "pronunciation": "/x/",
        "synonyms": [], "antonyms": [], "collocations": [], "related_words": [],
        "word_family": [], "gloss_vi": "g", "definition_en": "", "definition_vi": "",
        "example": "", "html": "", "syllables": "", "audio_headword": "",
        "audio_example": "", "register": "", "common_error": "", "memory_hook": "",
        "source": "", "lists": list(lists or []), "tested_in": [],
    }


def _svc_with(census):
    """Service loaded normally (so _lists.yaml manifest is present), then its
    indexes rebuilt from a controlled census."""
    svc = VocabContentService()
    svc.articles_by_slug = {}
    svc.articles_by_cat_slug = {}
    svc._all_articles = []
    svc._curated_articles = []
    svc._exam_articles = []
    svc.articles_by_category = {}
    svc.exam_by_list = {}
    svc.all_categories = []
    svc.headword_index = []
    svc._build_indexes(census)
    return svc


CENSUS = [
    _card("Alpha", "alpha", "technology"),                                   # curated
    _card("Xray",  "xray",  "economy",   ["awl-sublist-1"]),                 # exam / awl
    _card("Yankee", "yankee", "economy", ["toeic-core"]),                    # exam / toeic
    _card("Zulu",  "zulu",  "education", ["awl-sublist-2", "toeic-core"]),   # exam / multi-list
]


def test_is_exam_by_lists():
    assert VocabContentService._is_exam({"lists": ["awl-sublist-1"]}) is True
    assert VocabContentService._is_exam({"lists": []}) is False
    assert VocabContentService._is_exam({}) is False


def test_curated_surfaces_exclude_exam():
    svc = _svc_with(CENSUS)
    # Full census (KP contract) keeps everything.
    assert len(svc.get_all_articles()) == 4
    # Curated listing drops the 3 exam cards.
    curated = svc.get_curated_articles()
    assert [c["slug"] for c in curated] == ["alpha"]
    # Topic study stack: technology has the curated word; economy (exam-only) → [].
    assert [c["slug"] for c in svc.get_category_cards("technology")] == ["alpha"]
    assert svc.get_category_cards("economy") == []
    # Prefix search is curated-only.
    assert svc.search_prefix("alp")
    assert svc.search_prefix("xra") == []


def test_detail_still_resolves_exam_cards():
    """A learner following an exam-area link must still reach an exam card's detail."""
    svc = _svc_with(CENSUS)
    assert svc.get_article("economy", "xray") is not None
    assert svc.get_article("technology", "alpha") is not None


def test_exam_cards_grouped_by_each_list():
    svc = _svc_with(CENSUS)
    assert [c["slug"] for c in svc.get_exam_cards("awl-sublist-1")] == ["xray"]
    assert [c["slug"] for c in svc.get_exam_cards("awl-sublist-2")] == ["zulu"]
    # A multi-list card appears under BOTH its lists.
    assert sorted(c["slug"] for c in svc.get_exam_cards("toeic-core")) == ["yankee", "zulu"]
    # Unknown list slug → None (router 404s).
    assert svc.get_exam_cards("no-such-list") is None


def test_exam_families_ordered_with_counts():
    svc = _svc_with(CENSUS)
    fams = svc.get_exam_families()
    order = [f["family"] for f in fams]
    # awl before toeic before thpt.
    assert order.index("awl") < order.index("toeic") < order.index("thpt")
    by_slug = {l["slug"]: l["count"] for f in fams for l in f["lists"]}
    assert by_slug["awl-sublist-1"] == 1
    assert by_slug["awl-sublist-2"] == 1
    assert by_slug["toeic-core"] == 2      # yankee + zulu
    assert by_slug["thpt-core"] == 0       # listed even when empty


# ── Route-level (uses the markdown-loaded singleton: AWL Sublist 1 seed) ──────

def test_exam_endpoints():
    from main import app
    client = TestClient(app)

    fams = client.get("/api/vocabulary/exam")
    assert fams.status_code == 200, fams.text
    families = fams.json()
    assert any(f["family"] == "awl" for f in families)

    # The seed ships AWL Sublist 1 → the list resolves with cards.
    cards = client.get("/api/vocabulary/exam/awl-sublist-1/cards")
    assert cards.status_code == 200, cards.text
    body = cards.json()
    assert body["list"] == "awl-sublist-1"
    assert body["count"] == len(body["cards"]) >= 1

    assert client.get("/api/vocabulary/exam/__nope__/cards").status_code == 404


def test_curated_grid_route_excludes_exam_words():
    """A known AWL seed headword must not appear in the 'my vocab' categories grid,
    yet must be reachable via the exam area (singleton is markdown-loaded)."""
    exam_slugs = {c["slug"] for c in vocab_service._exam_articles}
    assert exam_slugs, "expected the AWL seed to load as exam cards"
    grid_slugs = {c["slug"] for cat in vocab_service.get_categories() for c in cat["articles"]}
    assert grid_slugs.isdisjoint(exam_slugs)
