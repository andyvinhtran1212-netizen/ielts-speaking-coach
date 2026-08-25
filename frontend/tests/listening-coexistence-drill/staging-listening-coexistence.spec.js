const { test, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const MANIFEST = require('../../tooling/gate-e-listening-coexistence-drill.json');
const { BYPASS_HEADERS, primeBypassCookie, identityEmail, STAGING_API,
  STAGING_SUPABASE, STAGING_ANON } = require('../staging-e2e/helpers');

const env = process.env;
const PHASE = env.GATE_E_DRILL_PHASE || '';
const SOURCE_SHA = env.GATE_E_SOURCE_SHA || '';
const FLOOR_SHA = env.GATE_E_ROLLBACK_FLOOR_SHA || '';
const PREVIOUS_RUN_ID = env.GATE_E_PREVIOUS_PHASE_RUN_ID || '';
const PREVIOUS_LEGACY_ATTEMPT = env.GATE_E_PREVIOUS_LEGACY_ATTEMPT_ID || '';
const PREVIOUS_LEGACY_TEST = env.GATE_E_PREVIOUS_LEGACY_TEST_ID || '';
const PREVIOUS_NEXT_ATTEMPT = env.GATE_E_PREVIOUS_NEXT_ATTEMPT_ID || '';
const PREVIOUS_NEXT_TEST = env.GATE_E_PREVIOUS_NEXT_TEST_ID || '';
const OUTPUT = path.resolve('test-results/gate-e-listening-coexistence-evidence.json');
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;

function writeEvidence(patch) {
  const evidence = { schema_version: 1, drill_id: MANIFEST.drill_id, phase: PHASE || null,
    source_sha: SOURCE_SHA || null, rollback_floor_sha: FLOOR_SHA || null,
    captured_at: new Date().toISOString(), ...patch };
  if (evidence.status === 'passed') {
    const required = [...MANIFEST.required_evidence, ...(MANIFEST.conditional_evidence[PHASE] || [])];
    expect(required.filter((key) => evidence[key] === undefined)).toEqual([]);
  }
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
}

function runtimeField(source, name) {
  const match = source.match(new RegExp(`"${name}"\\s*:\\s*(null|"([^"]*)")`));
  return match && match[1] !== 'null' ? match[2] : null;
}

async function signIn(request, role = 'student') {
  const response = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
    data: { email: identityEmail(role), password: env.E2E_PASSWORD || '' },
  });
  expect(response.status(), await response.text()).toBe(200);
  const session = await response.json();
  if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  return session;
}

async function installStudent(context, request, baseURL) {
  await primeBypassCookie(context, baseURL);
  const session = await signIn(request);
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch {} },
    [STORAGE_KEY, JSON.stringify(session)]);
  return session;
}

