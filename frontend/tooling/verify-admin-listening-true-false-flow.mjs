import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3050';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const contentId = '00000000-0000-0000-0000-000000000456';
const session = JSON.stringify({ access_token: 'admin-listening-tf-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'tf@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const statementPayload = (prefix) => ({ statements: [
  { idx: 0, text: `${prefix} is confirmed.`, answer: 'T' },
  { idx: 1, text: `${prefix} is contradicted.`, answer: 'F' },
  { idx: 2, text: `${prefix} is not mentioned.`, answer: 'NG' },
] });
const content = { id: contentId, title: 'Fixture transport report', transcript: 'The route closes on Sunday. Its opening year is not mentioned.', audio_duration_seconds: 42, audio_signed_url: 'https://audio.fixture/test.mp3', status: 'published', source_type: 'upload_mp3' };
let blocks = [
  { id: 'exercise-1', content_id: contentId, exercise_type: 'true_false', order_num: 1, status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: statementPayload('Block one') },
  { id: 'exercise-2', content_id: contentId, exercise_type: 'true_false', order_num: 2, status: 'published', updated_at: '2026-08-14T00:00:00+00:00', payload: statementPayload('Block two') },
  { id: 'exercise-3', content_id: contentId, exercise_type: 'true_false', order_num: 3, status: 'archived', updated_at: '2026-08-14T00:00:00+00:00', payload: statementPayload('Archived') },
];
const postBodies = []; let contentReads = 0; let blockReads = 0; let nextBlockReadFailure = 0;
const applyOperation = (body) => {
  let target = body.exercise_id ? blocks.find((item) => item.id === body.exercise_id) : blocks.find((item) => item.order_num === body.order_num);
  if (!target) {
    target = { id: `exercise-${blocks.length + 1}`, content_id: contentId, exercise_type: 'true_false', order_num: body.order_num, status: body.status, updated_at: '2026-08-14T00:00:00+00:00', payload: {} };
    blocks.push(target);
  }
  target.status = body.status; target.payload = body.payload;
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'tf@local', role: 'admin' });
  if (parsed.pathname === `/admin/listening/content/${contentId}` && method === 'GET') { contentReads += 1; return json(content); }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'GET') {
    blockReads += 1;
    if (nextBlockReadFailure) { const status = nextBlockReadFailure; nextBlockReadFailure = 0; return json({ detail: 'readback forbidden after acknowledged POST' }, status); }
    return json({ exercises: blocks });
  }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'POST') {
    const body = request.postDataJSON(); postBodies.push(body);
    const text = body.payload?.statements?.[0]?.text;
    if (text === 'Unauthorized.') return json({ detail: 'session expired' }, 401);
    if (text === 'Conflict.') {
      const index = Math.max(0, blocks.findIndex((item) => item.id === body.exercise_id));
      blocks[index] = { ...blocks[index], payload: statementPayload('Concurrent'), updated_at: '2026-08-14T01:00:00+00:00' };
      return json({ detail: 'version conflict' }, 409);
    }
    if (text === 'Concurrent create.') {
      blocks.push({ id: 'exercise-concurrent', content_id: contentId, exercise_type: 'true_false', order_num: body.order_num,
        status: body.status, updated_at: '2026-08-14T02:00:00+00:00', payload: statementPayload('Concurrent winner') });
      return json({ detail: 'block created concurrently' }, 409);
    }
    const target = applyOperation(body);
    if (text === 'Ambiguous.') return json({ detail: 'gateway timeout after commit' }, 503);
    if (text === 'Acknowledged.') nextBlockReadFailure = 403;
    return json({ ok: true, exercise_id: target.id, created: false, updated_at: target.updated_at });
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/tf?content_id=${contentId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Soạn nhận định T / F / NG theo bằng chứng' }).waitFor();
check('route đọc exact content và đầy đủ T/F blocks', contentReads >= 1 && blockReads >= 1 && await page.locator('#altf-block option').count() === 3, `${contentReads} content GET · ${blockReads} block GET`);
check('mặc định chọn order 1 và giữ rollback exact identity', await page.locator('#altf-block').inputValue() === 'exercise-1' && await page.getByRole('link', { name: /HTML rollback/ }).getAttribute('href') === `/pages/admin/listening/tf.html?content_id=${contentId}&exercise_id=exercise-1`);
check('UI nêu đúng T/F/NG và điều kiện đạt 100%', await page.getByText(/Audio không đủ dữ kiện/).count() === 3 && await page.getByText(/đúng 100% nhận định/).count() === 1);

const secondStatement = await page.locator('#altf-text-1').inputValue();
await page.getByRole('button', { name: 'Đưa câu 2 lên' }).click();
check('reorder giữ focus trên đúng nhận định và báo thay đổi cho screen reader',
  await page.locator('#altf-text-0').inputValue() === secondStatement
  && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Đưa câu 1 lên')
  && await page.locator('[aria-live="polite"]').textContent().then((text) => text?.includes('Đã chuyển nhận định 2 lên vị trí 1.')));
await page.getByRole('button', { name: 'Đưa câu 1 xuống' }).click();
check('reorder ngược khôi phục thứ tự mà không làm mất focus',
  await page.locator('#altf-text-1').inputValue() === secondStatement
  && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Đưa câu 2 xuống'));
check('minimum 3 câu khóa xóa nhưng vẫn cho thêm',
  await page.getByRole('button', { name: 'Xóa câu 1' }).isDisabled()
  && !(await page.getByRole('button', { name: '+ Thêm nhận định' }).isDisabled()));
await page.getByRole('button', { name: '+ Thêm nhận định' }).click();
check('thêm câu thứ tư mở quyền xóa',
  await page.locator('.altf-statements > li').count() === 4
  && !(await page.getByRole('button', { name: 'Xóa câu 4' }).isDisabled()));
await page.getByRole('button', { name: 'Xóa câu 4' }).click();
check('xóa câu đưa editor về minimum hợp lệ', await page.locator('.altf-statements > li').count() === 3);

await page.locator('#altf-block').selectOption('exercise-3');
check('block archived giữ nguyên trạng thái và không bị đánh dấu dirty', await page.getByRole('radio', { name: /Đã lưu trữ/ }).isChecked() && await page.getByRole('button', { name: 'Lưu bản lưu trữ' }).isDisabled());
await page.locator('#altf-block').selectOption('exercise-1');

await page.locator('#altf-text-0').fill('Edited statement.');
await page.getByRole('radio', { name: /F · Sai/ }).first().check();
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const firstPost = postBodies[0];
check('POST update mang exact exercise_id, order và version', firstPost.exercise_id === 'exercise-1' && firstPost.order_num === 1 && firstPost.expected_updated_at === '2026-08-14T00:00:00+00:00');
check('success chỉ sau canonical GET xác nhận đủ câu và đáp án', blockReads >= 2 && blocks[0].payload.statements[0].text === 'Edited statement.' && blocks[0].payload.statements[0].answer === 'F');

await page.locator('#altf-block').selectOption('exercise-2');
await page.locator('#altf-text-0').fill('Unsaved second.');
await page.locator('#altf-block').selectOption('exercise-1');
await page.getByRole('heading', { name: 'Chuyển block và bỏ thay đổi?' }).waitFor();
await page.getByRole('button', { name: 'Tiếp tục sửa' }).click();
check('đổi block khi dirty có confirmation boundary', await page.locator('#altf-block').inputValue() === 'exercise-2' && await page.locator('#altf-text-0').inputValue() === 'Unsaved second.');

await page.locator('#altf-text-0').fill('Conflict.');
await page.getByRole('button', { name: 'Lưu & xuất bản' }).click();
await page.getByRole('heading', { name: 'Block đã đổi ở nơi khác' }).waitFor();
check('409 khóa form và không ghi đè canonical concurrent', await page.locator('#altf-text-0').isDisabled() && blocks[1].payload.statements[0].text.startsWith('Concurrent'));
await page.getByRole('button', { name: 'Tải canonical mới' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => document.querySelector('#altf-block')?.value === 'exercise-2');
check('reload sau 409 giữ exact block đang xung đột', await page.locator('#altf-text-0').inputValue().then((value) => value.startsWith('Concurrent')));
await page.getByRole('radio', { name: /Bản nháp/ }).check();

await page.locator('#altf-text-0').fill('Ambiguous.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).waitFor();
const postCountBeforeReconcile = postBodies.length;
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('503 sau commit reconcile bằng GET và không POST lại', postBodies.length === postCountBeforeReconcile && blocks[1].payload.statements[0].text === 'Ambiguous.');

await page.locator('#altf-text-0').fill('Acknowledged.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('POST đã nhận, chưa đọc lại được', { exact: true }).waitFor();
const postCountAfterAcknowledged = postBodies.length;
check('POST 200 rồi GET 403 giữ receipt và khóa phát lại', await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).count() === 1 && await page.locator('#altf-text-0').isDisabled());
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('readback 403 reconcile bằng GET-only, không POST lần hai', postBodies.length === postCountAfterAcknowledged && blocks[1].payload.statements[0].text === 'Acknowledged.');

await page.locator('#altf-block').selectOption('exercise-1');
await page.getByRole('radio', { name: /Đã xuất bản/ }).check();
await page.getByRole('button', { name: 'Lưu & xuất bản' }).click();
await page.getByText('Đã xuất bản T/F block', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Thêm T/F block' }).click();
check('block mới không thể published khi đã có block đang phục vụ',
  await page.getByRole('radio', { name: /Đã xuất bản/ }).isDisabled()
  && await page.getByText(/Mỗi content chỉ có một T\/F block published/).count() === 1);
await page.locator('#altf-text-0').fill('New statement one.');
await page.locator('#altf-text-1').fill('New statement two.');
await page.locator('#altf-text-2').fill('New statement three.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const createPost = postBodies.at(-1);
check('UI tạo block kế tiếp bằng expected_absent và không gửi exercise_id', createPost.order_num === 4 && createPost.expected_absent === true && !Object.hasOwn(createPost, 'exercise_id'));
check('block mới chỉ cài sau canonical GET và xuất hiện trong selector', blocks.length === 4 && await page.locator('#altf-block').inputValue() === 'exercise-4' && await page.locator('#altf-block option').count() === 4);

await page.getByRole('button', { name: 'Thêm T/F block' }).click();
await page.locator('#altf-text-0').fill('Concurrent create.');
await page.locator('#altf-text-1').fill('Concurrent loser two.');
await page.locator('#altf-text-2').fill('Concurrent loser three.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByRole('heading', { name: 'Block đã đổi ở nơi khác' }).waitFor();
await page.getByRole('button', { name: 'Tải canonical mới' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => document.querySelector('#altf-block')?.value === 'exercise-concurrent');
check('create conflict tải đúng order vừa bị admin khác tạo', await page.locator('#altf-text-0').inputValue().then((value) => value.startsWith('Concurrent winner')));

await page.locator('#altf-text-0').fill('Unauthorized.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Backend từ chối thay đổi', { exact: true }).waitFor();
check('401 trước ACK xóa receipt, không báo POST đã nhận và giữ form sửa được',
  !(await page.locator('#altf-text-0').isDisabled())
  && !(await page.getByText('POST đã nhận, chưa đọc lại được', { exact: true }).count())
  && !(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('altf-pending:')))));

await page.evaluate(() => {
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('altf-pending:')) throw new DOMException('Storage disabled', 'QuotaExceededError');
    return nativeSetItem.call(this, key, value);
  };
});
const postCountBeforeStorageFailure = postBodies.length;
await page.locator('#altf-text-0').fill('Storage blocked.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Không thể tạo biên nhận an toàn', { exact: true }).waitFor();
check('sessionStorage hỏng chặn trước POST', postBodies.length === postCountBeforeStorageFailure && !(await page.locator('#altf-text-0').isDisabled()));

const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, actionHeight: parseFloat(getComputedStyle(document.querySelector('.altf-actions .adm-btn-primary')).minHeight) }));
check('mobile không tràn ngang và action đạt touch target', mobile.scrollWidth <= mobile.innerWidth && mobile.actionHeight >= 44, JSON.stringify(mobile));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop có workspace editor + provenance rail', await page.evaluate(() => getComputedStyle(document.querySelector('.altf-workspace')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening True/False flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
