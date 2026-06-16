"""band_rounding.py — deterministic IELTS overall-band rounding (P-1).

The overall writing band must follow the IELTS rounding rule, computed by the
BACKEND (not trusted to the model's self-round). The rule is round-half-UP to the
nearest 0.5: `.0`/`.5` unchanged, `.25 → +0.5` (6.25 → 6.5), `.75 → +1.0`
(6.75 → 7.0). The model's "nearest 0.5" is wrong at those .25/.75 boundaries.

The 4 per-criterion bands are integers, so the mean is always a multiple of 0.25;
`ielts_round` is written generally (round-half-up to 0.5) so it stays correct even
if a half-band ever sneaks into a criterion.
"""
import math


def ielts_round(x: float) -> float:
    """Round a raw band to the nearest 0.5, ties going UP (IELTS rule).

    6.0→6.0 · 6.25→6.5 · 6.5→6.5 · 6.75→7.0. Clamped to [0, 9].
    The +1e-9 guards the exact .75 boundary against float drift turning
    14.0 into 13.999… (which would wrongly round 6.75 down to 6.5).
    """
    x = max(0.0, min(9.0, float(x)))
    return math.floor(x * 2.0 + 0.5 + 1e-9) / 2.0


def overall_from_criteria(b1, b2, b3, b4) -> float:
    """Deterministic overall band = IELTS-round of the mean of the 4 criterion
    bands. This is the value GIVEN to the student — verified, not model-rounded."""
    mean = (float(b1) + float(b2) + float(b3) + float(b4)) / 4.0
    return ielts_round(mean)
