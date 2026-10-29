// PC-J147 — one /auth/me per page load, shared by <aver-chrome> and the page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTH_ME_REUSE_MS,
  AUTH_ME_TIMEOUT_MESSAGE,
  sharedAuthMe,
} from '../public/js/auth-me-single-flight.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(HERE, '..', rel), 'utf8');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A `send` whose responses the test releases by hand. */
function controlledSend() {
  const calls = [];
  const send = (signal) => new Promise((resolve, reject) => {
    calls.push({ signal, resolve, reject });
  });
  return { calls, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sharedAuthMe — single flight per access token', () => {
  it('concurrent callers with the same token share one request and one record', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', send, { scope });
    const c = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 1);
    calls[0].resolve(json({ id: 'u1', role: 'admin' }));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.deepEqual(ra, { ok: true, status: 200, payload: { id: 'u1', role: 'admin' } });
    assert.equal(ra, rb);
    assert.equal(rb, rc);
  });

  it('a caller that asks just after the request settled reuses it within the page-boot window', async () => {
    const scope = {};
    let clock = 1000;
    const now = () => clock;
    const { calls, send } = controlledSend();
    const first = sharedAuthMe('tok-A', send, { scope, now });
    await tick();
    calls[0].resolve(json({ role: 'user' }));
    await first;
    clock += AUTH_ME_REUSE_MS - 1;
    assert.equal(await sharedAuthMe('tok-A', send, { scope, now }), await first);
    assert.equal(calls.length, 1);
    clock += 1;
    const later = sharedAuthMe('tok-A', send, { scope, now });
    await tick();
    assert.equal(calls.length, 2, 'past the window the read is canonical again');
    calls[1].resolve(json({ role: 'admin' }));
    assert.equal((await later).payload.role, 'admin');
  });

  it('a different token (refresh, account switch in another tab) sends a new request', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    await tick();
    calls[0].resolve(json({ id: 'A' }));
    await a;
    const b = sharedAuthMe('tok-B', send, { scope });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].resolve(json({ id: 'B' }));
    assert.equal((await b).payload.id, 'B');
    // The old token's record is gone: going back to it sends again.
    const again = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 3);
    calls[2].resolve(json({ id: 'A' }));
    await again;
  });

  it('a network error reaches every waiting caller, and the next call sends again', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', send, { scope });
    await tick();
    const boom = new TypeError('Failed to fetch');
    calls[0].reject(boom);
    await assert.rejects(a, (e) => e === boom);
    await assert.rejects(b, (e) => e === boom);
    const retry = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].resolve(json({ role: 'user' }));
    assert.equal((await retry).ok, true);
  });

  it('a non-OK status is shared while in flight but never reused', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', send, { scope });
    await tick();
    calls[0].resolve(json({ detail: 'Token không hợp lệ' }, 401));
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, rb);
    assert.deepEqual(ra, { ok: false, status: 401, payload: { detail: 'Token không hợp lệ' } });
    const retry = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].resolve(json({ role: 'user' }));
    assert.equal((await retry).status, 200);
  });

  it('an OK reply with an empty body is not reused', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    await tick();
    calls[0].resolve(new Response('', { status: 200 }));
    assert.deepEqual(await a, { ok: true, status: 200, payload: null });
    const retry = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].resolve(json({ role: 'user' }));
    await retry;
  });

  it('a timeout rejects every caller with the same error, aborts the request, and allows a retry', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope, timeoutMs: 20 });
    const b = sharedAuthMe('tok-A', send, { scope, timeoutMs: 20 });
    await tick();
    const errors = await Promise.allSettled([a, b]);
    assert.deepEqual(errors.map((r) => r.status), ['rejected', 'rejected']);
    assert.equal(errors[0].reason, errors[1].reason);
    assert.equal(errors[0].reason.message, AUTH_ME_TIMEOUT_MESSAGE);
    assert.equal(calls[0].signal.aborted, true);
    const retry = sharedAuthMe('tok-A', send, { scope, timeoutMs: 20 });
    await tick();
    assert.equal(calls.length, 2);
    calls[1].resolve(json({ role: 'user' }));
    assert.equal((await retry).ok, true);
  });

  it('one caller aborting stops only that caller; the shared request keeps running', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const controller = new AbortController();
    const page = sharedAuthMe('tok-A', send, { scope, signal: controller.signal });
    const chrome = sharedAuthMe('tok-A', send, { scope });
    await tick();
    controller.abort();
    await assert.rejects(page, { name: 'AbortError' });
    assert.equal(calls[0].signal.aborted, false);
    calls[0].resolve(json({ role: 'instructor' }));
    assert.equal((await chrome).payload.role, 'instructor');
  });

  it('no token → no sharing (each call sends)', async () => {
    const scope = {};
    let sent = 0;
    const send = async () => { sent += 1; return json({}, 401); };
    await sharedAuthMe('', send, { scope });
    await sharedAuthMe('', send, { scope });
    assert.equal(sent, 2);
  });

  it('two module copies meet on the same global registry', async () => {
    // The chrome loads /js/auth-me-single-flight.js by URL while Next bundles
    // lib/auth/auth-me-single-flight.mjs: state must not live in module scope.
    const copy = await import(`../public/js/auth-me-single-flight.js?copy=${Date.now()}`);
    assert.notEqual(copy.sharedAuthMe, sharedAuthMe);
    const { calls, send } = controlledSend();
    try {
      const a = sharedAuthMe('tok-global', send); // default scope: globalThis
      const b = copy.sharedAuthMe('tok-global', send);
      await tick();
      assert.equal(calls.length, 1);
      calls[0].resolve(json({ role: 'user' }));
      assert.equal(await a, await b);
    } finally {
      delete globalThis.__averAuthMeSingleFlight;
    }
  });
});

describe('PC-J147 wiring — one /auth/me on /d1-exercise and /vocabulary/hub', () => {
  const CHROME = read('public/js/components/aver-chrome.js');
  const D1 = read('app/(authed-d1-exercise)/d1-exercise/d1-exercise-player.tsx');
  const HUB_PAGE = read('app/(authed-vocabulary-hub)/vocabulary/hub/page.tsx');
  const HUB = read('app/(authed-vocabulary-hub)/vocabulary/hub/vocabulary-hub-behavior.tsx');

  it('the chrome role lookup goes through the shared flight', () => {
    assert.match(CHROME, /import \{ sharedAuthMe \} from '\/js\/auth-me-single-flight\.js';/);
    assert.match(CHROME, /await sharedAuthMe\(token, \(signal\) => fetch\(base \+ '\/auth\/me'/);
  });

  it('the D1 opening profile read shares the same flight', () => {
    assert.match(D1, /from '@\/lib\/auth\/auth-me-single-flight\.mjs'/);
    assert.match(D1, /sharesAuthMe = path === '\/auth\/me'/);
  });

  it('the hub owns /auth/me and hands the role to the chrome', () => {
    assert.match(HUB_PAGE, /<aver-chrome active="vocabulary" role-source="page" \/>/);
    assert.match(HUB, /profileRead\.then\(\(me\) => \{ if \(!dead\) shareRoleWithChrome\(me\.role \?\? null, isCurrent\); \}/);
  });
});
