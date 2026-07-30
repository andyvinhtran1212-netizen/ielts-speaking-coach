"""Kokoro block → lesson pack conversion.

The converter's real acceptance test is the importer's own parser: a pack it
emits must come back from `parse_fulltest` with zero errors. These tests pin
that round trip for each supported question shape, plus the part that has no
source data and therefore must be derived — the per-question replay window.

The bundle has no question→audio mapping. The window is found by locating the
sentence that SAYS the answer, so the matching rules (digits read as words,
phone numbers read character by character, negative questions that no sentence
can contain) are the parts most likely to go quietly wrong.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from convert_kokoro_to_lesson import (                       # noqa: E402
    answer_variants, build_pack, find_window, make_test_id, spoken_forms,
)
from services.listening_fulltest_import import parse_fulltest  # noqa: E402


def seg(idx, text, start, end, speaker="narrator"):
    return {"index": idx, "speaker": speaker, "voice": "bm_george",
            "text": text, "start": start, "end": end}


def timing(segments, total=None):
    return {"audio": "x.wav", "sample_rate": 24000,
            "total_seconds": total if total is not None else segments[-1]["end"],
            "segments": segments}


# ── answer → spoken form ─────────────────────────────────────────────────────

def test_years_are_matched_as_spoken():
    assert "sixteen ten" in answer_variants("1610")
    assert "nineteen seventy five" in answer_variants("1975")
    assert "nineteen oh five" in answer_variants("1905")


def test_phone_numbers_match_both_readings():
    v = answer_variants("07938001323")
    assert "0 7 9 3 8 0 0 1 3 2 3" in v, "numerals kept but spaced"
    assert "zero seven nine three eight zero zero one three two three" in v


def test_small_numbers_and_dates():
    assert "sixty six" in answer_variants("66")
    assert spoken_forms(9) == {"nine"}
    assert "august the third" in answer_variants("3rd August")


# ── replay window ────────────────────────────────────────────────────────────

def test_window_is_the_sentence_that_says_the_answer():
    segs = [seg(1, "Welcome to the centre.", 0.0, 3.0),
            seg(2, "The centre first opened in nineteen seventy five.", 3.1, 8.0),
            seg(3, "A cafe is available.", 8.1, 11.0)]
    w = find_window({"acceptedAnswers": ["1975"]}, segs)
    assert w == (3.1, 8.0)


def test_window_resolves_an_mcq_letter_to_its_option_text():
    """MCQs often carry only `answerLetter`; the words in the audio are the
    correct option's text, so the letter has to be resolved first."""
    segs = [seg(1, "We close at four on weekends.", 0.0, 4.0),
            seg(2, "Membership is thirty five pounds.", 4.1, 8.0)]
    item = {"acceptedAnswers": [], "answerLetter": "B",
            "options": [["A", "twelve pounds"], ["B", "thirty five pounds"]]}
    assert find_window(item, segs) == (4.1, 8.0)


def test_negative_question_spans_the_options_that_ARE_mentioned():
    """"Which was NOT used?" is answered by absence — no sentence contains the
    answer. The evidence is the passage listing the options that are used."""
    segs = [seg(1, "Priya ran a questionnaire.", 0.0, 4.0),
            seg(2, "Tom did in-depth interviews.", 4.1, 8.0),
            seg(3, "We also used direct observation.", 8.1, 12.0)]
    item = {"question": "Which method was NOT used?", "answerLetter": "D",
            "acceptedAnswers": ["focus groups"],
            "options": [["A", "questionnaire"], ["B", "in-depth interviews"],
                        ["C", "direct observation"], ["D", "focus groups"]]}
    assert find_window(item, segs) == (0.0, 12.0)


def test_unlocatable_answer_returns_none_rather_than_a_guess():
    segs = [seg(1, "Something entirely unrelated.", 0.0, 4.0)]
    assert find_window({"acceptedAnswers": ["borogoves"]}, segs) is None


# ── full pack round trip ─────────────────────────────────────────────────────

