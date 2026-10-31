import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAttemptFlagCoordinator } from '../lib/attempt-review-flags.mjs';

// PC-J127 / C13R2-05: review marks on ILR-RDG-CAM-B13-T2 (staging content)
// must come back after a reload, on the same attempt only.
const bundle = createRequire(import.meta.url)('./fixtures/reading-b13t2-staging-player.json');
const SCOPE = { protocol: 'question-cas-v1' };
const turn = () => new Promise((resolve) => setImmediate(resolve));

function backend() {
  const attempts = new Map();
  const rows = (attemptId) => {
    if (!attempts.has(attemptId)) {
      attempts.set(attemptId, new Map(bundle.questions.map((q) => [q.q_num, {
        q_num: q.q_num, question_id: `${attemptId}-q${q.q_num}`, flagged: false, revision: 0, updated_at: null,
      }])));
    }
    return attempts.get(attemptId);
  };
  const coordinator = (attemptId, restoredPending = []) => {
    let id = 0;
    return createAttemptFlagCoordinator({
      attemptId, restoredPending, debounceMs: 10000,
      makeOperationId: () => `${attemptId.slice(0, 8)}-0000-4000-8000-${String(++id).padStart(12, '0')}`,
      read: async () => ({ ...SCOPE, attempt_id: attemptId, review_flags: [...rows(attemptId).values()] }),
      write: async (body) => {
        const previous = rows(attemptId).get(body.q_num);
        if (previous.operation_id === body.operation_id) return { ...SCOPE, attempt_id: attemptId, ...previous, accepted: true, reason: 'replayed' };
        if (previous.revision !== body.expected_revision) return { ...SCOPE, attempt_id: attemptId, ...previous, accepted: false, reason: 'conflict' };
        const next = { ...previous, flagged: body.flagged, revision: previous.revision + 1, operation_id: body.operation_id };
        rows(attemptId).set(body.q_num, next);
        return { ...SCOPE, attempt_id: attemptId, ...next, accepted: true, reason: 'applied' };
      },
    });
  };
  return { rows, coordinator };
}

test('B13-T2 marks across all three parts reload on the same attempt and never on a new one', async () => {
  assert.equal(bundle.questions.length, 40);
  const server = backend();
  const first = server.coordinator('27a00000-a1');
  first.subscribe(() => {});
  await first.load();
  for (const qNum of [3, 11, 18, 27, 35, 40]) first.update(qNum, true);
  assert.equal(await first.flush(), true);
  first.update(11, false); // a saved false tombstone must also survive reload
  assert.equal(await first.flush(), true);
  // Toggled just before the reload: only the tab-scoped receipt carries it.
  first.update(20, true);
  const receipts = first.snapshot().pending;
  assert.deepEqual(receipts.map((r) => [r.q_num, r.flagged, r.sent]), [[20, true, false]]);
  first.dispose();

  const reloaded = server.coordinator('27a00000-a1', receipts);
  await reloaded.load();
  assert.deepEqual([...reloaded.snapshot().flagged].sort((a, b) => a - b), [3, 18, 20, 27, 35, 40]);
  assert.equal(reloaded.snapshot().states.get(20), 'failed');
  reloaded.retryFailed(); await turn();
  assert.equal(server.rows('27a00000-a1').get(20).flagged, true);
  assert.equal(server.rows('27a00000-a1').get(11).revision, 2);
  assert.equal(reloaded.snapshot().states.size, 0);
  reloaded.dispose();

  const replacement = server.coordinator('27a00000-a2');
  await replacement.load();
  assert.equal(replacement.snapshot().flagged.size, 0);
  replacement.dispose();

  // A late read for the previous attempt cannot fill the replacement.
  const crossed = createAttemptFlagCoordinator({
    attemptId: '27a00000-a2',
    read: async () => ({ ...SCOPE, attempt_id: '27a00000-a1', review_flags: [...server.rows('27a00000-a1').values()] }),
    write: async () => { throw new Error('no write expected'); },
  });
  await assert.rejects(crossed.load(), { status: 409 });
  assert.equal(crossed.snapshot().flagged.size, 0);
  crossed.dispose();
});
