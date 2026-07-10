"""Unit tests for services/fluency_signals — pure FC metrics from word times."""

from services import fluency_signals as fs


def _w(word, start, end):
    return {"word": word, "start": start, "end": end}


def test_none_when_too_few_words():
    assert fs.compute([]) is None
    assert fs.compute([_w("hi", 0.0, 0.3)]) is None


def test_basic_rates_and_no_pauses():
    # 4 words, tightly spaced (gaps ≤ 0.25s) → no pauses
    words = [_w("I", 0.0, 0.2), _w("really", 0.3, 0.7), _w("like", 0.8, 1.0), _w("it", 1.1, 1.3)]
    sig = fs.compute(words)
    assert sig["n_words"] == 4
    assert sig["n_pauses"] == 0
    assert sig["longest_pause_s"] == 0.0
    assert sig["speech_span_s"] == 1.3            # 1.3 - 0.0
    assert sig["speech_rate_wps"] == round(4 / 1.3, 2)


def test_detects_long_pause():
    # a 1.0s gap between word 2 and 3 → one pause
    words = [_w("I", 0.0, 0.3), _w("think", 0.4, 0.8), _w("um", 1.8, 2.0), _w("yes", 2.1, 2.4)]
    sig = fs.compute(words)
    assert sig["n_pauses"] == 1
    assert sig["longest_pause_s"] == 1.0          # 1.8 - 0.8
    assert sig["total_pause_s"] == 1.0
    assert sig["pause_ratio"] == round(1.0 / 2.4, 3)


def test_articulation_excludes_pauses():
    # articulation rate (per phonation time) is higher than speech rate (incl pause)
    words = [_w("a", 0.0, 0.2), _w("b", 2.0, 2.2)]
    sig = fs.compute(words)
    assert sig["articulation_rate_wps"] > sig["speech_rate_wps"]


def test_pause_threshold_configurable():
    words = [_w("a", 0.0, 0.2), _w("b", 0.5, 0.7)]  # gap 0.3s
    assert fs.compute(words, pause_threshold=0.25)["n_pauses"] == 1
    assert fs.compute(words, pause_threshold=0.5)["n_pauses"] == 0


def test_ignores_untimed_words():
    words = [_w("a", 0.0, 0.2), {"word": "b"}, _w("c", 0.3, 0.5)]
    sig = fs.compute(words)
    assert sig["n_words"] == 2


def test_unsorted_input_is_handled():
    words = [_w("c", 2.1, 2.4), _w("a", 0.0, 0.3), _w("b", 0.4, 0.8)]
    sig = fs.compute(words)
    assert sig["speech_span_s"] == 2.4


def test_summary_empty_for_none():
    assert fs.summary_for_prompt(None) == ""


def test_summary_mentions_measured_fluency():
    sig = fs.compute([_w("a", 0.0, 0.3), _w("b", 1.5, 1.8)])
    s = fs.summary_for_prompt(sig)
    assert "MEASURED FLUENCY" in s and "articulation rate" in s
