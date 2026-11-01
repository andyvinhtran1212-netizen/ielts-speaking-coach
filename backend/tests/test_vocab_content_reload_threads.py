"""
PC-J449 — VocabContentService.reload() must be copy-on-write.

Since PR #2096, GET /api/me/kp-mastery runs in a worker thread and reads the
shared vocab index through kp_registry.label_for (vocab_service.articles_by_slug),
while an admin vocab write reloads that index on the event loop. A reload that
empties the published index and then rebuilds it lets such a reader see an
empty or half-built dict (headword falls back to the slug). These tests pin that
a reader only ever sees the complete old index or the complete new one, and that
a failed reload keeps the old index.

Run: pytest backend/tests/test_vocab_content_reload_threads.py -v
"""

import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import kp_registry
from services.vocab_content import VocabContentService

STAMP = datetime(2026, 10, 30, tzinfo=timezone.utc)


def _article(headword: str, slug: str, category: str) -> dict:
    return {
        "headword": headword, "slug": slug, "category": category,
        "level": "B2", "part_of_speech": "adj", "pronunciation": "",
        "related_words": [], "collocations": [], "lists": [], "source": "",
    }


CENSUS = [
    _article("Abundant", "abundant", "environment"),
    _article("Gridlock", "gridlock", "technology"),
    _article("Curriculum", "curriculum", "education"),
]
SLUGS = [a["slug"] for a in CENSUS]


def _load_census(self) -> None:
    """Stand-in for _load_all (no DB): build the indexes from CENSUS."""
    self._source = "db"
    self.last_modified = STAMP
    self._build_indexes(CENSUS)


@pytest.fixture()
def svc(monkeypatch):
    """A service loaded from CENSUS, installed as the instance kp_registry reads."""
    monkeypatch.setattr(VocabContentService, "_load_all", _load_census)
    service = VocabContentService()
    monkeypatch.setattr(kp_registry, "vocab_service", service)
    return service


def test_threaded_reader_never_sees_an_empty_or_partial_index(svc, monkeypatch):
    reads = [0]
    failures: list[str] = []
    stop = threading.Event()

    def reader():
        while not stop.is_set() and len(failures) < 100:
            for slug in SLUGS:
                if kp_registry.vocab_service.articles_by_slug.get(slug) is None:
                    failures.append(f"articles_by_slug[{slug!r}] is None")
                title = kp_registry.label_for("vocab", slug)["title"]
                if title == slug:
                    failures.append(f"label_for({slug!r}) fell back to the slug")
            reads[0] += 1

    def slow_load_all(self):
        # Hold the rebuild open until the reader has run several full passes,
        # so every reload window is observed (deterministic overlap).
        seen = reads[0]
        deadline = time.monotonic() + 2.0
        while reads[0] < seen + 3 and time.monotonic() < deadline:
            time.sleep(0.001)
        _load_census(self)

    monkeypatch.setattr(VocabContentService, "_load_all", slow_load_all)
    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    try:
        for _ in range(10):
            svc.reload()
    finally:
        stop.set()
        thread.join(timeout=5)

    assert reads[0] > 10
    assert failures == []


def test_reload_keeps_old_index_published_and_intact_until_new_one_is_ready(svc, monkeypatch):
    old = svc.articles_by_slug
    old_items = dict(old)
    published_during_load: list[tuple] = []

    def observing_load_all(self):
        published_during_load.append((svc.articles_by_slug, len(svc.articles_by_slug)))
        _load_census(self)

    monkeypatch.setattr(VocabContentService, "_load_all", observing_load_all)
    svc.reload()

    # While the new state was being built, readers still got the old dict...
    [(published, size)] = published_during_load
    assert published is old and size == len(CENSUS)
    # ...which was never cleared or rewritten in place.
    assert old == old_items and len(old) == len(CENSUS)
    # The new state is complete, and a different object from the old one.
    assert svc.articles_by_slug is not old
    assert sorted(svc.articles_by_slug) == sorted(SLUGS)
    assert len(svc.get_all_articles()) == len(CENSUS)
    assert svc.last_modified == STAMP and svc._source == "db"
    assert {c["slug"] for c in svc.get_categories()} >= {"environment", "technology", "education"}


def test_failed_reload_keeps_the_complete_old_state_and_raises(svc, monkeypatch):
    before = dict(vars(svc))

    def broken_load_all(self):
        self._build_indexes(CENSUS[:1])   # partially built, then the loader fails
        raise RuntimeError("vocab loader exploded")

    monkeypatch.setattr(VocabContentService, "_load_all", broken_load_all)
    with pytest.raises(RuntimeError, match="vocab loader exploded"):
        svc.reload()

    after = vars(svc)
    assert after.keys() == before.keys()
    for name, value in before.items():
        assert after[name] is value, f"{name} was replaced by a failed reload"
    assert sorted(svc.articles_by_slug) == sorted(SLUGS)
    assert len(svc.get_all_articles()) == len(CENSUS)
    assert kp_registry.label_for("vocab", "gridlock") == {"title": "Gridlock"}
