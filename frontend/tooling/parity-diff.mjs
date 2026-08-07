// Bộ so parity legacy ↔ Next chạy trên trình duyệt thật.
//
// Cách dùng:
//   node tooling/parity-diff.mjs                          # cặp mặc định, trên production
//   node tooling/parity-diff.mjs --base http://localhost:3000
//   node tooling/parity-diff.mjs --expand-grammar         # + toàn bộ bài Grammar
//   node tooling/parity-diff.mjs --json out/parity.json
//
// Thoát khác 0 khi có phát hiện mức `high`.
//
// VÌ SAO PHẢI LÀ TRÌNH DUYỆT THẬT: `grammar.html` dựng toàn bộ nội dung phía
// client (`js/grammar.js`, 1.034 dòng) sau khi fetch backend. So HTML thô sẽ là
// "vỏ rỗng vs trang đầy" — báo lệch 100% và vô dụng. Phần lõi so sánh nằm ở
// `parity-core.mjs` và tự kiểm được không cần trình duyệt.
import { chromium } from '@playwright/test';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { normalizeText, comparePages, formatReport, buildFacts, hrefFromInlineHandler,
         isTransportError }
  from './parity-core.mjs';
import { signIn, sessionEntry } from './supabase-session.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const BASE = (arg('--base', 'https://www.averlearning.com')).replace(/\/+$/, '');
const API_BASE_RAW = arg('--api', 'https://ielts-speaking-coach-production.up.railway.app');
// So theo ORIGIN đã chuẩn hoá: `--api http://localhost:8000/` (thừa dấu /) mà
// so chuỗi thô sẽ trượt hết request thật (phát hiện #11 vòng 2).
const API_ORIGIN = new URL(API_BASE_RAW).origin;
const API_BASE = API_BASE_RAW.replace(/\/+$/, '');
const LIMIT = Number(arg('--limit', '0')) || 0;
const ONLY = arg('--only', '');
const OUT = arg('--json', '');
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', '4')) || 4);
const SETTLE_MS = Number(arg('--settle', '1200')) || 1200;
// Bề rộng cửa sổ. Mặc định 1280 (desktop) để mọi lần chạy cũ vẫn tái lập được.
// Lượt 375px là để bắt hồi quy theo BREAKPOINT — lỗi H1 dính chữ (#907) chỉ
// hiện dưới 640px, và G1 bắt được nó chỉ vì nó TÌNH CỜ cũng là khác biệt văn
// bản; một khối `hidden sm:block` lệch giữa hai bản thì lượt 1280 mù hoàn toàn.
const [VW, VH] = (arg('--viewport', '1280x900')).split('x').map(Number);

// ── So trang CẦN ĐĂNG NHẬP ────────────────────────────────────────────────
// Đo 2026-08-05: `pages/home.html` có auth gate cuối trang, trình duyệt ẩn
// danh bị đẩy sang `/login.html` ⇒ G1 cho trang đó CON SỐ KHÔNG. Mọi trang
// lưu lượng cao còn lại đều cần đăng nhập, nên không có `--auth` thì G1 hết
// dùng được cho phần còn lại của việc di trú.
//
// GIỚI HẠN, nói trước: tài khoản probe KHÔNG có dữ liệu học tập, nên hai vế
// đều render TRẠNG THÁI RỖNG. Phủ được: chrome, bố cục, chữ tĩnh, link, các
// lời gọi API phát ra, và đường render empty-state. KHÔNG phủ được: hiển thị
// số liệu thật. Muốn phủ vế đó phải seed dữ liệu cho tài khoản probe — tức
// GHI vào dữ liệu production, nên không làm.
const USE_AUTH = flag('--auth');
const SUPABASE_URL = (arg('--supabase', 'https://huwsmtubwulikhlmcirx.supabase.co')).replace(/\/+$/, '');
const SUPABASE_ANON = process.env.PROBE_SUPABASE_ANON
  || 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
