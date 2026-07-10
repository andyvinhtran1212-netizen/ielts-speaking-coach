"""fluency_signals — real Fluency & Coherence signals from Whisper word
timestamps (audit #8).

Today FC is inferred from a coarse total-words / total-duration rate (claude_
grader), and Whisper's own filler-smoothing hides hesitation before it reaches
the grader. Word-level timestamps let us measure what FC actually cares about:
articulation rate (speech speed excluding pauses), and the pause profile
(count / longest / total / ratio) — silence a single average rate can't see.

Pure (no IO). Gated behind SPEAKING_WORD_TIMESTAMPS_ENABLED; the computed block
is fed into the FC prompt only when the flag is on, so it can be A/B'd against
the gold set before becoming the default (audit warns against shipping a grading
change unverified).
"""

from __future__ import annotations

# A gap between two words longer than this (seconds) counts as a hesitation pause.
DEFAULT_PAUSE_THRESHOLD = 0.25


def compute(words: list[dict], *, pause_threshold: float = DEFAULT_PAUSE_THRESHOLD) -> dict | None:
    """Fluency metrics from a list of ``{"word","start","end"}`` (seconds).

    Returns None when there aren't ≥ 2 timed words to measure. All rates are in
    words/second; times in seconds, rounded for logging/prompt use.
    """
    timed = [w for w in (words or []) if _has_times(w)]
    if len(timed) < 2:
        return None
    timed.sort(key=lambda w: w["start"])

    n = len(timed)
    speech_span = timed[-1]["end"] - timed[0]["start"]
    articulation_time = sum(max(0.0, w["end"] - w["start"]) for w in timed)

    gaps = [
        timed[i + 1]["start"] - timed[i]["end"]
        for i in range(n - 1)
        if timed[i + 1]["start"] - timed[i]["end"] > pause_threshold
    ]
    total_pause = sum(gaps)

    return {
        "n_words": n,
        "speech_span_s": round(speech_span, 2),
        # words per second of ACTUAL phonation — the FC-relevant "articulation rate"
        "articulation_rate_wps": round(n / articulation_time, 2) if articulation_time > 0 else None,
        # words per second including pauses — the coarse legacy-style rate
        "speech_rate_wps": round(n / speech_span, 2) if speech_span > 0 else None,
        "n_pauses": len(gaps),
        "longest_pause_s": round(max(gaps), 2) if gaps else 0.0,
        "total_pause_s": round(total_pause, 2),
        "mean_pause_s": round(total_pause / len(gaps), 2) if gaps else 0.0,
        "pause_ratio": round(total_pause / speech_span, 3) if speech_span > 0 else None,
    }


def summary_for_prompt(sig: dict | None) -> str:
    """One-line, human-readable FC evidence block for the grading prompt (empty
    string when no signals — so the prompt falls back to its usual heuristic)."""
    if not sig:
        return ""
    return (
        "MEASURED FLUENCY (from audio word-timing — use as EVIDENCE, not the sole score):\n"
        f"  articulation rate {sig.get('articulation_rate_wps')} w/s (excludes pauses); "
        f"{sig.get('n_pauses')} pause(s) > {DEFAULT_PAUSE_THRESHOLD}s, "
        f"longest {sig.get('longest_pause_s')}s, total {sig.get('total_pause_s')}s "
        f"({_pct(sig.get('pause_ratio'))} of speaking time silent).\n"
        "  Frequent long pauses ⇒ lower FC even if the rate looks fast; smooth flow with few "
        "pauses ⇒ higher FC. Do not reward fast speech that is choppy.\n"
    )


def _has_times(w) -> bool:
    return isinstance(w, dict) and isinstance(w.get("start"), (int, float)) and isinstance(w.get("end"), (int, float))


def _pct(ratio) -> str:
    return "—" if ratio is None else f"{ratio * 100:.0f}%"
