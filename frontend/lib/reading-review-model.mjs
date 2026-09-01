const ORIGINS = new Set(['full', 'mini', 'mock']);

const text = (value) => String(value ?? '').trim();
const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Parse only the stable identities accepted by the review surface. */
export function readingReviewParams(search) {
  const params = new URLSearchParams(search || '');
  const attemptId = text(params.get('attempt_id')) || null;
  const adminTestId = text(params.get('admin_test_id')) || null;
  const anonId = adminTestId ? null : (text(params.get('anon')) || null);
  const requestedOrigin = text(params.get('from'));
  const from = ORIGINS.has(requestedOrigin) ? requestedOrigin : 'full';
  const sittingId = from === 'mock' ? (text(params.get('sitting')) || null) : null;
  return Object.freeze({ attemptId, adminTestId, anonId, from, sittingId });
}

export function readingReviewBackTarget(params) {
  if (params?.from === 'mini') return { href: '/reading/mini-test', label: '← Mini tests' };
  if (params?.from === 'mock' && params?.sittingId) {
    return {
      href: `/mock/result?sitting=${encodeURIComponent(params.sittingId)}`,
      label: '← Kết quả thi thử',
    };
  }
  return { href: '/reading/test', label: '← Thư viện' };
}

/**
 * Fail closed on a malformed answer-key payload. A partially rendered review
 * can tell a learner that a missing answer is the canonical answer, so invalid
 * rows reject the whole response instead of being silently dropped.
 */
export function normalizeReadingReview(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-reading-review');
  if (!Array.isArray(payload.passages) || !Array.isArray(payload.review)) {
    throw new Error('invalid-reading-review');
  }

  const preview = payload.preview === true;
  if (text(payload.status) !== 'submitted') throw new Error('invalid-reading-review-status');
  const passages = payload.passages.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('invalid-reading-review-passage');
    const passageOrder = Number(row.passage_order);
    if (!Number.isInteger(passageOrder) || passageOrder < 1) {
      throw new Error('invalid-reading-review-passage');
    }
    return {
      ...row,
      passage_order: passageOrder,
      title: text(row.title) || `Passage ${passageOrder}`,
      body_markdown: String(row.body_markdown ?? ''),
      translation_vi: String(row.translation_vi ?? ''),
    };
  }).sort((a, b) => a.passage_order - b.passage_order);

  const passageOrders = new Set(passages.map((row) => row.passage_order));
  let orphanPassageOrder = null;
  const ensureOrphanPassage = () => {
    if (orphanPassageOrder !== null) return orphanPassageOrder;
    orphanPassageOrder = Math.max(0, ...passageOrders) + 1;
    passageOrders.add(orphanPassageOrder);
    passages.push({
      passage_order: orphanPassageOrder,
      title: 'Câu chưa gắn Passage',
      body_markdown: '',
      translation_vi: '',
      orphaned: true,
    });
    return orphanPassageOrder;
  };
  const seenQuestions = new Set();
  const review = payload.review.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('invalid-reading-review-item');
    const qNum = Number(row.q_num);
    const passageOrder = Number(row.passage_order);
    if (!Number.isInteger(qNum) || qNum < 1 || seenQuestions.has(qNum)
        || typeof row.correct !== 'boolean') {
      throw new Error('invalid-reading-review-item');
    }
    seenQuestions.add(qNum);
    return {
      ...row,
      q_num: qNum,
      // The backend intentionally preserves historical grading rows whose
      // passage was later removed or whose old row never stored an order.
      // Keep the answer-key row visible in one truthful orphan bucket instead
      // of bricking the whole submitted review.
      passage_order: Number.isInteger(passageOrder) && passageOrders.has(passageOrder)
        ? passageOrder
        : ensureOrphanPassage(),
      prompt: String(row.prompt ?? ''),
      question_type: String(row.question_type ?? ''),
      user_answer: String(row.user_answer ?? ''),
      expected: String(row.expected ?? ''),
      explanation: String(row.explanation ?? ''),
      solution: row.solution && typeof row.solution === 'object' ? row.solution : null,
      stepper: row.stepper && typeof row.stepper === 'object' ? row.stepper : null,
    };
  }).sort((a, b) => a.q_num - b.q_num);

  const skills = {};
  if (payload.skill_breakdown && typeof payload.skill_breakdown === 'object') {
    for (const [key, value] of Object.entries(payload.skill_breakdown)) {
      const correct = finiteNumber(value?.correct);
      const total = finiteNumber(value?.total);
      if (correct !== null && total !== null && total > 0 && correct >= 0 && correct <= total) {
        skills[key] = { correct, total };
      }
    }
  }

  const score = finiteNumber(payload.score);
  const band = finiteNumber(payload.band_estimate);
  const maxScore = finiteNumber(payload.max_score);
  if (!preview && (score === null || maxScore === null || maxScore < 0 || score < 0 || score > maxScore)) {
    throw new Error('invalid-reading-review-score');
  }

  return Object.freeze({
    attemptId: payload.attempt_id == null ? null : text(payload.attempt_id),
    status: 'submitted',
    testId: text(payload.test_id),
    title: text(payload.title) || text(payload.test_id) || 'Chữa bài Reading',
    preview,
    score,
    maxScore: maxScore ?? review.length,
    bandEstimate: band,
    skillBreakdown: skills,
    passages,
    review,
  });
}

export function readingReviewSkillRows(skillBreakdown, labels = {}) {
  return Object.entries(skillBreakdown || {}).map(([key, row]) => ({
    key,
    label: labels[key] || key,
    correct: row.correct,
    total: row.total,
    percent: row.total ? Math.round((row.correct / row.total) * 100) : 0,
  })).sort((a, b) => a.percent - b.percent || a.label.localeCompare(b.label));
}

const PLACEHOLDER_PROMPT = /^\s*\(?\s*see\s+(summary|notes|table|form)\s+above\s*\)?\s*\.?\s*$/i;

export function readingReviewPrompt(item) {
  const prompt = String(item?.prompt ?? '');
  if (prompt && !PLACEHOLDER_PROMPT.test(prompt)) return prompt;
  const authored = text(item?.solution?.question_text)
    .replace(/^["“”']+/, '').replace(/["“”']+$/, '').trim();
  return authored || prompt;
}

export function splitReviewProse(value) {
  return String(value ?? '').split(/;\s+|\.\s+/).map((part) => part.trim()).filter(Boolean);
}

export function splitReviewSteps(value) {
  const parts = String(value ?? '').split(/\s*\(\d+\)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts;
}

export function grammarKnowledgeHref(ref) {
  if (!ref || ref.type !== 'grammar' || !text(ref.category) || !text(ref.slug)) return null;
  const anchor = text(ref.anchor);
  return `/grammar/${encodeURIComponent(text(ref.category))}/${encodeURIComponent(text(ref.slug))}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
