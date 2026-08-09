// Gate E Speaking live three-phase drill. This test never changes admission:
// the operator deploys floor/cutover/rollback commits, then dispatches the
// matching phase. Stable implementation-specific URLs keep older sessions on
// their original renderer while new admission follows the deployed policy.
const { test, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const {
  BYPASS_HEADERS,
  primeBypassCookie,
  identityEmail,
  STAGING_API,
  STAGING_SUPABASE,
  STAGING_ANON,
} = require('../staging-e2e/helpers');

const PHASE = process.env.GATE_E_DRILL_PHASE || '';
const SOURCE_SHA = process.env.GATE_E_SOURCE_SHA || '';
const FLOOR_SHA = process.env.GATE_E_ROLLBACK_FLOOR_SHA || '';
const PREVIOUS_LEGACY = process.env.GATE_E_PREVIOUS_LEGACY_SESSION_ID || '';
const PREVIOUS_NEXT = process.env.GATE_E_PREVIOUS_NEXT_SESSION_ID || '';
const OUTPUT = path.resolve('test-results/gate-e-speaking-coexistence-evidence.json');
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;

function writeEvidence(patch) {
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify({
    schema_version: 1,
    drill_id: 'gate-e-speaking-coexistence-v1',
    phase: PHASE || null,
    source_sha: SOURCE_SHA || null,
    rollback_floor_sha: FLOOR_SHA || null,
    captured_at: new Date().toISOString(),
    ...patch,
  }, null, 2)}\n`, 'utf8');
}

function runtimeField(source, name) {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*(null|"([^"]*)")`));
  return match && match[1] !== 'null' ? match[2] : null;
}

async function signInSession(request) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) throw new Error('E2E_PASSWORD is required for the staging drill.');
  const response = await request.post(
    `${STAGING_SUPABASE}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
      data: { email: identityEmail('student'), password },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  const session = await response.json();
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  }
  return session;
}

async function installStudent(context, request, baseURL) {
  await primeBypassCookie(context, baseURL);
  const session = await signInSession(request);
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch {}
  }, [STORAGE_KEY, JSON.stringify(session)]);
  return session;
}

async function canonicalSession(request, token, sessionId) {
  expect(sessionId).toMatch(UUID);
  const response = await request.get(`${STAGING_API}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.id || body.session_id).toBe(sessionId);
  return {
    id: body.id || body.session_id,
    mode: body.mode,
    part: body.part,
    status: body.status,
    response_count: Array.isArray(body.responses) ? body.responses.length : null,
    receipt_count: Array.isArray(body.response_receipts) ? body.response_receipts.length : null,
  };
}

