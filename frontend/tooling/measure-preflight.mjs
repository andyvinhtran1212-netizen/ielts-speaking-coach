// KIỂM DỤNG CỤ TRƯỚC KHI TIN SỐ NÓ ĐƯA.
//
//   node tooling/measure-preflight.mjs <base> [--route /x] [--authed] [--build]
//
// VÌ SAO CÓ TỆP NÀY: ngày 2026-08-08, trong MỘT phiên làm việc, bảy phép đo cho
// ra kết luận sai — không phải vì suy luận sai mà vì DỤNG CỤ đo sai thứ. Mỗi lần
// đều tốn một vòng chẩn đoán, và hai lần suýt dẫn tới vá nhầm bệnh:
//
//   1. Đo nhầm máy chủ của một ứng dụng KHÁC đang chiếm cổng 3000. Trang trả
//      200, có chữ, có DOM — chỉ là của người khác.
//   2. Quên tiêm phiên giả ⇒ trang bật về đăng nhập ⇒ «10/11 trang không boot»
//      là kết luận về cổng đăng nhập, không phải về trang.
//   3. Đổi origin sang `localhost` ⇒ CẢ HAI vế cùng 0 request ⇒ «0 = 0 = khớp».
//      Một phép so không phân biệt được gì thì không phải phép so.
//   4. `node --test` báo `fail=0` nhưng `cancelled=5` và `rc=1`; lệnh lại dẫn
//      qua `grep` nên mã thoát bị nuốt. Suýt đẩy 5 test đỏ.
//   5. Grep trong clone đang đứng ở commit CŨ ⇒ «phát hiện» một lỗ cổng không
//      tồn tại, và suýt mở PR vá nó.
//
// Bốn cái đầu là điều kiện tiên quyết KIỂM ĐƯỢC TRƯỚC. Đó là việc của tệp này.
//
// PHẠM VI CÓ Ý THỨC: nó KHÔNG nói phép đo của bạn đúng. Nó chỉ loại bỏ mấy cách
// sai rẻ tiền nhất — đo nhầm máy chủ, đo bản dựng cũ, đo cổng đăng nhập, đo
// nhầm cây mã. Sai vì hỏi sai câu hỏi thì không công cụ nào cứu được.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storageKey } from './supabase-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE = path.join(HERE, '..');
const ROOT = path.join(FE, '..');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const flag = (n) => argv.includes(n);
const BASE = (argv[0] || '').replace(/\/+$/, '');
const ROUTE = arg('--route', '/grammar');
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';

if (!BASE || BASE.startsWith('--')) {
  console.error('cách dùng: node tooling/measure-preflight.mjs <base> [--route /x] [--authed] [--build]');
  process.exit(2);
}

// Suy khoá phiên MỘT LẦN. `storageKey()` NÉM khi URL project lạ; không bắt thì
// công cụ chết kèm stack thô — mà đây là thứ người ta chạy KHI ĐANG BỐI RỐI,
// nên nó phải nói được chuyện gì hỏng. (Bản đầu tôi chỉ bọc chỗ dùng THỨ HAI và
// vẫn chết ở chỗ thứ nhất — đúng bài học «vá xong phải grep cả module».)
let KHOÁ = null;
let lỗiKhoá = null;
try { KHOÁ = storageKey(SB); } catch (e) { lỗiKhoá = e.message; }

const lỗi = [];
const ghi = (ok, nhãn, chi = '') =>
  console.log(`  ${ok ? '✓' : '✗'} ${nhãn}${chi ? ' — ' + chi : ''}`);
const đòi = (ok, nhãn, chi = '') => { ghi(ok, nhãn, chi); if (!ok) lỗi.push(nhãn); };

