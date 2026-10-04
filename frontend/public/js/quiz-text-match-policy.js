/** Bank-local matching policy. Answer normalization remains owned by quiz-engine. */
export const QUIZ_TEXT_MATCH_POLICY = 'qid-exact-v1';

const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
// Match Python str.strip() for validating metadata, without changing JS answer normalization.
const PYTHON_WHITESPACE_ONLY = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TEXT_TYPES = new Set(['gap_text', 'spelling', 'missing_letters']);

function invalid(reason) {
  const error = new Error('Invalid quiz text-match policy: ' + reason);
  error.code = 'quiz_text_match_policy_invalid';
  throw error;
}

function nonemptyString(value) {
  return typeof value === 'string' && !PYTHON_WHITESPACE_ONLY.test(value);
}

function hasUnpairedSurrogate(value) {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) return true;
  }
  return false;
}

function validAccept(value) {
  return nonemptyString(value) && !hasUnpairedSurrogate(value);
}

function ownDataProperty(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && hasOwn(descriptor, 'value') ? descriptor : null;
}

function requiredOwnData(value, key, reason) {
  const descriptor = ownDataProperty(value, key);
  if (!descriptor) invalid(reason);
  return descriptor.value;
}

function validAccepts(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  // Do not call an overridable array method, visit holes, read inherited indices,
  // or invoke accessors while deciding whether the bank owns valid forms.
  for (let index = 0; index < value.length; index++) {
    const descriptor = ownDataProperty(value, String(index));
    if (!descriptor || !validAccept(descriptor.value)) return false;
  }
  return true;
}

function policyValue(meta) {
  const descriptor = Object.getOwnPropertyDescriptor(meta, 'text_match_by_qid');
  if (!descriptor || !hasOwn(descriptor, 'value')) invalid('policy must be a data property');
  return descriptor.value;
}

/** Validate once against the bank's owned questions, then capture an immutable map. */
export function validateQuizTextMatchPolicy(meta, questions) {
  const present = hasOwn(meta, 'text_match_by_qid');
  const byQid = Object.create(null);
  if (!present) return Object.freeze({ present: false, byQid: Object.freeze(byQid), requiresAck: false });
  if (!isRecord(meta)) invalid('META must be an object');
  const raw = policyValue(meta);
  if (!isRecord(raw)) invalid('map must be an object');
  if (!Array.isArray(questions)) invalid('owned questions must be an array');

  const owned = new Map();
  let eligibleCount = 0;
  for (let index = 0; index < questions.length; index++) {
    const slot = ownDataProperty(questions, String(index));
    if (!slot) invalid('owned question slots must be data properties');
    const question = slot.value;
    if (!isRecord(question)) invalid('question identity is missing');
    const qid = ownDataProperty(question, 'qid');
    if (!qid || !nonemptyString(qid.value)) invalid('question identity is missing');
    if (owned.has(qid.value)) invalid('duplicate question qid');
    const input = ownDataProperty(question, 'input');
    const type = ownDataProperty(question, 'type');
    const accept = ownDataProperty(question, 'accept');
    const eligible = input && type && accept && input.value === 'text'
      && TEXT_TYPES.has(type.value) && validAccepts(accept.value);
    owned.set(qid.value, Boolean(eligible));
    if (eligible) eligibleCount += 1;
  }

  const keys = Reflect.ownKeys(raw);
  if (keys.length > 200 || keys.length > eligibleCount) invalid('too many entries');
  for (const key of keys) {
    if (typeof key !== 'string' || RESERVED_KEYS.has(key)) invalid('reserved or non-string qid');
    // Unpaired UTF-16 is not encodable as canonical Python UTF-8 JSON.
    if (hasUnpairedSurrogate(key)) invalid('qid is not valid Unicode');
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) invalid('map entries must be enumerable data properties');
    if (owned.get(key) !== true) invalid('qid is not an owned eligible text question');
    if (descriptor.value !== 'exact' && descriptor.value !== 'typo_tolerant') invalid('unsupported mode');
    byQid[key] = descriptor.value;
  }
  const ordered = Object.fromEntries(keys.slice().sort().map((key) => [key, byQid[key]]));
  if (new TextEncoder().encode(JSON.stringify(ordered)).length > 16 * 1024) invalid('map exceeds UTF-8 limit');
  return Object.freeze({ present: true, byQid: Object.freeze(byQid), requiresAck: keys.length > 0 });
}