async function accessibleTests(request, token, excluded = [], compatibleRenderer = null) {
  const list = await request.get(`${STAGING_API}/api/listening/tests?test_type=full&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(list.status(), await list.text()).toBe(200);
  const items = (await list.json()).items || [];
  const candidates = [];
  for (const item of items) {
    const testId = String(item.id || '');
    if (!testId || excluded.includes(testId)) continue;
    const detail = await request.get(`${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (detail.status() !== 200) continue;
    const active = await request.get(
      `${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/attempts/in-progress`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (active.status() !== 200) continue;
    const inProgress = (await active.json())?.attempt || null;
    const affinity = inProgress?.renderer_affinity ?? null;
    // A prior drill may leave a legitimate in-progress attempt behind. The
    // stable player must honor that affinity, so selecting an incompatible
    // test here would correctly redirect away from the phase under test and
    // would not exercise the expected player lifecycle. Prefer a genuinely
    // fresh test, then fall back to an already-compatible attempt so repeated
    // staging drills remain deterministic. Admission itself is proven
    // independently from the raw no-follow 307 Location response below, before
    // attempt affinity can redirect either player.
    if (inProgress && affinity !== null && compatibleRenderer && affinity !== compatibleRenderer) {
      continue;
    }
    const rank = compatibleRenderer
      ? (!inProgress ? 0 : affinity === compatibleRenderer ? 1 : 2)
      : (!inProgress ? 0 : affinity === null ? 1 : 2);
    if (rank === 0) return [testId];
    candidates.push({ testId, rank });
  }
  const result = candidates.sort((a, b) => a.rank - b.rank)
    .slice(0, 3).map(({ testId }) => testId);
  expect(result.length, 'staging needs at least one accessible published Listening test').toBeGreaterThan(0);
  return result;
}

async function probeRuntimeAdmission(request, baseURL, testId, expectedPath) {
  const response = await request.get(
    `${baseURL}/core-player/launch?surface=listening_test&id=${encodeURIComponent(testId)}&from=full`,
    { headers: BYPASS_HEADERS, maxRedirects: 0 },
  );
  expect(response.status(), await response.text()).toBe(307);
  const location = response.headers().location || '';
  expect(location, 'runtime admission must emit a Location header').toBeTruthy();
  expect(new URL(location, baseURL).pathname).toBe(expectedPath);
  return { status: response.status(), location, expected_path: expectedPath };
}

async function canonicalAttempt(request, token, testId, attemptId) {
  const response = await request.get(
    `${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/attempts/in-progress`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.attempt?.attempt_id).toBe(attemptId);
  return { id: body.attempt.attempt_id, test_id: testId, status: 'in_progress',
    renderer_affinity: body.attempt.renderer_affinity ?? null,
    answer_count: Array.isArray(body.attempt.answers) ? body.attempt.answers.length : null };
}

async function startThroughAdmission(page, testId) {
  const expectedPath = PHASE === 'cutover' ? '/listening/test/session' : '/pages/listening-test.html';
  const claimPaths = [];
  const captureClaim = (response) => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (request.method() === 'POST' && pathname.endsWith('/renderer-affinity')) {
      claimPaths.push(pathname);
    }
  };
  page.on('response', captureClaim);
  const detail = page.waitForResponse((r) => r.request().method() === 'GET' &&
    new URL(r.url()).pathname === `/api/listening/tests/${testId}`);
  await page.goto(`/core-player/launch?surface=listening_test&id=${encodeURIComponent(testId)}&from=full`);
  expect((await detail).status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  const started = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/listening/tests/${testId}/attempts`);
  if (expectedPath === '/listening/test/session') {
    // The native player deliberately owns its controls and uses an accessible
    // text button + window.confirm instead of the Legacy modal ids.
    const restart = page.getByRole('button', { name: 'Bắt đầu lại từ đầu' });
    const start = page.getByRole('button', { name: 'Bắt đầu test' });
    await expect.poll(async () => {
      const pathname = new URL(page.url()).pathname;
      if (pathname !== expectedPath) return `redirect:${pathname}`;
      if (await restart.isVisible().catch(() => false)) return 'restart';
      if (await start.isVisible().catch(() => false)) return 'start';
      const alert = await page.getByRole('alert').textContent().catch(() => '');
      return alert ? `error:${alert.trim()}` : 'waiting';
    }, { timeout: 15_000, message: 'Next Listening prestart controls did not become ready' })
      .toMatch(/^(restart|start)$/);
    if (await restart.isVisible().catch(() => false)) {
      page.once('dialog', (dialog) => dialog.accept());
      await restart.click();
    } else {
      page.once('dialog', (dialog) => dialog.accept());
      await start.click();
    }
  } else {
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-start').click();
  }
  const response = await started;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.attempt_id).toMatch(UUID);
  const expectedClaim = `/api/listening/tests/attempts/${body.attempt_id}/renderer-affinity`;
  // A fixture may already have an in-progress attempt from a prior drill run.
  // Booting it can claim that old attempt before the restart creates a new one,
  // so correlate by the canonical attempt id instead of accepting the first
  // renderer-affinity response observed on the page.
  await expect.poll(() => claimPaths.includes(expectedClaim), { timeout: 10_000 }).toBe(true);
  page.off('response', captureClaim);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  return { attemptId: body.attempt_id, testId, expectedPath, url: page.url() };
}

async function createUnclaimedAttempt(request, token, testId) {
  const response = await request.post(`${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/attempts`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { renderer_affinity_protocol: 'claim-v1' },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.attempt_id).toMatch(UUID);
  expect(body.renderer_affinity).toBeNull();
  return body.attempt_id;
}

async function probeStableUrl(context, stablePath, testId) {
  const exact = `${stablePath}?id=${encodeURIComponent(testId)}&from=full`;
  const tab = await context.newPage();
  for (const action of [() => tab.goto(exact), () => tab.reload()]) {
    const boot = tab.waitForResponse((r) => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === `/api/listening/tests/${testId}`);
    await action();
    expect((await boot).status()).toBe(200);
    expect(new URL(tab.url()).pathname).toBe(stablePath);
  }
  const copied = await context.newPage();
  const copiedBoot = copied.waitForResponse((r) => r.request().method() === 'GET' &&
    new URL(r.url()).pathname === `/api/listening/tests/${testId}`);
  await copied.goto(tab.url());
  expect((await copiedBoot).status()).toBe(200);
  expect(new URL(copied.url()).pathname).toBe(stablePath);
  const url = tab.url();
  await copied.close(); await tab.close();
  return url;
}

test('live Listening floor → cutover → rollback preserves attempt affinity', async ({ page, context, request, baseURL }) => {
  writeEvidence({ status: 'started', ok: false });
  expect(['floor', 'cutover', 'rollback']).toContain(PHASE);
  expect(SOURCE_SHA).toMatch(SHA); expect(FLOOR_SHA).toMatch(SHA);
  expect(env.GATE_E_LINEAGE_VERIFIED).toBe('true');
  expect(env.GATE_E_HANDOFF_VERIFIED).toBe('true');
  if (PHASE === 'floor') expect(SOURCE_SHA).toBe(FLOOR_SHA);

  const runtime = await request.get(`${baseURL}/js/runtime-config.js`, { headers: BYPASS_HEADERS });
  expect(runtime.status(), await runtime.text()).toBe(200);
  const runtimeSource = await runtime.text();
  const deployedFrontend = runtimeField(runtimeSource, 'release');
  expect(deployedFrontend).toBe(SOURCE_SHA);
  expect(runtimeField(runtimeSource, 'gitRef')).toBe('staging');
  expect(runtimeField(runtimeSource, 'environment')).toBe('staging');
  expect(runtimeField(runtimeSource, 'apiBase')).toBe(STAGING_API);

  const auth = await installStudent(context, request, baseURL);
  const admin = await signIn(request, 'admin');
  const health = await request.get(`${STAGING_API}/health/runtime`, {
    headers: { Authorization: `Bearer ${admin.access_token}` },
  });
  expect(health.status(), await health.text()).toBe(200);
  const backend = await health.json();
  expect(backend.git_sha).toBe(SOURCE_SHA); expect(backend.git_branch).toBe('staging');

  const previousAttempt = PHASE === 'cutover' ? PREVIOUS_LEGACY_ATTEMPT
    : PHASE === 'rollback' ? PREVIOUS_NEXT_ATTEMPT : '';
  const previousTest = PHASE === 'cutover' ? PREVIOUS_LEGACY_TEST
    : PHASE === 'rollback' ? PREVIOUS_NEXT_TEST : '';
  const expectedRenderer = PHASE === 'cutover' ? 'next' : 'legacy';
  const tests = await accessibleTests(
    request,
    auth.access_token,
    previousTest ? [previousTest] : [],
    expectedRenderer,
  );
  const expectedAdmissionPath = PHASE === 'cutover'
    ? '/listening/test/session' : '/pages/listening-test.html';
  const admission = await probeRuntimeAdmission(request, baseURL, tests[0], expectedAdmissionPath);
  const created = await startThroughAdmission(page, tests[0]);
  const createdCanonical = await canonicalAttempt(request, auth.access_token, created.testId, created.attemptId);
  expect(createdCanonical.renderer_affinity).toBe(PHASE === 'cutover' ? 'next' : 'legacy');

  const oldAttemptId = PHASE === 'floor' ? created.attemptId : previousAttempt;
  const oldTestId = PHASE === 'floor' ? created.testId : previousTest;
  const oldPath = PHASE === 'cutover' ? '/pages/listening-test.html'
    : PHASE === 'rollback' ? '/listening/test/session' : created.expectedPath;
  const previousUrl = await probeStableUrl(context, oldPath, oldTestId);
  const previousCanonical = await canonicalAttempt(request, auth.access_token, oldTestId, oldAttemptId);

  let dark = null;
  if (PHASE === 'floor') {
    const darkTests = await accessibleTests(request, auth.access_token, [created.testId]);
    const darkTestId = darkTests[0];
    const darkAttemptId = await createUnclaimedAttempt(request, auth.access_token, darkTestId);
    const before = await canonicalAttempt(request, auth.access_token, darkTestId, darkAttemptId);
    expect(before.renderer_affinity).toBeNull();
    const url = await probeStableUrl(context, '/listening/test/session', darkTestId);
    const after = await canonicalAttempt(request, auth.access_token, darkTestId, darkAttemptId);
    expect(after.renderer_affinity).toBe('next');
    dark = { url, attemptId: darkAttemptId, before, after };
  }

  writeEvidence({
    status: 'passed', ok: true, expected_admission: PHASE === 'cutover' ? 'next' : 'legacy',
    floor_lineage_verified: true, previous_phase_handoff_verified: true,
    previous_phase_run_id: PREVIOUS_RUN_ID || null,
    deployed_frontend_sha: deployedFrontend, deployed_frontend_branch: 'staging',
    backend_release: backend.git_sha, backend_git_branch: backend.git_branch,
    backend_environment_name: backend.environment_name,
    previous_attempt_id: oldAttemptId, previous_test_id: oldTestId,
    created_attempt_id: created.attemptId, created_test_id: created.testId,
    created_attempt_url: created.url, previous_attempt_url: previousUrl,
    admission_status: admission.status, admission_location: admission.location,
    admission_expected_path: admission.expected_path,
    ...(dark ? { floor_dark_next_url: dark.url, floor_dark_next_attempt_id: dark.attemptId,
      floor_dark_next_affinity_before: dark.before.renderer_affinity,
      floor_dark_next_affinity_after: dark.after.renderer_affinity } : {}),
    ...(PHASE === 'rollback' ? { rollback_mode: env.GATE_E_ROLLBACK_MODE } : {}),
    canonical_attempts: [createdCanonical, previousCanonical, ...(dark ? [dark.after] : [])],
    reload_and_copy_url_passed: true,
  });
});
