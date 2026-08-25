const SAFE_INTERNAL = /^\/(?![\\/])[^\u0000-\u001f\u007f]*$/;
const SUPPORTED_INPUTS = new Set(['choice', 'text', 'boolean', 'syllable']);

export function normalizeQuizQuery(input) {
  const source = input instanceof URLSearchParams ? input : new URLSearchParams(input || '');
  const scalar = (name) => {
    const values = source.getAll(name);
    if (values.length > 1) throw new Error(`duplicate-query:${name}`);
    const value = String(values[0] || '').trim();
    return value || null;
  };
  return Object.freeze({
    bank: scalar('bank'),
    skillArea: scalar('skill_area'),
    topicId: scalar('topic_id'),
  });
}

export function resolveQuizBank(query, payload) {
  if (query?.bank) return { kind: 'bank', bankId: query.bank };
  if (!query?.skillArea) return { kind: 'error', message: 'Thiếu tham số bank.' };
  if (!Array.isArray(payload)) return { kind: 'error', message: 'Dữ liệu danh sách bài không đúng định dạng.' };
  const rows = payload.filter((row) => row && typeof row.id === 'string' && row.id.trim());
  if (rows.length === 1) return { kind: 'bank', bankId: rows[0].id };
  if (!rows.length && !query.topicId) {
    return { kind: 'error', message: 'Chưa có bài luyện nào được mở. Vui lòng quay lại sau.' };
  }
  return { kind: 'redirect', href: '/vocabulary/practice' };
}

export function normalizeQuizBank(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const questions = Array.isArray(payload.questions)
    ? payload.questions.filter((row) => row
      && typeof row === 'object'
      && typeof row.qid === 'string'
      && row.qid.trim()
      && typeof row.item_key === 'string'
      && row.item_key.trim()
      && SUPPORTED_INPUTS.has(row.input))
    : null;
  const bank = payload.bank && typeof payload.bank === 'object' && !Array.isArray(payload.bank)
    ? payload.bank
    : null;
  if (!bank || !questions?.length) return null;
  const wordCards = payload.word_cards && typeof payload.word_cards === 'object' && !Array.isArray(payload.word_cards)
    ? payload.word_cards
    : {};
  return { ...payload, bank, questions, word_cards: wordCards };
}

export function quizAreaModel(bank) {
  const grammar = bank?.bank?.skill_area === 'grammar';
  const skillArea = typeof bank?.bank?.skill_area === 'string' ? bank.bank.skill_area : '';
  return Object.freeze({
    grammar,
    active: grammar ? 'grammar' : 'vocabulary',
    backHref: grammar ? '/grammar' : '/vocabulary/practice',
    backLabel: grammar ? 'Grammar' : 'Luyện tập',
    summaryBackLabel: grammar ? '← Về Grammar' : '← Về Luyện tập',
    statsHref: skillArea ? `/quiz/progress?skill_area=${encodeURIComponent(skillArea)}` : '/quiz/progress',
    masteredNoun: grammar ? 'Đã nắm' : 'Đã thuộc',
    hardestNoun: grammar ? 'Điểm khó nhất' : 'Từ khó nhất',
    progressPrefix: grammar ? 'Đã nắm ' : 'Đã thuộc ',
  });
}

export function displayItemKey(value, grammar) {
  const text = String(value || '');
  return grammar ? text.replaceAll('-', ' ') : text;
}

export function stripAudioToken(value) {
  return String(value || '').replace(/\s*(?:\*\*)?\{\{audio\}\}(?:\*\*)?\s*/g, ' ').trim();
}

export function correctAnswerText(question) {
  if (!question) return '';
  if (question.input === 'choice') return (question.options || [])[question.answer] ?? '';
  if (question.input === 'syllable') return (question.segments || [])[question.answer] ?? '';
  if (question.input === 'boolean') return question.answer === 1 || question.answer === true ? 'Đúng' : 'Sai';
  if (question.input === 'text') return Array.isArray(question.accept) ? question.accept[0] || '' : '';
  return '';
}

export function givenAnswerText(question, value) {
  if (!question) return '';
  if (question.input === 'choice') return (question.options || [])[value] ?? '';
  if (question.input === 'syllable') return (question.segments || [])[value] ?? '';
  if (question.input === 'boolean') return value ? 'Đúng' : 'Sai';
  return String(value ?? '');
}

function seededRandom(seed) {
  const text = String(seed || '');
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let value = hash >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6D2B79F5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledAnswerIndices(length, seed) {
  const random = seededRandom(seed);
  const indices = Array.from({ length: Math.max(0, Number(length) || 0) }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [indices[index], indices[other]] = [indices[other], indices[index]];
  }
  return indices;
}

export function safeQuizLink(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (SAFE_INTERNAL.test(text)) return text;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function quizResultModel(summary, durationSeconds, saved) {
  const totalQuestions = Number(summary?.total_questions) || 0;
  const totalCorrect = Number(summary?.total_correct) || 0;
  return Object.freeze({
    durationSeconds: Math.max(0, Math.round(Number(durationSeconds) || 0)),
    totalQuestions,
    totalCorrect,
    totalWrong: Number(summary?.total_wrong) || 0,
    mastered: Number(summary?.mastered) || 0,
    total: Number(summary?.total) || 0,
    accuracy: totalQuestions ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    carriedKeys: Array.isArray(summary?.carried_keys) ? summary.carried_keys.map(String) : [],
    hardest: summary?.hardest && typeof summary.hardest === 'object' ? summary.hardest : null,
    saved: saved === true,
  });
}

export function quizEndPayload(summary, durationSeconds, saved) {
  return Object.freeze({
    duration_sec: Math.max(0, Math.round(Number(durationSeconds) || 0)),
    total_questions: Number(summary?.total_questions) || 0,
    total_correct: Number(summary?.total_correct) || 0,
    total_wrong: Number(summary?.total_wrong) || 0,
    words_mastered: Number(summary?.mastered) || 0,
    words_carried_over: Number(summary?.carried_over) || 0,
    ended_by: saved === true ? 'completed' : 'paused',
  });
}
