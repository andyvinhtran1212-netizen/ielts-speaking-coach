import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createListeningSaveCoordinator,
  isPracticeListeningTest,
  isRetriableListeningSave,
  listeningAnswersFromRows,
  listeningDictationHref,
  listeningInlineTokens,
  listeningLibraryHref,
  listeningQuestions,
  listeningRendererHref,
  listeningResumeOffsetSeconds,
  listeningReviewHref,
  listeningTableCellLines,
  listeningTestParams,
  normalizeListeningResume,
  normalizeListeningTest,
  splitListeningGapPrompt,
} from '../lib/listening-test-controller.mjs';
import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function testBundle() {
  return {
    id: 'test-1', test_id: 'LIS-1', title: 'Listening fixture', test_type: 'full',
    audio_url: 'https://audio.test/file.mp3', audio_duration_seconds: 120,
    sections: [{
      section_num: 2,
      exercises: [{ payload: { questions: [{ q_num: 2, prompt: 'Second' }] } }],
    }, {
      section_num: 1,
      exercises: [{ payload: { questions: [{ q_num: 1, prompt: 'First' }] } }],
    }],
  };
}

describe('native Listening test controller', () => {
  test('parses stable identity and preserves class/mock context', () => {
    assert.deepEqual(listeningTestParams('?id=LIS-1&class_item=h1&sitting_id=s1&mock_embed=1&from=mini'), {
      testId: 'LIS-1', classItem: 'h1', from: 'mini', sittingId: 's1', mockEmbed: true,
    });
    assert.throws(() => listeningTestParams('?from=full'), /missing-listening-test-identity/);
  });

  test('normalizes bundle, resume and canonical answer rows', () => {
    const normalized = normalizeListeningTest(testBundle());
    assert.deepEqual(normalized.sections.map((section) => section.section_num), [1, 2]);
    assert.deepEqual(listeningQuestions(normalized).map((row) => row.question.q_num), [1, 2]);
    const resume = normalizeListeningResume({ attempt: {
      attempt_id: 'a1', started_at: '2026-08-11T00:00:00Z',
      answers: [{ q_num: 2, user_answer: 'B' }], renderer_affinity: 'next',
    } });
    assert.deepEqual([...listeningAnswersFromRows(resume.answers)], [[2, 'B']]);
    assert.equal(resume.renderer_affinity, 'next');
    assert.equal(normalizeListeningResume({ attempt: null }), null);
    assert.throws(() => normalizeListeningResume({ attempt: {
      attempt_id: 'a1', started_at: '2026-08-11T00:00:00Z', renderer_affinity: 'other',
    } }), /invalid-listening-renderer-affinity/);
  });

  test('anchors resumed audio to server started_at', () => {
    assert.equal(listeningResumeOffsetSeconds('2026-08-11T00:00:00Z', Date.parse('2026-08-11T00:01:15Z')), 75);
    assert.throws(() => listeningResumeOffsetSeconds('bad'), /invalid-listening-start-time/);
  });

  test('keeps practice audio controls and navigation on allowlisted modes', () => {
    assert.equal(isPracticeListeningTest({ test_type: 'mini' }), true);
    assert.equal(isPracticeListeningTest({ test_type: 'full' }), false);
    assert.equal(listeningLibraryHref('drill'), '/listening/skills');
    assert.equal(listeningLibraryHref('mock', 's/1'), '/mock/result?sitting=s%2F1');
    assert.equal(listeningLibraryHref('https://evil.test'), '/listening/tests');
    assert.equal(listeningReviewHref('a 1', 'mini'), '/listening/review?attempt_id=a+1&from=mini');
    assert.equal(listeningReviewHref('a1', 'https://evil.test'), '/listening/review?attempt_id=a1&from=full');
    assert.equal(listeningDictationHref('t/1'), '/core-player/launch?surface=listening_dictation&test_id=t%2F1');
    assert.equal(
      listeningRendererHref('legacy', '?id=t%2F1&from=mini&ignored=x'),
      '/pages/listening-test.html?id=t%2F1&from=mini',
    );
    assert.equal(
      listeningRendererHref('next', '?id=t1&sitting_id=s1&mock_embed=1'),
      '/listening/test/session?id=t1&sitting_id=s1&mock_embed=1',
    );
  });

  test('places the answer control at the first authored blank token', () => {
    assert.deepEqual(splitListeningGapPrompt('Meet at the ____ after class'), {
      before: 'Meet at the ', after: ' after class',
    });
    assert.deepEqual(splitListeningGapPrompt('Room …… upstairs'), {
      before: 'Room ', after: ' upstairs',
    });
    assert.deepEqual(splitListeningGapPrompt('Starts .... sharp'), {
      before: 'Starts ', after: ' sharp',
    });
    assert.equal(splitListeningGapPrompt('No authored blank'), null);
  });

  test('parses legacy inline emphasis safely and keeps a styled gap in place', () => {
    assert.deepEqual(listeningInlineTokens('Write **NO MORE** than *ONE WORD*.'), [
      { type: 'text', text: 'Write ', emphasis: null },
      { type: 'text', text: 'NO MORE', emphasis: 'strong' },
      { type: 'text', text: ' than ', emphasis: null },
      { type: 'text', text: 'ONE WORD', emphasis: 'em' },
      { type: 'text', text: '.', emphasis: null },
    ]);
    assert.deepEqual(listeningInlineTokens('Choose **the ____ answer**', { insertGap: true }), [
      { type: 'text', text: 'Choose ', emphasis: null },
      { type: 'text', text: 'the ', emphasis: 'strong' },
      { type: 'gap', emphasis: 'strong' },
      { type: 'text', text: ' answer', emphasis: 'strong' },
    ]);
    assert.deepEqual(listeningInlineTokens('*italic **bold** text*'), [
      { type: 'text', text: 'italic ', emphasis: 'em' },
      { type: 'text', text: 'bold', emphasis: 'strong-em' },
      { type: 'text', text: ' text', emphasis: 'em' },
    ]);
    assert.deepEqual(listeningInlineTokens('<img src=x onerror=alert(1)>'), [
      { type: 'text', text: '<img src=x onerror=alert(1)>', emphasis: null },
    ]);
  });

  test('preserves table cell statements without splitting one sentence around a bare gap', () => {
    const sentence = ['Good for people keen on', { q_num: 1 }, 'activities'];
    assert.deepEqual(listeningTableCellLines(sentence), [sentence]);

    const multiLine = [
      { q_num: 9, prefix: 'Starting salary £', suffix: 'per hour' },
      'Start work at 5.30 a.m.',
      { q_num: 10, prefix: 'Bring', suffix: 'on day one' },
    ];
    assert.deepEqual(listeningTableCellLines(multiLine), [
      [multiLine[0]], [multiLine[1]], [multiLine[2]],
    ]);
  });

  test('retries transient errors but fails validation errors immediately', () => {
    for (const status of [408, 425, 429, 500, 503]) assert.equal(isRetriableListeningSave({ status }), true);
    assert.equal(isRetriableListeningSave(new TypeError('network')), true);
    for (const status of [400, 401, 403, 409, 422]) assert.equal(isRetriableListeningSave({ status }), false);
  });

  test('debounces to latest value and serializes writes attempt-wide', async () => {
    const timers = [];
    const writes = [];
    const releases = [];
    const coordinator = createListeningSaveCoordinator({
      save: (qNum, value) => new Promise((resolve) => { writes.push([qNum, value]); releases.push(resolve); }),
      setTimer: (callback) => { timers.push(callback); return callback; }, clearTimer: () => {},
    });
    coordinator.update(1, 'old');
    coordinator.update(1, 'new');
    coordinator.update(2, 'second');
    void timers[1]();
    void timers[2]();
    await Promise.resolve();
    assert.deepEqual(writes, [[1, 'new']]);
    releases.shift()({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(writes, [[1, 'new'], [2, 'second']]);
    releases.shift()({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    coordinator.dispose();
  });

  test('flush retries terminal failures and refuses to report clean while one remains', async () => {
    const timers = [];
    let writes = 0;
    const coordinator = createListeningSaveCoordinator({
      save: async () => { writes += 1; throw Object.assign(new Error('bad'), { status: 422 }); },
      setTimer: (callback) => { timers.push(callback); return callback; }, clearTimer: () => {},
    });
    coordinator.update(3, 'answer');
    await timers.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(coordinator.snapshot().get(3), 'failed');
    assert.equal(await coordinator.flush(), false);
    assert.equal(writes, 2);
    coordinator.dispose();
  });

  test('pagehide keepalive reissues an in-flight answer so unload cannot cancel the only save', async () => {
    const timers = [];
    const writes = [];
    const releases = [];
    const coordinator = createListeningSaveCoordinator({
      save: (qNum, value, options) => new Promise((resolve) => {
        writes.push([qNum, value, options.keepalive]);
        releases.push(resolve);
      }),
      setTimer: (callback) => { timers.push(callback); return callback; }, clearTimer: () => {},
    });
    coordinator.update(4, 'station');
    void timers.shift()();
    await Promise.resolve();
    assert.deepEqual(writes, [[4, 'station', false]]);
    assert.equal(await coordinator.flush({ keepalive: true }), true);
    await Promise.resolve();
    assert.deepEqual(writes, [[4, 'station', false], [4, 'station', true]]);
    releases.forEach((resolve) => resolve({ ok: true }));
    await new Promise((resolve) => setImmediate(resolve));
    coordinator.dispose();
  });
});

describe('native Listening test route contract', () => {
  const page = read('frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx');
  const layout = read('frontend/app/(authed-listening-player)/layout.tsx');

  test('stable Next route remains ready while staging admission is forward-rolled back', () => {
    const policy = CORE_PLAYER_AFFINITY_POLICY.surfaces.listening_test;
    assert.equal(policy.next.path, '/listening/test/session');
    assert.equal(policy.next.route_ready, true);
    assert.equal(policy.admit_new, 'legacy');
  });

  test('React owns state, audio and persistence without loading the legacy player', () => {
    assert.doesNotMatch(layout, /listening-test-player\.js/);
    assert.match(page, /export function ListeningTestSession/);
    assert.match(page, /useState<ListeningPhase>/);
    assert.match(page, /<audio/);
    assert.match(page, /<InlineText text=\{prompt\} gap=\{<GapInput/);
    assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
    assert.match(page, /listeningTableCellLines\(cell\)/);
  });

  test('uses an exam shell and distinct renderers for different Listening tasks', () => {
    assert.doesNotMatch(page, /<aver-chrome active="listening"/);
    assert.match(page, /exam-topbar listening-next-topbar/);
    assert.match(page, /function MatchingMatrixTemplate/);
    assert.match(page, /kind === 'matching'.*MatchingMatrixTemplate/);
    assert.match(page, /\['mcq_letter_label', 'plan_label'\].*SelectTemplate/);
    assert.match(page, /FormTemplate/);
    assert.match(page, /TableTemplate/);
    assert.match(page, /NotesTemplate/);
  });

  test('separates one-shot full-test audio from seekable practice audio', () => {
    assert.match(page, /listening-next-audio-prompt/);
    assert.match(page, /cannot pause, rewind or play it again/);
    assert.match(page, /practice \? <>/);
    assert.match(page, /Audio progress \(kéo để tua\)/);
    assert.match(page, /audioPromptOpen.*!isPracticeListeningTest/s);
    assert.match(page, /setAudioPromptOpen\(false\)/);
  });

  test('groups question navigation by Part and exposes current, review and save states', () => {
    assert.match(page, /listening-next-palette-group/);
    assert.match(page, /qNum === currentQuestion \? ' current'/);
    assert.match(page, /reviewQuestions\.has\(qNum\)/);
    assert.match(page, /moveQuestion\(-1\)/);
    assert.match(page, /moveQuestion\(1\)/);
    assert.match(page, /id=\{`q-\$\{qNum\}`\} data-q-num=\{qNum\}/);
    assert.match(page, /data-q-group=\{slots\.join\(' '\)\}/);
    assert.match(page, /querySelector<HTMLElement>\(`\[data-q-group~/);
  });

  test('uses canonical load, resume, start, answer and submit endpoints', () => {
    assert.match(page, /\/api\/listening\/tests\/\$\{encodeURIComponent\(params\.testId\)\}/);
    assert.match(page, /\/attempts\/in-progress/);
    assert.match(page, /\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(attempt\.attempt_id\)\}\/answers/);
    assert.match(page, /\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(attempt\.attempt_id\)\}\/submit/);
    assert.match(page, /\/renderer-affinity/);
    assert.match(page, /renderer_affinity_protocol: 'claim-v1'/);
    assert.match(page, /renderer_affinity: 'next'/);
    assert.match(page, /window\.location\.replace\(listeningRendererHref/);
  });

  test('preserves mock sealing, canonical resume and submit safety', () => {
    assert.match(page, /hook\.attach\('listening', nextAttempt\.attempt_id\)/);
    assert.match(page, /hook\?\.isSealedResponse/);
    assert.match(page, /const clean = await coordinatorRef\.current\?\.flush/);
    assert.match(page, /if \(!clean\)/);
    assert.match(page, /coordinatorRef\.current\?\.snapshot\?\.\(\)\.size/);
    assert.match(page, /audio\.ended \|\| audioEnded/);
    assert.match(page, /▶ Tiếp tục/);
    assert.match(page, /flushPage = \(\) => \{ void coordinator\.flush\(\{ keepalive: true \}\); \}/);
    assert.match(page, /flushHidden = \(\) => \{ if \(document\.visibilityState === 'hidden'\) void coordinator\.flush\(\); \}/);
  });

  test('summarizes the completed test before sending answer detail to review', () => {
    assert.match(layout, /exam-result-next\.css/);
    assert.match(page, /LISTENING · FULL TEST COMPLETE/);
    assert.match(page, /exam-result-part-grid/);
    assert.match(page, /exam-result-question-map/);
    assert.match(page, /listeningReviewHref\(attempt\.attempt_id, from\)/);
    assert.doesNotMatch(page, /→ \{row\.expected/);
  });
});
