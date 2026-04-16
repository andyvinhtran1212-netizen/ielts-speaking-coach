-- Migration 008: Add post-hoc pronunciation-adjusted band score columns to responses
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Purpose:
--   After Azure Pronunciation Assessment completes asynchronously, the pronunciation
--   endpoint writes adjusted band scores here — no re-grading, no architecture change.
--
-- New columns:
--   final_band_p         — pronunciation-adjusted P criterion band (1.0–9.0, 0.5 steps)
--                          NULL until pronunciation assessment fires for this response.
--   final_overall_band   — recomputed overall band after P adjustment
--                          NULL until pronunciation assessment fires.
--
-- Adjustment logic (see pronunciation.py _compute_adjusted_band_p):
--   delta  = scaled_pron_band − band_p_original
--   cap    = ±0.5 (low reliability) | ±0.75 (medium) | ±1.0 (high)
--   adjustment = clamp(delta × 0.4, −cap, +cap)   ← 40% dampening factor
--   final_band_p = _round_band(band_p_original + adjustment)
--
-- final_overall_band is recomputed as simple average of the 4 criteria after P is updated.
-- In practice mode (no band_p), a proportional ±0.25 adjustment is applied to overall_band.

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS final_band_p       FLOAT,
  ADD COLUMN IF NOT EXISTS final_overall_band FLOAT;

-- Index for admin monitoring of how often pronunciation adjustments fire
CREATE INDEX IF NOT EXISTS idx_responses_final_band_p
  ON responses (final_band_p)
  WHERE final_band_p IS NOT NULL;
