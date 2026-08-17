import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000183';
const session = JSON.stringify({ access_token: 'admin-mock-live-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-mock-live@local' } });
const requests = [];
const errors = [];
const results = [];
let activeSection = 'listening';
let collectedSection = null;
let collectionSweepCompletedSection = null;
let isOpen = true;
let missedListening = 0;
let sittingExists = true;

const exams = [
  { id: 'exam-1', code: 'LIVE-1', title: 'Lớp C1 · Full Test', status: 'published', exam_mode: 'sequential', is_open: true, active_section: 'listening' },
  { id: 'retake-1', code: 'RETAKE-1', title: 'Test lại', status: 'published', exam_mode: 'retake', is_open: true, active_section: 'not_started' },
  { id: 'draft-1', code: 'DRAFT-1', title: 'Không được admit', status: 'draft', exam_mode: 'sequential' },
];

const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

function liveSnapshot() {
  const listeningState = !sittingExists ? 'absent' : missedListening ? 'missed' : activeSection === 'listening' ? 'working' : 'submitted';
  const readingState = !sittingExists ? 'absent' : activeSection === 'reading' ? 'working' : 'waiting';
  const writingState = !sittingExists ? 'absent' : 'waiting';
  return {
    exam: {
      id: 'exam-1', code: 'LIVE-1', title: 'Lớp C1 · Full Test', exam_mode: 'sequential', status: 'published',
      is_open: isOpen, active_section: activeSection, collected_section: collectedSection,
      collection_sweep_completed_section: collectionSweepCompletedSection,
      section_started_at: '2026-08-16T08:00:00Z', section_duration_seconds: 1800,
      section_time_left_seconds: collectedSection === activeSection ? null : 510,
      configured_sections: ['listening', 'reading', 'writing'], cohort_id: 'cohort-1',
    },
    roster: { expected: 1, started: sittingExists ? 1 : 0, not_started: sittingExists ? [] : ['Nguyễn An'], off_roster: [] },
    sections: {
      listening: { submitted: listeningState === 'submitted' ? 1 : 0, working: listeningState === 'working' ? 1 : 0, absent: listeningState === 'absent' ? 1 : 0, missed: missedListening, expected: 1 },
      reading: { submitted: 0, working: readingState === 'working' ? 1 : 0, absent: readingState === 'absent' ? 1 : 0, missed: 0, expected: 1 },
      writing: { submitted: 0, working: 0, absent: writingState === 'absent' ? 1 : 0, missed: 0, expected: 1 },
    },
    students: [{
      user_id: 'student-1', student_name: 'Nguyễn An', sitting_id: sittingExists ? 'sitting-1' : null,
      status: sittingExists ? 'lrw_in_progress' : 'chưa vào', started: sittingExists, in_roster: true, needs_retest: false,
      sections: {
        listening: { state: listeningState, answered: listeningState === 'working' ? 0 : null, total: 40, submitted_at: listeningState === 'submitted' ? '2026-08-16T08:30:00Z' : null, last_activity_at: null, live: true, stalled: false },
        reading: { state: readingState, answered: readingState === 'working' ? 12 : null, total: 40, submitted_at: null, last_activity_at: readingState === 'working' ? '2026-08-16T08:40:00Z' : null, live: true, stalled: false },
        writing: { state: writingState, answered: null, total: null, submitted_at: null, last_activity_at: null, live: true, stalled: false },
      },
      speaking: { required: true, count: 2, completed_at: null },
      integrity: { blur_count: 1, blur_seconds: 35, offline_events: 1, resumes: 1 },
    }],
    server_time: '2026-08-16T08:45:00Z',
  };
}

