import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeQuizBank, quizEngineBank, quizStartBody, quizAdmissionAllowed,
  validQuizStart, validQuizResume, validQuizProgress, validQuizEnd, validOwnedQuizEnd, validQuizReset, validGrammarState, CANONICAL_GRAMMAR_CODES } from '../lib/quiz-player-model.mjs';
import { createEngine } from '../public/js/quiz-engine.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/grammar-native-public-wire.json', import.meta.url)));
const requests = fixture.rows.flatMap((row) => row.requests.map((request) => ({ ...request, case: row.case })));
const captures = requests.filter((r) => r.method === 'GET' && r.status === 200 && r.response.bank);
const banks = new Map(captures.map((r) => [r.response.bank.id, normalizeQuizBank(r.response, { expectedBankId: r.response.bank.id })]));
const clone = (value) => JSON.parse(JSON.stringify(value));
for (const [i, row] of captures.entries()) test(`actual ASGI bank ${i} owns canonical identity/policy before pure preflight`, () => {
  const bank = normalizeQuizBank(row.response, { expectedBankId: row.response.bank.id });
  assert.ok(bank); assert.equal(quizEngineBank(bank).meta, row.response.bank.meta);
  const check = createEngine(quizEngineBank(bank));
  assert.ok(check.progress().total > 0); assert.deepEqual(check.drainBatch(), { attempts: [], word_stats: [] });
  const wrong = clone(row.response); wrong.bank.id = 'wrong-bank';
  assert.equal(normalizeQuizBank(wrong, { expectedBankId: row.response.bank.id }), null);
});
for (const [i, row] of requests.entries()) {
  if (row.status >= 300 || row.method === 'GET' && !row.path.endsWith('/resume')) continue;
  if (row.method === 'POST' && row.path === '/api/quiz/sessions') test(`actual start ACK ${i} verifies frozen identity/resume/capability`, () => {
    const bank = banks.get(row.response.grammar.bank_id); assert.ok(bank);
    assert.equal(validQuizStart(row.response, bank), true);
    const body = quizStartBody(bank, row.request.admission_kind === 'review');
    assert.equal(body.bank_id, bank.bank.id); assert.equal(body.grammar_revision, bank.managed.revision);
    assert.equal(body.text_match_policy, bank.managed.requiresAck ? 'qid-exact-v1' : undefined);
    for (const field of ['bank_id', 'bank_revision', 'canonical_code', 'current_bank_id', 'current_bank_revision']) {
      const bad = clone(row.response); bad.grammar[field] = 'foreign'; assert.equal(validQuizStart(bad, bank), false);
    }
    const bad = clone(row.response); bad.resume = null; assert.equal(validQuizStart(bad, bank), false);
    bad.resume = []; bad.grammar.bank_revision = null; assert.equal(validQuizStart(bad, bank), false);
    if (bank.managed.requiresAck) { const missing = clone(row.response); delete missing.grammar.text_match_policy; assert.equal(validQuizStart(missing, bank), false); }
  });
  else if (row.method === 'GET' && row.path.endsWith('/resume')) test(`actual resume ${i} remains owned engine carryover`, () => {
    assert.equal(validQuizResume(row.response, banks.get(row.path.split('/')[4])), true);
  });
  else if (row.method === 'POST' && row.path.endsWith('/progress')) test(`actual progress ${i} validates count and frozen echo before removal`, () => {
    const bank = banks.get(row.response.grammar.bank_id);
    assert.equal(validQuizProgress(row.response, bank.managed, row.request), true);
    for (const forged of [null, { ...row.response, ok: false }, { ...row.response, attempts: '1' }, { ...row.response, attempts: row.request.attempts.length + 1 }, { ...row.response, grammar: { ...row.response.grammar, bank_revision: null } }]) assert.equal(validQuizProgress(forged, bank.managed, row.request), false);
  });
  else if (row.method === 'POST' && row.path.endsWith('/reset')) test(`actual reset ${i} requires successful identity ACK`, () => {
    const bank = banks.get(row.response.grammar.bank_id);
    assert.equal(validQuizReset(row.response, bank), true);
    assert.equal(validQuizReset({ ...row.response, ok: false }, bank), false);
    assert.equal(validQuizReset({ ok: true }, bank), false);
  });
  else if (row.method === 'PATCH' && row.response.grammar_revision !== null) test(`actual end ${i} verifies owned frozen revision, including terminal envelope omission`, () => {
    const bank = banks.get(row.response.bank_id);
    assert.equal(validQuizEnd(row.response, row.response.id, bank), true);
    for (const change of [{ bank_id: 'foreign' }, { grammar_revision: null }, { grammar_revision: 'c'.repeat(64) }, { id: 'foreign' }, { ended_at: null }]) assert.equal(validQuizEnd({ ...row.response, ...change }, row.response.id, bank), false);
    const missing = clone(row.response); delete missing.grammar_revision; assert.equal(validQuizEnd(missing, row.response.id, bank), false);
  });
}
test('bad map/owner or conflicting canonical META never becomes a native bank', () => {
  const row = captures.find((r) => r.response.grammar.text_match_policy);
  const id = row.response.bank.id;
  for (const edit of [(p) => { p.bank.meta.text_match_by_qid = null; }, (p) => { p.bank.meta.text_match_by_qid = { foreign: 'exact' }; }, (p) => { p.meta = { ...p.bank.meta, text_match_by_qid: {} }; }, (p) => { p.grammar = null; }, (p) => { p.grammar.new_starts_enabled = 1; }, (p) => { p.bank.grammar_revision = null; }]) {
    const payload = clone(row.response); edit(payload); assert.equal(normalizeQuizBank(payload, { expectedBankId: id }), null);
  }
});
test('disabled starts preserve admitted work and allow only server-proven continuation', () => {
  const bank = clone([...banks.values()].find((b) => b.managed.isCurrent));
  bank.grammar.new_starts_enabled = false; bank.grammar.can_continue_current = false;
  assert.equal(quizAdmissionAllowed(bank), false); assert.equal(quizAdmissionAllowed(bank, true), false);
  bank.grammar.can_continue_current = true; assert.equal(quizAdmissionAllowed(bank), true); assert.equal(quizAdmissionAllowed(bank, true), false);
});
test('stored NULL identity compatibility cannot turn into a new managed start or current revision graft', () => {
  const { response, priorStoredIdentity: stored, original_bank_revision: frozenBankRevision } = fixture.originalTerminal;
  assert.equal(validOwnedQuizEnd(response, stored), true);
  assert.equal(validOwnedQuizEnd({ ...response, grammar_revision: frozenBankRevision }, stored), false);
  assert.equal(validOwnedQuizEnd(response, { ...stored, revision: frozenBankRevision }), false);
  assert.equal(validOwnedQuizEnd(response, { ...stored, bankId: 'foreign' }), false);
  assert.equal(validOwnedQuizEnd(response, { ...stored, sessionId: 'foreign' }), false);
  const missing = clone(response); delete missing.grammar_revision; assert.equal(validOwnedQuizEnd(missing, stored), false);
  assert.equal(validOwnedQuizEnd({ ...response, grammar: null }, stored), false);
});

