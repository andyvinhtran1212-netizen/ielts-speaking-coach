"""Audit 2026-07-28 §A1 — pronunciation audio on the personal SRS flashcard.

The wiki-topic study screen has two play buttons; the personal SRS screen had
none, because `user_vocabulary` (built from a learner's own transcripts) carries
no audio column. Every curated `vocab_cards` row does have a working
`audio_headword`, so the card view resolves it by headword at serve time — the
same read-side repair `quiz_service._resolve_question_audio` makes, and for the
same reason (one writer, no backfill path).

These pin: the field is always present, it resolves case-insensitively, a miss
is an empty string (never a KeyError / missing key), and a lookup failure
degrades to "no audio" instead of failing the whole card list.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from routers import flashcards


class _FakeTable:
    def __init__(self, rows_or_exc):
        self._r = rows_or_exc
        self.keys = None

    def select(self, *_a, **_k):
        return self

    def in_(self, _col, values):
        self.keys = list(values)
        return self

    def execute(self):
        if isinstance(self._r, Exception):
            raise self._r
        return MagicMock(data=self._r)


class _FakeDB:
    def __init__(self, rows_or_exc):
        self._r = rows_or_exc
        self.last = None

    def table(self, _name):
        self.last = _FakeTable(self._r)
        return self.last


def _cards(*headwords):
    return [{"headword": h} for h in headwords]


def test_audio_is_stamped_onto_every_card():
    db = _FakeDB([
        {"headword": "Gridlock", "audio_headword": "https://cdn/grid.mp3"},
        {"headword": "Mobility", "audio_headword": "https://cdn/mob.mp3"},
    ])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock", "Mobility"))
    assert out[0]["audio_headword"] == "https://cdn/grid.mp3"
    assert out[1]["audio_headword"] == "https://cdn/mob.mp3"


def test_lookup_is_case_insensitive_and_deduped():
    """user_vocabulary headwords come from transcripts, so their casing does not
    match the curated cards. One query, lowercased keys, no duplicates."""
    db = _FakeDB([{"headword": "Gridlock", "audio_headword": "https://cdn/grid.mp3"}])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("gridlock", "GRIDLOCK", "Gridlock"))
    assert db.last.keys == ["gridlock"]
    assert all(c["audio_headword"] == "https://cdn/grid.mp3" for c in out)


def test_a_word_with_no_curated_card_gets_an_empty_string():
    """The key must still exist: the player renders the button unconditionally and
    falls back to speechSynthesis on an empty url."""
    db = _FakeDB([])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Nonce"))
    assert out[0]["audio_headword"] == ""


def test_blank_headwords_do_not_query():
    db = _FakeDB([])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio([{"headword": ""}, {"headword": None}])
    assert db.last is None                      # no query issued
    assert [c["audio_headword"] for c in out] == ["", ""]


def test_lookup_failure_degrades_instead_of_breaking_the_card_list():
    db = _FakeDB(RuntimeError("postgrest down"))
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock"))
    assert out[0]["audio_headword"] == ""


def test_empty_audio_url_on_the_card_is_not_promoted():
    db = _FakeDB([{"headword": "Gridlock", "audio_headword": "  "}])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock"))
    assert out[0]["audio_headword"] == ""
