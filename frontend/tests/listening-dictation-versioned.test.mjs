import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeDictationAttempt, normalizeDictationGrade, normalizeDictationReport, normalizeDictationPolicy,
  dictationDisplaySegments, dictationStartPolicy, dictationPolicyAcknowledgement, reconcileDictationReceiptWithAttempt, normalizeDictationStoredReport, dictationParams, normalizeDictationReceiptReport } from '../lib/listening-dictation-controller.mjs';
import { coreInputDigest } from '../lib/core-operation-intent.mjs';
import { isPureFiller } from '../lib/dictation-filler-policy.mjs';
import { normalizeDictationAggregate, normalizeDictationReportItem, normalizeDictationReportDetail } from '../lib/admin-listening-dictation-model.mjs';

// Generated offline from grade_frozen_sentence; no API, learner or database calls.
const gold = JSON.parse(readFileSync(new URL('./fixtures/dictation-versioned.json', import.meta.url)));
const fillerFixture = JSON.parse(readFileSync(new URL('./fixtures/dictation-filler-gold.json', import.meta.url)));
const fillerGold = fillerFixture.cases;
const copy = (value) => structuredClone(value);
const attempt = (row = gold[0]) => ({ attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1,
  status: 'in_progress', renderer_affinity: 'next', units: row.units, answers: [],
  grading_version: row.grade.grading_version, reference_sha256: row.grade.reference_sha256 });
const report = (row = gold[0]) => ({ session_id: 'session-1', attempt_id: 'attempt-1', client_request_id: 'request-1',
  grading_version: row.grade.grading_version, reference_sha256: row.grade.reference_sha256,
  total_sentences: 1, correct_count: row.grade.score === 1 ? 1 : 0, accuracy: row.grade.score,
  total_words: row.grade.total_words, correct_words: row.grade.correct_words,
  results: [{ ...row.grade, sentence_idx: 0, grading_evidence: row.grade, ops: { miss: 0, wrong: 0, extra: 0 } }] });
const fillerReport = (row) => {
  const ops = Object.fromEntries(['miss', 'wrong', 'extra'].map((op) => [op, row.grade.diff.filter((d) => d.op === op && !d.filler).length]));
  return { ...report(row), section_num: 1, results: [{ ...row.grade, sentence_idx: 0, grading_evidence: row.grade,
    listen_count: 0, time_seconds: 0, ops }], error_trends: { op_counts: ops } };
};
const adminReport = (raw) => ({ ...raw, id: 'session-1', user: { id: 'user-1' }, association_lookup_failed: false, association_lookup_failures: [] });

for (const row of fillerGold) test(`canonical ${row.name} survives grade, resume, report, receipt, stored and Admin consumers`, () => {
  const grade = normalizeDictationGrade(row.grade);
  assert.equal(grade.total_words, row.grade.total_words); assert.equal(grade.is_correct, row.grade.is_correct);
  const resumed = normalizeDictationAttempt({ ...attempt(row), answers: [{ ...row.grade, sentence_idx: 0,
    user_transcript: row.grade.user_text, grading_evidence: row.grade }] });
  assert.equal(resumed.answers[0].score, row.grade.score); assert.equal(resumed.answers[0].total_words, row.grade.total_words);
  const raw = fillerReport(row);
  const normalized = normalizeDictationReport(raw);
  assert.equal(normalized.total_words, row.grade.total_words); assert.equal(normalized.accuracy, row.grade.score);
  assert.equal(normalizeDictationStoredReport({ ...raw, id: 'session-1' }, 'session-1').accuracy, row.grade.score);
  const receipt = { requestId: 'request-1', submission: { attempt_id: 'attempt-1', section_num: 1,
    ...normalizeDictationPolicy(row.grade), sentences: [{ sentence_idx: 0, user_transcript: row.grade.user_text, listen_count: 0, time_seconds: 0 }] } };
  assert.equal(normalizeDictationReceiptReport(raw, receipt).total_words, row.grade.total_words);
  const detail = normalizeDictationReportDetail(adminReport(raw), 'session-1');
  assert.ok(detail); assert.equal(detail.malformedSentenceCount, 0); assert.equal(detail.missingSentenceCount, 0);
  assert.equal(detail.sentences[0].totalWords, row.grade.total_words);
  for (const side of ['reference', 'user']) {
    const segments = dictationDisplaySegments(grade, side);
    assert.equal(segments.map((segment) => segment.raw).join(''), side === 'reference' ? row.grade.reference : row.grade.user_text);
    for (const op of grade.diff.filter((op) => op.filler)) {
      const span = op[side === 'reference' ? 'expected_span' : 'actual_span'];
      if (span) assert.equal(segments[span.segment_index].filler, true);
    }
  }
});

