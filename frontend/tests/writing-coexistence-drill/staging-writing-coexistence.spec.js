const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const MANIFEST = require('../../tooling/gate-e-writing-coexistence-drill.json');
const { BYPASS_HEADERS, primeBypassCookie, identityEmail, STAGING_API,
  STAGING_SUPABASE, STAGING_ANON } = require('../staging-e2e/helpers');

const env = process.env;
const PHASE = env.GATE_E_DRILL_PHASE || '';
const SOURCE_SHA = env.GATE_E_SOURCE_SHA || '';
const FLOOR_SHA = env.GATE_E_ROLLBACK_FLOOR_SHA || '';
const PREVIOUS_RUN_ID = env.GATE_E_PREVIOUS_PHASE_RUN_ID || '';
const PREVIOUS_LEGACY_ASSIGNMENT = env.GATE_E_PREVIOUS_LEGACY_ASSIGNMENT_ID || '';
const PREVIOUS_NEXT_ASSIGNMENT = env.GATE_E_PREVIOUS_NEXT_ASSIGNMENT_ID || '';
const OUTPUT = path.resolve('test-results/gate-e-writing-coexistence-evidence.json');
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
const ANCHOR_ID = 'ee600001-0000-4000-8000-000000000001';
const ANCHOR_NAME = '[STAGING] Gate E Writing Fixture Anchor';

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

