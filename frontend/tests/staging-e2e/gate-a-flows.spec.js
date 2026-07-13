// Gate A minimum flows (plan Phase 0 / §11.3), request-level against the
// LIVE staging stack (Vercel → Railway staging → Supabase staging):
//
//   Flow 1 — login + access-code activation (admin mints → student redeems)
//   Flow 2 — practice → grade → result (fixture-mode grading, REAL persistence)
//   Flow 3 — admin access-code lifecycle + the is_used/used_by immutability
//            invariant from CLAUDE.md ("access-code redemption history không
//            bị reset")
//
// Prerequisites: staging_seed.py --ns smoke identities; E2E_PASSWORD secret;
// GRADING_PROVIDER_MODE=fixture on Railway staging — flow 2 ASSERTS the
// fixture payload values, so it doubles as a config-drift guard (if staging
// silently flips back to real providers, this suite goes red on purpose).
// @ts-check
const { test, expect } = require('@playwright/test');
const { STAGING_API, signIn } = require('./helpers');

test.describe.serial('Gate A flows', () => {
  /** @type {string} */ let adminToken;
  /** @type {string} */ let studentToken;
  /** @type {string} */ let studentId;
  /** @type {string} */ let code;
  /** @type {string} */ let codeId;
  /** @type {string} */ let sessionId;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  // Lazy + memoized so a single test can also run in isolation (-g).
  const ensureTokens = async (request) => {
    adminToken = adminToken || (await signIn(request, 'admin'));
    studentToken = studentToken || (await signIn(request, 'student'));
    if (!studentId) {
      const me = await request.get(`${STAGING_API}/auth/me`, { headers: auth(studentToken) });
      studentId = (await me.json()).id;
    }
  };

  test('flow 1a — admin + student sign in; admin mints a fresh code', async ({ request }) => {
    await ensureTokens(request);

    const me = await request.get(`${STAGING_API}/auth/me`, { headers: auth(studentToken) });
    expect(me.status()).toBe(200);

    const minted = await request.post(`${STAGING_API}/admin/access-codes/generate`, {
      headers: auth(adminToken),
      data: { count: 1, permissions: ['all'], notes: 'staging-e2e gate-a (auto)' },
    });
    expect(minted.status(), await minted.text()).toBe(200);
    const body = await minted.json();
    expect(body.created).toBe(1);
    code = body.codes[0];
  });

  test('flow 1b — student redeems the code; canonical ownership visible to admin', async ({ request }) => {
    await ensureTokens(request);
    const activate = await request.post(`${STAGING_API}/auth/activate`, {
      headers: auth(studentToken),
      data: { access_code: code },
    });
    expect(activate.status(), await activate.text()).toBe(200);
    expect((await activate.json()).success).toBe(true);

    const me = await request.get(`${STAGING_API}/auth/me`, { headers: auth(studentToken) });
    const meBody = await me.json();
    expect(meBody.is_active).toBe(true);
    expect(meBody.permissions).toContain('all');

    // Canonical ownership: the admin list shows the redemption.
    const list = await request.get(`${STAGING_API}/admin/access-codes`, { headers: auth(adminToken) });
    expect(list.status()).toBe(200);
    const row = (await list.json()).find((c) => c.code === code);
    expect(row, `minted code ${code} missing from admin list`).toBeTruthy();
    codeId = row.id;
    expect(row.is_used).toBe(true);
    expect(row.used_by).toBe(studentId);
    expect(row.association_lookup_failed).toBeFalsy();
    const assigned = row.assigned_users.find((u) => u.user_id === studentId);
    expect(assigned, 'active assignment row must exist').toBeTruthy();
    expect(assigned.removable).toBe(true);
  });

  test('flow 2 — practice session: create → questions → grade (fixture) → complete', async ({ request }) => {
    await ensureTokens(request);
    const created = await request.post(`${STAGING_API}/sessions`, {
      headers: auth(studentToken),
      data: { mode: 'practice', part: 1, topic: 'Work and career' },
    });
    expect(created.status(), await created.text()).toBe(200);
    sessionId = (await created.json()).session_id;

    const gen = await request.post(`${STAGING_API}/sessions/${sessionId}/questions/generate`, {
      headers: auth(studentToken), timeout: 30_000,
    });
    expect(gen.status(), await gen.text()).toBe(200);

    // Grade against PERSISTED questions only (a Gemini-fallback set may not
    // be stored — GET is the canonical truth).
    const qs = await request.get(`${STAGING_API}/sessions/${sessionId}/questions`, {
      headers: auth(studentToken),
    });
    expect(qs.status()).toBe(200);
    const questions = await qs.json();
    expect(questions.length, 'no persisted questions — check GEMINI_API_KEY/topic library on staging').toBeGreaterThan(0);

    const graded = await request.post(`${STAGING_API}/sessions/${sessionId}/responses`, {
      headers: auth(studentToken),
      multipart: {
        question_id: questions[0].id,
        audio_file: {
          name: 'e2e.webm',
          mimeType: 'audio/webm',
          // Content is irrelevant in fixture mode — STT never runs.
          buffer: Buffer.alloc(2048, 7),
        },
      },
      timeout: 40_000,
    });
    expect(graded.status(), await graded.text()).toBe(200);
    const result = await graded.json();

    // Fixture-payload pins — also a config-drift guard for staging.
    expect(result.transcript).toContain('learning English is really important');
    expect(result.overall_band).toBe(6);
    expect(result.pronunciation.pronunciation_score).toBe(78);
    // Practice post-processing persisted canonical recommendation rows.
    expect(Array.isArray(result.grammar_recommendations)).toBe(true);
    if (result.grammar_recommendations.length > 0) {
      expect(result.grammar_recommendations[0].rec_id, 'rec_id proves the DB row').toBeTruthy();
    }
    expect(result.partial, 'persistence must not be partial').toBeFalsy();

    const done = await request.patch(`${STAGING_API}/sessions/${sessionId}/complete`, {
      headers: auth(studentToken),
    });
    expect(done.status(), await done.text()).toBe(200);
    const finalState = await done.json();
    expect(finalState.status).toBe('completed');
    expect(finalState.overall_band).toBe(6);
  });

  test('flow 3 — remove user keeps redemption history immutable; then revoke', async ({ request }) => {
    await ensureTokens(request);
    const removed = await request.delete(
      `${STAGING_API}/admin/access-codes/${codeId}/users/${studentId}`,
      { headers: auth(adminToken) },
    );
    expect(removed.status(), await removed.text()).toBe(204);

    // CLAUDE.md invariant: is_used / used_by / used_at are IMMUTABLE after
    // activation — remove-user must not reset them.
    const detail = await request.get(`${STAGING_API}/admin/access-codes/${codeId}`, {
      headers: auth(adminToken),
    });
    expect(detail.status()).toBe(200);
    const d = await detail.json();
    expect(d.is_used).toBe(true);
    expect(d.used_by).toBe(studentId);
    expect(d.used_at).toBeTruthy();
    expect(d.association_lookup_failed).toBeFalsy();
    // No active assignment left — the detail synthesizes the read-only
    // legacy row (audit 2026-07-03 L5 semantics).
    const fallback = d.assignments.find((a) => a.user_id === studentId);
    expect(fallback).toBeTruthy();
    expect(fallback.is_active).toBe(false);
    expect(fallback.removable).toBe(false);

    const revoked = await request.delete(`${STAGING_API}/admin/access-codes/${codeId}`, {
      headers: auth(adminToken),
    });
    expect(revoked.status(), await revoked.text()).toBe(204);

    const after = await request.get(`${STAGING_API}/admin/access-codes/${codeId}`, {
      headers: auth(adminToken),
    });
    const a = await after.json();
    expect(a.is_revoked).toBe(true);
    expect(a.is_active).toBe(false);
  });
});