const pacing = {
  sitting_id: 'sitting-1', exam_id: 'exam-1', student_name: 'Nguyễn An', exam_code: 'LIVE-1', status: 'lrw_in_progress',
  caveats: { answered_at_is_last_touch: true, gap_is_time_since_previous_answer: true },
  sections: {
    listening: {
      started_at: '2026-08-16T08:00:00Z', ended_at: '2026-08-16T08:30:00Z', answered: 1, total: 40,
      timeline: [
        { q_num: 1, at: '2026-08-16T08:00:20Z', gap_seconds: 20, is_answered: true },
        { q_num: 3, at: '2026-08-16T08:03:40Z', gap_seconds: 200, is_answered: false },
      ], answers_in_final_minutes: 0, idle_tail_seconds: 1580, worked_in_paper_order: true,
    },
    reading: { started_at: '2026-08-16T08:35:00Z', ended_at: null, answered: 12, total: 40, timeline: [], answers_in_final_minutes: null, idle_tail_seconds: null, worked_in_paper_order: null },
    writing: { started_at: null, ended_at: null, tasks: [{ task: 'task1', word_count: 146, last_saved_at: '2026-08-16T09:00:00Z' }, { task: 'task2', word_count: 231, last_saved_at: '2026-08-16T09:20:00Z' }] },
  },
};

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
page.on('dialog', (dialog) => void dialog.accept());
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const parsed = new URL(url);
  if (url.startsWith(BASE)) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const method = request.method();
  let body = null;
  try { body = request.postDataJSON(); } catch { /* no JSON body */ }
  requests.push({ method, path: parsed.pathname, search: parsed.search, body });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-mock-live@local', role: 'admin' });
  if (parsed.pathname === '/admin/mock-exams' && method === 'GET') return json({ exams });
  if (parsed.pathname === '/admin/mock-exams/exam-1/live' && method === 'GET') return json(liveSnapshot());
  if (parsed.pathname === '/admin/mock-exams/invalid/live' && method === 'GET') return json({ detail: 'must not be called' }, 500);
  if (parsed.pathname === '/admin/mock-exams/exam-1/open' && method === 'POST') {
    isOpen = body?.is_open === true;
    return json({ is_open: isOpen });
  }
  if (parsed.pathname === '/admin/mock-exams/exam-1/collect' && method === 'POST') {
    const target = parsed.searchParams.get('section') || activeSection;
    if (!parsed.searchParams.get('section')) {
      collectedSection = activeSection;
      collectionSweepCompletedSection = null;
    }
    return json({ queued: true, section: target, pending: 1 }, 202);
  }
  if (parsed.pathname === '/admin/mock-exams/exam-1/advance' && method === 'POST') {
    if (body?.from_section !== activeSection) return json({ detail: 'stale' }, 409);
    activeSection = activeSection === 'listening' ? 'reading' : 'writing';
    collectedSection = null;
    collectionSweepCompletedSection = null;
    missedListening = 1;
    return json({ active_section: activeSection });
  }
  if (parsed.pathname === '/admin/mock-exams/sittings/sitting-1/void' && method === 'POST') {
    sittingExists = false;
    return json({ id: 'sitting-1', status: 'void' });
  }
  if (parsed.pathname === '/admin/mock-exams/sittings/sitting-1/pacing' && method === 'GET') return json(pacing);
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 500);
});

await page.goto(`${BASE}/admin/mock-live?exam_id=exam-1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Phòng thi trực tiếp' }).waitFor();
await page.getByText('LIVE-1', { exact: true }).first().waitFor();
check('admin gate, published inventory và exact live snapshot chạy', ['/auth/me', '/admin/mock-exams', '/admin/mock-exams/exam-1/live'].every((path) => requests.some((item) => item.path === path)));
check('blank persisted state lọt vào danh sách cần chú ý', await page.getByRole('button', { name: /Cần chú ý 1/ }).count() === 1 && await page.getByText('trắng', { exact: true }).count() >= 1);

await page.getByRole('button', { name: /^Thu bài \(/ }).click();
await page.getByText('Đã đóng phần Listening và xếp hàng thu bài.').waitFor();
check('collect gửi exact from_section và khóa advance khi sweep chưa xong',
  requests.some((item) => item.path === '/admin/mock-exams/exam-1/collect' && item.search.includes('from_section=listening'))
    && await page.getByRole('button', { name: 'Đang thu bài…' }).isDisabled()
    && await page.getByText(/Đang đồng bộ và thu Listening/).count() === 1);

collectionSweepCompletedSection = 'listening';
await page.getByRole('button', { name: 'Cập nhật ngay' }).click();
await page.getByRole('button', { name: 'Mở Reading →' }).waitFor();
check('canonical sweep completion mở lại advance và chuyển sang nhịp nghỉ',
  await page.getByRole('button', { name: 'Mở Reading →' }).isEnabled()
    && await page.getByText(/đang nghỉ/).count() === 1);

await page.getByRole('button', { name: 'Mở Reading →' }).click();
await page.getByText('Đã chuyển sang Reading.').waitFor();
check('advance gửi stale-screen guard và chỉ thành công sau active section đổi', requests.some((item) => item.path === '/admin/mock-exams/exam-1/advance' && item.body?.from_section === 'listening') && await page.getByText('Reading', { exact: true }).count() >= 1);

await page.getByRole('button', { name: 'Thu lại Listening' }).click();
await page.getByText('Đã xếp hàng thu lại Listening').waitFor();
check('recovery gửi section cũ và from_section hiện tại, không giả vờ sweep đã xong', requests.some((item) => item.path === '/admin/mock-exams/exam-1/collect' && item.search.includes('section=listening') && item.search.includes('from_section=reading')) && await page.getByText(/còn 1 bài chưa thu/).count() >= 1);

await page.goto(`${BASE}/admin/mock-pacing?sitting=sitting-1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Nguyễn An' }).waitFor();
check('pacing giữ caveat last-touch và cleared-save không tính là đáp án', await page.getByText(/lần sửa cuối cùng/).count() === 1 && await page.locator('.mpn-bar.is-cleared').count() === 1 && await page.getByText('1/40', { exact: true }).count() === 1);
check('pacing back-link trả đúng exam canonical', (await page.getByRole('link', { name: 'Về đúng phòng thi' }).getAttribute('href')) === '/admin/mock-live?exam_id=exam-1');

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, button: parseFloat(getComputedStyle(document.querySelector('.mpn-hero .adm-btn-secondary')).minHeight) }));
check('pacing mobile không tràn ngang và back action đạt 44px', mobile.width <= mobile.viewport && mobile.button >= 44, `${mobile.width}/${mobile.viewport}, ${mobile.button}px`);

