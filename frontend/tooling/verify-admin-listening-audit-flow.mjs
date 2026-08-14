import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000147';
const session = JSON.stringify({ access_token: 'admin-listening-audit-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-audit@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const errors = [];
const listOffsets = [];
const auditReads = new Map();
const types = ['full', 'mini', 'drill', 'practice'];
const testRow = (index) => ({
  id: `test-${String(index).padStart(3, '0')}`,
  test_id: `ILR-AUD-${String(index).padStart(3, '0')}`,
  title: index === 0 ? 'Hostile <script> title' : `Audit fixture ${index}`,
  status: 'published', test_type: types[index % types.length], exam_only: false,
  section_count: index % 4 + 1, audio_ready_count: index % 4 + 1,
  accent_profile: [], band_target: 7, created_at: '2026-08-14T00:00:00Z', updated_at: '2026-08-14T01:00:00Z',
});
const finding = (severity, index = 1) => ({ q_num: index, dimension: 'audio', severity, code: `${severity}_${index}`, message: `${severity} fixture`, resolved: false });
function auditPayload(index) {
  const errors = index === 0 ? 1 : 0;
  const warnings = index === 1 ? 2 : 0;
  const issues = [...Array.from({ length: errors }, (_, i) => finding('error', i + 1)), ...Array.from({ length: warnings }, (_, i) => finding('warning', errors + i + 1))];
  const savedIssues = index === 3 ? [finding('error')] : [];
  const saved = index === 3 ? { test_id: 'test-003', status: 'has_issues', issues: savedIssues, health: { error_count: 1, warning_count: 0, status: 'has_issues' }, audited_at: '2026-08-13T02:00:00Z', updated_at: '2026-08-13T02:00:00Z' } : null;
  const row = testRow(index);
  return { uuid: row.id, test_id: row.test_id, title: row.title, status: row.status, test_type: row.test_type,
    question_count: index % 4 === 0 ? 40 : 10, section_count: row.section_count, sections: [],
    live: { issues, health: { error_count: errors, warning_count: warnings, status: errors ? 'has_issues' : 'passed' } }, saved };
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-audit@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/tests' && method === 'GET') {
    const offset = Number(parsed.searchParams.get('offset') || 0); listOffsets.push(offset);
    const items = offset === 0 ? Array.from({ length: 100 }, (_, index) => testRow(index)) : offset === 100 ? [testRow(100)] : [];
    return json({ items, total: 101, limit: 100, offset });
  }
  const match = parsed.pathname.match(/^\/admin\/listening\/tests\/test-(\d{3})\/audit$/);
  if (match && method === 'GET') {
    const index = Number(match[1]);
    const count = (auditReads.get(index) || 0) + 1; auditReads.set(index, count);
    if (index === 2 && count === 1) return json({ detail: 'fixture lookup unavailable' }, 503);
    return json(auditPayload(index));
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/audit`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Audit chất lượng toàn bộ kho test' }).waitFor();
await page.getByText('Live scan hoàn tất', { exact: true }).waitFor({ timeout: 20_000 });
check('inventory phân trang đủ canonical total', listOffsets.length === 2 && listOffsets[0] === 0 && listOffsets[1] === 100, JSON.stringify(listOffsets));
check('scan có đúng một GET cho từng test ban đầu', auditReads.size === 101 && [...auditReads.values()].every((count) => count === 1));
check('lookup failure hiện riêng, không giả thành clean', await page.locator('.alqa-table').getByText('Lookup failed', { exact: true }).count() === 1 && await page.getByText(/1 test không đọc được audit/).count() === 1);
check('live error, warning và saved status tách riêng',
  await page.locator('tr[data-test-id="test-000"] td[data-label="Live structural"]').getByText('1 lỗi', { exact: true }).count() === 1
  && await page.locator('tr[data-test-id="test-001"] td[data-label="Live structural"]').getByText('2 cảnh báo', { exact: true }).count() === 1
  && await page.locator('tr[data-test-id="test-003"] td[data-label="Saved full audit"]').getByText('Có lỗi đã lưu', { exact: true }).count() === 1);
check('hostile title được React escape', await page.getByText('Hostile <script> title', { exact: true }).count() === 1 && await page.locator('script').filter({ hasText: 'Hostile' }).count() === 0);
check('detail vẫn dùng rollback hợp lệ trước batch kế tiếp', await page.locator('tr[data-test-id="test-000"] a').filter({ hasText: 'Mở audit detail' }).getAttribute('href') === '/pages/admin/listening/audit-detail.html?id=test-000');

await page.getByRole('combobox', { name: 'Live health' }).selectOption('lookup');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.waitForFunction(() => new URL(location.href).searchParams.get('health') === 'lookup');
check('health filter ghi vào URL và chỉ giữ lookup failure', await page.locator('.alqa-table tbody tr').count() === 1 && await page.locator('tr[data-test-id="test-002"]').count() === 1);
await page.getByRole('button', { name: 'Xóa lọc' }).click();
await page.waitForFunction(() => !new URL(location.href).searchParams.has('health'));

await page.getByRole('button', { name: 'Retry 1 lookup failed' }).click();
await page.getByText('Live scan hoàn tất', { exact: true }).waitFor();
await page.waitForFunction(() => document.querySelector('.alqa-summary>div:nth-child(4) strong')?.textContent === '0');
check('retry chỉ GET lại đúng hàng lỗi và khép lookup banner', auditReads.get(2) === 2 && [...auditReads.entries()].filter(([index, count]) => index !== 2 && count !== 1).length === 0 && await page.getByText(/test không đọc được audit/).count() === 0);

const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, cards: getComputedStyle(document.querySelector('.alqa-table thead')).position }));
check('mobile cards không tràn ngang', mobile.scroll <= mobile.width && mobile.cards === 'absolute', JSON.stringify(mobile));
check('CTA mobile đạt touch target', await page.locator('tr[data-test-id="test-000"] .alqa-actions a').first().evaluate((node) => getComputedStyle(node).minHeight === '44px'));

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop table trở lại và không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.alqa-table thead')).position !== 'absolute' && document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening audit flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
