import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3050';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-fulltest-import-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'import@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const testId = 'ILR-LIS-FIXTURE';
const preview = (duplicate = false, mini = false, fullMismatch = false) => ({
  ok: true, duplicate_test_id: duplicate, errors: [], warnings: duplicate ? [`Test ID '${testId}' đang ACTIVE.`] : [],
  section_count: mini ? 1 : fullMismatch ? 3 : 4, question_count: mini ? 2 : fullMismatch ? 4 : 5,
  metadata: { test_id: testId, title: 'Fixture full test', format_version: 'listening-fulltest-v1.2', transcript_source: 'solution' },
  questions: [
    { q_num: 1, section: 'S1', prompt: 'Where will they meet?', options: [{ letter: 'A', text: 'Library' }, { letter: 'B', text: 'Station' }], answer: 'B', img_prompt: 'Draw a simple station map.' },
    { q_num: 2, section: 'S1', prompt: '', options: [], answer: '9:30', img_prompt: 'Draw a simple station map.' },
    ...(!mini ? [
      { q_num: 11, section: 'S2', prompt: 'Section two evidence', options: [], answer: 'C', img_prompt: '' },
      { q_num: 21, section: 'S3', prompt: 'Section three evidence', options: [], answer: 'D', img_prompt: '' },
      { q_num: 31, section: 'S4', prompt: 'Section four evidence', options: [], answer: 'E', img_prompt: '' },
    ].slice(0, fullMismatch ? 2 : 3) : []),
  ],
});
const detail = (id, status = 'draft', type = 'full', sectionCount = 4) => ({ id, test_id: testId, title: 'Fixture full test', status, test_type: type,
  sections: Array.from({ length: sectionCount }, (_, index) => ({ id: `${id}-s${index + 1}`, section_num: index + 1 })), plan_label_exercises: [] });

