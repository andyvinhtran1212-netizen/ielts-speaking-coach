import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// F06: drive the REAL supabase-js client that getBrowserSupabase() builds —
// only GoTrue's HTTP endpoints are faked — so the PKCE contract is proven
// against the pinned library, not against a hand-written stub.
const SUPABASE = 'https://proj.supabase.co';
const STORE_KEY = 'sb-proj-auth-token';
const VERIFIER_KEY = `${STORE_KEY}-code-verifier`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const USER = { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'learner@test' };

type Call = { url: URL; method: string; headers: Headers; body: any };
let calls: Call[];
let clients: SupabaseClient[];

beforeEach(() => {
  calls = [];
  clients = [];
  localStorage.clear();
  window.history.replaceState(null, '', '/login');
  delete (window as any).__AVER_SUPABASE_CLIENT__;
  (window as any).__AVER_RUNTIME_CONFIG__ = { supabaseUrl: SUPABASE, supabaseAnonKey: 'anon-key' };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', headers: new Headers(init.headers), body });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      return Response.json({
        access_token: jwt({ sub: USER.id, session_id: 'sid-pkce', exp: nowSeconds() + 3600 }),
        refresh_token: 'refresh-1',
        expires_in: 3600,
        expires_at: nowSeconds() + 3600,
        token_type: 'bearer',
        user: USER,
      });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/auth/v1/user') return Response.json(USER);
    return Response.json({ message: `unexpected ${url.pathname}` }, { status: 500 });
  }));
  vi.resetModules();
});

afterEach(async () => {
  for (const client of clients) await client.auth.stopAutoRefresh();
  vi.unstubAllGlobals();
});

async function freshClient() {
  const { getBrowserSupabase } = await import('@/lib/supabase-browser');
  const client = getBrowserSupabase('https://fallback.invalid', 'fallback');
  clients.push(client);
  await client.auth.initialize();
  return client;
}

async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

it('Google sign-in asks GoTrue for a PKCE code bound to a verifier kept in this browser', async () => {
  const client = await freshClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'http://localhost:3000/login', skipBrowserRedirect: true },
  });
  expect(error).toBeNull();
  const authorize = new URL(data.url!);
  expect(authorize.origin + authorize.pathname).toBe(`${SUPABASE}/auth/v1/authorize`);
  expect(authorize.searchParams.get('redirect_to')).toBe('http://localhost:3000/login');
  expect(authorize.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
  const verifier = JSON.parse(localStorage.getItem(VERIFIER_KEY) || 'null');
  expect(verifier).toBeTruthy();
  expect(authorize.searchParams.get('code_challenge')).toBe(await s256(verifier));
  expect(authorize.search).not.toMatch(/access_token|response_type=token/);
});

it('exchanges the code with that verifier, persists the session off-URL, and signs out cleanly', async () => {
  const client = await freshClient();
  await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'http://localhost:3000/login', skipBrowserRedirect: true },
  });
  const verifier = JSON.parse(localStorage.getItem(VERIFIER_KEY) || 'null');

  const { data, error } = await client.auth.exchangeCodeForSession('auth-code-1');
  expect(error).toBeNull();
  const exchange = calls.find((call) => call.url.pathname === '/auth/v1/token');
  expect(exchange?.method).toBe('POST');
  expect(exchange?.url.searchParams.get('grant_type')).toBe('pkce');
  expect(exchange?.body).toEqual({ auth_code: 'auth-code-1', code_verifier: verifier });
  expect(data.session?.access_token).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(STORE_KEY)!).access_token).toBe(data.session!.access_token);
  expect(localStorage.getItem(VERIFIER_KEY)).toBeNull(); // single use
  expect(window.location.href).not.toMatch(/access_token|refresh_token/);

  const { error: signOutError } = await client.auth.signOut();
  expect(signOutError).toBeNull();
  const logout = calls.find((call) => call.url.pathname === '/auth/v1/logout');
  expect(logout?.headers.get('authorization')).toBe(`Bearer ${data.session!.access_token}`);
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect((await client.auth.getSession()).data.session).toBeNull();
});

it('never turns an implicit #access_token fragment into a session', async () => {
  const forged = jwt({ sub: 'attacker', exp: nowSeconds() + 3600 });
  window.history.replaceState(null, '', `/login#access_token=${forged}&refresh_token=r&expires_in=3600&token_type=bearer`);
  const client = await freshClient();
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect(calls).toHaveLength(0);
});

it('leaves an unrelated ?code= alone even when an abandoned verifier is stored', async () => {
  localStorage.setItem(VERIFIER_KEY, JSON.stringify('abandoned-verifier'));
  window.history.replaceState(null, '', '/mock-exam?code=EXAM-1');
  await freshClient();
  expect(calls).toHaveLength(0);
  expect(window.location.search).toBe('?code=EXAM-1');
  expect(JSON.parse(localStorage.getItem(VERIFIER_KEY)!)).toBe('abandoned-verifier');
});
