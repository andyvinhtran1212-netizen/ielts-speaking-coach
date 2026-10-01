import assert from 'node:assert/strict';
import test from 'node:test';
import { readSourceGapAnswers, writeSourceGapAnswers, displaySourceAnswer, displaySourceReferenceAnswer } from '../lib/listening-source-responses.mjs';

test('multiple source blanks retain a single persisted position and restore each field', () => {
  const answer = writeSourceGapAnswers({ first: 'dinner', second: 'New York' });
  assert.deepEqual(readSourceGapAnswers(answer), { first: 'dinner', second: 'New York' });
  assert.equal(displaySourceAnswer(answer, 'multi_gap_completion', [{ field_id: 'first', prompt: 'What?' }, { field_id: 'second', prompt: 'Where?' }]), 'What?: dinner · Where?: New York');
  assert.equal(writeSourceGapAnswers({ first: '', second: '  ' }), '');
});

test('damaged structured answers cannot become object or array text in the learner result', () => {
  for (const value of ['broken', 'null', '[]', '123']) {
    assert.deepEqual(readSourceGapAnswers(value), {});
    assert.equal(displaySourceAnswer(value, 'multi_gap_completion'), '—');
  }
  assert.deepEqual(readSourceGapAnswers('{"a":"ribbons","bad":{"answer":"hidden"}}'), { a: 'ribbons' });
  assert.equal(displaySourceAnswer('C', 'single_choice'), 'C');
});

const native = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/listening-source-multi-gap.json', import.meta.url), 'utf8'));
assert.equal(native.questions.length, 12);
assert.equal(native.questions.reduce((sum, item) => sum + item.fields.length, 0), 25);
const reversedObject = (fields, prefix) => Object.fromEntries([...fields].reverse().map((field) => [field.field_id, `${prefix}-${field.field_id}`]));
const labelled = (fields, values) => fields.map((field) => `${field.prompt}: ${typeof values[field.field_id] === 'string' && values[field.field_id] ? values[field.field_id] : '—'}`).join(' · ');
for (const item of native.questions) {
  test(`native Day${item.day} Q${item.source_display_number}: canonical labels/order match first, revised and editorial reference`, () => {
    const first = reversedObject(item.fields, 'first'); const final = reversedObject(item.fields, 'revised');
    for (const values of [first, final, item.reference_answer]) {
      const backwards = Object.fromEntries(Object.entries(values).reverse());
      assert.equal(displaySourceAnswer(JSON.stringify(backwards), 'multi_gap_completion', item.fields), labelled(item.fields, values));
      assert.equal(displaySourceReferenceAnswer(backwards, item.fields), labelled(item.fields, values));
    }
    assert.equal(displaySourceAnswer(JSON.stringify({ unknown_extra: 'never shift this', ...first }), 'multi_gap_completion', item.fields), labelled(item.fields, first));
    const missing = { ...first }; delete missing[item.fields[0].field_id];
    assert.equal(displaySourceAnswer(JSON.stringify(missing), 'multi_gap_completion', item.fields), labelled(item.fields, missing));
    assert.equal(displaySourceReferenceAnswer({ unknown_extra: 'never shift this', ...missing }, item.fields), labelled(item.fields, missing));
    for (const malformed of ['{', 'null', '[]', '42', '"scalar"']) {
      assert.equal(displaySourceAnswer(malformed, 'multi_gap_completion', item.fields), labelled(item.fields, {}));
    }
  });
}

test('missing or malformed canonical multi-gap definitions never invent numbered labels', () => {
  const value = '{"country":"Britain","birth_order":"third"}';
  for (const fields of [[], [{ field_id: '', prompt: 'Unknown' }], [{ field_id: 'country', prompt: '' }], [{ field_id: 'country', prompt: 'Country' }, { field_id: 'country', prompt: 'Duplicate' }]]) {
    assert.equal(displaySourceAnswer(value, 'multi_gap_completion', fields), '—');
    assert.equal(displaySourceReferenceAnswer(JSON.parse(value), fields), '—');
  }
  assert.equal(displaySourceAnswer('Original scalar', 'written'), 'Original scalar');
});


test('generic structured/scalar/array explanation formatting is unchanged without source fields', () => {
  assert.equal(displaySourceReferenceAnswer({ where: 'London', when: 'Friday' }), 'where: London · when: Friday');
  assert.equal(displaySourceReferenceAnswer('C'), 'C');
  assert.equal(displaySourceReferenceAnswer(['A', 'D']), 'A · D');
});
