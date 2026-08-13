// Fixture-backed browser contract for native Speaking Sessions operations.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000116';
const authSession = JSON.stringify({ access_token: 'admin-speaking-sessions-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-sessions@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__sessionsXss=1">';
let canonical = { status: 'completed', overall_band: 6.5, error_code: null, error_message: null, failed_step: null, last_error_at: null };
let listReads = 0; let detailReads = 0; let delayPractice = false; let detailMode = 'test_part'; let detailPart = 2;
const requests = []; const unexpectedWrites = []; const pageErrors = [];
const baseRow = () => ({ id: 's1', user_id: 'u1', user_email: 'student@example.test', user_lookup_failed: false, mode: 'test_part', part: 2, topic: dangerous, started_at: '2026-08-12T01:00:00Z', completed_at: '2026-08-12T01:10:00Z', band_fc: 6, band_lr: 6.5, band_gra: 6, band_p: 7, ...canonical });
const detailRow = () => ({ ...baseRow(), mode: detailMode, part: detailPart, user_display_name: dangerous, p1_session_id: 's-p1', p2_session_id: 's1', p3_session_id: 's-p3', full_test_siblings_lookup_failed: false, questions_lookup_failed: false, responses_lookup_failed: false, questions: [{ id: 'q1', question_text: dangerous, order_num: 1 }], responses: [{ id: 'r1', question_id: 'q1', transcript: dangerous, overall_band: canonical.overall_band, feedback: { grammar_issues: [dangerous], strengths: ['Clear idea'] }, audio_playback_url: 'javascript:alert(1)', audio_storage_path: 'audio/r1.webm', grading_status: canonical.status === 'grading_failed' ? 'failed' : 'completed', stt_status: 'completed' }] });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), authSession]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); requests.push({ method, path: parsed.pathname, search: parsed.search });
  const key = `${method} ${parsed.pathname}`;
  const allowedWrites = [/^POST \/admin\/responses\/[^/]+\/regrade$/, /^POST \/admin\/sessions\/[^/]+\/(regrade|rebuild-summary)$/, /^POST \/api\/(analytics\/events|error-logs)$/];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !allowedWrites.some((pattern) => pattern.test(key))) unexpectedWrites.push(key);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-sessions@local', role: 'admin' });
  if (method === 'GET' && parsed.pathname === '/admin/sessions') {
    listReads += 1;
    if (parsed.searchParams.get('mode') === 'practice' && delayPractice) await new Promise((resolve) => setTimeout(resolve, 220));
    return json([{ ...baseRow(), mode: parsed.searchParams.get('mode') || 'test_part' }]);
  }
  if (method === 'GET' && parsed.pathname === '/admin/sessions/s1') { detailReads += 1; return json(detailRow()); }
  if (method === 'POST' && parsed.pathname === '/admin/sessions/s1/regrade') {
    canonical = { status: 'grading_failed', overall_band: 6.0, error_code: 'grading_failed', error_message: '1 response vẫn lỗi', failed_step: 'admin_regrade_session', last_error_at: '2026-08-13T00:00:00Z' };
    return json({ ok: false, partial_failure: true, session_id: 's1', regraded: 0, skipped: 0, failed: 1, failed_details: ['r1: grader unavailable'], overall_band: 6.0, band_fc: 6, band_lr: 6, band_gra: 6, band_p: 6 });
  }
  if (method === 'POST' && parsed.pathname === '/admin/sessions/s1/rebuild-summary') {
    canonical = { status: 'completed', overall_band: 6.5, error_code: null, error_message: null, failed_step: null, last_error_at: null };
    return json({ ok: true, sessions: [{ session_id: 's1', ok: true, overall_band: 6.5, band_fc: 6, band_lr: 6.5, band_gra: 6, band_p: 7 }] });
  }
  if (method === 'POST' && parsed.pathname === '/admin/sessions/s-p1/rebuild-summary') {
    return json({ ok: true, sessions: [
      { session_id: 's-p1', ok: true, overall_band: 6.5 },
      { session_id: 's1', ok: true, overall_band: 6.5 },
      { session_id: 's-p3', ok: true, overall_band: 6.5 },
    ] });
  }
  if (method === 'POST' && parsed.pathname === '/admin/responses/r1/regrade') return json({ ok: true, response_id: 'r1', session_id: 's1', overall_band: 6.5, re_transcribed: false, session_updated: true, remaining_failed: 0, session_band: 6.5 });
  return json({});
});

