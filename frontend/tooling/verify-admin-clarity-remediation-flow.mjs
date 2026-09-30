// Local W5 proof. Remote APIs are fixtures; tab/detail reads never write data.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
const BASE = process.argv[2] || 'http://127.0.0.1:3110';
const SB = process.env.SUPABASE_URL || 'https://example.supabase.co';
const results = [], writes = [], errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(chrome)) throw error;
  browser = await chromium.launch({ executablePath: chrome });
}
const context = await browser.newContext({ viewport: { width: 1182, height: 757 } });
const session = JSON.stringify({ access_token: 'local-clarity-fixture', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'admin-1', email: 'admin@example.test' } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch {} }, [storageKey(SB), session]);
const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
let attemptMode = 'report';
const counts = [6, 3, 6, 10, 6];
const report = (index) => ({ id: `report-${index}`, status: 'submitted', scoring_policy: 'report_only', score: null, total_questions: counts[index], accuracy: null, duration_seconds: [82, 17, 74, 105, 30][index], created_at: '2026-09-01T00:00:00Z', submitted_at: '2026-09-01T00:00:00Z', user: { id: 'learner-1', display_name: 'Fixture learner' }, test: { id: 'practice-1', test_id: 'PRACTICE-1', title: 'Fixture practice', test_type: 'practice' } });
const partial = { ...report(0), id: 'partial-1', scoring_policy: 'diagnostic' };
const legacyPartial = { ...partial, id: 'legacy-partial', scoring_policy: undefined };
const legacyGraded = { ...partial, id: 'legacy-graded', scoring_policy: undefined, score: 3, total_questions: 6, accuracy: .5 };
const question = (qNum, state, correct = null) => ({ q_num: qNum, state, correct, user_answer: state === 'blank' ? '' : 'Fixture answer', ...(state === 'checked' ? { expected: ['A', 'Alternative'] } : {}) });
const detail = (index) => ({ ...report(index), grading_details: index === 0
  ? [question(1, 'checked', true), question(2, 'checked', false), question(3, 'unscored'), question(4, 'technical_error'), question(5, 'blank'), question(6, 'checked', true)]
  : Array.from({ length: counts[index] }, (_, position) => question(position + 1, 'blank')),
  band_estimate: null, trap_analytics: {}, association_lookup_failed: false, association_lookup_failures: [] });
const exercise = (status, index) => ({ id: `00000000-0000-4000-8000-${String(600 + index).padStart(12, '0')}`, exercise_type: 'D1', status,
  content_payload: { sentence: 'Fixture sentence.', answer: 'fixture', distractors: ['other', 'third'] }, created_at: '2026-09-01T00:00:00Z', reviewed_at: null });
