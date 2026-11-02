// PC-J435: a timed single-attempt (sealed) Course test batches /progress.
//
// Before, every answer of a timed test was its own request, so thirty learners
// on the 300-question FINAL sent ~30 requests per think-time. A sealed answer
// has no per-answer feedback, so it can wait for a batch — but only while the
// server boundary is far away: migration 276 makes the time-cap close
// verification-only, so an answer still on the client at cutoff is lost.
//
// The fake server below keeps that contract: /progress admits rows by the
// server clock (409 after cutoff), is idempotent per client_id, and the
// time-cap PATCH only verifies rows that /progress already admitted.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunner } from '../public/js/course-runner.js';

const FLUSH_MS = 45000;
const NEAR_END_MS = 60000;
const MINUTE = 60 * 1000;

function question(i, idLength = 0) {
  const qid = idLength ? ('Q' + i + '-').padEnd(idLength, 'x') : 'Q' + i;
  return {
    qid, item_key: idLength ? ('trục ngữ pháp ' + i + ' ').padEnd(idLength, 'đ') : 'k' + i,
    skill: 'B01', type: 'mcq', subtype: 'B1', prompt: 'Câu ' + i,
    options: ['a', 'b', 'c', 'd'],
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

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * One learner, one timed assignment item. The server state (sessions, admitted
 * rows) and the clock outlive a runner, so a second runner on the same
 * harness + storage is the same learner reloading the page.
 */
function harness({ total = 10, remainingMs = 30 * MINUTE, sealed = true,
                   idLength = 0, timed = true } = {}) {
  const clock = { t: 1_000_000 };
  const cutoffAt = clock.t + remainingMs;
  const jobs = [];
  const questions = Array.from({ length: total }, (_, i) => question(i, idLength));
  const answered = new Map();     // session id -> admitted rows (first write wins)
  const ended = [];
  const calls = { progress: [], keepalive: [], patch: [] };
  let open = null;
  let sessions = 0;
  let failNext = 0;
  let loseAckNext = 0;
  let gate = null;

  const timer = () => (timed ? {
    is_timed: true, expires_at: null,
    time_remaining_seconds: Math.max(0, cutoffAt - clock.t) / 1000,
  } : { is_timed: false });
  const mastery = () => ({
    item_id: 'item-t', completion_mode: sealed ? 'single_attempt' : 'mastery',
    answers_sealed: sealed, answers_withheld: true, ...timer(),
  });

  async function admit(path, body, kind) {
    const sid = /\/sessions\/([^/]+)\/progress$/.exec(path)[1];
    calls[kind].push({
      at: clock.t, remaining: cutoffAt - clock.t, sid, bytes: bytes(body),
      rows: body.attempts.map((row) => ({ ...row })),
    });
    if (kind === 'progress' && gate) await gate.promise;
    if (failNext > 0) { failNext -= 1; throw new Error('mạng hỏng'); }
    if (clock.t >= cutoffAt) {
      const error = new Error('Đã hết thời gian làm bài — đáp án này không được ghi.');
      error.status = 409;
      throw error;
    }
    const list = answered.get(sid) || [];
    body.attempts.forEach((row) => {
      if (!list.some((r) => r.client_id === row.client_id)) {
        list.push({ ...row, admitted_at: clock.t });
      }
    });
    answered.set(sid, list);
    if (loseAckNext > 0) { loseAckNext -= 1; throw new Error('mất phản hồi'); }
    const ack = { ok: true, attempts: body.attempts.length, word_stats: 0 };
    if (!sealed) {
      ack.feedback = body.attempts.map((row) => {
        const first = list.find((r) => r.client_id === row.client_id);
        return {
          qid: first.qid, client_id: first.client_id,
          is_correct: first.answer_given === '1', answer: 1,
          why_wrong: null, explain: 'giải thích ' + first.qid,
        };
      });
    }
    return ack;
  }

  const api = {
    async get(path) {
      if (path.includes('/course-timer')) return { item_id: 'item-t', timer: timer() };
      if (path.includes('/course-resume')) {
        return {
          session_id: open, completed: ended.slice(), item_id: 'item-t',
          answers_sealed: sealed, timer: timer(),
          answered: (answered.get(open) || []).map((r) => ({ qid: r.qid, is_correct: null })),
        };
      }
      return { bank: { id: 'b1', title: 'FINAL' }, questions, mastery: mastery() };
    },
    async post(path, body) {
      if (path === '/api/quiz/sessions') {
        sessions += 1;
        open = 'sess-' + sessions;
        answered.set(open, []);
        return { id: open, timer: timer() };
      }
      return admit(path, body, 'progress');
    },
    async postWith(path, body, _headers, opts) {
      assert.equal(opts && opts.keepalive, true);
      return admit(path, body, 'keepalive');
    },
    async patch(path, body) {
      const sid = /\/sessions\/([^/]+)$/.exec(path)[1];
      calls.patch.push({ at: clock.t, sid, body });
      if (body.ended_by === 'time_cap') {
        const list = answered.get(sid) || [];
        if (body.attempts.some((a) => !list.some((r) => r.client_id === a.client_id))) {
          const error = new Error('Phiên đã đóng trước khi batch đáp án cuối được lưu.');
          error.status = 409;
          error.detail = { code: 'timed_course_final_batch_missing', message: error.message };
          throw error;
        }
      }
      ended.push(sid);
      if (open === sid) open = null;
      return {};
    },
  };

  return {
    api, clock, cutoffAt, jobs, calls, answered, questions,
    storage: memoryStorage(),
    remaining: () => cutoffAt - clock.t,
    failNext(n) { failNext = n; },
    loseAckNext(n) { loseAckNext = n; },
    pause() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      gate = { promise };
      return () => { gate = null; release(); };
    },
    schedule(fn, delay) { jobs.push({ at: clock.t + delay, delay, fn }); },
    rows(sid = 'sess-1') { return answered.get(sid) || []; },
    sent() { return calls.progress.length + calls.keepalive.length; },
  };
}

// Every fake call resolves on the microtask queue, so one macrotask hop lets
// any chain of flushes and acks finish.
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Move the fake clock, firing due timers in time order. */
async function advance(h, ms) {
  const end = h.clock.t + ms;
  for (;;) {
    h.jobs.sort((a, b) => a.at - b.at);
    const next = h.jobs[0];
    if (!next || next.at > end) break;
    h.jobs.shift();
    h.clock.t = Math.max(h.clock.t, next.at);
    next.fn();
    await settle();
  }
  h.clock.t = end;
  await settle();
}

async function load(h, random = () => 0.5) {
  const runner = createRunner({
    api: h.api, storage: h.storage, userId: 'u1',
    now: () => h.clock.t, schedule: h.schedule, random,
  });
  await runner.load('b1', { assignmentItemId: 'item-t' });
  runner.show();
  return runner;
}

async function answer(h, runner, picked = 1) {
  runner.show();
  const res = await runner.answer(picked);
  runner.next();
  await settle();
  return res;
}

function outboxIds(storage) {
  const ids = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (name.startsWith('cx-outbox:')) ids.push(JSON.parse(storage.getItem(name)).client_id);
  }
  return ids.sort();
}