test('filler membership keeps Python whitespace, normalization and single terminal-strip boundaries', () => {
  for (const raw of ['UM', 'ⓤm', 'ｕm', '㎜m', 'uⅯ', '𝘂m', 'um．', '\u001cum\u0085']) assert.equal(isPureFiller(raw), true, raw);
  for (const raw of ['\ufeffum', 'u．m', '. um .', 'u\u0301m', 'u\u034fm', 'um\u00ad', '“um”', "'um'", '']) assert.equal(isPureFiller(raw), false, raw);
  for (const row of fillerGold.filter((row) => row.name.startsWith('unicode15-'))) {
    const changed = copy(row.grade);
    const op = changed.diff.find((op) => op.op !== 'match');
    if (op.filler) {
      op.filler = false;
      if (op.op !== 'extra') changed.total_words += 1;
    } else {
      op.filler = true;
      if (op.op !== 'extra') changed.total_words -= 1;
    }
    changed.score = changed.correct_words / Math.max(changed.total_words, 1);
    changed.is_correct = changed.score === 1;
    assert.throws(() => normalizeDictationGrade(changed), row.name);
  }
});

test('v2 filler flags cannot forgive content, matches or malformed metadata, and every raw span remains required', () => {
  const source = fillerGold.find((row) => row.name === 'F02').grade;
  for (const value of ['true', 1, {}, []]) {
    const changed = copy(source); changed.diff.find((op) => op.filler).filler = value;
    assert.throws(() => normalizeDictationGrade(changed));
  }
  for (const name of ['F09', 'F10', 'F21']) {
    const changed = copy(fillerGold.find((row) => row.name === name).grade);
    changed.diff.find((op) => op.op === 'wrong').filler = true;
    changed.total_words -= 1; changed.score = changed.correct_words / Math.max(changed.total_words, 1); changed.is_correct = changed.score === 1;
    assert.throws(() => normalizeDictationGrade(changed));
  }
  const matched = copy(fillerGold.find((row) => row.name === 'F03').grade); matched.diff[0].filler = true;
  assert.throws(() => normalizeDictationGrade(matched));
  for (const name of ['F01', 'F02', 'F04']) {
    const changed = copy(fillerGold.find((row) => row.name === name).grade);
    const op = changed.diff.find((op) => op.filler); op.filler = false;
    if (op.op !== 'extra') changed.total_words += 1;
    changed.score = changed.correct_words / Math.max(changed.total_words, 1); changed.is_correct = changed.score === 1;
    assert.throws(() => normalizeDictationGrade(changed));
  }
  for (const mutate of [
    (g) => { delete g.diff[0].expected_span; }, (g) => { g.diff[0].expected = 'hello'; },
    (g) => { g.diff[0].actual_span.start += 1; }, (g) => { g.diff[0].actual = 1; },
    (g) => { g.total_words += 1; }, (g) => { g.diff.push(copy(g.diff[0])); },
  ]) { const changed = copy(source); mutate(changed); assert.throws(() => normalizeDictationGrade(changed)); }
  const zero = copy(fillerGold.find((row) => row.name === 'F05').grade);
  assert.equal(normalizeDictationGrade(zero).score, 0); assert.equal(normalizeDictationGrade(zero).is_correct, false);
  zero.score = 1; zero.is_correct = true; assert.throws(() => normalizeDictationGrade(zero));
});