function samePolicy(left, right) {
  if (left.present !== right.present) return false;
  const keys = Object.keys(left.byQid);
  return keys.length === Object.keys(right.byQid).length
    && keys.every((key) => hasOwn(right.byQid, key) && left.byQid[key] === right.byQid[key]);
}

/**
 * Pure canonical wire seam for the later native owner. This proves no start ACK,
 * revision, permission or async scope: those remain the managed lifecycle's job.
 */
export function canonicalQuizBankPolicy(payload, expectedBankId) {
  if (!isRecord(payload)) invalid('canonical bank identity is missing');
  const bank = requiredOwnData(payload, 'bank', 'canonical bank must be a data property');
  if (!isRecord(bank)) invalid('canonical bank identity is missing');
  const bankId = requiredOwnData(bank, 'id', 'canonical bank identity must be a data property');
  if (!nonemptyString(bankId)) invalid('canonical bank identity is missing');
  if (expectedBankId !== undefined && expectedBankId !== bankId) invalid('bank identity does not match');
  if (hasOwn(payload, 'bank_id') && requiredOwnData(payload, 'bank_id', 'alternate bank identity must be a data property') !== bankId) invalid('alternate bank identity conflicts');
  const meta = requiredOwnData(bank, 'meta', 'canonical bank META must be a data property');
  if (!isRecord(meta)) invalid('canonical bank META is missing');
  const questions = requiredOwnData(payload, 'questions', 'canonical questions must be a data property');
  const policy = validateQuizTextMatchPolicy(meta, questions);
  if (hasOwn(payload, 'meta')) {
    const alternateMeta = requiredOwnData(payload, 'meta', 'alternate META must be a data property');
    if (!isRecord(alternateMeta)) invalid('alternate META is malformed');
    if (hasOwn(alternateMeta, 'bank_id') && requiredOwnData(alternateMeta, 'bank_id', 'alternate META identity must be a data property') !== bankId) invalid('alternate META bank identity conflicts');
    const alternate = validateQuizTextMatchPolicy(alternateMeta, questions);
    if (!samePolicy(policy, alternate)) invalid('alternate policy conflicts with canonical META');
  }
  return { bankId, meta, questions, policy };
}

/** Preserve the existing direct helper seam and absent-map legacy META precedence. */
export function resolveQuizEnginePolicy(bank) {
  const direct = bank && bank.meta;
  const owner = bank && bank.bank;
  const nested = owner && owner.meta;
  const declared = hasOwn(direct, 'text_match_by_qid') || hasOwn(nested, 'text_match_by_qid');
  if (declared) {
    if (hasOwn(bank, 'bank')) {
      const canonical = canonicalQuizBankPolicy(bank);
      return { meta: canonical.meta, questions: canonical.questions, policy: canonical.policy };
    }
    if (!isRecord(bank)) invalid('direct bank must be an object');
    const meta = requiredOwnData(bank, 'meta', 'direct bank META must be a data property');
    const questions = requiredOwnData(bank, 'questions', 'direct questions must be a data property');
    return { meta, questions, policy: validateQuizTextMatchPolicy(meta, questions) };
  }
  const meta = direct || nested || {};
  const questions = (bank && bank.questions) || [];
  return { meta, questions, policy: validateQuizTextMatchPolicy(meta, questions) };
}

export function quizTextMatchMode(policy, qid) {
  return hasOwn(policy.byQid, qid) ? policy.byQid[qid] : undefined;
}
