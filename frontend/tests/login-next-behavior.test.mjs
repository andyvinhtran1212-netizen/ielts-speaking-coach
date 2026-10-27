import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(public-auth)', 'login', 'page.tsx');
const BEHAVIOR = read('app', '(public-auth)', 'login', 'login-behavior.tsx');
const LAYOUT = read('app', '(public-auth)', 'layout.tsx');
const RUNTIME_BOUNDARY = read('components', 'supabase-runtime-boundary.tsx');
const BROWSER_CLIENT = read('lib', 'supabase-browser.ts');
const CSS = read('public', 'css', 'login-next.css');
const LEGACY = read('tests', 'fixtures', 'legacy-html-retired', 'login.html');
const PRACTICE = read('public', 'js', 'practice.js');
const EXAM_PLAYER = read('public', 'js', 'exam-player.js');
const WORKFLOW = read('..', '.github', 'workflows', 'next-native-browser.yml');

describe('/login native auth entry', () => {
  test('owns a public noindex route with the established login design language', () => {
    assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
    assert.match(PAGE, /<h1 className="lx-form-heading">Bắt đầu luyện tập<\/h1>/);
    assert.match(PAGE, /skills\.map/);
    assert.match(CSS, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    assert.match(CSS, /@media \(max-width: 767px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  });

  test('keeps the archived presentation baseline and native browser evidence wired', () => {
    assert.match(LEGACY, /<h1 class="lx-form-heading">Bắt đầu luyện tập<\/h1>/);
    assert.match(LEGACY, /<h2 class="lx-headline">/);
    assert.equal(canonicalNextRouteForLegacy('/login.html'), '/login');
    assert.match(WORKFLOW, /frontend\/app\/\(public-auth\)\/\*\*/);
    assert.match(WORKFLOW, /Kiểm luồng Login\/Auth native[\s\S]*verify-login-flow\.mjs/);
  });

  test('keeps one shared PKCE client and owns the code exchange on /login (F06)', () => {
    assert.match(LAYOUT, /<SupabaseRuntimeBoundary/);
    assert.doesNotMatch(LAYOUT, /\/vendor\/supabase\.js|supabase-sdk-fallback\.js/);
    assert.match(RUNTIME_BOUNDARY, /getBrowserSupabase\(supabaseUrl, supabaseAnonKey\)/);
    assert.match(RUNTIME_BOUNDARY, /init\(supabaseUrl, supabaseAnonKey\)/);
    assert.match(BROWSER_CLIENT, /flowType: 'pkce'/);
    assert.match(BROWSER_CLIENT, /detectSessionInUrl: false/);
    assert.match(BEHAVIOR, /const fragment = new URLSearchParams\(window\.location\.hash\.replace/);
    assert.match(BEHAVIOR, /'error_description'/);
    assert.match(BEHAVIOR, /query\.get\('code'\)/);
    // Implicit-flow fragments are recognised only to be rejected and scrubbed.
    assert.match(BEHAVIOR, /return \{ code: failed \|\| implicit \? null : code \}/);
    const read = BEHAVIOR.indexOf('const callback = readAuthCallback()');
    const scrub = BEHAVIOR.indexOf("if (callback) window.history.replaceState(null, '', '/login')");
    const client = BEHAVIOR.indexOf('const client = await sharedClient()', read);
    const exchange = BEHAVIOR.indexOf('client.auth.exchangeCodeForSession(callback.code)');
    const sessionRead = BEHAVIOR.indexOf('await client.auth.getSession()', read);
    assert.ok(read > 0 && read < scrub && scrub < client && client < exchange && exchange < sessionRead,
      'callback material is scrubbed before any await, then exchanged once; stored sessions are read only off-callback');
    assert.equal((BEHAVIOR.match(/exchangeCodeForSession\(/g) || []).length, 2, 'one type member + one call');
    assert.doesNotMatch(BEHAVIOR, /createClient\(|setSession\(/);
    assert.match(BEHAVIOR, /redirectTo: `\$\{window\.location\.origin\}\/login`/);
  });

  test('routes only from strict canonical /auth/me truth', () => {
    assert.match(BEHAVIOR, /fetch\(`\$\{window\.api\.base\}\/auth\/me`/);
    assert.match(BEHAVIOR, /normalizeLoginProfile\(payload(?: as AuthMeWire)?\)/);
    assert.match(BEHAVIOR, /loginDestination\(profile\)/);
    assert.match(BEHAVIOR, /window\.location\.replace\(destination\)/);
    assert.doesNotMatch(BEHAVIOR, /data\.is_active|data\.onboarding_completed/);
    assert.match(BEHAVIOR, /\.finally\(\(\) => \{[\s\S]*if \(bootPromise === pendingBoot\) bootPromise = null/);
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
