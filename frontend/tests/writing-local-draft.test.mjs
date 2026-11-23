import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_DRAFT_MAX_AGE_MS,
  LOCAL_DRAFT_MAX_CHARS,
  clearLocalDraft,
  keepLocalDraft,
  localDraftDecision,
  readLocalDraft,
  settleLocalDraft,
} from '../lib/writing-local-draft.mjs';

// R119 (ENROLL-0060 FR-052 follow-up): the tab-local copy of Writing text
// the server has not acknowledged yet.

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
  };
}

test('keeps, reads and clears a copy keyed by account and assignment', () => {
  const s = memoryStorage();
  assert.equal(keepLocalDraft(s, { accountId: 'u1', assignmentId: 'a1', text: 'Hello', base: 't0', now: 1000 }), true);
  assert.deepEqual(readLocalDraft(s, 'u1', 'a1', 2000), { text: 'Hello', base: 't0', savedAt: 1000 });
  assert.equal(readLocalDraft(s, 'u2', 'a1', 2000), null, 'another account never reads it');
  assert.equal(readLocalDraft(s, 'u1', 'a2', 2000), null);
  clearLocalDraft(s, 'u1', 'a1');
  assert.equal(readLocalDraft(s, 'u1', 'a1', 2000), null);
});

test('keeps nothing for blank text, missing ids, too-long text or a refusing storage', () => {
  const s = memoryStorage();
  assert.equal(keepLocalDraft(s, { accountId: 'u1', assignmentId: 'a1', text: '   ' }), false);
  assert.equal(keepLocalDraft(s, { accountId: null, assignmentId: 'a1', text: 'x' }), false);
  assert.equal(keepLocalDraft(s, { accountId: 'u1', assignmentId: 'a1', text: 'x'.repeat(LOCAL_DRAFT_MAX_CHARS + 1) }), false);
  assert.equal(s.size, 0);
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(keepLocalDraft(refusing, { accountId: 'u1', assignmentId: 'a1', text: 'x' }), false);
  assert.equal(readLocalDraft(refusing, 'u1', 'a1'), null);
  assert.doesNotThrow(() => clearLocalDraft(refusing, 'u1', 'a1'));
});

test('drops a copy older than a day or malformed', () => {
  const s = memoryStorage();
  keepLocalDraft(s, { accountId: 'u1', assignmentId: 'a1', text: 'old', now: 0 });
  assert.equal(readLocalDraft(s, 'u1', 'a1', LOCAL_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(s.size, 0, 'the expired copy is removed');
  s.setItem('aver:writing-local-draft:v1:u1:a1', '{not json');
  assert.equal(readLocalDraft(s, 'u1', 'a1'), null);
  assert.equal(s.size, 0);
});

test('settle drops the copy only when the server acknowledged exactly its text', () => {
  const s = memoryStorage();
  keepLocalDraft(s, { accountId: 'u1', assignmentId: 'a1', text: 'abc def' });
  settleLocalDraft(s, 'u1', 'a1', 'abc');
  assert.equal(readLocalDraft(s, 'u1', 'a1').text, 'abc def', 'a keystroke typed during the save stays');
  settleLocalDraft(s, 'u1', 'a1', 'abc def');
  assert.equal(readLocalDraft(s, 'u1', 'a1'), null);
});

test('decision: restore only on the same server version, otherwise offer', () => {
  const local = { text: 'local text', base: '2026-11-23T10:00:00Z', savedAt: 1 };
  assert.equal(localDraftDecision(null, 'server', 'x'), 'none');
  assert.equal(localDraftDecision(local, 'local text', 'other'), 'none', 'same text: nothing to restore');
  assert.equal(localDraftDecision(local, 'server', '2026-11-23T10:00:00Z'), 'restore');
  assert.equal(localDraftDecision(local, 'server newer', '2026-11-23T10:05:00Z'), 'offer');
  const fresh = { text: 'typed before any save', base: null, savedAt: 1 };
  assert.equal(localDraftDecision(fresh, null, null), 'restore', 'no server draft yet');
  assert.equal(localDraftDecision(fresh, 'saved elsewhere', '2026-11-23T10:05:00Z'), 'offer');
});
