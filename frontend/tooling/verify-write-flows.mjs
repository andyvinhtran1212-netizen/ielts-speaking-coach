// Cổng ĐƯỜNG-GHI: chạy các luồng khai báo trong trình duyệt thật và phán xét
// MỌI request ghi mà trang phát ra.
//
// VÌ SAO TỒN TẠI: cổng parity G1 so TRẠNG THÁI TĨNH — nó không bấm gì, nên
// không phân biệt "nút có nhãn đúng" với "nút LÀM ĐÚNG VIỆC". Với trang chỉ
// đọc, sai nghĩa là "nút không làm gì" (đã bịt bằng chốt móc DOM). Với trang
// GHI, sai nghĩa là **nộp nhầm assignment**, **ghi đè bản nháp bằng rỗng**,
// **nộp hai lần** — không phép so tĩnh nào thấy được.
//
// NGUYÊN TẮC: mọi request ghi phải được KHAI BÁO TRƯỚC. Một request không nằm
// trong bản khai là LỖI, kể cả khi nó trông vô hại.
//
// KHÔNG chạm backend thật: mọi lời gọi mạng bị chặn và trả dữ liệu sẵn. Nên
// cổng này chạy được trong CI, không cần secret, và KHÔNG ghi vào đâu cả — đó
// cũng là lý do nó KHÔNG thay thế bộ e2e staging (bộ kia chứng minh backend
// nhận đúng; bộ này chứng minh trình duyệt GỬI đúng).
//
//   node tooling/verify-write-flows.mjs <base> [tên-luồng…]
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatFindings, isWrite, judge } from './write-flow-core.mjs';
import { storageKey } from './supabase-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLOW_DIR = path.join(HERE, 'write-flows');
const BASE = process.argv[2] || 'http://localhost:3011';
const ONLY = process.argv.slice(3);
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';

const fakeSession = JSON.stringify({
  access_token: 'write-flow-not-a-real-token',
  refresh_token: 'x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000000', email: 'flow@local' },
});

/** Thực thi một bước khai báo. Giữ tập lệnh NHỎ — bản khai phải đọc được. */
async function step(page, s) {
  if (s.click) return page.locator(s.click).first().click();
  if (s.fill) return page.locator(s.fill[0]).first().fill(s.fill[1]);
  if (s.wait) return page.waitForTimeout(s.wait);
  if (s.expectVisible) {
    const v = await page.locator(s.expectVisible).first().isVisible();
    if (!v) throw new Error(`không thấy «${s.expectVisible}»`);
    return undefined;
  }
  throw new Error(`bước không hiểu được: ${JSON.stringify(s)}`);
}

async function runFlow(browser, flow) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); } catch (_) {}
  }, [storageKey(SB), fakeSession]);
  const page = await ctx.newPage();

  const observed = [];
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

    if (isWrite(req.method())) {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData(); }
      observed.push({ method: req.method(), url, body });
    }

    // CDN đi thật — chúng là hành vi trang thật (lucide, supabase-js, chart.js).
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) {
      return route.continue();
    }
    for (const [re, payload] of flow.canned || []) {
      if (re.test(url)) {
        if (payload && payload.__delayMs) await new Promise((r) => setTimeout(r, payload.__delayMs));
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(payload && payload.__body !== undefined ? payload.__body : payload),
        });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(BASE + flow.route, { waitUntil: 'domcontentloaded' });
  // Cố ý CHỜ NGẮN rồi mới bấm: bấm sớm + API chậm là kịch bản người dùng thật,
  // và là kịch bản duy nhất lộ ra lỗi "listener gắn sau khi API trả về" (đã
  // gặp thật ở `/speaking`).
  await page.waitForTimeout(flow.settleMs ?? 400);

  let stepError = null;
  try {
    for (const s of flow.steps) await step(page, s);
  } catch (e) {
    stepError = e;
  }
  await page.waitForTimeout(flow.drainMs ?? 1200);

  const verdict = judge(observed, flow.writes || [], { ignore: flow.ignoreWrites || [] });
  await ctx.close();
  return { verdict, stepError, pageErrors, observed };
}

const files = readdirSync(FLOW_DIR).filter((f) => f.endsWith('.mjs'))
  .filter((f) => !ONLY.length || ONLY.includes(path.basename(f, '.mjs')));
if (!files.length) {
  console.error('không có luồng nào để chạy');
  process.exit(2);
}

const browser = await chromium.launch();
let failed = 0;
for (const f of files) {
  const flow = (await import(path.join(FLOW_DIR, f))).default;
  const { verdict, stepError, pageErrors } = await runFlow(browser, flow);
  const bad = !verdict.pass || stepError || pageErrors.length;
  if (bad) failed += 1;
  console.log(`\n══ ${flow.name} (${flow.route}) · ${verdict.writeCount} request ghi`);
  if (stepError) console.log(`  ✗ [bước] ${stepError.message}`);
  for (const e of pageErrors) console.log(`  ✗ [lỗi JS] ${e.slice(0, 140)}`);
  console.log(formatFindings(verdict.findings));
}
await browser.close();
console.log(`\n  ${files.length - failed}/${files.length} luồng đạt`);
process.exit(failed ? 1 : 0);