test('nested saved v2 evidence cannot be overwritten by apparently valid outer grade fields', () => {
  const row = fillerGold.find((row) => row.name === 'F01');
  for (const mutate of [
    (g) => { g.score = 0; }, (g) => { g.is_correct = false; },
    (g) => { g.total_words += 1; }, (g) => { g.diff[0].expected_span.start += 1; },
    (g) => { g.reference_sha256 = 'a'.repeat(64); },
  ]) {
    const raw = copy(fillerReport(row)); mutate(raw.results[0].grading_evidence);
    assert.throws(() => normalizeDictationGrade(raw.results[0]));
    assert.throws(() => normalizeDictationReport(raw));
    assert.throws(() => normalizeDictationStoredReport({ ...raw, id: 'session-1' }, 'session-1'));
    const detail = normalizeDictationReportDetail(adminReport(raw), 'session-1');
    assert.equal(detail.malformedSentenceCount, 1); assert.equal(detail.missingSentenceCount, 1);
    assert.throws(() => normalizeDictationAttempt({ ...attempt(row), answers: [{ ...raw.results[0], user_transcript: row.grade.user_text }] }));
  }
  // JSON key order is transport detail, not a difference in frozen evidence.
  const reordered = copy(fillerReport(row));
  reordered.results[0].grading_evidence.diff[0] = Object.fromEntries(Object.entries(reordered.results[0].grading_evidence.diff[0]).reverse());
  assert.equal(normalizeDictationReport(reordered).accuracy, 1);
});

test('complete v2 Admin detail reconciles stored summary; partial and legacy evidence retain visible absence', () => {
  const row = fillerGold.find((row) => row.name === 'F01'); const raw = adminReport(fillerReport(row));
  for (const patch of [{ accuracy: 0 }, { correct_count: 0 }, { total_words: 0, correct_words: 0 },
    { error_trends: { op_counts: { miss: 1, wrong: 0, extra: 0 } } }]) assert.equal(normalizeDictationReportDetail({ ...raw, ...patch }, 'session-1'), null);
  for (const key of ['total_sentences', 'correct_count', 'total_words', 'correct_words', 'accuracy']) {
    for (const value of [String(raw[key]), true, null]) assert.equal(normalizeDictationReportDetail({ ...raw, [key]: value }, 'session-1'), null);
  }
  const forged = copy(raw); forged.reference_sha256 = 'a'.repeat(64);
  forged.results[0].reference_sha256 = forged.reference_sha256;
  forged.results[0].grading_evidence.reference_sha256 = forged.reference_sha256;
  assert.equal(normalizeDictationReportDetail(forged, 'session-1'), null);
  assert.throws(() => normalizeDictationReport(forged));
  for (const op_counts of [null, [], {}, { miss: false, wrong: 0, extra: 0 }, { miss: -1, wrong: 0, extra: 0 }, { miss: '0', wrong: 0, extra: 0 }]) {
    assert.equal(normalizeDictationReportDetail({ ...raw, error_trends: { op_counts } }, 'session-1'), null);
  }
  assert.equal(normalizeDictationReportDetail({ ...raw, error_trends: {} }, 'session-1').opCounts, null);
  const partial = normalizeDictationReportDetail({ ...raw, results: [] }, 'session-1');
  assert.equal(partial.missingSentenceCount, 1); assert.equal(partial.totalWords, 1);
});

