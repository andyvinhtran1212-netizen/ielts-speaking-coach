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
  // Dán là một HÀNH VI RIÊNG, không phải `fill`. Trang Bài viết phân loại theo
  // độ dài đoạn dán (<50 im lặng · 50–200 ghi nhật ký · >200 chặn rồi ghi), và
  // `fill` không hề phát sinh sự kiện `paste` nên sẽ không kiểm được nhánh nào
  // trong ba nhánh đó. Dựng sự kiện thật kèm `clipboardData` để trang chạy đúng
  // đường nó chạy với người dùng, kể cả `preventDefault()` khi bị chặn.
  if (s.paste) {
    const [sel, text] = s.paste;
    return page.locator(sel).first().evaluate((el, t) => {
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      const allowed = el.dispatchEvent(ev);
      // Trình duyệt chỉ chèn văn bản khi handler KHÔNG gọi preventDefault().
      if (allowed) el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  }
  // Phát một sự kiện DOM lên phần tử. Cần cho hành vi KHÔNG bấm được: trình phát
  // audio báo lượt nghe bằng `av-audio-play`, và không có bước này thì bản khai
  // chỉ kiểm được nhánh "chưa nghe lần nào" — tức nó vẫn xanh kể cả khi bộ đếm
  // lượt nghe hỏng hoàn toàn (review cục bộ chỉ ra ở #961).
  if (s.dispatch) {
    const [sel, ev, prop] = s.dispatch;
    return page.locator(sel).first().evaluate((el, [name, onProp]) => {
      // `onProp` cho phép nhắm vào một đối tượng BÊN TRONG component thay vì
      // chính phần tử. Cần thiết để đi qua ĐÚNG đường sinh sự kiện: trình phát
      // audio giữ một `new Audio()` ở `_audio` và chuyển tiếp `play` của nó
      // thành `av-audio-play`. Phát thẳng `av-audio-play` lên host là VÒNG QUA
      // khâu chuyển tiếp đó — luồng vẫn xanh kể cả khi component hỏng (bot bắt
      // ở #962).
      const target = onProp ? el[onProp] : el;
      if (!target) throw new Error(`không thấy «${onProp}» trên ${sel}`);
      target.dispatchEvent(onProp ? new Event(name) : new CustomEvent(name, { bubbles: true }));
    }, [ev, prop]);
  }
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

  // ĐỒNG Ý mọi hộp thoại. Playwright mặc định tự bấm HUỶ, và mặc định đó âm
  // thầm vô hiệu hoá cả cổng này: trang Bài viết đặt `confirm()` ngay trước khi
  // nộp ("sau khi nộp không sửa được nữa"), nên bản chạy mặc định thấy 0 request
  // `/submit` và báo write-missing — trong khi trang HOÀN TOÀN đúng. Người dùng
  // thật bấm Đồng ý, nên đó mới là đường cần kiểm. Ghi lại nội dung hộp thoại để
  // một hộp BẤT NGỜ không lặng lẽ được bấm qua.
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(`${d.type()}: ${d.message().replace(/\s+/g, ' ').slice(0, 80)}`);
    await d.accept();
  });

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

  // `WF_LEGACY=1` chạy CÙNG bản khai này trên vế legacy. Đó là điều biến nó
  // thành cổng PARITY chứ không chỉ là test của bản Next: một bản khai chỉ đáng
  // tin khi nó đã xanh trên trang legacy — tức là nó mô tả hành vi CÓ THẬT, chứ
  // không phải hành vi tôi tưởng tượng ra rồi viết bản Next cho khớp.
  // KHÔNG rơi về `route` khi thiếu `legacyRoute`: làm thế thì bước CI dán nhãn
  // "vế legacy" lại chạy đúng trang Next lần thứ hai và xanh mà chẳng kiểm gì —
  // một cổng tự khen. Thiếu thì BỎ QUA và nói rõ (xử lý ở vòng lặp gọi).
  const target = process.env.WF_LEGACY ? flow.legacyRoute : flow.route;
  await page.goto(BASE + target, { waitUntil: 'domcontentloaded' });
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

  // `expectFinalUrl` — ghim ĐƯỜNG QUAY VỀ sau khi luồng chạy xong.
  //
  // Có luồng mà "ghi đúng" chưa đủ: nhánh kỳ thi thử nộp xong phải bàn giao lại
  // cho trang điều phối. Trả sẵn `{received:true}` chỉ kiểm được ĐẦU VÀO của
  // nhánh đó; không có chốt này thì trang có thể nhận response niêm phong rồi
  // đứng im, và bản khai vẫn xanh (bot bắt ở #969).
  let urlError = null;
  if (flow.expectFinalUrl) {
    const got = page.url();
    const want = flow.expectFinalUrl;
    const ok = want instanceof RegExp ? want.test(got) : got.includes(want);
    if (!ok) urlError = `đường dẫn cuối là «${got}», khai «${want}»`;
  }

  const verdict = judge(observed, flow.writes || [], { ignore: flow.ignoreWrites || [] });
  await ctx.close();
  return { verdict, stepError, pageErrors, observed, dialogs, urlError };
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

  // Bản khai được viết TRƯỚC khi trang Next tồn tại (đó là cả điểm của cách làm
  // này) sẽ làm vế Next đỏ vì route chưa có. `nextPending` hoãn ĐÚNG vế đó, và
  // phải kèm LÝ DO — in ra mỗi lần chạy, không im lặng. Một chốt riêng
  // (`write-flow-manifests.test.mjs`) bắt buộc luồng đã hoãn phải có
  // `legacyRoute`, để nó vẫn được kiểm ở đâu đó chứ không thành lỗ trống.
  if (process.env.WF_LEGACY && !flow.legacyRoute) {
    console.log(`\n══ ${flow.name}`);
    console.log('  ⏸ không khai `legacyRoute` — bỏ qua ở vế legacy');
    continue;
  }

  if (flow.nextPending && !process.env.WF_LEGACY) {
    console.log(`\n══ ${flow.name} (${flow.route})`);
    console.log(`  ⏸ hoãn vế Next: ${flow.nextPending}`);
    console.log('    (vẫn được kiểm trên vế legacy — bước "Cổng đường-ghi (vế legacy)")');
    continue;
  }

  const { verdict, stepError, pageErrors, dialogs, urlError } = await runFlow(browser, flow);
  const bad = !verdict.pass || stepError || pageErrors.length || urlError;
  if (bad) failed += 1;
  console.log(`\n══ ${flow.name} (${flow.route}) · ${verdict.writeCount} request ghi`);
  // In ra chứ không nuốt: cổng tự bấm Đồng ý, nên nếu trang mọc thêm một hộp xác
  // nhận mới thì đây là chỗ duy nhất người đọc thấy được điều đó.
  for (const d of dialogs) console.log(`  · [hộp thoại đã đồng ý] ${d}`);
  if (stepError) console.log(`  ✗ [bước] ${stepError.message}`);
  if (urlError) console.log(`  ✗ [đường dẫn cuối] ${urlError}`);
  for (const e of pageErrors) console.log(`  ✗ [lỗi JS] ${e.slice(0, 140)}`);
  console.log(formatFindings(verdict.findings));
}
await browser.close();
console.log(`\n  ${files.length - failed}/${files.length} luồng đạt`);
process.exit(failed ? 1 : 0);
