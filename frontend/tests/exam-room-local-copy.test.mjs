// EXAMROOM-0066 FR-035 (FR-015, FR-032): on-device answer copy bound to one
// account and one attempt; never overwrites newer server answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearForeignLocalCopies, clearLocalCopy, clearOwnerLocalCopies, localCopyExpiry, localCopyKey,
  parseLocalCopyKey, planLocalCopyReplay, readLocalCopy, removeAckedFromCopy, writeLocalCopy,
} from '../lib/exam-room/local-copy.mjs';
import { BrokenStorage, MemoryStorage } from './fixtures/exam-room-fakes.mjs';

const A = { surface: 'reading', ownerKey: 'user-a', attemptKey: 'att-1' };
const B = { ...A, ownerKey: 'user-b' };
const T0 = Date.parse('2026-11-23T03:00:00Z');
const later = localCopyExpiry({ deadline: T0 + 3600_000, now: T0 });

test('write returns true only after reading the copy back; merges answers', () => {
  const s = new MemoryStorage();
  assert.equal(writeLocalCopy(s, { ...A, answers: { 7: { value: 'dozen pie', baseSavedAt: '2026-11-23T03:00:00Z' } }, expiresAt: later, now: T0 }), true);
  assert.equal(writeLocalCopy(s, { ...A, answers: { 8: { value: 'B', baseSavedAt: null } }, expiresAt: later, now: T0 + 1 }), true);
  const copy = readLocalCopy(s, { ...A, now: T0 + 2 });
  assert.deepEqual(Object.keys(copy.answers).sort(), ['7', '8']);
  assert.equal(copy.ownerKey, 'user-a');
  assert.ok(!JSON.stringify(copy).includes('@'), 'no email in the record');
  assert.equal(writeLocalCopy(new BrokenStorage(), { ...A, answers: { 1: { value: 'x', baseSavedAt: null } }, expiresAt: later, now: T0 }), false);
  assert.equal(writeLocalCopy(s, { ...A, ownerKey: '', answers: {}, expiresAt: later }), false);
});

