// Fixture-backed browser contract for native Admin Writing Prompts.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-writing-prompts-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-prompts@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__promptsXss=1">';
const now = '2026-08-13T00:00:00Z';
const prompt = (overrides = {}) => ({
  id: 'p1', task_type: 'task1_academic', title: dangerous,
  prompt_text: 'The chart below shows energy usage from 2000 to 2020 in enough detail.',
  difficulty: 'intermediate', tags: ['energy'], created_by: adminId,
  is_active: true, exam_only: false, created_at: now, updated_at: now,
  prompt_image_url: 'https://cdn.local/chart.png', prompt_image_public_id: 'prompts/chart.png',
  prompt_image_analysis: { chart_type: 'bar', overview: 'Energy rises overall.', key_features: ['Electricity rises'], notable_data: [{ label: '2020', value: '45', unit: '%' }], axes_or_categories: '2000–2020 · percentage', grading_note: 'Check trend accuracy' },
  prompt_image_analysis_status: 'ready', prompt_image_analysis_reviewed: false,
  prompt_image_analysis_model: 'fixture-vision', prompt_image_analysis_public_id: 'prompts/chart.png',
  prompt_image_analysis_error: null, prompt_image_analysis_at: now,
  ...overrides,
});
let active = [prompt(), prompt({ id: 'p2', task_type: 'task2', title: 'Climate policy', prompt_text: 'Discuss whether governments should prioritise climate policy over economic growth.', difficulty: null, tags: ['climate'], prompt_image_url: null, prompt_image_public_id: null, prompt_image_analysis: null, prompt_image_analysis_status: null, prompt_image_analysis_reviewed: false, prompt_image_analysis_model: null, prompt_image_analysis_public_id: null, prompt_image_analysis_at: null })];
let archived = [prompt({ id: 'p3', task_type: 'task2', title: 'Archived transport prompt', prompt_text: 'Discuss the advantages and disadvantages of public transport investment.', difficulty: 'beginner', tags: ['transport'], is_active: false, prompt_image_url: null, prompt_image_public_id: null, prompt_image_analysis: null, prompt_image_analysis_status: null, prompt_image_analysis_reviewed: false, prompt_image_analysis_model: null, prompt_image_analysis_public_id: null, prompt_image_analysis_at: null })];
let failNextList = false; let failNextCreatedDetail = false; let activeReads = 0; let maxActiveReads = 0;
const requests = []; const mutationBodies = []; const pageErrors = [];

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const path = parsed.pathname;
  requests.push({ method, path, query: parsed.search });
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-writing-prompts@local', role: 'admin' });
  if (path === '/admin/writing/prompts' && method === 'GET') {
    activeReads += 1; maxActiveReads = Math.max(maxActiveReads, activeReads);
    await new Promise((resolve) => setTimeout(resolve, 20)); activeReads -= 1;
    if (failNextList) { failNextList = false; return json({ detail: 'fixture list failed' }, 503); }
    const rows = parsed.searchParams.get('is_active') === 'false' ? archived : active;
    const task = parsed.searchParams.get('task_type'); const difficulty = parsed.searchParams.get('difficulty');
    return json({ prompts: rows.filter((row) => (!task || row.task_type === task) && (!difficulty || row.difficulty === difficulty)) });
  }
  if (path === '/admin/writing/prompts' && method === 'POST') {
    const body = request.postDataJSON(); mutationBodies.push({ path, method, body });
    const row = prompt({ id: 'p-new', ...body, is_active: true, exam_only: false, created_at: now, updated_at: now, prompt_image_analysis: null, prompt_image_analysis_status: null, prompt_image_analysis_reviewed: false, prompt_image_analysis_model: null, prompt_image_analysis_public_id: null, prompt_image_analysis_error: null, prompt_image_analysis_at: null });
    active = [row, ...active]; return json(row, 201);
  }
  if (path === '/admin/writing/prompts/upload-image' && method === 'POST') return json({ url: 'https://cdn.local/new.png', public_id: 'prompts/new.png', width: null, height: null }, 201);
  if (path === '/admin/writing/prompts/discard-image' && method === 'POST') { mutationBodies.push({ path, method, body: request.postDataJSON() }); return json({ discarded: true, public_id: request.postDataJSON().public_id }); }
  const match = path.match(/^\/admin\/writing\/prompts\/([^/]+)(?:\/(analysis|reanalyze))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]); const sub = match[2]; const index = active.findIndex((row) => row.id === id);
    if (method === 'GET' && !sub) {
      if (id === 'p-new' && failNextCreatedDetail) { failNextCreatedDetail = false; return json({ detail: 'fixture readback failed' }, 503); }
      const row = index >= 0 ? active[index] : archived.find((item) => item.id === id);
      return row ? json(row) : json({ detail: 'Prompt not found' }, 404);
    }
    if (method === 'DELETE' && !sub) {
      const [row] = active.splice(index, 1); archived = [{ ...row, is_active: false, prompt_image_url: null, prompt_image_public_id: null, prompt_image_analysis: null, prompt_image_analysis_status: null, prompt_image_analysis_reviewed: false, prompt_image_analysis_model: null, prompt_image_analysis_public_id: null, prompt_image_analysis_error: null, prompt_image_analysis_at: null }, ...archived];
      return json({ message: 'Prompt deactivated', prompt_id: id });
    }
    if (method === 'POST' && sub === 'reanalyze') { active[index] = { ...active[index], prompt_image_analysis_status: 'pending', prompt_image_analysis_reviewed: false }; return json({ status: 'pending', prompt_id: id }, 202); }
    if (method === 'PATCH' && sub === 'analysis') {
      const body = request.postDataJSON(); mutationBodies.push({ path, method, body });
      active[index] = { ...active[index], prompt_image_analysis: body.analysis, prompt_image_analysis_status: 'ready', prompt_image_analysis_reviewed: body.reviewed, prompt_image_analysis_public_id: active[index].prompt_image_public_id, prompt_image_analysis_error: null };
      return json(active[index]);
    }
    if (method === 'PATCH' && !sub) {
      const body = request.postDataJSON(); mutationBodies.push({ path, method, body });
      const source = index >= 0 ? active[index] : archived.find((row) => row.id === id);
      const updated = { ...source };
      for (const [key, value] of Object.entries(body)) updated[key] = value;
      if (body.is_active === true && index < 0) { archived = archived.filter((row) => row.id !== id); updated.is_active = true; active = [updated, ...active]; }
      else active[index] = updated;
      return json(updated);
    }
  }
  return json({});
});

