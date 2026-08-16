// Fixture-backed browser contract for native Admin Reading paper QA.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const testId = 'AVR-READ-PREVIEW-1';
const adminId = '00000000-0000-0000-0000-000000000117';
const session = JSON.stringify({ access_token: 'admin-reading-preview-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'reading-preview@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let imagePath = null;
let getCount = 0;
const fixture = () => ({
  id: 'uuid-test', test_id: testId, title: 'Academic Reading QA', module: 'academic', status: 'draft',
  passage_count: 2, total_questions: 4, time_limit_minutes: 60, band_target: 7,
  passages: [
    { id: 'p1', passage_order: 1, slug: 'water-safe', title: 'Water & Safety <script>', body_markdown: '# Water safety\n\n<script>window.__arpXss = true</script>Text stays readable.', word_count: 640, estimated_minutes: 20, status: 'published', topic_tags: [], img_prompts: [{ id: 'IMG-Q2-3', type: 'diagram', qrange: '2–3', prompt: 'Create a labelled water-cycle diagram.' }, { id: 'broken' }] },
    { id: 'p2', passage_order: 2, slug: 'cities', title: 'Cities', body_markdown: '## Urban change\n\nSecond passage.', word_count: 590, estimated_minutes: 20, status: 'published', topic_tags: [], img_prompts: [] },
  ],
  questions: [
    { id: 'q1', q_num: 1, passage_id: 'p1', passage_order: 1, question_type: 'mcq_single', prompt: 'Which claim is supported?', skill_tag: 'detail', payload: { options: [{ label: 'A', text: 'First answer' }, { label: 'B', text: '<img src=x onerror=window.__optionXss=true>' }] }, answer: { answer: 'A', alternatives: [] }, explanation: 'The first paragraph supports A.' },
    { id: 'q2', q_num: 2, passage_id: 'p1', passage_order: 1, question_type: 'diagram_label_completion', prompt: 'Label the cycle.', skill_tag: 'visual', payload: { template: imagePath ? { image_storage_path: imagePath, image_source: 'admin_upload', choose: 1 } : { choose: 1 }, ...(imagePath ? { image_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' } : {}) }, answer: { answer: 'evaporation', alternatives: ['water evaporation'] }, explanation: 'Follow the upward arrow.' },
    { id: 'q3', q_num: 3, passage_id: 'p1', passage_order: 1, question_type: 'diagram_label_completion', prompt: 'Label the next stage.', skill_tag: 'visual', payload: { template: {} }, answer: { answer: 'condensation', alternatives: [] }, explanation: 'Follow the cloud marker.' },
    { id: 'q4', q_num: 4, passage_id: 'p2', passage_order: 2, question_type: 'short_answer', prompt: 'Name the city.', skill_tag: 'locate', payload: {}, answer: { answer: 'Oslo', alternatives: ['OSLO'] }, explanation: 'Named in paragraph 2.' },
  ],
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
const requests = []; const writes = []; const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push(`${method} ${parsed.pathname}${parsed.search}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'reading-preview@local', role: 'admin' });
  if (parsed.pathname === `/admin/reading/content/tests/${testId}` && method === 'GET') { getCount += 1; return json(fixture()); }
  if (parsed.pathname === '/admin/reading/questions/q2/upload-diagram-image' && method === 'POST') {
    imagePath = `tests/${testId}/diagrams/q2.png`;
    return json({ question_id: 'q2', image_storage_path: imagePath, image_size_bytes: 128, image_format: 'png', signed_url: 'signed' });
  }
  if (parsed.pathname === '/admin/reading/questions/q2/diagram-image' && method === 'DELETE') {
    const deleted = Boolean(imagePath); imagePath = null; return json({ question_id: 'q2', deleted });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/reading/preview?test_id=${testId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Academic Reading QA', exact: true }).waitFor();
check('backend-owned admin gate và canonical GET chạy', requests.includes('GET /auth/me') && requests.includes(`GET /admin/reading/content/tests/${testId}`));
check('answer key và explanation hiển thị', await page.getByText('evaporation', { exact: true }).count() === 1 && await page.getByText('Follow the upward arrow.', { exact: true }).count() === 1);
check('diagram block chỉ có một image manager', await page.getByRole('region', { name: 'Ảnh sơ đồ cho câu 2' }).count() === 1 && await page.getByText('Dùng chung ảnh sơ đồ với Q2', { exact: false }).count() === 1);
check('IMG-PROMPT và contract issue hiển thị thật', await page.getByText('Prompt tạo ảnh được trích từ file').count() === 1 && await page.getByText(/1 vấn đề contract cần rà/).count() === 1);
check('student-like preview dùng native review route', await page.getByRole('link', { name: 'Xem như học viên ↗' }).getAttribute('href') === `/reading/review?admin_test_id=${testId}`);
check('Markdown không chạy script', await page.evaluate(() => !window.__arpXss && !window.__optionXss));
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
const upload = page.locator('input[type=file]').first();
await page.keyboard.press('Tab');
const uploadKeyboardReachable = await page.evaluate(() => { const input = document.querySelector('.arp-file-input'); input?.focus(); return document.activeElement === input && getComputedStyle(input.closest('.arp-file-label')).outlineStyle !== 'none'; });
check('upload có accessible name và keyboard focus', uploadKeyboardReachable && await upload.getAttribute('aria-label') === 'Tải ảnh sơ đồ cho câu 2');

await upload.setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(124)]) });
await page.getByText('Đã cập nhật ảnh Q2', { exact: true }).waitFor();
check('upload gọi đúng multipart endpoint một lần', writes.filter((value) => value === 'POST /admin/reading/questions/q2/upload-diagram-image').length === 1);
check('upload chỉ thành công sau canonical GET', getCount >= 2 && await page.getByText('Đã có ảnh canonical', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Xóa ảnh' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xóa ảnh' }).click();
await page.getByText('Đã xóa ảnh Q2', { exact: true }).waitFor();
check('delete gọi đúng endpoint một lần', writes.filter((value) => value === 'DELETE /admin/reading/questions/q2/diagram-image').length === 1);
check('delete canonical readback trả UI về fallback', getCount >= 3 && await page.getByText(/Chưa có ảnh; student view dùng fallback/).count() === 1);

await page.goto(`${BASE}/admin/reading/preview?test_id=${testId}#q4`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Cities', exact: true }).waitFor();
check('deep link câu hỏi chọn đúng passage trước khi scroll', await page.locator('#q4').count() === 1 && await page.getByRole('button', { name: /Passage 2/ }).getAttribute('aria-current') === 'true');

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Academic Reading QA', exact: true }).waitFor();
check('desktop có sticky navigator và hai cột', await page.evaluate(() => { const nav = document.querySelector('.arp-nav'); const workspace = document.querySelector('.arp-workspace'); return getComputedStyle(nav).position === 'sticky' && getComputedStyle(workspace).gridTemplateColumns.split(' ').length === 2 && document.documentElement.scrollWidth <= innerWidth; }));
await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Academic Reading QA', exact: true }).waitFor();
check('dark mode giữ surface/text phân biệt', await page.evaluate(() => { const node = document.querySelector('.arp-question'); const style = getComputedStyle(node); return style.backgroundColor !== style.color && style.color !== 'rgba(0, 0, 0, 0)'; }));
check('không có write ngoài hai mutation contract', writes.length === 2, writes.join(', '));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Reading preview flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
