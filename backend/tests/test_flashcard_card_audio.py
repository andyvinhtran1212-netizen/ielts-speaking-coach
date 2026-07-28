"""Audit 2026-07-28 §A1 — pronunciation audio on the personal SRS flashcard.

The wiki-topic study screen has two play buttons; the personal SRS screen had
none, because `user_vocabulary` (built from a learner's own transcripts) carries
no audio column. Every curated `vocab_cards` row does have a working
`audio_headword`, so the card view resolves it by headword at serve time — the
same read-side repair `quiz_service._resolve_question_audio` makes, and for the
same reason (one writer, no backfill path).

The fake below MATCHES ON THE FILTER rather than echoing seeded rows. The first
version of this file did echo, which is why it passed while the lookup was
lowercasing its `in_()` keys against a title-cased column and returning nothing
(Codex review, PR #876). A fake that ignores the predicate cannot catch a
predicate bug.
"""

from __future__ import annotations

import re

from unittest.mock import MagicMock, patch

from routers import flashcards


class _FakeTable:
    """Applies the or_(...ilike...) predicate the way PostgREST would."""

    def __init__(self, rows, fail=None):
        self._rows = rows
        self._fail = fail
        self.filters: list[str] = []

    def select(self, *_a, **_k):
        return self

    def or_(self, expr):
        self.filters.append(expr)
        return self

    def in_(self, col, values):          # kept so a regression back to in_() is visible
        self.filters.append("IN:%s:%s" % (col, list(values)))
        return self

    def execute(self):
        if self._fail:
            raise self._fail
        if not self.filters:
            return MagicMock(data=self._rows)
        expr = self.filters[-1]
        if expr.startswith("IN:"):
            wanted = eval(expr.split(":", 2)[2])          # noqa: S307 — test-only
            return MagicMock(data=[r for r in self._rows if r["headword"] in wanted])
        # headword.ilike."Value" — case-insensitive WHOLE-value match. The value
        # is escaped twice on the way out (LIKE specials, then the PostgREST
        # quoted-string context), so undo both, in that order, to recover the
        # literal the database would compare against.
        wanted = [_unescape(m).lower()
                  for m in re.findall(r'headword\.ilike\."((?:[^"\\]|\\.)*)"', expr)]
        return MagicMock(data=[r for r in self._rows
                               if r["headword"].lower() in wanted])


def _unquote(s: str) -> str:
    """Reverse the PostgREST double-quoted-string escaping (\\\\ and \\")."""
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append(s[i + 1]); i += 2
        else:
            out.append(s[i]); i += 1
    return "".join(out)


def _unlike(s: str) -> str:
    """Reverse the SQL LIKE escaping (\\\\, \\%, \\_) — an escaped wildcard is a
    literal character to the database."""
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] in "\\%_":
            out.append(s[i + 1]); i += 2
        else:
            out.append(s[i]); i += 1
    return "".join(out)


def _unescape(s: str) -> str:
    return _unlike(_unquote(s))


class _FakeDB:
    def __init__(self, rows, fail=None):
        self._rows = rows
        self._fail = fail
        self.tables: list[_FakeTable] = []

    def table(self, _name):
        t = _FakeTable(self._rows, self._fail)
        self.tables.append(t)
        return t


def _cards(*headwords):
    return [{"headword": h} for h in headwords]


CURATED = [
    # vocab_cards stores title case, as the whole repo does.
    {"headword": "Gridlock", "audio_headword": "https://cdn/grid.mp3"},
    {"headword": "Carbon footprint", "audio_headword": "https://cdn/carbon.mp3"},
]


def test_audio_is_stamped_onto_every_card():
    db = _FakeDB(CURATED)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock", "Carbon footprint"))
    assert out[0]["audio_headword"] == "https://cdn/grid.mp3"
    assert out[1]["audio_headword"] == "https://cdn/carbon.mp3"


def test_lookup_matches_a_title_cased_column_from_lowercased_input():
    """THE bug Codex caught: user_vocabulary headwords come from transcripts, so
    their casing differs from the curated cards, and PostgreSQL compares TEXT
    case-sensitively. An in_() on lowercased keys silently returned zero rows and
    every card fell back to speech synthesis."""
    db = _FakeDB(CURATED)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("gridlock", "CARBON FOOTPRINT"))
    assert [c["audio_headword"] for c in out] == [
        "https://cdn/grid.mp3", "https://cdn/carbon.mp3"]
    # And it must not have regressed to the case-sensitive operator.
    assert not any(f.startswith("IN:") for t in db.tables for f in t.filters)


def test_duplicate_headwords_are_queried_once():
    db = _FakeDB(CURATED)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("gridlock", "Gridlock", "GRIDLOCK"))
    expr = db.tables[0].filters[0]
    assert expr.count("headword.ilike.") == 1
    assert all(c["audio_headword"] == "https://cdn/grid.mp3" for c in out)


def test_a_word_with_no_curated_card_gets_an_empty_string():
    """The key must still exist: the player renders the button unconditionally and
    falls back to speechSynthesis on an empty url."""
    db = _FakeDB(CURATED)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Nonce"))
    assert out[0]["audio_headword"] == ""


def test_a_wildcard_in_a_headword_is_matched_literally():
    """`_` and `%` are LIKE wildcards; unescaped, "co_t" would match "cost" and
    steal another word's audio."""
    db = _FakeDB([{"headword": "co_t", "audio_headword": "https://cdn/underscore.mp3"},
                  {"headword": "cost", "audio_headword": "https://cdn/cost.mp3"}])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("co_t"))
    assert out[0]["audio_headword"] == "https://cdn/underscore.mp3"
    assert "\\_" in db.tables[0].filters[0]


def test_blank_headwords_do_not_query():
    db = _FakeDB(CURATED)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio([{"headword": ""}, {"headword": None}])
    assert db.tables == []                      # no query issued
    assert [c["audio_headword"] for c in out] == ["", ""]


def test_lookup_failure_degrades_instead_of_breaking_the_card_list():
    db = _FakeDB(CURATED, fail=RuntimeError("postgrest down"))
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock"))
    assert out[0]["audio_headword"] == ""


def test_empty_audio_url_on_the_card_is_not_promoted():
    db = _FakeDB([{"headword": "Gridlock", "audio_headword": "  "}])
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards("Gridlock"))
    assert out[0]["audio_headword"] == ""


def test_a_large_stack_is_chunked_so_the_url_stays_sane():
    """The or_() string rides in the query string — a whole stack in one request
    would build a URL long enough for PostgREST to reject."""
    many = [{"headword": "W%03d" % i, "audio_headword": "https://cdn/%d.mp3" % i}
            for i in range(120)]
    db = _FakeDB(many)
    with patch.object(flashcards, "supabase_admin", db):
        out = flashcards._with_audio(_cards(*[c["headword"] for c in many]))
    assert len(db.tables) == 3                  # 120 keys at 50 per request
    assert all(c["audio_headword"] for c in out)
