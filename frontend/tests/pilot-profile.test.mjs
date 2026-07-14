// Pilot 3 — authenticated read (dark launch tại /profile-preview).
// Pin kiến trúc ADR-003/ADR-011 + ranh giới read-only (mutation = pilot 4).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(FRONTEND, 'app', '(authed)', 'profile-preview');
const PROVIDER = readFileSync(path.join(FRONTEND, 'lib', 'auth', 'auth-provider.tsx'), 'utf8');
const LAYOUT = readFileSync(path.join(FRONTEND, 'app', '(authed)', 'layout.tsx'), 'utf8');
const PAGE = readFileSync(path.join(DIR, 'page.tsx'), 'utf8');
const SHELL = readFileSync(path.join(DIR, 'page-shell.tsx'), 'utf8');
const BEHAVIOR = readFileSync(path.join(DIR, 'profile-behavior.tsx'), 'utf8');

// `<body>` được nhắc tới trong comment (bài học review #741) — chỉ soi CODE.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('provider: client-only, bearer không đi qua RSC (ADR-003 §3)', () => {
  assert.match(PROVIDER, /^'use client';/, 'AuthProvider must be a Client Component');
  for (const src of [PROVIDER, LAYOUT, PAGE]) {
    assert.ok(!src.includes('next/headers'), 'auth must never read cookies/headers in RSC');
    assert.ok(!src.includes('cookies()'), 'auth must never read cookies/headers in RSC');
  }
  assert.ok(
    !PROVIDER.includes("from '@supabase/supabase-js'"),
    'coexistence: exactly ONE GoTrue client per page — consume window.getSupabase(), never bundle a second client',
  );
  assert.match(PROVIDER, /getSupabase/);
});

test('provider: ADR-011 state machine — fail-closed + legacy sign-out compat + bfcache', () => {
  for (const state of ["'initial-loading'", "'signed-in'", "'signed-out'"]) {
    assert.ok(PROVIDER.includes(state), `missing ADR-011 state: ${state}`);
  }
  assert.match(PROVIDER, /onAuthStateChange/, 'refresh success/failure must drive transitions');
  assert.match(PROVIDER, /av-chrome-signed-out/, 'ADR-011 §4: legacy chrome sign-out must be received');
  assert.match(PROVIDER, /pageshow/, 'ADR-011 §3: bfcache restoration must re-validate the session');
});

test('layout: legacy head parity + body classes pre-paint, không render <body>', () => {
  assert.ok(!stripComments(LAYOUT).includes('<body'), 'nested layout must not render <body> (root layout owns it)');
  assert.match(LAYOUT, /av-page font-sans min-h-screen/, 'exact legacy profile.html body classes');
  for (const asset of ['/css/profile.css', '/js/api.js', '/js/runtime-config.js', 'aver-chrome.js']) {
    assert.ok(LAYOUT.includes(asset), `missing legacy asset: ${asset}`);
  }
  assert.match(LAYOUT, /<AuthProvider>/, 'authed route group must mount the AuthProvider');
});

test('shell: skeleton legacy nguyên bản — các id mà profile.css/behavior nhắm tới', () => {
  for (const id of ['profile-avatar', 'profile-initials', 'profile-avatar-img',
                    'profile-display-name', 'profile-email', 'profile-joined',
                    'stat-sessions', 'stat-avg-band', 'stat-weekly',
                    'profile-form', 'inp-display-name', 'inp-email', 'band-btns',
                    'inp-exam-date', 'level-options', 'inp-weekly-goal',
                    'goal-display', 'btn-save', 'toast']) {
    assert.ok(SHELL.includes(`id="${id}"`), `missing legacy skeleton id: ${id}`);
  }
  assert.ok(!stripComments(SHELL).includes('<body'), 'shell must be a fragment (review #741 lesson)');
  assert.ok(!SHELL.includes("'use server'"));
});

test('behavior: read qua /auth/profile với fallback /auth/me (ADR-011)', () => {
  assert.match(BEHAVIOR, /^'use client';/);
  assert.match(BEHAVIOR, /'\/auth\/profile'/);
  assert.match(BEHAVIOR, /'\/auth\/me'/, 'legacy fallback path must survive');
  assert.match(BEHAVIOR, /location\.replace\('\/login\.html'\)/,
    'signed-out must leave via replace() so Back cannot restore private data (ADR-011 §3)');
  assert.match(BEHAVIOR, /\[status, user\?\.id\]/,
    'data effect must be keyed by user id — same-status account switch A→B must refetch (review #742)');
  assert.match(BEHAVIOR, /resetProfileDom\(\)/,
    'account switch must blank stale private data BEFORE the next fetch (ADR-011)');
});

