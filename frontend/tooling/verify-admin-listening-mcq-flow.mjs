import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3050';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const contentId = '00000000-0000-0000-0000-000000000456';
const session = JSON.stringify({ access_token: 'admin-listening-mcq-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'mcq@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const questionPayload = (prefix) => ({ questions: [
  { idx: 0, stem: `${prefix} caused the delay?`, options: ['Weather', 'Traffic', 'Staffing', 'Equipment'], answer_idx: 1 },
  { idx: 1, stem: `${prefix} reopening day?`, options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], answer_idx: 2 },
] });
const content = { id: contentId, title: 'Fixture transport report', transcript: 'Traffic caused the delay. The route reopens on Wednesday.', audio_duration_seconds: 42, audio_signed_url: 'https://audio.fixture/test.mp3', status: 'published', source_type: 'upload_mp3' };
let blocks = [
  { id: 'exercise-1', content_id: contentId, exercise_type: 'mcq', order_num: 1, status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: questionPayload('Block one') },
  { id: 'exercise-2', content_id: contentId, exercise_type: 'mcq', order_num: 2, status: 'published', updated_at: '2026-08-14T00:00:00+00:00', payload: questionPayload('Block two') },
  { id: 'exercise-3', content_id: contentId, exercise_type: 'mcq', order_num: 3, status: 'archived', updated_at: '2026-08-14T00:00:00+00:00', payload: questionPayload('Archived') },
];
const importedBlock = {
  id: 'imported-1', content_id: contentId, exercise_type: 'mcq', order_num: 7,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: {
    variant: 'mcq_3option', template_kind: 'plain', instruction: 'Choose one.',
    questions: [{ q_num: 1, prompt: 'Imported prompt', options: ['A', 'B', 'C'] }],
    answers: [{ q_num: 1, answer: 'B' }],
  },
};
const postBodies = []; let contentReads = 0; let blockReads = 0; let nextBlockReadFailure = 0;
const applyOperation = (body) => {
  let target = body.exercise_id ? blocks.find((item) => item.id === body.exercise_id) : blocks.find((item) => item.order_num === body.order_num);
  if (!target) {
    target = { id: `exercise-${blocks.length + 1}`, content_id: contentId, exercise_type: 'mcq', order_num: body.order_num, status: body.status, updated_at: '2026-08-14T00:00:00+00:00', payload: {} };
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'mcq@local', role: 'admin' });
  if (parsed.pathname === `/admin/listening/content/${contentId}` && method === 'GET') { contentReads += 1; return json(content); }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'GET') {
    blockReads += 1;
    if (nextBlockReadFailure) { const status = nextBlockReadFailure; nextBlockReadFailure = 0; return json({ detail: 'readback forbidden after acknowledged POST' }, status); }
    return json({ exercises: [...blocks, importedBlock] });
  }
  if (parsed.pathname === '/admin/listening/exercises' && method === 'POST') {
    const body = request.postDataJSON(); postBodies.push(body);
    const stem = body.payload?.questions?.[0]?.stem;
    if (stem === 'Unauthorized.') return json({ detail: 'session expired' }, 401);
    if (stem === 'Conflict.') {
      const index = Math.max(0, blocks.findIndex((item) => item.id === body.exercise_id));
      blocks[index] = { ...blocks[index], payload: questionPayload('Concurrent'), updated_at: '2026-08-14T01:00:00+00:00' };
      return json({ detail: 'version conflict' }, 409);
    }
    const target = applyOperation(body);
    if (stem === 'Ambiguous.') return json({ detail: 'gateway timeout after commit' }, 503);
    if (stem === 'Acknowledged.') nextBlockReadFailure = 403;
    return json({ ok: true, exercise_id: target.id, created: false, updated_at: target.updated_at });
  }
  return json({ detail: `unhandled ${method} ${parsed.pathname}` }, 404);
});

