// EXAMLISTENP-0069 T001 (FR-009, FR-015): legacy programme draft → account-bound local copy.
import assert from 'node:assert/strict';
import test from 'node:test';

import { localCopyKey, planLocalCopyReplay, readLocalCopy } from '../lib/exam-room/local-copy.mjs';
import {
  LISTENING_PRACTICE_SURFACE,
  migrateLegacyProgrammeDraft,
  planLegacyDraftMigration,
  resolveLegacyDraftChoice,
} from '../lib/listening-programme-answer-queue.mjs';
import { EXAM_ROOM_SURFACES } from '../lib/exam-room/flags.mjs';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const LEGACY = 'listening-programme-draft:att-1';
const scope = { surface: LISTENING_PRACTICE_SURFACE, ownerKey: 'user-a', attemptKey: 'att-1' };

function memoryStorage({ failSet = false, dropOnSet = false } = {}) {
  const values = new Map();
  const reads = [];
  return {
    values,
    reads,
    get length() { return values.size; },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => { reads.push(key); return values.get(key) ?? null; },
    setItem: (key, value) => {
      if (failSet && key !== LEGACY) throw new Error('quota');
      if (dropOnSet && key !== LEGACY) return;
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

function seedLegacy(storage, answers) {
  storage.values.set(LEGACY, JSON.stringify(answers));
}

test('the surface constant is the amendment 1 (b) name, and the exam-room flag accepts it (FR-015)', () => {
  assert.equal(LISTENING_PRACTICE_SURFACE, 'listening-practice');
  assert.ok(EXAM_ROOM_SURFACES.includes(LISTENING_PRACTICE_SURFACE));
});

test('plan: equal answers are dropped, different ones are asked, server null counts as empty', () => {
  const plan = planLegacyDraftMigration({ 3: 'B', 1: 'A', 5: '', 7: 'x', bad: 'y', 0: 'z' }, { 1: 'A', 3: 'C', 5: null });
  assert.deepEqual(plan.drop, [1, 5]);
  assert.deepEqual(plan.ask, [
    { qNum: 3, local: 'B', saved: 'C' },
    { qNum: 7, local: 'x', saved: '' },
  ]);
});

test('Scenario 7: a different answer is asked about, written to the new key without a server base, old key removed', () => {
  const storage = memoryStorage();
  seedLegacy(storage, { 3: 'B' });
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 3: 'C' }, now: NOW,
  });
  assert.deepEqual(result, { ask: [{ qNum: 3, local: 'B', saved: 'C' }], legacyCleared: true });
  assert.equal(storage.values.has(LEGACY), false);
  const copy = readLocalCopy(storage, { ...scope, now: NOW });
  assert.deepEqual(copy.answers, { 3: { value: 'B', baseSavedAt: null } });
  assert.equal(Object.prototype.hasOwnProperty.call(copy.answers[3], 'baseValue'), false);
  assert.equal(copy.expiresAt, NOW + 7 * 24 * 60 * 60 * 1000);
  // Replay never re-sends it on its own: it is listed under ask (0066 FR-035).
  const plan = planLocalCopyReplay(copy, { open: true, answers: { 3: { value: 'C' } } });
  assert.deepEqual(plan.resend, []);
  assert.deepEqual(plan.ask, [{ q: '3', local: 'B', server: 'C' }]);
});

test('a question the new copy already holds is not taken from the legacy draft', () => {
  const storage = memoryStorage();
  storage.values.set(localCopyKey(scope), JSON.stringify({ v: 1, ...scope, savedAt: NOW, expiresAt: NOW + 1e6, answers: { 3: { value: 'newer', baseValue: 'C' } } }));
  seedLegacy(storage, { 3: 'B', 4: 'X' });
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 3: 'C', 4: 'D' }, now: NOW,
  });
  assert.deepEqual(result, { ask: [{ qNum: 4, local: 'X', saved: 'D' }], legacyCleared: true });
  const copy = readLocalCopy(storage, { ...scope, now: NOW });
  assert.deepEqual(copy.answers[3], { value: 'newer', baseValue: 'C' });
  assert.equal(copy.answers[4].value, 'X');
});

test('Scenario 7: answers equal to the server are dropped without asking and nothing new is written', () => {
  const storage = memoryStorage();
  seedLegacy(storage, { 1: 'A', 2: 'B' });
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 1: 'A', 2: 'B' }, now: NOW,
  });
  assert.deepEqual(result, { ask: [], legacyCleared: true });
  assert.equal(storage.values.size, 0);
});

