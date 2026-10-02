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
import { isLearnerTabPersistenceSupported } from '../lib/learner-tab-draft-support.mjs';

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
  [/\/auth\/me$/, {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'flow@local',
    display_name: 'Học Viên',
    avatar_url: null,
    role: 'user',
    is_active: true,
    permissions: ['all'],
    onboarding_completed: true,
    target_band: 7,
    exam_date: null,
    self_level: 'intermediate',
    preferred_topics: [],
    vocab_bank_enabled: true,
    d1_enabled: true,
    d3_enabled: true,
    flashcard_enabled: true,
    vocab_curated_enabled: true,
  }],
  [/\/topics\?part=/, [{ title: 'Chủ đề mẫu', category: 'Daily life' }]],
  [/\/api\/dashboard\/init$/, { summary: { total_sessions: 0 }, sessions: [] }],
  [/\/sessions\?/, { sessions: [], total: 0, total_pages: 0, page: 1, page_size: 20 }],
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
  if (process.argv.includes('--native-chrome')) return chromium.launch({ channel: 'chrome', headless: false });
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
page.on('console', (message) => {
  if (message.type() === 'error') errs.push(message.text());
});

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
  `${sessionPostCount} POST /sessions${errs.length ? `; ${errs.join(' | ')}` : ''}`);
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

// Preparation-only lifecycle: the admitted native Chrome run must preserve
// values; the normal unqualified CI browser must truthfully report unsaved.
await page.goto(BASE + ROUTE, {waitUntil:'domcontentloaded'});
await page.waitForTimeout(2800); // existing fixture /auth/me delay is2500ms
const backToDashboard = page.locator('.main-tab-panel.active [data-action="back-to-dashboard"]');
if (await backToDashboard.isVisible()) await backToDashboard.click();
await page.locator('.mode-card[data-mode="practice"]').first().click();
await page.locator('#prac-part-2').click();
const cue = '  Describe a place you enjoy visiting.\nYou should say:\nwhere it is\nwhat you do there  ';
await page.locator('#prac-custom-q').fill(cue);
await page.locator('#prac-topic-custom').fill('older topic');
await page.locator('#prac-topic-custom').fill('');
const beforePreparationRestore = sessionPostCount;
const qualified = isLearnerTabPersistenceSupported({navigator:{userAgent:await page.evaluate(()=>navigator.userAgent)}});
if (qualified) {
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('Đã khôi phục nháp trong tab này.',{exact:true}).waitFor({state:'visible'});
  check('Speaking reload preserves raw cue, empty topic, Part2 and preparation panel without Start',
    await page.locator('#prac-custom-q').inputValue()===cue
      && await page.locator('#prac-topic-custom').inputValue()===''
      && await page.locator('#prac-part-2').evaluate(el=>el.classList.contains('selected'))
      && await page.locator('#tab-practice').evaluate(el=>el.classList.contains('active'))
      && sessionPostCount===beforePreparationRestore);
  await page.locator('#tab-practice [data-action="back-to-dashboard"]').click();
  await page.goto(BASE + '/grammar', {waitUntil:'domcontentloaded'});
  await page.goBack({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2800);
  await page.locator('.mode-card[data-mode="practice"]').first().click();
  check('Speaking immediate document Back preserves the unchecked cue with zero session writes',
    await page.locator('#prac-custom-q').inputValue()===cue && sessionPostCount===beforePreparationRestore);
} else {
  check('Unqualified Speaking browser announces unsaved while keeping the current cue editable',
    (await page.locator('#speaking-draft-notice').innerText()).includes('chưa được lưu')
      && await page.locator('#prac-custom-q').inputValue()===cue
      && await page.locator('#prac-custom-q').isEnabled()
      && sessionPostCount===beforePreparationRestore);
}
const discard = page.locator('#speaking-draft-discard');
await discard.focus(); await discard.press('Enter');
check('Speaking keyboard discard clears only current preparation without Start',
  await page.locator('#prac-custom-q').inputValue()==='' && sessionPostCount===beforePreparationRestore);
for (const theme of ['light','dark']) {
  await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
  for (const width of [360,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    check(`Speaking draft controls ${theme}/${width}: fits and target is at least44px`,
      await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)
        && await discard.evaluate(el=>el.getBoundingClientRect().height>=44));
  }
}

// Discard must be reachable inside the dialog, whose backdrop blocks the page
// controls. Check native Tab/Enter rather than invoking its handler through DOM.
await page.locator('#prac-custom-q').fill(cue);
await page.locator('#tab-practice [data-action="back-to-dashboard"]').click();
await page.locator('#grammar-cta-start').click();
await page.locator('#tab-custom').click();
await page.locator('#topic-custom-input').fill('  modal topic  ');
await page.locator('#tab-myq').click();
await page.locator('#myq-input').fill('  Modal question?\nNext question?  ');
const modalDiscard = page.locator('[role="dialog"] #speaking-modal-draft-discard');
check('Modal exposes draft status and discard inside its focus boundary',
  await modalDiscard.isVisible()
    && await page.locator('#speaking-modal-draft-notice').isVisible()
    && !(await page.locator('#speaking-draft-controls').isVisible())
    && await discard.isDisabled()
    && (await page.locator('#speaking-modal-draft-notice').innerText()).includes(qualified ? 'đã được lưu' : 'chưa được lưu'));
await page.locator('#modal-close').focus();
await page.keyboard.press('Shift+Tab'); // existing dialog trap wraps to Confirm
await page.keyboard.press('Shift+Tab'); // previous visible button is modal discard
check('Modal discard is reachable using the keyboard',
  await page.evaluate(()=>document.activeElement?.id==='speaking-modal-draft-discard'));
await page.keyboard.press('Enter');
check('Modal keyboard discard clears its fields and preserves Practice without Start',
  await page.locator('#myq-input').inputValue()===''
    && await page.locator('#topic-custom-input').inputValue()===''
    && await page.locator('#prac-custom-q').inputValue()===cue
    && sessionPostCount===beforePreparationRestore);
for (const theme of ['light','dark']) {
  await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
  for (const width of [360,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    check(`Speaking modal draft controls ${theme}/${width}: fits and target is at least44px`,
      await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)
        && await modalDiscard.evaluate(el=>el.getBoundingClientRect().height>=44
          && el.getBoundingClientRect().width>=44
          && el.getBoundingClientRect().right<=innerWidth));
  }
}
await page.locator('#modal-close').click();
check('Closing the modal restores page controls and disables discard on dashboard',
  await page.locator('#speaking-draft-controls').isVisible() && await discard.isDisabled());

check('không có lỗi JS chưa bắt', errs.length === 0, errs[0] || '');

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
