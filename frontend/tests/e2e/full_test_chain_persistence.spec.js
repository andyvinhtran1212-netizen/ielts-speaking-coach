// Spike-2 fix regression (2026-07-14): the full-test session chain
// (_ftAllSessionIds) must survive a refresh via sessionStorage
// 'ielts_ft_session_ids' — before the fix, a refresh mid full-test LOST
// Part 1's session id and finalize-full-test aggregated the wrong sessions.
//
// Drives the REAL /pages/practice.html with a stubbed backend (route
// interception — nothing leaves the browser) + an injected Supabase session,
// and asserts the observable half of the contract: what init() leaves in
// sessionStorage for each seeded-chain case (restore / truncate / reject).
const { test, expect } = require('@playwright/test');

const CHAIN_KEY = 'ielts_ft_session_ids';
const SB_KEY = 'sb-huwsmtubwulikhlmcirx-auth-token';
const SID = '11111111-1111-4111-8111-111111111102'; // current (Part 2) session
const P1 = '11111111-1111-4111-8111-111111111101';
const P3 = '11111111-1111-4111-8111-111111111103';

const FAKE_SESSION = {
  access_token: 'fake-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'r',
  user: { id: '00000000-0000-4000-8000-0000000000aa', email: 'chain@test.local', aud: 'authenticated', user_metadata: {} },
};

async function openPractice(page, seededChain) {
  // Backend stubs — session is a test_full PART 2 (part 1's 9-question
  // structural check doesn't apply, one question is enough to reach the
  // chain-init block, which runs before question routing).
  await page.route('http://localhost:8000/**', (route) => {
    const url = route.request().url();
    // CORS preflights: Playwright's Chromium routing currently answers
    // intercepted requests without enforcing preflight, but that is an
    // implementation detail — answer OPTIONS properly so the stub stays
    // valid if that behavior ever changes (review #748).
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, x-request-id',
        },
      });
    }
    if (url.endsWith(`/sessions/${SID}`)) {
      return route.fulfill({ json: { session_id: SID, id: SID, mode: 'test_full', part: 2, topic: 'Hobbies', status: 'in_progress' }, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.endsWith(`/sessions/${SID}/questions`)) {
      return route.fulfill({ json: [{ id: 'q-1', question_text: 'Describe a hobby you enjoy.', part: 2, cue_card_bullets: ['what', 'when', 'why'] }], headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ status: 404, json: {}, headers: { 'access-control-allow-origin': '*' } });
  });

  await page.addInitScript(([sbKey, sbVal, chainKey, chain]) => {
    window.localStorage.setItem(sbKey, sbVal);
    if (chain) window.sessionStorage.setItem(chainKey, chain);
  }, [SB_KEY, JSON.stringify(FAKE_SESSION), CHAIN_KEY, seededChain ? JSON.stringify(seededChain) : null]);

  await page.goto(`/pages/practice.html?session_id=${SID}`);
  // init() finished = showState() moved 'active' off the loading section
  // (states toggle via the 'active' class, not style.display).
  await page.waitForFunction(() => {
    const el = document.getElementById('state-loading');
    return el && !el.classList.contains('active');
  }, null, { timeout: 15000 });
  return page.evaluate((k) => JSON.parse(window.sessionStorage.getItem(k) || 'null'), CHAIN_KEY);
}

test('fresh full-test init persists the chain to sessionStorage', async ({ page }) => {
  const chain = await openPractice(page, null);
  expect(chain).toEqual([SID]);
});

test('refresh mid-test RESTORES the chain (Part 1 id survives — the defect)', async ({ page }) => {
  const chain = await openPractice(page, [P1, SID]);
  expect(chain).toEqual([P1, SID]); // before the fix this became [SID] in memory
});

test('chain is truncated after the current session (later parts being redone)', async ({ page }) => {
  const chain = await openPractice(page, [P1, SID, P3]);
  expect(chain).toEqual([P1, SID]);
});

test('a stale chain from another full test is rejected (membership check)', async ({ page }) => {
  const chain = await openPractice(page, ['22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222202']);
  expect(chain).toEqual([SID]);
});
