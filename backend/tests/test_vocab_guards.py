"""
Unit tests for vocab_guards.py — Phase B ship-gate.

6 guards × 1 explicit test each, plus additional edge-case coverage.

Run: pytest backend/tests/test_vocab_guards.py -v
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.vocab_guards import run_all_guards

TRANSCRIPT = (
    "I think technology has a significant impact on education. "
    "Students can utilize digital tools to enhance their learning experience. "
    "However, many people argue that face-to-face interaction is still crucial."
)

ITEM_GOOD = {
    "headword": "utilize",
    "context_sentence": "Students can utilize digital tools to enhance their learning experience.",
    "reason": "good B2 word used correctly",
    "category": "topic",
}

ITEM_UPGRADE = {
    "headword": "utilize",
    "context_sentence": "Students can utilize digital tools to enhance their learning experience.",
    "reason": "upgrades simple word 'use'",
    "category": "topic",
    "original_word": "use",
}


def _run(item, source_type="used_well", existing=None):
    return run_all_guards(item, TRANSCRIPT, source_type, existing or [])


# ── Guard 1: headword not in context_sentence ────────────────────────────────

def test_guard1_fails_when_headword_not_in_sentence():
    item = {**ITEM_GOOD, "headword": "innovation"}
    passed, guard = _run(item)
    assert not passed
    assert guard == "guard_1_word_not_in_sentence"


def test_guard1_passes_when_headword_in_sentence():
    passed, guard = _run(ITEM_GOOD)
    assert passed
    assert guard is None


# ── Guard 2: context_sentence not in transcript ───────────────────────────────

def test_guard2_fails_when_sentence_not_in_transcript():
    item = {**ITEM_GOOD, "context_sentence": "utilize digital tools is important for growth."}
    passed, guard = _run(item)
    assert not passed
    assert guard == "guard_2_sentence_not_in_transcript"


def test_guard2_passes_when_sentence_in_transcript():
    passed, guard = _run(ITEM_GOOD)
    assert passed


# ── Guard 3: proper noun ──────────────────────────────────────────────────────

def test_guard3_fails_for_proper_noun():
    transcript = "I met John at the conference and he introduced me to his team."
    item = {
        "headword": "John",
        "context_sentence": "I met John at the conference and he introduced me to his team.",
        "reason": "proper noun test",
        "category": "topic",
    }
    passed, guard = run_all_guards(item, transcript, "used_well", [])
    assert not passed
    assert guard == "guard_3_proper_noun"


def test_guard3_passes_for_sentence_start_capital():
    transcript = "Technology has changed how we live."
    item = {
        "headword": "Technology",
        "context_sentence": "Technology has changed how we live.",
        "reason": "starts sentence — not a proper noun",
        "category": "topic",
    }
    passed, guard = run_all_guards(item, transcript, "used_well", [])
    assert passed
    assert guard is None


# ── Guard 5: upgrade whitelist ────────────────────────────────────────────────

def test_guard5_fails_when_pair_not_in_whitelist():
    item = {
        **ITEM_UPGRADE,
        "original_word": "play",   # "play" → "utilize" not in whitelist
    }
    passed, guard = _run(item, source_type="upgrade_suggested")
    assert not passed
    assert guard == "guard_5_not_in_whitelist"


def test_guard5_passes_when_pair_in_whitelist():
    passed, guard = _run(ITEM_UPGRADE, source_type="upgrade_suggested")
    assert passed
    assert guard is None


# ── Guard 6: Levenshtein duplicate ───────────────────────────────────────────

def test_guard6_fails_for_near_duplicate():
    passed, guard = _run(ITEM_GOOD, existing=["utilise"])  # distance=2 (z→s)
    assert not passed
    assert guard == "guard_6_levenshtein_duplicate"


def test_guard6_passes_for_distinct_word():
    passed, guard = _run(ITEM_GOOD, existing=["technology", "education"])
    assert passed
    assert guard is None


# ── Full pass through all guards ─────────────────────────────────────────────

def test_all_guards_pass_for_clean_item():
    passed, guard = _run(ITEM_GOOD, existing=["environment"])
    assert passed
    assert guard is None
