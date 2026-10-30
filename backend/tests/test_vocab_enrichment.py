"""
Tests for services/vocab_enrichment.

Pure-function tests against a mocked Gemini boundary — Gemini is monkey-
patched at the genai.GenerativeModel level so the suite stays offline,
deterministic, and fast.  Live calls (and prompt drift) are out of scope
for unit tests; the inline Phase B path will surface real-world quality
issues during dogfood.

What we pin here:
- Validator (`_validate_item`) accepts well-formed payloads and rejects
  every documented bad shape (missing fields, bad IPA, hallucinated
  headword, blank/short/long example, fill-blank token).
- `enrich_vocabulary_batch` chunks at CHUNK_SIZE=10 and aggregates.
- Partial-failure: chunk 2 errors → chunk 1 + chunk 3 still return.
- Full failure: every chunk errors → VocabEnrichmentError raised.
- Empty input is a no-op.

Run: pytest backend/tests/test_vocab_enrichment.py -v
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


def _import_service():
    try:
        from services import vocab_enrichment as ve
        return ve
    except Exception as e:
        pytest.skip(f"vocab_enrichment service not available: {e}")


# ── _validate_item: positive case ────────────────────────────────────────────


def test_validate_item_accepts_well_formed_payload():
    ve = _import_service()
    out = ve._validate_item(
        {
            "headword": "mitigate",
            "ipa": "/ˈmɪtɪɡeɪt/",
            "example": "Governments must implement policies to mitigate the impact of climate change on coastal communities.",
        },
        valid_headwords={"mitigate"},
    )
    assert out is not None
    assert out["headword"] == "mitigate"
    assert out["ipa"] == "/ˈmɪtɪɡeɪt/"
    assert "mitigate" in out["example_sentence"].lower()


# ── _validate_item: rejection cases ──────────────────────────────────────────


@pytest.mark.parametrize(
    "payload, why",
    [
        ({"headword": "", "ipa": "/x/", "example": "A sentence with mitigate works fine here."},
         "empty headword"),
        ({"headword": "mitigate", "ipa": "", "example": "A sentence with mitigate works fine here."},
         "empty ipa"),
        ({"headword": "mitigate", "ipa": "/ˈmɪtɪɡeɪt/", "example": ""},
         "empty example"),
        ({"headword": "mitigate", "ipa": "no slashes here", "example": "A sentence with mitigate works fine here."},
         "ipa missing slashes"),
        ({"headword": "mitigate", "ipa": "/ˈmɪtɪɡeɪt/", "example": "Use ___ here please."},
         "fill-blank token in example"),
        ({"headword": "mitigate", "ipa": "/ˈmɪtɪɡeɪt/", "example": "Tiny."},
         "example too short"),
        ({"headword": "mitigate", "ipa": "/ˈmɪtɪɡeɪt/",
          "example": " ".join(["very"] * 40) + " mitigate"},
         "example too long"),
        ({"headword": "mitigate", "ipa": "/ˈmɪtɪɡeɪt/",
          "example": "A sentence that does not mention the target word at all."},
         "example missing headword"),
    ],
    ids=lambda p: p[1] if isinstance(p, tuple) else "x",
)
def test_validate_item_rejects_bad_payloads(payload, why):
    ve = _import_service()
    out = ve._validate_item(payload, valid_headwords={"mitigate"})
    assert out is None, f"validator should reject: {why}"


def test_validate_item_rejects_hallucinated_headword():
    """Gemini sometimes adds extra entries; validator must drop them so the
    backfill UPDATE never touches a row the caller didn't request."""
    ve = _import_service()
    out = ve._validate_item(
        {"headword": "extraneous",
         "ipa": "/ɪkˈstreɪniəs/",
         "example": "An extraneous variable can confound experimental results in complex studies."},
        valid_headwords={"mitigate"},  # only mitigate is in the input set
    )
    assert out is None


# ── _validate_item: definitions are optional pass-through ───────────────────


