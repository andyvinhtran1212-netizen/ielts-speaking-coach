import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quizHistoryBankDisplay } from '../lib/quiz-history-display-model.mjs';

const wire = JSON.parse(readFileSync(new URL('./fixtures/grammar-native-public-wire.json', import.meta.url)));
const banks = [...new Map(wire.rows.flatMap((row) => row.requests)
  .filter((row) => row.response?.bank?.grammar_canonical_code)
  .map((row) => [row.response.bank.grammar_canonical_code, row.response.bank])).values()];

test('all 12 captured banks use their own frozen title in visible/accessible labels, without rewriting wire', () => {
  assert.equal(banks.length, 12);
  for (const bank of banks) {
    const before = JSON.stringify(bank);
    assert.deepEqual(quizHistoryBankDisplay(bank.code, bank.title), { label: bank.title, subtitle: '' });
    assert.deepEqual(quizHistoryBankDisplay(bank.grammar_canonical_code, bank.title), { label: bank.title, subtitle: '' });
    assert.equal(JSON.stringify(bank), before);
  }
});
test('recent rows lacking a title have an explicit human-readable fallback for each canonical bank', () => {
  for (const bank of banks) {
    const canonical = quizHistoryBankDisplay(bank.grammar_canonical_code);
    const physical = quizHistoryBankDisplay(`${bank.grammar_canonical_code}~${'a'.repeat(16)}`);
    assert.equal(canonical.label, bank.title);
    assert.deepEqual(physical, canonical);
    assert.doesNotMatch(physical.label, /G-|~|old|current|version|bản trước|bản đã sửa/i);
    assert.equal(quizHistoryBankDisplay(bank.code, '  ').label, canonical.label);
  }
});
test('a historical title remains authoritative even when it differs from today’s fallback', () => {
  const title = 'Bài đã lưu: a different original title';
  assert.equal(quizHistoryBankDisplay('G-tenses-past-perfect~0123456789abcdef', title).label, title);
});
test('Vocabulary and unowned/unrecognized codes retain their exact existing code/title display', () => {
  assert.deepEqual(quizHistoryBankDisplay('G-tenses-past-perfect~0123456789abcdef', 'Vocabulary title', 'vocab'), { label: 'G-tenses-past-perfect~0123456789abcdef', subtitle: 'Vocabulary title' });
  for (const code of ['vocab-1', 'vocab~0123456789abcdef', 'G-unmanaged-topic~0123456789abcdef',
    'G-tenses-past-perfect~ABCDEF0123456789', 'G-tenses-past-perfect~short', 'G-tenses-past-perfect~0123456789abcdef-extra',
    ' G-tenses-past-perfect', '__proto__']) {
    assert.deepEqual(quizHistoryBankDisplay(code, 'Original title'), { label: code, subtitle: 'Original title' });
  }
  assert.deepEqual(quizHistoryBankDisplay(null, null), { label: '', subtitle: '' });
});
