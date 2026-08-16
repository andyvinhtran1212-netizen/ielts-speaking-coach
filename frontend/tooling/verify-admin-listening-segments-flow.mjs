import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3050';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const contentId = '00000000-0000-0000-0000-000000000456';
const session = JSON.stringify({ access_token: 'admin-listening-segments-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'segments@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const makeSegments = (prefix) => [
  { idx: 0, transcript: `${prefix} first.`, start_sec: 0, end_sec: 5 },
  { idx: 1, transcript: `${prefix} second.`, start_sec: 5, end_sec: 10 },
];
const content = {
  id: contentId, title: 'Fixture lecture', transcript: 'Fixture first. Fixture second.',
  audio_duration_seconds: 20, audio_signed_url: 'https://audio.fixture/test.mp3',
  status: 'published', source_type: 'upload_mp3', alignment_data: null,
};
let blocks = [
  { id: 'exercise-1', content_id: contentId, exercise_type: 'dictation', order_num: 1, status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', segments: makeSegments('Block one') },
  { id: 'exercise-2', content_id: contentId, exercise_type: 'dictation', order_num: 2, status: 'published', updated_at: '2026-08-14T00:00:00+00:00', segments: makeSegments('Block two') },
  { id: 'exercise-3', content_id: contentId, exercise_type: 'dictation', order_num: 3, status: 'archived', updated_at: '2026-08-14T00:00:00+00:00', segments: makeSegments('Block archived') },
];
const postBodies = []; let contentReads = 0; let blockReads = 0; let nextBlockReadFailure = 0;
const applyOperation = (body) => {
  let target = body.exercise_id ? blocks.find((item) => item.id === body.exercise_id) : blocks.find((item) => item.order_num === body.order_num);
  if (!target) {
    target = { id: `exercise-${blocks.length + 1}`, content_id: contentId, exercise_type: 'dictation', order_num: body.order_num, status: body.status, updated_at: '2026-08-14T00:00:00+00:00', segments: [] };
    blocks.push(target);
  }
  target.status = body.status; target.segments = body.segments;
  target.updated_at = new Date(Date.parse(target.updated_at) + 1000).toISOString();
  return target;
};

const errors = [];
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (url.startsWith('https://audio.fixture/')) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'segments@local', role: 'admin' });
  if (parsed.pathname === `/admin/listening/content/${contentId}` && method === 'GET') { contentReads += 1; return json(content); }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'GET') {
    blockReads += 1;
    if (nextBlockReadFailure) { const status = nextBlockReadFailure; nextBlockReadFailure = 0; return json({ detail: 'readback forbidden after acknowledged POST' }, status); }
    return json({ exercises: blocks });
  }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'POST') {
    const body = request.postDataJSON(); postBodies.push(body);
    const transcript = body.segments?.[0]?.transcript;
    if (transcript === 'Conflict.') {
      blocks[0] = { ...blocks[0], segments: makeSegments('Concurrent'), updated_at: '2026-08-14T01:00:00+00:00' };
      return json({ detail: 'version conflict' }, 409);
    }
    const target = applyOperation(body);
    if (transcript === 'Ambiguous.') return json({ detail: 'gateway timeout after commit' }, 503);
    if (transcript === 'Acknowledged.') nextBlockReadFailure = 403;
    return json({ ok: true, exercise_id: target.id, created: false, updated_at: target.updated_at });
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/segments?content_id=${contentId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Phân câu và khóa timestamp' }).waitFor();
check('route đọc exact content và đầy đủ Dictation blocks', contentReads >= 1 && blockReads >= 1 && await page.locator('#alse-block option').count() === 3, `${contentReads} content GET · ${blockReads} block GET`);
check('mặc định chọn order 1 và giữ rollback exact identity', await page.locator('#alse-block').inputValue() === 'exercise-1' && await page.getByRole('link', { name: /HTML rollback/ }).getAttribute('href') === `/pages/admin/listening/segments.html?content_id=${contentId}`);
check('audio player dùng public current-time contract', await page.locator('audio-player').evaluate((node) => typeof node.getCurrentTime === 'function'));

await page.locator('#alse-block').selectOption('exercise-3');
check('block archived giữ nguyên trạng thái và không bị đánh dấu dirty', await page.getByRole('radio', { name: /Lưu trữ/ }).isChecked() && await page.getByRole('button', { name: 'Lưu bản lưu trữ' }).isDisabled());
await page.locator('#alse-block').selectOption('exercise-1');

const firstTranscript = page.locator('.alse-segments>li').first().locator('textarea');
await firstTranscript.fill('Edited first.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const firstPost = postBodies[0];
check('POST update mang exact exercise_id, order và version', firstPost.exercise_id === 'exercise-1' && firstPost.order_num === 1 && firstPost.expected_updated_at === '2026-08-14T00:00:00+00:00');
check('success chỉ sau canonical GET readback', blockReads >= 2 && blocks[0].segments[0].transcript === 'Edited first.');

await page.locator('#alse-block').selectOption('exercise-2');
await page.locator('.alse-segments>li').first().locator('textarea').fill('Unsaved second.');
await page.locator('#alse-block').selectOption('exercise-1');
await page.getByRole('heading', { name: 'Chuyển block và bỏ thay đổi?' }).waitFor();
await page.getByRole('button', { name: 'Tiếp tục sửa' }).click();
check('đổi block khi dirty có confirmation boundary', await page.locator('#alse-block').inputValue() === 'exercise-2' && await page.locator('.alse-segments>li').first().locator('textarea').inputValue() === 'Unsaved second.');

await page.locator('.alse-segments>li').first().locator('textarea').fill('Conflict.');
await page.getByRole('button', { name: 'Lưu & xuất bản' }).click();
await page.getByRole('heading', { name: 'Block đã đổi ở nơi khác' }).waitFor();
check('409 khóa form và không ghi đè block concurrent', await page.locator('.alse-segments>li').first().locator('textarea').isDisabled() && blocks[0].segments[0].transcript.startsWith('Concurrent'));
await page.getByRole('button', { name: 'Tải canonical mới' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => document.querySelector('#alse-block')?.value === 'exercise-1');

await page.locator('.alse-segments>li').first().locator('textarea').fill('Ambiguous.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).waitFor();
const postCountBeforeReconcile = postBodies.length;
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('503 sau commit reconcile bằng GET và không POST lại', postBodies.length === postCountBeforeReconcile && blocks[0].segments[0].transcript === 'Ambiguous.');

await page.locator('.alse-segments>li').first().locator('textarea').fill('Acknowledged.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('POST đã nhận, chưa đọc lại được', { exact: true }).waitFor();
const postCountAfterAcknowledged = postBodies.length;
check('POST 200 rồi GET 403 giữ receipt và khóa phát lại', await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).count() === 1 && await page.locator('.alse-segments>li').first().locator('textarea').isDisabled());
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('readback 403 reconcile bằng GET-only, không POST lần hai', postBodies.length === postCountAfterAcknowledged && blocks[0].segments[0].transcript === 'Acknowledged.');

await page.getByRole('button', { name: 'Thêm Dictation block' }).click();
await page.getByRole('button', { name: 'Thêm câu' }).click();
await page.locator('.alse-segments>li').first().locator('textarea').fill('New block.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const createPost = postBodies.at(-1);
check('UI tạo block kế tiếp bằng expected_absent và không gửi exercise_id', createPost.order_num === 4 && createPost.expected_absent === true && !Object.hasOwn(createPost, 'exercise_id'));
check('block mới chỉ được cài sau canonical GET và xuất hiện trong selector', blocks.length === 4 && await page.locator('#alse-block').inputValue() === 'exercise-4' && await page.locator('#alse-block option').count() === 4);

await page.evaluate(() => {
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('alse-pending:')) throw new DOMException('Storage disabled', 'QuotaExceededError');
    return nativeSetItem.call(this, key, value);
  };
});
const postCountBeforeStorageFailure = postBodies.length;
await page.locator('.alse-segments>li').first().locator('textarea').fill('Storage blocked.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Không thể tạo biên nhận an toàn', { exact: true }).waitFor();
check('sessionStorage hỏng chặn trước POST', postBodies.length === postCountBeforeStorageFailure && !(await page.locator('.alse-segments>li').first().locator('textarea').isDisabled()));

const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, actionHeight: parseFloat(getComputedStyle(document.querySelector('.alse-actions .adm-btn-primary')).minHeight) }));
check('mobile không tràn ngang và action đạt touch target', mobile.scrollWidth <= mobile.innerWidth && mobile.actionHeight >= 44, JSON.stringify(mobile));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop có workspace editor + provenance rail', await page.evaluate(() => getComputedStyle(document.querySelector('.alse-workspace')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening segments flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
