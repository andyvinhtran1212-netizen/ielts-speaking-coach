"""Sprint 10.5 — unit tests for services/d1_question_generator.

Contracts under test:

  1. Haiku happy path — valid JSON output → validated payload with
     blank_position_start/_end computed from first occurrence.
  2. Validation rejects payloads where target_answer doesn't appear in
     context_sentence.
  3. Validation rejects sentences outside 8–35 words (drift guard).
  4. Acceptable variants normalised: lowercased, deduped, target word
     removed if it appears in the list.
  5. Haiku failure → Gemini fallback. (Gemini failure too → evidence
     fallback. All three failing → returns None.)
  6. Evidence fallback masks the first occurrence of headword in the
     user's evidence_substring with correct positions.
  7. Empty headword → returns None immediately (defensive).

Each test stubs `anthropic.Anthropic` so no real API call fires. Same
pattern as the existing vocab_extractor + claude_grader tests.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from services import d1_question_generator as dqg


# ── Fake Anthropic client ────────────────────────────────────────────


class _FakeAnthropicMessage:
    def __init__(self, text: str):
        self.content = [SimpleNamespace(text=text)]


class _FakeAnthropicClient:
    """Records every messages.create call and returns the next canned
    text response. Raises on failures[idx] (None = no error)."""

    def __init__(self, *, texts: list[str] | None = None, errors: list[Exception | None] | None = None):
        self._texts = list(texts or [])
        self._errors = list(errors or [])
        self.calls: list[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._errors:
            err = self._errors.pop(0)
            if err is not None:
                raise err
        if not self._texts:
            raise RuntimeError("test bug: no canned text for Anthropic call")
        return _FakeAnthropicMessage(self._texts.pop(0))


def _patch_anthropic(monkeypatch, *, texts: list[str] | None = None,
                     errors: list[Exception | None] | None = None):
    fake = _FakeAnthropicClient(texts=texts, errors=errors)
    monkeypatch.setattr(
        dqg.anthropic, "Anthropic",
        lambda **_k: fake,
    )
    # Force the ANTHROPIC_API_KEY truthy so _try_haiku doesn't short-circuit.
    monkeypatch.setattr(dqg.settings, "ANTHROPIC_API_KEY", "fake-key", raising=False)
    return fake


def _block_gemini(monkeypatch):
    """Force the Gemini fallback to always return None — tests that
    only want to exercise the Haiku path use this to keep results
    deterministic when Haiku fails."""
    monkeypatch.setattr(dqg, "_try_gemini", lambda _row: None)


# ── Contracts ─────────────────────────────────────────────────────────


def test_haiku_happy_path(monkeypatch):
    """Haiku returns a clean JSON → validated payload with blank
    positions computed from the first 'serendipity' in the sentence.

    Sprint 10.5 Phase 2 — payload now also includes distractors and
    the validated output carries a 4-element pre-shuffled options[]."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "distractors": ["misfortune", "obligation", "routine"],
        "acceptable_variants": ["serendipities"],
        "hint": "happy coincidence",
    })])

    vocab_row = {
        "id": "v1",
        "headword": "serendipity",
        "definition_en": "the occurrence of pleasant events by chance",
        "pos": "noun",
        "evidence_substring": "There was real serendipity in how we met.",
    }
    out = dqg.generate_d1_question(vocab_row)

    assert out is not None
    assert out["generated_by"] == "haiku"
    assert out["target_answer"] == "serendipity"
    assert out["context_sentence"].startswith("I love the serendipity")
    # blank positions point at the first occurrence of "serendipity".
    start, end = out["blank_position_start"], out["blank_position_end"]
    assert out["context_sentence"][start:end].lower() == "serendipity"
    assert out["acceptable_variants"] == ["serendipities"]
    assert out["hint"] == "happy coincidence"
    assert out["source_evidence_substring"] == "There was real serendipity in how we met."
    # Phase 2 — options is a 4-element list containing target + all 3 distractors.
    assert isinstance(out["options"], list) and len(out["options"]) == 4
    assert set(out["options"]) == {"serendipity", "misfortune", "obligation", "routine"}
    # Pre-shuffled deterministically — same headword seed must produce
    # the same order on every call to _shuffled_options. Re-derives via
    # the helper to keep the test independent of the fake AI client.
    expected_shuffle = dqg._shuffled_options(
        "serendipity", ["misfortune", "obligation", "routine"], seed="serendipity",
    )
    assert out["options"] == expected_shuffle


