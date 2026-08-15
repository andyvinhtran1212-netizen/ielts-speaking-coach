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
let d1Reads = 0;
let d1WritePending = false;
let failNextD1Delete = false;
let lemmaReads = 0;
let lemmaWritePending = false;
let failNextLemmaCreate = false;
let d1Row = {
  id: '00000000-0000-4000-8000-000000000201',
  user_id: '00000000-0000-4000-8000-000000000202',
  vocabulary_id: '00000000-0000-4000-8000-000000000203',
  context_sentence: 'We need to <img onerror=alert(1)> the risk.',
  target_answer: 'mitigate',
  acceptable_variants: [],
  hint: 'reduce',
  source_evidence_substring: 'mitigate the risk',
  generated_by: 'fallback_evidence',
  generated_at: '2026-08-15T00:00:00Z',
  is_active: true,
  attempt_count: 0,
  last_used_at: null,
  created_at: '2026-08-15T00:00:00Z',
  headword: 'mitigate',
};
let lemmaRows = [{ id: '00000000-0000-4000-8000-000000000211', original_word: 'children<script>', lemma: 'child', pos_tag: 'NOUN', notes: 'irregular', created_at: '2026-08-15T00:00:00Z' }];
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
  const expectedD1 = ['PATCH', 'DELETE'].includes(method) && parsed.pathname === `/admin/vocab/d1-questions/${d1Row.id}`;
  const expectedLemma = (method === 'POST' && parsed.pathname === '/admin/vocab/lemmas/overrides')
    || (method === 'DELETE' && /^\/admin\/vocab\/lemmas\/overrides\/[0-9a-f-]+$/i.test(parsed.pathname));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !expectedFlag && !expectedD1 && !expectedLemma && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
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
  if (method === 'GET' && parsed.pathname === '/admin/vocab/d1-questions') {
    d1Reads += 1;
    const active = parsed.searchParams.get('active');
    const visible = active === 'true' ? d1Row.is_active : active === 'false' ? !d1Row.is_active : true;
    return json({ items: visible ? [d1Row] : [], total: visible ? 1 : 0, offset: Number(parsed.searchParams.get('offset') || 0), limit: Number(parsed.searchParams.get('limit') || 50) });
  }
  if (expectedD1 && method === 'PATCH') {
    d1WritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    d1Row = { ...d1Row, context_sentence: body?.context_sentence ?? d1Row.context_sentence, target_answer: body?.target_answer ?? d1Row.target_answer, hint: body?.hint ?? d1Row.hint, is_active: body?.is_active ?? d1Row.is_active };
    d1WritePending = false;
    return json({ ok: true, id: d1Row.id, updated_fields: Object.keys(body || {}) });
  }
  if (expectedD1 && method === 'DELETE') {
    d1WritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (failNextD1Delete) { failNextD1Delete = false; d1WritePending = false; return json({ detail: 'fixture archive rejected' }, 409); }
    d1Row = { ...d1Row, is_active: false };
    d1WritePending = false;
    return route.fulfill({ status: 204, body: '' });
  }
  if (method === 'GET' && parsed.pathname === '/admin/vocab/lemmas/overrides') {
    lemmaReads += 1;
    const search = (parsed.searchParams.get('search') || '').toLowerCase();
    const visible = lemmaRows.filter((row) => row.original_word.toLowerCase().startsWith(search));
    return json({ items: visible, total: visible.length, offset: Number(parsed.searchParams.get('offset') || 0), limit: Number(parsed.searchParams.get('limit') || 100) });
  }
  if (expectedLemma && method === 'POST') {
    lemmaWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (failNextLemmaCreate) { failNextLemmaCreate = false; lemmaWritePending = false; return json({ detail: 'fixture duplicate override' }, 409); }
    const item = { id: '00000000-0000-4000-8000-000000000212', original_word: body?.original_word, lemma: body?.lemma, pos_tag: body?.pos_tag, notes: body?.notes, created_at: '2026-08-15T01:00:00Z' };
    lemmaRows = [item, ...lemmaRows];
    lemmaWritePending = false;
    return json({ ok: true, item }, 201);
  }
  if (expectedLemma && method === 'DELETE') {
    lemmaWritePending = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const id = parsed.pathname.split('/').pop();
    lemmaRows = lemmaRows.filter((row) => row.id !== id);
    lemmaWritePending = false;
    return route.fulfill({ status: 204, body: '' });
  }
  return json({});
});

