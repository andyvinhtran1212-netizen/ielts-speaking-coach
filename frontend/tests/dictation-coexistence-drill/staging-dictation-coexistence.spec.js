const { test, expect } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const MANIFEST = require('../../tooling/gate-e-dictation-coexistence-drill.json');
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
const OUTPUT = path.resolve('test-results/gate-e-dictation-coexistence-evidence.json');
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
const FIXTURE_TESTS = [1, 2, 3, 4]
  .map((n) => `ee30000${n}-0000-4000-8000-00000000000${n}`);

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

async function canonicalAttempt(request, token, testId, attemptId) {
  const response = await request.get(
    `${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/dictation/attempts/in-progress?section_num=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.attempt?.attempt_id).toBe(attemptId);
  return { id: body.attempt.attempt_id, test_id: testId, section_num: 1,
    status: body.attempt.status, renderer_affinity: body.attempt.renderer_affinity ?? null,
    answer_count: Array.isArray(body.attempt.answers) ? body.attempt.answers.length : null,
    unit_count: Array.isArray(body.attempt.units) ? body.attempt.units.length : null };
}

async function accessibleTargets(request, token, excludedTests = [], compatibleRenderer = null) {
  const candidates = [];
  for (const testId of FIXTURE_TESTS) {
    if (excludedTests.includes(testId)) continue;
    const bundle = await request.get(
      `${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/dictation`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (bundle.status() !== 200) continue;
    const sections = (await bundle.json()).sections || [];
    if (!sections.some((section) => Number(section.section_num) === 1 && section.sentences?.length)) continue;
    const active = await request.get(
      `${STAGING_API}/api/listening/tests/${encodeURIComponent(testId)}/dictation/attempts/in-progress?section_num=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (active.status() !== 200) continue;
    const inProgress = (await active.json())?.attempt || null;
    const affinity = inProgress?.renderer_affinity ?? null;
    if (inProgress && affinity !== null && compatibleRenderer && affinity !== compatibleRenderer) continue;
    const rank = compatibleRenderer
      ? (!inProgress ? 0 : affinity === compatibleRenderer ? 1 : 2)
      : (!inProgress ? 0 : affinity === null ? 1 : 2);
    if (rank === 0) return [{ testId, sectionNum: 1, inProgress }];
    candidates.push({ testId, sectionNum: 1, inProgress, rank });
  }
  const result = candidates.sort((a, b) => a.rank - b.rank).slice(0, 3);
  expect(result.length, 'staging needs a phase-compatible Dictation fixture').toBeGreaterThan(0);
  return result;
}

async function probeRuntimeAdmission(request, baseURL, target, expectedPath) {
  const response = await request.get(
    `${baseURL}/core-player/launch?surface=listening_dictation&test_id=${encodeURIComponent(target.testId)}&section=1`,
    { headers: BYPASS_HEADERS, maxRedirects: 0 },
  );
  expect(response.status(), await response.text()).toBe(307);
  const location = response.headers().location || '';
  expect(location, 'runtime admission must emit a Location header').toBeTruthy();
  expect(new URL(location, baseURL).pathname).toBe(expectedPath);
  return { status: response.status(), location, expected_path: expectedPath };
}

async function startThroughAdmission(page, target) {
  const expectedPath = PHASE === 'cutover'
    ? '/listening/dictation/session' : '/pages/listening-test-dictation.html';
  const claimPaths = [];
  const captureClaim = (response) => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (request.method() === 'POST' && pathname.endsWith('/renderer-affinity')) claimPaths.push(pathname);
  };
  page.on('response', captureClaim);
  const created = target.inProgress ? null : page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/listening/tests/${target.testId}/dictation/attempts`);
  await page.goto(`/core-player/launch?surface=listening_dictation&test_id=${encodeURIComponent(target.testId)}&section=1`);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  if (expectedPath === '/listening/dictation/session') {
    await expect(page.getByLabel('Câu trả lời câu 1')).toBeVisible();
  } else {
    await expect(page.locator('#answer')).toBeVisible();
  }
  const body = target.inProgress || await (await created).json();
  expect(body.attempt_id).toMatch(UUID);
  const expectedClaim = `/api/listening/tests/dictation/attempts/${body.attempt_id}/renderer-affinity`;
  await expect.poll(() => claimPaths.includes(expectedClaim), { timeout: 10_000 }).toBe(true);
  page.off('response', captureClaim);
  return { attemptId: body.attempt_id, testId: target.testId,
    expectedPath, url: page.url(), resumed: Boolean(target.inProgress) };
}

async function createUnclaimedAttempt(request, token, target) {
  const response = await request.post(
    `${STAGING_API}/api/listening/tests/${encodeURIComponent(target.testId)}/dictation/attempts?section_num=1`,
    { headers: { Authorization: `Bearer ${token}` },
      data: { renderer_affinity_protocol: 'claim-v1' } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.attempt_id).toMatch(UUID);
  expect(body.renderer_affinity).toBeNull();
  return body.attempt_id;
}

async function probeStableUrl(context, stablePath, testId) {
  const exact = `${stablePath}?test_id=${encodeURIComponent(testId)}&section=1`;
  const tab = await context.newPage();
  for (const action of [() => tab.goto(exact), () => tab.reload()]) {
    const boot = tab.waitForResponse((r) => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === `/api/listening/tests/${testId}/dictation`);
    const claim = tab.waitForResponse((r) => r.request().method() === 'POST' &&
      new URL(r.url()).pathname.startsWith('/api/listening/tests/dictation/attempts/') &&
      new URL(r.url()).pathname.endsWith('/renderer-affinity'));
    await action();
    expect((await boot).status()).toBe(200);
    expect((await claim).status()).toBe(200);
    await expect.poll(() => new URL(tab.url()).pathname).toBe(stablePath);
  }
  const copied = await context.newPage();
  const copiedBoot = copied.waitForResponse((r) => r.request().method() === 'GET' &&
    new URL(r.url()).pathname === `/api/listening/tests/${testId}/dictation`);
  const copiedClaim = copied.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname.startsWith('/api/listening/tests/dictation/attempts/') &&
    new URL(r.url()).pathname.endsWith('/renderer-affinity'));
  await copied.goto(tab.url());
  expect((await copiedBoot).status()).toBe(200);
  expect((await copiedClaim).status()).toBe(200);
  await expect.poll(() => new URL(copied.url()).pathname).toBe(stablePath);
  const url = tab.url();
  await copied.close(); await tab.close();
  return url;
}

test('live Dictation floor → cutover → rollback preserves attempt affinity', async ({ page, context, request, baseURL }) => {
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
  const target = (await accessibleTargets(request, auth.access_token,
    previousTest ? [previousTest] : [], expectedRenderer))[0];
  const expectedAdmissionPath = PHASE === 'cutover'
    ? '/listening/dictation/session' : '/pages/listening-test-dictation.html';
  const admission = await probeRuntimeAdmission(request, baseURL, target, expectedAdmissionPath);
  const created = await startThroughAdmission(page, target);
  const createdCanonical = await canonicalAttempt(
    request, auth.access_token, created.testId, created.attemptId,
  );
  expect(createdCanonical.renderer_affinity).toBe(expectedRenderer);

  const oldAttemptId = PHASE === 'floor' ? created.attemptId : previousAttempt;
  const oldTestId = PHASE === 'floor' ? created.testId : previousTest;
  const oldPath = PHASE === 'cutover' ? '/pages/listening-test-dictation.html'
    : PHASE === 'rollback' ? '/listening/dictation/session' : created.expectedPath;
  const previousUrl = await probeStableUrl(context, oldPath, oldTestId);
  const previousCanonical = await canonicalAttempt(
    request, auth.access_token, oldTestId, oldAttemptId,
  );

  let dark = null;
  if (PHASE === 'floor') {
    const darkTarget = (await accessibleTargets(
      request, auth.access_token, [created.testId], null,
    ))[0];
    const darkAttemptId = await createUnclaimedAttempt(request, auth.access_token, darkTarget);
    const before = await canonicalAttempt(
      request, auth.access_token, darkTarget.testId, darkAttemptId,
    );
    expect(before.renderer_affinity).toBeNull();
    const url = await probeStableUrl(context, '/listening/dictation/session', darkTarget.testId);
    const after = await canonicalAttempt(
      request, auth.access_token, darkTarget.testId, darkAttemptId,
    );
    expect(after.renderer_affinity).toBe('next');
    dark = { url, attemptId: darkAttemptId, testId: darkTarget.testId, before, after };
  }

  writeEvidence({
    status: 'passed', ok: true, expected_admission: expectedRenderer,
    floor_lineage_verified: true, previous_phase_handoff_verified: true,
    previous_phase_run_id: PREVIOUS_RUN_ID || null,
    deployed_frontend_sha: deployedFrontend, deployed_frontend_branch: 'staging',
    backend_release: backend.git_sha, backend_git_branch: backend.git_branch,
    backend_environment_name: backend.environment_name,
    previous_attempt_id: oldAttemptId, previous_test_id: oldTestId,
    created_attempt_id: created.attemptId, created_test_id: created.testId,
    created_attempt_url: created.url, created_attempt_resumed: created.resumed,
    previous_attempt_url: previousUrl,
    admission_status: admission.status, admission_location: admission.location,
    admission_expected_path: admission.expected_path,
    ...(dark ? { floor_dark_next_url: dark.url, floor_dark_next_attempt_id: dark.attemptId,
      floor_dark_next_test_id: dark.testId,
      floor_dark_next_affinity_before: dark.before.renderer_affinity,
      floor_dark_next_affinity_after: dark.after.renderer_affinity } : {}),
    ...(PHASE === 'rollback' ? { rollback_mode: env.GATE_E_ROLLBACK_MODE } : {}),
    canonical_attempts: [createdCanonical, previousCanonical, ...(dark ? [dark.after] : [])],
    reload_and_copy_url_passed: true,
  });
});
