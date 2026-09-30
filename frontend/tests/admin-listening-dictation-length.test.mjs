import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeDictationReportDetail } from '../lib/admin-listening-dictation-model.mjs';

// Exact synthetic Admin responses from actual offline ASGI admission, grading,
// completion and GET routes. No reference, score, hash or span was transplanted.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/dictation-length-actual-wire.json', import.meta.url)));

for (const row of fixture.cases) test(`Admin actual length wire: ${row.name}`, () => {
  const detail = normalizeDictationReportDetail(row.admin, row.admin.id);
  assert.ok(detail);
  assert.equal(detail.accuracy, row.admin.accuracy);
  assert.equal(detail.correctWords, row.admin.correct_words);
  assert.equal(detail.totalWords, row.admin.total_words);
  if (row.version === 'lexical-v2') {
    assert.equal(row.new_source_gate.accepted, true);
    assert.equal(detail.sentences.length, 1);
    assert.equal(detail.malformedSentenceCount, 0);
    assert.equal(detail.missingSentenceCount, 0);
    const sentence = detail.sentences[0];
    assert.equal(sentence.reference, row.admin.results[0].reference);
    assert.equal(sentence.userText, row.admin.results[0].user_text);
    assert.equal(sentence.gradingEvidence.reference_segments.map((segment) => segment.raw).join(''), sentence.reference);
    assert.equal(sentence.gradingEvidence.user_segments.map((segment) => segment.raw).join(''), sentence.userText);
    assert.equal(sentence.gradingEvidence.reference_sha256, row.admin.reference_sha256);
  } else {
    // This change preserves the preexisting unclassified legacy length guard.
    assert.equal(detail.sentences.length, 0);
    assert.equal(detail.malformedSentenceCount, 1);
    assert.equal(detail.missingSentenceCount, 1);
  }
});

test('long admitted v2 evidence still rejects corrupt spans, nested proof, parent hash and summary', () => {
  const raw = fixture.cases.find((row) => row.name === 'deseret5001').admin;
  for (const mutate of [
    (value) => { value.results[0].grading_evidence.reference_segments[0].raw += 'x'; },
    (value) => { value.results[0].grading_evidence.total_words += 1; },
    (value) => { value.reference_sha256 = 'a'.repeat(64); },
  ]) {
    const changed = structuredClone(raw); mutate(changed);
    const detail = normalizeDictationReportDetail(changed, changed.id);
    assert.ok(detail); assert.equal(detail.sentences.length, 0);
    assert.equal(detail.malformedSentenceCount, 1); assert.equal(detail.missingSentenceCount, 1);
  }
  const changed = structuredClone(raw); changed.accuracy = 0;
  assert.equal(normalizeDictationReportDetail(changed, changed.id), null);
});