const standaloneBlocks = blocks;
blocks = [];
await page.goto(`${BASE}/admin/listening/mcq?content_id=${contentId}&exercise_id=${importedBlock.id}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Soạn câu hỏi MCQ theo bằng chứng' }).waitFor();
check('content chỉ có importer mở form standalone ở order kế tiếp và deep-link không loop',
  await page.getByText('Mới #8', { exact: true }).count() === 1
  && await page.getByText('Block thuộc kho đề', { exact: true }).count() === 1
  && await page.getByRole('link', { name: /HTML rollback/ }).count() === 0);
blocks = standaloneBlocks;
await page.goto(`${BASE}/admin/listening/mcq?content_id=${contentId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Soạn câu hỏi MCQ theo bằng chứng' }).waitFor();
check('route đọc exact content và đầy đủ MCQ blocks', contentReads >= 1 && blockReads >= 1 && await page.locator('#almc-block option').count() === 3, `${contentReads} content GET · ${blockReads} block GET`);
check('mặc định chọn order 1 và tách block importer khỏi editor standalone',
  await page.locator('#almc-block').inputValue() === 'exercise-1'
  && await page.getByText('1 MCQ block thuộc kho đề', { exact: true }).count() === 1
  && await page.getByRole('link', { name: /HTML rollback/ }).count() === 0);
check('UI nêu bốn lựa chọn, một answer key và điều kiện đạt 100%', await page.getByText(/Một câu, bốn lựa chọn, một answer key/).count() === 1 && await page.getByText(/đúng 100% câu hỏi/).count() === 1);

const secondStem = await page.locator('#almc-stem-1').inputValue();
await page.getByRole('button', { name: 'Đưa câu 2 lên' }).click();
check('reorder giữ focus trên đúng câu và báo thay đổi cho screen reader',
  await page.locator('#almc-stem-0').inputValue() === secondStem
  && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Đưa câu 1 lên')
  && await page.locator('[aria-live="polite"]').textContent().then((text) => text?.includes('Đã chuyển câu 2 lên vị trí 1.')));
await page.getByRole('button', { name: 'Đưa câu 1 xuống' }).click();
check('reorder ngược khôi phục thứ tự mà không làm mất focus',
  await page.locator('#almc-stem-1').inputValue() === secondStem
  && await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Đưa câu 2 xuống'));
await page.getByRole('button', { name: 'Xóa câu 2' }).click();
check('minimum một câu khóa xóa nhưng vẫn cho thêm',
  await page.locator('.almc-questions > li').count() === 1
  && await page.getByRole('button', { name: 'Xóa câu 1' }).isDisabled()
  && !(await page.getByRole('button', { name: '+ Thêm câu hỏi' }).isDisabled()));
await page.getByRole('button', { name: 'Hoàn tác' }).click();
await page.getByRole('button', { name: '+ Thêm câu hỏi' }).click();
check('thêm câu thứ ba mở quyền xóa', await page.locator('.almc-questions > li').count() === 3 && !(await page.getByRole('button', { name: 'Xóa câu 3' }).isDisabled()));
await page.getByRole('button', { name: 'Xóa câu 3' }).click();
check('xóa câu mới khôi phục form canonical', await page.locator('.almc-questions > li').count() === 2 && await page.getByRole('button', { name: 'Lưu bản nháp' }).isDisabled());

await page.locator('#almc-block').selectOption('exercise-3');
check('block archived giữ nguyên trạng thái và không bị đánh dấu dirty', await page.getByRole('radio', { name: /Đã lưu trữ/ }).isChecked() && await page.getByRole('button', { name: 'Lưu bản lưu trữ' }).isDisabled());
await page.locator('#almc-block').selectOption('exercise-1');

await page.locator('#almc-stem-0').fill('Edited question.');
await page.getByRole('radio', { name: 'Chọn D làm đáp án đúng câu 1' }).check();
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const firstPost = postBodies[0];
check('POST update mang exact exercise_id, order và version', firstPost.exercise_id === 'exercise-1' && firstPost.order_num === 1 && firstPost.expected_updated_at === '2026-08-14T00:00:00+00:00');
check('success chỉ sau canonical GET xác nhận đủ câu, lựa chọn và answer key', blockReads >= 2 && blocks[0].payload.questions[0].stem === 'Edited question.' && blocks[0].payload.questions[0].answer_idx === 3);

await page.locator('#almc-block').selectOption('exercise-2');
await page.locator('#almc-stem-0').fill('Unsaved second.');
await page.locator('#almc-block').selectOption('exercise-1');
await page.getByRole('heading', { name: 'Chuyển block và bỏ thay đổi?' }).waitFor();
await page.getByRole('button', { name: 'Tiếp tục sửa' }).click();
check('đổi block khi dirty có confirmation boundary', await page.locator('#almc-block').inputValue() === 'exercise-2' && await page.locator('#almc-stem-0').inputValue() === 'Unsaved second.');

await page.locator('#almc-stem-0').fill('Conflict.');
await page.getByRole('button', { name: 'Lưu & xuất bản' }).click();
await page.getByRole('heading', { name: 'Block đã đổi ở nơi khác' }).waitFor();
check('409 khóa form và không ghi đè canonical concurrent', await page.locator('#almc-stem-0').isDisabled() && blocks[1].payload.questions[0].stem.startsWith('Concurrent'));
await page.getByRole('button', { name: 'Tải canonical mới' }).click();
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => document.querySelector('#almc-block')?.value === 'exercise-2');
check('reload sau 409 giữ exact block đang xung đột', await page.locator('#almc-stem-0').inputValue().then((value) => value.startsWith('Concurrent')));
await page.getByRole('radio', { name: /Bản nháp/ }).check();

await page.locator('#almc-stem-0').fill('Ambiguous.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).waitFor();
const postCountBeforeReconcile = postBodies.length;
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('503 sau commit reconcile bằng GET và không POST lại', postBodies.length === postCountBeforeReconcile && blocks[1].payload.questions[0].stem === 'Ambiguous.');

await page.locator('#almc-stem-0').fill('Acknowledged.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('POST đã nhận, chưa đọc lại được', { exact: true }).waitFor();
const postCountAfterAcknowledged = postBodies.length;
check('POST 200 rồi GET 403 giữ receipt và khóa phát lại', await page.getByRole('heading', { name: 'Lượt lưu cần đối chiếu' }).count() === 1 && await page.locator('#almc-stem-0').isDisabled());
await page.getByRole('button', { name: 'Đối chiếu canonical' }).click();
await page.getByText('Đã xác nhận lưu', { exact: true }).waitFor();
check('readback 403 reconcile bằng GET-only, không POST lần hai', postBodies.length === postCountAfterAcknowledged && blocks[1].payload.questions[0].stem === 'Acknowledged.');

await page.locator('#almc-block').selectOption('exercise-1');
await page.getByRole('radio', { name: /Đã xuất bản/ }).check();
await page.getByRole('button', { name: 'Lưu & xuất bản' }).click();
await page.getByText('Đã xuất bản MCQ block', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Thêm MCQ block' }).click();
check('block mới không thể published khi đã có block đang phục vụ',
  await page.getByRole('radio', { name: /Đã xuất bản/ }).isDisabled()
  && await page.getByText(/Mỗi content chỉ có một MCQ block published/).count() === 1);
await page.locator('#almc-stem-0').fill('New question?');
for (let index = 0; index < 4; index += 1) await page.locator(`#almc-option-0-${index}`).fill(`New option ${index + 1}`);
await page.getByRole('radio', { name: 'Chọn B làm đáp án đúng câu 1' }).check();
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Đã lưu bản nháp', { exact: true }).waitFor();
const createPost = postBodies.at(-1);
check('UI tạo block kế tiếp sau order importer bằng expected_absent và không gửi exercise_id', createPost.order_num === 8 && createPost.expected_absent === true && !Object.hasOwn(createPost, 'exercise_id'));
check('block mới chỉ cài sau canonical GET và xuất hiện trong selector', blocks.length === 4 && await page.locator('#almc-block').inputValue() === 'exercise-4' && await page.locator('#almc-block option').count() === 4);

await page.locator('#almc-stem-0').fill('Unauthorized.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Backend từ chối thay đổi', { exact: true }).waitFor();
check('401 trước ACK xóa receipt, không báo POST đã nhận và giữ form sửa được',
  !(await page.locator('#almc-stem-0').isDisabled())
  && !(await page.getByText('POST đã nhận, chưa đọc lại được', { exact: true }).count())
  && !(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('almc-pending:')))));

await page.evaluate(() => {
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key, value) {
    if (String(key).startsWith('almc-pending:')) throw new DOMException('Storage disabled', 'QuotaExceededError');
    return nativeSetItem.call(this, key, value);
  };
});
const postCountBeforeStorageFailure = postBodies.length;
await page.locator('#almc-stem-0').fill('Storage blocked.');
await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
await page.getByText('Không thể tạo biên nhận an toàn', { exact: true }).waitFor();
check('sessionStorage hỏng chặn trước POST', postBodies.length === postCountBeforeStorageFailure && !(await page.locator('#almc-stem-0').isDisabled()));

const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, actionHeight: parseFloat(getComputedStyle(document.querySelector('.almc-actions .adm-btn-primary')).minHeight) }));
check('mobile không tràn ngang và action đạt touch target', mobile.scrollWidth <= mobile.innerWidth && mobile.actionHeight >= 44, JSON.stringify(mobile));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop có workspace editor + provenance rail', await page.evaluate(() => getComputedStyle(document.querySelector('.almc-workspace')).gridTemplateColumns.split(' ').length >= 2));
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening MCQ flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
