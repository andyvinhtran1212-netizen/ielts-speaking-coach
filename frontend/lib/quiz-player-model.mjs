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

export function normalizeQuizBank(payload, { expectedBankId } = {}) {
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
  if (expectedBankId !== undefined && bank.id !== expectedBankId) return null;
  const wordCards = payload.word_cards && typeof payload.word_cards === 'object' && !Array.isArray(payload.word_cards)
    ? payload.word_cards
    : {};
  const normalized = { ...payload, bank, questions, word_cards: wordCards };
  const declared = Object.hasOwn(bank.meta || {}, 'text_match_by_qid');
  const managed = payload.grammar != null || bank.grammar_canonical_code != null
    || bank.grammar_revision != null || bank.grammar_is_current === true;
  if (managed || declared) {
    try {
      const canonical = canonicalQuizBankPolicy(payload, expectedBankId);
      if (questions.length !== canonical.questions.length) return null;
      if (canonical.questions.some((question) => Object.hasOwn(question, 'bank_id') && question.bank_id !== canonical.bankId)) return null;
      if (managed && canonical.questions.some((question) => typeof question.skill !== 'string' || !question.skill.trim())) return null;
      if (!managed && canonical.policy.requiresAck) return null;
      normalized.engineBank = { meta: canonical.meta, questions: canonical.questions };
      normalized.questions = canonical.questions;
      normalized.managed = managed ? grammarContext(bank, payload.grammar, canonical.policy.requiresAck) : null;
    } catch { return null; }
  }
  return normalized;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^[0-9a-f]{64}$/;
const validUuid = (value) => typeof value === 'string' && UUID.test(value);
const validRevision = (value) => typeof value === 'string' && REVISION.test(value);
// Runtime floor of the generated ManagedGrammarSessionState canonical_code enum.
export const CANONICAL_GRAMMAR_CODES = Object.freeze([
  'G-parts-of-speech-verbs', 'G-sentence-structures-passive-voice',
  'G-tenses-past-continuous', 'G-tenses-present-continuous',
  'G-tenses-present-perfect-continuous', 'G-tenses-present-simple',
  'G-grammar-for-reading-participle-clauses', 'G-grammar-for-reading-long-sentence-untangling',
  'G-grammar-for-reading-reduced-relative-clauses', 'G-tenses-past-perfect',
  'G-foundations-phrase-vs-clause', 'G-error-clinic-dangling-modifiers',
]);
const validCanonicalCode = (value) => typeof value === 'string' && CANONICAL_GRAMMAR_CODES.includes(value);
const STATE_FLAGS = ['new_starts_enabled', 'can_continue_legacy', 'can_continue_current', 'mastery_retained'];
const record = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

function grammarContext(bank, value, requiresAck) {
  if (bank.skill_area !== 'grammar' || !validUuid(bank.id) || !validRevision(bank.grammar_revision)
      || !validCanonicalCode(bank.grammar_canonical_code)
      || typeof bank.grammar_is_current !== 'boolean') throw new Error('quiz-grammar-owner-invalid');
  const context = Object.freeze({ bankId: bank.id, revision: bank.grammar_revision,
    canonicalCode: bank.grammar_canonical_code, isCurrent: bank.grammar_is_current,
    requiresAck, currentBankId: value?.current_bank_id, currentRevision: value?.current_bank_revision });
  if (!validGrammarState(value, context)) throw new Error('quiz-grammar-state-invalid');
  return context;
}

/** Verify the frozen selection; the current mapping never substitutes for it. */
export function validGrammarState(value, context) {
  if (!record(value) || !context || !validUuid(context.bankId) || !validRevision(context.revision)
      || !validCanonicalCode(context.canonicalCode) || typeof context.isCurrent !== 'boolean'
      || typeof context.requiresAck !== 'boolean' || !validUuid(context.currentBankId) || !validRevision(context.currentRevision)
      || value.bank_id !== context.bankId || value.bank_revision !== context.revision
      || value.canonical_code !== context.canonicalCode
      || value.content_state !== (context.isCurrent ? 'current' : 'legacy')
      || STATE_FLAGS.some((key) => typeof value[key] !== 'boolean')
      || !validUuid(value.current_bank_id) || !validRevision(value.current_bank_revision)
      || value.current_bank_id !== context.currentBankId || value.current_bank_revision !== context.currentRevision
      || (context.isCurrent ? value.current_bank_id !== context.bankId || value.current_bank_revision !== context.revision
        : value.current_bank_id === context.bankId)) return false;
  return context.requiresAck ? value.text_match_policy === QUIZ_TEXT_MATCH_POLICY
    : !Object.hasOwn(value, 'text_match_policy');
}

export function quizEngineBank(bank) { return bank.engineBank || bank; }

export function validQuizResume(value, bank) {
  if (!Array.isArray(value)) return false;
  if (!bank.managed) return true;
  const items = new Map();
  for (const question of bank.questions) {
    if (!items.has(question.item_key)) items.set(question.item_key, new Set());
    items.get(question.item_key).add(question.skill);
  }
  const seen = new Set();
  return value.every((row) => {
    if (!record(row) || !items.has(row.item_key) || seen.has(row.item_key)) return false;
    seen.add(row.item_key);
    for (const key of ['credit_count', 'correct_count', 'wrong_count', 'attempts_to_master']) {
      if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) return false;
    }
    if (row.production_done != null && typeof row.production_done !== 'boolean') return false;
    if (row.skills_passed != null && (!Array.isArray(row.skills_passed)
        || new Set(row.skills_passed).size !== row.skills_passed.length
        || row.skills_passed.some((skill) => !items.get(row.item_key).has(skill)))) return false;
    return row.provisional_skill == null || items.get(row.item_key).has(row.provisional_skill);
  });
}

