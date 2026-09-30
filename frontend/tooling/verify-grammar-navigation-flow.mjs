// Native Next Grammar navigation against synthetic, read-only SSR fixtures.
// Default: reuse the gate's existing Next and canonical fixture API, without
// starting or stopping either. --standalone explicitly owns bounded servers.
// Usage: node tooling/verify-grammar-navigation-flow.mjs http://localhost:3000
//        node tooling/verify-grammar-navigation-flow.mjs --standalone [base]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { noun, verb, related } from './grammar-navigation-fixtures.mjs';

const args = process.argv.slice(2);
const standalone = args.includes('--standalone');
const BASE = args.find((arg) => !arg.startsWith('--')) || (standalone ? 'http://127.0.0.1:3112' : `http://localhost:${process.env.TEST_PORT || '3000'}`);
const base = new URL(BASE);
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname), 'Local fixture base required');
const account = '00000000-0000-0000-0000-000000000715';
const SB = 'https://huwsmtubwulikhlmcirx.supabase.co'; // Existing public Grammar runtime identity; no real credentials.
const session = JSON.stringify({ access_token: 'grammar-navigation-synthetic', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: account, email: 'grammar-context@local' } });
const frontend = fileURLToPath(new URL('..', import.meta.url));
let fixtureOrigin = process.env.AVER_API_BASE || `http://127.0.0.1:${process.env.NEXT_NATIVE_FIXTURE_PORT || '3999'}`;
let fixture;
let next;
let nextOutput = '';
async function waitForChild(child, ready) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error('Standalone fixture server startup timed out')); }, 20000);
    const poll = setInterval(() => {
      if (child.exitCode != null) { clearTimeout(timer); clearInterval(poll); reject(new Error('Standalone fixture server exited during startup')); }
      else if (ready()) { clearTimeout(timer); clearInterval(poll); resolve(); }
    }, 100);
  });
}
let browser;
let checks = 0;
const check = (label, ok) => { assert.ok(ok, label); checks += 1; console.log(`✓ ${label}`); };
try {
  if (standalone) {
    let fixtureOutput = '';
    fixture = spawn(process.execPath, ['tooling/next-native-fixture-api.mjs'], { cwd: frontend, env: { ...process.env, NEXT_NATIVE_FIXTURE_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.stdout.on('data', (data) => { fixtureOutput += data; });
    fixture.stderr.on('data', (data) => { nextOutput += data; });
    await waitForChild(fixture, () => /listening on (http:\/\/127\.0\.0\.1:\d+)/.test(fixtureOutput));
    fixtureOrigin = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(fixtureOutput)[1];
    next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', base.hostname, '--port', base.port], {
      cwd: frontend, env: { ...process.env, AVER_API_BASE: fixtureOrigin, AVER_ENVIRONMENT: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    next.stdout.on('data', (data) => { nextOutput = (nextOutput + data).slice(-12000); });
    next.stderr.on('data', (data) => { nextOutput = (nextOutput + data).slice(-12000); });
    await waitForChild(next, () => nextOutput.includes('Ready in'));
  }
  const api = new URL(fixtureOrigin);
  assert.ok(api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname), 'A loopback canonical fixture API is required');
  const getFixtureHealth = async () => (await fetch(`${api.origin}/health`, { signal: AbortSignal.timeout(3000) })).json();
  const initialHealth = await getFixtureHealth();
  assert.ok(initialHealth.fixture === 'next-native-browser' && initialHealth.grammar_navigation_version === 1, 'Existing SSR fixture must support the Grammar journey');
  const originalGrammar = await (await fetch(`${api.origin}/api/grammar/article/tenses/present-simple`, { signal: AbortSignal.timeout(10000) })).json();
  check('The existing Present Simple SSR/loading fixture retains its canonical payload', originalGrammar.title === 'Present Simple' && originalGrammar.status === 'complete' && originalGrammar.reading_time === 4 && originalGrammar.toc[0].depth === 2 && originalGrammar.next_article === null);
  const originalVocabulary = await (await fetch(`${api.origin}/api/vocabulary/directory?limit=100`, { signal: AbortSignal.timeout(3000) })).json();
  check('The existing Vocabulary fixture inventory remains intact', originalVocabulary.total === 65 && originalVocabulary.items[0].slug === 'academic-growth' && originalVocabulary.categories.length === 2);
  try { browser = await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
    browser = await chromium.launch({ executablePath: chrome });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(15000);
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
  const errors = []; const unexpectedWrites = [];
  await context.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (req.url().startsWith(BASE) && url.pathname === '/js/runtime-config.js') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({ environment: 'test', apiBase: 'https://grammar-fixture.invalid', supabaseUrl: SB, supabaseAnonKey: 'synthetic-test-key' })});` });
    }
    if (req.url().startsWith(BASE) || ['about:', 'data:'].includes(url.protocol)) return route.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.continue();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && ![
      '/api/analytics/events', '/api/error-logs',
    ].includes(url.pathname) && !/^\/api\/grammar\/articles\/[^/]+\/view$/.test(url.pathname)) unexpectedWrites.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === '/auth/me') return json({ id: account, email: 'grammar-context@local', role: 'student' });
    if (url.pathname === '/api/grammar/dashboard-data') return json({ recently_viewed: [noun], saved_articles: [verb], weak_areas: [related] });
    if (url.pathname === '/api/me/roadmap') return json({ mode: 'personal', weak_count: 0, nodes: [noun] });
    if (url.pathname.endsWith('/exercise')) return json({ available: false });
    return json({});
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  const learning = () => page.getByRole('tab', { name: /Học & luyện/ });
  const reference = () => page.getByRole('tab', { name: /Tra cứu/ });
  const articlePath = '/grammar/parts-of-speech/ux-nouns?from=learning';
  const returnLink = () => page.getByRole('link', { name: '← Quay lại Học & luyện', exact: true });

  await page.goto(`${BASE}/grammar?mode=learning`);
  await page.getByRole('link', { name: 'Học tiếp →', exact: true }).waitFor();
  check('Deep-link learning mode and dashboard article origin are aligned', await learning().getAttribute('aria-selected') === 'true' && await page.getByRole('link', { name: 'Học tiếp →', exact: true }).getAttribute('href') === articlePath);
  await learning().focus(); await page.keyboard.press('Home');
  await reference().waitFor();
  await page.waitForFunction(() => document.getElementById('grammar-mode-reference')?.getAttribute('aria-selected') === 'true');
  check('Home selects reference and moves keyboard focus immediately', page.url() === `${BASE}/grammar` && await reference().evaluate((el) => el === document.activeElement));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('grammar-mode-learning')?.getAttribute('aria-selected') === 'true');
  check('ArrowRight selects learning through Next native-history subscription and focus', page.url() === `${BASE}/grammar?mode=learning` && await learning().evaluate((el) => el === document.activeElement));
  await page.getByRole('link', { name: 'Học tiếp →', exact: true }).click();
  await returnLink().waitFor();
  check('Article keeps the root breadcrumb and exposes a separate fixed learning return', await page.locator('#breadcrumb a').first().getAttribute('href') === '/grammar' && await returnLink().getAttribute('href') === '/grammar?mode=learning');
  check('Related, next-reading and next-article links carry learning source', await page.locator('#related-pages a').getAttribute('href') === '/grammar/parts-of-speech/ux-adjectives?from=learning' && await page.locator('#next-articles-list a').getAttribute('href') === '/grammar/parts-of-speech/ux-verbs?from=learning' && await page.locator('#prev-next a').getAttribute('href') === '/grammar/parts-of-speech/ux-verbs?from=learning');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('grammar-mode-learning')?.getAttribute('aria-selected') === 'true');
  check('Browser Back restores learning mode', page.url() === `${BASE}/grammar?mode=learning`);
  await page.goForward(); await returnLink().waitFor();
  check('Browser Forward restores article source', new URL(page.url()).searchParams.get('from') === 'learning');
  await page.reload(); await returnLink().waitFor();
  check('Article reload retains source without altering canonical metadata', await page.locator('link[rel="canonical"]').getAttribute('href') === `${BASE}/grammar/parts-of-speech/ux-nouns` || (await page.locator('link[rel="canonical"]').getAttribute('href'))?.endsWith('/grammar/parts-of-speech/ux-nouns'));
  await page.locator('#prev-next a').click(); await page.getByRole('heading', { name: 'Fixture Verbs', exact: true }).waitFor();
  check('Next article and its previous link retain the same reading workflow', await returnLink().count() === 1 && await page.locator('#prev-next a').getAttribute('href') === articlePath);
  await returnLink().click();
  await page.waitForFunction(() => document.getElementById('grammar-mode-learning')?.getAttribute('aria-selected') === 'true');
  check('Explicit return opens learning and reload keeps that selection', page.url() === `${BASE}/grammar?mode=learning`);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('grammar-mode-learning')?.getAttribute('aria-selected') === 'true');

  const second = await context.newPage();
  await second.goto(`${BASE}/grammar?mode=learning&mode=reference`);
  await second.waitForFunction(() => document.getElementById('grammar-mode-reference')?.getAttribute('aria-selected') === 'true');
  check('Duplicate mode falls back to reference in another independent tab', await learning().getAttribute('aria-selected') === 'true');
  await second.goto(`${BASE}/grammar/parts-of-speech/ux-nouns?from=learning&from=learning`);
  await second.getByRole('heading', { name: 'Fixture Nouns', exact: true }).waitFor();
  check('Duplicate origin cannot expose a return context or propagate to related links', await second.getByRole('link', { name: '← Quay lại Học & luyện', exact: true }).count() === 0 && await second.locator('#related-pages a').getAttribute('href') === '/grammar/parts-of-speech/ux-adjectives');
  await second.goto(`${BASE}/grammar/parts-of-speech/ux-nouns?from=https%3A%2F%2Fexample.invalid`);
  await second.getByRole('heading', { name: 'Fixture Nouns', exact: true }).waitFor();
  check('Invalid origin falls back to canonical lookup navigation', await second.getByRole('link', { name: '← Quay lại Học & luyện', exact: true }).count() === 0);
  await second.locator('#breadcrumb a').first().click();
  await second.waitForFunction(() => document.getElementById('grammar-mode-reference')?.getAttribute('aria-selected') === 'true');
  check('Independent root breadcrumb always opens reference overview', second.url() === `${BASE}/grammar`);
  await page.setViewportSize({ width: 390, height: 844 });
  check('Mobile learning mode has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const finalHealth = await getFixtureHealth();
  check('SSR data came from the canonical read-only fixture API', finalHealth.grammar_navigation_reads.includes('parts-of-speech/ux-nouns'));
  check('Navigation creates no check/save/submission/AI mutations', unexpectedWrites.length === 0);
  check('Native routes have no uncaught browser errors', errors.length === 0);
  console.log(`Grammar navigation flow: ${checks}/${checks} checks passed`);
} catch (error) {
  console.error(nextOutput.slice(-5000)); throw error;
} finally {
  if (browser) await browser.close();
  next?.kill('SIGTERM');
  fixture?.kill('SIGTERM');
}
