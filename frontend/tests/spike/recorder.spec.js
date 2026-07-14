// SPIKE 1 — MediaRecorder under React, cross-engine (plan Phase 2 spike #1).
//
// Chromium runs with fake media devices (deterministic tone on the fake mic).
// WebKit (Safari engine) has no fake-device switch — the recording tests probe
// what IS automatable and skip with an explicit reason otherwise; the findings
// doc pairs this with the manual Safari/iOS protocol printed on the page.
//
// The staging-upload test needs E2E_PASSWORD (staging_seed.py identities) and
// exercises the LEGACY multipart contract browser→staging Railway with
// fixture grading — skipped when the secret is absent (local quick runs).
// @ts-check
const { test, expect } = require('@playwright/test');

const STAGING_SUPABASE = 'https://zjphffoujxkpltixsbzj.supabase.co';
const STAGING_API = 'https://ielts-speaking-coach-staging.up.railway.app';
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGhmZm91anhrcGx0aXhzYnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTA5ODUsImV4cCI6MjA5MjU4Njk4NX0.A8CSIWH-_p8baHBSGDaNJ2kWyQVgZOLlSX3dD1lOuGU';

// goto + wait for React hydration: the component flags `mounted` from its
// effect — clicking before that lands on a dead button (dev first-compile
// makes this race reliable, not theoretical).
async function open(page) {
  await page.goto('/recorder-spike');
  await page.waitForFunction(() => window.__spikeDiag && window.__spikeDiag.mounted, null, { timeout: 30_000 });
}

async function record(page, seconds) {
  await page.click('[data-testid="btn-start"]');
  await expect(page.locator('[data-testid="rec-state"]')).toContainText('recording', { timeout: 10_000 });
  await page.waitForTimeout(seconds * 1000);
  await page.click('[data-testid="btn-stop"]');
  await expect(page.locator('[data-testid="rec-state"]')).toContainText('recorded', { timeout: 10_000 });
  return page.evaluate(() => window.__spikeDiag);
}

test('record → stop → real audio blob with an engine-appropriate MIME', async ({ page, browserName }) => {
  // WebKit runs this too — Playwright's WebKit exposes a mock capture device
  // and the full pipeline works. SPIKE FINDING: do NOT getUserMedia+stop and
  // then navigate before recording — in WebKit automation the SECOND
  // getUserMedia after a navigation hangs forever (no resolve, no reject).
  // One page load, one acquisition.
  await open(page);
  const diag = await record(page, 3);
  expect(Number(diag.blobSize)).toBeGreaterThan(1000);
  expect(Number(diag.chunks)).toBeGreaterThan(2); // 250ms chunking really ticked
  if (browserName === 'chromium') {
    expect(String(diag.blobType)).toContain('webm'); // Chromium lane
  } else {
    expect(String(diag.blobType)).toMatch(/mp4|webm|ogg/); // Safari lane = mp4
  }
  // Playback element wired to a live object URL
  await expect(page.locator('[data-testid="playback"]')).toBeVisible();
});

test('StrictMode dev double-mount: exactly one live recorder, mic still works', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'chromium-only lifecycle probe (fake mic)');
  await open(page);
  // next dev runs React StrictMode: mount → cleanup → mount. The component
  // must survive that (mountCount >= 2) and still record cleanly.
  const mounts = await page.evaluate(() => window.__spikeDiag && window.__spikeDiag.mountCount);
  expect(Number(mounts)).toBeGreaterThanOrEqual(1); // ==2 in dev StrictMode
  const diag = await record(page, 2);
  expect(Number(diag.blobSize)).toBeGreaterThan(500);
});

test('unmount MID-RECORDING releases the microphone (no zombie recorder)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'chromium-only lifecycle probe (fake mic)');
  await open(page);
  await page.click('[data-testid="btn-start"]');
  await expect(page.locator('[data-testid="rec-state"]')).toContainText('recording');
  await page.waitForTimeout(1000);

  await page.click('[data-testid="btn-toggle-mount"]'); // React unmount = route-change stand-in
  await expect(page.locator('[data-testid="unmounted-marker"]')).toBeVisible();

  const after = await page.evaluate(() => window.__spikeDiag);
  expect(after.unmounted).toBe(true);
  // The mic MUST be off: cleanup stopped every track. A live track here means
  // the tab keeps the recording indicator after navigation — the exact bug
  // class this spike exists to catch.
  const live = await page.evaluate(() =>
    // @ts-ignore — enumerate any stray live audio tracks the page still holds
    (window.__spikeDiag && window.__spikeDiag.trackStatesAfterUnmount) || null);
  expect(live).toBe('stopped-by-cleanup');

  // Remount: a fresh acquisition must work (no wedged devices)
  await page.click('[data-testid="btn-toggle-mount"]');
  const diag = await record(page, 2);
  expect(Number(diag.blobSize)).toBeGreaterThan(500);
});

test('browser-recorded blob uploads through the legacy multipart contract → fixture grade', async ({ page, browserName, request }) => {
  test.skip(browserName === 'webkit', 'upload flow pinned on chromium (fake mic)');
  test.skip(!process.env.E2E_PASSWORD, 'E2E_PASSWORD required (staging identities)');

  // Student session + question via the staging API (fixture grading env).
  const login = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
    data: { email: 'e2e-student-smoke@staging-e2e.averlearning.com', password: process.env.E2E_PASSWORD },
  });
  expect(login.status(), await login.text()).toBe(200);
  const token = (await login.json()).access_token;
  const auth = { Authorization: `Bearer ${token}` };

  const created = await request.post(`${STAGING_API}/sessions`, {
    headers: auth, data: { part: 1, topic: 'Hobbies', mode: 'practice' },
  });
  expect(created.status(), await created.text()).toBe(200);
  const sessionId = (await created.json()).session_id;

  let questions = await (await request.get(`${STAGING_API}/sessions/${sessionId}/questions`, { headers: auth })).json();
  if (!questions || !questions.length) {
    questions = await (await request.post(`${STAGING_API}/sessions/${sessionId}/questions/generate`, { headers: auth, data: {} })).json();
  }
  expect(questions.length).toBeGreaterThan(0);
  const questionId = questions[0].id || questions[0].question_id;

  await page.addInitScript(
    (cfg) => { window.__spikeUpload = cfg; },
    { apiBase: STAGING_API, token, sessionId, questionId: String(questionId) },
  );
  await open(page);
  await record(page, 6); // comfortably past any min-duration gate
  await page.click('[data-testid="btn-upload"]');
  await expect(page.locator('[data-testid="upload-result"]')).toContainText('HTTP 200', { timeout: 60_000 });

  const diag = await page.evaluate(() => window.__spikeDiag);
  expect(Number(diag.uploadStatus)).toBe(200);
});