// ── 1. CÂY MÃ ĐANG ĐO LÀ CÂY NÀO ────────────────────────────────────────────
// Thất bại #5: grep trong một clone đứng ở commit cũ. Không có cách nào biết
// bằng mắt — hai cây trông hệt nhau.
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
try {
  const head = git('rev-parse', '--short', 'HEAD');
  const nhánh = git('rev-parse', '--abbrev-ref', 'HEAD');
  const bẩn = git('status', '--porcelain').split('\n').filter((l) => l && !l.startsWith('??')).length;
  ghi(true, 'cây mã', `${nhánh}@${head}${bẩn ? ` · ${bẩn} tệp đã sửa chưa commit` : ''}`);
  // Đứng SAU origin là dấu hiệu điển hình của «đo nhầm clone cũ».
  try {
    const sau = git('rev-list', '--count', 'HEAD..origin/main').trim();
    đòi(sau === '0', 'HEAD không đứng sau origin/main',
      sau === '0' ? '' : `đang thiếu ${sau} commit — đo trên cây CŨ?`);
  } catch { ghi(true, 'không so được với origin/main', 'bỏ qua'); }
} catch (e) {
  đòi(false, 'đọc được trạng thái git', e.message);
}

// ── 2. BẢN DỰNG CÓ MỚI HƠN NGUỒN KHÔNG ──────────────────────────────────────
// Đo trên `.next` cũ thì mọi kết luận đều về bản trước. Đã suýt dính khi một
// lượt `npm run build` hỏng mà tôi vẫn đọc số từ máy chủ đang chạy bản cũ.
if (flag('--build')) {
  const bid = path.join(FE, '.next', 'BUILD_ID');
  if (!existsSync(bid)) {
    đòi(false, 'có bản dựng', 'thiếu .next/BUILD_ID — chưa `npm run build`');
  } else {
    const tBuild = statSync(bid).mtimeMs;
    let mới = 0; let tệpMới = '';
    const đi = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { đi(p); continue; }
        const t = statSync(p).mtimeMs;
        if (t > mới) { mới = t; tệpMới = path.relative(FE, p); }
      }
    };
    for (const d of ['app', 'components', 'lib', 'public/js']) {
      const p = path.join(FE, d);
      if (existsSync(p)) đi(p);
    }
    đòi(tBuild >= mới, 'bản dựng mới hơn nguồn',
      tBuild >= mới ? '' : `«${tệpMới}» sửa SAU lần dựng — dựng lại trước khi đo`);
  }
}

// ── 3. CỔNG NÀY CÓ PHẢI MÁY CHỦ CỦA MÌNH KHÔNG ──────────────────────────────
// Thất bại #1, tốn nhiều thời gian nhất: một ứng dụng khác chiếm cổng 3000, trả
// 200 kèm DOM đầy đủ. Mọi con số vòng đó vô nghĩa mà trông hoàn toàn bình thường.
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
if (flag('--authed')) {
  // Phiên GIẢ chỉ để qua cổng chuyển hướng; token vô giá trị, API sẽ 401 — không
  // sao, ta đang kiểm «có vào được trang không», không kiểm dữ liệu.
  const phiên = JSON.stringify({
    access_token: 'preflight-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '00000000-0000-0000-0000-000000000000', email: 'preflight@local' },
  });
  if (KHOÁ) {
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} },
      [KHOÁ, phiên]);
  }
}
const pg = await ctx.newPage();
let điHướngTới = null;
try {
  const res = await pg.goto(BASE + ROUTE, { waitUntil: 'load', timeout: 20000 });
  // ĐỌC URL SAU KHI CHUYỂN HƯỚNG KỊP XẢY RA, không ngay sau `load`. Cổng đăng
  // nhập chạy phía client SAU khi hydrate, nên đọc sớm thì thấy route gốc và
  // kết luận «không bị đá» — sai. Bản đầu của chính tệp này mắc đúng lỗi đó,
  // tức lỗi thứ 7 trong danh sách nó sinh ra để chặn.
  await pg.waitForTimeout(Number(arg('--settle', '2500')) || 2500);
  điHướngTới = pg.url();
  đòi(!!res && res.status() < 400, 'route trả về trang', res ? String(res.status()) : 'không có phản hồi');
} catch (e) {
  đòi(false, 'mở được route', e.message.slice(0, 80));
}

