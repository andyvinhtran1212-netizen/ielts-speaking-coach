/**
 * frontend/js/instructor-compose-util.js — F2 mix ($0) pure helpers.
 *
 * Side-effect-free + ES-exported so they're unit-testable in node (the DOM
 * controller instructor-compose.js imports them). The assembly mirrors the
 * BACKEND essay_service.compose_version exactly so the preview matches what the
 * server commits: each criterion takes the WHOLE criteriaFeedback.<crit>
 * sub-object from ONE picked version (band + feedback together); non-criteria
 * content is base-derived; the overall band is recomputed from the 4 picked
 * bands (IELTS round-half-up — same as the backend overall_from_criteria).
 */

export const MIX_CRITERIA = [
  'mainCriterion', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange',
];

// IELTS overall = round the mean of the 4 criterion bands to the nearest 0.5
// (round-half-up). Matches services/band_rounding.overall_from_criteria; this
// value is DISPLAY-only — the server recomputes it authoritatively on commit.
export function roundHalf(val) {
  return Math.round(Number(val) * 2) / 2;
}

export function overallFromPicks(bands) {
  const nums = bands.map(Number);
  return roundHalf(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Assemble the composed feedback_json from per-criterion picks.
 *
 * @param {Object<number,Object>} versionsById  version → its feedback_json
 * @param {number} baseVersion                  version whose non-criteria content is kept
 * @param {Object} picks                        {mainCriterion,…: <version>} per criterion
 * @returns {Object} composed feedback_json (base-derived + 4 picked criteria + recomputed overall)
 */
export function assembleComposed(versionsById, baseVersion, picks) {
  const base = versionsById[baseVersion];
  if (!base) throw new Error('base_version ' + baseVersion + ' not found');

  // Base-derived: keep ALL non-criteria content from the base version.
  const out = JSON.parse(JSON.stringify(base));
  const cf = Object.assign({}, base.criteriaFeedback || {});

  const pickedBands = [];
  for (const crit of MIX_CRITERIA) {
    const srcV = picks[crit];
    const src = versionsById[srcV];
    if (!src || !src.criteriaFeedback || !src.criteriaFeedback[crit]) {
      throw new Error('criterion ' + crit + ' missing in version ' + srcV);
    }
    // WHOLE sub-object from ONE version — band + feedback never split.
    cf[crit] = JSON.parse(JSON.stringify(src.criteriaFeedback[crit]));
    pickedBands.push(cf[crit].bandScore);
  }
  out.criteriaFeedback = cf;
  // Mix overall ≠ any source's → recompute from the 4 picked bands.
  out.overallBandScore = overallFromPicks(pickedBands);
  return out;
}
