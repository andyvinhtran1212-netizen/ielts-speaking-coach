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

// Mirror services/writing_band_consistency.py. Shared fixtures verify that
// the learner preview and the persisted composed version have identical prose.
// Unicode classes avoid lookbehind so this also works in Safari 15.
const BAND_CLAIM = /(?:^|[^\p{L}\p{N}_])(?:band(?:\s+score)?|score|điểm|(?:bài(?:\s+viết)?(?:\s+(?:này|của\s+(?:em|bạn)))?|em|bạn)\s+(?:hiện\s+)?(?:đạt|ở(?:\s+mức)?))\s*(?:(?:hiện tại|tổng|của em|của bạn|bài này|là|ở|mức|band|score)\s+)*[:=]?\s*[0-9](?:[.,]\d+)?(?![\p{L}\p{N}_]|[.,]\d|\s*(?:phút|câu|từ|đoạn|lần|ý|minutes?|words?|sentences?|paragraphs?)(?![\p{L}\p{N}_]))/iu;
const MISSING_IMAGE_CAVEAT = '⚠️ Chấm không có hình — độ chính xác nội dung Task 1 Academic hạn chế. ';

function validBand(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 9 ? number : null;
}

function splitSentences(body) {
  const separator = /[.!?]\s+/g;
  const sentences = [];
  let start = 0;
  let match;
  while ((match = separator.exec(body)) !== null) {
    sentences.push(body.slice(start, match.index + 1));
    start = separator.lastIndex;
  }
  sentences.push(body.slice(start));
  return sentences;
}

function alignOverallBandFeedback(feedback, overall) {
  const modelBand = feedback.overallBandScore;
  feedback.overallBandScore = overall;
  const value = feedback.bandTrajectoryAnalysis;
  const trajectory = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const changed = modelBand !== overall || (trajectory && validBand(trajectory.current_band) !== overall);
  if (changed) {
    const summary = feedback.overallBandScoreSummary || '';
    const missingImage = summary.trimStart().startsWith('⚠️') && summary.includes('Chấm không có hình');
    const caveat = missingImage ? MISSING_IMAGE_CAVEAT : '';
    let body = caveat ? summary.trimStart() : summary;
    if (caveat && body.startsWith(caveat)) body = body.slice(caveat.length);
    const sentences = splitSentences(body);
    const kept = sentences.filter((sentence) => !BAND_CLAIM.test(sentence));
    if (kept.length !== sentences.length) {
      feedback.overallBandScoreSummary = `${caveat}Bài viết đạt band ${overall.toFixed(1)}. `
        + (kept.join(' ') || 'Hãy dựa vào nhận xét theo từng tiêu chí để chọn điểm cần cải thiện.');
    }
  }
  if (!trajectory) return;
  trajectory.current_band = overall;
  if (!changed) return;
  let explanation = `Bài này đạt band ${overall.toFixed(1)}`;
  const average = validBand(trajectory.average_last_5);
  if (average !== null) {
    const comparison = overall > average ? 'cao hơn' : overall < average ? 'thấp hơn' : 'bằng';
    explanation += `, ${comparison} mức trung bình 5 bài gần nhất (${average})`;
  }
  trajectory.trend_explanation = explanation + '.';
  trajectory.next_target = overall < 9
    ? `Mục tiêu tiếp theo là band ${Math.min(9, overall + 0.5).toFixed(1)}; ưu tiên cải thiện theo nhận xét ở từng tiêu chí.`
    : 'Duy trì band 9.0 và tiếp tục luyện tập để giữ chất lượng ổn định.';
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
  alignOverallBandFeedback(out, overallFromPicks(pickedBands));
  return out;
}