/** Đặt sau khi đăng nhập; mỗi context tiêm trước khi điều hướng. */
let AUTH_ENTRY = null;

/** Cặp mặc định — chỉ những route đã có CẢ hai bản chạy song song. */
const DEFAULT_PAIRS = [
  {
    name: 'grammar-home',
    legacy: '/grammar.html',
    next: '/grammar',
    allow: [
      // Next fetch phía MÁY CHỦ nên trình duyệt không phát request nào — đó
      // chính là mục đích của SSR, không phải mất lời gọi.
      { kind: 'api-missing', value: 'GET /api/grammar/home',
        reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi' },
      { kind: 'api-missing', value: 'GET /api/grammar/groups',
        reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi' },
      // KHÔNG miễn trừ link thư mục nữa. Vòng review đầu tôi miễn cả cụm
      // `/grammar?category=*` vì legacy dùng onclick nên "không có gì để so" —
      // nghĩa là một slug thư mục SAI cũng lọt. Nay `hrefFromInlineHandler`
      // đọc được đích của onclick, hai bên so được thật.
    ],
  },
  {
    // Trang CÔNG KHAI, port 2026-08-07. Logic đã tách sang
    // `/js/grammar-exercises.js` nên cả hai vế chạy CHÍNH tệp đó — cổng so được
    // nội dung thật chứ không phải hai bản chép.
    name: 'grammar-exercises',
    legacy: '/pages/grammar-exercises.html',
    next: '/grammar/exercises',
    allow: [],
  },
];

/** Bổ sung toàn bộ bài Grammar từ backend — không lấy mẫu, quét hết. */
async function expandGrammar() {
  const res = await fetch(`${API_BASE}/api/grammar/home`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`không tải được danh mục Grammar: ${res.status}`);
  const home = await res.json();
  const cats = home.categories;
  // KHÔNG `|| []`: hình dạng lạ mà lặng lẽ coi như "không có thư mục nào" thì
  // lần quét rỗng vẫn báo xanh (phát hiện #7 vòng 2).
  if (!Array.isArray(cats) || !cats.length) {
    throw new Error('/api/grammar/home không trả `categories` — không thể quét');
  }
  const pairs = [];
  let skipped = 0;
  let articlesOmitted = 0;
  for (const cat of cats) {
    // Trang THƯ MỤC là một chế độ render riêng của trang chủ và trước đây
    // không hề được quét: `?category=` hỏng thì cả loạt trang thư mục vỡ mà
    // bộ so vẫn xanh (phát hiện #1 vòng 2).
    pairs.push({
      name: `category:${cat.slug}`,
      legacy: `/grammar.html?category=${encodeURIComponent(cat.slug)}`,
      next: `/grammar?category=${encodeURIComponent(cat.slug)}`,
      // Ngoại lệ ĐÚNG MỘT endpoint của đúng thư mục này — không phải một
      // luật tiền tố quét cả cụm. Vòng 1 tôi miễn cả cụm cho gọn và hệ quả là
      // một slug sai cũng lọt; không lặp lại kiểu đó.
      allow: [{
        kind: 'api-missing',
        value: `GET /api/grammar/category/${cat.slug}`,
        reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi',
      }],
    });
    const r = await fetch(
      `${API_BASE}/api/grammar/category/${encodeURIComponent(cat.slug)}`,
      { signal: AbortSignal.timeout(15000) });
    // KHÔNG `continue` khi lỗi: bỏ im một thư mục nghĩa là lần quét thiếu bài
    // mà vẫn báo xanh — đúng kiểu "im lặng nên trông như đã phủ hết".
    if (!r.ok) throw new Error(`không tải được thư mục ${cat.slug}: HTTP ${r.status}`);
    const data = await r.json();
    if (flag('--categories-only')) { articlesOmitted += (data.articles || []).length; continue; }
    for (const a of data.articles || []) {
      if (!a.slug || !a.category) { skipped += 1; continue; }
      pairs.push({
        allow: [{
          kind: 'api-missing',
          value: `GET /api/grammar/article/${a.category}/${a.slug}`,
          reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi',
        }],
        name: `article:${a.category}/${a.slug}`,
        legacy: `/pages/grammar-article.html?category=${encodeURIComponent(a.category)}&slug=${encodeURIComponent(a.slug)}`,
        next: `/grammar/${encodeURIComponent(a.category)}/${encodeURIComponent(a.slug)}`,
      });
    }
  }
  // Nói ra cái bị bỏ. Cắt bớt trong im lặng đọc y như "đã phủ hết".
  if (skipped) console.log(`  ⚠ bỏ qua ${skipped} bài thiếu slug/category — lần quét KHÔNG phủ hết`);
  if (articlesOmitted) {
    console.log(
      `  ⚠ --categories-only: KHÔNG quét ${articlesOmitted} trang bài viết. `
      + 'Lần chạy này chỉ phủ trang chủ + trang thư mục. Bộ đầy đủ chạy ở lịch đêm.');
  }
  return pairs;
}

/**
 * Trích hai lần và đòi ổn định.
 *
 * `networkidle` + một khoảng chờ cố định KHÔNG bảo đảm render client đã xong;
 * dưới độ trễ backend dao động, kết quả sẽ chớp giữa các lần chạy và người ta
 * mất lòng tin vào cả công cụ (phát hiện #12 vòng 2). Không thể loại bỏ hẳn
 * chạy đua, nhưng có thể làm nó HIỆN RA thay vì âm thầm: chụp hai lần cách
 * nhau, khác nhau thì thử lại, vẫn khác thì báo `unstable-extraction` — một
 * phát hiện mức cao, chứ không phải một con số trông có vẻ chắc chắn.
 */
async function extractStable(mkContext, url) {
  let last = null;
  // Mỗi LẦN CHỤP một context sạch, không chỉ mỗi cặp: `grammar.js:844` ghi
  // `_aver_grammar_reads` vào localStorage, nên lần chụp thứ hai trong cùng
  // context có thể khác lần đầu một cách HỢP LỆ — và bộ so sẽ báo "bất ổn"
  // oan ở đúng những trang có tác dụng phụ. Hai lần chụp phải xuất phát từ
  // cùng một trạng thái thì mới so được với nhau.
  const shot = async () => {
    const ctx = await mkContext();
    try { return await extractOnce(ctx, url); } finally { await ctx.close(); }
  };
  let netErrors = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await shot();
    const b = await shot();
    // MẤT KẾT NỐI THÌ THỬ LẠI, ĐỪNG KẾT LUẬN. Khi backend từ chối ỔN ĐỊNH,
    // hai lần chụp giống hệt nhau (cùng hỏng) nên kiểm-ổn-định ở dưới coi là
    // đạt — rồi bản chụp hỏng đó bị đem so với vế kia vốn gọi được. Đó chính
    // là đường sinh ra 87/150 "cặp lệch" ngày 2026-08-07. Kiểm mạng phải đứng
    // TRƯỚC kiểm ổn định, không phải sau.
    netErrors = [...(a.netErrors || []), ...(b.netErrors || [])];
    if (netErrors.length) {
      last = a;
      // Giãn cách tăng dần: sự cố hay gặp là backend từ chối cả CỤM request
      // dưới tải, nên thử lại ngay lập tức thường chỉ nện thêm vào đúng chỗ đau.
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const key = (f) => JSON.stringify([f.headings, f.links, f.lines, f.components, f.status]);
    if (key(a) === key(b)) return a;
    last = a;
  }
  return { ...last, consoleErrors: [...(last.consoleErrors || [])],
           // Hai lý do KHÁC NHAU, phải mang hai nhãn khác nhau: `unstable` là
           // "trang tự đổi giữa hai lần chụp" (khuyết tật có thể có thật);
           // `transportFailed` là "không gọi được backend" (dụng cụ đo hỏng).
           // Gộp chúng lại là quay về đúng chỗ nhầm ban đầu.
           ...(netErrors.length ? { transportFailed: netErrors } : { unstable: true }) };
}

/** Một lần trích — đúng hình dạng mà `parity-core` đọc. */
async function extractOnce(context, url) {
  const page = await context.newPage();

  // MỘT CÔNG CỤ ĐO KHÔNG ĐƯỢC GHI. `grammar.js:887` gọi
  // `POST /api/grammar/articles/{slug}/view` mỗi lần mở bài, và bộ so tải mỗi
  // trang tới 2 lần × 2 vế; chạy `--expand-grammar` sẽ bơm ~550 lượt xem giả
  // vào dữ liệu thật. Chặn mọi phương thức ghi.
  //
  // TRẢ 200 rỗng chứ không huỷ request: huỷ sẽ sinh lỗi console trên trang và
  // biến thành phát hiện giả. `page.on('request')` vẫn ghi nhận, nên chênh
  // lệch "legacy có POST, Next không" vẫn hiện trong dữ kiện API.
  await page.route('**/*', (route) => {
    const r = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
      blockedMutations.push(`${r.method()} ${(() => {
        try { return new URL(r.url()).pathname; } catch { return r.url(); } })()}`);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  const consoleErrors = [];
  const apiCalls = [];
  const blockedMutations = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(normalizeText(m.text()).slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push(normalizeText(String(e)).slice(0, 200)));
  // CSS hay chunk 404 làm trang vỡ bố cục trong khi DOM chữ vẫn khớp y hệt.
  const resourceFailures = [];
  // CỐ Ý nằm NGOÀI `buildFacts`: đây không phải dữ kiện để SO giữa hai vế, mà
  // là tình trạng của chính dụng cụ đo. Đưa vào `FACT_KEYS` là biến một sự cố
  // hạ tầng thành một khác biệt giữa legacy↔Next — đúng cái nhầm cần tránh.
  const netErrors = [];
  page.on('response', (r) => {
    if (r.status() >= 400) {
      try { resourceFailures.push(`${r.status()} ${new URL(r.url()).pathname}`); } catch { /* bỏ */ }
    }
  });
  page.on('requestfailed', (r) => {
    try { resourceFailures.push(`FAILED ${new URL(r.url()).pathname}`); } catch { /* bỏ */ }
    // Tách riêng lỗi TẦNG VẬN CHUYỂN. Nó không nói gì về trang — xem chú thích
    // dài ở `isTransportError` trong `parity-core.mjs`.
    const err = r.failure() ? r.failure().errorText : '';
    if (isTransportError(err)) {
      try { netErrors.push(`${err.trim().split(/\s+/)[0]} ${new URL(r.url()).origin}`); }
      catch { netErrors.push(err); }
    }
  });
  page.on('request', (r) => {
    try {
      const u = new URL(r.url());
      if (u.origin === API_ORIGIN || u.pathname.startsWith('/api/')) {
        // Giữ method + query: `?q=tenses` khác `?q=conditionals` là hai hành
        // vi khác nhau, chỉ so pathname sẽ không thấy.
        apiCalls.push({ method: r.method(), pathname: u.pathname, search: u.search });
      }
    } catch { /* URL lạ thì bỏ qua, không để chết cả lần chạy */ }
  });

  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp ? resp.status() : 0;
    // Legacy render sau khi fetch xong ⇒ phải chờ mạng lặng rồi để lắng thêm.
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
  } catch (e) {
    await page.close();
    return { ...buildFacts({}, { url, finalUrl: url, status, apiCalls: [],
                                 resourceFailures,
                                 consoleErrors: [`NAVIGATION: ${e.message}`] }),
             netErrors };
  }

  const facts = await page.evaluate(() => {
    // Đi xuyên shadow root MỞ. `aver-chrome` dùng `attachShadow({mode:'open'})`
    // (aver-chrome.js:397) nên toàn bộ điều hướng nằm trong shadow tree —
    // `document.querySelectorAll` không thấy gì. Trước bản này, một chrome CÓ
    // mặt nhưng rỗng ruột sẽ qua cửa (phát hiện #2 vòng 2).
    const deepAll = (sel) => {
      const out = [];
      const walk = (root) => {
        out.push(...root.querySelectorAll(sel));
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return out;
    };
    // Lần chạy đầu (03/08) bộ so báo 3 lệch mức cao mà cả 3 đều là lỗi CỦA NÓ:
    //  · `getComputedStyle(el).display` đọc display của CHÍNH el — cha bị
    //    `display:none` thì con vẫn trả 'block'. `grammar.html` có sẵn hai
    //    `<h2>` rỗng (`search-results-title`, `category-view-title`) nằm trong
    //    khối ẩn ⇒ bị tính là "legacy có, Next thiếu".
    //  · Link KHÔNG hề lọc theo hiển thị, nên link trong đúng những khối ẩn đó
    //    cũng thành "thiếu ở bản mới".
    // `checkVisibility` xét cả cây tổ tiên; `getClientRects` là đường lui.
    const vis = (el) => (typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : el.getClientRects().length > 0);
    const headings = deepAll('h1,h2,h3,h4')
      .filter(vis).map((h) => ({ tag: h.tagName, text: h.textContent }));
    // Chỉ so link NGƯỜI DÙNG thấy được — cùng một luật với heading, nếu không
    // thì hai mặt của cùng bộ so lại dùng hai định nghĩa "có mặt" khác nhau.
    // Nhãn link = DÒNG ĐẦU nhìn thấy, không phải toàn bộ chữ bên trong.
    // Lý do đo được: legacy cho CẢ thẻ thư mục bấm được (onclick trên <div>),
    // nên `textContent` nuốt luôn danh sách bài con — "Tenses8 bàiPresent
    // SimplePresent Continuous…" — trong khi bản Next chỉ bọc phần đầu thẻ
    // bằng <a>. Cùng một đích đến, chữ khác nhau ⇒ 11 lệch giả. Dòng đầu là
    // nhãn chính người dùng đọc, ổn định trước khác biệt về phạm vi vùng bấm,
    // mà vẫn đủ để bắt lỗi đấu dây (đổi chỗ href thì dòng đầu đổi theo).
    const label = (el) => (el.innerText || '').split('\n').map((t) => t.trim())
      .find((t) => t.length > 0) || '';
    const links = deepAll('a[href]')
      .filter(vis).map((a) => ({ text: label(a), href: a.getAttribute('href') }));
    // Legacy dựng "link" bằng onclick (grammar.js:110). Lấy cả dạng này, nếu
    // không thì phía legacy trống và mọi link tương ứng của Next thành "thừa".
    const inline = deepAll('[onclick]')
      .filter(vis).map((el) => ({ text: label(el), onclick: el.getAttribute('onclick') }));
    // Custom element + landmark: đây là thứ bắt được "trang thiếu chrome".
    // Component KHÔNG lọc theo hiển thị: `aver-chrome` là custom element bọc
    // ngoài, có thể `display:contents` ⇒ lọc sẽ giấu mất chính lỗi mất chrome
    // mà nó sinh ra để bắt. Ở đây hợp đồng là CÓ MẶT, không phải nhìn thấy.
    const components = [];
    for (const tag of ['aver-chrome', 'main', 'header', 'footer', 'nav']) {
      const n = deepAll(tag).length;
      for (let i = 0; i < n; i++) components.push(tag);
    }
    const root = document.body;
    const lines = (root ? root.innerText : '').split('\n')
      .map((s) => s.trim()).filter((s) => s.length > 1);
    return { title: document.title, headings, links, inline, lines, components };
  });
  // URL SAU redirect. `/pages/profile.html` nay 307 sang `/profile`, nên nếu
  // không ghi lại thì một cặp cấu hình nhầm sẽ tự so với chính mình và luôn xanh.
  const finalUrl = page.url();
  await page.close();

  // Link giả lập bằng onclick được quy về cùng hình dạng với <a href>.
  const inlineLinks = (facts.inline || [])
    .map((el) => ({ text: el.text, href: hrefFromInlineHandler(el.onclick) }))
    .filter((l) => l.href);

  return { ...buildFacts(
    { ...facts, links: [...facts.links, ...inlineLinks] },
    { url, finalUrl, status, apiCalls, resourceFailures, consoleErrors,
      blockedMutations }), netErrors };
}

async function main() {
  let pairs = [...DEFAULT_PAIRS];
  const pairsFile = arg('--pairs', '');
  if (pairsFile) pairs = JSON.parse(readFileSync(pairsFile, 'utf8'));
  if (flag('--expand-grammar')) pairs = pairs.concat(await expandGrammar());
  if (ONLY) pairs = pairs.filter((p) => p.name.includes(ONLY));
  if (LIMIT) pairs = pairs.slice(0, LIMIT);
  if (!pairs.length) {
    console.error('parity: không có cặp nào để so');
    process.exit(2);
  }
  if (USE_AUTH) {
    const sess = await signIn({
      supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON,
      email: process.env.PROBE_EMAIL, password: process.env.PROBE_PASSWORD,
    });
    AUTH_ENTRY = sessionEntry(SUPABASE_URL, sess, Date.now());
    console.log('parity: ĐÃ ĐĂNG NHẬP bằng tài khoản probe (chỉ so được trạng thái RỖNG)');
  }
  console.log(
    `parity: ${pairs.length} cặp · base ${BASE} · bề rộng ${VW}x${VH}`
    + ` · ${USE_AUTH ? 'CÓ ĐĂNG NHẬP' : 'ẩn danh'} · đồng thời ${CONCURRENCY}`);

  const browser = await chromium.launch();
  const results = [];
  let done = 0;

  const queue = [...pairs];
  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      // Context RIÊNG cho mỗi vế: cookie/localStorage/cache dùng chung sẽ rò
      // trạng thái giữa các cặp và giữa legacy↔Next (ví dụ `_aver_grammar_reads`
      // làm CTA khách hiện ở trang này mà không hiện ở trang kia), khiến kết
      // quả không lặp lại được (phát hiện #14 vòng 2).
      const mk = async () => {
        const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
        if (AUTH_ENTRY) {
          // Tiêm TRƯỚC khi điều hướng: auth gate chạy ngay khi trang tải, nên
          // đặt localStorage sau đó là đã muộn.
          await ctx.addInitScript(([k, v]) => {
            try { localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ }
          }, AUTH_ENTRY);
        }
        return ctx;
      };
      const [legacy, next] = await Promise.all([
        extractStable(mk, BASE + p.legacy),
        extractStable(mk, BASE + p.next),
      ]);
      // KHÔNG SO khi dụng cụ đo mất kết nối. Chạy `comparePages` trên một bản
      // chụp hỏng vẫn cho ra findings — chỉ là chúng vô nghĩa, và một khi đã
      // nằm trong báo cáo thì người đọc không cách nào biết cái nào thật. Cặp
      // này không có phán quyết; nó làm cả lượt chạy đỏ ở cuối, bằng thông điệp
      // riêng nói đúng chuyện đã xảy ra.
      const netFail = [...new Set([...(legacy.transportFailed || []),
                                   ...(next.transportFailed || [])])];
      if (netFail.length) {
        results.push({ name: p.name, url: BASE + p.legacy, nextUrl: BASE + p.next,
                       findings: [], counts: { high: 0, warn: 0 },
                       pass: true, noVerdict: true, transportFailed: netFail });
        done += 1;
        if (done % 10 === 0) console.log(`  … ${done}/${pairs.length}`);
        continue;
      }
      const r = comparePages(legacy, next, {
        allow: p.allow || [],
        // Cặp nào cố ý trỏ vào route lỗi thì phải KHAI ra, không mặc định.
        ...(p.expectStatus === undefined ? {} : { expectStatus: p.expectStatus }),
        // Sàn `baseline-suspect` cũng phải KHAI theo cặp, không nới mặc định:
        // chốt đó tồn tại để phân biệt "hai bên giống nhau" với "cả hai bên cùng
        // hỏng", và hạ sàn cho TẤT CẢ là tự tay tháo nó. Cặp nào có trạng thái
        // rỗng hợp lệ ngắn hơn 5 dòng thì nói ra, kèm lý do trong tài liệu.
        ...(p.minBaselineLines === undefined ? {} : { minBaselineLines: p.minBaselineLines }),
      });
      // Đưa danh sách ghi-bị-chặn vào báo cáo: "công cụ đo không ghi" phải là
      // thứ KIỂM ĐƯỢC, không phải lời hứa trong bình luận.
      r.blockedMutations = [...new Set([...(legacy.blockedMutations || []),
                                        ...(next.blockedMutations || [])])].sort();
      for (const side of [['legacy', legacy], ['next', next]]) {
        if (side[1].unstable) {
          r.findings.unshift({ kind: 'unstable-extraction', severity: 'high',
            value: `${side[0]}: hai lần chụp khác nhau sau 3 lượt thử` });
          r.counts.high += 1;
          r.pass = false;
        }
      }
      results.push({ name: p.name, ...r });
      done += 1;
      if (done % 10 === 0) console.log(`  … ${done}/${pairs.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  results.sort((a, b) => b.counts.high - a.counts.high);
  console.log(formatReport(results));
  for (const r of results) {
    for (const a of r.unusedAllow || []) {
      console.log(`  ⚠ ngoại lệ không còn khớp gì (${r.name}): ${a.kind} = ${a.value}`);
    }
  }

  const blocked = [...new Set(results.flatMap((r) => r.blockedMutations || []))];
  if (blocked.length) {
    console.log(`\nđã chặn ${blocked.length} loại request ghi (bộ so không được ghi vào dữ liệu thật):`);
    for (const b of blocked) console.log(`  ⛔ ${b}`);
  }

  if (OUT) {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(`\nbáo cáo đầy đủ: ${OUT}`);
  }
  // KHÔNG GỘP với đường đỏ vì parity. Một lượt chạy mất kết nối tới backend
  // KHÔNG nói được gì về parity — báo nó thành "cặp lệch" là khẳng định điều
  // chưa đo được, và đó chính là cách một cổng mất uy tín: đỏ vì lý do sai vài
  // lần là người ta bắt đầu bỏ qua nó. Mã thoát 3 để phân biệt được từ ngoài.
  const noVerdict = results.filter((r) => r.noVerdict);
  if (noVerdict.length) {
    const mã = [...new Set(noVerdict.flatMap((r) => r.transportFailed))].sort();
    console.log(`\n⚠ KHÔNG KẾT LUẬN ĐƯỢC PARITY cho ${noVerdict.length}/${results.length} cặp:`
      + ' không gọi được backend sau 3 lượt thử (có giãn cách).');
    for (const m of mã) console.log(`  ✗ ${m}`);
    for (const r of noVerdict.slice(0, 10)) console.log(`  · ${r.name}`);
    if (noVerdict.length > 10) console.log(`  · … và ${noVerdict.length - 10} cặp nữa`);
    console.log('\nĐây là hỏng HẠ TẦNG, không phải khuyết tật trang. Kiểm backend rồi chạy lại.');
    process.exit(3);
  }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error('parity: chạy lỗi —', e); process.exit(2); });
