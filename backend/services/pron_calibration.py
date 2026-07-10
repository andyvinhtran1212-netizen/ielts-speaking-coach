"""pron_calibration — Azure pronunciation score → IELTS P band mapping (audit #2).

The audit's #2: `band = 1 + score/100·8` is an invented linear mapping with no
evidence (Azure native-speaker PronScore sits ~85–95, so the top of the scale is
unreachable and the whole range is compressed). The real fix is an EMPIRICAL
mapping fit to gold-set audio — but that needs data (blocked on A1, see
docs/TECH_DEBT_gold_set_A1.md).

This module is the drop-in the fix will use. Today it behaves EXACTLY like the
old inline formula (linear, 50/50 fluency blend, half-up to a whole band). When
a calibration table exists (fit with `fit_isotonic` once gold audio lands), it
maps through that instead — no other code changes. Pure, fully unit-tested.
"""

from __future__ import annotations

# ── the current (default) linear mapping — unchanged behaviour ────────────────

def _linear_score_to_band(score: float) -> float:
    """Azure 0–100 → IELTS 1–9, the historical `1 + score/100·8`."""
    return 1.0 + (float(score) / 100.0) * 8.0


# ── isotonic (monotonic) calibration, used once a table is fit ────────────────

def fit_isotonic(pairs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Pool-Adjacent-Violators isotonic regression.

    Input: (azure_score, reference_band) observations. Output: monotonic
    non-decreasing breakpoints [(score, band), …] sorted by score, suitable for
    piecewise-linear interpolation. Guarantees higher Azure score never maps to a
    lower band (the one property a P mapping must have). Pure, no numpy.
    """
    if not pairs:
        return []
    pts = sorted((float(x), float(y)) for x, y in pairs)
    xs = [x for x, _ in pts]

    # PAVA: each block = [sum_y, count]; merge left while it violates monotonicity
    blocks: list[list[float]] = []
    for _, y in pts:
        blocks.append([y, 1.0])
        while len(blocks) >= 2 and (blocks[-2][0] / blocks[-2][1]) > (blocks[-1][0] / blocks[-1][1]):
            sy, c = blocks.pop()
            blocks[-1][0] += sy
            blocks[-1][1] += c

    # expand each block's pooled mean back over its member points, in x order
    fitted: list[float] = []
    for sy, c in blocks:
        fitted.extend([sy / c] * int(c))

    # dedupe by x (keep the last fitted value at a repeated score), keep sorted
    dedup: dict[float, float] = {}
    for x, y in zip(xs, fitted):
        dedup[x] = y
    return sorted(dedup.items())


def interp(table: list[tuple[float, float]], score: float) -> float:
    """Piecewise-linear interpolation over isotonic breakpoints; clamps at ends."""
    if not table:
        return _linear_score_to_band(score)
    if score <= table[0][0]:
        return table[0][1]
    if score >= table[-1][0]:
        return table[-1][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x0 <= score <= x1:
            if x1 == x0:
                return y1
            t = (score - x0) / (x1 - x0)
            return y0 + t * (y1 - y0)
    return table[-1][1]


# ── public: the one call grading.py makes ─────────────────────────────────────

def pron_band(
    pron_score: float | None,
    fluency_score: float | None,
    table: list[tuple[float, float]] | None = None,
) -> float | None:
    """Azure pron (blended 50/50 with fluency) → whole-integer IELTS band 1–9.

    table=None ⇒ the historical linear mapping (default, zero behaviour change).
    A fitted isotonic table ⇒ empirical mapping. Rounding is half-up to a whole
    integer, matching the original `_pron_band_from_scores`.
    """
    if pron_score is None:
        return None
    to_band = (lambda s: interp(table, s)) if table else _linear_score_to_band
    band = to_band(pron_score)
    if fluency_score is not None:
        band = 0.5 * band + 0.5 * to_band(fluency_score)
    return float(max(1, min(9, int(band + 0.5))))
