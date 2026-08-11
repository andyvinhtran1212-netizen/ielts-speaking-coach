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

import {
  formatFindings, isWrite, judge, normalizePath, parseMultipart, validateFlow,
} from './write-flow-core.mjs';
import { FAKE_USER_ID, storageKey } from './supabase-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLOW_DIR = path.join(HERE, 'write-flows');
const BASE = process.argv[2] || 'http://localhost:3011';
const ONLY = process.argv.slice(3);
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';

const fakeSession = JSON.stringify({
  access_token: 'write-flow-not-a-real-token',
  refresh_token: 'x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'flow@local' },
});

/** Thực thi một bước khai báo. Giữ tập lệnh NHỎ — bản khai phải đọc được. */
async function step(page, s, observed) {
  // ĐỒNG BỘ THEO SỐ REQUEST, không theo đồng hồ tường.
  //
  // Có nhánh chỉ hoàn tất sau một chuỗi thử-lại giãn dần (`RETRY_DELAYS` của
  // `speaking-debt.js`: 1s + 3s + 8s). Chờ bằng một con số giây cố định là ghim
  // vào tốc độ máy: máy CI kẹt nặng chỉ kịp 3 lần trong cửa sổ đủ cho 4, và
  // luồng đỏ vì CHẬM chứ không phải vì SAI. Chờ tới khi ĐỦ SỐ REQUEST thì cùng
  // một bản khai đúng trên máy nhanh lẫn máy chậm, mà vẫn có hạn giờ nên "không
  // bao giờ đủ" vẫn đỏ. (codex cục bộ #982)
  if (s.waitForWrites) {
    const [wantPath, n, timeoutMs] = s.waitForWrites;
    const want = normalizePath(wantPath);
    const limit = timeoutMs || 30000;
    const t0 = Date.now();
    const count = () => observed.filter((r) => normalizePath(r.url) === want).length;
    while (count() < n) {
      if (Date.now() - t0 > limit) {
        throw new Error(`chờ ${n} request tới «${wantPath}» quá ${limit}ms, mới thấy ${count()}`);
      }
      await page.waitForTimeout(120);
    }
    return undefined;
  }
  if (s.click) return page.locator(s.click).first().click();
  if (s.fill) return page.locator(s.fill[0]).first().fill(s.fill[1]);
  if (s.wait) return page.waitForTimeout(s.wait);
  // Tua đồng hồ của TRANG (cần `fakeClock: true`). Khác `wait`: `wait` để trang
  // chạy thật, `advance` nhảy thời gian mà không tốn thời gian thật.
  if (s.advance) return page.clock.runFor(s.advance);
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
  // Kiểm NỘI DUNG chứ không chỉ sự tồn tại. Một khối rỗng vẫn "hiện": fixture
  // Đọc từng ghi `body` thay vì `body_markdown`, nên đoạn đọc render RỖNG mà
  // luồng vẫn xanh vì nó chỉ cần ô nhập (codex cục bộ #969).
  // Kiểm thứ trang CẤT LẠI, không chỉ thứ nó gửi đi. Danh tính ẩn danh chỉ có
  // giá trị nếu nó sống qua một lần tải lại trang — giữ trong bộ nhớ thì mọi
  // request trong phiên vẫn đúng, mà mở lại là mất bài (codex cục bộ #973).
  if (s.expectStorage) {
    const [key, want] = s.expectStorage;
    const got = await page.evaluate((k) => {
      try { return localStorage.getItem(k); } catch (e) { return null; }
    }, key);
    if (got !== want) {
      throw new Error(`localStorage«${key}» = ${JSON.stringify(got)}, khai ${JSON.stringify(want)}`);
    }
    return undefined;
  }
  // Khoá phải KHÔNG CÒN. Tách riêng khỏi `expectStorage` có chủ ý: ở kia
  // `null` bị cấm vì `getItem` trả `null` cả khi khoá vắng lẫn khi localStorage
  // hỏng, nên `expectStorage: [k, null]` là phép so luôn đúng. Ở đây "vắng"
  // CHÍNH LÀ điều cần khẳng định — nợ đã trả xong thì phải được xoá, để lần mở
  // trang sau không gửi lại lần nữa.
  if (s.expectStorageAbsent) {
    const key = s.expectStorageAbsent;
    const got = await page.evaluate((k) => {
      try { return localStorage.getItem(k); } catch (e) { return '__LOI_LOCALSTORAGE__'; }
    }, key);
    if (got === '__LOI_LOCALSTORAGE__') throw new Error('không đọc được localStorage');
    if (got !== null) {
      throw new Error(`localStorage«${key}» vẫn còn: ${String(got).slice(0, 80)}`);
    }
    return undefined;
  }
  if (s.expectText) {
    const [sel, text] = s.expectText;
    const el = page.locator(sel).first();
    // HIỆN RA rồi mới xét chữ. `innerText()` vẫn trả chữ của một phần tử đang
    // `hidden`, nên chỉ so chữ thì một cảnh báo có nội dung nhưng KHÔNG hiện lên
    // vẫn qua — đúng thứ cảnh báo đó sinh ra để làm (phá thử bắt ở #970).
    if (!(await el.isVisible().catch(() => false))) {
      throw new Error(`«${sel}» không hiện ra (có thể đang bị ẩn)`);
    }
    const got = await el.innerText().catch(() => null);
    if (got == null || !got.includes(text)) {
      throw new Error(`«${sel}» không chứa «${text}» — nhận «${String(got).slice(0, 60)}»`);
    }
    return undefined;
  }
  if (s.expectVisible) {
    // CHỜ rồi mới khẳng định. Hỏi `isVisible()` một lần là hỏi sai kiểu với giao
    // diện bất đồng bộ: `getUserMedia` mất một lúc mới cấp thiết bị, màn nhận xét
    // chờ phản hồi chấm bài — kiểm ngay lập tức thì luồng đỏ vì CHƯA KỊP chứ
    // không phải vì SAI. Vẫn có hạn giờ, nên "không bao giờ hiện" vẫn đỏ.
    try {
      await page.locator(s.expectVisible).first()
        .waitFor({ state: 'visible', timeout: s.timeoutMs || 8000 });
    } catch {
      throw new Error(`không thấy «${s.expectVisible}» sau ${s.timeoutMs || 8000}ms`);
    }
    return undefined;
  }
  throw new Error(`bước không hiểu được: ${JSON.stringify(s)}`);
}

