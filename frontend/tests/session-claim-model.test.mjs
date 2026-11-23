// ENROLL-0060 G05-T20 (FR-052 / FR-053): one session per learner, browser side.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DISPLACED_LOGIN_PATH,
  isDisplaced,
  loginNotice,
  minutesLeftText,
  rememberDisplaced,
  sessionGateView,
  takeDisplaced,
} from '../lib/auth/session-claim.mjs';
import { registerDraftSaver, resetDraftSavers, saveAllDrafts } from '../lib/auth/draft-savers.mjs';

test('sessionGateView: only enabled=true with another device asks or blocks', () => {
  assert.equal(sessionGateView({ enabled: true, state: 'other_device' }), 'ask');
  assert.equal(sessionGateView({ enabled: true, state: 'other_device_timed' }), 'blocked');
  assert.equal(sessionGateView({ enabled: true, state: 'current' }), 'proceed');
  assert.equal(sessionGateView({ enabled: false, state: 'other_device' }), 'proceed');
  assert.equal(sessionGateView({ enabled: true, state: 'something_new' }), 'proceed');
  for (const raw of [null, undefined, 'x', 503, {}]) assert.equal(sessionGateView(raw), 'proceed');
});

test('isDisplaced: only error_code session_displaced', () => {
  assert.equal(isDisplaced({ status: 401, detail: { error_code: 'session_displaced', displaced_at: 'x' } }), true);
  assert.equal(isDisplaced({ error_code: 'session_displaced' }), true);
  assert.equal(isDisplaced({ status: 401, detail: { error_code: 'token_expired' } }), false);
  assert.equal(isDisplaced({ status: 401, detail: 'session_displaced' }), false);
  assert.equal(isDisplaced(null), false);
});

test('loginNotice keeps only the allow-listed value', () => {
  assert.equal(loginNotice('?notice=displaced'), 'displaced');
  assert.equal(loginNotice('?next=%2Fhome&notice=displaced'), 'displaced');
  assert.equal(loginNotice('?notice=<script>'), null);
  assert.equal(loginNotice('?notice=expired'), null);
  assert.equal(loginNotice(''), null);
  assert.equal(loginNotice(undefined), null);
  assert.equal(DISPLACED_LOGIN_PATH, '/login?notice=displaced');
});

test('minutesLeftText rounds the server number up', () => {
  assert.equal(minutesLeftText(38), 'còn khoảng 38 phút');
  assert.equal(minutesLeftText(37.2), 'còn khoảng 38 phút');
  assert.equal(minutesLeftText(0), 'còn khoảng 1 phút');
  assert.equal(minutesLeftText(null), null);
  assert.equal(minutesLeftText('38'), null);
});

function memoryWindow() {
  const map = new Map();
  return { sessionStorage: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) } };
}

test('rememberDisplaced / takeDisplaced: read once, missing parts null', () => {
  const w = memoryWindow();
  rememberDisplaced({ email: 'a@x.test', at: '2026-11-23T02:05:00Z', draftsSaved: true }, w);
  assert.deepEqual(takeDisplaced(w), { email: 'a@x.test', at: '2026-11-23T02:05:00Z', draftsSaved: true });
  assert.deepEqual(takeDisplaced(w), { email: null, at: null, draftsSaved: false });
  const blocked = { get sessionStorage() { throw new Error('blocked'); } };
  rememberDisplaced({ email: 'a@x.test' }, blocked);
  assert.deepEqual(takeDisplaced(blocked), { email: null, at: null, draftsSaved: false });
});

test('saveAllDrafts runs every saver, survives a throwing one, counts real saves, stops at the deadline', async () => {
  resetDraftSavers();
  assert.equal(await saveAllDrafts(), 0);
  const calls = [];
  const off = registerDraftSaver(() => { calls.push('a'); });
  registerDraftSaver(async () => { calls.push('b'); throw new Error('boom'); });
  registerDraftSaver(() => { calls.push('c'); return false; });
  assert.equal(await saveAllDrafts(), 1);
  assert.deepEqual(calls.sort(), ['a', 'b', 'c']);
  off();
  resetDraftSavers();
  registerDraftSaver(() => new Promise(() => {}));
  const started = Date.now();
  assert.equal(await saveAllDrafts(30), 0);
  assert.ok(Date.now() - started < 1000);
  resetDraftSavers();
});