test('Admin uses canonical trend classification across runtime Unicode versions without weakening count validation', () => {
  const payload = fillerFixture.unicode_trend.payload;
  const aggregate = normalizeDictationAggregate(payload);
  assert.ok(aggregate); assert.equal(aggregate.punctuationMissed[0].label, '\u{11380}');
  assert.equal(aggregate.topMissed.length, 0); assert.equal(aggregate.meanAccuracy, 0);
  assert.equal(normalizeDictationAggregate({ ...payload, punctuation_missed_total: 0 }), null);
  assert.equal(normalizeDictationAggregate({ ...payload, trend_complete_session_count: 0 }), null);
  assert.equal(normalizeDictationAggregate({ ...payload, punctuation_missed: [{ token: '\u{11380}', count: true }] }), null);
  assert.equal(normalizeDictationAggregate({ ...payload, top_missed: [{ word: '\u{11380}', count: 1 }] }), null);
});

for (const row of fillerFixture.canonical_admin_trends.cases) test(`actual Admin ${row.name} preserves canonical counter keys and counts`, () => {
  const result = normalizeDictationAggregate(row.payload);
  assert.ok(result); assert.equal(result.malformedWordCount, 0);
  for (const [wire, local, key] of [['top_missed', 'topMissed', 'word'], ['top_wrong', 'topWrong', 'expected'],
    ['punctuation_missed', 'punctuationMissed', 'token'], ['punctuation_wrong', 'punctuationWrong', 'token']]) {
    assert.deepEqual(result[local], row.payload[wire].map((entry) => ({ label: entry[key], count: entry.count })));
  }
  assert.equal(result.punctuationMissedTotal, row.payload.punctuation_missed_total);
});

test('canonical Admin key preservation still rejects exact duplicates, whitespace-only tokens and bucket contradictions', () => {
  const payload = fillerFixture.canonical_admin_trends.cases.find((row) => row.name === 'FEFF-only').payload;
  const duplicate = { ...payload, punctuation_missed: [...payload.punctuation_missed, ...payload.punctuation_missed], punctuation_missed_total: 2 };
  assert.equal(normalizeDictationAggregate(duplicate), null);
  for (const token of ['', ' \t\n', '\u001c\u0085', '\u2000\u3000']) {
    assert.equal(normalizeDictationAggregate({ ...payload, punctuation_missed: [{ token, count: 1 }] }), null);
  }
  assert.equal(normalizeDictationAggregate({ ...payload, top_missed: [{ word: '\ufeff', count: 1 }] }), null);
  const lexical = fillerFixture.canonical_admin_trends.cases.find((row) => row.name === 'edged-literal-keys').payload;
  const repeated = normalizeDictationAggregate({ ...lexical, top_missed: [lexical.top_missed[0], lexical.top_missed[0]] });
  assert.equal(repeated.malformedWordCount, 1); assert.equal(repeated.topMissed.length, 1);
});

test('owned stored v2 report remains readable after canonical parent erasure, while completion/receipt identity stays required', () => {
  const row = fillerGold.find((row) => row.name === 'F01');
  const erased = { ...fillerReport(row), id: 'session-1', attempt_id: null, test_id: null };
  const saved = normalizeDictationStoredReport(erased, 'session-1');
  assert.equal(saved.attempt_id, null); assert.equal(saved.accuracy, 1); assert.equal(saved.results[0].reference, 'um hello');
  assert.throws(() => normalizeDictationReport(erased));
  assert.throws(() => normalizeDictationReceiptReport(erased, { requestId: 'request-1', submission: { attempt_id: 'attempt-1', section_num: 1,
    ...normalizeDictationPolicy(row.grade), sentences: [{ sentence_idx: 0, user_transcript: 'hello', listen_count: 0, time_seconds: 0 }] } }));
  for (const attempt_id of [undefined, '', false, 0]) assert.throws(() => normalizeDictationStoredReport({ ...erased, attempt_id }, 'session-1'));
  assert.throws(() => normalizeDictationStoredReport({ ...erased, id: 'other' }, 'session-1'));
});

test('fresh capability selection is explicit, readable legacy remains and malformed capability fails', () => {
  assert.equal(dictationStartPolicy({ new_start_versions: ['legacy-whitespace-v1', 'lexical-v2'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] }), 'lexical-v2');
  assert.equal(dictationStartPolicy({ new_start_versions: ['legacy-whitespace-v1'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] }), 'legacy-whitespace-v1');
  for (const payload of [null, { new_start_versions: [], readable_versions: ['legacy-whitespace-v1'] }, { new_start_versions: ['future'], readable_versions: ['legacy-whitespace-v1'] }]) assert.throws(() => dictationStartPolicy(payload));
});