async function runFlow(browser, flow) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Chỉ cấp quyền micro cho luồng KHAI cần — để một luồng khác lỡ xin quyền
    // thì vẫn đi đúng nhánh "bị từ chối" như người dùng thật chưa cho phép.
    ...(flow.fakeMedia ? { permissions: ['microphone'] } : {}),
  });
  // `anonymous: true` — KHÔNG gieo phiên đăng nhập. Mặc định mọi luồng đều được
  // gieo một phiên giả, nên một luồng tự nhận là "ẩn danh" vẫn gửi kèm
  // `Authorization` và chưa từng chạy đúng cảnh người dùng CHƯA đăng nhập: một
  // cổng quyền làm hỏng đúng nhóm đó vẫn xanh (codex cục bộ #973).
  if (!flow.anonymous) {
    await ctx.addInitScript(([k, v]) => {
      try { localStorage.setItem(k, v); } catch (_) {}
    }, [storageKey(SB), fakeSession]);
  }
  // GIEO SẴN localStorage. Có luồng chỉ tồn tại khi trang mở ra và ĐÃ CÓ trạng
  // thái cũ: nợ báo-điểm-Speaking được ghi lại ở lần hỏng trước, rồi trang chủ
  // phát lại lúc mở. Không gieo được thì nhánh cứu bài đó không có cách nào chạm
  // tới — mà nó chính là nhánh giữ cho một lượt thi thử không mất điểm.
  if (flow.initStorage) {
    await ctx.addInitScript((pairs) => {
      try {
        for (const [k, v] of pairs) localStorage.setItem(k, v);
      } catch (_) {}
    }, Object.entries(flow.initStorage));
  }

  const page = await ctx.newPage();

  // ĐỒNG HỒ GIẢ. Có nhánh chỉ mở ra sau một khoảng chờ dài — báo động "máy chủ
  // chưa nhận được câu nào" đợi 45 giây lưu hỏng. Chờ thật thì một luồng ăn gần
  // một phút CI; sửa ngưỡng trong mã sản phẩm để dễ kiểm thì làm yếu đúng bảo
  // đảm đang muốn ghim. Tua đồng hồ giữ nguyên cả hai.
  if (flow.fakeClock) await page.clock.install();

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
      // MULTIPART: tách thành `{tên trường: giá trị}` để bản khai ghim được.
      //
      // Bản thu của học viên đi bằng `FormData` (`practice.js:679-684`), và
      // chuỗi multipart thô thì không phép so nào đọc nổi — tức đường ghi ĐẮT
      // GIÁ NHẤT của Speaking là đường duy nhất cổng này không soi được. Với
      // phần TỆP thì giữ lại siêu dữ liệu (tên tệp, kiểu, SỐ BYTE) chứ không giữ
      // nội dung: thứ cần ghim là "có tệp và tệp không rỗng", không phải byte.
      const ct = (req.headers()['content-type'] || '');
      if (typeof body === 'string' && ct.startsWith('multipart/form-data')) {
        // Đọc theo BYTE. `postData()` là chuỗi đã diễn giải UTF-8, nên với dữ
        // liệu nhị phân thì `.length` là số đơn vị UTF-16 chứ KHÔNG phải số byte
        // tệp — một con số nghe như byte mà không phải byte thì tệ hơn không có
        // (codex cục bộ #980).
        const buf = req.postDataBuffer();
        const parsed = buf ? parseMultipart(buf, ct) : null;
        if (parsed) body = parsed;
      }
      // GHI LẠI TIÊU ĐỀ, không chỉ thân. Có hợp đồng mà bằng chứng nằm ở tiêu
      // đề chứ không ở thân: bài Đọc qua liên kết chia sẻ mang danh tính ẩn danh
      // ở `X-Reading-Anon`, và mất nó thì máy chủ từ chối lưu — mất bài của học
      // viên trong khi thân request vẫn đúng từng chữ (codex cục bộ #969).
      observed.push({ method: req.method(), url, body, headers: req.headers() });
    }

    // CDN đi thật — chúng là hành vi trang thật (lucide, supabase-js, chart.js).
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) {
      return route.continue();
    }
    for (const [re, payload] of flow.canned || []) {
      if (re.test(url)) {
        if (payload && payload.__delayMs) await new Promise((r) => setTimeout(r, payload.__delayMs));
        // `__status` cho phép dựng ĐƯỜNG HỎNG. Không có nó thì mọi lời gọi đều
        // 200, và các nhánh chỉ chạy khi máy chủ lỗi — như báo động "máy chủ
        // chưa nhận được câu nào" — không thể chạm tới (codex cục bộ #969).
        const status = (payload && payload.__status) || 200;
        return route.fulfill({
          status, contentType: 'application/json',
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
    for (const s of flow.steps) await step(page, s, observed);
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
  if ('expectFinalUrl' in flow) {
    const want = flow.expectFinalUrl;
    // Khai rỗng hay sai kiểu là LỖI, không phải "bỏ qua": `expectFinalUrl: ''`
    // đọc như đang ghim đường quay về trong khi nó không ghim gì.
    if (!(want instanceof RegExp) && !(typeof want === 'string' && want)) {
      urlError = '`expectFinalUrl` phải là RegExp hoặc chuỗi khác rỗng';
    } else {
      // So với ĐƯỜNG DẪN + THAM SỐ, không phải chuỗi con của cả URL: so chuỗi
      // con thì một giá trị nằm lọt trong một tham số khác cũng khớp.
      const u = new URL(page.url());
      const got = u.pathname + u.search;
      const ok = want instanceof RegExp ? want.test(got) : got === want;
      if (!ok) urlError = `đường dẫn cuối là «${got}», khai «${want}»`;
    }
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

// HAI TRÌNH DUYỆT, không phải một.
//
// Đường ghi đắt giá nhất của Speaking là bản THU ÂM, và nó chỉ tồn tại nếu
// `getUserMedia` + `MediaRecorder` chạy được. Chèn stub vào mã sản phẩm thì bản
// khai kiểm cái stub chứ không kiểm trang, nên dùng THIẾT BỊ GIẢ của Chrome.
//
// Nhưng bật cờ đó cho MỌI luồng là hỏng: `--use-fake-ui-for-media-stream` TỰ
// ĐỒNG Ý mọi lời xin quyền thu, kể cả ở luồng không khai `fakeMedia` — nó vô
// hiệu hoá đúng phép cô lập quyền mà `newContext` đang làm, và một trang lỡ xin
// micro sẽ không bao giờ đi vào nhánh bị-từ-chối. `--autoplay-policy` cũng gỡ
// luôn ràng buộc phải-có-thao-tác-người-dùng cho mọi luồng Listening.
// (codex cục bộ #980)
//
// Nên: trình duyệt thường cho 16 luồng, trình duyệt có-media dựng LƯỜI, chỉ khi
// gặp luồng đầu tiên khai `fakeMedia`.
const browser = await chromium.launch();
let mediaBrowser = null;
async function browserFor(flow) {
  if (!flow.fakeMedia) return browser;
  if (!mediaBrowser) {
    mediaBrowser = await chromium.launch({
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
  }
  return mediaBrowser;
}
let failed = 0;
for (const f of files) {
  const flow = (await import(path.join(FLOW_DIR, f))).default;

  // Kiểm LƯỢC ĐỒ trước khi chạy. Một bản khai sai kiểu chạy được nhưng không
  // ghim gì là thứ nguy hơn một bản khai đỏ.
  const schemaErrs = validateFlow(flow);
  if (schemaErrs.length) {
    failed += 1;
    console.log(`\n══ ${flow && flow.name ? flow.name : f}`);
    for (const e of schemaErrs) console.log(`  ✗ [bản khai] ${e}`);
    continue;
  }

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

  const { verdict, stepError, pageErrors, dialogs, urlError } =
    await runFlow(await browserFor(flow), flow);
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
if (mediaBrowser) await mediaBrowser.close();
console.log(`\n  ${files.length - failed}/${files.length} luồng đạt`);
process.exit(failed ? 1 : 0);
