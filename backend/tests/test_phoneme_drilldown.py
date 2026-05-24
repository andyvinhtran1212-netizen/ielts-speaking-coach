"""
Sprint 15.1 — phoneme drill-down backend sentinels (Codex/cluster-15 Direction 1).

Exercises the real captured Azure Granularity=Phoneme fixture (PF-1 empirical
evidence) — no live Azure, no DB. Confirms the granularity flag, the weak-phoneme
extraction, and the normalizer wire-through.
"""

import base64
import json
from pathlib import Path

from services.azure_pronunciation import (
    extract_weak_phonemes,
    _normalize,
    _assessment_header,
)

_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "azure_phoneme_sample.json").read_text(encoding="utf-8")
)
_RAW = _FIXTURE["raw_payload"]


# ── Granularity flag (PF-1: Word → Phoneme) ─────────────────────────────────────

def test_assessment_header_requests_phoneme_granularity():
    decoded = json.loads(base64.b64decode(_assessment_header()))
    assert decoded["Granularity"] == "Phoneme"
    assert decoded["GradingSystem"] == "HundredMark"  # 0–100, so <70 threshold is valid


# ── extract_weak_phonemes against the real captured fixture ─────────────────────

def test_extract_weak_phonemes_from_real_fixture():
    weak = extract_weak_phonemes(_RAW)
    assert len(weak) == 5  # default top_n
    # ascending by score, all below the 70 threshold, with word context + SAPI symbol
    scores = [w["score"] for w in weak]
    assert scores == sorted(scores)
    assert all(w["score"] < 70.0 for w in weak)
    assert all({"symbol", "score", "word", "word_index"} <= set(w) for w in weak)
    # the weakest sound in the sample is /iy/ in "really"
    assert weak[0]["symbol"] == "iy" and weak[0]["word"] == "really"


def test_extract_weak_phonemes_top_n_and_threshold():
    weak = extract_weak_phonemes(_RAW, threshold=70.0, top_n=3)
    assert len(weak) == 3
    # raise threshold high → still capped; lower it → fewer results
    assert len(extract_weak_phonemes(_RAW, threshold=10.0)) < 5


def test_extract_weak_phonemes_graceful_on_empty_or_word_granularity():
    assert extract_weak_phonemes({}) == []
    assert extract_weak_phonemes({"NBest": []}) == []
    # legacy Word-granularity payload: words present but no Phonemes arrays
    legacy = {"NBest": [{"Words": [{"Word": "hi", "AccuracyScore": 50}]}]}
    assert extract_weak_phonemes(legacy) == []


def test_extract_weak_phonemes_excludes_above_threshold():
    strong = {"NBest": [{"Words": [
        {"Word": "ok", "Phonemes": [{"Phoneme": "ow", "AccuracyScore": 95},
                                     {"Phoneme": "k", "AccuracyScore": 88}]}
    ]}]}
    assert extract_weak_phonemes(strong) == []


# ── normalizer wire-through ──────────────────────────────────────────────────────

def test_normalize_adds_phonemes_to_words_and_weak_phonemes():
    norm = _normalize(_RAW)
    assert "weak_phonemes" in norm and len(norm["weak_phonemes"]) == 5
    # every word carries a (possibly empty) phonemes list with symbol+score
    assert all("phonemes" in w for w in norm["words"])
    sample = next(w for w in norm["words"] if w["phonemes"])
    assert {"symbol", "score"} <= set(sample["phonemes"][0])


def test_normalize_empty_payload_has_empty_weak_phonemes():
    norm = _normalize({"NBest": []})
    assert norm["weak_phonemes"] == []
    assert norm["words"] == []
