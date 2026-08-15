import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildListeningAuditQuestionPatch,
  buildListeningAuditReceipt,
  formatListeningAuditOptions,
  listeningAuditAudioForSection,
  listeningAuditPlayback,
  listeningAuditReceiptKey,
  listeningAuditReceiptReconciled,
  normalizeListeningAuditAudio,
  normalizeListeningAuditDetail,
  normalizeListeningAuditReceipt,
  parseListeningAuditOptions,
  questionMatchesListeningAuditPatch,
  transcriptMatchesListeningAuditPatch,
} from '../lib/admin-listening-audit-detail-model.mjs';

const issue = (source = 'structural', code = 'no_window') => ({ q_num: 1, dimension: 'timeline', severity: 'error', source, code, message: 'Thiếu window', resolved: false });
const payload = () => ({
  uuid: 'test-1', test_id: 'ILR-AUD-001', title: 'Fixture', status: 'published', test_type: 'full', question_count: 1, section_count: 1,
  sections: [{ section_num: 2, content_id: 'content-2', content_updated_at: '2026-08-14T01:00:00Z', audio_offset: 100, transcript: 'Hello', questions: [{
    q_num: 1, exercise_id: 'exercise-1', exercise_updated_at: '2026-08-14T01:00:00Z', template_kind: 'mcq_3option', prompt: 'Pick',
    options: [{ letter: 'A', text: 'One' }], answer: 'A', alternatives: ['one'], trap_mechanisms: ['contrast'], solution: 'Because',
    audio_window: { start: 1, end: 3, section: 'S2' },
  }]}],
  live: { issues: [issue()], health: { error_count: 1, warning_count: 0, status: 'has_issues' } },
  saved: { test_id: 'test-1', status: 'has_issues', notes: 'review', auditor: 'admin-1', audited_at: '2026-08-14T02:00:00Z', updated_at: '2026-08-14T02:00:00Z',
    issues: [issue('llm', 'answer_in_script')], health: { error_count: 1, warning_count: 0, status: 'has_issues' } },
});

test('normalizer binds exact id, counts, version tokens and provenance', () => {
  const value = normalizeListeningAuditDetail(payload(), 'test-1');
  assert.equal(value.sections[0].contentUpdatedAt, '2026-08-14T01:00:00Z');
  assert.equal(value.sections[0].audioOffset, 100);
  assert.equal(value.sections[0].questions[0].exerciseUpdatedAt, '2026-08-14T01:00:00Z');
  assert.equal(value.live.issues[0].source, 'structural');
  assert.equal(value.saved.issues[0].index, 0);
});

test('normalizer rejects wrong id, count mismatch and missing versions', () => {
  for (const mutate of [
    (raw) => { raw.uuid = 'other'; },
    (raw) => { raw.question_count = 2; },
    (raw) => { raw.sections[0].questions[0].exercise_updated_at = null; },
    (raw) => { raw.sections[0].content_updated_at = ''; },
    (raw) => { raw.live.issues[0].source = 'llm'; },
  ]) { const raw = payload(); mutate(raw); assert.equal(normalizeListeningAuditDetail(raw, 'test-1'), null); }
});

test('bad or duplicate q_num keeps the workspace open but locks ambiguous cards', () => {
  const bad = payload(); bad.sections[0].questions[0].q_num = 'broken';
  const badValue = normalizeListeningAuditDetail(bad, 'test-1');
  assert.ok(badValue); assert.equal(badValue.sections[0].questions[0].editable, false);
  assert.match(badValue.sections[0].questions[0].identityWarning, /q_num canonical/);

  const duplicate = payload(); duplicate.question_count = 2;
  duplicate.sections[0].questions.push({ ...structuredClone(duplicate.sections[0].questions[0]), exercise_id: 'exercise-2' });
  const duplicateValue = normalizeListeningAuditDetail(duplicate, 'test-1');
  assert.ok(duplicateValue); assert.equal(duplicateValue.sections[0].questions[0].editable, false);
  assert.equal(duplicateValue.sections[0].questions[1].editable, false);
  assert.match(duplicateValue.sections[0].questions[0].identityWarning, /bị trùng/);
});

test('saved health is historical and need not equal resolved flags', () => {
  const raw = payload(); raw.saved.issues[0].resolved = true;
  assert.ok(normalizeListeningAuditDetail(raw, 'test-1'));
});