// ── (a) batching while the boundary is far away ───────────────────────────

test('(a) sealed timed test holds 1–4 quick answers and sends the 5th as one batch', async () => {
  const h = harness();
  const r = await load(h);
  assert.equal(r.answersSealed, true);
  for (let i = 0; i < 4; i++) {
    const res = await answer(h, r);
    assert.deepEqual(res, { sealed: true, correct: null, trap: null, explain: '' });
    await advance(h, 1000);
  }
  assert.equal(h.sent(), 0, 'four quick answers far from cutoff stay in the batch');
  assert.equal(r.pendingCount, 4);
  assert.equal(outboxIds(h.storage).length, 4, 'held answers are already durable on the device');

  await answer(h, r);
  assert.equal(h.calls.progress.length, 1);
  assert.equal(h.calls.progress[0].rows.length, 5);
  assert.deepEqual(h.rows().map((row) => row.qid), ['Q0', 'Q1', 'Q2', 'Q3', 'Q4']);
  assert.equal(r.pendingCount, 0);
  assert.deepEqual(outboxIds(h.storage), [], 'the ACK clears exactly the sent rows');

  // The cancelled FLUSH_MS timer of the first answer must not send again.
  await advance(h, FLUSH_MS * 2);
  assert.equal(h.sent(), 1);
});

