import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuizProgressOutbox } from '../lib/quiz-progress-outbox.mjs';
function queued(api, extra = {}) {
  let drained = false;
  return new QuizProgressOutbox({ sessionId: 'owned-session', api, engine: { drainBatch() { if (drained) return { attempts: [], word_stats: [] }; drained = true; return { attempts: [{ client_id: 'owned-attempt' }], word_stats: [{ item_key: 'owned-item' }] }; } }, ...extra });
}
test('managed malformed ACK retains the exact batch for an explicit ordinary retry', async () => {
  const outbox = queued({ post: async () => ({ ok: false }) }, { validateAck: (value) => value?.ok === true });
  assert.equal(await outbox.flush(true), false);
  assert.equal(outbox.keepalivePayload()?.attempts[0].client_id, 'owned-attempt');
});
test('typed reset-stale is sticky across queued flushes and keepalive', async () => {
  let posts = 0;
  const outbox = queued({ post: async () => { posts++; throw Object.assign(new Error('reset'), { status: 409, detail: { error_code: 'grammar_reset_stale' } }); } }, { validateAck: (value) => value?.ok === true });
  const a = outbox.flush(true); const b = outbox.flush(true);
  assert.equal(await a, false); assert.equal(await b, false);
  assert.equal(posts, 1);
  assert.equal(outbox.keepalivePayload(), null);
  assert.equal(outbox.blockedReason, 'grammar_reset_stale');
});
test('inactive queued dispatch makes no new request and never clears pending rows', async () => {
  let active = true; let release; let posts = 0;
  const wait = new Promise((r) => { release = r; });
  const outbox = queued({ post: async () => { posts++; await wait; return { ok: true }; } }, { validateAck: (value) => value?.ok === true, isActive: () => active });
  const first = outbox.flush(true); const second = outbox.flush(true);
  await Promise.resolve(); active = false; release();
  assert.equal(await first, false); assert.equal(await second, false); assert.equal(posts, 1);
  assert.equal(outbox.keepalivePayload(), null);
});
