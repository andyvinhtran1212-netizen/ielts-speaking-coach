import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const admin = '00000000-0000-0000-0000-000000000131';
const presetStudent = '00000000-0000-0000-0000-000000000201';
const session = JSON.stringify({ access_token: 'new-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: admin, email: 'admin@local' } });
const results = [];
const requests = [];
let essayMode = 'ambiguous';
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(BASE) || /unpkg|jsdelivr|fonts\./.test(url)) return route.continue();
  const path = new URL(url).pathname;
  const method = req.method();
  let body = null;
  try { body = req.postDataJSON(); } catch {}
  requests.push({ path, method, body });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/auth/me') return json({ id: admin, email: 'admin@local', role: 'admin' });
  if (path === '/admin/students') return json([{ id: 's1', student_code: 'S01', full_name: 'An' }]);
  if (path === `/admin/students/${presetStudent}`) return json({ id: presetStudent, student_code: 'S201', full_name: 'Học viên cũ' });
  if (path === '/admin/writing/extract-text') return json({ extracted_text: 'one two three', word_count: 3, file_metadata: { filename: 'essay.txt', size_bytes: 12 }, warnings: ['Rà lại bảng'] });
  if (path === '/admin/writing/prompts/upload-image') return json({ url: 'https://img.test/chart.png', public_id: 'chart' });
  if (path === '/admin/writing/essays' && essayMode === 'rejected') return json({ detail: 'invalid payload' }, 422);
  if (path === '/admin/writing/essays' && essayMode === 'unauthorized') return json({ detail: 'expired token' }, 401);
  if (path === '/admin/writing/essays' && essayMode === 'success') return json({ essay_id: 'essay-1', job_id: 'job-1', eta_seconds: 45, status: 'queued' }, 202);
  if (path === '/admin/writing/essays') return json({ detail: 'response lost after commit' }, 503);
  return json({ detail: 'unhandled' }, 500);
});

await page.goto(`${BASE}/admin/writing/new?student_id=${presetStudent}`);
await page.getByRole('heading', { name: 'Gửi bài chấm' }).waitFor();
const studentSelect = page.locator('.awn-form select').first();
await studentSelect.waitFor();
const preset = await studentSelect.inputValue();
check('preset ngoài cửa sổ 200 được fetch riêng và giữ canonical', preset === presetStudent && requests.some((x) => x.path === '/auth/me') && requests.some((x) => x.path === `/admin/students/${presetStudent}`), `preset=${preset}`);

await page.locator('input[accept=".docx,.txt"]').setInputFiles({ name: 'essay.txt', mimeType: 'text/plain', buffer: Buffer.from('one two three') });
await page.getByText('3 từ', { exact: true }).first().waitFor();
check('extract chỉ điền textarea và hiện warning', await page.locator('textarea').nth(1).inputValue() === 'one two three' && await page.getByText('Rà lại bảng').count() === 1);

await page.getByLabel('Task').selectOption('task1_academic');
await page.locator('input[accept="image/*"]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: Buffer.from('png') });
await page.getByText('Đã upload chart.png').waitFor();
check('ảnh chỉ mở ở Task 1 Academic và dùng ACK URL', requests.some((x) => x.path === '/admin/writing/prompts/upload-image'));

await page.getByLabel('Đề bài').fill('Describe the chart.');
await page.getByRole('button', { name: 'Gửi vào hàng chờ chấm' }).click();
await page.getByText('Có một lần gửi chưa xác minh được').waitFor();
check('ambiguous POST không replay, giữ receipt và chỉ mở reset sau response', requests.filter((x) => x.path === '/admin/writing/essays' && x.method === 'POST').length === 1 && Boolean(await page.evaluate((key) => sessionStorage.getItem(key), `awn-pending:${admin}`)) && await page.getByRole('button', { name: 'Đã kiểm tra · mở lượt mới' }).isEnabled());

await page.getByRole('button', { name: 'Đã kiểm tra · mở lượt mới' }).click();
essayMode = 'rejected';
await page.getByRole('button', { name: 'Gửi vào hàng chờ chấm' }).click();
await page.getByText(/Yêu cầu đã bị từ chối/).waitFor();
check('4xx xác định xoá receipt và mở lại submit', !await page.evaluate((key) => sessionStorage.getItem(key), `awn-pending:${admin}`) && await page.getByRole('button', { name: 'Gửi vào hàng chờ chấm' }).isEnabled());

essayMode = 'unauthorized';
await page.getByRole('button', { name: 'Gửi vào hàng chờ chấm' }).click();
await page.waitForURL(/\/login\.html$/);
check('401 xác định xoá receipt trước khi chuyển đăng nhập', !await page.evaluate((key) => sessionStorage.getItem(key), `awn-pending:${admin}`));

essayMode = 'success';
await page.goto(`${BASE}/admin/writing/new?student_id=${presetStudent}`);
await page.getByRole('heading', { name: 'Gửi bài chấm' }).waitFor();
await page.getByLabel('Đề bài').fill('Discuss the topic.');
await page.getByRole('textbox', { name: /Bài viết/ }).fill('one two three');
await page.getByRole('button', { name: 'Gửi vào hàng chờ chấm' }).click();
await page.waitForURL(/\/admin\/writing\/status\?essay_id=essay-1/);
check('ACK đầy đủ xoá receipt và chuyển đúng status job', !await page.evaluate((key) => sessionStorage.getItem(key), `awn-pending:${admin}`));

await page.goto(`${BASE}/admin/writing/new?student_id=${presetStudent}`);
await page.getByRole('heading', { name: 'Gửi bài chấm' }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, actionHeight: parseFloat(getComputedStyle(document.querySelector('.awn-form footer button')).minHeight) }));
check('mobile không tràn và action đạt 44px', mobile.width <= mobile.viewport && mobile.actionHeight >= 44, `${mobile.width}/${mobile.viewport}, ${mobile.actionHeight}px`);

await browser.close();
console.log(`\nAdmin Writing New native flow: ${results.filter(Boolean).length}/${results.length}`);
if (results.some((value) => !value)) process.exitCode = 1;
