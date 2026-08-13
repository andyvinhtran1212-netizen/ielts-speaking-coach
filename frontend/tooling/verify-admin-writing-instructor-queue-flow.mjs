// Fixture-backed browser contract for native Admin Writing Instructor Queue.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000124';
const session = JSON.stringify({ access_token: 'admin-writing-instructor-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-instructor@local' } });
const dangerous = '<img src=x onerror="window.__instructorXss=1">';
const results = []; const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const now = '2026-08-13T00:00:00Z';
const review = (id, essayId, status, claimedBy = null) => ({ id, essay_id: essayId, status, claimed_by: claimedBy, claimed_at: claimedBy ? now : null, delivered_at: status === 'delivered' ? now : null, instructor_note: null, created_at: now, updated_at: now });
const item = (id, essayId, status, claimedBy = null, email = `${id}@local`) => ({ review: review(id, essayId, status, claimedBy), essay_id: essayId, student_email: email, student_level: 3, task_type: 'task2', submitted_at: now, age_hours: status === 'queued' ? 52 : 8, is_overdue: status === 'queued' });

const browser = await launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);

async function fixturePage({ rows, onPost, failAfter = Infinity, shouldFail = () => false, pending = null }) {
  const page = await context.newPage(); const requests = []; let getCount = 0;
  page.on('pageerror', (error) => errors.push(String(error)));
  if (pending) await page.addInitScript(([key, value]) => { if (location.pathname === '/admin/writing/instructor-queue') sessionStorage.setItem(key, value); }, [`awiq-pending:${adminId}`, JSON.stringify(pending)]);
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = request.url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
    const parsed = new URL(url); const path = parsed.pathname; const method = request.method(); requests.push({ path, method, query: parsed.search });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/me') return json({ id: adminId, email: 'admin-writing-instructor@local', role: 'admin' });
    if (path === '/admin/instructor/queue') { getCount += 1; if (shouldFail() || getCount > failAfter) return json({ detail: 'fixture queue failure' }, 503); return json(rows(parsed)); }
    if (method === 'POST' && path.startsWith('/admin/instructor/reviews/')) return onPost ? onPost({ path, json, requests }) : json({ detail: 'unexpected POST' }, 500);
    return json({ detail: `unhandled ${method} ${path}` }, 500);
  });
  return { page, requests };
}