test('(a) the oldest held answer is sent FLUSH_MS after it was given', async () => {
  const h = harness();
  const r = await load(h);
  await answer(h, r);
  await advance(h, 5000);
  await answer(h, r);
  await advance(h, FLUSH_MS - 5000 - 1);
  assert.equal(h.sent(), 0, 'not before FLUSH_MS');
  await advance(h, 1);
  assert.equal(h.calls.progress.length, 1, 'one request at FLUSH_MS of the oldest answer');
  assert.deepEqual(h.calls.progress[0].rows.map((row) => row.qid), ['Q0', 'Q1']);
  assert.equal(r.pendingCount, 0);

  // A new batch starts its own timer.
  await answer(h, r);
  await advance(h, FLUSH_MS);
  assert.equal(h.calls.progress.length, 2);
  assert.deepEqual(h.calls.progress[1].rows.map((row) => row.qid), ['Q2']);
});

test('(a) a sealed test WITHOUT a timer keeps its plain 5-answer batch', async () => {
  const h = harness({ timed: false });
  const r = await load(h);
  assert.equal(r.isTimed, false);
  for (let i = 0; i < 4; i++) await answer(h, r);
  assert.equal(h.jobs.length, 0, 'no FLUSH_MS timer for an untimed test');
  assert.equal(h.sent(), 0);
  await answer(h, r);
  assert.equal(h.calls.progress.length, 1);
  assert.equal(h.calls.progress[0].rows.length, 5);
});

// ── (b) the last NEAR_END_MS: every answer goes at once ───────────────────

for (const remainingMs of [NEAR_END_MS, 30000, 2000]) {
  test(`(b) with ${remainingMs} ms left every sealed answer is sent at once`, async () => {
    const h = harness({ remainingMs });
    const r = await load(h);
    for (let i = 1; i <= 3; i++) {
      await answer(h, r);
      assert.equal(h.calls.progress.length, i);
      assert.equal(h.calls.progress[i - 1].rows.length, 1);
      await advance(h, 100);
    }
    assert.equal(h.rows().length, 3);
  });
}

// ── (c) an on-time answer always reaches /progress before cutoff ──────────

test('(c) an answer at NEAR_END_MS + 1 ms is sent when the last minute starts', async () => {
  const h = harness({ remainingMs: NEAR_END_MS + 1 });
  const r = await load(h);
  await answer(h, r);
  assert.equal(h.sent(), 0, 'still outside the last minute: held');
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].delay, 1, 'the hold never reaches into the last minute');
  await advance(h, 1);
  assert.equal(h.calls.progress.length, 1);
  assert.equal(h.calls.progress[0].remaining, NEAR_END_MS,
    'sent with the whole last minute left for retries');
  assert.equal(h.rows().length, 1);
});

test('(c) answers held near the end are admitted before cutoff; time-cap omits nothing', async () => {
  const h = harness({ remainingMs: 100 * 1000 });
  const r = await load(h);
  const given = [];
  // 8 answers, one every 9 s, from 100 s left down to 37 s left; then the
  // learner stops and the clock runs out.
  for (let i = 0; i < 8; i++) {
    given.push(h.remaining());
    await answer(h, r);
    await advance(h, 9000);
  }
  await advance(h, h.remaining());
  assert.equal(r.isTimedOut(), true);
  const result = await r.finishStage({ endedBy: 'time_cap' });
  assert.equal(result.persisted, true);
  assert.equal(result.answersOmitted, false);
  assert.equal(h.calls.patch.at(-1).body.attempts.length, 0, 'nothing left for the verify-only close');
  const rows = h.rows();
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => row.admitted_at < h.cutoffAt));
  // Held only while more than a minute was left; batched into fewer requests.
  assert.ok(h.calls.progress.every((call) => call.remaining >= NEAR_END_MS
    || call.rows.length === 1));
  assert.ok(h.calls.progress.length < 8);
});

test('(c) property: no pacing ever holds an answer past FLUSH_MS or into the last minute', async () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let run = 0; run < 60; run++) {
    const h = harness({ total: 10, remainingMs: Math.round(70000 + rand() * 120000) });
    const r = await load(h);
    const answeredAt = new Map();      // qid -> remaining ms when given
    for (let i = 0; i < 10 && h.remaining() > 0; i++) {
      await advance(h, Math.min(Math.round(rand() * 25000), h.remaining()));
      if (r.isTimedOut()) break;
      answeredAt.set(h.questions[i].qid, h.remaining());
      await answer(h, r);
    }
    if (!r.isTimedOut()) await advance(h, h.remaining());
    const rows = h.rows();
    assert.equal(rows.length, answeredAt.size, `run ${run}: every on-time answer is on record`);
    for (const row of rows) {
      const given = answeredAt.get(row.qid);
      const admittedWith = h.cutoffAt - row.admitted_at;
      const latest = given <= NEAR_END_MS ? given : Math.max(given - FLUSH_MS, NEAR_END_MS);
      assert.ok(admittedWith >= latest,
        `run ${run}: ${row.qid} given at ${given} ms left, admitted at ${admittedWith} ms left`);
    }
  }
});

