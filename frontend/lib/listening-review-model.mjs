const ORIGINS = new Set(['full', 'mini', 'drill', 'practice', 'mock']);

const text = (value) => String(value ?? '').trim();
const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function listeningReviewParams(search) {
  const query = new URLSearchParams(search || '');
  const attemptId = text(query.get('attempt_id')) || null;
  const adminTestId = text(query.get('admin_test_id')) || null;
  const requestedOrigin = text(query.get('from'));
  const from = ORIGINS.has(requestedOrigin) ? requestedOrigin : 'full';
  const sittingId = from === 'mock' ? (text(query.get('sitting')) || null) : null;
  return Object.freeze({ attemptId, adminTestId, from, sittingId });
}

export function listeningReviewBackTarget(params) {
  if (params?.from === 'mini') return { href: '/listening/mini-test', label: '← Mini tests' };
  if (params?.from === 'drill') return { href: '/listening/skills', label: '← Luyện kĩ năng' };
  if (params?.from === 'practice') return { href: '/listening/practice', label: '← Luyện nhanh' };
  if (params?.from === 'mock' && params?.sittingId) {
    return {
      href: `/mock/result?sitting=${encodeURIComponent(params.sittingId)}`,
      label: '← Kết quả thi thử',
    };
  }
  return { href: '/listening/tests', label: '← Listening tests' };
}

function normalizeWindow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = finiteNumber(raw.start);
  const end = finiteNumber(raw.end);
  if (start === null || end === null || start < 0 || end <= start) return null;
  return {
    start,
    end,
    section: text(raw.section) || null,
  };
}

export function normalizeListeningReview(payload) {
  if (!payload || typeof payload !== 'object'
      || !Array.isArray(payload.sections) || !Array.isArray(payload.review)) {
    throw new Error('invalid-listening-review');
  }
  if (text(payload.status) !== 'submitted') throw new Error('invalid-listening-review-status');

  const preview = payload.preview === true;
  const seenSections = new Set();
  const sections = payload.sections.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('invalid-listening-review-section');
    const sectionNum = Number(row.section_num);
    if (!Number.isInteger(sectionNum) || sectionNum < 1 || seenSections.has(sectionNum)) {
      throw new Error('invalid-listening-review-section');
    }
    seenSections.add(sectionNum);
    return {
      ...row,
      section_num: sectionNum,
      title: text(row.title),
      theme: text(row.theme),
      transcript: String(row.transcript ?? ''),
    };
  }).sort((a, b) => a.section_num - b.section_num);

  const seenQuestions = new Set();
  const review = payload.review.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('invalid-listening-review-item');
    const qNum = Number(row.q_num);
    if (!Number.isInteger(qNum) || qNum < 1 || seenQuestions.has(qNum)
        || typeof row.correct !== 'boolean') {
      throw new Error('invalid-listening-review-item');
    }
    seenQuestions.add(qNum);
    // JSON null must stay "no anchor". Number(null) is 0 and would make a
    // question without alignment falsely highlight the first transcript row.
    const anchor = row.transcript_anchor == null ? null : Number(row.transcript_anchor);
    return {
      ...row,
      q_num: qNum,
      correct: row.correct,
      user_answer: String(row.user_answer ?? ''),
      expected: String(row.expected ?? ''),
      question_type: text(row.question_type),
      prompt: String(row.prompt ?? ''),
      section: text(row.section) || null,
      transcript_anchor: anchor !== null && Number.isInteger(anchor) && anchor >= 0 ? anchor : null,
      audio_window: normalizeWindow(row.audio_window),
      solution: row.solution && typeof row.solution === 'object' ? row.solution : {},
    };
  }).sort((a, b) => a.q_num - b.q_num);

  const score = finiteNumber(payload.score);
  const maxScore = finiteNumber(payload.max_score);
  const bandEstimate = finiteNumber(payload.band_estimate);
  if (!preview && (score === null || maxScore === null || maxScore < 0
      || score < 0 || score > maxScore)) {
    throw new Error('invalid-listening-review-score');
  }

  const bandConversion = Array.isArray(payload.band_conversion)
    ? payload.band_conversion.filter((row) => finiteNumber(row?.band) !== null)
    : [];

  return Object.freeze({
    attemptId: payload.attempt_id == null ? null : text(payload.attempt_id),
    status: 'submitted',
    testId: text(payload.test_id),
    title: text(payload.title) || text(payload.test_id) || 'Chữa bài Listening',
    preview,
    score,
    maxScore: maxScore ?? review.length,
    bandEstimate,
    bandConversion,
    audioUrl: text(payload.audio_url),
    audioDuration: Math.max(0, finiteNumber(payload.audio_duration) || 0),
    sections,
    review,
  });
}

export function listeningBandLabel(review) {
  if (review?.bandEstimate !== null && review?.bandEstimate !== undefined) {
    return `Band ${Number(review.bandEstimate).toFixed(1)}`;
  }
  const bands = (review?.bandConversion || []).map((row) => finiteNumber(row?.band))
    .filter((value) => value !== null);
  if (!bands.length) return 'Chưa đủ band';
  return `Dưới band ${Math.min(...bands).toFixed(1)}`;
}

export function listeningTranscriptParagraphs(raw) {
  return String(raw ?? '').split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
    .map((paragraph) => {
      const match = /^\*\*([^*]+?)\*\*\s*([\s\S]*)$/.exec(paragraph);
      return {
        speaker: match ? text(match[1]).replace(/[\s:]+$/, '') : '',
        text: text(match ? match[2] : paragraph).replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' '),
      };
    });
}

export function listeningSkillsToPractise(items, labels = {}) {
  const tally = {};
  for (const item of items || []) {
    if (item?.correct) continue;
    const skills = String(item?.solution?.skills || '').match(/K[1-8]/g) || [];
    for (const code of skills) tally[code] = (tally[code] || 0) + 1;
  }
  return Object.entries(tally).map(([code, count]) => ({
    code,
    count,
    label: labels[code] || code,
  })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function listeningReviewSection(item) {
  const raw = item?.audio_window?.section || item?.section;
  const value = Number(String(raw || '').replace(/\D/g, ''));
  return Number.isInteger(value) && value > 0 ? value : null;
}
