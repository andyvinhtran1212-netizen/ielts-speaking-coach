import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3050';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000321';
const session = JSON.stringify({ access_token: 'admin-drill-import-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'drills@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const T1 = 'ILR-LIS-DRL-MCQ-L2-T1';
const T2 = 'ILR-LIS-DRL-NOTE-L2-T1';
const T3 = 'ILR-LIS-DRL-MAP-L2-T1';
const T4 = 'ILR-LIS-DRL-SAQ-L2-T1';
const T5 = 'ILR-LIS-DRL-FORM-L2-T1';
const T6 = 'ILR-LIS-DRL-SENT-L2-T1';
const typeOf = (testId) => testId.includes('NOTE') ? 'note' : testId.includes('MAP') ? 'map' : testId.includes('SAQ') ? 'short_answer' : testId.includes('FORM') ? 'form' : testId.includes('SENT') ? 'sentence' : 'mcq';
const levelOf = () => 'L2';
const canonicalRows = new Map();
let dryRuns = 0;
let commitRequests = 0;
let listReads = 0;
let detailReads = 0;
let scenario = 'ambiguous-second';
const errors = [];

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));

function requestTestId(request) {
  const body = request.postDataBuffer()?.toString('utf8') || '';
  return [T1, T2, T3, T4, T5, T6].find((testId) => body.includes(testId)) || '';
}

