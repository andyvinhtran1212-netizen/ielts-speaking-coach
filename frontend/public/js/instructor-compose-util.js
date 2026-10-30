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
// Bare "overall" is a claim only before band/score, ":"/"=" or a score modifier
// ("is", "là", "hiện tại", "của bạn"…), or a valid band ending the clause
// (punctuation, a dash, or "/9"); counts are not claims.
const BAND_CLAIM = /(?:^|[^\p{L}\p{N}_])(?:band(?:\s+score)?|score|điểm|overall(?:\s+(?:band|score)|(?=\s*(?:[:=]|(?:hiện tại|tổng|của em|của bạn|bài này|là|is|ở|mức)\s))|(?=\s+(?:[0-8](?:[.,][05])?|9(?:[.,]0)?)(?![.,]?\d)(?:\/9|[ \t]*(?:[.!?;,:()"'”’\r\n—–]|$)|[ \t]+-(?:\s|$))))|kết\s+quả(?:\s+tổng\s+thể)?|your\s+(?:essay|writing)\s+(?:achieves|scores|is\s+at)|(?:bài(?:\s+(?:viết|làm))?(?:\s+(?:này|của\s+(?:em|bạn)))?|em|bạn)\s+(?:hiện\s+)?(?:đạt|ở(?:\s+mức)?))\s*(?:(?:hiện tại|tổng|của em|của bạn|bài này|là|is|ở|mức|band|score)\s+)*[:=]?\s*([0-9](?:[.,]\d+)?)(?![\p{L}\p{N}_]|[.,]\d|\s*(?:phút|câu|từ|đoạn|lần|ý|minutes?|words?|sentences?|paragraphs?|points?|ideas?|reasons?|examples?|arguments?|issues?|errors?|mistakes?|ý\s+chính|luận\s+điểm|lỗi)(?![\p{L}\p{N}_]))/giu;
const TARGET_BAND = /(?:^|[^\p{L}\p{N}_])(?:để\s+(?:lên|đạt(?:\s+được)?)|muốn[^.!?;:\n,]*?|to\s+(?:reach|achieve|get)|target|aim(?:ing)?\s+(?:for|at)|goal|mục\s+tiêu[^.!?;:\n,]*?)\s+(?:(?:is|là)\s+)?(?:(?:an?|the)\s+)?(?:band(?:\s+score)?|overall(?:\s+band)?(?:\s+score)?)(?:\s+of)?\s*(?:(?:is|là)\s+)?[:=]?\s*([0-9](?:[.,]\d+)?)(?![\p{L}\p{N}_]|[.,]\d)/giu;
const MISSING_IMAGE_CAVEAT_MARKER = 'Chấm không có hình';
const WARNING = '⚠️';
const MISSING_IMAGE_CAVEAT = '⚠️ Chấm không có hình — độ chính xác nội dung Task 1 Academic hạn chế. ';

function claims(sentence, overall) {
  // Compare target-number positions, rather than exempting the whole sentence.
  const targets = new Set([...sentence.matchAll(TARGET_BAND)]
    .filter((match) => Number(match[1].replace(',', '.')) >= overall)
    .map((match) => match.index + match[0].length));
  return [...sentence.matchAll(BAND_CLAIM)]
    .filter((match) => !targets.has(match.index + match[0].length))
    .map((match) => Number(match[1].replace(',', '.')));
}

function hasStaleClaim(sentence, overall) {
  return claims(sentence, overall).some((band) => band !== overall);
}

function hasCurrentClaim(sentence, overall) {
  return claims(sentence, overall).includes(overall);
}

function asSentence(text) {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : capitalised + '.';
}

// Drop a stale-claim sentence, but keep target advice after a ';'.
function withoutStaleClaim(sentence, overall) {
  if (!hasStaleClaim(sentence, overall)) return sentence;
  if (sentence.includes(';') && [...sentence.matchAll(TARGET_BAND)]
    .some((match) => Number(match[1].replace(',', '.')) >= overall)) {
    const clauses = sentence.split(';').map((clause) => clause.trim())
      .filter((clause) => clause && !hasStaleClaim(clause, overall));
    if (clauses.length) return asSentence(clauses.join('; '));
  }
  return null;
}

function summaryFlagsMissingImage(summary) {
  return summary.trimStart().startsWith('⚠️') && summary.includes(MISSING_IMAGE_CAVEAT_MARKER);
}

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
    const missingImage = summaryFlagsMissingImage(summary);
    const caveat = missingImage ? MISSING_IMAGE_CAVEAT : '';
    // Cut only the leading ⚠️ and the sentence/line holding the marker;
    // sentences written before the marker are content, not caveat.
    let body = summary;
    const leading = [];
    while (summaryFlagsMissingImage(body)) {
      body = body.trimStart().slice(WARNING.length);
      const marker = body.indexOf(MISSING_IMAGE_CAVEAT_MARKER);
      const start = [...body.slice(0, marker).matchAll(/[.!?]\s+|[\r\n]/g)]
        .reduce((_, match) => match.index + match[0].length, 0);
      if (body.slice(0, start).trim()) leading.push(asSentence(body.slice(0, start)));
      const markerEnd = marker + MISSING_IMAGE_CAVEAT_MARKER.length;
      const end = /[.!?](?:\s|$)|[\r\n]/.exec(body.slice(markerEnd));
      body = end ? body.slice(markerEnd + end.index + end[0].length).trimStart() : '';
    }
    body = [...leading, body].filter(Boolean).join(' ');
    const sentences = splitSentences(body);
    const kept = sentences.map((sentence) => withoutStaleClaim(sentence, overall))
      .filter((sentence) => sentence !== null);
    const removedClaim = sentences.some((sentence) => hasStaleClaim(sentence, overall));
    // A kept sentence may already state the final band; never repeat it.
    const addBand = removedClaim && !kept.some((sentence) => hasCurrentClaim(sentence, overall));
    if (removedClaim || caveat) {
      feedback.overallBandScoreSummary = caveat + (addBand ? `Bài viết đạt band ${overall.toFixed(1)}. ` : '')
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
