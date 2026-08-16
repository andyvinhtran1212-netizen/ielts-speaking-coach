// Gate E live-staging evidence for the highest-risk Speaking mutation.
//
// Unlike the deterministic Gate E fixture matrices, this test drives the
// deployed App Router route, Railway staging and staging Supabase. The upload
// is allowed to commit, then its response is deliberately reset. The native
// controller must reconcile the canonical response and must not replay POST.
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  PRODUCTION_ORIGINS,
  STAGING_API,
  STAGING_ANON,
  STAGING_SUPABASE,
  identityEmail,
  primeBypassCookie,
} = require('./helpers');

const ROUTE = '/practice/session';
const EVIDENCE_PATH = path.join(
  process.cwd(),
  'test-results',
  'gate-e-live-staging-failure-injection.json',
);
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function signInSession(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  const response = await request.post(
    `${STAGING_SUPABASE}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
      data: { email: identityEmail(role), password },
    },
  );
  if (response.status() !== 200) {
    throw new Error(`sign-in failed for ${role}: HTTP ${response.status()} ${await response.text()}`);
  }
  const session = await response.json();
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  }
  return session;
}

async function installStudentSession(context, request, baseURL) {
  await primeBypassCookie(context, baseURL);
  const session = await signInSession(request, 'student');
  const projectRef = new URL(STAGING_SUPABASE).hostname.split('.')[0];
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  }, [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);
  return session;
}

test.beforeAll(() => {
  // Never let a stale local artifact satisfy the trusted verifier after a
  // failed or interrupted browser run.
  rmSync(EVIDENCE_PATH, { force: true });
});

test('live staging: response commits before reset and Next reconciles without replay', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const sourceSha = process.env.GATE_E_SOURCE_SHA || '';
  expect(sourceSha, 'GATE_E_SOURCE_SHA must pin the tested staging release').toMatch(SHA_PATTERN);
  expect(new URL(baseURL).origin).toBe('https://staging.averlearning.com');

  const session = await installStudentSession(context, request, baseURL);
  const created = await request.post(`${STAGING_API}/sessions`, {
    headers: auth(session.access_token),
    data: { mode: 'practice', part: 1, topic: 'Gate E live failure injection' },
  });
  expect(created.status(), await created.text()).toBe(200);
  const sessionId = (await created.json()).session_id;

  const generated = await request.post(`${STAGING_API}/sessions/${sessionId}/questions/generate`, {
    headers: auth(session.access_token),
    timeout: 30_000,
  });
  expect(generated.status(), await generated.text()).toBe(200);
  const questionResponse = await request.get(`${STAGING_API}/sessions/${sessionId}/questions`, {
    headers: auth(session.access_token),
  });
  expect(questionResponse.status(), await questionResponse.text()).toBe(200);
  const questions = await questionResponse.json();
  expect(questions.length, 'staging must persist at least one generated question').toBeGreaterThan(0);
  const questionId = questions[0].id;

  const productionEgress = [];
  const pageErrors = [];
  page.on('request', (browserRequest) => {
    if (PRODUCTION_ORIGINS.some((origin) => browserRequest.url().includes(origin))) {
      productionEgress.push(browserRequest.url());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let uploadAttempts = 0;
  let reconcileReads = 0;
  let backendCommitStatus = null;
  let backendResponseId = null;
  let commitForwarded = false;
  page.on('request', (browserRequest) => {
    if (commitForwarded
        && browserRequest.method() === 'GET'
        && browserRequest.url() === `${STAGING_API}/sessions/${sessionId}`) {
      reconcileReads += 1;
    }
  });
  await page.route(`**/sessions/${sessionId}/responses`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    uploadAttempts += 1;
    const committed = await route.fetch({ timeout: 60_000, maxRetries: 0 });
    backendCommitStatus = committed.status();
    const committedBody = await committed.json();
    backendResponseId = committedBody.response_id || null;
    commitForwarded = true;
    // The DB row now exists, but the browser never receives the success body.
    await route.abort('connectionreset');
  });

  const navigation = await page.goto(`${ROUTE}?session_id=${encodeURIComponent(sessionId)}`);
  expect(navigation?.status()).toBeLessThan(400);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (
    typeof window.PracticeSubmission?.submit === 'function'
  ))).toBe(true);

  const clientResult = await page.evaluate(async ({ sid, qid }) => {
    const bytes = new Uint8Array(2048);
    bytes.fill(7);
    return window.PracticeSubmission.submit({
      sessionId: sid,
      questionId: qid,
      blob: new Blob([bytes], { type: 'audio/webm' }),
    });
  }, { sid: sessionId, qid: questionId });

  expect(backendCommitStatus).toBe(200);
  expect(backendResponseId).toBeTruthy();
  expect(clientResult._reconciled).toBe(true);
  expect(clientResult.response_id).toBe(backendResponseId);
  expect(uploadAttempts, 'ambiguous commit must not replay POST').toBe(1);
  expect(reconcileReads, 'native controller must reconcile with canonical GET').toBeGreaterThanOrEqual(1);

  const canonicalResponse = await request.get(`${STAGING_API}/sessions/${sessionId}`, {
    headers: auth(session.access_token),
  });
  expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
  const canonicalSession = await canonicalResponse.json();
  const canonicalRow = (canonicalSession.responses || []).find(
    (row) => String(row.question_id) === String(questionId),
  );
  expect(canonicalRow?.id).toBe(backendResponseId);
  expect(productionEgress).toEqual([]);
  expect(pageErrors).toEqual([]);

  const evidence = {
    schema_version: 1,
    evidence_id: 'gate-e-live-staging-speaking-ambiguous-commit-v1',
    captured_at: new Date().toISOString(),
    source_sha: sourceSha,
    git_ref: 'staging',
    staging_origin: new URL(baseURL).origin,
    backend_origin: STAGING_API,
    frontend_route: ROUTE,
    request_method: 'POST',
    session_id: sessionId,
    question_id: questionId,
    backend_commit_status: backendCommitStatus,
    backend_response_id: backendResponseId,
    client_response_id: clientResult.response_id,
    canonical_response_id: canonicalRow.id,
    client_reconciled: clientResult._reconciled === true,
    upload_attempts: uploadAttempts,
    reconcile_reads: reconcileReads,
    production_egress: productionEgress,
    page_errors: pageErrors,
  };
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(
    `[gate-e-live] committed + reconciled ${sessionId}/${questionId}; `
      + 'session intentionally retained for staging audit',
  );
});
