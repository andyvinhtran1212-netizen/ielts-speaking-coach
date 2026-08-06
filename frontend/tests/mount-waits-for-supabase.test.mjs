// Trang dùng khuôn `mount()` PHẢI chờ Supabase sẵn sàng rồi mới gọi module.
//
// LỖI THẬT ĐÃ ĐO ĐƯỢC, không phải phòng xa: `_loader.js` đọc
// `getSupabase().auth.getSession()`; không có client thì token rỗng và nó gọi
// `redirectToLogin()` → `/index.html` → Next 307 sang `/`. Kết quả: bản Next
// nhảy về trang chủ trong khi bản legacy ở nguyên trang.
//
// Vì sao legacy không dính: nó gọi `initSupabase(...)` trong một script THƯỜNG
// ngay TRƯỚC thẻ module. Khung Next gọi ở `DOMContentLoaded`, và đo được rằng
// lúc script module chạy thì `getSupabase()` CÒN RỖNG — phải ~1 nhịp 20ms nữa
// mới có phiên đầy đủ.
//
// HAI BẢN VÁ SAI TRƯỚC KHI ĐÚNG, ghi lại để không ai lặp:
//   1. "chép nguyên hai dòng bootstrap của legacy" — hỏng ngay.
//   2. "hoãn tới `DOMContentLoaded`" — VẪN hỏng, vì DCL xảy ra TRƯỚC khi khung
//      init xong. Chỉ chờ đúng điều kiện `getSupabase()` mới ăn.
//
// Không cổng nào khác bắt được: build xanh, tsc xanh, test xanh, và parity thì
// so DOM TĨNH nên không thấy trang đã nhảy đi đâu.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend', 'app');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = walk(APP).map((f) => ({ rel: path.relative(ROOT, f), src: readFileSync(f, 'utf8') }));
// Trang gọi `mount(` trong một script nội tuyến — đó là dấu hiệu của khuôn này.
const mountPages = files.filter((f) => /mount\(document\.getElementById/.test(f.src));

describe('khuôn mount() — phải chờ Supabase', () => {
  // GHIM ĐÚNG DANH SÁCH, không dùng `>= 1`: với `>= 1`, một trang đổi cách viết
  // và rơi khỏi bộ dò thì chốt vẫn xanh trong khi trang đó hết được canh
  // (review cục bộ #958 chỉ ra). Thêm route mới thì phải sửa danh sách này —
  // đó là chủ đích, không phải phiền toái.
  const EXPECTED = [
    'frontend/app/(authed-exercises)/exercises/page.tsx',
    'frontend/app/(authed-flashcards)/flashcards/page.tsx',
  ];

  test('bộ dò tìm ĐÚNG các trang dùng khuôn mount()', () => {
    assert.deepEqual(mountPages.map((f) => f.rel).sort(), [...EXPECTED].sort(),
      'danh sách trang dùng khuôn mount() đã đổi — cập nhật EXPECTED hoặc xem lại');
  });

  for (const { rel, src } of mountPages) {
    test(`${rel} — chờ getSupabase() trước khi mount`, () => {
      // CHỈ soi phần thân script sẽ chạy trong trình duyệt, KHÔNG soi cả tệp:
      // chú thích ở đầu tệp có nhắc `getSupabase()` để giải thích, nên khớp trên
      // cả tệp là chốt tự lừa mình — bản đầu của chốt này XANH cả khi mã dùng
      // đúng bản vá sai (phép phá không nổ, và đó là cách tôi phát hiện).
      const m = /const MOUNT = `([\s\S]*?)`\.trim\(\);/.exec(src);
      assert.ok(m, 'không tìm thấy khối `const MOUNT` — khuôn đã đổi?');
      const body = m[1];

      assert.match(body, /getSupabase/,
        'phải kiểm `window.getSupabase()` trước khi gọi mount — nếu không, module '
        + 'thấy token rỗng và ĐÁ VỀ `/index.html` (Next 307 sang `/`)');

      // `DOMContentLoaded` KHÔNG phải điều kiện đúng: đã đo, DCL xảy ra trước
      // khi khung init xong. Nếu tệp chỉ dựa vào DCL mà không kiểm getSupabase
      // thì nó đang lặp lại đúng bản vá sai số 2.
      const onlyDcl = /DOMContentLoaded/.test(body) && !/getSupabase/.test(body);
      assert.ok(!onlyDcl, 'chỉ chờ DOMContentLoaded là KHÔNG đủ (bản vá sai số 2)');

      // `mount(` phải nằm TRONG nhánh sẵn-sàng, không được gọi ở cấp cao nhất.
      // Chỉ khớp chữ `getSupabase` là chưa đủ: một tệp có thể vừa nhắc nó vừa
      // gọi `mount()` thẳng — đúng phê bình của review cục bộ #958. Ở đây bắt
      // buộc lời gọi thật đi qua `go()`.
      const topLevelMount = body
        .split('\n')
        .some((ln) => /^\s*mount\(/.test(ln));
      assert.ok(!topLevelMount,
        '`mount(` gọi thẳng ở cấp cao nhất — phải đi qua nhánh chờ sẵn sàng');

      // Hết giờ phải HIỆN LỖI cho người dùng, không chỉ ghi console: trang treo
      // ở spinner mà im lặng là ca tệ nhất.
      if (/setInterval/.test(body)) {
        assert.match(body, /getElementById\('mount'\)[\s\S]*innerHTML/,
          'hết giờ phải hiện thông báo lỗi trong #mount');
      }

      // Vòng chờ phải có ĐƯỜNG THOÁT: chờ vô hạn thì trang treo im lặng ở
      // spinner và không ai biết vì sao.
      if (/setInterval/.test(body)) {
        assert.match(body, /clearInterval/, 'vòng chờ phải dừng được');
        assert.match(body, /console\.error/,
          'hết giờ phải BÁO ra console, đừng treo im lặng');
      }
    });
  }
});