/** @returns {import('../types/api').paths['/api/quiz/sessions']['post']['requestBody']['content']['application/json']} */
export function quizStartBody(bank, review) {
  return { bank_id: bank.bank.id, kind: 'run', ...(bank.managed ? {
    grammar_revision: bank.managed.revision, admission_kind: review ? 'review' : 'run',
    ...(bank.managed.requiresAck ? { text_match_policy: QUIZ_TEXT_MATCH_POLICY } : {}),
  } : {}) };
}

export function validQuizStart(value, bank) {
  return record(value) && typeof value.session_id === 'string' && Boolean(value.session_id.trim())
    && (!bank.managed || validUuid(value.session_id)) && validQuizResume(value.resume, bank)
    && (!bank.managed || validGrammarState(value.grammar, bank.managed));
}

export function validQuizProgress(value, context, payload) {
  return record(value) && value.ok === true && Number.isSafeInteger(value.attempts)
    && value.attempts >= 0 && value.attempts <= payload.attempts.length
    && Number.isSafeInteger(value.word_stats) && value.word_stats >= 0 && value.word_stats <= payload.word_stats.length
    && validGrammarState(value.grammar, context);
}

export function validQuizEnd(value, sessionId, bank) {
  // The scoped managed contract must not tighten unrelated legacy HTTP ACKs.
  if (!bank.managed) return true;
  if (!record(value) || value.id !== sessionId) return false;
  return validOwnedQuizEnd(value, { sessionId, bankId: bank.managed.bankId,
    revision: bank.managed.revision }, bank.managed);
}

/** Compatibility for an independently owned stored row, never inferred from ACK. */
export function validOwnedQuizEnd(value, stored, bankContext) {
  if (!record(value) || !stored || !validUuid(stored.sessionId) || !validUuid(stored.bankId)
      || stored.revision !== null && !validRevision(stored.revision)
      || value.id !== stored.sessionId || value.bank_id !== stored.bankId
      || !Object.hasOwn(value, 'grammar_revision') || value.grammar_revision !== stored.revision
      || typeof value.ended_at !== 'string' || !Number.isFinite(Date.parse(value.ended_at))
      || !['completed', 'paused', 'time_cap'].includes(value.ended_by)) return false;
  return !Object.hasOwn(value, 'grammar') || bankContext?.bankId === stored.bankId && validGrammarState(value.grammar, bankContext);
}

export function validQuizReset(value, bank) {
  return record(value) && value.ok === true && (!bank.managed || validGrammarState(value.grammar, bank.managed));
}

export function quizAdmissionAllowed(bank, review = false) {
  if (!bank.managed) return true;
  const state = bank.grammar;
  if (!bank.managed.isCurrent) return review || state.can_continue_legacy;
  return state.new_starts_enabled || (!review && state.can_continue_current);
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

/** @returns {import('../types/api').paths['/api/quiz/sessions/{session_id}']['patch']['requestBody']['content']['application/json']} */
export function quizEndPayload(summary, durationSeconds, saved) {
  return Object.freeze({
    duration_sec: Math.max(0, Math.round(Number(durationSeconds) || 0)),
    total_questions: Number(summary?.total_questions) || 0,
    total_correct: Number(summary?.total_correct) || 0,
    total_wrong: Number(summary?.total_wrong) || 0,
    words_mastered: Number(summary?.mastered) || 0,
    words_carried_over: Number(summary?.carried_over) || 0,
    ended_by: saved === true ? 'completed' : 'paused',
    attempts: [],
  });
}
import { canonicalQuizBankPolicy, QUIZ_TEXT_MATCH_POLICY } from '../public/js/quiz-text-match-policy.js';