test('managed code runtime floor is exactly the current generated twelve-code enum', () => {
  const api = readFileSync(new URL('../types/api.d.ts', import.meta.url), 'utf8');
  const type = api.split('ManagedGrammarSessionState: {')[1].split('canonical_code: ')[1].split(';')[0];
  const generated = [...type.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...CANONICAL_GRAMMAR_CODES].sort(), generated.sort());
});

const legacyCapture = captures.find((row) => row.response.grammar.content_state === 'legacy').response;
for (const field of ['current_bank_id', 'current_bank_revision']) for (const kind of ['singleton', 'null', 'number', 'boolean', 'object']) test(`legacy canonical ${field}/${kind} is refused before activation`, () => {
  const payload = clone(legacyCapture), original = payload.grammar[field];
  payload.grammar[field] = { singleton: [original], null: null, number: 7, boolean: true, object: { value: original } }[kind];
  assert.equal(normalizeQuizBank(payload, { expectedBankId: payload.bank.id }), null);
});
for (const code of ['G-unapproved-unsupported', 'G-', '', ['G-tenses-present-simple'], null, 12]) test(`ordinary JSON canonical code ${JSON.stringify(code)} cannot be admitted`, () => {
  const payload = clone(legacyCapture); payload.bank.grammar_canonical_code = code; payload.grammar.canonical_code = code;
  assert.equal(normalizeQuizBank(payload, { expectedBankId: payload.bank.id }), null);
});
test('strict scalar floor applies to every managed state echo and independently owned stored identity', () => {
  const bank = normalizeQuizBank(legacyCapture, { expectedBankId: legacyCapture.bank.id });
  for (const field of ['bank_id', 'bank_revision', 'canonical_code', 'current_bank_id', 'current_bank_revision']) {
    for (const mutate of [(value) => [value], () => null, () => 7, () => true, (value) => ({ value })]) {
      const state = clone(bank.grammar); state[field] = mutate(state[field]); assert.equal(validGrammarState(state, bank.managed), false);
    }
  }
  for (const field of ['bankId', 'revision', 'canonicalCode', 'currentBankId', 'currentRevision']) {
    const context = { ...bank.managed, [field]: [bank.managed[field]] };
    assert.equal(validGrammarState(bank.grammar, context), false);
  }
  const { response, priorStoredIdentity } = fixture.originalTerminal;
  for (const field of ['sessionId', 'bankId']) assert.equal(validOwnedQuizEnd(response, { ...priorStoredIdentity, [field]: [priorStoredIdentity[field]] }), false);
  assert.equal(validOwnedQuizEnd(response, { ...priorStoredIdentity, revision: ['a'.repeat(64)] }), false);
  assert.equal(validOwnedQuizEnd(response, priorStoredIdentity), true);
});
