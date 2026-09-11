// Kiểm LUỒNG của `/speaking` mà KHÔNG cần backend, KHÔNG cần secret.
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
import { existsSync } from 'node:fs';
import { resolveCorePlayerAdmission } from '../lib/core-player-affinity.mjs';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/speaking';

const fakeSession = JSON.stringify({
  access_token: 'verify-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  // Match the real Supabase UUID contract; the durable start controller
  // deliberately rejects placeholder/non-versioned account ids.
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'flow@local' },
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

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) {
      return chromium.launch({ executablePath: localChrome });
    }
    throw error;
  }
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(([k, v]) => {
  try { localStorage.setItem(k, v); } catch (_) {}
}, [storageKey(SB), fakeSession]);

const page = await ctx.newPage();
let sessionPost = null;
let sessionPostCount = 0;
let topicGets = 0;
let apiScriptReleased = false;
let releaseApiScript;
const apiScriptGate = new Promise((resolve) => {
  releaseApiScript = () => {
    apiScriptReleased = true;
    resolve();
  };
});

// Chặn MỌI request ra ngoài origin cục bộ: backend là giả, và ta muốn thấy
// chính xác cái gì được gửi đi.
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.startsWith(BASE) && new URL(url).pathname === '/js/api.js' && !apiScriptReleased) {
    await apiScriptGate;
  }
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

  if (req.method() === 'POST' && /\/sessions$/.test(url)) {
    sessionPostCount += 1;
    sessionPost = JSON.parse(req.postData() || '{}');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      // The durable start contract requires the server acknowledgement to
      // carry the exact client-minted id. A fixed fixture id now correctly
      // fails closed as an unverified write.
      body: JSON.stringify({ id: sessionPost.client_session_id }),
    });
  }
  if (req.method() === 'GET' && /\/topics\?part=/.test(url)) topicGets += 1;
  for (const [re, body] of CANNED) {
    if (re.test(url)) {
      // `/auth/me` cố ý CHẬM: nó là thứ mà bản đầu `await` trước khi gắn
      // listener. Không làm chậm thì kiểm này không thể phát hiện lỗi đó.
      if (/\/auth\/me$/.test(url)) await new Promise((r) => setTimeout(r, 2500));
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

// LÀM CHẬM lời gọi API để mô phỏng mạng thật. Bản đầu trả ngay lập tức và
// chờ 2.5s trước khi bấm — nên nó BỎ LỌT lỗi "listener gắn sau khi /auth/me
// trả về" mà bộ e2e staging bắt được. Bấm sớm + API chậm là kịch bản người
// dùng thật, và là kịch bản duy nhất lộ ra cửa sổ chết đó.
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);   // đủ để React hydrate, KHÔNG đủ để /auth/me xong

check('trang ở nguyên route (không bị đẩy về login)',
  page.url().includes(ROUTE), page.url());

// ── 1. Mở panel Luyện tập bằng thẻ mode ─────────────────────────────────────
await page.locator('.mode-card[data-mode="practice"]').first().click();
await page.waitForTimeout(300);
check('thẻ mode mở đúng panel Luyện tập',
  await page.locator('#tab-practice').evaluate((el) => el.classList.contains('active')));

// ── 1b. Validation phải có ngay, không chờ API/auth ────────────────────────
await page.locator('#prac-topic-start').click();
await page.waitForTimeout(100);
check('bấm sớm khi chưa có chủ đề ⇒ hiện đúng thông báo lỗi',
  (await page.locator('#prac-topic-error').textContent())?.trim()
    === 'Vui lòng chọn hoặc nhập chủ đề.');
check('bấm sớm khi chưa có chủ đề ⇒ KHÔNG gửi POST /sessions', sessionPost === null);

// ── 1c. Chọn Part + hai cú bấm hợp lệ trước API chỉ tạo MỘT session ───────
await page.locator('#prac-tp-part-2').click();
check('chọn Part 2 trước API vẫn cập nhật state ngay',
  await page.locator('#prac-tp-part-2').evaluate((el) => el.classList.contains('selected')));
const earlyTopic = 'Chủ đề bấm sớm';
await page.locator('#prac-topic-custom').fill(earlyTopic);
await page.evaluate(() => {
  const btn = document.querySelector('#prac-topic-start');
  btn.click();
  btn.click();
});
await page.waitForTimeout(100);
check('nút start bị khoá trong lúc chờ API',
  await page.locator('#prac-topic-start').isDisabled());
releaseApiScript();
await page.waitForTimeout(1500);
check('bấm đôi trước API chỉ gửi một POST /sessions', sessionPostCount === 1,
  `${sessionPostCount} POST /sessions`);
check('request bấm sớm giữ đúng topic và Part đã chọn',
  !!sessionPost && sessionPost.mode === 'practice'
    && sessionPost.part === 2 && sessionPost.topic === earlyTopic,
  JSON.stringify(sessionPost));
const earlySessionId = sessionPost?.client_session_id;
const expectedPracticeUrl = earlySessionId
  ? new URL(resolveCorePlayerAdmission('speaking', { session_id: earlySessionId }), BASE).href
  : null;
check('bấm sớm hợp lệ vẫn điều hướng sau khi API sẵn sàng',
  expectedPracticeUrl !== null && page.url() === expectedPracticeUrl,
  `${page.url()}${sessionPost ? '' : `; ${await page.locator('#prac-topic-error').textContent()}`}`);

// Trở lại dashboard với API đã sẵn sàng để kiểm đường thao tác thông thường.
sessionPost = null;
sessionPostCount = 0;
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.locator('.mode-card[data-mode="practice"]').first().click();
await page.waitForTimeout(300);
check('API sẵn sàng: thẻ mode vẫn mở panel Luyện tập',
  await page.locator('#tab-practice').evaluate((el) => el.classList.contains('active')));

// ── 2. Chọn Part 2 ──────────────────────────────────────────────────────────
await page.locator('#prac-tp-part-2').click();
await page.waitForTimeout(600);
check('nút Part 2 được đánh dấu đã chọn',
  await page.locator('#prac-tp-part-2').evaluate((el) => el.classList.contains('selected')));
check('danh sách chủ đề nạp xong (select được bật)',
  await page.locator('#prac-topic-select').isEnabled());

// ── 2b. Mở lại panel SAU KHI API đã sẵn sàng ──────────────────────────────
// Listener phải gắn ngay để không làm rơi cú bấm đầu, nhưng không được giữ
// vĩnh viễn giá trị API `null` tại thời điểm bind. Inline review của PR #1345
// bắt đúng hồi quy đó: mở lại mode sau khi runtime sẵn sàng sẽ không nạp data.
await page.waitForTimeout(2600); // `/auth/me` giả đã hoàn tất; runtime chắc chắn ready
await page.locator('#tab-practice [data-action="back-to-dashboard"]').click();
check('quay lại dashboard sau cú bấm sớm',
  await page.locator('#tab-dashboard').evaluate((el) => el.classList.contains('active')));
const topicGetsBeforeReopen = topicGets;
await page.locator('.mode-card[data-mode="practice"]').first().click();
await page.waitForTimeout(300);
check('mở lại Luyện tập sau API thì nạp mới danh sách chủ đề',
  topicGets > topicGetsBeforeReopen,
  `${topicGetsBeforeReopen} → ${topicGets} GET /topics`);
check('select vẫn khả dụng sau khi mở lại mode',
  await page.locator('#prac-topic-select').isEnabled());

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
const secondSessionId = sessionPost?.client_session_id;
const expectedSecondPracticeUrl = secondSessionId
  ? new URL(resolveCorePlayerAdmission('speaking', { session_id: secondSessionId }), BASE).href
  : null;
check('điều hướng sang trang luyện tập kèm session_id',
  expectedSecondPracticeUrl !== null && page.url() === expectedSecondPracticeUrl,
  `${page.url()}${sessionPost ? '' : `; ${await page.locator('#prac-topic-error').textContent()}`}`);

// ── 5. Modal chủ đề ─────────────────────────────────────────────────────────
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
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
