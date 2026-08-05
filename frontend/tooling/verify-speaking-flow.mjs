// Kiểm LUỒNG của `/speaking-preview` mà KHÔNG cần backend, KHÔNG cần secret.
//
// VÌ SAO TỒN TẠI: `tests/staging-e2e/speaking-start-flow.spec.js` là bản chạy ở
// CI, nhưng nó cần `E2E_PASSWORD` và cần nhánh `staging` đã có mã — tức KHÔNG
// chạy được lúc viết. Một test chưa từng chạy thường là một test hỏng. Script
// này chạy CÙNG luồng đó trên bản dựng cục bộ, chặn mọi lời gọi mạng và trả sẵn
// dữ liệu, nên nó trả lời được đúng câu hỏi mà cổng parity không trả lời được:
// **bấm nút thì có gửi đúng thứ đi không**.
//
// KHÔNG thay thế bản staging: ở đây backend là giả, nên nó không chứng minh
// phiên được TẠO THẬT. Nó chỉ chứng minh phía trình duyệt gửi đúng.
//
//   node tooling/verify-speaking-flow.mjs [base]      (mặc định http://localhost:3011)
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/speaking-preview';

const fakeSession = JSON.stringify({
  access_token: 'verify-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000000', email: 'flow@local' },
});

/** Dữ liệu trả sẵn cho từng endpoint — đủ để trang dựng xong, không hơn. */
const CANNED = [
  [/\/auth\/me$/, { id: 'u1', display_name: 'Học Viên', permissions: ['all'] }],
  [/\/topics\?part=/, [{ title: 'Chủ đề mẫu', category: 'Daily life' }]],
  [/\/api\/dashboard\/init$/, { summary: { total_sessions: 0 }, sessions: [] }],
  [/\/sessions\?/, { sessions: [], total: 0, total_pages: 0, page: 1 }],
  [/\/api\/grammar\/dashboard-data$/, {}],
  [/\/api\/mock-exams\/my-sittings$/, { sittings: [] }],
  [/\/api\/flashcards\/due\/count$/, { count: 0 }],
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(([k, v]) => {
  try { localStorage.setItem(k, v); } catch (_) {}
}, [storageKey(SB), fakeSession]);

const page = await ctx.newPage();
let sessionPost = null;

// Chặn MỌI request ra ngoài origin cục bộ: backend là giả, và ta muốn thấy
// chính xác cái gì được gửi đi.
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

  if (req.method() === 'POST' && /\/sessions$/.test(url)) {
    sessionPost = JSON.parse(req.postData() || '{}');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'sess-verify-1' }),
    });
  }
  for (const [re, body] of CANNED) {
    if (re.test(url)) {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
      });
    }
  }
  // CDN (lucide, supabase-js, chart.js) đi thật — chúng là hành vi trang thật.
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) {
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

check('trang ở nguyên route (không bị đẩy về login)',
  page.url().includes(ROUTE), page.url());

// ── 1. Mở panel Luyện tập bằng thẻ mode ─────────────────────────────────────
await page.locator('.mode-card[data-mode="practice"]').first().click();
await page.waitForTimeout(300);
check('thẻ mode mở đúng panel Luyện tập',
  await page.locator('#tab-practice').evaluate((el) => el.classList.contains('active')));

// ── 2. Chọn Part 2 ──────────────────────────────────────────────────────────
await page.locator('#prac-tp-part-2').click();
await page.waitForTimeout(600);
check('nút Part 2 được đánh dấu đã chọn',
  await page.locator('#prac-tp-part-2').evaluate((el) => el.classList.contains('selected')));
check('danh sách chủ đề nạp xong (select được bật)',
  await page.locator('#prac-topic-select').isEnabled());

// ── 3. Bấm khi CHƯA có chủ đề ⇒ báo lỗi, KHÔNG gửi ──────────────────────────
await page.locator('#prac-topic-start').click();
await page.waitForTimeout(800);
check('chưa có chủ đề ⇒ hiện đúng thông báo lỗi',
  (await page.locator('#prac-topic-error').textContent())?.trim()
    === 'Vui lòng chọn hoặc nhập chủ đề.');
check('chưa có chủ đề ⇒ KHÔNG gửi POST /sessions', sessionPost === null);

// ── 4. Nhập chủ đề rồi bấm ⇒ gửi ĐÚNG và điều hướng ─────────────────────────
const topic = 'Chủ đề kiểm luồng';
await page.locator('#prac-topic-custom').fill(topic);
await page.locator('#prac-topic-start').click();
await page.waitForTimeout(1500);

check('POST /sessions được gửi', sessionPost !== null);
check('thân request mang đúng state của trang',
  !!sessionPost && sessionPost.mode === 'practice'
    && sessionPost.part === 2 && sessionPost.topic === topic,
  JSON.stringify(sessionPost));
check('điều hướng sang trang luyện tập kèm session_id',
  page.url().includes('practice.html?session_id=sess-verify-1'), page.url());

// ── 5. Modal chủ đề ─────────────────────────────────────────────────────────
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.locator('#grammar-cta-start').click();
await page.waitForTimeout(800);
check('modal mở được', await page.locator('#topic-modal').evaluate((el) => el.classList.contains('open')));
check('phụ đề modal nêu đúng Part',
  (await page.locator('#modal-subtitle').textContent())?.includes('Part 1'));
await page.locator('#modal-close').click();
await page.waitForTimeout(300);
check('đóng modal được và trả lại cuộn trang',
  !(await page.locator('#topic-modal').evaluate((el) => el.classList.contains('open')))
    && (await page.evaluate(() => document.body.style.overflow)) === '');

check('không có lỗi JS chưa bắt', errs.length === 0, errs[0] || '');

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