await page.goto(`${BASE}/admin/speaking/sessions?session=s1&mode=test_part`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Sessions & grading', exact: true }).waitFor();
await page.getByRole('dialog').waitFor();
check('admin gate, filter URL và deep-link đều chạy', requests.some((item) => item.path === '/auth/me') && requests.some((item) => item.path === '/admin/sessions' && item.search.includes('mode=test_part')) && detailReads >= 1 && new URL(page.url()).searchParams.get('session') === 's1');
check('hostile text render thành text, không tạo node hay script', await page.locator('.ass-detail-dialog img').count() === 0 && await page.locator('.ass-detail-dialog script').count() === 0 && await page.evaluate(() => !window.__sessionsXss));
check('unsafe audio URL bị loại nhưng storage truth vẫn hiện', await page.getByText('Audio có trong storage nhưng chưa lấy được URL phát an toàn.', { exact: true }).count() === 1 && await page.locator('audio').count() === 0);

await page.keyboard.press('Escape');
await page.waitForURL((url) => !url.searchParams.has('session'));
check('Escape đóng detail và bỏ deep-link khỏi URL', await page.getByRole('dialog').count() === 0 && !new URL(page.url()).searchParams.has('session'));

delayPractice = true;
await page.getByLabel('Mode').selectOption('practice');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.waitForURL((url) => url.searchParams.get('mode') === 'practice');
await page.getByLabel('Mode').selectOption('test_full');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.waitForURL((url) => url.searchParams.get('mode') === 'test_full');
await page.waitForTimeout(300);
check('response filter cũ không ghi đè filter mới', new URL(page.url()).searchParams.get('mode') === 'test_full' && await page.getByText('Full Test', { exact: true }).count() >= 1);
delayPractice = false;

await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByRole('dialog').waitFor();
const readsBeforeRepair = { list: listReads, detail: detailReads };
await page.getByRole('button', { name: 'Repair câu lỗi' }).click();
check('confirm dialog không chồng hai aria-modal', await page.getByRole('dialog').count() === 1 && await page.getByRole('dialog', { name: 'Repair các câu lỗi?' }).count() === 1);
await page.getByRole('button', { name: 'Repair session' }).click();
await page.getByText(/Regrade chỉ hoàn tất một phần.*Session vẫn cần được kiểm tra/).waitFor();
check('partial repair báo lỗi và canonical readback cả detail/list', listReads > readsBeforeRepair.list && detailReads > readsBeforeRepair.detail && await page.getByText('Chấm lỗi', { exact: true }).count() >= 1);

const readsBeforeRebuild = { list: listReads, detail: detailReads };
await page.getByRole('button', { name: 'Tổng hợp lại', exact: true }).click();
await page.getByRole('button', { name: 'Tổng hợp lại', exact: true }).last().click();
await page.getByText('Đã tổng hợp 1 session. Đã đồng bộ lại từ máy chủ.', { exact: true }).waitFor();
check('rebuild success chỉ báo sau canonical readback', listReads > readsBeforeRebuild.list && detailReads > readsBeforeRebuild.detail && await page.getByText('Hoàn tất', { exact: true }).count() >= 1 && await page.getByText('1 response vẫn lỗi', { exact: true }).count() === 0);

detailMode = 'test_full'; detailPart = 2;
await page.keyboard.press('Escape');
await page.waitForURL((url) => !url.searchParams.has('session'));
await page.getByRole('button', { name: 'Kiểm tra' }).click();
await page.getByRole('button', { name: 'Tổng hợp Full Test' }).click();
await page.getByRole('button', { name: 'Tổng hợp lại' }).last().click();
await page.getByText('Đã tổng hợp 3 session. Đã đồng bộ lại từ máy chủ.', { exact: true }).waitFor();
const fullWrite = requests.find((item) => item.method === 'POST' && item.path === '/admin/sessions/s-p1/rebuild-summary');
check('Part 2 dùng đúng P1/P2/P3 canonical khi rebuild Full Test', Boolean(fullWrite) && new URLSearchParams(fullWrite.search).get('p2_id') === 's1' && new URLSearchParams(fullWrite.search).get('p3_id') === 's-p3');

await page.setViewportSize({ width: 1440, height: 900 });
await page.keyboard.press('Escape');
await page.waitForURL((url) => !url.searchParams.has('session'));
const desktop = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, columns: getComputedStyle(document.querySelector('.ass-filters')).gridTemplateColumns.split(' ').length }));
check('desktop filter hierarchy và trang không tràn ngang', !desktop.overflow && desktop.columns >= 6, JSON.stringify(desktop));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Speaking Sessions native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