let scenario = 'happy';
let canonicalId = null;
let canonicalStatus = 'draft';
let commitRequests = 0;
let dryRuns = 0;
let listReads = 0;
let detailReads = 0;
const errors = [];
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await context.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'import@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/import-fulltest' && method === 'POST') { dryRuns += 1; return json(preview(scenario === 'duplicate', scenario === 'mini-mismatch', scenario === 'full-mismatch')); }
  if (parsed.pathname === '/admin/listening/import-fulltest/commit' && method === 'POST') {
    commitRequests += 1; canonicalId = scenario === 'ambiguous' ? 'test-ambiguous' : `test-${commitRequests}`; canonicalStatus = 'draft';
    if (scenario === 'paged') await new Promise((resolve) => setTimeout(resolve, 250));
    if (scenario === 'concurrent') await new Promise((resolve) => setTimeout(resolve, 400));
    if (scenario === 'ambiguous') return json({ detail: 'gateway timeout after commit' }, 503);
    return json({ id: canonicalId, test_id: testId, status: 'draft', sections_created: scenario === 'mini-mismatch' ? 1 : 4, exercises_created: 2,
      audio: { size_bytes: 3200, duration_seconds: 95 }, warnings: [] });
  }
  if (parsed.pathname === '/admin/listening/tests' && method === 'GET') {
    listReads += 1;
    const offset = Number(parsed.searchParams.get('offset') || 0);
    if (scenario === 'paged' && !canonicalId) {
      const all = Array.from({ length: 140 }, (_, index) => ({ id: `noise-${index}`, test_id: `${testId}-NOISE-${index}`, status: 'archived', test_type: 'full' }));
      return json({ items: all.slice(offset, offset + 100), total: all.length, limit: 100, offset });
    }
    const items = canonicalId ? [{ id: canonicalId, test_id: testId, status: canonicalStatus, test_type: scenario === 'mini-mismatch' ? 'mini' : 'full' }] : [];
    return json({ items, total: items.length, limit: 100, offset });
  }
  if (parsed.pathname.startsWith('/admin/listening/tests/') && parsed.pathname.endsWith('/status') && method === 'PATCH') {
    canonicalStatus = 'published'; return json({ id: canonicalId, status: canonicalStatus });
  }
  if (parsed.pathname.startsWith('/admin/listening/tests/') && method === 'GET') {
    detailReads += 1; return json(detail(parsed.pathname.split('/').at(-1), canonicalStatus,
      scenario === 'mini-mismatch' ? 'mini' : 'full', scenario === 'mini-mismatch' ? 2 : 4));
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

const pack = [
  { name: 'ILR_LIS_FIXTURE_Question_Paper.md', mimeType: 'text/markdown', buffer: Buffer.from('# Fixture') },
  { name: 'ILR_LIS_FIXTURE_Solution.md', mimeType: 'text/markdown', buffer: Buffer.from('# Solution') },
  { name: 'timings.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
  { name: 'full_test.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('fixture-audio') },
];
async function choosePack(target = page) {
  const inputs = target.locator('.alfi-file input[type=file]');
  for (let index = 0; index < pack.length; index += 1) await inputs.nth(index).setInputFiles(pack[index]);
}

await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Import một test, giữ trọn bằng chứng' }).waitFor();
check('route admin native mở đúng 3-step workflow', await page.locator('.alfi-steps li').count() === 3 && await page.locator('.alfi-file').count() === 4);
await page.waitForFunction(() => !document.querySelector('.alfi-file input')?.disabled);
const focusOutline = await page.locator('.alfi-file input').first().evaluate((input) => {
  input.focus(); return parseFloat(getComputedStyle(input.closest('.alfi-file')).outlineWidth);
});
check('file picker có focus ring nhìn thấy bằng bàn phím', focusOutline >= 2, String(focusOutline));
await choosePack();
const beforeFirstDryRun = dryRuns;
await page.getByRole('button', { name: 'Kiểm tra pack' }).evaluate((button) => { button.click(); button.click(); });
await page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor();
check('double dry-run chỉ gửi một request và hiển thị đủ gap-fill evidence', dryRuns === beforeFirstDryRun + 1
  && await page.getByText(testId, { exact: false }).count() > 0
  && await page.getByText('Đáp án B', { exact: false }).count() === 1
  && await page.getByText(/IMG-PROMPT · câu 1–2/).count() === 1);
await page.getByRole('button', { name: 'Ghi thành Draft' }).click();
await page.getByText('đã được backend xác nhận', { exact: false }).waitFor();
check('commit tạo receipt rồi chỉ thành công sau exact GET', commitRequests === 1 && listReads >= 1 && detailReads >= 1 && await page.getByText('draft', { exact: true }).count() > 0);
await page.getByRole('button', { name: 'Phát hành…' }).click();
await page.getByRole('heading', { name: `Phát hành ${testId}?` }).waitFor();
await page.getByRole('button', { name: 'Xác nhận phát hành' }).click();
await page.getByText(/Backend đã xác nhận Published/).waitFor();
check('publish qua dialog và canonical status readback', canonicalStatus === 'published' && await page.getByText('published', { exact: true }).count() > 0);

scenario = 'full-mismatch'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('button', { name: 'Kiểm tra pack' }).click();
await page.getByText(/Full test phải đúng 4 section/).waitFor();
check('Full test 3 section bị chặn trước POST', await page.getByRole('button', { name: 'Ghi thành Draft' }).isDisabled() && canonicalId === null);

scenario = 'paged'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('button', { name: 'Kiểm tra pack' }).click(); await page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor();
const beforePagedCommit = commitRequests; const beforePagedReads = listReads;
await page.getByRole('button', { name: 'Ghi thành Draft' }).evaluate((button) => { button.click(); button.click(); });
await page.getByRole('progressbar', { name: 'Tiến độ upload audio' }).waitFor();
const progressSemantics = await page.getByRole('progressbar', { name: 'Tiến độ upload audio' }).evaluate((node) => ({
  min: node.getAttribute('aria-valuemin'), max: node.getAttribute('aria-valuemax'), live: node.closest('[role="status"]') !== null,
}));
await page.getByText('đã được backend xác nhận', { exact: false }).waitFor();
check('preflight phân trang 140 row và double-click vẫn chỉ một POST', listReads >= beforePagedReads + 2 && commitRequests === beforePagedCommit + 1);
check('upload dùng progressbar hữu hạn, không spam live region', progressSemantics.min === '0' && progressSemantics.max === '100' && !progressSemantics.live);

scenario = 'duplicate'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('button', { name: 'Kiểm tra pack' }).click();
await page.getByText('Không archive trong lúc upload', { exact: true }).waitFor();
check('duplicate khóa commit và dẫn sang Kho test có exact search', await page.getByRole('button', { name: 'Ghi thành Draft' }).isDisabled()
  && (await page.getByRole('link', { name: `Xử lý ${testId}` }).getAttribute('href'))?.includes(encodeURIComponent(testId)));

scenario = 'ambiguous'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('button', { name: 'Kiểm tra pack' }).click(); await page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Ghi thành Draft' }).click();
await page.getByRole('heading', { name: `Lượt import ${testId} cần đối chiếu` }).waitFor();
const beforeReconcile = commitRequests;
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText(/Không gửi lại POST/).waitFor();
check('503 sau commit reconcile bằng list + detail GET, không phát lại POST', commitRequests === beforeReconcile && canonicalId === 'test-ambiguous');

scenario = 'mini-mismatch'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('checkbox', { name: /Pack này là Mini test/ }).check();
await page.getByRole('button', { name: 'Kiểm tra pack' }).click(); await page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Ghi thành Draft' }).click();
await page.getByText(/POST đã nhận, nhưng chưa đọc lại được/).waitFor();
check('canonical GET từ chối Mini có nhiều hơn một section', await page.getByRole('heading', { name: `Lượt import ${testId} cần đối chiếu` }).count() === 1
  && await page.getByText('đã được backend xác nhận', { exact: false }).count() === 0);
await page.getByRole('button', { name: 'Bỏ receipt…' }).click();
await page.getByRole('button', { name: 'Tôi đã kiểm tra, bỏ receipt' }).click();

scenario = 'concurrent'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
const secondPage = await context.newPage();
secondPage.on('pageerror', (error) => errors.push(String(error)));
await secondPage.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await Promise.all([choosePack(page), choosePack(secondPage)]);
await Promise.all([
  page.getByRole('button', { name: 'Kiểm tra pack' }).click(),
  secondPage.getByRole('button', { name: 'Kiểm tra pack' }).click(),
]);
await Promise.all([
  page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor(),
  secondPage.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor(),
]);
const beforeConcurrent = commitRequests;
await Promise.all([
  page.getByRole('button', { name: 'Ghi thành Draft' }).click(),
  secondPage.getByRole('button', { name: 'Ghi thành Draft' }).click(),
]);
await Promise.race([
  page.getByText('đã được backend xác nhận', { exact: false }).waitFor(),
  secondPage.getByText('đã được backend xác nhận', { exact: false }).waitFor(),
]);
await page.waitForTimeout(450);
const lockErrors = await page.getByText(/tab khác đang import|tab khác đang giữ lượt import/i).count()
  + await secondPage.getByText(/tab khác đang import|tab khác đang giữ lượt import/i).count();
check('hai tab mở sẵn chỉ một tab được POST và receipt còn đúng chủ', commitRequests === beforeConcurrent + 1 && lockErrors >= 1, `${commitRequests - beforeConcurrent} POST · ${lockErrors} lock notice`);
await secondPage.close();

scenario = 'happy'; canonicalId = null; canonicalStatus = 'draft';
await page.goto(`${BASE}/admin/listening/import-fulltest`, { waitUntil: 'domcontentloaded' });
await choosePack(); await page.getByRole('button', { name: 'Kiểm tra pack' }).click(); await page.getByText('Parser đã đọc trọn pack', { exact: true }).waitFor();
await page.evaluate(() => {
  const native = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('alfi-pending:')) throw new DOMException('storage blocked', 'QuotaExceededError');
    return native.call(this, key, value);
  };
});
const beforeStorageFailure = commitRequests;
await page.getByRole('button', { name: 'Ghi thành Draft' }).click();
await page.getByText(/Không thể tạo biên nhận an toàn/).waitFor();
check('localStorage lỗi chặn trước POST', commitRequests === beforeStorageFailure);

const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
  actionHeight: parseFloat(getComputedStyle(document.querySelector('.alfi-action-card .adm-btn-primary')).minHeight) }));
check('mobile không tràn ngang và CTA đạt touch target', mobile.scroll <= mobile.width && mobile.actionHeight >= 44, JSON.stringify(mobile));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop có main evidence + sticky operations rail', await page.evaluate(() => getComputedStyle(document.querySelector('.alfi-workspace')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening full-test import flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
