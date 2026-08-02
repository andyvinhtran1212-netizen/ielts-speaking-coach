// Pilot 3 (authenticated read) — browser-level proof on the LIVE staging
// stack, covering the ADR-011 mandatory isolation matrix:
//
//   1. signed-out fail-closed: /profile leaves for /login.html
//   2. signed-in render: student's own /auth/profile data appears; the private
//      API response carries Cache-Control: private, no-store (pilot checklist)
//   3. two-user isolation: Login A → private data → sign-out → Login B in the
//      SAME browser context: no A data in DOM, no request ever reuses A's
//      token; logout → Back cannot restore A's page.
//
// Session bootstrap: password grant against staging Supabase (helpers.signIn
// path), then the session JSON is written to supabase-js v2's localStorage key
// (`sb-<ref>-auth-token`) BEFORE page scripts run — the same storage the
// legacy CDN client reads, so this exercises the real coexistence auth path.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie, signIn, identityEmail, STAGING_SUPABASE } = require('./helpers');

const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;

/** Full session object from the password grant (not just the token). */
async function signInSession(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  const res = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: require('./helpers').STAGING_ANON,
      'Content-Type': 'application/json',
    },
    data: { email: identityEmail(role), password },
  });
  if (res.status() !== 200) {
    throw new Error(`sign-in failed for ${role}: HTTP ${res.status()} ${await res.text()}`);
  }
  const session = await res.json();
  if (!session.expires_at) {
    session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  }
  return session;
}

test.describe('pilot 3 — /profile authenticated read', () => {
  test('signed-out fail-closed → /login.html', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    await primeBypassCookie(context, baseURL);
    const page = await context.newPage();
    await page.goto('/profile');
    await page.waitForURL('**/login.html*', { timeout: 20_000 });
    await context.close();
  });

  test('two-user isolation (ADR-011 §3): A renders → sign-out → B never sees A', async ({ browser, baseURL, request }) => {
    test.setTimeout(120_000);
    const sessionA = await signInSession(request, 'student');
    const sessionB = await signInSession(request, 'instructor');
    const emailA = identityEmail('student');
    const emailB = identityEmail('instructor');

    const context = await browser.newContext();
    await primeBypassCookie(context, baseURL);
    // Session A lands in storage BEFORE any page script (what a real logged-in
    // student's browser looks like when navigating to the page). Seed marker:
    // the init script runs on EVERY navigation — without the marker it would
    // silently re-inject A's session after sign-out cleared it, corrupting
    // every post-logout assertion below.
    await context.addInitScript(
      ([key, value]) => {
        if (!window.localStorage.getItem('__e2e_seeded')) {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem('__e2e_seeded', '1');
        }
      },
      [STORAGE_KEY, JSON.stringify(sessionA)],
    );
    const page = await context.newPage();

    // Track every bearer the page ever sends (isolation evidence).
    /** @type {{token: string, url: string}[]} */
    const bearers = [];
    page.on('request', (req) => {
      const authz = req.headers()['authorization'];
      if (authz && authz.startsWith('Bearer ')) {
        bearers.push({ token: authz.slice(7), url: req.url() });
      }
    });

    // ── Phase A: student renders own data; private response is no-store ──
    const profileResponseA = page.waitForResponse(
      (r) => r.url().endsWith('/auth/profile') && r.request().method() === 'GET',
      { timeout: 30_000 },
    );
    await page.goto('/profile');
    const resA = await profileResponseA;
    expect(resA.status()).toBe(200);
    expect(resA.headers()['cache-control']).toBe('private, no-store');
    await expect(page.locator('#profile-email')).toHaveText(emailA, { timeout: 20_000 });
    expect(bearers.some((b) => b.token === sessionA.access_token)).toBe(true);

    // ── Sign-out through the SHARED client (same path the chrome uses) ──
    await page.evaluate(async () => {
      // @ts-ignore — window client from api.js
      await window.getSupabase().auth.signOut();
    });
    // Provider fail-closed → replace() to login.
    await page.waitForURL('**/login.html*', { timeout: 20_000 });

    // logout → Back must NOT restore A's private page (replace() + bfcache
    // re-validation). Either we stay on login or land on a signed-out
    // profile page that immediately leaves again — never A's data.
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1_500);
    expect(await page.locator('body').innerText()).not.toContain(emailA);

    // ── Phase B: instructor signs in — SAME context, fresh storage write ──
    const bearersBeforeB = bearers.length;
    await page.goto('/login.html'); // neutral origin page to write storage
    await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [STORAGE_KEY, JSON.stringify(sessionB)],
    );
    await page.goto('/profile');
    await expect(page.locator('#profile-email')).toHaveText(emailB, { timeout: 20_000 });

    // Reload keeps B (no stale A resurrection through any cache).
    await page.reload();
    await expect(page.locator('#profile-email')).toHaveText(emailB, { timeout: 20_000 });

    // Isolation evidence: nothing in B's phase carried A's token, and A's
    // email appears nowhere in B's DOM.
    const phaseB = bearers.slice(bearersBeforeB);
    expect(phaseB.length).toBeGreaterThan(0);
    expect(phaseB.every((b) => b.token !== sessionA.access_token)).toBe(true);
    expect(await page.locator('body').innerText()).not.toContain(emailA);

    await context.close();
  });

  test('same-status account switch (review #742): setSession(B) with NO intervening SIGNED_OUT refetches as B', async ({ browser, baseURL, request }) => {
    test.setTimeout(90_000);
    const sessionA = await signInSession(request, 'student');
    const sessionB = await signInSession(request, 'instructor');
    const emailA = identityEmail('student');
    const emailB = identityEmail('instructor');

    const context = await browser.newContext();
    await primeBypassCookie(context, baseURL);
    await context.addInitScript(
      ([key, value]) => {
        if (!window.localStorage.getItem('__e2e_seeded')) {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem('__e2e_seeded', '1');
        }
      },
      [STORAGE_KEY, JSON.stringify(sessionA)],
    );
    const page = await context.newPage();
    await page.goto('/profile');
    await expect(page.locator('#profile-email')).toHaveText(emailA, { timeout: 20_000 });

    // The exact review-#742 hazard: SIGNED_IN for a DIFFERENT user while
    // status is already signed-in (cross-tab overwrite has no SIGNED_OUT).
    await page.evaluate(
      async ([at, rt]) => {
        // @ts-ignore — window client from api.js
        await window.getSupabase().auth.setSession({ access_token: at, refresh_token: rt });
      },
      [sessionB.access_token, sessionB.refresh_token],
    );

    await expect(page.locator('#profile-email')).toHaveText(emailB, { timeout: 20_000 });
    expect(await page.locator('body').innerText()).not.toContain(emailA);
    await context.close();
  });
});