test('repair workspace degrades malformed editable fields instead of closing the page', () => {
  const raw = payload();
  raw.sections[0].questions[0].audio_window = { start: 9, end: 2, section: 'S2' };
  raw.sections[0].questions[0].options = [{ letter: 'A', text: '' }, { letter: 'A', text: 'Duplicate' }];
  const value = normalizeListeningAuditDetail(raw, 'test-1');
  assert.ok(value); assert.ok(value.sections[0].questions[0].repairWarnings.length >= 2);
  assert.equal(value.sections[0].questions[0].audioWindow.start, 9);
});

test('unreadable list fields cannot be silently cleared by an unrelated repair', () => {
  const raw = payload();
  raw.sections[0].questions[0].options = { A: 'One' };
  raw.sections[0].questions[0].alternatives = { primary: 'one' };
  const question = normalizeListeningAuditDetail(raw, 'test-1').sections[0].questions[0];
  assert.deepEqual(question.requiredRepairs.sort(), ['alternatives', 'options']);
  const built = buildListeningAuditQuestionPatch({ prompt: 'Fixed prompt', answer: question.answer,
    alternatives: '', traps: '', options: '', solution: question.solution, windowStart: '1', windowEnd: '3',
    requiredRepairs: question.requiredRepairs, hadAudioWindow: true }, question.exerciseUpdatedAt);
  assert.equal(built.ok, false); assert.match(built.error, /alternatives, options|options, alternatives/);
});

test('audio selection uses assembled then full then exact section, never first section', () => {
  const sectionOnly = normalizeListeningAuditAudio({ full: null, assembled: null, sections: [
    { section_num: 1, signed_url: 'https://cdn.test/one.mp3' }, { section_num: 2, signed_url: 'https://cdn.test/two.mp3' },
  ] });
  assert.equal(listeningAuditAudioForSection(sectionOnly, 2), 'https://cdn.test/two.mp3');
  assert.equal(listeningAuditAudioForSection(sectionOnly, 3), null);
  const assembled = normalizeListeningAuditAudio({ full: { signed_url: 'https://cdn.test/full.mp3' }, assembled: { signed_url: 'https://cdn.test/assembled.mp3' }, sections: [] });
  assert.equal(listeningAuditAudioForSection(assembled, 4), 'https://cdn.test/assembled.mp3');
  assert.deepEqual(listeningAuditPlayback(sectionOnly, { sectionNum: 2, audioOffset: 100 }, { start: 104, end: 107 }), { url: 'https://cdn.test/two.mp3', start: 4, end: 7, source: 'section' });
  assert.deepEqual(listeningAuditPlayback(assembled, { sectionNum: 2, audioOffset: 100 }, { start: 104, end: 107 }), { url: 'https://cdn.test/assembled.mp3', start: 104, end: 107, source: 'assembled' });
  assert.equal(listeningAuditPlayback(sectionOnly, { sectionNum: 2, audioOffset: null }, { start: 104, end: 107, section: 'S2' }), null);
  assert.equal(listeningAuditPlayback(sectionOnly, { sectionNum: 2, audioOffset: 100 }, { start: 104, end: 107, section: 'S3' }), null);
});

test('audio normalizer rejects unsafe or duplicate section mappings', () => {
  assert.equal(normalizeListeningAuditAudio({ full: null, assembled: null, sections: [{ section_num: 1, signed_url: 'javascript:alert(1)' }, { section_num: 1, signed_url: null }] }), null);
});

test('option parser accepts exact A | text lines and rejects duplicates/malformed', () => {
  assert.deepEqual(parseListeningAuditOptions('A | One\nB | Two'), { ok: true, value: [{ letter: 'A', text: 'One' }, { letter: 'B', text: 'Two' }] });
  assert.equal(parseListeningAuditOptions('A One').ok, false);
  assert.equal(parseListeningAuditOptions('A | One\nA | Again').ok, false);
  assert.equal(formatListeningAuditOptions([{ letter: 'A', text: 'One' }]), 'A | One');
  const multiline = formatListeningAuditOptions([{ letter: 'A', text: 'Line one\nLine two' }]);
  assert.deepEqual(parseListeningAuditOptions(multiline).value, [{ letter: 'A', text: 'Line one\nLine two' }]);
});

test('question patch includes all editable fields and concurrency token', () => {
  const built = buildListeningAuditQuestionPatch({ prompt: 'Prompt', answer: 'A', alternatives: 'London, UK\none', traps: 'contrast\ndistractor', options: 'A | One', solution: 'Why', windowStart: '1', windowEnd: '3' }, 'version-1');
  assert.equal(built.ok, true); assert.equal(built.value.expected_updated_at, 'version-1');
  assert.deepEqual(built.value.alternatives, ['London, UK', 'one']);
  assert.deepEqual(built.value.trap_mechanisms, ['contrast', 'distractor']); assert.deepEqual(built.value.audio_window, { start: 1, end: 3 });
});