def test_validate_item_passes_through_definition_vi_and_en():
    """Day 1 dogfood: idioms arrive with NULL definition_vi.  Validator
    must surface both definitions when Gemini provides them so the admin
    backfill can write them back."""
    ve = _import_service()
    out = ve._validate_item(
        {
            "headword": "play by ear",
            "ipa": "/pleɪ baɪ ɪər/",
            "definition_vi": "ứng biến, tuỳ cơ ứng biến",
            "definition_en": "decide as you go without a fixed plan",
            "example": "Without a clear strategy, the team had to play by ear during the launch.",
        },
        valid_headwords={"play by ear"},
    )
    assert out is not None
    assert out["definition_vi"] == "ứng biến, tuỳ cơ ứng biến"
    assert out["definition_en"] == "decide as you go without a fixed plan"
    assert out["headword"] == "play by ear"
    assert out["ipa"] == "/pleɪ baɪ ɪər/"


def test_validate_item_omits_definitions_when_absent():
    """Definitions are best-effort: missing ones don't reject the row, they
    just stay out of the returned dict so the UPDATE skips those columns."""
    ve = _import_service()
    out = ve._validate_item(
        {
            "headword": "mitigate",
            "ipa": "/ˈmɪtɪɡeɪt/",
            "example": "Governments must implement policies to mitigate the impact of climate change quickly.",
        },
        valid_headwords={"mitigate"},
    )
    assert out is not None
    assert "definition_vi" not in out
    assert "definition_en" not in out


def test_validate_item_drops_overlong_definitions():
    """Hallucinated long-form glosses must not slip through — they would
    overflow the back-of-card layout and could exceed column lengths."""
    ve = _import_service()
    out = ve._validate_item(
        {
            "headword": "mitigate",
            "ipa": "/ˈmɪtɪɡeɪt/",
            "definition_vi": "x" * 130,  # over 120-char cap
            "definition_en": "y" * 200,  # over 160-char cap
            "example": "Governments must implement policies to mitigate the impact of climate change quickly.",
        },
        valid_headwords={"mitigate"},
    )
    assert out is not None
    assert "definition_vi" not in out
    assert "definition_en" not in out


# ── enrich_vocabulary_batch: empty input is a no-op ──────────────────────────


def test_enrich_empty_input_returns_empty_no_call(monkeypatch):
    ve = _import_service()
    # Spy: assert generate_content is never invoked.
    called = {"n": 0}

    class _SpyModel:
        def __init__(self, *a, **k): pass
        def generate_content(self, *_):
            called["n"] += 1
            raise AssertionError("should not be called for empty input")

    monkeypatch.setattr(ve.genai, "GenerativeModel", _SpyModel)
    assert ve.enrich_vocabulary_batch([]) == []
    assert ve.enrich_vocabulary_batch([" ", "", None]) == []
    assert called["n"] == 0


# ── enrich_vocabulary_batch: chunking + aggregation ──────────────────────────


def _stub_gemini_response(items):
    """Build a fake Gemini response object with a JSON `text` body."""
    class _Resp:
        text = json.dumps({"items": items})
    return _Resp()


def _install_stub(monkeypatch, ve, per_chunk_responder):
    """
    Install a fake genai.GenerativeModel whose generate_content delegates to
    `per_chunk_responder(chunk_words) -> response`.  The stub also records
    each chunk so tests can assert chunking shape.
    """
    chunks_seen: list[list[str]] = []

    class _StubModel:
        def __init__(self, *a, **k): pass
        def generate_content(self, prompt: str):
            # Pull the headwords back out of the prompt so the responder can
            # tailor its reply.  Format from _enrich_single_chunk is
            # "Enrich these N headwords:\n\n- foo\n- bar".
            words = [
                line[2:].strip()
                for line in prompt.splitlines()
                if line.startswith("- ")
            ]
            chunks_seen.append(words)
            return per_chunk_responder(words)

    monkeypatch.setattr(ve.genai, "GenerativeModel", _StubModel)
    return chunks_seen


