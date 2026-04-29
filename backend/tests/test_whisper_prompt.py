"""
Pin Whisper's verbatim prompt against instruction-style phrasing.

Phase 2.5 dogfood Day 2 caught one production transcript that began with
the literal text "Transcribe every word exactly as spoken..." repeated
three times.  whisper-1 treats `prompt` as STYLE CONTEXT, not as a system
instruction, so instruction-style phrasing can echo into the output.

These tests don't call the Whisper API — they just inspect the constant
to fail any future regression that re-introduces forbidden phrasing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_verbatim_prompt_no_instructions():
    """The prompt must not contain instruction verbs/clauses that Whisper
    has been observed to echo verbatim into the transcript."""
    from services.whisper import _VERBATIM_PROMPT

    forbidden_phrases = [
        "transcribe every",
        "do not fix",
        "exactly as spoken",
        "repetitions, and self-corrections",
        "transcribe ",
        "include ",
    ]

    prompt_lower = _VERBATIM_PROMPT.lower()
    for phrase in forbidden_phrases:
        assert phrase not in prompt_lower, (
            f"_VERBATIM_PROMPT contains instruction phrase {phrase!r}; "
            "whisper-1 has been observed to echo this kind of phrasing into "
            "the transcript output.  Use disfluency-example style only."
        )


def test_verbatim_prompt_has_disfluency_context():
    """The prompt must still bias Whisper toward preserving disfluencies —
    that's the whole point of using a prompt at all."""
    from services.whisper import _VERBATIM_PROMPT

    expected_disfluencies = ["um", "er", "like", "well", "so", "uh"]
    prompt_lower = _VERBATIM_PROMPT.lower()

    found = sum(1 for d in expected_disfluencies if d in prompt_lower)
    assert found >= 3, (
        f"_VERBATIM_PROMPT should contain at least 3 disfluency examples; "
        f"found {found}.  Without them whisper-1 normalizes filler words out."
    )


def test_verbatim_prompt_under_token_budget():
    """OpenAI recommends Whisper prompt < 224 tokens (~896 chars).

    We keep a generous safety margin (800 chars) because Vietnamese names
    or very long disfluency lists could push close to the cap; staying well
    under means we never have to debug a silent truncation.
    """
    from services.whisper import _VERBATIM_PROMPT
    assert len(_VERBATIM_PROMPT) < 800, (
        f"_VERBATIM_PROMPT is {len(_VERBATIM_PROMPT)} chars — approaching "
        "Whisper's 224-token / ~896-char prompt cap.  Trim it."
    )