test('legacy scores/diff remain unchanged; version cannot be guessed from a digest', () => {
  const baseline = { score: 0.6667, is_correct: false, total_words: 3, correct_words: 2, diff: [{ op: 'miss', expected: '—' }] };
  const normalized = normalizeDictationGrade(baseline);
  assert.equal(normalized.score, baseline.score); assert.equal(normalized.total_words, 3);
  assert.equal(normalized.diff[0].expected, '—'); assert.equal(normalized.grading_version, 'legacy-whitespace-v1');
  assert.throws(() => normalizeDictationPolicy({ reference_sha256: 'a'.repeat(64) }));
  assert.throws(() => normalizeDictationGrade(gold[0].grade, { grading_version: 'legacy-whitespace-v1', reference_sha256: null }));
});

for (const row of gold) test(`actual backend ${row.name} gold preserves raw text, score, spans and unscored punctuation`, () => {
  const grade = normalizeDictationGrade(row.grade, normalizeDictationPolicy(row.grade), { reference: row.grade.reference, user_text: row.grade.user_text });
  assert.equal(grade.score, row.grade.score); assert.equal(grade.total_words, row.grade.total_words);
  for (const side of ['reference', 'user']) {
    const segments = dictationDisplaySegments(grade, side);
    assert.equal(segments.map((segment) => segment.raw).join(''), side === 'reference' ? row.grade.reference : row.grade.user_text);
    assert.ok(segments.filter((segment) => segment.kind !== 'lexical').every((segment) => segment.op === null));
  }
  assert.equal(normalizeDictationAttempt(attempt(row)).reference_sha256, row.grade.reference_sha256);
  assert.equal(normalizeDictationReport(report(row), 'request-1', grade).accuracy, row.grade.score);
});

test('Unicode codepoint positions after astral symbols are not sliced as UTF16', () => {
  const grade = normalizeDictationGrade(gold[0].grade);
  const segment = grade.reference_segments.find((segment) => segment.raw === "don't");
  assert.notEqual(grade.reference.slice(segment.start, segment.end), "don't");
  assert.equal(Array.from(grade.reference).slice(segment.start, segment.end).join(''), "don't");
});

test('wrong policy/hash/source, overlapping span, non-bijective ops and punctuation-as-error fail before ACK', () => {
  const mutations = [
    (g) => { g.grading_version = 'future'; }, (g) => { g.reference_sha256 = null; },
    (g) => { g.sentence_reference_sha256 = 'a'.repeat(64); },
    (g) => { g.reference_segments[1].start += 1; }, (g) => { g.diff[0].expected_span.segment_index += 1; },
    (g) => { g.diff[0].op = 'extra'; }, (g) => { g.diff[0].expected = '—'; },
    (g) => { g.diff.push(copy(g.diff[0])); }, (g) => { g.correct_words -= 1; },
    (g) => { g.score = 0; g.is_correct = false; },
  ];
  for (const mutate of mutations) { const g = copy(gold[0].grade); mutate(g); assert.throws(() => normalizeDictationGrade(g)); }
  assert.throws(() => normalizeDictationGrade(gold[0].grade, gold[0].grade, { reference: 'changed', user_text: gold[0].grade.user_text }));
  const changed = attempt(); changed.units = [{ text: 'edited current content' }]; assert.throws(() => normalizeDictationAttempt(changed));
});

test('v2 score keeps the four-decimal round-tie tolerance and rejects contradictory matched counts', () => {
  const tie = gold.find((row) => row.name === 'round-tie').grade;
  assert.equal(tie.correct_words / tie.total_words, .03125);
  assert.equal(normalizeDictationGrade(tie).score, tie.score);
  assert.throws(() => normalizeDictationGrade({ ...tie, score: .0314 }));
  const perfect = gold.find((row) => row.name === 'extra-full-credit').grade;
  assert.equal(normalizeDictationGrade(perfect).score, 1);
  assert.ok(perfect.diff.some((op) => op.op === 'extra' && !op.filler));
});

