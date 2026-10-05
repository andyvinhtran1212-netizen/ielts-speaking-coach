// Native Next context round trips against intercepted read-only fixtures.
// No real backend request or learner mutation is allowed by this runner.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const base = new URL(BASE);
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname), 'Local fixture base required');
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const accountId = '00000000-0000-0000-0000-000000000030';
const session = JSON.stringify({ access_token: 'context-fixture-not-real', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: accountId, email: 'context@local' } });
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const reads = [];
const writes = [];
const errors = [];
let completedLesson = false;
let checks = 0;
const check = (label, ok) => { assert.ok(ok, label); checks += 1; console.log(`✓ ${label}`); };
const readingRows = Array.from({ length: 52 }, (_, index) => ({ id: `reading-${index}`, slug: `tea-${index}`, title: `Tea ${index}`, excerpt: 'A passage about food and tea.', difficulty_level: 'foundation', topic_tags: ['food'], word_count: 300, estimated_minutes: 5 }));


await context.route('**/*', async (route) => {
  const req = route.request(); const url = new URL(req.url());
  // Match this runner's synthetic auth storage and use a CSP-permitted HTTPS
  // origin. The untouched generated config may be deliberately unconfigured.
  if (url.origin === base.origin && url.pathname === '/js/runtime-config.js') {
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({ environment: 'test', apiBase: 'https://learning-context-fixture.invalid', supabaseUrl: SB, supabaseAnonKey: 'synthetic-test-key' })});` });
  }
  if (req.url().startsWith(BASE) || ['data:', 'about:'].includes(url.protocol)) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(req.url())) return route.continue();
  const method = req.method(); const path = url.pathname;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !['/api/analytics/events', '/api/error-logs'].includes(path)) writes.push(`${method} ${path}`);
  reads.push(`${method} ${path}${url.search}`);
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/auth/me') return json({ id: accountId, email: 'context@local', role: 'student' });
  if (path === '/api/reading/vocab') {
    const offset = Number(url.searchParams.get('offset') || 0);
    return json({ total: readingRows.length, items: readingRows.slice(offset, offset + 24) });
  }
  if (path.startsWith('/api/reading/vocab/')) {
    const slug = path.split('/').at(-1);
    return json({ id: slug, slug, title: 'Tea article', body_markdown: 'A readable tea article.', questions: [], glossary: [], topic_tags: ['food'] });
  }
  if (path.includes('/programmes/') && path.endsWith('/lessons')) return json({ items: Array.from({ length: 8 }, (_, index) => ({ id: `lesson-${index}`, title: `Listening ${index}`, sequence_num: index + 1, form_count: 1, completed_form_count: index === 0 && completedLesson ? 1 : 0, independent_completed_form_count: 0, in_progress_form_count: 0 })) });
  if (path.startsWith('/api/listening/lessons/')) return json({ programme_id: 'general-listening-practice', title: 'Listening lesson', instructions: 'Choose a form.', forms: [] });
  return json({});
});

const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
try {
  await page.goto(`${BASE}/reading/vocab?difficulty=foundation&tag=food&batches=2`);
  await page.locator('.rv-card').nth(47).waitFor();
  check('Reading deep-link restores both batches, not only the last offset', await page.locator('.rv-card').count() === 48);
  check('Reading filter controls match its URL', await page.locator('#filter-difficulty').inputValue() === 'foundation' && await page.locator('#filter-tag').inputValue() === 'food');
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.locator('.rv-card').nth(8).scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => window.scrollY);
  await page.locator('.rv-card').nth(8).click();
  await page.getByRole('heading', { name: 'Tea article', exact: true }).waitFor();
  await page.goBack(); await page.locator('.rv-card').nth(47).waitFor();
  await page.waitForFunction((saved) => Math.abs(window.scrollY - saved) < 10, top);
  check('Reading Back keeps batches and the original scroll', await page.locator('.rv-card').count() === 48);
  await page.goForward(); await page.getByRole('heading', { name: 'Tea article', exact: true }).waitFor();
  await page.getByRole('link', { name: /Thư viện Vocab Reading/ }).click();
  await page.locator('.rv-card').nth(47).waitFor();
  check('Reading explicit return preserves the same canonical filters', new URL(page.url()).searchParams.get('tag') === 'food');
  await page.reload(); await page.locator('.rv-card').nth(47).waitFor();
  await page.getByRole('button', { name: /Xem thêm/ }).click();
  await page.locator('.rv-card').nth(51).waitFor();
  check('Load more extends all earlier batches and writes the extent to the URL', await page.locator('.rv-card').count() === 52 && new URL(page.url()).searchParams.get('batches') === '3');
  await page.locator('#clear-filters').click();
  await page.waitForURL(`${BASE}/reading/vocab`);
  check('Clear filters resets the accumulated extent explicitly', await page.locator('#filter-difficulty').inputValue() === '' && await page.locator('#filter-tag').inputValue() === '');

  // Two change events in the same turn must merge against the committed URL,
  // rather than a stale render's other filter.
  await page.evaluate(() => {
    const difficulty = document.querySelector('#filter-difficulty');
    const tag = document.querySelector('#filter-tag');
    difficulty.value = 'foundation'; difficulty.dispatchEvent(new Event('change', { bubbles: true }));
    tag.value = 'food'; tag.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForURL((url) => url.searchParams.get('difficulty') === 'foundation' && url.searchParams.get('tag') === 'food');
  check('Rapid changes merge both Reading filters without stale overwrite', new URL(page.url()).searchParams.get('batches') === null);
  await page.locator('#clear-filters').click();
  await page.waitForURL(`${BASE}/reading/vocab`);

  const second = await context.newPage();
  await second.goto(`${BASE}/reading/vocab?difficulty=advanced&tag=science`);
  await second.locator('.rv-card').first().waitFor();
  check('Another tab has its own filter URL without overwriting this tab', await second.locator('#filter-difficulty').inputValue() === 'advanced' && await page.locator('#filter-difficulty').inputValue() === '');
  await second.close();

  await page.goto(`${BASE}/listening/general?filter=new`);
  await page.locator('.listening-lesson-card').nth(7).waitFor();
  await page.locator('.listening-lesson-card').first().click();
  await page.getByRole('heading', { name: 'Listening lesson', exact: true }).waitFor();
  completedLesson = true;
  await page.getByRole('link', { name: /Thư viện chương trình/ }).click();
  await page.locator('.listening-lesson-card').nth(6).waitFor();
  check('Listening return keeps New while reflecting newly completed backend progress', await page.getByRole('button', { name: 'Chưa bắt đầu', exact: true }).getAttribute('aria-pressed') === 'true' && await page.locator('.listening-lesson-card').count() === 7);
  await page.reload(); await page.locator('.listening-lesson-card').nth(6).waitFor();
  check('Listening reload keeps the filter', new URL(page.url()).searchParams.get('filter') === 'new');

  check('Context restoration never creates attempts, checks answers or calls AI', writes.length === 0);
  check('Native routes have no uncaught browser errors', errors.length === 0);
  console.log(JSON.stringify({ canonicalReads: reads.filter((read) => /^GET \/api\/(reading|listening)\//.test(read)), businessWrites: writes }, null, 2));
  console.log(`Learning context flow: ${checks}/${checks} checks passed`);
} finally { await browser.close(); }
