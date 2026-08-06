// Route nào chạy bằng MODULE LEGACY thì chỉ được điều hướng tới bằng tải-lại-trang.
//
// VÌ SAO: nhóm trang chỉ-đọc cố ý KHÔNG port hành vi — `page.tsx` chỉ nhả một
// thẻ `<script type="module" src="/js/…">` và trang legacy nạp đúng tệp đó.
// Cách này an toàn khi TẢI CỨNG: script kiểu module bị hoãn tới sau khi parse
// nhưng TRƯỚC `DOMContentLoaded`, nên bộ nghe của module vẫn bắt được sự kiện.
//
// Nó HỎNG khi điều hướng mềm của App Router: React dựng lại thẻ `<script>` thì
// trình duyệt KHÔNG chạy nó, và kể cả chạy thì `DOMContentLoaded` đã qua từ lâu
// — cả 5 module hiện chỉ nghe đúng sự kiện đó, không cái nào kiểm `readyState`.
// Kết quả là trang đứng ở "Đang tải…" vĩnh viễn.
//
// Hôm nay chưa hỏng vì mọi liên kết tới các route này là thẻ `<a>` thường, mà
// App Router KHÔNG chặn thẻ `<a>`. Nghĩa là đây là bẫy NGỦ: nó thức dậy đúng
// lúc ai đó đổi một liên kết sang `<Link>` hoặc `router.push` — một thay đổi
// trông vô hại, sẽ qua mọi test hiện có, và không cổng nào bắt.
//
// (Codex bắt trong lượt review CỤC BỘ ở PR #953 — lượt đầu tiên tôi chạy được
// sau khi phát hiện `codex exec` treo vì chờ stdin chứ không phải vì chậm.)
//
// Chốt này KHÔNG sửa module. Sửa chúng là làm bản Next lệch khỏi bản legacy,
// đúng thứ mà cách "dùng chung một tệp" sinh ra để tránh. Nó chỉ giữ cho tiền
// đề "luôn tải cứng" khỏi bị phá trong im lặng.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend', 'app');

/** Route dựa vào module legacy — thêm vào đây mỗi khi port thêm một trang. */
const LEGACY_MODULE_ROUTES = [
  '/reading/vocab',
  '/reading/skill',
  '/reading/test',
  '/reading/mini-test',
  '/listening/tests',
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = walk(APP).map((f) => ({ rel: path.relative(ROOT, f), src: readFileSync(f, 'utf8') }));

describe('route chạy bằng module legacy — chỉ điều hướng bằng tải cứng', () => {
  test('quét được cây app/', () => {
    // Cây rỗng ⇒ mọi khẳng định dưới thành xanh-rỗng.
    assert.ok(files.length > 5, `chỉ thấy ${files.length} tệp trong app/`);
  });

  test('mỗi route trong danh sách thực sự tồn tại', () => {
    // Danh sách mục ruỗng dần sẽ làm chốt yếu đi mà không ai hay.
    for (const r of LEGACY_MODULE_ROUTES) {
      const hit = files.some((f) => f.rel.includes(path.join(...r.split('/').filter(Boolean))));
      assert.ok(hit, `${r} không còn route tương ứng — cập nhật danh sách`);
    }
  });

  test('không route nào được trỏ tới bằng <Link> hay router.push', () => {
    const bad = [];
    for (const { rel, src } of files) {
      // Bỏ dòng thuần chú thích: chính tệp này và các page.tsx đều NHẮC tên
      // route trong phần giải thích, mà nhắc thì không phải điều hướng.
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const route of LEGACY_MODULE_ROUTES) {
        const q = route.replace(/[/]/g, '\\/');
        if (new RegExp(`<Link[^>]*href=["'\`]${q}`).test(code)) bad.push(`${rel}: <Link href="${route}">`);
        if (new RegExp(`router\\.(push|replace)\\(["'\`]${q}`).test(code)) bad.push(`${rel}: router.push('${route}')`);
      }
    }
    assert.deepEqual(bad.sort(), [],
      'các route này chạy bằng module legacy chỉ nghe `DOMContentLoaded`. Điều hướng '
      + 'mềm không chạy lại script ⇒ trang đứng ở "Đang tải…". Dùng thẻ <a> thường '
      + '(App Router không chặn nó) hoặc port hành vi sang tầng behavior trước.');
  });
});