test('(c) a failed held batch is retried before cutoff, not left for the time-cap close', async () => {
  // The full FLUSH_MS hold fails 15 s before the last minute starts.
  const h = harness({ remainingMs: NEAR_END_MS + FLUSH_MS + 15000 });
  const r = await load(h);
  await answer(h, r);
  await answer(h, r);
  h.failNext(2);
  await advance(h, FLUSH_MS);
  assert.equal(h.calls.progress.length, 1, 'the held batch was sent at FLUSH_MS and failed');
  assert.equal(r.pendingCount, 2, 'the failed batch is back in the queue');
  await advance(h, h.remaining());
  const result = await r.finishStage({ endedBy: 'time_cap' });
  assert.equal(result.answersOmitted, false);
  assert.equal(h.rows().length, 2);
  assert.ok(h.rows().every((row) => row.admitted_at < h.cutoffAt));
});

// ── (d) every exit flushes held rows and the in-flight batch ──────────────

test('(d) finishing the stage sends held answers before the PATCH', async () => {
  const h = harness({ total: 3 });
  const r = await load(h);
  for (let i = 0; i < 3; i++) await answer(h, r);
  assert.equal(h.sent(), 0);
  const result = await r.finishStage();
  assert.equal(result.persisted, true);
  assert.equal(h.calls.progress.length, 1);
  assert.equal(h.calls.progress[0].rows.length, 3);
  assert.equal(h.calls.patch.length, 1);
  assert.ok(h.calls.progress[0].at <= h.calls.patch[0].at);
  assert.equal(h.rows().length, 3);
});

test('(d) sync() sends held answers', async () => {
  const h = harness();
  const r = await load(h);
  await answer(h, r);
  await answer(h, r);
  await r.sync();
  assert.equal(h.calls.progress.length, 1);
  assert.equal(h.rows().length, 2);
  assert.equal(r.pendingCount, 0);
});

test('(d) leave() keepalive carries the in-flight batch and the held answers', async () => {
  const h = harness();
  const r = await load(h);
  const release = h.pause();
  for (let i = 0; i < 5; i++) await answer(h, r);
  assert.equal(h.calls.progress.length, 1, 'the 5-answer batch is in flight');
  await answer(h, r);
  await answer(h, r);
  assert.equal(r.pendingCount, 2);
  // pagehide / visibilitychange hidden / soft navigation all call leave().
  await r.leave();
  assert.equal(h.calls.keepalive.length, 1);
  const carried = h.calls.keepalive[0].rows.map((row) => row.client_id);
  assert.equal(carried.length, 7);
  assert.deepEqual(carried.slice(0, 5), h.calls.progress[0].rows.map((row) => row.client_id));
  release();
  await settle();
  assert.equal(h.rows().length, 7, 'both requests together store each answer once');
  assert.equal(new Set(h.rows().map((row) => row.client_id)).size, 7);
  assert.deepEqual(outboxIds(h.storage), []);
});

test('(d) the keepalive body of a whole stage stays under the 64 KB limit', async () => {
  const h = harness({ total: 10, idLength: 160 });
  const r = await load(h);
  h.failNext(1000);                 // nothing gets through: everything accumulates
  for (let i = 0; i < 10; i++) await answer(h, r);
  await r.leave();
  const call = h.calls.keepalive.at(-1);
  assert.equal(call.rows.length, 10, 'a session never holds more than its stage');
  assert.ok(call.bytes < 64 * 1024, `keepalive body ${call.bytes} bytes`);
});

// ── (e) failures and reloads never lose or duplicate an answer ────────────

test('(e) a failed batch returns to the queue and the retry re-sends the same client_ids', async () => {
  const h = harness();
  const r = await load(h);
  for (let i = 0; i < 4; i++) await answer(h, r);
  h.failNext(1);
  await answer(h, r);
  assert.equal(h.calls.progress.length, 1);
  assert.equal(r.pendingCount, 5, 'failed rows are back in pending');
  assert.equal(outboxIds(h.storage).length, 5, 'and still in the outbox');
  assert.equal(h.jobs.length >= 1, true, 'a retry is scheduled without another answer');
  await advance(h, 5000);
  assert.equal(h.calls.progress.length, 2);
  assert.deepEqual(h.calls.progress[1].rows.map((row) => row.client_id),
    h.calls.progress[0].rows.map((row) => row.client_id));
  assert.equal(h.rows().length, 5);
  assert.equal(r.pendingCount, 0);
});

