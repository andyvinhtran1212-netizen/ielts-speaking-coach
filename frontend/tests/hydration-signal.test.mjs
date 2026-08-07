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

const NẠP_MODULE = pages().filter((f) => /<script\s+type="module"/.test(readFileSync(f, 'utf8')));

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
const CHƯA_VÁ = new Set([
  '(authed-exercises)/exercises/page.tsx',
  '(authed-flashcards)/flashcards/page.tsx',
  '(authed-listening)/listening/analytics/page.tsx',
  '(authed-listening)/listening/browse/page.tsx',
  '(authed-listening)/listening/mini-test/page.tsx',
  '(authed-listening)/listening/page.tsx',
  '(authed-listening)/listening/practice/page.tsx',
  '(authed-listening)/listening/skills/page.tsx',
  '(authed-listening)/listening/tests/page.tsx',
  '(authed-reading)/reading/mini-test/page.tsx',
  '(authed-reading)/reading/skill/page.tsx',
  '(authed-reading)/reading/test/page.tsx',
  '(authed-reading)/reading/vocab/page.tsx',
]);

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
      const s = readFileSync(f, 'utf8');
      const tên = rel(f);
      if (!/<HydratedSignal\s*\/>/.test(s)) xấu.push(`${tên}: không render <HydratedSignal />`);
      if (!/__averHydrated/.test(s)) xấu.push(`${tên}: không đọc cờ __averHydrated`);
      if (!/aver:hydrated/.test(s)) xấu.push(`${tên}: không nghe sự kiện aver:hydrated`);
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

  // Danh sách nợ chỉ được NGẮN ĐI. Một trang mới nạp module mà không có chốt sẽ
  // làm test này đỏ ngay, thay vì âm thầm thừa hưởng lỗi.
  test('không trang MỚI nào nhập hội danh sách chưa vá', () => {
    const lạ = NẠP_MODULE.map(rel).filter((r) => CHƯA_VÁ.has(r) === false
      && !/__averHydrated/.test(readFileSync(path.join(APP, r), 'utf8')));
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