def _items_completion():
    return [
        {"id": "A1", "taskType": "note-completion", "question": "Surname: __________",
         "acceptedAnswers": ["Chamberlain"], "wordLimit": "ONE WORD ONLY",
         "audio": {"accent": "en-GB"}, "part": 1},
        {"id": "A2", "taskType": "note-completion", "question": "Weekly rent: £ __________",
         "acceptedAnswers": ["90"], "wordLimit": "A NUMBER",
         "audio": {"accent": "en-GB"}, "part": 1},
    ]


def _segs_completion():
    return [seg(1, "Good morning, how can I help?", 0.0, 3.0),
            seg(2, "My name is Chamberlain.", 3.1, 7.0),
            seg(3, "The rent is ninety pounds a week.", 7.1, 12.0)]


def test_completion_pack_parses_clean_through_the_real_importer():
    pack = build_pack("Blk", _items_completion(), timing(_segs_completion()), "ILR-LIS-KKR")
    res = parse_fulltest(pack["qp"], pack["sol"], pack["timings"])
    assert res.errors == [], res.errors
    assert len(res.questions) == 2
    assert [q["answer"] for q in res.questions] == ["Chamberlain", "90"]
    assert all(q["audio_window"] for q in res.questions)


def test_mcq_pack_parses_clean_and_keeps_options():
    items = [{"id": "M1", "taskType": "mcq", "question": "What time does it close?",
              "options": [["A", "nine"], ["B", "five"]], "answerLetter": "B",
              "acceptedAnswers": [], "audio": {"accent": "en-GB"}, "part": 2}]
    segs = [seg(1, "We open early.", 0.0, 3.0), seg(2, "It closes at five.", 3.1, 8.0)]
    pack = build_pack("Blk", items, timing(segs), "ILR-LIS-KKR")
    res = parse_fulltest(pack["qp"], pack["sol"], pack["timings"])
    assert res.errors == [], res.errors
    assert res.questions[0]["answer"] == "B"
    assert res.questions[0]["options"], "MCQ options must survive into the pack"


def test_mixed_shapes_get_one_typed_heading_each():
    """A block mixing completion and MCQ must not classify as a single type —
    the second run would lose its questions."""
    items = _items_completion() + [
        {"id": "M1", "taskType": "mcq", "question": "Which class is most popular?",
         "options": [["A", "pottery"], ["B", "yoga"]], "answerLetter": "A",
         "acceptedAnswers": [], "audio": {"accent": "en-GB"}, "part": 1}]
    segs = _segs_completion() + [seg(4, "The pottery class is the most popular.", 12.1, 17.0)]
    pack = build_pack("Blk", items, timing(segs), "ILR-LIS-KKR")
    assert pack["qp"].count("<!-- qtype:") == 2
    res = parse_fulltest(pack["qp"], pack["sol"], pack["timings"])
    assert res.errors == [], res.errors
    assert len(res.questions) == 3


def test_audio_window_matches_timings_exactly():
    """`parse_fulltest` rejects an `audio://` window that drifts from
    timings.json by more than 0.1s. Both come from this converter, so a
    formatting slip (rounding one and not the other) would be a self-inflicted
    import failure."""
    pack = build_pack("Blk", _items_completion(), timing(_segs_completion()), "ILR-LIS-KKR")
    qs = pack["timings"]["sections"][0]["questions"]
    for n, w in qs.items():
        assert f"start={w['start']:.2f}&end={w['end']:.2f}&q={n}" in pack["sol"]
    assert parse_fulltest(pack["qp"], pack["sol"], pack["timings"]).errors == []


def test_unlocatable_question_aborts_the_block():
    items = [{"id": "X1", "taskType": "note-completion", "question": "Name: __________",
              "acceptedAnswers": ["Nobody"], "audio": {"accent": "en-GB"}, "part": 1}]
    with pytest.raises(ValueError, match="không định vị được"):
        build_pack("Blk", items, timing([seg(1, "Unrelated speech.", 0.0, 4.0)]), "ILR-LIS-KKR")


