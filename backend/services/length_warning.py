"""
services.length_warning — Sprint 14.7

Soft length warning thresholds for IELTS Speaking responses.

Sprint 14.2 added a HARD reject gate (Part 1 < 15s, Part 2 < 80s,
Part 3 < 25s) that blocks submission entirely. Sprint 14.7 adds a
second tier — soft warnings — that *don't* block grading but enrich
feedback so the user understands a short-but-valid response may not
produce a high band:

  - Part 1 < 30s  (2× hard reject) — limited content for band ≥6.
  - Part 2 < 160s (2× hard reject) — under half the expected long-turn.
  - Part 3 < 50s  (2× hard reject) — insufficient elaboration depth.

Andy lock L7: thresholds are exactly 2× the hard reject so the gap
between "rejected" and "warned" stays predictable.

L8 has two output channels:

  1. ``prompt_context`` — injected into the grading user message so
     the grader notes the limitation in feedback naturally rather than
     silently capping bands.
  2. ``warning_fires: bool`` — surfaced to the frontend so a yellow
     banner stacks above the per-criterion feedback (L5/L9).
"""

from __future__ import annotations


# L7 — exactly 2× the Sprint 14.2 hard reject thresholds.
LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS: dict[int, float] = {
    1: 30.0,
    2: 160.0,
    3: 50.0,
}


def get_length_warning_context(
    part_num: int,
    duration_seconds: float,
) -> tuple[bool, str]:
    """Compute the (warning_fires, prompt_context) pair for a graded response.

    Args:
        part_num:         IELTS part — 1, 2, or 3.
        duration_seconds: Audio duration as measured by Whisper.

    Returns:
        warning_fires:   ``True`` if ``duration_seconds`` is below the
                         soft threshold for ``part_num``. The Sprint 14.2
                         hard reject runs *before* this — so any duration
                         reaching this function has already passed the
                         hard gate (above the floor, below the soft cap).
        prompt_context:  Sentence to splice into the grading user
                         message. Even when no warning fires we return
                         a confirmation sentence so the grader sees a
                         deterministic slot rather than a missing one
                         (avoids prompt template branching).

    Behaviour for unknown parts (defensive): returns
    ``(False, "")`` — never raise. Grading shouldn't fail on a
    malformed `part` field.
    """
    soft_threshold = LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS.get(part_num)
    if soft_threshold is None:
        return (False, "")

    if duration_seconds < soft_threshold:
        return (
            True,
            (
                f"Audio duration: {duration_seconds:.1f}s. Below the typical "
                f"{soft_threshold:.0f}s minimum for adequate Part {part_num} "
                f"responses. Limited content may constrain achievable band — "
                f"note in feedback if relevant. This is informational only; "
                f"do not penalise scores beyond what the transcript supports."
            ),
        )

    return (
        False,
        f"Audio duration: {duration_seconds:.1f}s. Adequate length for "
        f"Part {part_num}.",
    )
