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

import { canonicalHref, normalizeText, comparePages, formatReport } from './parity-core.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const BASE = (arg('--base', 'https://www.averlearning.com')).replace(/\/+$/, '');
const API_BASE = arg('--api', 'https://ielts-speaking-coach-production.up.railway.app');
const LIMIT = Number(arg('--limit', '0')) || 0;
const ONLY = arg('--only', '');
const OUT = arg('--json', '');
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', '4')) || 4);
const SETTLE_MS = Number(arg('--settle', '1200')) || 1200;

/** Cặp mặc định — chỉ những route đã có CẢ hai bản chạy song song. */
const DEFAULT_PAIRS = [
  {
    name: 'grammar-home',
    legacy: '/grammar.html',
    next: '/grammar',
    allow: [
      // Next fetch phía MÁY CHỦ nên trình duyệt không phát request nào — đó
      // chính là mục đích của SSR, không phải mất lời gọi.
      { kind: 'api-missing', value: '/api/grammar/home',
        reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi' },
      { kind: 'api-missing', value: '/api/grammar/groups',
        reason: 'Next fetch phía máy chủ (lib/backend.ts), trình duyệt không gọi' },
      // Legacy dựng thẻ thư mục bằng onclick/onkeydown giả lập link (grammar.js
      // dòng 107–111); bản Next dùng <a> thật ⇒ chuột giữa/phải và bàn phím
      // hoạt động đúng chuẩn. Link "thừa" ở đây là cải thiện có chủ đích.
      { kind: 'link-extra', value: '/grammar?category=*',
        reason: 'thẻ thư mục nay là <a> thật thay vì onclick giả lập (có chủ đích)' },
    ],
  },
];

/** Bổ sung toàn bộ bài Grammar từ backend — không lấy mẫu, quét hết. */
async function expandGrammar() {
  const res = await fetch(`${API_BASE}/api/grammar/home`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`không tải được danh mục Grammar: ${res.status}`);
  const home = await res.json();
  const pairs = [];
  for (const cat of home.categories || []) {
    const r = await fetch(
      `${API_BASE}/api/grammar/category/${encodeURIComponent(cat.slug)}`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const data = await r.json();
    for (const a of data.articles || []) {
      if (!a.slug || !a.category) continue;
      pairs.push({
        name: `article:${a.category}/${a.slug}`,
        legacy: `/pages/grammar-article.html?category=${encodeURIComponent(a.category)}&slug=${encodeURIComponent(a.slug)}`,
        next: `/grammar/${encodeURIComponent(a.category)}/${encodeURIComponent(a.slug)}`,
      });
    }
  }
  return pairs;
}

/** Trích "page facts" — đúng hình dạng mà `parity-core` đọc. */
async function extract(context, url) {
  const page = await context.newPage();
  const consoleErrors = [];
  const apiPaths = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(normalizeText(m.text()).slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push(normalizeText(String(e)).slice(0, 200)));
  page.on('request', (r) => {
    try {
      const u = new URL(r.url());
      if (u.origin === API_BASE || u.pathname.startsWith('/api/')) apiPaths.push(u.pathname);
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
    return { url, status, title: '', headings: [], links: [], lines: [],
             components: [], apiPaths: [], consoleErrors: [`NAVIGATION: ${e.message}`] };
  }

  const facts = await page.evaluate(() => {
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
    const headings = [...document.querySelectorAll('h1,h2,h3,h4')]
      .filter(vis).map((h) => `${h.tagName}:${h.textContent}`);
    // Chỉ so link NGƯỜI DÙNG thấy được — cùng một luật với heading, nếu không
    // thì hai mặt của cùng bộ so lại dùng hai định nghĩa "có mặt" khác nhau.
    const links = [...document.querySelectorAll('a[href]')]
      .filter(vis).map((a) => a.getAttribute('href'));
    // Custom element + landmark: đây là thứ bắt được "trang thiếu chrome".
    // Component KHÔNG lọc theo hiển thị: `aver-chrome` là custom element bọc
    // ngoài, có thể `display:contents` ⇒ lọc sẽ giấu mất chính lỗi mất chrome
    // mà nó sinh ra để bắt. Ở đây hợp đồng là CÓ MẶT, không phải nhìn thấy.
    const components = [];
    for (const tag of ['aver-chrome', 'main', 'header', 'footer', 'nav']) {
      const n = document.querySelectorAll(tag).length;
      for (let i = 0; i < n; i++) components.push(tag);
    }
    const root = document.body;
    const lines = (root ? root.innerText : '').split('\n')
      .map((s) => s.trim()).filter((s) => s.length > 1);
    return { title: document.title, headings, links, lines, components };
  });
  await page.close();

  const origin = new URL(url).origin;
  return {
    url,
    status,
    title: facts.title,
    headings: facts.headings.map(normalizeText),
    links: [...new Set(facts.links.map((h) => canonicalHref(h, { origin })).filter(Boolean))].sort(),
    lines: facts.lines.map(normalizeText).filter(Boolean),
    components: facts.components.sort(),
    apiPaths: [...new Set(apiPaths)].sort(),
    consoleErrors,
  };
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
  console.log(`parity: ${pairs.length} cặp · base ${BASE} · đồng thời ${CONCURRENCY}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const results = [];
  let done = 0;

  const queue = [...pairs];
  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const [legacy, next] = await Promise.all([
        extract(context, BASE + p.legacy),
        extract(context, BASE + p.next),
      ]);
      const r = comparePages(legacy, next, { allow: p.allow || [] });
      results.push({ name: p.name, ...r });
      done += 1;
      if (done % 10 === 0) console.log(`  … ${done}/${pairs.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  results.sort((a, b) => b.counts.high - a.counts.high);
  console.log(formatReport(results));

  if (OUT) {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log(`\nbáo cáo đầy đủ: ${OUT}`);
  }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error('parity: chạy lỗi —', e); process.exit(2); });
