// Trang Next nạp module legacy PHẢI chờ tín hiệu hydrate của chính React.
//
// VÌ SAO CÓ CHỐT NÀY: bảy trang port đều nhúng một `<script type="module">` gọi
// `mount()` của module legacy, và `mount()` ĐỔI DOM. Chạy trước khi React
// hydrate thì React thấy cây không khớp HTML máy chủ, vứt bản máy chủ và dựng
// lại — xoá sạch thay đổi của module, trang quay về "Đang tải…". Đó là React
// #418, đã xảy ra THẬT trên production.
//
// TIỀN ĐỀ SAI ĐÃ BỊ BỎ, và đây là phần đáng nhớ: bản vá đầu chờ sự kiện `load`
// rồi cộng một macrotask, kèm chú thích khẳng định "load xảy ra sau khi React
// đã hydrate xong cây". SAI. `load` chỉ nói tài nguyên đã tải xong; React
// 18/19 hydrate theo chế độ ĐỒNG THỜI nên việc hydrate được lên lịch riêng và
// có thể chưa xong lúc `load` bắn.
//
// Đo được, lặp lại 3/3 khi ép chunk chậm 900ms trên `/speaking/result`: mốc
// ~990ms module ghi chữ vào `#state-error`, ~10ms sau React gỡ và dựng lại
// `AVER-CHROME`/`DIV`/`SCRIPT`. Năm trang còn lại xanh chỉ vì nhịp khác — tức
// MAY, không phải đúng. Một bản vá dựa trên tiền đề sai mà "chạy được" là thứ
// nguy hiểm hơn cả không vá, vì nó trông như đã xong.
//
// PHẠM VI: chốt này kiểm HÌNH DẠNG mã. Phần hành vi do
// `tooling/repro-418.mjs --slow-react` lo, chạy trong cổng parity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend/app');

function pages(dir = APP, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) pages(full, out);
    else if (e.name === 'page.tsx') out.push(full);
  }
  return out;
}

