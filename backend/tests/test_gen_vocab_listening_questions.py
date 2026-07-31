"""Audit 2026-07-28 — the listen-and-choose item generator.

Audio exists for every vocab card but only ONE question per word (the `spelling`
item) used it, so a learner could master a lesson having heard each word once.
These pin the generator's contract: one well-formed item per word, derived
entirely from existing data, byte-identical on a re-run, and never emitted when
the inputs would make an unanswerable question.
"""

from __future__ import annotations

from scripts import gen_vocab_listening_questions as gen

_BANK = {"id": "bank-1", "code": "L08", "topic_id": "t-8"}


def _q(qid, item_key, order):
    return {"qid": qid, "item_key": item_key, "order": order}


def _questions(n=6):
    """n words, each with one existing question, in bank order."""
    return [_q("w%d_v1" % i, "Word%d" % i, i) for i in range(n)]


def _cards(n=6, *, audio=True, meaning=True):
    return [{
        "headword": "Word%d" % i,
        "definition_vi": ("nghĩa %d" % i) if meaning else "",
        "gloss_vi": "",
        "audio_headword": ("https://cdn/w%d.mp3" % i) if audio else "",
    } for i in range(n)]


def test_one_well_formed_item_per_word():
    rows = gen.build_rows(_BANK, _questions(), _cards())
    assert len(rows) == 6
    r = rows[0]
    assert r["qid"] == "w0_listen"
    assert r["item_key"] == "Word0"
    assert r["input"] == "choice" and r["type"] == "mcq"
    assert r["audio_url"] == "https://cdn/w0.mp3"
    assert len(r["options"]) == 4
    assert r["options"][r["answer"]] == "nghĩa 0"
    assert len(set(r["options"])) == 4          # no duplicate options
    # The prompt carries the {{audio}} token the player + serve path key off.
    assert "{{audio}}" in r["prompt"]


def test_skill_is_a_new_distinct_value():
    """Mastery needs N DISTINCT skills, so a new skill can only widen the paths to
    mastery — it can never strand a word that was masterable before."""
    rows = gen.build_rows(_BANK, _questions(), _cards())
    assert {r["skill"] for r in rows} == {"listening"}


def test_generation_is_idempotent_and_deterministic():
    a = gen.build_rows(_BANK, _questions(), _cards())
    b = gen.build_rows(_BANK, _questions(), _cards())
    assert a == b                                # same input → identical rows

    # A word that already has its listening item is skipped on a re-run.
    qs = _questions() + [_q("w0_listen", "Word0", 99)]
    again = gen.build_rows(_BANK, qs, _cards())
    assert [r["qid"] for r in again] == ["w1_listen", "w2_listen", "w3_listen",
                                         "w4_listen", "w5_listen"]


def test_orders_continue_after_the_existing_questions():
    rows = gen.build_rows(_BANK, _questions(), _cards())
    assert [r["order"] for r in rows] == [6, 7, 8, 9, 10, 11]


def test_a_word_without_audio_or_meaning_is_skipped():
    cards = _cards()
    cards[0]["audio_headword"] = ""       # nothing to listen to
    cards[1]["definition_vi"] = ""        # nothing to choose
    cards[1]["gloss_vi"] = ""
    rows = gen.build_rows(_BANK, _questions(), cards)
    assert [r["item_key"] for r in rows] == ["Word2", "Word3", "Word4", "Word5"]


def test_a_bank_too_small_for_distractors_produces_nothing():
    """3 words → only 2 possible distractors. Emitting a 3-option MCQ (or padding
    it) would be worse than emitting nothing."""
    rows = gen.build_rows(_BANK, _questions(3), _cards(3))
    assert rows == []


def test_headword_matching_is_case_insensitive():
    cards = _cards()
    cards[0]["headword"] = "wORD0"
    rows = gen.build_rows(_BANK, _questions(), cards)
    assert rows[0]["item_key"] == "Word0"
    assert rows[0]["audio_url"] == "https://cdn/w0.mp3"


def test_the_correct_meaning_is_never_also_a_distractor():
    """Two words sharing a gloss must not produce an MCQ with two right answers."""
    cards = _cards()
    cards[1]["definition_vi"] = "nghĩa 0"      # same meaning as Word0
    rows = gen.build_rows(_BANK, _questions(), cards)
    w0 = next(r for r in rows if r["item_key"] == "Word0")
    assert w0["options"].count("nghĩa 0") == 1
