"""Sprint 12.6 — pin services.lemmatizer manual override behaviour.

Override semantics (services/lemmatizer.py):

  1. If lemma_overrides has a row for the lowercased surface form,
     lemmatize() returns (row.lemma, row.pos_tag) without invoking spaCy.

  2. If the override row has pos_tag=NULL, lemmatize() returns the
     overridden lemma + spaCy's POS classification for the input.

  3. reload_overrides() forces a refresh of the in-memory cache.

  4. If the override table is empty (or the supabase_admin call fails),
     lemmatize() falls back to spaCy unchanged — the override layer must
     not break the existing pipeline when no rows exist.

All tests monkeypatch the in-memory override cache + the spaCy loader,
so no Supabase + no spaCy model install required.
"""

from __future__ import annotations

import pytest

import services.lemmatizer as L


def _stub_nlp(out_lemma: str, out_pos: str = "VERB"):
    """Return a tiny spaCy-shaped stub whose tokens carry the given
    lemma + POS. Mimics len(doc) == 1 single-token path."""

    class _Tok:
        lemma_ = out_lemma
        pos_ = out_pos
        is_stop = False
        is_punct = False

    class _Doc:
        def __init__(self):
            self._tokens = [_Tok()]

        def __len__(self):
            return len(self._tokens)

        def __iter__(self):
            return iter(self._tokens)

        def __getitem__(self, i):
            return self._tokens[i]

    def _nlp(_text):
        return _Doc()

    return _nlp


@pytest.fixture(autouse=True)
def reset_module_state(monkeypatch):
    """Each test starts with a clean override cache marked loaded so
    _load_overrides() doesn't try to hit Supabase."""
    monkeypatch.setattr(L, "_overrides", {})
    monkeypatch.setattr(L, "_overrides_loaded", True)
    yield


def test_override_with_pos_short_circuits_spacy(monkeypatch):
    """An override row with both lemma + pos_tag returns those two
    without invoking spaCy at all — the stub_nlp would have returned a
    different lemma, so the test fails if spaCy is reached."""
    monkeypatch.setattr(L, "_overrides", {"data": ("data", "NOUN")})
    # If lemmatize() called spaCy, we'd get "datum" back instead.
    monkeypatch.setattr(L, "_get_nlp", lambda: _stub_nlp("datum", "NOUN"))

    lemma, pos = L.lemmatize("data")
    assert lemma == "data"
    assert pos == "NOUN"


def test_override_without_pos_uses_spacy_for_pos(monkeypatch):
    """If the override row has pos_tag=None, lemmatize() must return the
    overridden lemma + spaCy's POS classification."""
    monkeypatch.setattr(L, "_overrides", {"running": ("run", None)})
    monkeypatch.setattr(L, "_get_nlp", lambda: _stub_nlp("ran", "VERB"))

    lemma, pos = L.lemmatize("running")
    assert lemma == "run"          # ← overridden
    assert pos == "VERB"            # ← from spaCy stub


def test_no_override_falls_through_to_spacy(monkeypatch):
    """Empty override cache: lemmatize() must behave identically to
    pre-Sprint-12.6 — just spaCy."""
    monkeypatch.setattr(L, "_overrides", {})
    monkeypatch.setattr(L, "_get_nlp", lambda: _stub_nlp("run", "VERB"))

    lemma, pos = L.lemmatize("ran")
    assert lemma == "run"
    assert pos == "VERB"


def test_override_lookup_is_case_insensitive(monkeypatch):
    """Override keys are stored lowercased; user input must lower-match."""
    monkeypatch.setattr(L, "_overrides", {"phở": ("phở", "NOUN")})
    monkeypatch.setattr(L, "_get_nlp", lambda: _stub_nlp("WRONG"))

    lemma, _ = L.lemmatize("Phở")
    assert lemma == "phở"


def test_reload_overrides_refreshes_cache(monkeypatch):
    """reload_overrides() must mark the cache stale + re-call _load_overrides()."""
    monkeypatch.setattr(L, "_overrides", {"old": ("old", "NOUN")})
    monkeypatch.setattr(L, "_overrides_loaded", True)

    # Fake _load_overrides that replaces the dict.
    def fake_load():
        L._overrides = {"new": ("new", "VERB")}
        L._overrides_loaded = True

    monkeypatch.setattr(L, "_load_overrides", fake_load)
    L.reload_overrides()

    assert L._overrides == {"new": ("new", "VERB")}