await context.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
  if (url.origin === new URL(BASE).origin) return route.continue();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^\/api\/(analytics\/events|error-logs)$/.test(path)) writes.push(`${method} ${path}`);
  const json = (value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/auth/me') return json({ id: 'admin-1', email: 'admin@example.test', role: 'admin', is_active: true });
  if (path === '/admin/listening/attempts') {
    const items = attemptMode === 'report' ? [...counts.map((_, index) => report(index)), partial, legacyPartial, legacyGraded] : [partial];
    return json({ items, total: items.length, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
  }
  const reportMatch = path.match(/^\/admin\/listening\/attempts\/report-(\d+)$/);
  if (reportMatch) return json(detail(Number(reportMatch[1])));
  if (path === '/admin/exercises') { const status = url.searchParams.get('status'); return json(status === 'rejected' ? [] : [exercise(status, status === 'published' ? 1 : 0)]); }
  if (path === '/admin/listening/tests') return json({ items: [{ id: 'mixed-1', test_id: 'LIS-1', title: 'Mixed audio fixture', status: 'published', test_type: 'mini', is_public: true, exam_only: false, section_count: 1, audio_ready_count: 0, full_audio_storage_path: 'fixture/full.mp3', accent_profile: [], band_target: null, created_at: '2026-09-01T00:00:00Z' }], total: 1, limit: 20, offset: 0 });
  return json({});
});
try {
  await page.goto(`${BASE}/admin/writing`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Writing workspace', exact: true }).waitFor();
  const hubText = await page.locator('.wth-shell').innerText();
  check('A-UX05 Writing hub explains work without internal migration jargon', !/\b(NATIVE|MIGRATING|ACK|canonical|readback|atomic)\b/i.test(hubText) && hubText.includes('Đối chiếu kết quả gửi'));

  await page.goto(`${BASE}/admin/listening/attempts?type=practice&status=submitted`, { waitUntil: 'domcontentloaded' });
  await page.locator('.ala-table tbody tr').first().waitFor();
  check('A-DATA04 all five explicit report-only rows remain visible without fabricated scores', await page.locator('.ala-table tbody tr').count() === 6 && await page.locator('.ala-table td[data-label="Kết quả"] strong').filter({ hasText: /^Không tính điểm$/ }).count() === 5);
  check('A-DATA04 totals, omitted invalid rows and legacy policy remain explicit', await page.getByText(/8 lượt theo bộ lọc · 6 lượt hiển thị trên trang/).count() === 1 && await page.getByText(/Chưa hiển thị 2 dòng/).count() === 1 && await page.getByText('Chưa xác minh chính sách tính điểm', { exact: true }).count() === 1);
  for (let index = 0; index < counts.length; index += 1) {
    await page.locator(`[data-attempt-id="report-${index}"]`).getByRole('button', { name: 'Xem từng câu' }).click();
    await page.locator('.ala-question-table tbody tr').first().waitFor();
    const rows = page.locator('.ala-question-table tbody tr');
    check(`A-DATA04 report-only detail ${index} preserves ${counts[index]} question rows`, await rows.count() === counts[index] && await page.getByText(/Không tính điểm: kết quả từng câu/).count() === 1 && await page.locator('.ala-detail__summary').getByText('Không quy đổi', { exact: true }).count() === 1);
    if (index === 0) {
      const stateLabels = await rows.locator('td[data-label="Kết quả"]').allTextContents();
      check('A-DATA04 blank/unscored/technical states never become incorrect grades', JSON.stringify(stateLabels) === JSON.stringify(['✓', '✕', 'Tự đối chiếu', 'Lỗi kiểm tra', 'Bỏ trống', '✓']) && await rows.nth(4).getAttribute('class') === '' && await rows.nth(0).locator('td[data-label="Đáp án"]').innerText() === 'A / Alternative');
    }
    await page.locator('.ala-detail').getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'));
  }
  attemptMode = 'partial';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Chưa hiển thị được lượt nào trên trang này', { exact: true }).waitFor();
  check('A-DATA04 diagnostic partial result remains warned and never claims an empty history', await page.getByText(/Chưa hiển thị 1 dòng/).count() === 1 && await page.getByText('Không có lượt làm bài phù hợp', { exact: true }).count() === 0);

  await page.goto(`${BASE}/admin/vocab/exercises`, { waitUntil: 'domcontentloaded' });
  const published = page.getByRole('tab', { name: 'Đã phát hành 1' });
  await published.waitFor();
  await published.click();
  check('A-UX06 Published tab only selects the published view', await published.getAttribute('aria-selected') === 'true' && new URL(page.url()).searchParams.get('status') === 'published' && await page.getByRole('button', { name: 'Rút bài đã phát hành', exact: true }).count() === 1 && writes.length === 0);
  await page.keyboard.press('ArrowLeft');
  const draft = page.getByRole('tab', { name: 'Bản nháp 1' });
  check('A-UX06 keyboard tab change only selects draft and keeps publish action distinct', await draft.getAttribute('aria-selected') === 'true' && await page.getByRole('button', { name: 'Phát hành bài', exact: true }).count() === 1 && await page.getByRole('dialog').count() === 0 && writes.length === 0);

  await page.goto(`${BASE}/admin/listening/tests`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Mixed audio fixture', { exact: true }).waitFor();
  check('A-DATA02 section-only audio denominator does not claim full audio missing', await page.getByText('0/1 section có audio', { exact: true }).count() === 1 && await page.getByText(/chỉ đếm các section có file riêng, không tính audio full test hoặc bản ghép/).count() === 1);
  check('W5 read journeys never write business data', writes.length === 0, writes.join(', '));
  check('W5 has no JavaScript exceptions', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
const failed = results.filter((result) => !result.ok);
console.log(`Admin clarity remediation: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