await page.goto(`${BASE}/admin/writing/prompts`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho đề Writing', exact: true }).waitFor();
await page.getByRole('heading', { name: 'Climate policy' }).waitFor();
check('admin gate và hai lifecycle query canonical được dùng', requests.some((item) => item.path === '/auth/me') && requests.filter((item) => item.path === '/admin/writing/prompts' && item.method === 'GET').some((item) => item.query.includes('is_active=true')) && requests.filter((item) => item.path === '/admin/writing/prompts' && item.method === 'GET').some((item) => item.query.includes('is_active=false')));
check('hostile prompt data được React escape', await page.locator('.awp-card img[src="x"]').count() === 0 && await page.evaluate(() => !window.__promptsXss));
check('Task 1 ready hiển thị lane duyệt answer key', await page.getByText('Chờ duyệt', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Duyệt answer key' }).count() === 1);

await page.getByRole('button', { name: 'Duyệt answer key' }).click();
const axes = page.getByLabel('Trục, danh mục hoặc khung thời gian');
check('editor giữ axes_or_categories hiện có', await axes.inputValue() === '2000–2020 · percentage');
await axes.fill('2000–2020 · energy percentage');
await page.getByRole('button', { name: 'Lưu & duyệt' }).click();
await page.getByText(/Đã duyệt answer key/).waitFor();
const analysisWrite = mutationBodies.find((item) => item.path === '/admin/writing/prompts/p1/analysis');
check('duyệt answer key gửi fingerprint và không làm rơi axes', analysisWrite?.body?.expected_image_public_id === 'prompts/chart.png' && analysisWrite?.body?.analysis?.axes_or_categories === '2000–2020 · energy percentage');
check('canonical readback đổi lane thành Đã duyệt', await page.getByText('Đã duyệt', { exact: true }).count() === 1);

const climateCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Climate policy' }) });
await climateCard.getByRole('button', { name: 'Dành cho kỳ thi' }).click();
await page.getByRole('button', { name: 'Chuyển sang đề thi' }).click();
await page.getByText(/Đã áp dụng thay đổi/).waitFor();
check('student → exam mutation được đọc lại canonical', active.find((row) => row.id === 'p2')?.exam_only === true && await climateCard.getByText('Exam only', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Tạo prompt' }).click();
await page.getByLabel('Tiêu đề').fill('New education prompt');
await page.getByLabel('Đề bài').fill('Discuss whether universities should require every student to study environmental science.');
await page.getByLabel('Tags').fill('education, environment');
failNextCreatedDetail = true;
await page.getByRole('button', { name: 'Lưu prompt' }).click();
await page.getByRole('button', { name: 'Thử đối chiếu lại' }).waitFor();
check('create ACK nhưng readback lỗi không được phép POST lần hai', requests.filter((item) => item.path === '/admin/writing/prompts' && item.method === 'POST').length === 1);
await page.getByRole('button', { name: 'Thử đối chiếu lại' }).click();
await page.getByText(/Đã đối chiếu prompt/).waitFor();
check('retry chỉ đối chiếu prompt đã ACK rồi đóng editor', requests.filter((item) => item.path === '/admin/writing/prompts' && item.method === 'POST').length === 1 && active.some((row) => row.id === 'p-new') && await page.getByRole('heading', { name: 'New education prompt' }).count() === 1);

const newCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'New education prompt' }) });
await newCard.getByRole('button', { name: 'Lưu trữ' }).click();
await page.getByRole('button', { name: 'Lưu trữ prompt' }).click();
await page.getByText(/Đã áp dụng thay đổi/).waitFor();
check('archive biến mất khỏi active sau canonical readback', await page.getByRole('heading', { name: 'New education prompt' }).count() === 0 && archived.some((row) => row.id === 'p-new'));

await page.getByRole('button', { name: /Đã lưu trữ/ }).click();
await page.getByRole('heading', { name: 'New education prompt' }).waitFor();
await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'New education prompt' }) }).getByRole('button', { name: 'Khôi phục prompt' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục' }).click();
await page.getByText(/Đã áp dụng thay đổi/).waitFor();
check('restore chuyển row về active canonical', active.some((row) => row.id === 'p-new') && !archived.some((row) => row.id === 'p-new'));

await page.getByRole('button', { name: /Đang hoạt động/ }).click();
await page.getByRole('heading', { name: 'Climate policy' }).waitFor();
failNextList = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Snapshot đang stale', { exact: true }).waitFor();
check('refresh lỗi giữ snapshot và gắn nhãn stale', await page.getByRole('heading', { name: 'Climate policy' }).count() === 1);
check('readAll song song nhưng mỗi lifecycle không tự chồng poll', maxActiveReads <= 2, `max=${maxActiveReads}`);

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, cardDisplay: getComputedStyle(document.querySelector('.awp-card')).display, overview: getComputedStyle(document.querySelector('.awp-overview')).gridTemplateColumns.split(' ').length }));
check('mobile một cột và không tràn viewport', !mobile.overflow && mobile.cardDisplay === 'block' && mobile.overview === 1, JSON.stringify(mobile));
check('không có browser-native confirm/alert', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Prompts native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