def test_enrich_returns_validated_items_for_one_chunk(monkeypatch):
    ve = _import_service()

    def responder(words):
        return _stub_gemini_response([
            {"headword": w,
             "ipa": "/ˈtɛst/",
             "example": f"This sentence uses the word {w} naturally enough to count."}
            for w in words
        ])

    _install_stub(monkeypatch, ve, responder)
    out = ve.enrich_vocabulary_batch(["mitigate", "implement", "sustain"])
    headwords = sorted(item["headword"] for item in out)
    assert headwords == ["implement", "mitigate", "sustain"]
    for item in out:
        assert item["ipa"] == "/ˈtɛst/"
        assert item["headword"] in item["example_sentence"]


def test_enrich_chunks_at_size_10(monkeypatch):
    ve = _import_service()

    def responder(words):
        return _stub_gemini_response([
            {"headword": w,
             "ipa": "/ˈtɛst/",
             "example": f"A test sentence using the word {w} in a perfectly reasonable manner."}
            for w in words
        ])

    chunks_seen = _install_stub(monkeypatch, ve, responder)
    words = [f"word{i}" for i in range(25)]  # 25 → 3 chunks (10 + 10 + 5)
    out = ve.enrich_vocabulary_batch(words)
    assert len(chunks_seen) == 3
    assert [len(c) for c in chunks_seen] == [10, 10, 5]
    assert len(out) == 25


def test_enrich_dedupes_case_insensitively(monkeypatch):
    """Repeat headwords in input shouldn't cost extra Gemini calls."""
    ve = _import_service()

    def responder(words):
        return _stub_gemini_response([
            {"headword": w, "ipa": "/ˈtɛst/",
             "example": f"A sentence with {w} that comfortably exceeds the minimum word count."}
            for w in words
        ])

    chunks_seen = _install_stub(monkeypatch, ve, responder)
    out = ve.enrich_vocabulary_batch(["foo", "Foo", "FOO", "bar"])
    # Dedup → 2 unique words, one chunk.
    assert len(chunks_seen) == 1
    assert sorted(c.lower() for c in chunks_seen[0]) == ["bar", "foo"]
    assert len(out) == 2


# ── enrich_vocabulary_batch: failure-handling ────────────────────────────────


def test_enrich_partial_failure_returns_what_worked(monkeypatch):
    """Chunk 2 errors → chunks 1 + 3 still come back."""
    ve = _import_service()

    seq = {"i": 0}

    def responder(words):
        seq["i"] += 1
        if seq["i"] == 2:
            raise RuntimeError("simulated outage on chunk 2")
        return _stub_gemini_response([
            {"headword": w, "ipa": "/ˈtɛst/",
             "example": f"A simulated sentence containing {w} for the unit test path."}
            for w in words
        ])

    _install_stub(monkeypatch, ve, responder)
    words = [f"w{i}" for i in range(25)]  # 3 chunks
    out = ve.enrich_vocabulary_batch(words)
    # Chunks 1 (10) + 3 (5) returned, chunk 2 (10) failed.
    assert len(out) == 15


def test_enrich_full_failure_raises(monkeypatch):
    ve = _import_service()

    def responder(words):
        raise RuntimeError("everything is on fire")

    _install_stub(monkeypatch, ve, responder)
    with pytest.raises(ve.VocabEnrichmentError):
        ve.enrich_vocabulary_batch(["foo", "bar"])


def test_enrich_invalid_json_treated_as_chunk_failure(monkeypatch):
    ve = _import_service()

    class _BadJsonResp:
        text = "this is not valid JSON at all"

    class _StubModel:
        def __init__(self, *a, **k): pass
        def generate_content(self, _):
            return _BadJsonResp()

    monkeypatch.setattr(ve.genai, "GenerativeModel", _StubModel)
    # Single chunk → invalid JSON → 100% failure → raises.
    with pytest.raises(ve.VocabEnrichmentError):
        ve.enrich_vocabulary_batch(["mitigate"])