test('v2 completion rejects a contradictory session mean or coerced counts before confirming its receipt', () => {
  const valid = report();
  assert.equal(normalizeDictationReport(valid).accuracy, 1);
  assert.throws(() => normalizeDictationReport({ ...valid, accuracy: 0 }));
  for (const key of ['total_sentences', 'correct_count', 'total_words', 'correct_words', 'accuracy']) {
    for (const value of [null, true, String(valid[key])]) assert.throws(() => normalizeDictationReport({ ...valid, [key]: value }));
  }
  const tie = report(gold.find((row) => row.name === 'round-tie'));
  assert.equal(normalizeDictationReport(tie).accuracy, tie.accuracy);
  assert.throws(() => normalizeDictationReport({ ...tie, accuracy: tie.accuracy + .0001 }));
});

test('resume restores frozen v2 evidence; receipt retry cannot switch policy or stale overall hash', () => {
  const source = attempt(); source.answers = [{ ...gold[0].grade, sentence_idx: 0, user_transcript: gold[0].grade.user_text, grading_evidence: gold[0].grade }];
  const restored = normalizeDictationAttempt(source); assert.equal(restored.answers[0].reference, gold[0].grade.reference);
  const receipt = { submission: { attempt_id: source.attempt_id, test_id: source.test_id, section_num: 1, ...dictationPolicyAcknowledgement(restored) } };
  assert.ok(reconcileDictationReceiptWithAttempt(receipt, restored));
  for (const policy of [{ grading_version: 'legacy-whitespace-v1', reference_sha256: null }, { grading_version: 'lexical-v2', reference_sha256: 'a'.repeat(64) }]) assert.equal(reconcileDictationReceiptWithAttempt({ submission: { ...receipt.submission, ...policy } }, restored), null);
  assert.throws(() => normalizeDictationReport({ ...report(), grading_version: 'legacy-whitespace-v1', reference_sha256: null }, 'request-1', restored));
});

test('admin mixed-version mean is session-weighted, preserves source values and rejects inconsistent breakdown', () => {
  const payload = { session_count: 3, mean_accuracy: .8, top_missed: [], top_wrong: [], versions: [
    { grading_version: 'legacy-whitespace-v1', session_count: 2, mean_accuracy: .7 },
    { grading_version: 'lexical-v2', session_count: 1, mean_accuracy: 1 }] };
  const result = normalizeDictationAggregate(payload); assert.equal(result.meanAccuracy, .8); assert.equal(result.versions[0].meanAccuracy, .7);
  for (const versions of [payload.versions.slice(0, 1), [...payload.versions, payload.versions[0]], [{ ...payload.versions[0], mean_accuracy: .8 }, payload.versions[1]], [{ ...payload.versions[0], grading_version: 'future' }, payload.versions[1]]]) assert.equal(normalizeDictationAggregate({ ...payload, versions }), null);
  assert.equal(normalizeDictationAggregate({ session_count: 0, mean_accuracy: 0, top_missed: [], top_wrong: [], versions: [] }).versions.length, 0);
  // Actual backend rounds each mean independently to four decimals.
  assert.ok(normalizeDictationAggregate({ ...payload, session_count: 2, mean_accuracy: .8334,
    versions: [{ grading_version: 'legacy-whitespace-v1', session_count: 1, mean_accuracy: .6667 }, { grading_version: 'lexical-v2', session_count: 1, mean_accuracy: 1 }] }));
});

