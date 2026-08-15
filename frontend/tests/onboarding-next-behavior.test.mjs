import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-onboarding)', 'onboarding', 'page.tsx');
const BEHAVIOR = read('app', '(authed-onboarding)', 'onboarding', 'onboarding-behavior.tsx');
const LAYOUT = read('app', '(authed-onboarding)', 'layout.tsx');
const MODEL = read('lib', 'onboarding-model.mjs');
const CSS = read('public', 'css', 'onboarding.css');
const LEGACY = read('public', 'onboarding.html');
const LOGIN_MODEL = read('lib', 'login-model.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/onboarding native account setup', () => {
  test('owns an authenticated noindex route with canonical student chrome', () => {
    assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
    assert.match(PAGE, /<aver-chrome active="home"/);
    assert.match(LAYOUT, /<AuthedShell/);
    assert.match(LAYOUT, /'\/css\/onboarding\.css'/);
  });

  test('fails closed from strict canonical profile truth', () => {
    assert.match(BEHAVIOR, /readCanonicalProfile\(account\)/);
    assert.match(BEHAVIOR, /profile\.id !== expectedAccount/);
    assert.match(BEHAVIOR, /readyAccount !== user\?\.id/);
    assert.match(BEHAVIOR, /onboardingDestination\(profile\)/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
    assert.match(MODEL, /typeof row\.is_active !== 'boolean'/);
    assert.match(MODEL, /typeof row\.onboarding_completed !== 'boolean'/);
  });

  test('uses native form semantics and accessible progress/failure states', () => {
    assert.match(BEHAVIOR, /type="radio" name="self-level"/);
    assert.match(BEHAVIOR, /type="radio" name="first-topic"/);
    assert.match(BEHAVIOR, /role="progressbar"/);
    assert.match(BEHAVIOR, /role="alert"/);
    assert.match(CSS, /\.opt-card:focus-within/);
    assert.match(CSS, /prefers-reduced-motion: reduce/);
  });

  test('reconciles canonical truth after every profile mutation outcome', () => {
    const mutation = BEHAVIOR.indexOf("window.api.patch('/auth/profile'");
    const reconciliation = BEHAVIOR.indexOf('profile = await readCanonicalProfile(account)', mutation);
    assert.ok(mutation > 0 && reconciliation > mutation);
    assert.match(BEHAVIOR, /mutationError/);
    assert.match(BEHAVIOR, /destination !== '\/home'/);
    assert.match(BEHAVIOR, /if \(submitRef\.current \|\| submitting/);
    assert.match(BEHAVIOR, /keepLockedForRedirect = true/);
    assert.match(BEHAVIOR, /first_topic=\$\{encodeURIComponent\(draft\.topic\)\}/);
  });

  test('cuts every active entry to /onboarding while preserving rollback HTML', () => {
    assert.match(LOGIN_MODEL, /return '\/onboarding'/);
    assert.match(LEGACY, /window\.location\.href = '\/login'/);
    assert.match(LEGACY, /typeof user\.is_active !== 'boolean'/);
    assert.doesNotMatch(LEGACY, /non-fatal — let user proceed/);
    assert.ok(LEGACY.indexOf("window.api.get('/auth/me')", LEGACY.indexOf("window.api.patch('/auth/profile'")) > 0);
    assert.match(WORKFLOW, /verify-onboarding-flow\.mjs/);
  });
});