def test_test_id_is_filesystem_and_parser_safe():
    assert make_test_id("Gen_Contra_p01", "ILR-LIS-KKR") == "ILR-LIS-KKR-Gen-Contra-p01"
    assert " " not in make_test_id("Mock Test 4_Section 2", "ILR-LIS-KKR")


def test_every_question_reaches_the_quick_answer_key():
    """A dropped answer is silent: `parse_fulltest` only errors on questions it
    parsed, so an item missing from the key would import with a blank answer."""
    items = _items_completion()
    pack = build_pack("Blk", items, timing(_segs_completion()), "ILR-LIS-KKR")
    for n in range(1, len(items) + 1):
        assert f"| **{n}.** " in pack["sol"]


# ── whole-token matching ─────────────────────────────────────────────────────

def test_short_answer_does_not_match_inside_a_longer_token():
    """A substring test makes "9" match "19" and "art" match "start", producing
    a pack that parses fine but whose replay button jumps to the wrong sentence
    — a wrong window is worse than no window, because nothing flags it."""
    segs = [seg(1, "The course lasts 19 weeks in total.", 0.0, 5.0),
            seg(2, "The deposit is 9 pounds.", 5.1, 9.0)]
    assert find_window({"acceptedAnswers": ["9"]}, segs) == (5.1, 9.0)

    segs2 = [seg(1, "Please start at the entrance.", 0.0, 4.0),
             seg(2, "The art gallery is upstairs.", 4.1, 8.0)]
    assert find_window({"acceptedAnswers": ["art"]}, segs2) == (4.1, 8.0)


def test_multiword_answer_still_matches_across_tokens():
    segs = [seg(1, "Just bring comfortable shoes.", 0.0, 4.0)]
    assert find_window({"acceptedAnswers": ["comfortable shoes"]}, segs) == (0.0, 4.0)


def test_negative_detection_is_case_insensitive():
    """IELTS capitalises NOT, but the corpus does not always."""
    segs = [seg(1, "Priya ran a questionnaire.", 0.0, 4.0),
            seg(2, "Tom did interviews.", 4.1, 8.0)]
    item = {"question": "Which method was not used?", "answerLetter": "C",
            "acceptedAnswers": ["focus groups"],
            "options": [["A", "questionnaire"], ["B", "interviews"],
                        ["C", "focus groups"]]}
    assert find_window(item, segs) == (0.0, 8.0)


def test_repeated_answer_is_disambiguated_by_the_block_commentary():
    """IELTS self-correction: the answer number is said twice, the first time
    as the distractor. Taking the first hit would anchor replay to the wrong
    sentence with nothing downstream able to tell."""
    segs = [seg(1, "Day entry costs 9 pounds for children.", 0.0, 4.0),
            seg(2, "Annual membership is 9 pounds a month now.", 4.1, 9.0)]
    item = {"acceptedAnswers": ["9"],
            "coreInfo": "annual membership 9 pounds a month"}
    assert find_window(item, segs) == (4.1, 9.0)


def test_repeated_answer_with_no_tiebreaker_is_reported_not_hidden():
    """No rule picks correctly here (the answer is said twice with nothing to
    separate them), and refusing would discard the block over a field that only
    drives the replay button. So take the first and SAY it is unsure — the one
    thing that must not happen is passing the guess off as fact."""
    from convert_kokoro_to_lesson import assign_windows
    segs = [seg(1, "The fee is 9 pounds.", 0.0, 4.0),
            seg(2, "The deposit is 9 pounds.", 4.1, 8.0)]
    windows, unsure = assign_windows([{"acceptedAnswers": ["9"]}], segs)
    assert windows[1] == (0.0, 4.0)
    assert unsure == [1], "an unresolved window must be reported"


def test_resolved_window_is_not_flagged_unsure():
    from convert_kokoro_to_lesson import assign_windows
    segs = [seg(1, "The fee is 9 pounds.", 0.0, 4.0),
            seg(2, "The deposit is 250 pounds.", 4.1, 8.0)]
    windows, unsure = assign_windows([{"acceptedAnswers": ["250"]}], segs)
    assert windows[1] == (4.1, 8.0) and unsure == []
