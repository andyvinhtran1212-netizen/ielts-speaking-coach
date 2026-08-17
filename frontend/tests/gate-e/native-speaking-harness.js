const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3210';
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const SID = '11111111-1111-4111-8111-111111111101';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js';
const SUPABASE_LEGACY_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0';
const LUCIDE_CDN = 'https://unpkg.com/lucide@1.17.0';

const AUTH_SESSION = {
  access_token: 'gate-e-fake-token',
  refresh_token: 'gate-e-refresh',
  expires_at: 4_102_444_800,
  user: { id: OWNER, email: 'gate-e@test.local' },
};

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};

async function installHarness(page, {
  session,
  questions,
  sessionId = SID,
  routePath = '/practice/session',
  initStorage = {},
  handleApi = null,
  expectBootstrapOnce = true,
  expectQuestionLookup = true,
} = {}) {
  const calls = [];
  const pageErrors = [];
  let claimedRenderer = null;
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(({ authSession, storage }) => {
    window.__GATE_E_AUTH_SESSION__ = authSession;
    for (const [key, value] of Object.entries(storage)) {
      window.sessionStorage.setItem(key, String(value));
    }
  }, { authSession: AUTH_SESSION, storage: initStorage });

  // Replace only CDN transport. AuthProvider and api.js still create and share
  // the same single client that production uses.
  const fulfillSupabase = (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase = {
      createClient: function () {
        var session = window.__GATE_E_AUTH_SESSION__;
        return { auth: {
          getSession: async function () { return { data: { session: session } }; },
          onAuthStateChange: function () {
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signOut: async function () { return { error: null }; }
        } };
      }
    };`,
  });
  await page.route(SUPABASE_CDN, fulfillSupabase);
  await page.route(SUPABASE_LEGACY_CDN, fulfillSupabase);
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide = { createIcons: function () {} };',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${path}`);

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (typeof handleApi === 'function') {
      const handled = await handleApi({ route, request, path, calls, cors });
      if (handled) return;
    }
    if (request.method() === 'POST' && path === `/sessions/${sessionId}/renderer-affinity`) {
      const requestedRenderer = request.postDataJSON()?.renderer_affinity;
      if (requestedRenderer !== 'legacy' && requestedRenderer !== 'next') {
        return route.fulfill({
          status: 422,
          json: { detail: 'invalid renderer fixture claim' },
          headers: cors,
        });
      }
      claimedRenderer ||= requestedRenderer;
      return route.fulfill({
        json: { session_id: sessionId, renderer_affinity: claimedRenderer },
        headers: cors,
      });
    }
    if (request.method() === 'GET' && path === `/sessions/${sessionId}`) {
      const payload = typeof session === 'function' ? session() : session;
      return route.fulfill({ json: payload, headers: cors });
    }
    if (request.method() === 'GET' && path === `/sessions/${sessionId}/questions`) {
      const payload = typeof questions === 'function' ? questions() : questions;
      return route.fulfill({ json: payload, headers: cors });
    }
    // Shell telemetry is non-blocking and unrelated to player truth.
    if (path === '/api/analytics/events') {
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({
      status: 404,
      json: { detail: `fixture route missing: ${request.method()} ${path}` },
      headers: cors,
    });
  });

  await page.goto(`${routePath}?session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  expect(pageErrors).toEqual([]);
  if (expectBootstrapOnce) {
    expect(calls.filter((call) => call === `GET /sessions/${sessionId}`)).toHaveLength(1);
    expect(calls.filter((call) => call === `GET /sessions/${sessionId}/questions`)).toHaveLength(
      expectQuestionLookup ? 1 : 0,
    );
  }
  return { calls, pageErrors };
}

module.exports = {
  API,
  OWNER,
  SID,
  cors,
  installHarness,
};