def test_validation_rejects_target_missing_from_sentence(monkeypatch):
    """If the AI returns a sentence that doesn't contain the target
    word at all, _validate_ai_payload returns None → fall through to
    Gemini, then evidence fallback."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "Some completely different sentence.",
        "target_answer":    "serendipity",
        "acceptable_variants": [],
        "hint": "x",
    })])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1",
        "headword": "serendipity",
        "evidence_substring": "Real serendipity happened.",
    })
    # No Haiku payload + no Gemini → evidence fallback fires.
    assert out is not None
    assert out["generated_by"] == "fallback_evidence"
    assert out["context_sentence"] == "Real serendipity happened."


def test_validation_rejects_sentence_too_short(monkeypatch):
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "Big serendipity here.",   # 3 words
        "target_answer":    "serendipity",
        "acceptable_variants": [],
        "hint": "",
    })])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1",
        "headword": "serendipity",
        # Evidence missing → no fallback either; should return None.
    })
    assert out is None


def test_acceptable_variants_normalized(monkeypatch):
    """Variants get lowercased + deduped + target removed."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "distractors": ["misfortune", "obligation", "routine"],
        "acceptable_variants": ["Serendipities", "SERENDIPITIES", "serendipity", "happy chance"],
        "hint": "x",
    })])

    out = dqg.generate_d1_question({
        "id": "v1", "headword": "serendipity",
    })
    assert out is not None
    # Dedup case-insensitive; "serendipity" filtered (=target);
    # remaining: ["serendipities", "happy chance"].
    assert out["acceptable_variants"] == ["serendipities", "happy chance"]


def test_haiku_failure_falls_through_to_evidence_fallback(monkeypatch):
    """Both AI providers down → fall back to evidence_substring with
    the target word position computed correctly."""
    _patch_anthropic(monkeypatch, errors=[RuntimeError("network down")])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1",
        "headword": "ubiquitous",
        "evidence_substring": "Smartphones are ubiquitous in modern life.",
    })
    assert out is not None
    assert out["generated_by"] == "fallback_evidence"
    assert out["context_sentence"] == "Smartphones are ubiquitous in modern life."
    # Positions point at "ubiquitous".
    start, end = out["blank_position_start"], out["blank_position_end"]
    assert out["context_sentence"][start:end] == "ubiquitous"
    assert out["target_answer"] == "ubiquitous"
    assert out["acceptable_variants"] == []
    assert out["hint"] is None


def test_returns_none_when_all_paths_fail(monkeypatch):
    """AI fails AND no evidence → returns None so caller can log +
    move on. The backfill script counts this as `errored` not crashed."""
    _patch_anthropic(monkeypatch, errors=[RuntimeError("haiku down")])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1", "headword": "ubiquitous",
        # No evidence_substring, no context_sentence.
    })
    assert out is None


def test_empty_headword_short_circuits(monkeypatch):
    """Defensive guard — should not call the AI at all."""
    fake = _patch_anthropic(monkeypatch, texts=[])
    out = dqg.generate_d1_question({"id": "v1", "headword": "   "})
    assert out is None
    assert fake.calls == [], "Should NOT have called Anthropic when headword is empty"


def test_haiku_invalid_json_falls_through(monkeypatch):
    """Malformed JSON from Haiku → fall through (no crash). Evidence
    fallback picks up."""
    _patch_anthropic(monkeypatch, texts=["this is not json at all <html>"])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1",
        "headword": "serendipity",
        "evidence_substring": "Pure serendipity led us here.",
    })
    assert out is not None
    assert out["generated_by"] == "fallback_evidence"


# ── Sprint 10.5 Phase 2 — MCQ contracts ──────────────────────────────