await page.goto(`${BASE}/admin/mock-live?exam_id=exam-1`, { waitUntil: 'domcontentloaded' });
await page.getByText('Nguyễn An', { exact: true }).waitFor();
await page.setViewportSize({ width: 1440, height: 980 });
await page.getByRole('button', { name: 'Huỷ lượt' }).click();
const desktopDialog = await page.evaluate(() => {
  const backdrop = document.querySelector('.acd-dialog-backdrop');
  const panel = document.querySelector('.acd-dialog');
  if (!backdrop || !panel) return null;
  const rect = panel.getBoundingClientRect();
  return { position: getComputedStyle(backdrop).position, panelWidth: rect.width, centerDelta: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) };
});
check('void dialog có backdrop cố định và panel căn giữa ở desktop', desktopDialog?.position === 'fixed' && desktopDialog.panelWidth <= 520 && desktopDialog.centerDelta <= 2, JSON.stringify(desktopDialog));
await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Huỷ lượt' }).click();
const mobileDialog = await page.evaluate(() => {
  const backdrop = document.querySelector('.acd-dialog-backdrop');
  const panel = document.querySelector('.acd-dialog');
  const action = document.querySelector('.acd-dialog__actions button');
  if (!backdrop || !panel || !action) return null;
  const rect = panel.getBoundingClientRect();
  const actions = document.querySelector('.acd-dialog__actions');
  const actionStyle = actions ? getComputedStyle(actions) : null;
  const actionContentWidth = actions && actionStyle ? actions.getBoundingClientRect().width - parseFloat(actionStyle.paddingLeft) - parseFloat(actionStyle.paddingRight) : 0;
  return { align: getComputedStyle(backdrop).alignItems, bottomDelta: Math.abs(innerHeight - rect.bottom), actionWidth: action.getBoundingClientRect().width, actionContentWidth, panelWidth: rect.width };
});
check('void dialog thành bottom sheet và action full-width ở mobile', mobileDialog?.align === 'end' && mobileDialog.bottomDelta <= 2 && mobileDialog.actionWidth >= mobileDialog.actionContentWidth - 2, JSON.stringify(mobileDialog));
await page.getByRole('dialog').getByLabel('Lý do huỷ *').fill('Mở nhầm đề; chưa bắt đầu làm');
await page.getByRole('dialog').getByRole('button', { name: 'Huỷ lượt thi' }).click();
await page.getByText('Đã huỷ lượt thi của Nguyễn An.').waitFor();
check('void dùng dialog bắt buộc lý do và canonical absence, không prompt', requests.some((item) => item.path === '/admin/mock-exams/sittings/sitting-1/void' && item.body?.reason === 'Mở nhầm đề; chưa bắt đầu làm') && await page.getByRole('button', { name: 'Huỷ lượt' }).count() === 0);

const invalidCallsBefore = requests.filter((item) => item.path === '/admin/mock-exams/invalid/live').length;
await page.goto(`${BASE}/admin/mock-live?exam_id=invalid`, { waitUntil: 'domcontentloaded' });
await page.getByText(/Kỳ thi trong URL chưa publish/).waitFor();
check('invalid deep-link fail-closed, không âm thầm fallback sang lớp khác', requests.filter((item) => item.path === '/admin/mock-exams/invalid/live').length === invalidCallsBefore && await page.locator('.mlv-identity').count() === 0);
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Mock Live/Pacing native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
