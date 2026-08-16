import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000183';
const session = JSON.stringify({ access_token: 'admin-mock-reviews-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-mock-reviews@local' } });
const requests = [];
const errors = [];
const results = [];
let failRoster = true;
let essayStatus = 'pending';
let review = { id: 'review-1', sitting_id: 'sitting-1', status: 'queued', claimed_by: null, ai_draft: { listening: { band: 7 }, reading: { band: 6.5 }, writing: { band: 6.5 } }, final_bands: {}, per_skill_notes: {}, retest_flags: {}, examiner_comment_vi: '' };

const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}
const roster = () => ({ roster: [{
  sitting_id: 'sitting-1', review_id: 'review-1', student_name: 'Nguyễn An', sitting_status: 'submitted',
  listening: { score: 30, max: 40, band: 7 }, reading: { score: 28, max: 40, band: 6.5 },
  writing: { task1_wc: 170, task2_wc: 280, task1_essay_id: 'essay-1', task2_essay_id: 'essay-2', band: review.final_bands.writing ?? review.ai_draft.writing?.band ?? null, band_is_final: review.final_bands.writing != null },
  speaking: { count: 1, band: review.final_bands.speaking ?? review.ai_draft.speaking?.band ?? null, band_is_final: review.final_bands.speaking != null },
  review_status: review.status, claimed: Boolean(review.claimed_by), needs_retest: false, retest_flags: review.retest_flags,
}] });
const detail = () => ({
  review,
  sitting: { id: 'sitting-1', student_name: 'Nguyễn An', status: 'submitted', listening_attempt_id: 'listen-1', reading_attempt_id: 'read-1', essay_task1_id: 'essay-1', essay_task2_id: 'essay-2', speaking_session_ids: ['session-1'], writing_submission: {} },
  required_skills: ['listening', 'reading', 'writing'], blankable_skills: [],
});
const summary = () => ({ total_sittings: 1, reviewed_sittings: ['reviewed', 'released'].includes(review.status) ? 1 : 0, needs_retest_count: Object.values(review.retest_flags).some(Boolean) ? 1 : 0, per_skill: { listening: review.retest_flags.listening ? 1 : 0, reading: review.retest_flags.reading ? 1 : 0, writing: review.retest_flags.writing ? 1 : 0, speaking: review.retest_flags.speaking ? 1 : 0 }, students: Object.values(review.retest_flags).some(Boolean) ? [{ sitting_id: 'sitting-1', user_id: 'student-1', student_name: 'Nguyễn An', skills: Object.keys(review.retest_flags).filter((key) => review.retest_flags[key]) }] : [] });

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const parsed = new URL(url);
  if (url.startsWith(BASE)) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const method = request.method(); const path = parsed.pathname;
  let body = null; try { body = request.postDataJSON(); } catch { /* no JSON */ }
  requests.push({ method, path, body });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-mock-reviews@local', role: 'admin' });
  if (path === '/admin/mock-exams') return json({ exams: [{ id: 'exam-1', code: 'MOCK-1', title: 'Kỳ thi tháng 8', status: 'published', exam_mode: 'sequential', is_open: false, active_section: 'done' }] });
  if (path === '/admin/mock-exams/exam-1/roster' && method === 'GET') { if (failRoster) return json({ detail: 'fixture roster unavailable' }, 503); return json(roster()); }
  if (path === '/admin/mock-exams/exam-1/retest-summary') return json(summary());
  if (path === '/admin/mock-reviews/review-1' && method === 'GET') return json(detail());
  if (path === '/admin/mock-reviews/review-1/claim' && method === 'POST') { review = { ...review, status: 'claimed', claimed_by: adminId }; return json(review); }
  if (path === '/admin/mock-reviews/review-1/release-claim' && method === 'POST') { review = { ...review, status: 'queued', claimed_by: null }; return json(review); }
  if (path === '/admin/mock-reviews/review-1/speaking-assessment' && method === 'POST') { const overall = Object.values(body.bands).reduce((sum, value) => sum + value, 0) / 4; review = { ...review, ai_draft: { ...review.ai_draft, speaking: { band: overall } }, per_skill_notes: { ...review.per_skill_notes, speaking: body } }; return json({ overall }); }
  if (path === '/admin/mock-reviews/review-1/final-bands' && method === 'POST') { const values = Object.values(body.final_bands); const overall = Math.floor((values.reduce((sum, value) => sum + value, 0) / values.length) * 2 + .5) / 2; review = { ...review, status: 'reviewed', final_bands: { ...body.final_bands, overall }, retest_flags: body.retest_flags || {}, examiner_comment_vi: body.examiner_comment_vi || '' }; return json(review); }
  if (path === '/admin/mock-reviews/review-1/release' && method === 'POST') { review = { ...review, status: 'released' }; return json(review); }
  if (path === '/admin/mock-exams/sittings/sitting-1/retest-flags' && method === 'POST') { review = { ...review, retest_flags: Object.fromEntries(Object.entries(body.retest_flags).filter(([, value]) => value)) }; return json({ retest_flags: review.retest_flags }); }
  if (/^\/admin\/writing\/essays\/essay-[12]\/status$/.test(path)) return json({ status: essayStatus });
  if (/^\/admin\/writing\/essays\/essay-[12]\/start-grading$/.test(path) && method === 'POST') { essayStatus = 'grading'; return json({ status: 'grading' }, 202); }
  if (path === '/api/listening/tests/attempts/listen-1/review') return json({ score: 30, max_score: 40, band_estimate: 7, trap_analytics: { distractor: { caught: 5, missed: 1 } }, review: [{ q_num: 1, user_answer: 'A', expected: 'A', correct: true }] });
  if (path === '/api/reading/test/attempts/read-1/review') return json({ score: 28, max_score: 40, band_estimate: 6.5, skill_breakdown: { matching: { correct: 7, total: 8 } }, review: [{ q_num: 1, user_answer: 'False', expected: 'True', correct: false }] });
  if (path === '/admin/mock-exams/exam-1/bulk-claim') return json({ claimed: [], skipped: [] });
  if (path === '/admin/mock-exams/exam-1/bulk-final-bands') return json({ saved: [], skipped: [] });
  if (path === '/admin/mock-exams/exam-1/bulk-release') return json({ released: [], skipped: [] });
  if (path === '/admin/mock-exams/exam-1/writing/bulk-grade') return json({ queued: [], skipped: [], short: [], retest_skipped: [] }, 202);
  return json({ detail: `unhandled fixture ${method} ${path}` }, 500);
});

