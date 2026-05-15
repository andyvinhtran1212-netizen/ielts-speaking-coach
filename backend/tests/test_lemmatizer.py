"""Sprint 10.1 — pin the lemmatizer service contract.

Two surfaces:

  1. **Live spaCy tests** (skipped if en_core_web_sm not installed) —
     exercise the real model so the integration is observable in CI
     when the install step ran. These are the canonical "ran→run /
     went→go / kick the bucket preserved" sentinels.

  2. **Monkeypatched stub tests** — replace `_get_nlp()` with a tiny
     fake to confirm the wrapper logic (empty input handling,
     whitespace trim, multi-word preservation, POS pass-through)
     without paying spaCy's load cost.

The two surfaces complement each other: the stub tests prove the
function wraps spaCy correctly even when the model isn't around; the
live tests prove the spaCy model's output matches our expectations
when it IS around. CI installs the model via nixpacks.toml so both
surfaces should be green; a local dev who hasn't run `python -m spacy
download en_core_web_sm` still gets the stub tests as a safety net.
"""

from __future__ import annotations

import pytest


# ── Live spaCy tests (skipif model not installed) ────────────────────


def _spacy_model_available() -> bool:
    """Probe at module load whether the spaCy English model is on disk.

    Cached implicitly via the pytest collection phase — each test
    invocation re-imports services.lemmatizer freshly anyway, so the
    cost is paid once per session.
    """
    try:
        import spacy
        spacy.load("en_core_web_sm", disable=["parser", "ner"])
        return True
    except Exception:
        return False


_MODEL_INSTALLED = _spacy_model_available()
_skip_if_no_model = pytest.mark.skipif(
    not _MODEL_INSTALLED,
    reason="spaCy en_core_web_sm not installed — run `python -m spacy download en_core_web_sm`",
)


@_skip_if_no_model
def test_lemmatize_present_tense_returns_lemma():
    from services.lemmatizer import lemmatize
    lemma, pos = lemmatize("running")
    assert lemma == "run", f"running → expected 'run', got '{lemma}'"
    assert pos == "VERB"


@_skip_if_no_model
def test_lemmatize_irregular_past_tense_returns_lemma():
    """The whole point of Sprint 10.1 — irregulars like ran/run that
    Levenshtein ≤ 2 cannot catch get unified at the lemma layer."""
    from services.lemmatizer import lemmatize
    lemma, _ = lemmatize("ran")
    assert lemma == "run", f"ran → expected 'run', got '{lemma}'"


@_skip_if_no_model
def test_lemmatize_irregular_be_form():
    from services.lemmatizer import lemmatize
    # "was" → "be" is the canonical irregular verb test
    lemma, _ = lemmatize("was")
    assert lemma == "be", f"was → expected 'be', got '{lemma}'"


@_skip_if_no_model
def test_lemmatize_plural_noun():
    from services.lemmatizer import lemmatize
    lemma, pos = lemmatize("phenomena")
    assert lemma == "phenomenon"
    assert pos == "NOUN"


@_skip_if_no_model
def test_lemmatize_multi_word_idiom_preserved():
    """Idioms must not be split per-token. 'kick the bucket' is a
    single semantic unit — collapse to 'kick' or 'bucket' destroys
    the meaning."""
    from services.lemmatizer import lemmatize
    lemma, _ = lemmatize("kick the bucket")
    assert lemma == "kick the bucket", (
        f"multi-word idiom must be returned as-is; got '{lemma}'"
    )


@_skip_if_no_model
def test_lemmatize_case_insensitive():
    from services.lemmatizer import lemmatize
    lemma_lower, _ = lemmatize("running")
    lemma_mixed, _ = lemmatize("Running")
    lemma_upper, _ = lemmatize("RUNNING")
    assert lemma_lower == lemma_mixed == lemma_upper == "run"


@_skip_if_no_model
def test_lemmatize_idempotent():
    """Re-lemmatizing the lemma itself yields the same lemma. The
    backfill script relies on this — if the operator runs it twice,
    the second run is a no-op."""
    from services.lemmatizer import lemmatize
    lemma_once, _ = lemmatize("ran")
    lemma_twice, _ = lemmatize(lemma_once)
    assert lemma_once == lemma_twice == "run"


# ── Wrapper-logic tests (monkeypatched spaCy) ────────────────────────


class _FakeToken:
    def __init__(self, text: str, lemma: str, pos: str = "NOUN",
                 is_stop: bool = False, is_punct: bool = False):
        self.text = text
        self.lemma_ = lemma
        self.pos_ = pos
        self.is_stop = is_stop
        self.is_punct = is_punct


class _FakeDoc(list):
    """Mimics enough of spaCy.Doc for the lemmatizer wrapper to use."""
    pass


def _make_fake_nlp(token_map: dict[str, _FakeToken]):
    """Build a tiny spaCy stand-in. token_map: surface → FakeToken."""
    def fake_nlp(text: str) -> _FakeDoc:
        if " " in text:
            # Multi-word — wrapper preserves surface, so the doc just
            # needs to expose POS via the first content token.
            return _FakeDoc([_FakeToken(p, p, "VERB") for p in text.split()])
        if text in token_map:
            return _FakeDoc([token_map[text]])
        # Fallback: identity lemma
        return _FakeDoc([_FakeToken(text, text)])
    return fake_nlp


def test_wrapper_handles_empty_string(monkeypatch):
    from services import lemmatizer
    lemma, pos = lemmatizer.lemmatize("")
    assert lemma == ""
    assert pos == "NOUN"


def test_wrapper_handles_whitespace_only(monkeypatch):
    from services import lemmatizer
    lemma, pos = lemmatizer.lemmatize("   ")
    assert lemma == ""
    assert pos == "NOUN"


def test_wrapper_strips_and_lowercases_input(monkeypatch):
    """Input mutations happen BEFORE spaCy sees the string. Pin
    that contract so callers don't need to pre-clean."""
    from services import lemmatizer

    seen = {}

    def capture_nlp(text):
        seen["text"] = text
        return _FakeDoc([_FakeToken(text, text, "NOUN")])

    monkeypatch.setattr(lemmatizer, "_get_nlp", lambda: capture_nlp)
    lemmatizer.lemmatize("  Running  ")
    assert seen["text"] == "running"


def test_wrapper_multi_word_preserves_surface(monkeypatch):
    """Even when spaCy would lemmatize per-token, the wrapper
    returns the surface form for multi-word inputs."""
    from services import lemmatizer

    fake_nlp = _make_fake_nlp({
        "kick":   _FakeToken("kick", "kick", "VERB"),
        "the":    _FakeToken("the", "the", "DET", is_stop=True),
        "bucket": _FakeToken("bucket", "bucket", "NOUN"),
    })
    monkeypatch.setattr(lemmatizer, "_get_nlp", lambda: fake_nlp)

    lemma, pos = lemmatizer.lemmatize("kick the bucket")
    assert lemma == "kick the bucket", "multi-word lemma must be the surface form"
    # POS comes from first non-stop, non-punct token (kick / VERB)
    assert pos == "VERB"


def test_lemma_version_returns_positive_int():
    """The version must always be a positive int — the backfill
    script compares stored versions against this. Zero / negative
    would break the comparison logic."""
    from services.lemmatizer import lemma_version
    v = lemma_version()
    assert isinstance(v, int)
    assert v >= 1