async function fixtureAnchor(request, adminToken) {
  const response = await request.get(`${STAGING_API}/admin/writing/assignments/${ANCHOR_ID}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(response.status(), await response.text()).toBe(200);
  const anchor = await response.json();
  expect(anchor.id).toBe(ANCHOR_ID);
  expect(anchor.name, 'seed_staging_writing_coexistence.py must create the anchor').toBe(ANCHOR_NAME);
  expect(anchor.prompt_id).toMatch(UUID);
  expect(anchor.student_id).toMatch(UUID);
  return anchor;
}

async function createFreshAssignment(request, adminToken, anchor, label) {
  const requestId = randomUUID();
  const response = await request.post(`${STAGING_API}/admin/writing/assignments`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      request_id: requestId,
      prompt_ids: [anchor.prompt_id],
      student_ids: [anchor.student_id],
      name: `[STAGING] Gate E Writing ${label} ${SOURCE_SHA.slice(0, 8)}`,
      allow_soft_check: false,
      instructions: 'Synthetic live coexistence drill assignment.',
      is_timed: false,
      analysis_level: 3,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  expect(body.count).toBe(1);
  expect(body.created).toHaveLength(1);
  expect(body.created[0].id).toMatch(UUID);
  return { assignmentId: body.created[0].id, requestId };
}

async function canonicalAssignment(request, studentToken, assignmentId) {
  const response = await request.get(
    `${STAGING_API}/api/writing/my-assignments/${encodeURIComponent(assignmentId)}`,
    { headers: { Authorization: `Bearer ${studentToken}` } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.assignment?.id).toBe(assignmentId);
  return {
    id: body.assignment.id,
    status: body.assignment.status,
    renderer_affinity: body.assignment.renderer_affinity ?? null,
    draft_text: body.draft?.draft_text || '',
  };
}

async function probeRuntimeAdmission(request, baseURL, assignmentId, expectedPath) {
  const response = await request.get(
    `${baseURL}/core-player/launch?surface=writing_assignment&assignment_id=${encodeURIComponent(assignmentId)}`,
    { headers: BYPASS_HEADERS, maxRedirects: 0 },
  );
  expect(response.status(), await response.text()).toBe(307);
  const location = response.headers().location || '';
  expect(location, 'runtime admission must emit a Location header').toBeTruthy();
  expect(new URL(location, baseURL).pathname).toBe(expectedPath);
  return { status: response.status(), location, expected_path: expectedPath };
}

async function startThroughAdmission(page, assignmentId, expectedPath, expectedRenderer) {
  const endpoint = `/api/writing/my-assignments/${assignmentId}`;
  const claim = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `${endpoint}/renderer-affinity`);
  const started = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `${endpoint}/start`);
  const detail = page.waitForResponse((r) => r.request().method() === 'GET' &&
    new URL(r.url()).pathname === endpoint);
  await page.goto(`/core-player/launch?surface=writing_assignment&assignment_id=${encodeURIComponent(assignmentId)}`);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  await expect(page.locator('#modal-essay-textarea')).toBeVisible();
  const claimResponse = await claim;
  expect(claimResponse.status(), await claimResponse.text()).toBe(200);
  expect((await claimResponse.json()).renderer_affinity).toBe(expectedRenderer);
  expect((await started).status()).toBe(200);
  expect((await detail).status()).toBe(200);
  return { assignmentId, url: page.url(), expectedPath };
}

async function writeDraftThroughPlayer(page, assignmentId, draftText) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' &&
    new URL(r.url()).pathname === `/api/writing/my-assignments/${assignmentId}/draft`);
  await page.locator('#modal-essay-textarea').fill(draftText);
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
}

async function probeStableUrl(context, stablePath, assignmentId, expectedDraft) {
  const exact = `${stablePath}?assignment_id=${encodeURIComponent(assignmentId)}`;
  const open = async (tab, action) => {
    const endpoint = `/api/writing/my-assignments/${assignmentId}`;
    const claim = tab.waitForResponse((r) => r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `${endpoint}/renderer-affinity`);
    const detail = tab.waitForResponse((r) => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === endpoint);
    await action();
    expect((await claim).status()).toBe(200);
    expect((await detail).status()).toBe(200);
    await expect(tab.locator('#modal-essay-textarea')).toBeVisible();
    await expect(tab.locator('#modal-essay-textarea')).toHaveValue(expectedDraft);
    await expect.poll(() => new URL(tab.url()).pathname).toBe(stablePath);
  };
  const tab = await context.newPage();
  await open(tab, () => tab.goto(exact));
  await open(tab, () => tab.reload());
  const copied = await context.newPage();
  await open(copied, () => copied.goto(tab.url()));
  const url = tab.url();
  await copied.close();
  await tab.close();
  return url;
}

test('live Writing floor → rollback → restore preserves assignment affinity and draft', async ({
  page, context, request, baseURL,
}) => {
  writeEvidence({ status: 'started', ok: false });
  expect(['floor', 'rollback', 'restore']).toContain(PHASE);
  expect(SOURCE_SHA).toMatch(SHA);
  expect(FLOOR_SHA).toMatch(SHA);
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

  const student = await installStudent(context, request, baseURL);
  const admin = await signIn(request, 'admin');
  const health = await request.get(`${STAGING_API}/health/runtime`, {
    headers: { Authorization: `Bearer ${admin.access_token}` },
  });
  expect(health.status(), await health.text()).toBe(200);
  const backend = await health.json();
  expect(backend.git_sha).toBe(SOURCE_SHA);
  expect(backend.git_branch).toBe('staging');

  const anchor = await fixtureAnchor(request, admin.access_token);
  const fresh = await createFreshAssignment(request, admin.access_token, anchor, PHASE);
  const expectedRenderer = PHASE === 'rollback' ? 'legacy' : 'next';
  const expectedPath = expectedRenderer === 'next'
    ? '/writing/dashboard' : '/pages/writing-dashboard.html';
  const admission = await probeRuntimeAdmission(request, baseURL, fresh.assignmentId, expectedPath);
  const created = await startThroughAdmission(page, fresh.assignmentId, expectedPath, expectedRenderer);
  const createdDraft = `[Gate E Writing ${PHASE}] ${SOURCE_SHA.slice(0, 12)} ${fresh.assignmentId}`;
  await writeDraftThroughPlayer(page, fresh.assignmentId, createdDraft);
  const createdCanonical = await canonicalAssignment(request, student.access_token, fresh.assignmentId);
  expect(createdCanonical.renderer_affinity).toBe(expectedRenderer);
  expect(createdCanonical.draft_text).toBe(createdDraft);

  const previousAssignment = PHASE === 'floor' ? fresh.assignmentId
    : PHASE === 'rollback' ? PREVIOUS_NEXT_ASSIGNMENT : PREVIOUS_LEGACY_ASSIGNMENT;
  expect(previousAssignment).toMatch(UUID);
  const previousCanonical = await canonicalAssignment(request, student.access_token, previousAssignment);
  const previousRenderer = PHASE === 'rollback' ? 'next'
    : PHASE === 'restore' ? 'legacy' : 'next';
  expect(previousCanonical.renderer_affinity).toBe(previousRenderer);
  expect(previousCanonical.draft_text).not.toBe('');
  const previousPath = previousRenderer === 'next'
    ? '/writing/dashboard' : '/pages/writing-dashboard.html';
  const previousUrl = await probeStableUrl(
    context, previousPath, previousAssignment, previousCanonical.draft_text,
  );

  let dark = null;
  if (PHASE === 'floor') {
    const darkFresh = await createFreshAssignment(request, admin.access_token, anchor, 'floor-dark-legacy');
    const before = await canonicalAssignment(request, student.access_token, darkFresh.assignmentId);
    expect(before.renderer_affinity).toBeNull();
    const url = await probeStableUrl(
      context, '/pages/writing-dashboard.html', darkFresh.assignmentId, '',
    );
    const after = await canonicalAssignment(request, student.access_token, darkFresh.assignmentId);
    expect(after.renderer_affinity).toBe('legacy');
    dark = { assignmentId: darkFresh.assignmentId, url, before, after };
  }

  writeEvidence({
    status: 'passed', ok: true, expected_admission: expectedRenderer,
    floor_lineage_verified: true, previous_phase_handoff_verified: true,
    previous_phase_run_id: PREVIOUS_RUN_ID || null,
    deployed_frontend_sha: deployedFrontend, deployed_frontend_branch: 'staging',
    backend_release: backend.git_sha, backend_git_branch: backend.git_branch,
    backend_environment_name: backend.environment_name,
    fixture_create_request_id: fresh.requestId,
    previous_assignment_id: previousAssignment, previous_assignment_url: previousUrl,
    previous_draft_text: previousCanonical.draft_text,
    created_assignment_id: created.assignmentId, created_assignment_url: created.url,
    created_draft_text: createdDraft,
    admission_status: admission.status, admission_location: admission.location,
    admission_expected_path: admission.expected_path,
    ...(dark ? {
      floor_dark_legacy_url: dark.url,
      floor_dark_legacy_assignment_id: dark.assignmentId,
      floor_dark_legacy_affinity_before: dark.before.renderer_affinity,
      floor_dark_legacy_affinity_after: dark.after.renderer_affinity,
    } : {}),
    ...(PHASE !== 'floor' ? { transition_mode: env.GATE_E_TRANSITION_MODE } : {}),
    canonical_assignments: [createdCanonical, previousCanonical, ...(dark ? [dark.after] : [])],
    reload_and_copy_url_passed: true,
  });
});