await page.goto(`${BASE}/admin/mock-reviews?mock_exam_id=exam-1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Duyệt bài & công bố' }).waitFor();
const rosterError = page.getByText(/Không tải được bảng lớp/);
await rosterError.waitFor();
check('roster lookup lỗi hiển thị unavailable thay vì empty', await page.getByText('Chưa có học viên nào trong kỳ thi này.').count() === 0);
failRoster = false;
await page.getByRole('button', { name: 'Thử lại bảng lớp' }).click();
await page.getByRole('button', { name: 'Nguyễn An' }).waitFor();
check('retry đọc lại roster canonical và giữ định danh kỳ thi', await page.getByText('MOCK-1 — Kỳ thi tháng 8').count() === 1 && requests.filter((item) => item.path === '/admin/mock-exams/exam-1/roster').length >= 2);

const readingRetest = page.locator('.mrr-flags label[title="Reading"] input');
await readingRetest.click();
await page.getByText('Đã đánh dấu Reading cần test lại.').waitFor();
check('cờ test lại gửi full picture rồi refetch roster/summary', requests.some((item) => item.path.endsWith('/retest-flags') && Object.keys(item.body.retest_flags).length === 4) && requests.filter((item) => item.path.endsWith('/retest-summary')).length >= 2);
const clearFlag = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/retest-flags'));
await readingRetest.click();
await clearFlag;
await page.waitForFunction(() => document.querySelector('.mrr-flags label[title="Reading"] input')?.checked === false);
await page.getByRole('button', { name: 'Nguyễn An' }).click();
await page.getByText('Nguyễn An', { exact: true }).waitFor();
await page.locator('.mrr-skill-result').getByText(/Kết quả/).waitFor();
check('detail tải độc lập L/R và trạng thái Writing', ['/api/listening/tests/attempts/listen-1/review', '/api/reading/test/attempts/read-1/review', '/admin/writing/essays/essay-1/status', '/admin/writing/essays/essay-2/status'].every((path) => requests.some((item) => item.path === path)));

await page.getByRole('button', { name: 'Nhận duyệt' }).click();
await page.getByText('Đã nhận hồ sơ.').waitFor();
check('claim chỉ thành công sau readback đúng owner', review.claimed_by === adminId && requests.filter((item) => item.path === '/admin/mock-reviews/review-1').length >= 2);

await page.getByRole('button', { name: 'Writing' }).click();
await page.getByRole('button', { name: 'Bắt đầu chấm' }).first().click();
await page.getByText('Đã đưa Task 1 vào hàng chấm.').waitFor();
check('start grading xác nhận essay rời pending', essayStatus === 'grading' && requests.filter((item) => item.path === '/admin/writing/essays/essay-1/status').length >= 2);

await page.getByRole('button', { name: 'Speaking' }).click();
for (const label of ['Fluency & Coherence', 'Lexical Resource', 'Grammar', 'Pronunciation']) await page.getByRole('spinbutton', { name: label }).fill('7');
await page.getByRole('button', { name: 'Lưu bài chấm Speaking' }).click();
await page.getByText('Đã lưu bài chấm Speaking.').waitFor();
check('Speaking assessment refetch tạo input band extra', Boolean(review.ai_draft.speaking) && await page.locator('a[href="/full-test-result?session_id=session-1"]').count() === 1);

const bandInputs = page.locator('.mrr-band-grid input[type="number"]');
check('band cuối điền sẵn L/R/W/S từ draft canonical', await bandInputs.count() === 4 && await bandInputs.nth(3).inputValue() === '7');
await page.getByLabel('Nhận xét tổng cho học viên').fill('Nền tảng tốt, tiếp tục giữ nhịp.');
await page.getByRole('button', { name: 'Lưu band cuối' }).click();
await page.getByText('Đã lưu band cuối và đọc lại hồ sơ canonical.').waitFor();
check('final bands backend tính overall và canonical status reviewed', review.status === 'reviewed' && review.final_bands.overall === 7);

await page.getByRole('button', { name: 'Công bố kết quả' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận công bố' }).click();
await page.getByText('Đã công bố kết quả cho học viên.').waitFor();
check('release dùng dialog và chỉ đóng sau canonical released', review.status === 'released');

await page.goto(`${BASE}/admin/mock-reviews/report?review_id=review-1&mock_exam_id=exam-1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Phiếu báo điểm' }).waitFor();
const speakingScore = page.locator('.mrr-report-score').filter({ hasText: 'Speaking' });
const overallScore = page.locator('.mrr-report-score').filter({ hasText: 'Overall' });
check('report LRW vẫn hiện Speaking extra và overall canonical', await speakingScore.getByText('7.0', { exact: true }).count() === 1 && await overallScore.getByText('7.0', { exact: true }).count() === 1);

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
check('mobile không tràn ngang', mobile.width <= mobile.viewport, `${mobile.width}/${mobile.viewport}`);
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Mock Reviews native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
