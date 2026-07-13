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
  assert.match(BEHAVIOR, /api\.patch\('\/auth\/profile'/, 'mutation goes through the legacy endpoint');
  assert.match(BEHAVIOR, /savingRef\.current\) return/, 'double-submit lock (checklist)');
  assert.match(BEHAVIOR, /reconcile/, 'canonical reload after mutation (repo rule: refetch canonical state)');
  assert.match(BEHAVIOR, /err\.status === undefined/,
    'timeout-after-commit: statusless failure must reconcile via GET, never assume un-committed');
  assert.match(BEHAVIOR, /renderedForRef\.current === startedFor/,
    'account-switch guard: stale reconcile must never render over a newer user');
  const backend = readFileSync(path.join(FRONTEND, '..', 'backend', 'routers', 'auth.py'), 'utf8');
  assert.match(backend, /require_flag\("profile_update"\)/,
    'PATCH /auth/profile must sit behind the ADR-010 kill switch (first require_flag adoption)');
});

test('canonical /pages/profile.html vẫn thuộc legacy (public/ static, không app route)', () => {
  const cfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
  assert.ok(!cfg.includes("'/profile'"), 'no canonical /profile ownership before pilot-3 cutover');
});
