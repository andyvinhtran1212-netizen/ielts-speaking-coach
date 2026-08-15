// Fixture-backed browser contract for native Admin Vocabulary hub + stats.
// Production data is never read. The sole allowed business write is asserted
// by method, path, body, lock and canonical readback.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-4000-8000-000000000115';
const learnerId = '10000000-0000-4000-8000-000000000115';
const fakeSession = JSON.stringify({ access_token: 'admin-vocab-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-vocab@local' } });
const results = [];
const requests = [];
const unexpectedWrites = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

let vocabRead = 0;
let flagPending = false;
let flagApplied = false;
let holdNextVocab = false;
let heldVocabStarted = false;
let releaseHeldVocab;
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const body = request.postDataJSON?.() ?? null;
  requests.push({ method, path: parsed.pathname, search: parsed.search, body });
  const expectedFlag = method === 'POST' && parsed.pathname === `/admin/users/${learnerId}/vocab-flag`;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !expectedFlag && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-vocab@local', role: 'admin' });
  if (parsed.pathname === '/admin/vocab/stats') {
    vocabRead += 1;
    if (holdNextVocab) {
      holdNextVocab = false;
      heldVocabStarted = true;
      await new Promise((resolve) => { releaseHeldVocab = resolve; });
      return json({ vocab_bank_total: 42, fp_reports_total: 3, fp_rate_percent: 7.1, users_with_vocab_enabled: 7 });
    }
    return json({ vocab_bank_total: 42, fp_reports_total: 3, fp_rate_percent: 7.1, users_with_vocab_enabled: flagApplied ? 8 : 7 });
  }
  if (parsed.pathname === '/admin/flashcards/stats') return json({
    stats: {
      activity: { total_manual_stacks: 5, total_cards_in_manual_stacks: 42, total_active_users: 2, total_reviews_all_time: 20 },
      srs_health: { rating_distribution_percent: { again: 10, hard: 20, good: 50, easy: 20 }, rating_total_count: 10, avg_ease_factor: 2.4, cards_mastered_30plus_days: 8, cards_with_lapses: 3 },
      engagement: { avg_reviews_per_user_last_7_days: 4.5, avg_dau_last_30_days: 2.2, top_reviewed_words: [{ headword: 'mitigate<script>', review_count: 9 }] },
      timeseries: [{ date: '2026-08-15', reviews: 3 }],
    }, period_days: Number(parsed.searchParams.get('days')), computed_at: '2026-08-15T12:00:00Z',
  });
  if (expectedFlag) {
    flagPending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    flagApplied = true;
    flagPending = false;
    return json({ ok: true, message: 'Vocab bank enabled.' });
  }
  return json({});
});

await page.goto(`${BASE}/admin/vocab`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocabulary workspace', exact: true }).waitFor();
check('hub qua backend-owned admin gate', requests.some((item) => item.path === '/auth/me'));
check('hub có đủ tám workspace và learner preview', await page.locator('a.avv-card').count() === 8 && await page.getByRole('link', { name: /Xem phía học viên/ }).getAttribute('href') === '/vocabulary/hub');
check('mobile hub một cột, không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.avv-grid')).gridTemplateColumns.split(' ').length === 1 && document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/stats?days=7`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocab + Flashcards Stats', exact: true }).waitFor();
await page.getByText('42', { exact: true }).first().waitFor();
check('đọc hai canonical aggregate contract', requests.some((item) => item.path === '/admin/vocab/stats') && requests.some((item) => item.path === '/admin/flashcards/stats' && item.search === '?days=7'));
check('render key backend thật, không dùng field legacy stale', await page.getByText('Manual stacks', { exact: true }).count() === 1 && await page.getByText('Lifetime reviews', { exact: true }).count() === 1 && await page.getByText('20', { exact: true }).count() >= 1);
check('React escape dữ liệu headword độc hại', await page.getByText('mitigate<script>', { exact: true }).count() === 1 && await page.locator('.avv-stats-shell script, .avv-stats-shell img').count() === 0);
await page.getByLabel('Khoảng thời gian').selectOption('90');
await page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/flashcards/stats' && new URL(response.url()).search === '?days=90').catch(() => null);
check('period bền trong URL và canonical request', new URL(page.url()).searchParams.get('days') === '90' && requests.some((item) => item.path === '/admin/flashcards/stats' && item.search === '?days=90'));

await page.getByLabel('User ID').fill('not-a-uuid');
await page.getByRole('button', { name: 'Bật Vocab' }).click();
check('UUID sai bị chặn trước network', await page.getByText('User ID phải là UUID hợp lệ.', { exact: true }).count() === 1 && !requests.some((item) => item.path.includes('not-a-uuid')));
await page.getByLabel('User ID').fill(learnerId);
holdNextVocab = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.waitForTimeout(40);
check('refresh cũ đang được giữ để kiểm freshness', heldVocabStarted);
await page.getByRole('button', { name: 'Bật Vocab' }).click();
await page.waitForTimeout(40);
check('mutation bị khoá trong lúc chờ ACK', flagPending && await page.getByRole('button', { name: 'Bật Vocab' }).isDisabled() && await page.getByRole('button', { name: 'Tắt Vocab' }).isDisabled());
await page.getByText('Vocab bank enabled.', { exact: true }).waitFor();
check('mutation đúng path/body và đọc lại canonical Vocab stats', requests.some((item) => item.method === 'POST' && item.path === `/admin/users/${learnerId}/vocab-flag` && item.body?.enabled === true) && vocabRead >= 2);
releaseHeldVocab?.();
await page.waitForTimeout(100);
check('refresh cũ không ghi đè canonical flag readback', await page.getByText('8', { exact: true }).count() >= 1);
check('stats mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/admin/vocab`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocabulary workspace', exact: true }).waitFor();
check('desktop hub dùng hai cột', await page.evaluate(() => getComputedStyle(document.querySelector('.avv-grid')).gridTemplateColumns.split(' ').length === 2));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Vocabulary native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
