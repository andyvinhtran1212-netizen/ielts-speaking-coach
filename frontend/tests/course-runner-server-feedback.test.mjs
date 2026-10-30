// SA-BANK-ANSWERS / J411R2: Course banks reach the browser WITHOUT keys.
//
// Mastery keeps per-question feedback, but it now comes from the /progress ack
// of the answer that was just recorded (one extra round trip). A sealed
// one-sitting assessment still shows no correctness at all. A network failure
// must never be graded locally: the answer stays queued and "retry" re-sends
// the same row.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunner } from '../public/js/course-runner.js';

const KEY = { q1: 1, q2: 2 };

function question(n) {
  // No answer / explain / why_wrong: exactly what the backend now serves.
  return {
    qid: 'q' + n, item_key: 'k' + n, skill: 'B01', type: 'mcq', subtype: 'B1',
    prompt: 'Câu ' + n, options: ['a', 'b', 'c', 'd'],
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function serverApi({ sealed = false, failProgress = 0, dropFeedback = false } = {}) {
  const stored = new Map();       // client_id -> row (first write wins)
  const calls = { progress: [] };
  let failures = failProgress;
  return {
    calls,
    stored,
    async get(path) {
      if (path.includes('/course-timer')) return { item_id: 'item-1', timer: { is_timed: false } };
      if (path.includes('/course-resume')) {
        return { session_id: 'sess-1', answered: [], completed: [], item_id: 'item-1' };
      }
      return {
        bank: { id: 'b1', title: 'Buổi 1' },
        questions: [question(1), question(2)],
        mastery: {
          item_id: 'item-1', answers_withheld: true, answers_sealed: sealed,
          retake_size: 2,
        },
      };
    },
    async post(path, body) {
      if (path === '/api/quiz/sessions') return { id: 'sess-1' };
      calls.progress.push(body.attempts.map((row) => ({ ...row })));
      if (failures > 0) { failures -= 1; throw new Error('mạng hỏng'); }
      body.attempts.forEach((row) => { if (!stored.has(row.client_id)) stored.set(row.client_id, row); });
      const ack = { ok: true, attempts: body.attempts.length, word_stats: 0 };
      if (!sealed && !dropFeedback) {
        ack.feedback = body.attempts.map((row) => {
          const first = stored.get(row.client_id);
          const ok = Number(first.answer_given) === KEY[first.qid];
          return {
            qid: first.qid, client_id: first.client_id, is_correct: ok,
            answer: KEY[first.qid], why_wrong: ok ? null : 'bẫy ' + first.answer_given,
            explain: 'giải thích ' + first.qid,
          };
        });
      }
      return ack;
    },
    async patch() { return {}; },
  };
}

async function loaded(api) {
  const runner = createRunner({ api, storage: memoryStorage(), userId: 'u1' });
  await runner.load('b1', { assignmentItemId: 'item-1' });
  runner.show();
  return runner;
}

test('mastery answer waits for the recorded server verdict, one row per request', async () => {
  const api = serverApi();
  const r = await loaded(api);
  assert.equal(r.answersWithheld, true);
  const res = await r.answer(0);
  assert.deepEqual(res, { correct: false, trap: 'bẫy 0', explain: 'giải thích q1', answer: 1 });
  assert.equal(api.calls.progress.length, 1, 'flushed at once, not after a 5-answer batch');
  assert.equal(api.calls.progress[0].length, 1);
  assert.equal(api.calls.progress[0][0].answer_given, '0');
  assert.deepEqual(r.marks, ['wrong']);
  assert.equal(r.pendingCount, 0);
  r.next(); r.show();
  assert.deepEqual(await r.answer(2), { correct: true, trap: null, explain: 'giải thích q2', answer: 2 });
  assert.deepEqual(r.marks, ['wrong', 'right']);
});

test('a network failure is not graded locally and retry re-sends the same row', async () => {
  const api = serverApi({ failProgress: 1 });
  const r = await loaded(api);
  const first = await r.answer(1);
  assert.equal(first.pending, true);
  assert.match(first.error, /mạng hỏng/);
  assert.equal(first.correct, undefined, 'no correctness without the server');
  assert.deepEqual(r.marks, ['answered']);
  assert.equal(r.awaitingFeedback, true);
  // A redraw + another click cannot record a second answer for this question.
  r.show();
  const again = await r.answer(3);
  assert.equal(again.correct, true, 'the verdict is for the FIRST recorded choice');
  assert.equal(api.stored.size, 1);
  const ids = api.calls.progress.map((batch) => batch[0].client_id);
  assert.equal(new Set(ids).size, 1, 'retry re-sent the same client_id');
  assert.equal(r.awaitingFeedback, false);
});

test('retryFeedback() recovers after a failed send', async () => {
  const api = serverApi({ failProgress: 1 });
  const r = await loaded(api);
  assert.equal((await r.answer(1)).pending, true);
  const res = await r.retryFeedback();
  assert.equal(res.correct, true);
  assert.equal(res.answer, 1);
  assert.deepEqual(r.marks, ['right']);
});

test('an ack without feedback stays pending instead of guessing', async () => {
  const r = await loaded(serverApi({ dropFeedback: true }));
  const res = await r.answer(1);
  assert.equal(res.pending, true);
  assert.deepEqual(r.marks, ['answered']);
});

test('sealed one-sitting assessment still shows no correctness', async () => {
  const api = serverApi({ sealed: true });
  const r = await loaded(api);
  const res = await r.answer(1);
  assert.deepEqual(res, { sealed: true, correct: null, trap: null, explain: '' });
  assert.deepEqual(r.marks, ['answered']);
});

test('a revision maps the original-index key back to the shuffled display', async () => {
  const api = serverApi();
  const r = await loaded(api);
  await r.startRetake(2, () => 0);
  r.show();
  const q = r.current();
  const displayed = q._perm.indexOf(KEY[q.qid]);
  const res = await r.answer(displayed);
  assert.equal(res.correct, true);
  assert.equal(res.answer, displayed);
  const sent = api.calls.progress.at(-1)[0];
  assert.equal(Number(sent.answer_given), KEY[q.qid], 'original index goes to the server');
});