test('report URL accepts exactly one owned UUID and never treats invalid/duplicate report intent as fresh admission', () => {
  const id = '00000000-0000-4000-8000-000000000123';
  assert.equal(dictationParams(`?session_id=${id}`).sessionId, id);
  for (const query of [`?test_id=test-1&session_id=`, `?test_id=test-1&session_id=bad`, `?test_id=test-1&session_id=${id}&session_id=${id}`, '?test_id=test-1&test_id=test-2']) assert.throws(() => dictationParams(query));
});

test('legacy stored optional values remain absent and missing originals are not reconstructed', () => {
  const stored = normalizeDictationStoredReport({ id: 'stored', results: [{ sentence_idx: 0, user_text: 'hello', score: .5, correct_words: 1, total_words: 2 }] }, 'stored');
  assert.equal(stored.accuracy, null); assert.equal(stored.total_sentences, null); assert.equal(stored.total_words, null);
  assert.equal(stored.results[0].reference, undefined); assert.equal(stored.results[0].score, .5);
  assert.throws(() => normalizeDictationStoredReport({ id: 'other', results: [] }, 'stored'));
  assert.throws(() => normalizeDictationStoredReport({ id: 'stored', total_words: true, results: [] }, 'stored'));
  const absent = normalizeDictationStoredReport({ id: 'stored', results: [{ sentence_idx: 0, user_text: 'hello', score: null, correct_words: null, total_words: null }] }, 'stored');
  assert.equal(absent.results[0].score, null); assert.equal(absent.results[0].correct_words, null); assert.equal(absent.results[0].total_words, null);
  assert.equal(absent.results[0].reference, undefined);
  for (const key of ['score', 'correct_words', 'total_words']) assert.throws(() => normalizeDictationStoredReport({ id: 'stored', results: [{ ...absent.results[0], [key]: true }] }, 'stored'));
});

test('admin legacy optional summaries, originals and error counts stay unavailable rather than malformed or zero', () => {
  const raw = { id: 'old', user: { id: 'learner' }, grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    total_sentences: null, correct_count: null, accuracy: null, total_words: null, correct_words: null,
    association_lookup_failed: false, association_lookup_failures: [],
    results: [{ sentence_idx: 0, user_text: 'Hello', score: .5, correct_words: 1, total_words: 2, reference: null, ops: null }] };
  const row = normalizeDictationReportItem(raw); assert.equal(row.accuracy, null); assert.equal(row.totalSentences, null);
  const detail = normalizeDictationReportDetail(raw, 'old'); assert.equal(detail.sentences.length, 1);
  assert.equal(detail.totalWords, null); assert.equal(detail.missingSentenceCount, null);
  assert.equal(detail.sentences[0].reference, null); assert.equal(detail.sentences[0].ops, null);
  const nullable = normalizeDictationReportDetail({ ...raw, results: [{ ...raw.results[0], score: null, correct_words: null, total_words: null }] }, 'old');
  assert.equal(nullable.sentences.length, 1); assert.equal(nullable.malformedSentenceCount, 0);
  assert.equal(nullable.sentences[0].score, null); assert.equal(nullable.sentences[0].correctWords, null); assert.equal(nullable.sentences[0].totalWords, null);
  for (const key of ['score', 'correct_words', 'total_words']) assert.equal(normalizeDictationReportDetail({ ...raw, results: [{ ...raw.results[0], [key]: true }] }, 'old').malformedSentenceCount, 1);
  assert.equal(normalizeDictationReportItem({ ...raw, accuracy: true }), null);
  assert.equal(normalizeDictationReportItem({ ...raw, grading_version: 'lexical-v2', reference_sha256: 'a'.repeat(64) }), null);
});