// Claim: exact ACK, GET readback, then native grade navigation with cockpit flags.
let claimState = 'queued';
const claimFx = await fixturePage({
  rows: () => [item('r1', 'e1', claimState, claimState === 'claimed' ? adminId : null, dangerous), item('r2', 'e2', 'edited', adminId), item('r3', 'e3', 'claimed', 'another-admin'), { bad: true }],
  onPost: ({ path, json }) => { if (path.endsWith('/r1/claim')) { claimState = 'claimed'; return json(review('r1', 'e1', 'claimed', adminId)); } return json({ detail: 'unexpected mutation' }, 500); },
});
await claimFx.page.goto(`${BASE}/admin/writing/instructor-queue?embed=1&mocklane=1`, { waitUntil: 'domcontentloaded' });
await claimFx.page.getByRole('heading', { name: 'Hàng đợi Instructor', exact: true }).waitFor(); await claimFx.page.getByText('Đã sửa · chờ trả', { exact: true }).waitFor();
check('admin gate và active query gồm edited', claimFx.requests.some((r) => r.path === '/auth/me') && claimFx.requests.some((r) => r.path === '/admin/instructor/queue' && r.query.includes('status=edited')));
check('edited review vẫn hiện ở active queue', await claimFx.page.getByText('r2@local', { exact: true }).count() === 1);
check('hostile email hiển thị như text', await claimFx.page.evaluate(() => window.__instructorXss !== 1));
check('embed mode được đặt trên admin chrome', await claimFx.page.locator('aver-admin-chrome').getAttribute('embed') === '');
await claimFx.page.getByRole('button', { name: 'Claim & mở bài' }).click();
await claimFx.page.waitForURL(/\/admin\/writing\/grade\?essay_id=e1&embed=1&mocklane=1/);
check('claim chỉ POST một lần rồi GET readback giới hạn theo essay', claimFx.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/r1/claim')).length === 1 && claimFx.requests.some((r) => r.path === '/admin/instructor/queue' && new URLSearchParams(r.query).get('essay_id') === 'e1'));
check('claim mở grade canonical và giữ cockpit flags', new URL(claimFx.page.url()).pathname === '/admin/writing/grade' && new URL(claimFx.page.url()).searchParams.get('embed') === '1' && new URL(claimFx.page.url()).searchParams.get('mocklane') === '1');
await claimFx.page.close();

// Release: accessible dialog, exact ACK and canonical readback before success.
let releaseState = 'edited';
const releaseFx = await fixturePage({
  rows: (url) => {
    const current = releaseState === 'edited' ? item('r2', 'e2', 'edited', adminId) : item('r2', 'e2', 'queued');
    return url.searchParams.has('instructor_id') && current.review.claimed_by !== adminId ? [] : [current];
  },
  onPost: ({ path, json }) => { if (path.endsWith('/r2/release')) { releaseState = 'queued'; return json(review('r2', 'e2', 'queued')); } return json({ detail: 'unexpected mutation' }, 500); },
});
await releaseFx.page.goto(`${BASE}/admin/writing/instructor-queue?view=my_claims`, { waitUntil: 'domcontentloaded' });
await releaseFx.page.getByRole('button', { name: 'Thả bài' }).waitFor(); await releaseFx.page.getByRole('button', { name: 'Thả bài' }).click();
check('release dùng dialog accessible thay browser confirm', await releaseFx.page.getByRole('dialog', { name: 'Thả bài về hàng chờ?' }).count() === 1);
await releaseFx.page.getByRole('button', { name: 'Xác nhận thả bài' }).click(); await releaseFx.page.getByText('Đã xác nhận thả bài', { exact: true }).waitFor();
check('release chỉ POST một lần và đối chiếu GET giới hạn theo essay', releaseFx.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/r2/release')).length === 1 && releaseFx.requests.some((r) => r.path === '/admin/instructor/queue' && new URLSearchParams(r.query).get('essay_id') === 'e2'));
check('my claims rỗng sau canonical readback', await releaseFx.page.getByText('Bạn chưa giữ bài nào', { exact: true }).count() === 1);
await releaseFx.page.close();

// Reload recovery: a pending receipt only performs GET reconciliation, never POST.
const pending = { account: adminId, action: 'claim', reviewId: 'r4', essayId: 'e4', startedAt: now };
const recoveryFx = await fixturePage({ rows: () => [item('r4', 'e4', 'edited', adminId)], pending });
await recoveryFx.page.goto(`${BASE}/admin/writing/instructor-queue`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await recoveryFx.page.waitForFunction(() => location.pathname === '/admin/writing/grade' && new URLSearchParams(location.search).get('essay_id') === 'e4');
const recoveryPosts = recoveryFx.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/admin/instructor/reviews/'));
check('reload đối chiếu pending bằng GET, không replay POST', recoveryPosts.length === 0 && recoveryFx.requests.filter((r) => r.path === '/admin/instructor/queue').length >= 1, recoveryPosts.map((r) => r.path).join(', '));
const storedAfterRecovery = await recoveryFx.page.evaluate((key) => sessionStorage.getItem(key), `awiq-pending:${adminId}`);
check('biên nhận được xoá sau readback thành công', storedAfterRecovery === null, String(storedAfterRecovery));
await recoveryFx.page.close();

// A pending claim whose canonical row is still queued is conclusively absent:
// clear the receipt, stay on the queue and allow a deliberate new claim.
const absentPending = { account: adminId, action: 'claim', reviewId: 'r6', essayId: 'e6', startedAt: now };
const absentFx = await fixturePage({ rows: () => [item('r6', 'e6', 'queued')], pending: absentPending });
await absentFx.page.goto(`${BASE}/admin/writing/instructor-queue`, { waitUntil: 'domcontentloaded' });
await absentFx.page.getByText('Claim chưa được ghi nhận', { exact: true }).waitFor();
check('pending claim vẫn queued được kết luận không xảy ra, không POST', absentFx.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/admin/instructor/reviews/')).length === 0 && await absentFx.page.getByRole('button', { name: 'Claim & mở bài' }).count() === 1);
check('receipt claim không xảy ra được xoá để cho phép thử lại', await absentFx.page.evaluate((key) => sessionStorage.getItem(key), `awiq-pending:${adminId}`) === null);
await absentFx.page.close();

// An unresolved receipt is the one global mutation lock. A failed readback
// must not allow another row to POST and overwrite that receipt.
let failPendingReadback = false;
const lockedFx = await fixturePage({
  rows: () => [item('r7', 'e7', 'queued'), item('r8', 'e8', 'queued')],
  shouldFail: () => failPendingReadback,
  onPost: ({ path, json }) => {
    if (path.endsWith('/r7/claim')) { failPendingReadback = true; return json({ detail: 'response lost' }, 503); }
    return json({ detail: 'second mutation must stay blocked' }, 500);
  },
});
await lockedFx.page.goto(`${BASE}/admin/writing/instructor-queue`, { waitUntil: 'domcontentloaded' });
const claimButtons = lockedFx.page.getByRole('button', { name: 'Claim & mở bài' }); await claimButtons.first().click();
await lockedFx.page.getByText('Chưa đối chiếu được thao tác', { exact: true }).waitFor();
check('failed readback khóa mọi mutation và giữ đúng receipt đầu', await claimButtons.count() === 2 && await claimButtons.first().isDisabled() && await claimButtons.nth(1).isDisabled() && JSON.parse(await lockedFx.page.evaluate((key) => sessionStorage.getItem(key), `awiq-pending:${adminId}`)).reviewId === 'r7');
await claimButtons.nth(1).click({ force: true });
check('mutation thứ hai không POST và không ghi đè receipt', lockedFx.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/admin/instructor/reviews/')).length === 1 && JSON.parse(await lockedFx.page.evaluate((key) => sessionStorage.getItem(key), `awiq-pending:${adminId}`)).reviewId === 'r7');
await lockedFx.page.close();

// Stale snapshot and responsive containment.
let failStaleRefresh = false;
const staleFx = await fixturePage({ rows: () => [item('r5', 'e5', 'queued')], shouldFail: () => failStaleRefresh });
await staleFx.page.goto(`${BASE}/admin/writing/instructor-queue`, { waitUntil: 'domcontentloaded' }); await staleFx.page.getByText('r5@local', { exact: true }).waitFor();
failStaleRefresh = true;
await staleFx.page.getByRole('button', { name: 'Làm mới canonical' }).click(); await staleFx.page.getByText('Đang hiển thị snapshot cũ', { exact: true }).waitFor();
check('refresh lỗi giữ snapshot và gắn nhãn stale', await staleFx.page.getByText('r5@local', { exact: true }).count() === 1);
await staleFx.page.setViewportSize({ width: 390, height: 844 });
check('mobile không tràn page và actions đủ cao', await staleFx.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && parseFloat(getComputedStyle(document.querySelector('.awi-row__actions button')).minHeight) >= 44));
check('không có browser alert/confirm và lỗi JS', errors.length === 0, errors.join(' | '));
await staleFx.page.close();

await browser.close(); const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Instructor Queue native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