test('pilot-4 mutation: double-submit lock + canonical reconcile + ambiguous-commit + kill-switch surface', () => {
  assert.match(BEHAVIOR, /api\.patchWith\('\/auth\/profile'/,
    'mutation goes through the legacy endpoint (patchWith — carries the abort signal, AUDIT F6)');
  assert.match(BEHAVIOR, /savingRef\.current\) return/, 'double-submit lock (checklist)');
  assert.match(BEHAVIOR, /reconcile/, 'canonical reload after mutation (repo rule: refetch canonical state)');
  assert.match(BEHAVIOR, /err\.status === undefined/,
    'timeout-after-commit: statusless failure must reconcile via GET, never assume un-committed');
  assert.match(BEHAVIOR, /renderedForRef\.current === startedFor/,
    'account-switch guard: stale reconcile must never render over a newer user');
  assert.match(BEHAVIOR, /if \(!renderedForRef\.current\) \{\n\s*showToast/,
    'not-loaded guard: saving before the canonical GET rendered would PATCH shell defaults (review #743)');
  const backend = readFileSync(path.join(FRONTEND, '..', 'backend', 'routers', 'auth.py'), 'utf8');
  assert.match(backend, /require_flag\("profile_update"\)/,
    'PATCH /auth/profile must sit behind the ADR-010 kill switch (first require_flag adoption)');
});

test('canonical /pages/profile.html vẫn thuộc legacy (public/ static, không app route)', () => {
  const cfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  assert.ok(!cfg.includes("'/profile'"), 'no canonical /profile ownership before pilot-3 cutover');
});

// ── AUDIT F6 (2026-07-14): ADR-011 §2 thực thi ĐÚNG như đã tuyên bố ────

test('AUDIT F6: logout/account-switch abort mọi in-flight request (ADR-011 §2)', () => {
  const API = readFileSync(path.join(FRONTEND, 'js', 'api.js'), 'utf8');
  assert.match(API, /signal: \(opts && opts\.signal\) \|\| undefined/,
    'api.js must plumb opts.signal into fetch — without it nothing is abortable');
  assert.match(BEHAVIOR, /new AbortController\(\)/);
  assert.match(BEHAVIOR, /inflightRef\.current\.forEach\(\(c\) => c\.abort\(\)\)/,
    'the in-flight set must be aborted as a whole');
  // The signed-out gate must abort BEFORE redirecting away.
  const gate = BEHAVIOR.indexOf("status === 'signed-out'");
  const abortIdx = BEHAVIOR.indexOf('.abort()', gate);
  const redirectIdx = BEHAVIOR.indexOf("replace('/login.html')", gate);
  assert.ok(gate !== -1 && abortIdx !== -1 && abortIdx < redirectIdx,
    'signed-out gate: abort in-flight requests BEFORE leaving the page');
  assert.match(BEHAVIOR, /AbortError'\) return/,
    'aborted calls must exit silently — no toasts/fallbacks after logout');
});

test('AUDIT F6: toast trung thực — success chỉ khi reconcile THÀNH CÔNG; ambiguous không nhận vơ "đã tải lại"', () => {
  assert.ok(!/reconcile\([^)]*\)\.catch\(\(\) => \{\}\)/.test(BEHAVIOR),
    'reconcile failures must never be swallowed — the toast text depends on the outcome');
  const successToast = BEHAVIOR.indexOf("showToast('✓ Đã lưu thành công')");
  const awaitedReconcile = BEHAVIOR.lastIndexOf('await reconcile(api);', successToast);
  assert.ok(successToast !== -1 && awaitedReconcile !== -1,
    'the unqualified success toast must come after an AWAITED (unswallowed) reconcile');
  assert.match(BEHAVIOR, /chưa tải lại được dữ liệu mới nhất/,
    'saved-but-reconcile-failed must say the screen may be stale');
  assert.match(BEHAVIOR, /KHÔNG xác nhận được/,
    'ambiguous-commit + reconcile-failed must admit nothing was confirmed (the old text claimed a reload that never happened)');
});

test('AUDIT F6: signOut kiểm tra {error} đã resolve (supabase v2 KHÔNG throw)', () => {
  assert.match(PROVIDER, /result\?\.error/,
    'signOut() resolves {error} — a bare await silently discards a failed revoke');
  assert.match(PROVIDER, /auth_signout_revoke_failed/,
    'revoke failures must be observable on the error dashboard');
});
