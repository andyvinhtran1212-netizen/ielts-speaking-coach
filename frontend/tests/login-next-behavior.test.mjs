import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(public-auth)', 'login', 'page.tsx');
const BEHAVIOR = read('app', '(public-auth)', 'login', 'login-behavior.tsx');
const LAYOUT = read('app', '(public-auth)', 'layout.tsx');
const CSS = read('public', 'css', 'login-next.css');
const LEGACY = read('public', 'login.html');
const PRACTICE = read('public', 'js', 'practice.js');
const EXAM_PLAYER = read('public', 'js', 'exam-player.js');
const PARITY = read('tooling', 'parity-diff.mjs');
const PARITY_CORE = read('tooling', 'parity-core.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/login native auth entry', () => {
  test('owns a public noindex route with the established login design language', () => {
    assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
    assert.match(PAGE, /<h1 className="lx-form-heading">Bắt đầu luyện tập<\/h1>/);
    assert.match(PAGE, /skills\.map/);
    assert.match(CSS, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(CSS, /@media \(max-width: 767px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test('keeps rollback parity and CI interaction evidence wired to the route', () => {
    assert.match(LEGACY, /<h1 class="lx-form-heading">Bắt đầu luyện tập<\/h1>/);
    assert.match(LEGACY, /<h2 class="lx-headline">/);
    assert.match(PARITY, /name: 'login'[\s\S]*legacy: '\/login\.html'[\s\S]*next: '\/login'/);
    assert.match(PARITY_CORE, /path === '\/login\.html'\) path = '\/login'/);
    assert.match(WORKFLOW, /frontend\/app\/\(public-auth\)\/\*\*/);
    assert.match(WORKFLOW, /Kiểm luồng Login\/Auth native[\s\S]*verify-login-flow\.mjs/);
  });

  test('keeps one shared Supabase client and the implicit callback contract', () => {
    assert.match(LAYOUT, /supabase-js@2\.107\.0\/dist\/umd\/supabase\.min\.js/);
    assert.match(LAYOUT, /\/js\/supabase-sdk-fallback\.js/);
    assert.match(LAYOUT, /initSupabase\(/);
    assert.match(BEHAVIOR, /const fragment = new URLSearchParams\(window\.location\.hash\.replace/);
    assert.match(BEHAVIOR, /'error_description'/);
    assert.match(BEHAVIOR, /query\.has\('code'\)/);
    assert.match(BEHAVIOR, /client\.auth\.getSession\(\)/);
    const guardedSessionRead = BEHAVIOR.indexOf('sessionRead = client.auth.getSession()');
    const callbackScrub = BEHAVIOR.indexOf("if (callback) window.history.replaceState(null, '', '/login')");
    const sessionAwait = BEHAVIOR.indexOf('await sessionRead');
    const callbackValidation = BEHAVIOR.indexOf('if (error || (callback && !session?.access_token))');
    assert.ok(guardedSessionRead > 0 && guardedSessionRead < callbackScrub && callbackScrub < sessionAwait && sessionAwait < callbackValidation,
      'Supabase starts reading the implicit fragment, then credentials are scrubbed before the read can settle');
    assert.ok(BEHAVIOR.lastIndexOf('finally', callbackScrub) < callbackScrub,
      'callback scrub is in a finally block so a synchronous session initialization failure cannot leak material');
    assert.doesNotMatch(BEHAVIOR, /exchangeCodeForSession|createClient\(/);
    assert.match(BEHAVIOR, /redirectTo: `\$\{window\.location\.origin\}\/login`/);
  });

  test('routes only from strict canonical /auth/me truth', () => {
    assert.match(BEHAVIOR, /fetch\(`\$\{window\.api\.base\}\/auth\/me`/);
    assert.match(BEHAVIOR, /normalizeLoginProfile\(payload\)/);
    assert.match(BEHAVIOR, /loginDestination\(profile\)/);
    assert.match(BEHAVIOR, /window\.location\.replace\(destination\)/);
    assert.doesNotMatch(BEHAVIOR, /data\.is_active|data\.onboarding_completed/);
  });

  test('reconciles canonical profile after every activation outcome', () => {
    const mutation = BEHAVIOR.indexOf("/auth/activate");
    const reconciliation = BEHAVIOR.indexOf('profile = await canonicalProfile(token)', mutation);
    assert.ok(mutation > 0 && reconciliation > mutation);
    assert.match(BEHAVIOR, /request may have committed while its ACK was lost/);
    assert.match(BEHAVIOR, /destination === 'activate'/);
    assert.match(BEHAVIOR, /activateInFlight\.current/);
    assert.match(BEHAVIOR, /if \(activateInFlight\.current\) return/);
    assert.match(BEHAVIOR, /disabled=\{activateBusy\}/);
    assert.match(BEHAVIOR, /keepLockedForRedirect = true/);
    assert.match(BEHAVIOR, /event\.key !== 'Tab'/);
    assert.match(BEHAVIOR, /document\.activeElement === first/);
  });

  test('all active player redirects enter the canonical login owner', () => {
    assert.match(PRACTICE, /window\.location\.href = '\/login'/);
    assert.doesNotMatch(PRACTICE, /window\.api\.url\('login\.html'\)/);
    assert.match(EXAM_PLAYER, /window\.location\.href = '\/login'/);
  });
});
