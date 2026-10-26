// U-07: a logout must not leave a (revoked) session or token cache behind for
// /login or the landing page to send to /auth/me.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  SIGNED_OUT_SESSION_KEY,
  clearPersistedAuthSession,
  forgetSignedOutSession,
  isSignedOutSession,
  rememberSignedOutSession,
  sessionIdOf,
} from '../public/js/auth-sign-out-state.js';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

test('identifies a session by its GoTrue session_id claim, never by a malformed token', () => {
  assert.equal(sessionIdOf(jwt({ sub: 'u', session_id: 'sid-1' })), 'sid-1');
  for (const token of [null, '', 'opaque', 'a.%%%.b', jwt({ sub: 'u' })]) assert.equal(sessionIdOf(token), null);
});

test('remembers the ending session and matches only that session', async () => {
  const tab = memoryStorage();
  await rememberSignedOutSession({ auth: { getSession: async () => ({ data: { session: { access_token: jwt({ session_id: 'sid-1' }) } } }) } }, tab);
  assert.equal(tab.getItem(SIGNED_OUT_SESSION_KEY), 'sid-1');
  assert.equal(isSignedOutSession(jwt({ session_id: 'sid-1' }), tab), true);
  assert.equal(isSignedOutSession(jwt({ session_id: 'sid-2' }), tab), false, 'a new sign-in is not the logged-out session');
  await rememberSignedOutSession({ auth: { getSession: async () => { throw new Error('locked'); } } }, tab);
  await rememberSignedOutSession(undefined, tab);
  assert.equal(tab.getItem(SIGNED_OUT_SESSION_KEY), 'sid-1', 'never throws into the logout flow');
});

test('purges every supabase-js session key and nothing else', () => {
  const store = memoryStorage({
    'sb-proj-auth-token': '{}', 'sb-proj-auth-token-code-verifier': 'v', 'sb-proj-auth-token-user': '{}',
    'av-theme': 'dark', 'sb-unrelated': 'x', [`awa-pending-receipt:A`]: '1',
  });
  clearPersistedAuthSession(store);
  assert.deepEqual(store.keys(), ['av-theme', 'sb-unrelated', 'awa-pending-receipt:A']);
});

test('storage denied by privacy settings: helpers degrade instead of throwing from the storage getters', async () => {
  // Browsers that block Web Storage throw SecurityError from the
  // window.localStorage / window.sessionStorage getters themselves, so the
  // helpers' DEFAULT storage must be resolved inside their guard.
  const denied = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const previous = globalThis.window;
  globalThis.window = Object.defineProperties({}, {
    localStorage: { get: denied, configurable: true },
    sessionStorage: { get: denied, configurable: true },
  });
  try {
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: jwt({ session_id: 'sid-1' }) } } }) } };
    await assert.doesNotReject(rememberSignedOutSession(client));
    assert.equal(isSignedOutSession(jwt({ session_id: 'sid-1' })), false);
    assert.doesNotThrow(() => forgetSignedOutSession());
    assert.doesNotThrow(() => clearPersistedAuthSession());
  } finally {
    if (hadWindow) globalThis.window = previous; else delete globalThis.window;
  }
});

test('api.js clearAuthCache drops the keepalive token so no later request reuses it', async () => {
  let session = { access_token: 'T-old' };
  const sent = [];
  const window = {
    location: { hostname: 'app.invalid', pathname: '/', set href(_) { /* 401 bounce */ } },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://api.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session } }) } },
  };
  const fetch = async (_url, options) => { sent.push(options.headers.Authorization || null); return new Response('{}', { status: 200 }); };
  vm.runInNewContext(read('public', 'js', 'api.js'), { window, fetch, console });
  await window.api.get('/warm');
  session = null; // signed out
  window.api.clearAuthCache();
  await window.api.postWith('/flush', {}, undefined, { keepalive: true });
  assert.deepEqual(sent, ['Bearer T-old', null]);
});

test('the chrome logout records, revokes, then purges before announcing and navigating', () => {
  const chrome = read('public', 'js', 'components', 'aver-chrome.js');
  const handler = chrome.slice(chrome.indexOf('_bindLogout() {'));
  const steps = ['await rememberSignedOutSession(sb)', 'await sb.auth.signOut()', 'clearPersistedAuthSession()',
    'window.api.clearAuthCache()', "CustomEvent('av-chrome-signed-out'", "window.location.href = '/';"]
    .map((step) => handler.indexOf(step));
  assert.ok(steps.every((index, i) => index !== -1 && (i === 0 || steps[i - 1] < index)), `order: ${steps}`);
});

test('other sign-out paths purge too; /login skips /auth/me for a signed-out session', () => {
  const instructor = read('app', '(authed-instructor)', 'instructor', 'instructor-dashboard.tsx');
  const signOut = instructor.slice(instructor.indexOf('const signOut = async'));
  assert.ok(signOut.indexOf('rememberSignedOutSession(client)') < signOut.indexOf('auth?.signOut?.()')
    && signOut.indexOf('auth?.signOut?.()') < signOut.indexOf('clearPersistedAuthSession()')
    && signOut.indexOf('clearPersistedAuthSession()') < signOut.indexOf("window.location.replace('/')"));
  const provider = read('lib', 'auth', 'auth-provider.tsx');
  const providerSignOut = provider.slice(provider.indexOf('const signOut = useCallback'));
  assert.ok(providerSignOut.indexOf('clearPersistedAuthSession()') > providerSignOut.indexOf('auth?.signOut?.()')
    && providerSignOut.indexOf('clearPersistedAuthSession()') < providerSignOut.indexOf("'av-chrome-signed-out'"));
  const login = read('app', '(public-auth)', 'login', 'login-behavior.tsx');
  const skip = login.indexOf('isSignedOutSession(session.access_token)');
  assert.ok(skip !== -1 && skip < login.indexOf('canonicalProfile(session.access_token)'));
});

test("the chrome's '/' destination never sends a token to /auth/me", () => {
  // The landing loads no Supabase client and makes only public calls, so a
  // stale persisted token cannot reach /auth/me there.
  for (const file of ['layout.tsx', 'page.tsx', 'landing-behavior.tsx']) {
    const source = read('app', '(marketing)', file);
    assert.doesNotMatch(source, /\/auth\/me|getSupabase|SupabaseRuntimeBoundary|Authorization/, file);
  }
});
