import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dictationParams, dictationReceiptKey, formatDictationTime, isMissingReceipt,
  normalizeDictationBundle, normalizeDictationGrade, normalizeDictationReceipt,
  normalizeDictationReport, topDictationWords,
} from '../lib/listening-dictation-controller.mjs';
import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLIENT = readFileSync(path.join(FRONTEND, 'app', '(authed-listening-dictation)', 'listening', 'dictation', 'session', 'listening-dictation-session.tsx'), 'utf8');
const LAYOUT = readFileSync(path.join(FRONTEND, 'app', '(authed-listening-dictation)', 'layout.tsx'), 'utf8');
const CSS = readFileSync(path.join(FRONTEND, 'public', 'css', 'listening-dictation-next.css'), 'utf8');

const bundle = () => ({
  id: 'test-1', test_id: 'LIS-1', title: '<img src=x onerror=alert(1)>',
  audio_url: 'https://audio.test/file.mp3', audio_duration_seconds: 90,
  sections: [{ section_num: 2, title: '<b>Section</b>', cue_start: 12,
    sentences: [' Hello there. ', 'Second sentence.'],
    timings: [{ start: 12, end: 15 }, { start: 15, end: 15 }],
    hints: [['Brighton'], ['']],
  }],
});

describe('native Listening Dictation model', () => {
  test('parses stable route identity and rejects malformed section', () => {
    assert.deepEqual(dictationParams('?test_id=t%2F1&section=2'), { testId: 't/1', section: 2 });
    assert.throws(() => dictationParams('?section=2'), /missing-dictation-test/);
    assert.throws(() => dictationParams('?test_id=t&section=0'), /invalid-dictation-section/);
  });

  test('normalizes authored text as data, safe audio and exact timing windows', () => {
    const normalized = normalizeDictationBundle(bundle());
    assert.equal(normalized.title, '<img src=x onerror=alert(1)>');
    assert.equal(normalized.sections[0].title, '<b>Section</b>');
    assert.deepEqual(normalized.sections[0].timings, [{ start: 12, end: 15 }, null]);
    assert.deepEqual(normalized.sections[0].hints, [['Brighton'], []]);
    assert.throws(() => normalizeDictationBundle({ ...bundle(), audio_url: 'javascript:alert(1)' }), /invalid-dictation-audio/);
    assert.throws(() => normalizeDictationBundle({ ...bundle(), sections: [] }), /empty-dictation-sections/);
  });

  test('rejects malformed grade and canonical receipt responses', () => {
    const grade = normalizeDictationGrade({ score: .75, is_correct: false, correct_words: 3, total_words: 4, diff: [{ op: 'wrong', actual: '<x>', expected: 'word' }, { op: 'invented' }] });
    assert.equal(grade.diff.length, 1);
    assert.equal(grade.diff[0].actual, '<x>');
    assert.throws(() => normalizeDictationGrade({ score: 2, correct_words: 0, total_words: 0, diff: [] }), /invalid-dictation-score/);

    const report = normalizeDictationReport({ session_id: 's1', client_request_id: 'req-1', total_sentences: 2, correct_count: 1, accuracy: .5, total_words: 8, correct_words: 4, results: [] }, 'req-1');
    assert.equal(report.session_id, 's1');
    assert.throws(() => normalizeDictationReport({ ...report, client_request_id: 'other' }, 'req-1'), /invalid-dictation-receipt/);
  });

  test('scopes pending receipts to exact account/test/section identity', () => {
    const identity = { accountId: 'u1', testId: 't1', sectionNum: 2 };
    const stored = { requestId: '550e8400-e29b-41d4-a716-446655440000', createdAt: '2026-08-15T00:00:00Z', ...identity, submission: { answer: 1 }, localResults: [{ score: .8 }], localReport: { accuracy: .8 } };
    assert.equal(dictationReceiptKey('u1', 't1', 2), 'av:dictation:v1:u1:t1:2');
    assert.equal(normalizeDictationReceipt(stored, identity).requestId, stored.requestId);
    assert.equal(normalizeDictationReceipt(stored, identity).localReport.accuracy, .8);
    assert.equal(normalizeDictationReceipt(stored, { ...identity, accountId: 'u2' }), null);
    assert.equal(isMissingReceipt({ status: 404 }), true);
    assert.equal(isMissingReceipt(new Error('HTTP 503')), false);
  });

  test('sorts useful error trends and formats durations truthfully', () => {
    assert.deepEqual(topDictationWords({ brighton: 2, address: 3, '': 8, bad: -1 }), [{ word: 'address', count: 3 }, { word: 'brighton', count: 2 }]);
    assert.equal(formatDictationTime(125), '2 phút 5 giây');
    assert.equal(formatDictationTime(null), '—');
    assert.equal(formatDictationTime(-1), '—');
  });
});

describe('native Listening Dictation ownership', () => {
  test('dark route is ready but admission remains on legacy until Gate E', () => {
    const policy = CORE_PLAYER_AFFINITY_POLICY.surfaces.listening_dictation;
    assert.equal(policy.next.path, '/listening/dictation/session');
    assert.equal(policy.next.route_ready, true);
    assert.equal(policy.admit_new, 'legacy');
  });

  test('renders authored content through React and owns the full workflow', () => {
    assert.doesNotMatch(CLIENT, /dangerouslySetInnerHTML|innerHTML/);
    assert.match(CLIENT, /dictation\/grade/);
    assert.match(CLIENT, /dictation\/session\/by-request/);
    assert.match(CLIENT, /client_request_id/);
    assert.match(CLIENT, /localStorage\.setItem/);
    assert.match(CLIENT, /Gửi lại và xác nhận/);
    assert.match(CLIENT, /dictation\/flag/);
    assert.match(CLIENT, /audio-player/);
  });

  test('loads the audio component and responsive token-only route CSS', () => {
    assert.match(LAYOUT, /audio-player\.js/);
    assert.match(LAYOUT, /listening-dictation-next\.css/);
    assert.match(CSS, /@media \(max-width: 780px\)/);
    assert.doesNotMatch(CSS, /#[0-9a-f]{3,8}\b/i);
  });
});