function detail(row) {
  return {
    id: row.id, test_id: row.testId, title: `${row.testId} fixture`, status: 'draft', test_type: 'drill',
    metadata: { drill_type: row.drillType, level: row.level },
    full_audio_storage_path: row.hasAudio ? `drills/${row.id}/full.mp3` : null,
    full_audio_duration_seconds: row.hasAudio ? 84 : null,
    full_audio_size_bytes: row.hasAudio ? 4096 : null,
    sections: [{ id: `${row.id}-section`, section_num: 2, exercise_count: 2, audio_ready: false }],
    plan_label_exercises: [],
  };
}

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'drills@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/drills/import' && method === 'POST') {
    dryRuns += 1;
    const testId = requestTestId(request);
    const hasTimings = (request.postDataBuffer()?.toString('utf8') || '').includes('timings.json');
    return json({ ok: true, duplicate_test_id: testId === T3, test_id: testId, title: `${testId} fixture`,
      drill_type: typeOf(testId), level: levelOf(testId), task: '1', question_count: 5, has_audio: testId === T6 ? false : hasTimings,
      errors: [], warnings: testId === T3 ? ['Test ID đang ACTIVE.'] : hasTimings ? [] : ['Chưa có audio cho drill này.'] });
  }
  if (parsed.pathname === '/admin/listening/tests' && method === 'GET') {
    listReads += 1;
    const search = parsed.searchParams.get('search') || '';
    const rows = Array.from(canonicalRows.values()).filter((row) => row.testId === search)
      .map((row) => ({ id: row.id, test_id: row.testId, status: 'draft', test_type: 'drill' }));
    return json({ items: rows, total: rows.length, limit: 100, offset: Number(parsed.searchParams.get('offset') || 0) });
  }
  if (parsed.pathname === '/admin/listening/drills/import/commit' && method === 'POST') {
    commitRequests += 1;
    const testId = requestTestId(request);
    const hasAudio = (request.postDataBuffer()?.toString('utf8') || '').includes('full.mp3');
    const row = { id: `fixture-${testId.toLocaleLowerCase('en')}`, testId, drillType: typeOf(testId), level: levelOf(testId), hasAudio };
    canonicalRows.set(row.id, row);
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (scenario === 'ambiguous-second' && testId === T2) return json({ detail: 'gateway timeout after commit' }, 503);
    return json({ id: row.id, test_id: testId, status: 'draft', drill_type: row.drillType, level: row.level,
      has_audio: hasAudio, exercises_created: 2, warnings: [] });
  }
  if (parsed.pathname.startsWith('/admin/listening/tests/') && method === 'GET') {
    detailReads += 1;
    const row = canonicalRows.get(parsed.pathname.split('/').at(-1));
    return row ? json(detail(row)) : json({ detail: 'missing fixture' }, 404);
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

const bytes = (value) => Array.from(new TextEncoder().encode(value));
async function chooseDirectory(items) {
  await page.locator('.aldi-picker input[webkitdirectory]').evaluate((input, payload) => {
    const transfer = new DataTransfer();
    for (const item of payload) {
      const file = new File([new Uint8Array(item.buffer)], item.name, { type: item.type });
      Object.defineProperty(file, 'webkitRelativePath', { value: item.path });
      transfer.items.add(file);
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, items);
}

const source = (testId) => ({ name: `${testId}.json`, path: `11_Skill_Drills_Web/Source_JSON/${testId}.json`, type: 'application/json', buffer: bytes(JSON.stringify({ test_id: testId })) });
const timings = (testId) => ({ name: 'timings.json', path: `11_Skill_Drills_Web/audio_output/${testId}/timings.json`, type: 'application/json', buffer: bytes(JSON.stringify({ full_test: { duration: 84 } })) });
const audio = (testId) => ({ name: 'full_test.mp3', path: `11_Skill_Drills_Web/audio_output/${testId}/full_test.mp3`, type: 'audio/mpeg', buffer: bytes(`fixture-audio-${testId}`) });

await page.goto(`${BASE}/admin/listening/import-drills`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Mỗi drill đúng file, đúng bằng chứng' }).waitFor();
check('route native mở đúng workflow bốn bước', await page.locator('.aldi-steps li').count() === 4 && await page.locator('.aldi-picker').count() === 2);
await page.waitForFunction(() => !document.querySelector('.aldi-picker input')?.disabled);
const focusOutline = await page.locator('.aldi-picker input').first().evaluate((input) => { input.focus(); return parseFloat(getComputedStyle(input.closest('.aldi-picker')).outlineWidth); });
check('directory picker có focus ring nhìn thấy', focusOutline >= 2, String(focusOutline));

await chooseDirectory([
  source(T1), timings(T1), audio(T1),
  source(T2),
  source(T3), timings(T3), audio(T3),
  source(T4), audio(T4),
  source(T6), timings(T6),
]);
await page.getByText('5 bundle', { exact: true }).waitFor();
check('inventory phân biệt audio-ready, metadata-only và audio thiếu timings',
  await page.getByText('Audio-ready', { exact: true }).count() >= 2
  && await page.getByText('Metadata-only', { exact: true }).count() >= 1
  && await page.getByText('Audio thiếu timings', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Dry-run tất cả' }).evaluate((button) => { button.click(); button.click(); });
await page.getByText('Dry-run hoàn tất.', { exact: false }).waitFor();
check('double-click dry-run vẫn chỉ kiểm bốn bundle structurally valid', dryRuns === 4, String(dryRuns));
check('duplicate và audio thiếu timings không thể được chọn',
  await page.getByRole('checkbox', { name: `Chọn ${T3}` }).isDisabled()
  && await page.getByRole('checkbox', { name: `Chọn ${T4}` }).isDisabled()
  && await page.getByRole('checkbox', { name: `Chọn ${T6}` }).isDisabled()
  && await page.getByRole('checkbox', { name: `Chọn ${T1}` }).isChecked()
  && await page.getByRole('checkbox', { name: `Chọn ${T2}` }).isChecked());
check('blocked rows mở sẵn lý do và status có màu khác ready', await page.locator(`[data-test-id="${T3}"] details[open]`).count() === 1
  && await page.locator(`[data-test-id="${T4}"] details[open]`).count() === 1
  && await page.evaluate(([readyId, blockedId]) => {
    const ready = document.querySelector(`[data-test-id="${readyId}"] .adm-status-pill`);
    const blocked = document.querySelector(`[data-test-id="${blockedId}"] .adm-status-pill`);
    return ready && blocked && getComputedStyle(ready).backgroundColor !== getComputedStyle(blocked).backgroundColor;
  }, [T1, T3]));
check('timings có file nhưng thiếu evidence bị khóa với lý do riêng', await page.locator(`[data-test-id="${T6}"]`).getByText(/timings\.json không chứa full_test\/sections hợp lệ/).count() === 1);
check('duplicate dẫn sang Kho test với exact search', (await page.getByRole('link', { name: 'Xử lý duplicate' }).getAttribute('href'))?.includes(T3));

await page.getByRole('button', { name: 'Ghi 2 Draft đã chọn…' }).click();
await page.getByRole('heading', { name: 'Ghi 2 skill drill thành Draft?' }).waitFor();
await page.getByRole('button', { name: 'Xác nhận ghi 2 Draft' }).click();
await page.getByRole('progressbar', { name: new RegExp(T1) }).waitFor();
await page.waitForFunction((key) => localStorage.getItem(key) !== null, `aldi-pending:${encodeURIComponent(adminId)}:v1`);
check('receipt nội bộ không hiện banner ambiguity khi queue đang khỏe', await page.getByRole('heading', { name: `Lượt import ${T1} cần đối chiếu` }).count() === 0);
const progressSemantics = await page.getByRole('progressbar', { name: new RegExp(T1) }).evaluate((node) => ({ min: node.getAttribute('aria-valuemin'), max: node.getAttribute('aria-valuemax'), live: node.closest('[role="status"]') !== null }));
await page.getByRole('heading', { name: `Lượt import ${T2} cần đối chiếu` }).waitFor();
check('queue ghi T1 rồi dừng ở 503 của T2', commitRequests === 2 && canonicalRows.size === 2 && await page.getByText('Canonical GET đã xác nhận Draft.', { exact: true }).count() === 1);
check('canonical card trước reload đọc đúng audio-ready truth', await page.locator('.aldi-results').getByText('Audio-ready', { exact: true }).count() === 1);
check('upload progress dùng progressbar hữu hạn và không spam live region', progressSemantics.min === '0' && progressSemantics.max === '100' && !progressSemantics.live);

const beforeReconcile = commitRequests;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: `Lượt import ${T2} cần đối chiếu` }).waitFor();
check('receipt sống qua reload và khóa cả hai picker', await page.locator('.aldi-picker input:disabled').count() === 2);
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText(`Đã đối chiếu ${T2}: draft. Không gửi lại POST.`, { exact: true }).waitFor();
check('ambiguous write reconcile bằng list + detail GET, không phát lại POST', commitRequests === beforeReconcile && listReads >= 3 && detailReads >= 2);
check('canonical card sau reload đọc đúng metadata-only truth', await page.locator('.aldi-results').getByText('Metadata-only', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Import batch khác' }).click();
scenario = 'happy';
await chooseDirectory([source(T5)]);
await page.getByRole('button', { name: 'Dry-run tất cả' }).click();
await page.getByText('Dry-run hoàn tất.', { exact: false }).waitFor();
await page.evaluate(() => {
  const native = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('aldi-pending:')) throw new DOMException('storage blocked', 'QuotaExceededError');
    return native.call(this, key, value);
  };
});
const beforeStorageFailure = commitRequests;
await page.getByRole('button', { name: 'Ghi 1 Draft đã chọn…' }).click();
await page.getByRole('button', { name: 'Xác nhận ghi 1 Draft' }).click();
await page.locator('.alc-banner.is-error').getByText(/Không thể tạo biên nhận an toàn/).waitFor();
check('localStorage lỗi chặn trước POST và có đường reload rõ ràng', commitRequests === beforeStorageFailure
  && await page.getByRole('button', { name: 'Tải lại sau khi cấp quyền lưu trữ' }).count() === 1);

const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
  actionHeight: parseFloat(getComputedStyle(document.querySelector('.aldi-action-card .adm-btn-primary')).minHeight) }));
check('mobile không tràn ngang và CTA đạt touch target', mobile.scroll <= mobile.width && mobile.actionHeight >= 44, JSON.stringify(mobile));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop có evidence chính và operations rail', await page.evaluate(() => getComputedStyle(document.querySelector('.aldi-workspace')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening drill import flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