// Dấu vân tay «đây là app này»: Next để lại `__next` hoặc chunk `/_next/`, và
// trang của dự án luôn có chrome dùng chung hoặc tiêu đề mang tên thương hiệu.
const vân = await pg.evaluate(() => ({
  next: !!document.querySelector('script[src*="/_next/"], #__next, next-route-announcer'),
  chrome: !!document.querySelector('aver-chrome'),
  title: document.title || '',
  legacy: !!document.querySelector('script[src^="/js/"]'),
})).catch(() => ({ next: false, chrome: false, title: '', legacy: false }));

const củaMình = vân.next || vân.chrome || vân.legacy || /Aver ?Learning/i.test(vân.title);
đòi(củaMình, 'máy chủ này ĐÚNG là của dự án',
  củaMình ? `title=«${vân.title.slice(0, 40)}»`
    : `title=«${vân.title.slice(0, 40)}» — KHÔNG thấy dấu vết Next/aver-chrome/js dự án. `
      + 'Có tiến trình khác chiếm cổng?');

// ── 4. PHIÊN GIẢ CÓ THẬT SỰ VÀO ĐƯỢC KHÔNG ─────────────────────────────────
// Thất bại #2 là «quên tiêm phiên» ⇒ mọi số đo sau đó nói về cổng đăng nhập.
//
// Bản đầu tôi kiểm bằng «trang có bị đá sang /login không» — và KHÔNG dựng được
// đối chứng âm: ở môi trường này cả route Next lẫn trang legacy đều không
// chuyển hướng, nên chốt ấy chưa bao giờ nổ. Một chốt không nổ được thì bằng
// không, mà lại trông như có phủ, nên tôi bỏ nó.
//
// Thứ ĐO ĐƯỢC và nhắm đúng lỗi thật: phiên có nằm trong `localStorage` dưới
// ĐÚNG khoá không. Nó bắt cả hai kiểu hỏng đã gặp — quên tiêm, và tiêm nhầm
// khoá (khoá suy từ URL project, đổi project là đổi khoá).
{
  // `storageKey()` NÉM khi URL project lạ. Không bắt thì công cụ chết kèm stack
  // thô — mà đây là công cụ người ta chạy KHI đang bối rối, nên nó phải nói
  // được chuyện gì hỏng thay vì ném ra một vết ngăn xếp.
  const khoá = KHOÁ;
  if (!khoá) đòi(false, 'suy được khoá phiên từ SUPABASE_URL', `${SB} — ${lỗiKhoá}`);
  if (khoá) {
  const có = await pg.evaluate((k) => {
    try { return !!localStorage.getItem(k); } catch (_) { return false; }
  }, khoá).catch(() => false);
  if (flag('--authed')) {
    đòi(có, 'phiên giả đã vào localStorage', có ? khoá : `KHÔNG thấy khoá «${khoá}»`);
  } else {
    // ĐỐI CHỨNG HAI CHIỀU nằm ở chính cặp nhánh này: có `--authed` thì PHẢI
    // thấy khoá, ẩn danh thì PHẢI không. Một bộ dò luôn-trả-true sẽ đỏ ở nhánh
    // dưới, nên «thấy phiên» ở nhánh trên mới có nghĩa.
    ghi(true, 'chạy ẩn danh', 'không khai --authed');
    if (có) đòi(false, 'ẩn danh mà vẫn có phiên', 'trạng thái rò từ đâu đó');
  }
  }
}

await br.close();

console.log(lỗi.length
  ? `\n  ✗ ${lỗi.length} điều kiện KHÔNG đạt — số đo sau đây sẽ nói về một thứ khác.`
  : '\n  ✓ dụng cụ sạch — đo được.');
process.exit(lỗi.length ? 1 : 0);