def test_enriches_idioms(monkeypatch):
    """Multi-word idioms (>3 words) must enrich, not get dropped.

    Pre-fix the system prompt explicitly excluded anything beyond a "single
    word or 2-3 word collocation" — Gemini complied and silently skipped
    longer phrases.  This test pins the new prompt's contract via the mock:
    if the responder returns a valid idiom result, the validator must accept
    it and the function must return it.
    """
    ve = _import_service()

    idiom_example = (
        "During the jam session she played by ear and the band followed "
        "her lead seamlessly throughout."
    )

    def responder(words):
        return _stub_gemini_response([
            {"headword": w,
             "ipa": "/pleɪd baɪ ɪər/",
             "example": idiom_example}
            for w in words
        ])

    _install_stub(monkeypatch, ve, responder)
    out = ve.enrich_vocabulary_batch(["played by ear"])
    assert len(out) == 1
    assert out[0]["headword"] == "played by ear"
    assert out[0]["ipa"] == "/pleɪd baɪ ɪər/"
    assert "played by ear" in out[0]["example_sentence"].lower()


def test_retries_missing_words_with_simpler_prompt(monkeypatch):
    """If the first call drops a word, the retry path re-asks for just the
    missing entry using `_SYSTEM_PROMPT_SIMPLE`.  Final output contains both."""
    ve = _import_service()

    seen_calls: list[dict] = []  # captures (system_prompt, words) per call

    class _StubModel:
        def __init__(self, *a, **k):
            self._sys = k.get("system_instruction", "")

        def generate_content(self, prompt: str):
            words = [
                line[2:].strip()
                for line in prompt.splitlines()
                if line.startswith("- ")
            ]
            seen_calls.append({"system_prompt": self._sys, "words": words})

            # First call: only return the first word (drop the idiom).
            if len(seen_calls) == 1:
                return _stub_gemini_response([
                    {"headword": "mitigate",
                     "ipa": "/ˈmɪtɪɡeɪt/",
                     "example": "Governments must mitigate the impact of climate change on coastal communities globally."}
                ])
            # Retry call: only the missing idiom should be re-requested.
            return _stub_gemini_response([
                {"headword": "played by ear",
                 "ipa": "/pleɪd baɪ ɪər/",
                 "example": "During the jam session she played by ear and the band followed her lead throughout."}
            ])

    monkeypatch.setattr(ve.genai, "GenerativeModel", _StubModel)
    out = ve.enrich_vocabulary_batch(["mitigate", "played by ear"])

    headwords = sorted(item["headword"] for item in out)
    assert headwords == ["mitigate", "played by ear"], (
        "retry should fill in the dropped idiom"
    )

    # First call hit the strict prompt with both words.
    assert seen_calls[0]["system_prompt"] == ve._SYSTEM_PROMPT
    assert sorted(seen_calls[0]["words"]) == sorted(["mitigate", "played by ear"])

    # Second call (retry) must use the simpler prompt and only the missing word.
    assert len(seen_calls) == 2, "retry path should fire exactly once"
    assert seen_calls[1]["system_prompt"] == ve._SYSTEM_PROMPT_SIMPLE
    assert seen_calls[1]["words"] == ["played by ear"]


def test_enrich_strips_markdown_fences(monkeypatch):
    """Gemini occasionally wraps output in ```json fences; the strip helper
    must clear them before json.loads."""
    ve = _import_service()

    class _FencedResp:
        text = "```json\n" + json.dumps({"items": [
            {"headword": "mitigate",
             "ipa": "/ˈmɪtɪɡeɪt/",
             "example": "A reasonable sentence about how to mitigate emissions in big cities."}
        ]}) + "\n```"

    class _StubModel:
        def __init__(self, *a, **k): pass
        def generate_content(self, _):
            return _FencedResp()

    monkeypatch.setattr(ve.genai, "GenerativeModel", _StubModel)
    out = ve.enrich_vocabulary_batch(["mitigate"])
    assert len(out) == 1
    assert out[0]["headword"] == "mitigate"