test('question patch blocks missing token and invalid window', () => {
  const draft = { prompt: '', answer: '', alternatives: '', traps: '', options: '', solution: '', windowStart: '3', windowEnd: '1' };
  assert.equal(buildListeningAuditQuestionPatch(draft, 'v').ok, false);
  draft.windowStart = '1'; draft.windowEnd = '3'; assert.equal(buildListeningAuditQuestionPatch(draft, '').ok, false);
});

test('question without a window can still repair non-audio fields', () => {
  const built = buildListeningAuditQuestionPatch({ prompt: 'Fixed', answer: 'A', alternatives: '', traps: '', options: '', solution: '', windowStart: '', windowEnd: '' }, 'v1');
  assert.equal(built.ok, true); assert.equal(Object.hasOwn(built.value, 'audio_window'), false);
});

test('clearing both bounds on an existing window emits and verifies an explicit clear', () => {
  const built = buildListeningAuditQuestionPatch({ prompt: 'Fixed', answer: 'A', alternatives: '', traps: '', options: '', solution: '', windowStart: '', windowEnd: '', requiredRepairs: [], hadAudioWindow: true }, 'v1');
  assert.equal(built.ok, true); assert.equal(built.value.audio_window, null);
  assert.equal(questionMatchesListeningAuditPatch({ exerciseUpdatedAt: 'v2', prompt: 'Fixed', answer: 'A', alternatives: [], trapMechanisms: [], options: [], solution: '', audioWindow: null }, built.value, 'v1'), true);
});

test('canonical matchers require exact values and a changed version', () => {
  const patch = { prompt: 'P', answer: 'A', alternatives: [], trap_mechanisms: [], options: [], solution: 'S', audio_window: { start: 1, end: 2 } };
  const question = { exerciseUpdatedAt: 'v2', prompt: 'P', answer: 'A', alternatives: [], trapMechanisms: [], options: [], solution: 'S', audioWindow: { start: 1, end: 2 } };
  assert.equal(questionMatchesListeningAuditPatch(question, patch, 'v1'), true);
  assert.equal(questionMatchesListeningAuditPatch({ ...question, exerciseUpdatedAt: 'v1' }, patch, 'v1'), false);
  assert.equal(transcriptMatchesListeningAuditPatch({ contentUpdatedAt: 'v2', transcript: 'new' }, 'new', 'v1'), true);
  assert.equal(transcriptMatchesListeningAuditPatch({ contentUpdatedAt: 'v1', transcript: 'new' }, 'new', 'v1'), false);
});

test('receipt is account/test scoped and survives strict parsing', () => {
  const receipt = buildListeningAuditReceipt({ accountId: 'admin-1', testId: 'test-1', requestId: 'request-1', baselineAuditedAt: 'old', now: '2026-08-14T03:00:00Z' });
  assert.match(listeningAuditReceiptKey('admin-1', 'test-1'), /admin-1.*test-1/);
  assert.deepEqual(normalizeListeningAuditReceipt(JSON.stringify(receipt), { accountId: 'admin-1', testId: 'test-1' }), receipt);
  assert.equal(normalizeListeningAuditReceipt(JSON.stringify(receipt), { accountId: 'admin-2', testId: 'test-1' }), null);
});

test('receipt reconciles only against a changed audited_at and acknowledged value when present', () => {
  const base = buildListeningAuditReceipt({ accountId: 'a', testId: 't', requestId: 'request-a', baselineAuditedAt: '2026-08-14T01:00:00Z', now: '2026-08-14T03:00:00Z' });
  assert.equal(listeningAuditReceiptReconciled(base, { saved: { auditedAt: '2026-08-14T01:00:00Z', auditor: 'a' } }), false);
  assert.equal(listeningAuditReceiptReconciled(base, { saved: { auditedAt: '2026-08-14T04:00:00Z', health: { requestId: 'request-a' } } }), true);
  assert.equal(listeningAuditReceiptReconciled(base, { saved: { auditedAt: '2026-08-14T04:00:00Z', health: { requestId: 'other' } } }), false);
  assert.equal(listeningAuditReceiptReconciled(base, { saved: { auditedAt: '2026-08-13T04:00:00Z', auditor: 'a' } }), false);
  const ack = { ...base, acknowledgedAuditedAt: '2026-08-14T04:00:00Z' };
  assert.equal(listeningAuditReceiptReconciled(ack, { saved: { auditedAt: '2026-08-14T05:00:00Z', auditor: 'a' } }), false);
  assert.equal(listeningAuditReceiptReconciled(ack, { saved: { auditedAt: '2026-08-14T04:00:00Z', auditor: 'other' } }), true);
});
