import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  answersFromRows,
  consecutiveReadingQuestionRuns,
  createReadingSaveCoordinator,
  isRetriableReadingSave,
  normalizeReadingBoot,
  readingExamParams,
  readingLibraryHref,
  readingQuestionInstruction,
  readingRemainingSeconds,
  readingReviewHref,
} from '../lib/reading-exam-controller.mjs';
import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

describe('native Reading exam controller', () => {
  test('parses the stable player identity and preserves mock/class context', () => {
    assert.deepEqual(readingExamParams('?test_id=RD-1&class_item=homework-1&sitting_id=s1&mock_embed=1'), {
      testId: 'RD-1', share: null, classItem: 'homework-1', from: null,
      sittingId: 's1', mockEmbed: true,
    });
    assert.equal(readingExamParams('?share=abc').share, 'abc');
    assert.throws(() => readingExamParams('?from=full'), /missing-reading-exam-identity/);
  });

  test('normalizes canonical boot + server-owned resume answers', () => {
    const normalized = normalizeReadingBoot({
      test: {
        test_id: 'RD-1', title: 'Test', time_limit_minutes: 60,
        passages: [{ passage_order: 2 }, { passage_order: 1 }],
        questions: [{ q_num: 2 }, { q_num: 1 }],
      },
      in_progress: {
        attempt_id: 'a1', started_at: '2026-08-11T00:00:00Z',
        time_limit_minutes: 60,
        answers: [{ q_num: 2, user_answer: 'B' }],
      },
    });
    assert.deepEqual(normalized.test.passages.map((p) => p.passage_order), [1, 2]);
    assert.deepEqual(normalized.test.questions.map((q) => q.q_num), [1, 2]);
    assert.deepEqual([...answersFromRows(normalized.inProgress.answers)], [[2, 'B']]);
  });

  test('countdown is anchored to the backend started_at', () => {
    assert.equal(readingRemainingSeconds('2026-08-11T00:00:00Z', 60, Date.parse('2026-08-11T00:10:00Z')), 3000);
    assert.equal(readingRemainingSeconds('2026-08-11T00:00:00Z', 1, Date.parse('2026-08-11T00:02:00Z')), 0);
    assert.throws(() => readingRemainingSeconds('bad', 60), /invalid-reading-start-time/);
  });

  test('groups consecutive question types and keeps authored word-limit instructions', () => {
    const questions = [
      { q_num: 1, question_type: 'summary_completion', payload: { word_limit: 'ONE WORD ONLY' } },
      { q_num: 2, question_type: 'summary_completion' },
      { q_num: 3, question_type: 'mcq_single', payload: { options: ['A', 'B', 'C'] } },
    ];
    const runs = consecutiveReadingQuestionRuns(questions);
    assert.deepEqual(runs.map((run) => run.map((q) => q.q_num)), [[1, 2], [3]]);
    assert.match(readingQuestionInstruction(runs[0], 1), /Questions 1–2:.*ONE WORD ONLY/);
    assert.match(readingQuestionInstruction(runs[1], 1), /A, B or C/);
  });

  test('builds a capability-safe review URL with an allowlisted origin', () => {
    assert.equal(
      readingReviewHref('attempt 1', { anonId: 'anon/token', from: 'mini' }),
      '/pages/reading-review.html?attempt_id=attempt+1&anon=anon%2Ftoken&from=mini',
    );
    assert.equal(readingReviewHref('a1', { from: 'https://evil.test' }), '/pages/reading-review.html?attempt_id=a1&from=full');
    assert.equal(readingReviewHref('a1', { from: 'mock', sittingId: 's1' }), '/pages/reading-review.html?attempt_id=a1&from=mock&sitting=s1');
    assert.equal(readingLibraryHref('mini'), '/reading/mini-test');
    assert.equal(readingLibraryHref('mock', 's/1'), '/mock/result?sitting=s%2F1');
    assert.equal(readingLibraryHref('https://evil.test'), '/reading/test');
  });

  test('retries transient HTTP back-pressure but not validation failures', () => {
    for (const status of [408, 425, 429, 500, 503]) assert.equal(isRetriableReadingSave({ status }), true);
    assert.equal(isRetriableReadingSave(new TypeError('network')), true);
    for (const status of [400, 401, 403, 409, 422]) assert.equal(isRetriableReadingSave({ status }), false);
  });

  test('debounces a save and persists the latest value only', async () => {
    const timers = [];
    const writes = [];
    const coordinator = createReadingSaveCoordinator({
      save: async (qNum, value) => writes.push([qNum, value]),
      setTimer: (callback) => { timers.push(callback); return callbacksId(callback); },
      clearTimer: () => {},
    });
    coordinator.update(1, 'old');
    coordinator.update(1, 'new');
    await timers.at(-1)();
    assert.deepEqual(writes, [[1, 'new']]);
    coordinator.dispose();
  });

  test('a stale response cannot clear the failed state of a newer edit', async () => {
    const timers = [];
    const resolvers = [];
    const coordinator = createReadingSaveCoordinator({
      save: (_qNum, value) => new Promise((resolve, reject) => resolvers.push({ value, resolve, reject })),
      debounceMs: 0,
      retryDelays: [],
      setTimer: (callback) => { timers.push(callback); return callbacksId(callback); },
      clearTimer: () => {},
    });
    coordinator.update(1, 'old');
    void timers.shift()();
    await Promise.resolve();
    coordinator.update(1, 'new');
    void timers.shift()();
    await Promise.resolve();
    resolvers.find((item) => item.value === 'new').reject(Object.assign(new Error('bad'), { status: 422 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(coordinator.snapshot().get(1), 'failed');
    resolvers.find((item) => item.value === 'old').resolve({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(coordinator.snapshot().get(1), 'failed');
    coordinator.dispose();
  });

  test('flush sends values still inside the debounce window', async () => {
    const writes = [];
    const coordinator = createReadingSaveCoordinator({
      save: async (qNum, value, options) => writes.push([qNum, value, options.keepalive]),
      setTimer: () => 1,
      clearTimer: () => {},
    });
    coordinator.update(3, 'answer');
    await coordinator.flush({ keepalive: true });
    await Promise.resolve();
    assert.deepEqual(writes, [[3, 'answer', true]]);
    coordinator.dispose();
  });

  test('flush awaits an in-flight save without sending the same value twice', async () => {
    const timers = [];
    const writes = [];
    let release;
    const coordinator = createReadingSaveCoordinator({
      save: (qNum, value) => new Promise((resolve) => {
        writes.push([qNum, value]);
        release = resolve;
      }),
      setTimer: (callback) => { timers.push(callback); return callbacksId(callback); },
      clearTimer: () => {},
    });
    coordinator.update(4, 'current');
    timers.shift()();
    await Promise.resolve();
    const flushing = coordinator.flush();
    assert.deepEqual(writes, [[4, 'current']]);
    release({ ok: true });
    await flushing;
    assert.deepEqual(writes, [[4, 'current']]);
    coordinator.dispose();
  });

  test('retryFailed resends a terminally failed answer', async () => {
    const timers = [];
    let writes = 0;
    const coordinator = createReadingSaveCoordinator({
      save: async () => {
        writes += 1;
        if (writes === 1) throw Object.assign(new Error('invalid'), { status: 422 });
        return { ok: true };
      },
      setTimer: (callback) => { timers.push(callback); return callbacksId(callback); },
      clearTimer: () => {},
    });
    coordinator.update(5, 'answer');
    timers.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(coordinator.snapshot().get(5), 'failed');
    coordinator.retryFailed();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes, 2);
    assert.equal(coordinator.snapshot().has(5), false);
    coordinator.dispose();
  });
});

describe('native Reading exam route contract', () => {
  const page = read('frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx');
  const layout = read('frontend/app/(authed-reading-player)/layout.tsx');

  test('stable route is dark-ready while new admissions remain legacy', () => {
    const policy = CORE_PLAYER_AFFINITY_POLICY.surfaces.reading_exam;
    assert.equal(policy.next.path, '/reading/exam/session');
    assert.equal(policy.next.route_ready, true);
    assert.equal(policy.admit_new, 'legacy');
  });

  test('React owns the player and never boots the legacy reading-exam script', () => {
    assert.doesNotMatch(layout, /reading-exam\.js/);
    assert.match(page, /export function ReadingExamSession/);
    assert.match(page, /useState<ExamPhase>/);
  });

  test('uses the canonical boot, start, autosave and submit endpoints', () => {
    assert.match(page, /\/api\/reading\/test\/share\/\$\{encodeURIComponent\(params\.share\)\}\/boot/);
    assert.match(page, /\/api\/reading\/test\/\$\{encodeURIComponent\(params\.testId!\)\}\/boot/);
    assert.match(page, /\/api\/reading\/test\/attempts\/\$\{encodeURIComponent\(attempt\.attempt_id\)\}\/answers/);
    assert.match(page, /\/api\/reading\/test\/attempts\/\$\{encodeURIComponent\(attempt\.attempt_id\)\}\/submit/);
    assert.match(page, /\[\.\.\.answersRef\.current\]\.map/);
  });

  test('preserves anonymous capability, password and mock-sitting boundaries', () => {
    assert.match(page, /'X-Reading-Anon'/);
    assert.match(page, /'X-Reading-Password'/);
    assert.match(page, /hook\.attach\('reading', nextAttempt\.attempt_id\)/);
    assert.match(page, /hook\?\.isSealedResponse/);
    assert.match(page, /readingReviewHref\(attemptId, \{ anonId, from, sittingId \}\)/);
  });

  test('renders shared completion templates by consecutive run instead of placeholder cards', () => {
    assert.match(page, /consecutiveReadingQuestionRuns\(questions\)/);
    assert.match(page, /function FlowingCompletionRun/);
    assert.match(page, /template\?\.summary_text/);
    assert.match(page, /function DiagramImageRun/);
    assert.match(page, /readingQuestionInstruction\(run, part\)/);
  });
});

function callbacksId(callback) {
  return callback;
}
