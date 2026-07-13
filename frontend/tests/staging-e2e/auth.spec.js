// Staging auth stack smoke — proves the §7.2 synthetic-identity factory and
// the staging Supabase → staging FastAPI token path work end to end, without
// depending on the Google-only login UI (password grant via Supabase REST).
//
// Prerequisites:
//   * backend/scripts/staging_seed.py --ns smoke has run (identities exist)
//   * Email provider is ENABLED on the staging Supabase project
//   * E2E_PASSWORD matches the seed password (or the documented default)
// @ts-check
const { test, expect } = require('@playwright/test');

const STAGING_SUPABASE = 'https://zjphffoujxkpltixsbzj.supabase.co';
const STAGING_API = 'https://ielts-speaking-coach-staging.up.railway.app';
// Public (publishable) anon key of the staging project — the same value the
// staging runtime-config ships to every browser (see
// tooling/generate-runtime-config.mjs), so it is safe as a committed default.
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGhmZm91anhrcGx0aXhzYnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTA5ODUsImV4cCI6MjA5MjU4Njk4NX0.A8CSIWH-_p8baHBSGDaNJ2kWyQVgZOLlSX3dD1lOuGU';
const EMAIL = 'e2e-student-smoke@staging-e2e.averlearning.com';
const PASSWORD = process.env.E2E_PASSWORD || 'E2e-staging-Passw0rd!';

test('password sign-in on staging Supabase + /auth/me on staging API', async ({ request }) => {
  const login = await request.post(
    `${STAGING_SUPABASE}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
      data: { email: EMAIL, password: PASSWORD },
    },
  );
  expect(login.status(), await login.text()).toBe(200);
  const { access_token } = await login.json();
  expect(access_token).toBeTruthy();

  const me = await request.get(`${STAGING_API}/auth/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  expect(me.status(), await me.text()).toBe(200);
  const body = await me.json();
  expect(JSON.stringify(body)).toContain('e2e-student-smoke');
});