/** Bỏ DÒNG chú thích — marker nằm trong chú thích không phải mã. */
const khôngChúThích = (f) => readFileSync(f, 'utf8').split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Dò KHÔNG phụ thuộc thứ tự thuộc tính hay kiểu nháy: bản đầu chỉ khớp đúng
// `<script type="module"` với `type` đứng đầu và nháy kép, nên `<script defer
// type='module'>` sẽ lọt khỏi mọi khẳng định bên dưới (codex bắt ở #1003).
const LÀ_MODULE = /<script[^>]*\stype=["']module["']/;
// PHẢI bắt CẢ `<LegacyModule>`. Sau khi 11 trang chuyển từ thẻ `<script>` sang
// component đó, chúng RƠI KHỎI danh sách này và mọi khẳng định bên dưới không
// còn chạy trên chúng — chốt ngừng canh đúng thứ nó sinh ra để canh, mà vẫn
// xanh vì `NẠP_MODULE.length >= 5` được thoả bởi các trang khác (codex #1004).
const LÀ_LEGACY_MODULE = /<LegacyModule\s/;
const NẠP_MODULE = pages().filter((f) => {
  const t = khôngChúThích(f);
  return LÀ_MODULE.test(t) || LÀ_LEGACY_MODULE.test(t);
});

// NỢ ĐÃ BIẾT — các trang port từ những đợt TRƯỚC, nạp module bằng
// `<script type="module" src="…">` trần, KHÔNG có chốt nào.
//
// Đo được ngày 2026-08-08 bằng `repro-418.mjs --slow-react` trên bản dựng thật:
// CẢ SÁU trang thử đều tái hiện đúng một lỗi hydrate. Chúng đang chạy trên
// production, nên vá 12 trang trong cùng một lượt là rủi ro không cần thiết —
// việc đó tách riêng.
//
// VÌ SAO GHI RA THAY VÌ THU HẸP PHẠM VI CHỐT: thu hẹp thì chốt im lặng về 12
// trang hỏng, tức nó nói dối bằng cách bỏ sót. Ghi thành danh sách thì (1) một
// trang MỚI không thể lặng lẽ nhập hội, (2) danh sách chỉ có thể ngắn đi, và
// (3) người đọc thấy đúng quy mô còn lại.
// NỢ ĐÃ TRẢ HẾT (2026-08-08). Danh sách này từng có 13 trang port từ các đợt
// TRƯỚC, nạp module bằng `<script type="module" src>` trần. Sáu trang đã thử
// đều tái hiện React #418 dưới `repro-418.mjs --slow-react`, và chúng đang
// chạy production.
//
// GIỮ LẠI SET RỖNG thay vì xoá hẳn cơ chế: ngân sách 0 dưới đây biến "thêm một
// trang vào danh sách nợ" thành lỗi đỏ ngay, nên không ai có thể nới cổng bằng
// cách khai nợ mới.
const CHƯA_VÁ = new Set([]);

const rel = (f) => path.relative(APP, f);
const ĐÃ_VÁ = NẠP_MODULE.filter((f) => !CHƯA_VÁ.has(rel(f)));

describe('trang Next nạp module legacy phải chờ React báo hydrate xong', () => {
  test('quét được một lượng trang đáng kể', () => {
    // Bộ dò hỏng ⇒ danh sách rỗng ⇒ mọi khẳng định dưới thành xanh-rỗng.
    assert.ok(NẠP_MODULE.length >= 5, `chỉ thấy ${NẠP_MODULE.length} trang nạp module`);
  });

  test('mỗi trang render <HydratedSignal /> và đọc cờ của nó', () => {
    const xấu = [];
    for (const f of ĐÃ_VÁ) {
      // Đọc bản ĐÃ BỎ chú thích: ba marker dưới đây nằm trong chú thích thôi
      // cũng đủ làm chốt xanh, tức chốt tự lừa mình (codex bắt ở #1003).
      const s = khôngChúThích(f);
      const tên = rel(f);
      if (!/<HydratedSignal\s*\/>/.test(s)) xấu.push(`${tên}: không render <HydratedSignal />`);
      // Hai khuôn: trang MOUNT nội tuyến tự đọc cờ; trang `<LegacyModule>` uỷ
      // việc chờ cho component (useEffect) nên chỉ cần có component + watchdog.
      const uỷ = /<LegacyModule\s/.test(s);
      if (!uỷ && !/__averHydrated/.test(s)) xấu.push(`${tên}: không đọc cờ __averHydrated`);
      if (!uỷ && !/aver:hydrated/.test(s)) xấu.push(`${tên}: không nghe sự kiện aver:hydrated`);
      // ĐƯỜNG LUI cũng là một phần hợp đồng: thiếu nó thì một lần chunk React
      // hỏng là trang treo vĩnh viễn — bản vá đổi lỗi #418 lấy lỗi treo.
      if (!/watchdogScript\(/.test(s)) xấu.push(`${tên}: thiếu watchdogScript()`);
    }
    assert.deepEqual(xấu.sort(), [],
      'module legacy chạy trước khi React hydrate ⇒ React vứt HTML máy chủ ⇒ trang trắng');
  });

  test('KHÔNG trang nào quay lại chờ `load` — đó là tiền đề sai', () => {
    const xấu = [];
    for (const f of ĐÃ_VÁ) {
      // Bỏ DÒNG CHÚ THÍCH rồi soi cả tệp. Bản đầu cố bóc đúng khối
      // `const MOUNT = \`…\``, và một trang khai khác khuôn đã làm chốt đỏ vì
      // "không đọc được khối" — tức chốt phụ thuộc vào cách viết chứ không vào
      // tính chất. Chú thích PHẢI được bỏ, vì chúng buộc phải nhắc tới `load`
      // để giải thích vì sao KHÔNG dùng nó.
      const thân = readFileSync(f, 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/addEventListener\(\s*["']load["']/.test(thân)) {
        xấu.push(`${path.relative(APP, f)}: còn chờ sự kiện load`);
      }
      if (/readyState\s*===\s*["']complete["']/.test(thân)) {
        xấu.push(`${path.relative(APP, f)}: còn đọc readyState === complete`);
      }
    }
    assert.deepEqual(xấu.sort(), [],
      '`load` KHÔNG bảo đảm React đã hydrate xong — xem đầu tệp này');
  });

  // NGÂN SÁCH KHÔNG TĂNG. Không có khẳng định này thì câu "danh sách chỉ ngắn
  // đi" là SAI — và tôi đã viết đúng câu sai đó trong mô tả PR: thêm một trang
  // hỏng vào `CHƯA_VÁ` sẽ loại nó khỏi CẢ `ĐÃ_VÁ` LẪN danh sách "trang lạ", nên
  // toàn bộ suite vẫn xanh. Một allowlist tự nới được thì không phải cổng.
  test('danh sách nợ KHÔNG được dài thêm', () => {
    assert.equal(CHƯA_VÁ.size, 0,
      `CHƯA_VÁ có ${CHƯA_VÁ.size} mục. Nợ đã trả hết ngày 2026-08-08 — ngân sách `
      + 'là 0. Vá trang mới, đừng khai nó thành nợ.');
  });

  test('không trang MỚI nào nhập hội danh sách chưa vá', () => {
    const lạ = NẠP_MODULE.map(rel).filter((r) => {
      const t = khôngChúThích(path.join(APP, r));
      return !CHƯA_VÁ.has(r) && !/__averHydrated/.test(t) && !/<LegacyModule\s/.test(t);
    });
    assert.deepEqual(lạ.sort(), [], 'trang nạp module mà không chờ tín hiệu hydrate');

    const đãBiến = [...CHƯA_VÁ].filter((r) => !NẠP_MODULE.map(rel).includes(r));
    assert.deepEqual(đãBiến.sort(), [],
      'mục trong CHƯA_VÁ không còn tồn tại — vá xong thì xoá khỏi danh sách');
  });

  test('component tín hiệu đặt CỜ trước rồi mới phát sự kiện', () => {
    // Thiếu cờ thì đúng những lần hydrate NHANH hơn module sẽ treo mãi: module
    // gắn listener sau khi sự kiện đã bắn. Vá xong lại sinh lỗi mới.
    const s = readFileSync(path.join(ROOT, 'frontend/components/hydrated-signal.tsx'), 'utf8');
    const iCờ = s.indexOf('HYDRATED_FLAG]');
    const iBắn = s.indexOf('dispatchEvent');
    assert.ok(iCờ > 0 && iBắn > 0, 'không tìm thấy chỗ đặt cờ hoặc chỗ phát sự kiện');
    assert.ok(iCờ < iBắn, 'phải đặt cờ TRƯỚC khi phát sự kiện');
    assert.match(s, /'use client'/, 'phải là client component thì useEffect mới chạy');
  });
});