test('Scenario 7: a refused write to the new key keeps the old key intact', () => {
  const storage = memoryStorage({ failSet: true });
  seedLegacy(storage, { 3: 'B', 4: 'D' });
  const before = storage.values.get(LEGACY);
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 3: 'C', 4: 'D' }, now: NOW,
  });
  assert.equal(result.legacyCleared, false);
  assert.deepEqual(result.ask, [{ qNum: 3, local: 'B', saved: 'C' }]);
  assert.equal(storage.values.get(LEGACY), before);
});

test('a new key that does not read back keeps the old key intact', () => {
  const storage = memoryStorage({ dropOnSet: true });
  seedLegacy(storage, { 3: 'B' });
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 3: 'C' }, now: NOW,
  });
  assert.equal(result.legacyCleared, false);
  assert.ok(storage.values.has(LEGACY));
});

test('an attempt not returned for the signed-in account: the old key is neither read nor changed', () => {
  const storage = memoryStorage();
  seedLegacy(storage, { 3: 'B' });
  const result = migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-b', ownedByCurrentUser: false, serverAnswers: { 3: 'C' }, now: NOW,
  });
  assert.deepEqual(result, { ask: [], legacyCleared: false });
  assert.deepEqual(storage.reads, []);
  assert.ok(storage.values.has(LEGACY));
});

test('no storage, no legacy draft or a broken one: nothing to ask', () => {
  const args = { attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: {}, now: NOW };
  assert.deepEqual(migrateLegacyProgrammeDraft(null, args), { ask: [], legacyCleared: false });
  const empty = memoryStorage();
  assert.deepEqual(migrateLegacyProgrammeDraft(empty, args), { ask: [], legacyCleared: false });
  const broken = memoryStorage();
  broken.values.set(LEGACY, '{not json');
  assert.deepEqual(migrateLegacyProgrammeDraft(broken, args), { ask: [], legacyCleared: false });
});

test('migration merges into an existing copy and keeps its expiry', () => {
  const storage = memoryStorage();
  const key = localCopyKey(scope);
  const expiresAt = NOW + 60_000;
  storage.values.set(key, JSON.stringify({ v: 1, ...scope, savedAt: NOW - 1, expiresAt, answers: { 9: { value: 'Z', baseValue: 'Y', baseSavedAt: '2026-11-23T09:00:00Z' } } }));
  seedLegacy(storage, { 3: 'B' });
  migrateLegacyProgrammeDraft(storage, {
    attemptId: 'att-1', ownerKey: 'user-a', ownedByCurrentUser: true, serverAnswers: { 3: 'C' }, now: NOW,
  });
  const copy = readLocalCopy(storage, { ...scope, now: NOW });
  assert.equal(copy.expiresAt, expiresAt);
  assert.deepEqual(Object.keys(copy.answers).sort(), ['3', '9']);
});

test('choice "keep saved" removes the device value from both keys; "use this device" returns it to send', () => {
  const storage = memoryStorage({ failSet: false });
  seedLegacy(storage, { 3: 'B', 4: 'X' });
  // Simulate a new copy holding both, as after a migration whose old key was kept.
  storage.values.set(localCopyKey(scope), JSON.stringify({ v: 1, ...scope, savedAt: NOW, expiresAt: NOW + 1e6, answers: { 3: { value: 'B' }, 4: { value: 'X' } } }));
  const base = { attemptId: 'att-1', ownerKey: 'user-a', now: NOW };
  assert.equal(resolveLegacyDraftChoice(storage, { ...base, qNum: 3, local: 'B', choice: 'keep-saved' }), null);
  assert.equal(resolveLegacyDraftChoice(storage, { ...base, qNum: 4, local: 'X', choice: 'use-local' }), 'X');
  assert.deepEqual(JSON.parse(storage.values.get(LEGACY)), { 4: 'X' });
  assert.deepEqual(Object.keys(readLocalCopy(storage, { ...scope, now: NOW }).answers), ['4']);
});

test('"keep saved" never erases a newer value typed since', () => {
  const storage = memoryStorage();
  seedLegacy(storage, { 3: 'newer' });
  resolveLegacyDraftChoice(storage, { attemptId: 'att-1', ownerKey: 'user-a', qNum: 3, local: 'B', choice: 'keep-saved', now: NOW });
  assert.deepEqual(JSON.parse(storage.values.get(LEGACY)), { 3: 'newer' });
});