await page.goto(`${BASE}/admin/vocab`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Vocabulary workspace', exact: true }).waitFor();
check('hub qua backend-owned admin gate', requests.some((item) => item.path === '/auth/me'));
check('hub có đủ tám workspace và canonical links', await page.locator('a.avv-card').count() === 8
  && await page.getByRole('link', { name: /Xem phía học viên/ }).getAttribute('href') === '/vocabulary/hub'
  && await page.getByRole('link', { name: /D1 Curation/ }).getAttribute('href') === '/admin/vocab/d1-curation'
  && await page.getByRole('link', { name: /Lemma Overrides/ }).getAttribute('href') === '/admin/vocab/lemmas');
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

await page.goto(`${BASE}/admin/vocab/d1-curation`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'D1 Curation', exact: true }).waitFor();
await page.getByText('mitigate', { exact: true }).first().waitFor();
check('D1 đọc đúng canonical filter mặc định', requests.some((item) => item.path === '/admin/vocab/d1-questions' && item.search === '?active=true&offset=0&limit=50'));
check('D1 escape context độc hại', await page.getByText('We need to <img onerror=alert(1)> the risk.', { exact: true }).count() === 1 && await page.locator('.avv-console-shell img').count() === 0);
await page.getByLabel('User ID').fill('not-a-uuid');
await page.getByRole('button', { name: 'Tìm kiếm' }).click();
check('D1 chặn user UUID sai trước network', await page.getByText('User ID phải là UUID hợp lệ.', { exact: true }).count() === 1 && !requests.some((item) => item.search.includes('not-a-uuid')));
await page.getByRole('button', { name: 'Reset' }).click();
await page.getByText('mitigate', { exact: true }).first().waitFor();
await page.getByRole('button', { name: 'Sửa' }).click();
await page.getByLabel('Target answer').fill('reduce');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.waitForTimeout(40);
check('D1 khoá edit trong lúc chờ ACK', d1WritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
check('D1 khoá filter để readback không lệch URL', await page.getByLabel('Source').isDisabled() && await page.getByLabel('Trạng thái').isDisabled() && await page.getByRole('button', { name: 'Reset' }).isDisabled());
await page.getByText('Đã lưu và tải lại danh sách D1 chuẩn từ backend.', { exact: true }).waitFor();
check('D1 PATCH đúng body và canonical readback', requests.some((item) => item.method === 'PATCH' && item.path === `/admin/vocab/d1-questions/${d1Row.id}` && item.body?.context_sentence === 'We need to <img onerror=alert(1)> the risk.' && item.body?.target_answer === 'reduce' && item.body?.hint === 'reduce') && d1Reads >= 3);
await page.getByRole('button', { name: 'Archive' }).click();
const d1Dialog = page.getByRole('dialog', { name: 'Archive câu hỏi D1?' });
failNextD1Delete = true;
await d1Dialog.getByRole('button', { name: 'Archive', exact: true }).click();
await page.waitForTimeout(40);
check('D1 khoá archive trong lúc chờ backend', d1WritePending && await d1Dialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await d1Dialog.getByRole('alert').waitFor();
check('D1 hiện lỗi archive ngay trong dialog', await d1Dialog.getByRole('alert').getByText(/Không xác nhận được trạng thái archive/).count() === 1);
await d1Dialog.getByRole('button', { name: 'Archive', exact: true }).click();
await page.getByText('Đã archive và tải lại danh sách D1 chuẩn từ backend.', { exact: true }).waitFor();
check('D1 DELETE giữ soft-delete truth qua readback', requests.some((item) => item.method === 'DELETE' && item.path === `/admin/vocab/d1-questions/${d1Row.id}`) && d1Row.is_active === false && d1Reads >= 4);
check('D1 mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.goto(`${BASE}/admin/vocab/lemmas`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lemma Overrides', exact: true }).waitFor();
await page.getByText('children<script>', { exact: true }).waitFor();
check('Lemma đọc canonical list và escape dữ liệu', requests.some((item) => item.path === '/admin/vocab/lemmas/overrides' && item.search === '?offset=0&limit=100') && await page.locator('.avv-console-shell script').count() === 0);
await page.getByLabel('Tìm original word').fill('child');
await page.getByRole('button', { name: 'Tìm', exact: true }).click();
await page.waitForTimeout(80);
check('Lemma prefix search bền trong URL/request', new URL(page.url()).searchParams.get('search') === 'child' && requests.some((item) => item.path === '/admin/vocab/lemmas/overrides' && item.search === '?search=child&offset=0&limit=100'));
await page.getByRole('button', { name: '+ Thêm override', exact: true }).click();
const lemmaCreateDialog = page.getByRole('dialog', { name: 'Thêm lemma override' });
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
check('Lemma hiện validation ngay trong modal', await lemmaCreateDialog.getByRole('alert').getByText('Original word và lemma không được trống.', { exact: true }).count() === 1);
await lemmaCreateDialog.getByLabel('Original word', { exact: true }).fill('mice');
await lemmaCreateDialog.getByLabel('Lemma (canonical form)', { exact: true }).fill('mouse');
await lemmaCreateDialog.locator('select').selectOption('NOUN');
await lemmaCreateDialog.getByLabel('Notes (tuỳ chọn)', { exact: true }).fill('irregular plural');
failNextLemmaCreate = true;
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
await page.waitForTimeout(40);
check('Lemma khoá create trong lúc chờ ACK', lemmaWritePending && await page.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await lemmaCreateDialog.getByRole('alert').waitFor();
check('Lemma hiện lỗi backend ngay trong modal', await lemmaCreateDialog.getByRole('alert').getByText(/Không xác nhận được trạng thái override/).count() === 1);
await lemmaCreateDialog.getByRole('button', { name: 'Lưu override' }).click();
await page.getByText('Đã tạo override và tải lại danh sách chuẩn từ backend.', { exact: true }).waitFor();
check('Lemma POST đúng body và canonical readback', requests.some((item) => item.method === 'POST' && item.path === '/admin/vocab/lemmas/overrides' && item.body?.original_word === 'mice' && item.body?.lemma === 'mouse' && item.body?.pos_tag === 'NOUN' && item.body?.notes === 'irregular plural') && lemmaReads >= 3);
await page.getByRole('button', { name: 'Xoá', exact: true }).click();
const lemmaDialog = page.getByRole('dialog', { name: 'Xoá override?' });
await lemmaDialog.getByRole('button', { name: 'Xoá override' }).click();
await page.waitForTimeout(40);
check('Lemma khoá delete trong lúc chờ backend', lemmaWritePending && await lemmaDialog.getByRole('button', { name: 'Đang xác minh…' }).isDisabled());
await page.getByText('Đã xoá override và tải lại danh sách chuẩn từ backend.', { exact: true }).waitFor();
check('Lemma DELETE đúng id và canonical readback', requests.some((item) => item.method === 'DELETE' && item.path === '/admin/vocab/lemmas/overrides/00000000-0000-4000-8000-000000000211') && lemmaReads >= 4);
check('Lemma mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

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
