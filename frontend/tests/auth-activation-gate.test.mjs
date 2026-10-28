// W-03 — client half of the activation gate (lib/auth/activation-gate.mjs) and
// its wiring: every fully signed-in AuthedShell layout passes `activationGate`,
// hybrid layouts (authGated=false) keep their public modes, and the provider
// probes the canonical /auth/check-active route. Rendered behaviour (redirect,
// fail-open, no flash) lives in tests/react/auth-activation-gate.test.tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTIVATION_EXEMPT_PREFIXES,
  activationDecision,
  isRememberedActive,
  rememberActive,
  requiresActivation,
} from '../lib/auth/activation-gate.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('learner and staff paths require activation; only /login does not', () => {
  for (const path of ['/home', '/onboarding', '/practice/session', '/writing/dashboard',
    '/listening', '/profile', '/my-class', '/administrator-notes', '/instructors-faq',
    // Q-13 — a staff role does not replace activation.
    '/admin', '/admin/users', '/instructor', '/instructor/grade', '/instructor/compare']) {
    assert.equal(requiresActivation(path), true, path);
  }
  for (const path of ['/login', '/login/']) {
    assert.equal(requiresActivation(path), false, path);
  }
  assert.equal(requiresActivation('/loginx'), true);
  assert.equal(requiresActivation(undefined), false);
  assert.deepEqual([...ACTIVATION_EXEMPT_PREFIXES], ['/login']);
});

test('only a well-formed 2xx answer decides; everything else fails open', () => {
  assert.equal(activationDecision(true, { is_active: true }), 'active');
  assert.equal(activationDecision(true, { is_active: false }), 'inactive');
  assert.equal(activationDecision(false, { is_active: false }), 'unknown');
  assert.equal(activationDecision(true, { is_active: 'false' }), 'unknown');
  assert.equal(activationDecision(true, null), 'unknown');
});

test('per-tab confirmation is keyed by account and survives storage errors', () => {
  const rows = new Map();
  const store = { getItem: (k) => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v) };
  assert.equal(isRememberedActive(store, 'A'), false);
  rememberActive(store, 'A');
  assert.equal(isRememberedActive(store, 'A'), true);
  assert.equal(isRememberedActive(store, 'B'), false);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => rememberActive(broken, 'A'));
  assert.equal(isRememberedActive(broken, 'A'), false);
  assert.equal(isRememberedActive(null, 'A'), false);
});

test('AuthedShell gates fully signed-in layouts and leaves hybrid layouts public', () => {
  const shell = read('components/authed-shell.tsx');
  assert.match(shell, /<AuthProvider activationGate=\{authGated\}>\{children\}<\/AuthProvider>/);
  const provider = read('lib/auth/auth-provider.tsx');
  assert.match(provider, /getCurrentActiveStatus\(\)/);
  assert.match(provider, /window\.location\.replace\('\/login'\)/);
  // /login itself never mounts the gated provider (no redirect loop).
  assert.doesNotMatch(read('app/(public-auth)/layout.tsx'), /AuthProvider|AuthedShell/);
});
