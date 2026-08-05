// Chặn CẢ LỚP lỗi hydration do lucide, không chỉ chỗ đã gặp.
//
// SỰ THẬT ĐO ĐƯỢC (không phải suy đoán): lucide@1.17.0 TỰ thay mọi phần tử
// `[data-lucide]` bằng `<svg>` ngay khi script nạp xong. Nó KHÔNG đi qua
// `window.lucide.createIcons()` — bọc hàm đó lại và đếm thì được 0 lần gọi,
// trong khi thẻ `<i>` vẫn biến mất và `<svg>` xuất hiện.
//
// HỆ QUẢ: bỏ lời gọi `createIcons` trong layout KHÔNG cứu được gì (đã thử).
// Chừng nào còn `data-lucide` trong cây React thì còn một cuộc ĐUA: lucide nạp
// `defer` từ CDN, nếu nó thắng chunk hydrate thì React quay lại thấy `<svg>` ở
// chỗ nó vừa dựng `<i>` → Minified React error #418, cả cây dựng lại phía
// client. `suppressHydrationWarning` cũng không cứu được: nó chỉ che khác biệt
// thuộc-tính/text trên chính phần tử đó, không che việc con đổi hẳn loại thẻ.
//
// Vì là ĐUA nên chạy thử vài lần thấy xanh KHÔNG chứng minh được gì — phải
// chặn ở tầng mã nguồn. (Cổng parity authed bắt được nó ở CI đúng một lần,
// sau khi bản dựng cục bộ xanh.)
//
// CÁCH ĐÚNG khi port trang legacy có icon lucide: nhúng thẳng SVG mà lucide
// sinh ra, BỎ thuộc tính `data-lucide`, giữ class `lucide lucide-*` để CSS còn
// khớp. Mẫu: `(authed-home)/home-preview/page-shell.tsx`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

// Ngoại lệ phải kèm LÝ DO. Không thêm dòng mới vào đây chỉ để test xanh.
const EXCEPTIONS = new Map([
  ['(marketing)/page.tsx',
   'Trang chủ — pilot 1, ĐÃ cutover và đang chạy production. Đo 3/3 sạch dưới ' +
   '`repro-418.mjs --slow-react` nên KHÔNG phải lỗi đang xảy ra; chưa rõ vì sao ' +
   'nó thoát trong khi /home-preview thì dính. Cố ý không đụng vào một route ' +
   'đang sống chỉ để dọn dẹp — chuyển sang SVG nhúng khi nào sửa trang này vì ' +
   'việc khác.'],
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

// PHẢI bỏ chú thích TRƯỚC khi tìm, nếu không chính đoạn giải thích lỗi này lại
// bị tính là vi phạm. (Đã dính đúng bẫy đó khi viết bản test đầu tiên.)
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // /* … */ và {/* … */}
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // // … — chừa `https://`
}

test('không có data-lucide trong cây React (đua với hydrate → #418)', () => {
  const offenders = walk(APP)
    .filter((f) => /data-lucide/.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => f.slice(APP.length + 1))
    .filter((rel) => !EXCEPTIONS.has(rel));
  assert.deepEqual(offenders, [],
    'Nhúng thẳng SVG và bỏ data-lucide — xem chú thích đầu tệp test này.');
});

test('mọi ngoại lệ đều còn tồn tại và vẫn thực sự vi phạm', () => {
  // Ngoại lệ chết là ngoại lệ nói dối: nó khiến người đọc tin còn nợ kỹ thuật
  // ở chỗ đã dọn, hoặc che mất việc tệp đã bị đổi tên.
  for (const [rel, reason] of EXCEPTIONS) {
    const src = stripComments(readFileSync(join(APP, rel), 'utf8'));
    assert.ok(/data-lucide/.test(src), `ngoại lệ thừa, gỡ đi: ${rel}`);
    assert.ok(reason.length > 40, `ngoại lệ phải ghi lý do: ${rel}`);
  }
});
