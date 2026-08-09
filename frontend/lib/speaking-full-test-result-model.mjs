const VALID_STATUSES = new Set(['ready', 'pending', 'failed', 'sealed']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function band(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 9 ? number : null;
}

function score(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

function normalizePart(raw, expectedPart) {
  if (!raw || Number(raw.part) !== expectedPart) return null;
  const sessionId = text(raw.session_id);
  if (!sessionId) return null;
  const keyFeedback = raw.key_feedback && typeof raw.key_feedback === 'object'
    ? {
        strength: text(raw.key_feedback.strength) || null,
        improvement: text(raw.key_feedback.improvement) || null,
      }
    : null;
  return {
    part: expectedPart,
    sessionId,
    topic: text(raw.topic) || 'Chưa có chủ đề',
    status: text(raw.status) || 'unknown',
    questionCount: Math.max(0, Number.parseInt(raw.questions_count, 10) || 0),
    band: band(raw.band_avg),
    keyFeedback: keyFeedback?.strength || keyFeedback?.improvement ? keyFeedback : null,
  };
}

function normalizePronunciation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {
    responseCount: Math.max(0, Number.parseInt(raw.response_count, 10) || 0),
    overall: score(raw.overall),
    accuracy: score(raw.accuracy),
    fluency: score(raw.fluency),
    completeness: score(raw.completeness),
    prosody: score(raw.prosody),
  };
  return [result.overall, result.accuracy, result.fluency, result.completeness, result.prosody]
    .some((value) => value != null) ? result : null;
}

export function buildFullTestResult(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const resultStatus = VALID_STATUSES.has(source.result_status) ? source.result_status : 'pending';
  const rawParts = Array.isArray(source.parts) ? source.parts : [];
  const parts = [1, 2, 3]
    .map((expected) => normalizePart(rawParts.find((part) => Number(part?.part) === expected), expected))
    .filter(Boolean);
  const ready = resultStatus === 'ready' && source.results_ready === true && parts.length === 3;

  return {
    resultStatus,
    ready,
    sealed: resultStatus === 'sealed' || source.results_sealed === true,
    failed: resultStatus === 'failed',
    chainVerified: source.chain_verified === true,
    attemptId: text(source.full_test_attempt_id) || null,
    startedAt: text(source.started_at) || null,
    overallBand: ready ? band(source.overall_band) : null,
    criteria: ready ? [
      { key: 'fc', label: 'Fluency & Coherence', shortLabel: 'FC', value: band(source.band_fc) },
      { key: 'lr', label: 'Lexical Resource', shortLabel: 'LR', value: band(source.band_lr) },
      { key: 'gra', label: 'Grammar & Accuracy', shortLabel: 'GRA', value: band(source.band_gra) },
      { key: 'p', label: 'Pronunciation', shortLabel: 'P', value: band(source.band_p) },
    ] : [],
    parts,
    strengths: ready ? stringList(source.top_strengths) : [],
    improvements: ready ? stringList(source.top_improvements) : [],
    grammarIssues: ready ? stringList(source.top_grammar_issues) : [],
    pronunciation: ready ? normalizePronunciation(source.pronunciation) : null,
  };
}

export function fullTestSummaryPath({ p1, p2 = '', p3 = '' }) {
  const primary = text(p1);
  if (!primary) return '';
  const query = new URLSearchParams();
  if (text(p2)) query.set('p2_id', text(p2));
  if (text(p3)) query.set('p3_id', text(p3));
  const suffix = query.toString();
  return `/sessions/${encodeURIComponent(primary)}/full-test-summary${suffix ? `?${suffix}` : ''}`;
}

export function bandTone(value) {
  const parsed = band(value);
  if (parsed == null) return 'band-none';
  if (parsed >= 7) return 'band-high';
  if (parsed >= 6) return 'band-mid';
  if (parsed >= 5) return 'band-warn';
  return 'band-low';
}