test('(e) a lost ACK is replayed without a duplicate row', async () => {
  const h = harness();
  const r = await load(h);
  for (let i = 0; i < 4; i++) await answer(h, r);
  h.loseAckNext(1);
  await answer(h, r);
  assert.equal(h.rows().length, 5, 'stored by the server, ACK lost');
  assert.equal(r.pendingCount, 5);
  await advance(h, 5000);
  assert.equal(h.calls.progress.length, 2);
  assert.equal(h.rows().length, 5);
  assert.equal(r.pendingCount, 0);
});

test('(e) a reload mid-batch restores the held answers from the outbox and sends them', async () => {
  const h = harness();
  const first = await load(h);
  for (let i = 0; i < 7; i++) await answer(h, first);
  assert.equal(h.rows().length, 5);
  assert.equal(first.pendingCount, 2);
  const heldIds = outboxIds(h.storage);
  assert.equal(heldIds.length, 2);

  // The tab dies without pagehide; the learner reopens the test.
  const second = await load(h);
  assert.equal(second.at, 7, 'the stage resumes after the held answers');
  assert.equal(h.rows().length, 7);
  assert.deepEqual(h.rows().slice(5).map((row) => row.client_id).sort(), heldIds);
  for (let i = 0; i < 3; i++) await answer(h, second);
  const result = await second.finishStage();
  assert.equal(result.persisted, true);
  assert.equal(h.rows().length, 10);
  assert.equal(new Set(h.rows().map((row) => row.qid)).size, 10);
});

// ── (f) mastery keeps one request per answer and its feedback ─────────────

test('(f) a timed mastery test still sends each answer at once and shows its verdict', async () => {
  const h = harness({ sealed: false });
  const r = await load(h);
  assert.equal(r.answersSealed, false);
  assert.equal(r.answersWithheld, true);
  assert.deepEqual(await answer(h, r, 1),
    { correct: true, trap: null, explain: 'giải thích Q0', answer: 1 });
  assert.deepEqual(await answer(h, r, 0),
    { correct: false, trap: null, explain: 'giải thích Q1', answer: 1 });
  assert.equal(h.calls.progress.length, 2);
  assert.ok(h.calls.progress.every((call) => call.rows.length === 1));
  assert.equal(h.jobs.length, 0, 'no batch timer on the mastery path');
  assert.deepEqual(r.marks, ['right', 'wrong']);
});

// ── (g) jittered retry ────────────────────────────────────────────────────

test('(g) retry delays are equally jittered and never pass the admission margin', async () => {
  const draws = [0, 0.5, 0.999999];
  for (const draw of draws) {
    const h = harness({ remainingMs: 30 * 1000 });
    const r = await load(h, () => draw);
    h.failNext(5);
    await answer(h, r);
    const delays = [];
    for (let i = 0; i < 5; i++) {
      const job = h.jobs.at(-1);
      delays.push(job.delay);
      await advance(h, job.delay);
    }
    const steps = [250, 500, 1000, 2000, 4000];
    delays.forEach((delay, i) => {
      assert.ok(delay <= steps[i] && delay >= steps[i] / 2,
        `draw ${draw}: retry ${i} delay ${delay} within [${steps[i] / 2}, ${steps[i]}]`);
    });
    assert.equal(delays[0], Math.round(250 * (1 - draw * 0.5)));
    assert.equal(h.rows().length, 1);
  }
});

test('(g) a jittered retry never fires later than 25 ms before the boundary', async () => {
  let seed = 3;
  const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (const remainingMs of [26, 60, 200, 700, 3000]) {
    const h = harness({ remainingMs });
    const r = await load(h, rand);
    h.failNext(1000);
    await answer(h, r);
    while (h.jobs.length) {
      const job = h.jobs.at(-1);
      assert.ok(job.at <= h.cutoffAt - 25,
        `retry at ${h.cutoffAt - job.at} ms before cutoff (delay ${job.delay})`);
      await advance(h, job.delay);
    }
    assert.equal(r.pendingCount, 1, 'the unadmitted answer stays visible');
  }
});
