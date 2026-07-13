// Shared display-formatting helpers for IELTS band scores.

/**
 * Round a numeric band score to the nearest 0.5 (IELTS convention).
 * e.g. 4.7 → 4.5, 5.8 → 6.0
 */
function roundHalf(val) {
  return Math.round(val * 2) / 2;
}
