"""backend/eval/metrics.py — pure-Python grading-agreement metrics.

Every function takes a list of ``(predicted, reference)`` band pairs and returns
a number. No numpy/sklearn (not installed) and no IO, so the math is trivially
unit-testable and deterministic.

IELTS bands are ordinal on a 0–9 scale in 0.5 steps (19 categories). Two graders
agreeing "6.5 vs 7.0" is a far smaller error than "4.0 vs 8.0"; plain accuracy
ignores that ordering, which is why the headline metric is the
quadratic-weighted kappa (QWK) — the standard measure for ordinal rater
agreement — reported alongside MAE and the human-facing ±0.5 rate.
"""

from __future__ import annotations

from typing import Iterable

Pair = tuple[float, float]  # (predicted_band, reference_band)


def _clean(pairs: Iterable[Pair]) -> list[Pair]:
    """Drop pairs where either side is None (criterion absent for that item —
    e.g. Speaking P when Azure had no audio, or an L1-nulled Writing section)."""
    return [(float(p), float(r)) for p, r in pairs if p is not None and r is not None]


def mae(pairs: Iterable[Pair]) -> float | None:
    """Mean absolute error |predicted − reference|. None if no usable pairs."""
    clean = _clean(pairs)
    if not clean:
        return None
    return sum(abs(p - r) for p, r in clean) / len(clean)


def bias(pairs: Iterable[Pair]) -> float | None:
    """Signed mean(predicted − reference). Positive ⇒ the grader is systematically
    generous; negative ⇒ harsh. MAE hides direction; bias exposes it."""
    clean = _clean(pairs)
    if not clean:
        return None
    return sum(p - r for p, r in clean) / len(clean)


def within_half_band(pairs: Iterable[Pair]) -> float | None:
    """Fraction of items where |predicted − reference| ≤ 0.5 — the human-facing
    'agrees to within half a band' rate. None if no usable pairs."""
    clean = _clean(pairs)
    if not clean:
        return None
    return sum(1 for p, r in clean if abs(p - r) <= 0.5 + 1e-9) / len(clean)


def quadratic_weighted_kappa(
    pairs: Iterable[Pair],
    min_rating: float = 0.0,
    max_rating: float = 9.0,
    step: float = 0.5,
) -> float | None:
    """Quadratic-weighted Cohen's kappa over the discretised band scale.

    1.0 = perfect agreement, 0.0 = agreement no better than chance, <0 = worse
    than chance. Bands are mapped to integer indices ``round((band-min)/step)``.

    Returns None if there are no usable pairs. When every reference AND every
    prediction is the identical band (no variance ⇒ expected-agreement
    denominator 0), kappa is undefined; we return 1.0 iff predictions match
    references on every item, else 0.0 — the intuitive limit.
    """
    clean = _clean(pairs)
    if not clean:
        return None

    n_cats = int(round((max_rating - min_rating) / step)) + 1

    def idx(band: float) -> int:
        return max(0, min(n_cats - 1, int(round((band - min_rating) / step))))

    ratings = [(idx(p), idx(r)) for p, r in clean]
    total = len(ratings)

    observed = [[0] * n_cats for _ in range(n_cats)]
    hist_pred = [0] * n_cats
    hist_ref = [0] * n_cats
    for pi, ri in ratings:
        observed[pi][ri] += 1
        hist_pred[pi] += 1
        hist_ref[ri] += 1

    denom_scale = (n_cats - 1) ** 2 or 1
    num = 0.0
    den = 0.0
    for i in range(n_cats):
        for j in range(n_cats):
            w = ((i - j) ** 2) / denom_scale
            expected = hist_pred[i] * hist_ref[j] / total
            num += w * observed[i][j]
            den += w * expected

    if den == 0:
        # No expected disagreement (a degenerate single-category distribution).
        return 1.0 if all(pi == ri for pi, ri in ratings) else 0.0
    return 1.0 - num / den


def boundary_confusion(pairs: Iterable[Pair], boundary: float = 6.5) -> dict:
    """Confusion around a decision boundary (default 6.5 → the 6/7 line the
    audit calls out as the one students care about most).

    A pair is a false-cross when the grader lands on the opposite side of the
    boundary from the human. Returns counts + the false-cross rate so a grader
    that's fine on MAE but flips 6↔7 gets caught.
    """
    clean = _clean(pairs)
    if not clean:
        return {"total": 0, "false_high": 0, "false_low": 0, "false_cross_rate": None}

    false_high = 0  # grader ≥ boundary but human < boundary (over-promotes)
    false_low = 0   # grader < boundary but human ≥ boundary (under-marks)
    for p, r in clean:
        p_hi = p >= boundary
        r_hi = r >= boundary
        if p_hi and not r_hi:
            false_high += 1
        elif r_hi and not p_hi:
            false_low += 1
    crosses = false_high + false_low
    return {
        "total": len(clean),
        "false_high": false_high,
        "false_low": false_low,
        "false_cross_rate": crosses / len(clean),
    }


def summarize(pairs: Iterable[Pair], boundary: float = 6.5) -> dict:
    """Full metric bundle for one criterion's (pred, ref) pairs."""
    clean = _clean(pairs)
    return {
        "n": len(clean),
        "mae": mae(clean),
        "bias": bias(clean),
        "within_half_band": within_half_band(clean),
        "qwk": quadratic_weighted_kappa(clean),
        "boundary": boundary_confusion(clean, boundary=boundary),
    }