def test_phase2_distractors_missing_falls_through(monkeypatch):
    """Sprint 10.5 Phase 2 — Haiku payload without `distractors` key
    fails validation; with Gemini also blocked, falls through to the
    evidence fallback which produces options=[]."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "acceptable_variants": [],
        "hint": "x",
        # NO distractors field — Phase 2 validation should reject this.
    })])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1", "headword": "serendipity",
        "evidence_substring": "There was real serendipity in our meeting.",
    })
    assert out is not None
    assert out["generated_by"] == "fallback_evidence"
    # Evidence fallback intentionally leaves options=[] for the
    # Phase 2 backfill (backfill_d1_questions_mcq.py) to fill later.
    assert out["options"] == []


def test_phase2_distractors_wrong_count_rejected(monkeypatch):
    """Distractors with !=3 entries → reject. AI is supposed to return
    exactly 3 distractors per the system prompt; anything else means
    the model went off-spec."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "distractors": ["misfortune", "obligation"],   # only 2
        "acceptable_variants": [],
        "hint": "x",
    })])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({"id": "v1", "headword": "serendipity"})
    # No evidence → all paths fail.
    assert out is None


def test_phase2_distractor_equal_to_target_rejected(monkeypatch):
    """A distractor that equals the target word (case-insensitive) is
    a model error — reject the whole payload."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "distractors": ["misfortune", "Serendipity", "obligation"],  # 2nd == target
        "acceptable_variants": [],
        "hint": "x",
    })])
    _block_gemini(monkeypatch)
    out = dqg.generate_d1_question({"id": "v1", "headword": "serendipity"})
    assert out is None


def test_phase2_duplicate_distractors_rejected(monkeypatch):
    """Two distractors equal to each other (case-insensitive) — reject."""
    _patch_anthropic(monkeypatch, texts=[json.dumps({
        "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
        "target_answer":    "serendipity",
        "distractors": ["misfortune", "MISFORTUNE", "obligation"],   # dup
        "acceptable_variants": [],
        "hint": "x",
    })])
    _block_gemini(monkeypatch)
    out = dqg.generate_d1_question({"id": "v1", "headword": "serendipity"})
    assert out is None


def test_phase2_evidence_fallback_options_empty(monkeypatch):
    """Evidence fallback path always returns options=[] — the Phase 2
    backfill script handles the distractor generation in a separate
    pass."""
    _patch_anthropic(monkeypatch, errors=[RuntimeError("haiku down")])
    _block_gemini(monkeypatch)

    out = dqg.generate_d1_question({
        "id": "v1",
        "headword": "ubiquitous",
        "evidence_substring": "Smartphones are ubiquitous in modern life.",
    })
    assert out is not None
    assert out["generated_by"] == "fallback_evidence"
    assert out["options"] == []


def test_shuffled_options_deterministic_by_seed():
    """Sprint 10.5 Phase 2 — same seed = same order. Different seeds
    may produce different orders (the actual order is a property of
    Random's PRNG; we don't pin specific values, just stability)."""
    a = dqg._shuffled_options("alpha", ["beta", "gamma", "delta"], seed="alpha")
    b = dqg._shuffled_options("alpha", ["beta", "gamma", "delta"], seed="alpha")
    assert a == b
    # Sanity: target is in the result.
    assert "alpha" in a and len(a) == 4 and len(set(a)) == 4


def test_haiku_strips_markdown_fences(monkeypatch):
    """Models sometimes wrap JSON in ```json … ``` fences despite the
    system prompt asking for strict JSON. The strip helper must
    tolerate this — otherwise valid payloads get thrown away."""
    raw = "```json\n" + json.dumps({
        "context_sentence": "She gained a unique perspective from her travels abroad recently.",
        "target_answer":    "perspective",
        "distractors": ["resolution", "barrier", "outcome"],
        "acceptable_variants": [],
        "hint": "viewpoint",
    }) + "\n```"
    _patch_anthropic(monkeypatch, texts=[raw])

    out = dqg.generate_d1_question({"id": "v1", "headword": "perspective"})
    assert out is not None
    assert out["generated_by"] == "haiku"
    assert out["target_answer"] == "perspective"