test('N-1 missing-both receipt accepts only authoritative legacy with exact owner receipt/attempt/section/payload', () => {
  const reference = '— Hello there.';
  const hash = coreInputDigest('dictation-texts-v1\n' + coreInputDigest(reference));
  const receipt = { requestId: 'request-1', submission: { attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1,
    sentences: [{ sentence_idx: 0, user_transcript: 'Hello there.', listen_count: 2, time_seconds: 8 }] } };
  const saved = { session_id: 'session-1', attempt_id: 'attempt-1', client_request_id: 'request-1', section_num: 1,
    grading_version: 'legacy-whitespace-v1', reference_sha256: hash, total_sentences: 1, correct_count: 0, accuracy: .6667,
    total_words: 3, correct_words: 2, results: [{ sentence_idx: 0, reference, user_text: 'Hello there.', score: .6667,
      correct_words: 2, total_words: 3, listen_count: 2, time_seconds: 8, diff: [{ op: 'miss', expected: '—' }] }] };
  const restored = normalizeDictationReceiptReport(saved, receipt); assert.equal(restored.reference_sha256, hash); assert.equal(restored.accuracy, .6667);
  // Real legacy completion rows have optional per-sentence policy fields.
  assert.equal(normalizeDictationStoredReport({ ...saved, id: 'session-1' }, 'session-1').results[0].score, .6667);
  const current = normalizeDictationAttempt({ attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1, status: 'in_progress',
    grading_version: 'legacy-whitespace-v1', reference_sha256: hash, units: [{ text: reference }],
    answers: [{ ...saved.results[0], grading_version: 'legacy-whitespace-v1', reference_sha256: hash, user_transcript: 'Hello there.' }] });
  const retry = reconcileDictationReceiptWithAttempt(receipt, current);
  assert.equal(retry.requestId, receipt.requestId); assert.equal(retry.submission.reference_sha256, hash); assert.equal(retry.submission.grading_version, 'legacy-whitespace-v1');
  assert.deepEqual(retry.submission.sentences, receipt.submission.sentences);
  const legacySaved = { ...current, answers: [{ ...saved.results[0], user_transcript: 'Hello there.', grading_version: 'legacy-whitespace-v1', reference_sha256: null }] };
  const reread = normalizeDictationAttempt(legacySaved);
  assert.equal(reread.answers[0].score, .6667); assert.equal(reread.answers[0].total_words, 3); assert.equal(reread.answers[0].reference_sha256, hash);
  assert.throws(() => normalizeDictationAttempt({ ...legacySaved, answers: [{ ...legacySaved.answers[0], reference_sha256: 'a'.repeat(64) }] }));
  for (const patch of [{ ...report(), client_request_id: receipt.requestId, section_num: 1 }, { ...saved, attempt_id: 'other' },
    { ...saved, client_request_id: 'another' }, { ...saved, section_num: 2 }, { ...saved, grading_version: null }, { ...saved, grading_version: true },
    { ...saved, reference_sha256: true }, { ...saved, reference_sha256: 'a'.repeat(64) }, { ...saved, results: [{ ...saved.results[0], user_text: 'changed payload' }] }]) assert.throws(() => normalizeDictationReceiptReport(patch, receipt));
  assert.throws(() => normalizeDictationReceiptReport(saved, { ...receipt, submission: { ...receipt.submission, grading_version: 'legacy-whitespace-v1', reference_sha256: 'a'.repeat(64) } }));
  assert.equal(normalizeDictationReceiptReport({ ...saved, attempt_id: null }, { ...receipt, submission: { ...receipt.submission, attempt_id: null } }).attempt_id, null);
});

test('admin v2 sentence uses persisted raw evidence and exposes missing/corrupt evidence without substituting current content', () => {
  const raw = { ...report(), id: 'session-1', user: { id: 'user-1' }, association_lookup_failed: false, association_lookup_failures: [] };
  const detail = normalizeDictationReportDetail(raw, 'session-1'); assert.equal(detail.sentences[0].reference, gold[0].grade.reference);
  assert.equal(detail.sentences[0].gradingEvidence.reference_segments.map((s) => s.raw).join(''), gold[0].grade.reference);
  const corrupted = copy(raw); delete corrupted.results[0].grading_evidence;
  delete corrupted.results[0].reference_segments;
  assert.equal(normalizeDictationReportDetail(corrupted, 'session-1').missingSentenceCount, 1);
  assert.equal(normalizeDictationReportItem({ ...raw, grading_version: 'future' }), null);
});