async function probeStableUrl(context, pathName, sessionId) {
  const target = `${pathName}?session_id=${encodeURIComponent(sessionId)}`;
  const tab = await context.newPage();
  const bootstrap = tab.waitForResponse((response) => (
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/sessions/${sessionId}`
  ));
  await tab.goto(target);
  expect((await bootstrap).status()).toBe(200);
  await expect(tab.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  expect(new URL(tab.url()).pathname).toBe(pathName);

  const exactUrl = tab.url();
  const reloadBootstrap = tab.waitForResponse((response) => (
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/sessions/${sessionId}`
  ));
  await tab.reload();
  expect((await reloadBootstrap).status()).toBe(200);
  expect(tab.url()).toBe(exactUrl);

  const copied = await context.newPage();
  const copiedBootstrap = copied.waitForResponse((response) => (
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/sessions/${sessionId}`
  ));
  await copied.goto(exactUrl);
  expect((await copiedBootstrap).status()).toBe(200);
  expect(copied.url()).toBe(exactUrl);
  await copied.close();
  await tab.close();
  return exactUrl;
}

async function createThroughAdmission(page) {
  await page.goto('/speaking');
  const post = page.waitForResponse((response) => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/sessions'
  ));
  await page.locator('.mode-card[data-mode="practice"]').first().click();
  await page.locator('#prac-tp-part-2').click();
  await expect(page.locator('#prac-topic-select')).toBeEnabled();
  await page.locator('#prac-topic-custom').fill(`Gate E ${PHASE} ${Date.now()}`);
  await page.locator('#prac-topic-start').click();
  const created = await post;
  expect(created.status(), await created.text()).toBe(200);
  const body = await created.json();
  const sessionId = body.session_id;
  expect(sessionId).toMatch(UUID);
  const expectedPath = PHASE === 'cutover' ? '/practice/session' : '/pages/practice.html';
  await page.waitForURL((url) => (
    url.pathname === expectedPath && url.searchParams.get('session_id') === sessionId
  ));
  return { sessionId, expectedPath, url: page.url() };
}

test('live floor → cutover → rollback phase preserves renderer affinity and canonical truth', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  writeEvidence({ status: 'started', ok: false });
  expect(['floor', 'cutover', 'rollback']).toContain(PHASE);
  expect(SOURCE_SHA).toMatch(SHA);
  expect(FLOOR_SHA).toMatch(SHA);
  if (PHASE === 'floor') expect(SOURCE_SHA).toBe(FLOOR_SHA);
  if (PHASE === 'cutover') {
    expect(SOURCE_SHA).not.toBe(FLOOR_SHA);
    expect(PREVIOUS_LEGACY).toMatch(UUID);
  }
  if (PHASE === 'rollback') expect(PREVIOUS_NEXT).toMatch(UUID);

  const runtime = await request.get(`${baseURL}/js/runtime-config.js`, { headers: BYPASS_HEADERS });
  expect(runtime.status(), await runtime.text()).toBe(200);
  const runtimeSource = await runtime.text();
  const deployedFrontend = runtimeField(runtimeSource, 'release');
  const runtimeEnvironment = runtimeField(runtimeSource, 'environment');
  const runtimeApiBase = runtimeField(runtimeSource, 'apiBase');
  expect(deployedFrontend, 'staging deployment must match checked-out staging SHA').toBe(SOURCE_SHA);
  expect(runtimeEnvironment).toBe('staging');
  expect(runtimeApiBase).toBe(STAGING_API);

  const health = await request.get(`${STAGING_API}/health`);
  expect(health.status(), await health.text()).toBe(200);
  const backend = await health.json();
  expect(backend.release).toMatch(SHA);

  const auth = await installStudent(context, request, baseURL);
  const created = await createThroughAdmission(page);
  const createdCanonical = await canonicalSession(request, auth.access_token, created.sessionId);

  let previousSessionId = null;
  let previousPath = null;
  if (PHASE === 'floor') {
    previousSessionId = created.sessionId;
    previousPath = created.expectedPath;
  } else if (PHASE === 'cutover') {
    previousSessionId = PREVIOUS_LEGACY;
    previousPath = '/pages/practice.html';
  } else {
    previousSessionId = PREVIOUS_NEXT;
    previousPath = '/practice/session';
  }

  const previousUrl = await probeStableUrl(context, previousPath, previousSessionId);
  const floorDarkNextUrl = PHASE === 'floor'
    ? await probeStableUrl(context, '/practice/session', created.sessionId)
    : null;
  const previousCanonical = await canonicalSession(request, auth.access_token, previousSessionId);

  writeEvidence({
    status: 'passed',
    ok: true,
    expected_admission: PHASE === 'cutover' ? 'next' : 'legacy',
    runtime_environment: runtimeEnvironment,
    api_base: runtimeApiBase,
    deployed_frontend_sha: deployedFrontend,
    backend_release: backend.release,
    backend_git_branch: backend.git_branch || null,
    previous_session_id: previousSessionId,
    created_session_id: created.sessionId,
    created_session_url: created.url,
    previous_session_url: previousUrl,
    floor_dark_next_url: floorDarkNextUrl,
    canonical_sessions: [createdCanonical, previousCanonical],
    reload_and_copy_url_passed: true,
  });
});