test('another account on the same browser cannot read the copy; signing in as it clears without reading', () => {
  const s = new MemoryStorage();
  writeLocalCopy(s, { ...A, answers: { 7: { value: 'dozen pie', baseSavedAt: null } }, expiresAt: later, now: T0 });
  assert.equal(readLocalCopy(s, { ...B, now: T0 }), null);
  assert.equal(readLocalCopy(s, { ...A, attemptKey: 'att-2', now: T0 }), null);
  // A record whose fields disagree with its key (tampered or moved) is not trusted.
  s.setItem(localCopyKey(B), s.getItem(localCopyKey(A)));
  assert.equal(readLocalCopy(s, { ...B, now: T0 }), null);
  assert.equal(s.getItem(localCopyKey(B)), null);
  // B signs in: every copy not owned by B goes, decided from the key.
  s.setItem('unrelated', '1');
  let reads = 0;
  const spy = new Proxy(s, { get(t, p) { if (p === 'getItem') return (k) => { reads += 1; return t.getItem(k); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
  assert.equal(clearForeignLocalCopies(spy, 'user-b'), 1);
  assert.equal(reads, 0, 'content of other accounts is never read');
  assert.equal(s.getItem(localCopyKey(A)), null);
  assert.equal(s.getItem('unrelated'), '1');
});

test('replay compares by baseValue: re-send only while the server still holds the base', () => {
  const copy = {
    v: 1, ...A, savedAt: T0, expiresAt: later,
    answers: {
      1: { value: 'A', baseValue: 'old' }, // server still "old" → resend
      2: { value: 'B', baseValue: 'old' }, // server changed elsewhere → keep server
      3: { value: 'C', baseValue: null }, // server had nothing and still has nothing → resend
      4: { value: 'D', baseValue: null }, // server got an answer since → keep server
      5: { value: 'E', baseValue: 'old' }, // already equal → nothing to send
      6: { value: 'F' }, // older copy, base unknown → ask, never sent on its own
      7: { value: 'G' }, // base unknown but equal → nothing to ask
    },
  };
  const server = {
    open: true,
    answers: {
      1: { value: 'old', savedAt: '2026-11-23T09:00:00Z' },
      2: { value: 'other tab', savedAt: '2026-11-23T03:05:00Z' },
      3: { value: null },
      4: { value: 'x' },
      5: { value: 'E' },
      6: { value: 'saved' },
      7: { value: 'G' },
    },
  };
  const plan = planLocalCopyReplay(copy, server);
  assert.deepEqual(plan.resend, [{ q: '1', value: 'A' }, { q: '3', value: 'C' }]);
  assert.deepEqual(plan.keepServer, ['2', '4']);
  assert.deepEqual(plan.ask, [{ q: '6', local: 'F', server: 'saved' }]);
  assert.deepEqual(plan.drop.map((d) => d.q).sort(), ['2', '4', '5', '7']);
  assert.deepEqual(plan.drop.find((d) => d.q === '2'), { q: '2', value: 'B' });
  assert.equal(plan.clear, false);
});

test('replay never trusts save times: a server clock ahead or a missing savedAt changes nothing', () => {
  const copy = { v: 1, ...A, savedAt: T0, expiresAt: later, answers: { 1: { value: 'A', baseValue: 'old', baseSavedAt: '2026-11-23T03:00:00Z' } } };
  // Server time later than the copy's base time, value unchanged → still resend.
  assert.deepEqual(planLocalCopyReplay(copy, { open: true, answers: { 1: { value: 'old', savedAt: '2026-11-23T05:00:00Z' } } }).resend, [{ q: '1', value: 'A' }]);
  // Server time earlier, but value changed → keep server.
  assert.deepEqual(planLocalCopyReplay(copy, { open: true, answers: { 1: { value: 'new', savedAt: '2026-11-23T01:00:00Z' } } }).keepServer, ['1']);
  // A value without savedAt (previously overwritten by the copy) → keep server.
  assert.deepEqual(planLocalCopyReplay(copy, { open: true, answers: { 1: { value: 'new' } } }).keepServer, ['1']);
});

test('replay compares arrays and objects after sorting keys; strings verbatim, length included', () => {
  const copy = { v: 1, ...A, savedAt: T0, expiresAt: later, answers: {
    1: { value: 'A', baseValue: '{"a":1,"b":2}' },
    2: { value: 'B', baseValue: 'dozen ' },
  } };
  const plan = planLocalCopyReplay(copy, { open: true, answers: { 1: { value: { b: 2, a: 1 } }, 2: { value: 'dozen' } } });
  assert.deepEqual(plan.resend, [{ q: '1', value: 'A' }]);
  assert.deepEqual(plan.keepServer, ['2']);
});

test('write keeps baseValue, including null; an entry written without it stays unknown', () => {
  const s = new MemoryStorage();
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A', baseValue: 'old' }, 2: { value: 'B', baseValue: null }, 3: { value: 'C' } }, expiresAt: later, now: T0 });
  const back = readLocalCopy(s, { ...A, now: T0 }).answers;
  assert.equal(back['1'].baseValue, 'old');
  assert.equal(back['2'].baseValue, null);
  assert.equal('baseValue' in back['3'], false);
  const plan = planLocalCopyReplay(readLocalCopy(s, { ...A, now: T0 }), { open: true, answers: { 1: { value: 'old' }, 3: { value: 'x' } } });
  assert.deepEqual(plan.resend.map((r) => r.q), ['1', '2']);
  assert.deepEqual(plan.ask.map((r) => r.q), ['3']);
  // Typing again on Q1 without passing a base keeps the known base "old".
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A2' } }, expiresAt: later, now: T0 + 1 });
  assert.equal(readLocalCopy(s, { ...A, now: T0 + 1 }).answers['1'].baseValue, 'old');
  writeLocalCopy(s, { ...A, answers: { 2: { value: 'B2' } }, expiresAt: later, now: T0 + 2 });
  assert.equal(readLocalCopy(s, { ...A, now: T0 + 2 }).answers['2'].baseValue, null);
});

test('submitted or closed attempt: send nothing and clear', () => {
  const copy = { v: 1, ...A, savedAt: T0, expiresAt: later, answers: { 1: { value: 'A', baseSavedAt: null } } };
  assert.deepEqual(planLocalCopyReplay(copy, { open: false, answers: {} }), { resend: [], keepServer: [], ask: [], drop: [{ q: '1', value: 'A' }], clear: true });
  assert.deepEqual(planLocalCopyReplay(null, { open: true, answers: {} }), { resend: [], keepServer: [], ask: [], drop: [], clear: false });
});

test('acks remove answers; the record goes when empty; abandon and sign-out clear', () => {
  const s = new MemoryStorage();
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A', baseSavedAt: null }, 2: { value: 'B', baseSavedAt: null } }, expiresAt: later, now: T0 });
  assert.deepEqual(removeAckedFromCopy(s, { ...A, entries: [{ q: 1, value: 'A' }], now: T0 }), ['1']);
  assert.deepEqual(Object.keys(readLocalCopy(s, { ...A, now: T0 }).answers), ['2']);
  removeAckedFromCopy(s, { ...A, entries: [{ q: '2', value: 'B' }], now: T0 });
  assert.equal(s.getItem(localCopyKey(A)), null);
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A', baseSavedAt: null } }, expiresAt: later, now: T0 });
  clearLocalCopy(s, A);
  assert.equal(readLocalCopy(s, { ...A, now: T0 }), null);
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A', baseSavedAt: null } }, expiresAt: later, now: T0 });
  writeLocalCopy(s, { ...A, attemptKey: 'att-9', answers: { 1: { value: 'Z', baseSavedAt: null } }, expiresAt: later, now: T0 });
  writeLocalCopy(s, { ...B, answers: { 1: { value: 'B', baseSavedAt: null } }, expiresAt: later, now: T0 });
  assert.equal(clearOwnerLocalCopies(s, 'user-a'), 2);
  assert.ok(readLocalCopy(s, { ...B, now: T0 }));
});

test('an ack of an older save never erases a newer answer in the copy', () => {
  const s = new MemoryStorage();
  writeLocalCopy(s, { ...A, answers: { 7: { value: 'dozen', baseSavedAt: null } }, expiresAt: later, now: T0 });
  // The learner types on while the PATCH for "dozen" is in flight.
  writeLocalCopy(s, { ...A, answers: { 7: { value: 'dozen pie', baseSavedAt: null } }, expiresAt: later, now: T0 + 1 });
  assert.deepEqual(removeAckedFromCopy(s, { ...A, entries: [{ q: 7, value: 'dozen' }], now: T0 + 2 }), []);
  assert.equal(readLocalCopy(s, { ...A, now: T0 + 2 }).answers['7'].value, 'dozen pie');
  assert.deepEqual(removeAckedFromCopy(s, { ...A, entries: [{ q: 7, value: 'dozen pie' }], now: T0 + 3 }), ['7']);
  assert.equal(s.getItem(localCopyKey(A)), null);
  assert.deepEqual(removeAckedFromCopy(new BrokenStorage(), { ...A, entries: [{ q: 7, value: 'x' }] }), []);
});

test('expiry: deadline + 24 h, or 7 days untimed; expired copies are removed on read', () => {
  assert.equal(localCopyExpiry({ deadline: T0, now: 0 }), T0 + 24 * 3600_000);
  assert.equal(localCopyExpiry({ deadline: null, now: T0 }), T0 + 7 * 24 * 3600_000);
  const s = new MemoryStorage();
  writeLocalCopy(s, { ...A, answers: { 1: { value: 'A', baseSavedAt: null } }, expiresAt: T0 + 10, now: T0 });
  assert.equal(readLocalCopy(s, { ...A, now: T0 + 10 }), null);
  assert.equal(s.getItem(localCopyKey(A)), null);
});

test('keys round-trip owners that contain separators (share-link guest scope)', () => {
  const scope = { surface: 'reading', ownerKey: 'share:tok/1', attemptKey: 'att:3' };
  assert.deepEqual(parseLocalCopyKey(localCopyKey(scope)), scope);
  assert.equal(parseLocalCopyKey('exam-room:local-copy:bad'), null);
});
