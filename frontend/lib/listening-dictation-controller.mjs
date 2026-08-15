const SAFE_AUDIO_PROTOCOLS = new Set(['https:', 'http:']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedRatio(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(code);
  return number;
}

function safeAudioUrl(value) {
  const raw = text(value);
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    if (SAFE_AUDIO_PROTOCOLS.has(parsed.protocol)) return parsed.toString();
  } catch {}
  throw new Error('invalid-dictation-audio');
}

export function dictationParams(search) {
  const params = new URLSearchParams(search || '');
  const testId = text(params.get('test_id'));
  if (!testId) throw new Error('missing-dictation-test');
  const rawSection = text(params.get('section'));
  const section = rawSection ? Number(rawSection) : null;
  if (rawSection && (!Number.isInteger(section) || section < 1)) {
    throw new Error('invalid-dictation-section');
  }
  return Object.freeze({ testId, section });
}

export function normalizeDictationBundle(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-bundle');
  const id = text(payload.id);
  if (!id) throw new Error('invalid-dictation-id');
  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((section) => {
    const sectionNum = Number(section?.section_num);
    if (!Number.isInteger(sectionNum) || sectionNum < 1) return null;
    const sentences = (Array.isArray(section?.sentences) ? section.sentences : [])
      .map((sentence) => text(sentence)).filter(Boolean);
    if (!sentences.length) return null;
    const timings = sentences.map((_, index) => {
      const timing = Array.isArray(section.timings) ? section.timings[index] : null;
      const start = Number(timing?.start);
      const end = Number(timing?.end);
      return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
        ? Object.freeze({ start, end }) : null;
    });
    const hints = sentences.map((_, index) => (
      Array.isArray(section.hints?.[index])
        ? section.hints[index].map(text).filter(Boolean).slice(0, 12)
        : []
    ));
    return Object.freeze({
      section_num: sectionNum,
      title: text(section.title) || `Section ${sectionNum}`,
      cue_start: Number.isFinite(Number(section.cue_start)) ? Math.max(0, Number(section.cue_start)) : null,
      sentences: Object.freeze(sentences),
      timings: Object.freeze(timings),
      hints: Object.freeze(hints),
    });
  }).filter(Boolean).sort((a, b) => a.section_num - b.section_num);
  if (!sections.length) throw new Error('empty-dictation-sections');
  return Object.freeze({
    id,
    test_id: text(payload.test_id) || id,
    title: text(payload.title) || 'Bài nghe',
    audio_url: safeAudioUrl(payload.audio_url),
    audio_duration_seconds: Math.max(0, finite(payload.audio_duration_seconds)),
    sections: Object.freeze(sections),
  });
}

export function normalizeDictationGrade(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-grade');
  const score = boundedRatio(payload.score, 'invalid-dictation-score');
  const totalWords = Number(payload.total_words);
  const correctWords = Number(payload.correct_words);
  if (!Number.isInteger(totalWords) || totalWords < 0 || !Number.isInteger(correctWords)
      || correctWords < 0 || correctWords > totalWords || !Array.isArray(payload.diff)) {
    throw new Error('invalid-dictation-grade-counts');
  }
  const diff = payload.diff.map((operation) => {
    const op = text(operation?.op);
    if (!['match', 'miss', 'wrong', 'extra'].includes(op)) return null;
    return Object.freeze({
      op,
      actual: typeof operation.actual === 'string' ? operation.actual : '',
      expected: typeof operation.expected === 'string' ? operation.expected : '',
      filler: operation.filler === true,
    });
  }).filter(Boolean);
  return Object.freeze({ score, is_correct: payload.is_correct === true, correct_words: correctWords, total_words: totalWords, diff: Object.freeze(diff) });
}

export function normalizeDictationReport(payload, expectedRequestId = null) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-report');
  const sessionId = text(payload.session_id || payload.id);
  const requestId = text(payload.client_request_id);
  if (!sessionId || (expectedRequestId && requestId !== expectedRequestId)) {
    throw new Error('invalid-dictation-receipt');
  }
  const totalSentences = Number(payload.total_sentences);
  const correctCount = Number(payload.correct_count);
  const totalWords = Number(payload.total_words);
  const correctWords = Number(payload.correct_words);
  if (![totalSentences, correctCount, totalWords, correctWords].every(Number.isInteger)
      || totalSentences < 0 || correctCount < 0 || correctCount > totalSentences
      || totalWords < 0 || correctWords < 0 || correctWords > totalWords) {
    throw new Error('invalid-dictation-report-counts');
  }
  return Object.freeze({
    session_id: sessionId,
    client_request_id: requestId || null,
    section_num: Number(payload.section_num) || null,
    total_time_seconds: Number.isFinite(Number(payload.total_time_seconds)) ? Math.max(0, Number(payload.total_time_seconds)) : null,
    total_sentences: totalSentences,
    correct_count: correctCount,
    accuracy: boundedRatio(payload.accuracy, 'invalid-dictation-report-score'),
    total_words: totalWords,
    correct_words: correctWords,
    error_trends: payload.error_trends && typeof payload.error_trends === 'object' ? payload.error_trends : {},
    results: Array.isArray(payload.results) ? payload.results : [],
  });
}

export function dictationReceiptKey(accountId, testId, sectionNum) {
  const account = text(accountId);
  const test = text(testId);
  const section = Number(sectionNum);
  if (!account || !test || !Number.isInteger(section) || section < 1) throw new Error('invalid-dictation-receipt-key');
  return `av:dictation:v1:${account}:${test}:${section}`;
}

export function dictationRequestId(cryptoProvider = globalThis.crypto) {
  if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
    return cryptoProvider.randomUUID();
  }
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('dictation-secure-random-unavailable');
  }
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeDictationReceipt(payload, identity) {
  if (!payload || typeof payload !== 'object') return null;
  const requestId = text(payload.requestId);
  const accountId = text(payload.accountId);
  const testId = text(payload.testId);
  const sectionNum = Number(payload.sectionNum);
  const createdAt = text(payload.createdAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      || accountId !== identity.accountId || testId !== identity.testId
      || sectionNum !== Number(identity.sectionNum) || !payload.submission
      || !Number.isFinite(Date.parse(createdAt))) return null;
  return Object.freeze({
    requestId, accountId, testId, sectionNum, createdAt, submission: payload.submission,
    localResults: Array.isArray(payload.localResults) ? payload.localResults : [],
    localReport: payload.localReport && typeof payload.localReport === 'object'
      ? payload.localReport : null,
  });
}

export function isMissingReceipt(error) {
  return Number(error?.status) === 404 || /\b404\b/.test(String(error?.message || ''));
}

export function topDictationWords(map, limit = 8) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map).map(([word, count]) => ({ word: text(word), count: Number(count) }))
    .filter((item) => item.word && Number.isInteger(item.count) && item.count > 0)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

export function formatDictationTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return minutes ? `${minutes} phút ${rest} giây` : `${rest} giây`;
}
