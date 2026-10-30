// PC-J147 — one /auth/me per page load, shared by <aver-chrome> and the page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTH_ME_REUSE_MS,
  AUTH_ME_TIMEOUT_MESSAGE,
  newRequestId,
  sharedAuthMe,
} from '../public/js/auth-me-single-flight.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(HERE, '..', rel), 'utf8');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A `send` whose responses the test releases by hand. */
function controlledSend() {
  const calls = [];
  const send = (signal, requestId) => new Promise((resolve, reject) => {
    calls.push({ signal, requestId, resolve, reject });
  });
  return { calls, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sharedAuthMe — single flight per access token', () => {
  it('payload edits stay private to concurrent and reused callers', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', send, { scope, signal: new AbortController().signal });
    await tick();
    assert.equal(calls.length, 1);
    calls[0].resolve(json({ role: 'user', profile: { name: 'Original' } }));
    const [ra, rb] = await Promise.all([a, b]);
    ra.payload.role = 'admin';
    ra.payload.profile.name = 'Changed';
    assert.deepEqual(rb.payload, { role: 'user', profile: { name: 'Original' } });
    const reused = await sharedAuthMe('tok-A', send, { scope });
    assert.deepEqual(reused.payload, rb.payload);
    assert.notEqual(reused.payload, rb.payload);
    assert.equal(calls.length, 1);
    assert.ok(Object.isFrozen(ra));
    assert.ok(Object.isFrozen(rb));
    assert.ok(Object.isFrozen(reused));
  });

  it('concurrent callers with the same token share one request with separate records', async () => {
    const scope = {};
    const { calls, send } = controlledSend();
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', send, { scope });
    const c = sharedAuthMe('tok-A', send, { scope });
    await tick();
    assert.equal(calls.length, 1);
    calls[0].resolve(json({ id: 'u1', role: 'admin' }));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.deepEqual(ra, { ok: true, status: 200, payload: { id: 'u1', role: 'admin' }, requestId: calls[0].requestId });
    assert.deepEqual(ra, rb);
    assert.deepEqual(rb, rc);
    assert.notEqual(ra, rb);
    assert.notEqual(rb, rc);
    assert.notEqual(ra.payload, rb.payload);
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
    const reused = await sharedAuthMe('tok-A', send, { scope, now });
    assert.deepEqual(reused, await first);
    assert.notEqual(reused, await first);
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
    assert.deepEqual(ra, rb);
    assert.notEqual(ra, rb);
    assert.deepEqual(ra, { ok: false, status: 401, payload: { detail: 'Token không hợp lệ' }, requestId: calls[0].requestId });
    ra.payload.detail = 'Changed';
    assert.equal(rb.payload.detail, 'Token không hợp lệ');
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
    assert.deepEqual(await a, { ok: true, status: 200, payload: null, requestId: calls[0].requestId });
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
    const ids = [];
    const send = async (_signal, requestId) => { ids.push(requestId); return json({ role: 'user' }, 401); };
    const a = await sharedAuthMe('', send, { scope });
    const b = await sharedAuthMe('', send, { scope });
    assert.equal(ids.length, 2);
    assert.equal(a.requestId, ids[0]);
    assert.equal(b.requestId, ids[1]);
    assert.ok(a.requestId);
    assert.ok(Object.isFrozen(a));
    assert.notEqual(a.payload, b.payload);
    a.payload.role = 'admin';
    assert.equal(b.payload.role, 'user');
  });

  it('the first, concurrent, and reused callers receive the ID sent in X-Request-ID', async () => {
    const scope = {};
    const requests = [];
    const send = async (signal, requestId) => {
      requests.push(new Request('https://api.test/auth/me', { signal, headers: { 'X-Request-ID': requestId } }));
      return json({ role: 'user' });
    };
    const a = sharedAuthMe('tok-A', send, { scope });
    const b = sharedAuthMe('tok-A', () => assert.fail('a reused caller must not send'), { scope });
    const [ra, rb] = await Promise.all([a, b]);
    const reused = await sharedAuthMe('tok-A', send, { scope });
    assert.equal(requests.length, 1);
    const sentId = requests[0].headers.get('X-Request-ID');
    assert.ok(sentId);
    assert.equal(ra.requestId, sentId);
    assert.equal(rb.requestId, sentId);
    assert.equal(reused.requestId, sentId);
    assert.equal(scope.__averAuthMeSingleFlight.entry.requestId, sentId);
  });

  it('a legacy send accepting only the signal still works', async () => {
    const record = await sharedAuthMe('tok-A', async (signal) => {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      return json({ role: 'user' });
    }, { scope: {} });
    assert.equal(record.payload.role, 'user');
    assert.ok(record.requestId);
  });

  it('generates a request ID when crypto.randomUUID is unavailable', async (t) => {
    t.mock.method(globalThis.crypto, 'randomUUID', () => undefined);
    let sentId;
    const record = await sharedAuthMe('tok-A', async (_signal, requestId) => {
      sentId = requestId;
      return json({ role: 'user' });
    }, { scope: {} });
    assert.match(record.requestId, /^auth-me-request-\d+-\d+$/);
    assert.equal(record.requestId, sentId);
  });

  it('two fallback IDs minted in the same millisecond differ', async (t) => {
    t.mock.method(globalThis.crypto, 'randomUUID', () => undefined);
    t.mock.method(Date, 'now', () => 1761800000000);
    const sentIds = [];
    const send = async (_signal, requestId) => { sentIds.push(requestId); return json({ role: 'user' }); };
    const a = await sharedAuthMe('', send, { scope: {} });
    const b = await sharedAuthMe('', send, { scope: {} });
    assert.equal(sentIds.length, 2);
    assert.notEqual(a.requestId, b.requestId);
    assert.deepEqual([a.requestId, b.requestId], sentIds);
    for (const id of sentIds) assert.match(id, /^auth-me-request-1761800000000-\d+$/);
    const d1a = newRequestId('d1-request');
    const d1b = newRequestId('d1-request');
    assert.notEqual(d1a, d1b);
    assert.match(d1a, /^d1-request-1761800000000-\d+$/);
  });

  it('clones JSON payloads when structuredClone is unavailable', async () => {
    const original = globalThis.structuredClone;
    globalThis.structuredClone = undefined;
    try {
      const scope = {};
      const send = async () => json({ role: 'user', nested: [{ name: 'Original' }] });
      const [a, b] = await Promise.all([
        sharedAuthMe('tok-A', send, { scope }),
        sharedAuthMe('tok-A', send, { scope }),
      ]);
      a.payload.nested[0].name = 'Changed';
      assert.equal(b.payload.nested[0].name, 'Original');
      assert.ok(Object.isFrozen(b));
      assert.equal((await sharedAuthMe('tok-A', async () => new Response(''), { scope: {} })).payload, null);
    } finally {
      globalThis.structuredClone = original;
    }
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
      assert.deepEqual(await a, await b);
      assert.notEqual(await a, await b);
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
    assert.match(CHROME, /await sharedAuthMe\(token, \(signal, requestId\) => fetch\(base \+ '\/auth\/me'/);
    assert.match(CHROME, /'X-Request-ID': requestId/);
  });

  it('the D1 opening profile read shares the same flight', () => {
    assert.match(D1, /import \{ newRequestId, sharedAuthMe \} from '@\/lib\/auth\/auth-me-single-flight\.mjs'/);
    assert.match(D1, /sharesAuthMe = path === '\/auth\/me'/);
    assert.match(D1, /sharedAuthMe\(token, \(signal, requestId\) => send\(token, signal, requestId\)/);
    assert.match(D1, /return \{ response: \{ ok, status \}, payload, token, requestId \}/);
  });

  it('the hub owns /auth/me and hands the role to the chrome', () => {
    assert.match(HUB_PAGE, /<aver-chrome active="vocabulary" role-source="page" \/>/);
    assert.match(HUB, /profileRead\.then\(\(me\) => \{ if \(!dead\) shareRoleWithChrome\(me\.role \?\? null, isCurrent\); \}/);
  });
});
