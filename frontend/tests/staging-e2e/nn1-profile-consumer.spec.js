// N/N−1 consumer test — profile mutation pilot (ADR-009 §4, Pilot Entry
// checklist). Runs BOTH the legacy and the Next profile client's EXACT
// request contract against the staging backend HEAD, proving the profile
// cutover is rollback-safe: whichever frontend version is deployed (Next after
// cutover, or legacy after a frontend rollback), the current backend serves
// it. The static half (both clients send/read the same shape) is
// tests/profile-nn1-contract.test.mjs.
//
// Reversible: snapshots the profile first and restores it in afterAll, so the
// shared smoke student is left as found (same discipline as pilot-4).
// @ts-check
const { test, expect } = require('@playwright/test');
const { STAGING_API, signIn } = require('./helpers');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// The EXACT payload shape both clients build (public/pages/profile.html
// saveProfile + app/(authed)/profile/profile-behavior.tsx): identical keys,
// nulls stripped. Distinct values per client so persistence is unambiguous.
const LEGACY_PAYLOAD = {
  display_name: 'NN1 Legacy Client',
  target_band: 6.5,
  exam_date: '2026-10-01',
  self_level: 'intermediate',
  weekly_goal: 8,
};
const NEXT_PAYLOAD = {
  display_name: 'NN1 Next Client',
  target_band: 7.0,
  exam_date: '2026-11-15',
  self_level: 'advanced',
  weekly_goal: 11,
};

// Fields BOTH render functions read from GET /auth/profile — the backend must
// still return every one (ADR-009 §1: no field removal in the rollback window).
const READ_FIELDS = [
  'display_name', 'email', 'avatar_url', 'target_band', 'exam_date',
  'self_level', 'weekly_goal', 'joined_at', 'stats',
];

test.describe.serial('N/N−1 — profile consumer contract vs backend HEAD', () => {
  /** @type {any} */ let original;

  test.beforeAll(async ({ request }) => {
    const token = await signIn(request, 'student');
    const res = await request.get(`${STAGING_API}/auth/profile`, { headers: auth(token) });
    if (res.ok()) original = await res.json();
  });

  test.afterAll(async ({ request }) => {
    if (!original) return;
    try {
      const token = await signIn(request, 'student');
      await request.patch(`${STAGING_API}/auth/profile`, {
        headers: auth(token),
        data: {
          display_name: original.display_name || 'E2E student smoke',
          target_band: original.target_band ?? 6.0,
          exam_date: original.exam_date || '2026-09-15',
          self_level: original.self_level || 'intermediate',
          weekly_goal: original.weekly_goal || 5,
        },
      });
    } catch (e) {
      console.warn(`nn1 profile restore skipped: ${e}`);
    }
  });

  async function patchAndVerify(request, payload) {
    const token = await signIn(request, 'student');
    const patch = await request.patch(`${STAGING_API}/auth/profile`, {
      headers: auth(token), data: payload,
    });
    expect(patch.status(), await patch.text()).toBe(200);
    expect(patch.headers()['cache-control']).toBe('private, no-store');
    // canonical GET must reflect every written field
    const get = await request.get(`${STAGING_API}/auth/profile`, { headers: auth(token) });
    expect(get.status()).toBe(200);
    const body = await get.json();
    for (const [k, v] of Object.entries(payload)) {
      expect(body[k], `field ${k} must persist`).toBe(v);
    }
    return body;
  }

  test('LEGACY client payload works against backend HEAD (frontend-rollback safety)', async ({ request }) => {
    // This is the ADR-009 §4 case: after a frontend rollback to the legacy
    // profile page, its saveProfile contract must still be honored by the
    // current backend.
    const body = await patchAndVerify(request, LEGACY_PAYLOAD);
    // no-removal: every field the (legacy) render reads is present
    for (const f of READ_FIELDS) {
      expect(f in body, `GET /auth/profile must return "${f}"`).toBe(true);
    }
    expect(body.stats && typeof body.stats === 'object').toBeTruthy();
  });

  test('NEXT client payload works against backend HEAD (interchangeable consumer)', async ({ request }) => {
    const body = await patchAndVerify(request, NEXT_PAYLOAD);
    // Same contract, different values — proves the two clients are
    // interchangeable against one backend (the N/N−1 invariant).
    expect(body.display_name).toBe(NEXT_PAYLOAD.display_name);
    expect(body.weekly_goal).toBe(NEXT_PAYLOAD.weekly_goal);
  });

  test('idempotent replay of a client payload converges (retry-safe across the window)', async ({ request }) => {
    const first = await patchAndVerify(request, LEGACY_PAYLOAD);
    const second = await patchAndVerify(request, LEGACY_PAYLOAD);
    for (const k of Object.keys(LEGACY_PAYLOAD)) {
      expect(second[k]).toBe(first[k]);
    }
  });
});
