"""
tests/test_pdf_generator.py — Sprint 16.1 PDF content-parity refactor.

Covers:
  - extract_weak_words_from_payload (Python port) vs the real captured fixture,
    JSON-string input, legacy pre-15.1 payloads, and null/empty (Pattern #29).
  - PHONEME_REF key parity between the Python port and the JS source of truth
    (frontend/js/pronunciation-drilldown.js) — Pattern #34 integration sentinel.
  - The three new PDF section builders (pills / phoneme / grammar) on synthetic
    practice/test/legacy inputs.
  - A full _render_pdf smoke producing valid %PDF bytes for practice, test, and
    legacy sessions (DB-free — exercises the render path, not Supabase).
"""

import json
import re
from pathlib import Path

import pytest

from services.phoneme_ref import (
    PHONEME_REF,
    extract_weak_words_from_payload,
    tier,
)
from services.pdf_generator import (
    _build_grammar_section,
    _build_phoneme_section,
    _build_pronunciation_pills,
    _render_pdf,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FIXTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "azure_phoneme_sample.json").read_text()
)
_RAW = _FIXTURE["raw_payload"]  # {RecognitionStatus, NBest:[{Words:[{Phonemes:[...]}]}]}


# ── extract_weak_words_from_payload — mirror of JS extractWeakWordsFromPayload ──

def test_extract_post15_1_word_grouped_shape():
    out = extract_weak_words_from_payload(_RAW)
    assert out["legacy"] is False
    assert len(out["weak_words"]) > 0
    w = out["weak_words"][0]
    assert "word" in w and "word_index" in w and isinstance(w["phonemes"], list)
    p = w["phonemes"][0]
    assert isinstance(p["symbol"], str) and isinstance(p["score"], (int, float))


def test_extract_accepts_json_string():
    out = extract_weak_words_from_payload(json.dumps(_RAW))
    assert out["legacy"] is False and len(out["weak_words"]) > 0


def test_extract_legacy_word_granularity():
    stripped = json.loads(json.dumps(_RAW))
    for w in stripped["NBest"][0]["Words"]:
        w.pop("Phonemes", None)
    out = extract_weak_words_from_payload(stripped)
    assert out["legacy"] is True
    assert out["weak_words"] == []


@pytest.mark.parametrize("bad", [None, "", "not json", {}, {"NBest": []}])
def test_extract_empty_or_malformed_not_legacy(bad):
    assert extract_weak_words_from_payload(bad) == {"weak_words": [], "legacy": False}


def test_tier_thresholds():
    assert tier(None) == "mid"
    assert tier(40) == "low"
    assert tier(70) == "mid"
    assert tier(85) == "high"


# ── PHONEME_REF parity sentinel (Pattern #34) — Python port vs JS source ───────

def test_phoneme_ref_keys_match_js_source():
    js = (_REPO_ROOT / "frontend" / "js" / "pronunciation-drilldown.js").read_text()
    block = js[js.index("var PHONEME_REF = {"): js.index("function _esc")]
    js_keys = set(re.findall(r"([a-z]{1,3}):\s*\{\s*ipa:", block))
    assert js_keys, "could not parse PHONEME_REF keys from the JS source"
    assert set(PHONEME_REF.keys()) == js_keys, (
        "Python PHONEME_REF drifted from frontend/js/pronunciation-drilldown.js — "
        f"only in JS: {js_keys - set(PHONEME_REF)} ; only in Py: {set(PHONEME_REF) - js_keys}"
    )


# ── Section builders ───────────────────────────────────────────────────────────

def test_pills_completed_renders():
    r = {
        "pronunciation_status": "completed", "pronunciation_score": 67.2,
        "pronunciation_fluency": 54.0, "pronunciation_accuracy": 84.0,
        "pronunciation_completeness": 91.0,
    }
    assert len(_build_pronunciation_pills(r)) > 0


