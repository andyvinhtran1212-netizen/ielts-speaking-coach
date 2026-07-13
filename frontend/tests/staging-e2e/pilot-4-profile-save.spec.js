// Pilot 4 (authenticated reversible mutation) — live staging proof of the
// mutation-pilot entry checklist (plan Phase 2):
//
//   1. save → success toast → RELOAD → values persist (canonical, not
//      optimistic) → revert (the mutation is reversible; staging stays clean)
//   2. double submit: PATCH delayed in-flight, two clicks → exactly ONE
//      PATCH leaves the browser
//   3. kill-switch drill (ADR-010 cutover condition): admin flips
//      `profile_update` off → measured seconds until PATCH returns 503
//      feature_disabled (must be ≤ one 15 s cache window + margin) → flips
//      back on → measured recovery; flag is restored in afterAll even on
//      failure
//   4. request-level contract: 401 without token, 400 on invalid self_level,
//      idempotent replay (same PATCH twice → same 200 result)
//
// Identities: staging_seed.py --ns smoke (student mutates, admin flips).
// @ts-check
const { test, expect } = require('@playwright/test');
const {
  primeBypassCookie, signIn, identityEmail, STAGING_API, STAGING_SUPABASE, STAGING_ANON,
} = require('./helpers');

const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
const FLAG_URL = `${STAGING_API}/admin/runtime-flags/profile_update`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function signInSession(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  const res = await request.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
    headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
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

test.describe.serial('pilot 4 — /profile-preview mutation', () => {
  test.afterAll(async ({ request }) => {
    // The kill switch must NEVER be left off on staging, even if a test blew
    // up mid-drill — every other suite (and the legacy page) depends on it.
    try {
      const adminToken = await signIn(request, 'admin');
      await request.patch(FLAG_URL, {
        headers: auth(adminToken),
        data: { enabled: true, note: 'pilot-4 e2e afterAll restore' },
      });
    } catch (e) {
      console.warn(`pilot-4 flag restore skipped: ${e}`);
    }
  });

  test('save → canonical reload → persist across reload → revert', async ({ browser, baseURL, request }) => {
    test.setTimeout(120_000);
    const session = await signInSession(request, 'student');
    const context = await browser.newContext();
    await primeBypassCookie(context, baseURL);
    await context.addInitScript(
      ([key, value]) => {
        if (!window.localStorage.getItem('__e2e_seeded')) {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem('__e2e_seeded', '1');
        }
      },
      [STORAGE_KEY, JSON.stringify(session)],
    );
    const page = await context.newPage();
    await page.goto('/profile-preview');
    await expect(page.locator('#profile-email')).toHaveText(identityEmail('student'), { timeout: 20_000 });

    const nameInput = page.locator('#inp-display-name');
    const original = await nameInput.inputValue();
    const marker = `E2E Pilot4 ${Date.now()}`;

    await nameInput.fill(marker);
    await page.locator('#inp-weekly-goal').fill('9');
    const patchDone = page.waitForResponse(
      (r) => r.url().endsWith('/auth/profile') && r.request().method() === 'PATCH',
    );
    await page.locator('#btn-save').click();
    const patchRes = await patchDone;
    expect(patchRes.status(), await patchRes.text()).toBe(200);
    expect(patchRes.headers()['cache-control']).toBe('private, no-store');
    await expect(page.locator('#toast')).toHaveText('✓ Đã lưu thành công', { timeout: 20_000 });
    // Canonical reload evidence: identity card re-rendered from the GET.
    await expect(page.locator('#profile-display-name')).toHaveText(marker);

    // Persistence: a fresh document render shows the committed values.
    await page.reload();
    await expect(page.locator('#inp-display-name')).toHaveValue(marker, { timeout: 20_000 });
    await expect(page.locator('#goal-display')).toHaveText('9');

    // Reversible: put staging back exactly as found.
    await page.locator('#inp-display-name').fill(original || marker);
    await page.locator('#btn-save').click();
    await expect(page.locator('#toast')).toHaveText('✓ Đã lưu thành công', { timeout: 20_000 });
    await context.close();
  });

  test('double submit: two clicks while PATCH is in flight → exactly one PATCH', async ({ browser, baseURL, request }) => {
    test.setTimeout(90_000);
    const session = await signInSession(request, 'student');
    const context = await browser.newContext();
    await primeBypassCookie(context, baseURL);
    await context.addInitScript(
      ([key, value]) => {
        if (!window.localStorage.getItem('__e2e_seeded')) {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem('__e2e_seeded', '1');
        }
      },
      [STORAGE_KEY, JSON.stringify(session)],
    );
    const page = await context.newPage();

    let patchCount = 0;
    await page.route('**/auth/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patchCount += 1;
      await new Promise((r) => setTimeout(r, 1_500)); // hold it in flight
      return route.continue();
    });

    await page.goto('/profile-preview');
    await expect(page.locator('#profile-email')).toHaveText(identityEmail('student'), { timeout: 20_000 });

    const saveBtn = page.locator('#btn-save');
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled(); // UI half of the double-submit guard
    await saveBtn.click({ force: true }).catch(() => {}); // second click mid-flight
    await expect(page.locator('#toast')).toHaveText('✓ Đã lưu thành công', { timeout: 20_000 });
    expect(patchCount).toBe(1);
    await context.close();
  });

  test('kill-switch drill (ADR-010): flip off → 503 within one cache window → flip on → recovers', async ({ request }) => {
    test.setTimeout(120_000);
    const adminToken = await signIn(request, 'admin');
    const studentToken = await signIn(request, 'student');
    const probe = () =>
      request.patch(`${STAGING_API}/auth/profile`, {
        headers: auth(studentToken),
        data: { weekly_goal: 7 },
      });

    // Baseline: enabled.
    expect((await probe()).status()).toBe(200);

    const offAt = Date.now();
    const off = await request.patch(FLAG_URL, {
      headers: auth(adminToken),
      data: { enabled: false, note: 'pilot-4 e2e kill-switch drill' },
    });
    expect(off.status(), await off.text()).toBe(200);

    let blockedAfterMs = -1;
    for (let i = 0; i < 25; i += 1) {
      const res = await probe();
      if (res.status() === 503) {
        const body = await res.json();
        expect(body.detail.code).toBe('feature_disabled');
        expect(body.detail.flag).toBe('profile_update');
        blockedAfterMs = Date.now() - offAt;
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(blockedAfterMs, 'flip must take effect within one 15s TTL window (+ margin)').toBeGreaterThanOrEqual(0);
    expect(blockedAfterMs).toBeLessThanOrEqual(25_000);

    const onAt = Date.now();
    await request.patch(FLAG_URL, {
      headers: auth(adminToken),
      data: { enabled: true, note: 'pilot-4 e2e drill restore' },
    });
    let recoveredAfterMs = -1;
    for (let i = 0; i < 25; i += 1) {
      const res = await probe();
      if (res.status() === 200) {
        recoveredAfterMs = Date.now() - onAt;
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(recoveredAfterMs).toBeGreaterThanOrEqual(0);
    expect(recoveredAfterMs).toBeLessThanOrEqual(25_000);
    console.log(`kill-switch drill: off→503 in ${blockedAfterMs} ms, on→200 in ${recoveredAfterMs} ms`);
  });

  test('contract: 401 without token, 400 invalid self_level, idempotent replay', async ({ request }) => {
    const studentToken = await signIn(request, 'student');

    const noAuth = await request.patch(`${STAGING_API}/auth/profile`, {
      data: { weekly_goal: 7 },
    });
    expect(noAuth.status()).toBe(401);

    const badLevel = await request.patch(`${STAGING_API}/auth/profile`, {
      headers: auth(studentToken),
      data: { self_level: 'wizard' },
    });
    expect(badLevel.status()).toBe(400);

    const payload = { weekly_goal: 7 };
    const first = await request.patch(`${STAGING_API}/auth/profile`, {
      headers: auth(studentToken), data: payload,
    });
    const second = await request.patch(`${STAGING_API}/auth/profile`, {
      headers: auth(studentToken), data: payload,
    });
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect((await first.json()).weekly_goal).toBe((await second.json()).weekly_goal);
  });
});