@pytest.mark.parametrize("r", [
    None,
    {"pronunciation_status": "failed"},
    {"pronunciation_status": "completed", "pronunciation_score": None},
])
def test_pills_absent_renders_nothing(r):
    assert _build_pronunciation_pills(r) == []


def test_phoneme_section_weak_words():
    assert len(_build_phoneme_section({"pronunciation_payload": _RAW})) > 0


def test_phoneme_section_legacy_placeholder():
    stripped = json.loads(json.dumps(_RAW))
    for w in stripped["NBest"][0]["Words"]:
        w.pop("Phonemes", None)
    out = _build_phoneme_section({"pronunciation_payload": stripped})
    assert len(out) > 0  # title + placeholder


def test_phoneme_section_no_payload():
    assert _build_phoneme_section({}) == []


def test_grammar_section_renders_and_groups():
    fb = {"grammar_check": {
        "errors": [
            {"category": "tense", "original_text": "I go", "suggestion": "I went",
             "explanation_vn": "Dùng quá khứ."},
            {"category": "article", "original_text": "a apple", "suggestion": "an apple"},
        ],
        "total_count": 5, "displayed_count": 2,
    }}
    out = _build_grammar_section(fb)
    assert len(out) > 0


@pytest.mark.parametrize("fb", [None, {}, {"grammar_check": {"errors": []}}])
def test_grammar_section_empty(fb):
    assert _build_grammar_section(fb) == []


# ── Full render smoke — valid PDF bytes for practice / test / legacy ───────────

def _legacy_payload():
    stripped = json.loads(json.dumps(_RAW))
    for w in stripped["NBest"][0]["Words"]:
        w.pop("Phonemes", None)
    return stripped


_PRACTICE_FB = {
    "strengths": ["Clear ideas"],
    "grammar_issues": ["tense slip"],          # ← marks practice mode
    "vocabulary_issues": ["repetition"],
    "pronunciation_issues": ["word stress"],
    "corrections": [{"original": "I go", "corrected": "I went", "explanation": "past tense"}],
    "sample_answer": "I went to the market yesterday.",
    "grammar_check": {
        "errors": [{"category": "tense", "original_text": "I go", "suggestion": "I went",
                    "explanation_vn": "Quá khứ."}],
        "total_count": 1, "displayed_count": 1,
    },
}
_TEST_FB = {
    "fc_feedback": "Good flow.", "lr_feedback": "Decent range.",
    "gra_feedback": "Some errors.", "p_feedback": "Mostly clear.",
    "strengths": ["Fluent"], "improvements": ["Vary vocabulary"],
    "improved_response": "A band 7+ model answer.",
}


@pytest.mark.parametrize("fb,payload", [
    (_PRACTICE_FB, _RAW),            # practice + phoneme drilldown
    (_TEST_FB, _RAW),                # test mode + phoneme drilldown
    (_PRACTICE_FB, _legacy_payload()),  # legacy → placeholder path
])
def test_render_pdf_smoke(fb, payload):
    qid = "q1"
    questions = [{"id": qid, "question_text": "Describe your hometown.", "order_num": 1}]
    responses_by_qid = {qid: {
        "id": "r1", "question_id": qid, "transcript": "I really like my hometown.",
        "overall_band": 6.5, "feedback": fb,
        "pronunciation_status": "completed", "pronunciation_score": 67.0,
        "pronunciation_fluency": 54.0, "pronunciation_accuracy": 84.0,
        "pronunciation_completeness": 91.0, "pronunciation_payload": payload,
    }}
    pdf = _render_pdf(
        user_display="Test User", date_str="6 Apr 2026", topic="Hometown",
        part_label="Part 1", overall_band=6.5,
        band_vals={"band_fc": 6.0, "band_lr": 6.5, "band_gra": 6.0, "band_p": 6.5},
        fb_texts={"fc_feedback": "x", "lr_feedback": "x", "gra_feedback": "x", "p_feedback": "x"},
        questions=questions, responses_by_qid=responses_by_qid,
        strengths=["Clear ideas"], improvements=["More detail"], gen_date="2026-05-25",
    )
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 1500
