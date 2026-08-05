// Không tệp nguồn nào được NHÚNG byte NUL.
//
// Vì sao quan trọng: git thấy NUL thì xếp cả tệp vào loại NHỊ PHÂN. `git diff`
// in `Bin 10358 -> 11829 bytes` thay vì các dòng đã đổi, và mọi review sau này
// với tệp đó trở thành mù. Một byte vô hình vô hiệu hoá toàn bộ việc xem xét mã.
//
// Nó vô hình thật: NUL hiện ra thành dấu cách trong hầu hết trình xem, nên tôi
// gõ nhầm nó vào `workflow-path-coverage.test.mjs` mà đọc lại vài lần vẫn không
// thấy — Codex bắt ở PR #946.
//
// Đã CÓ SẴN một chốt cho đúng chuyện này trong
// `sentence-split-no-lookbehind.test.mjs`, nhưng nó canh một DANH SÁCH HAI TỆP
// viết tay, nên bỏ lọt `public/js/vocabulary.js` đang vi phạm thật — và chính
// tệp chốt đó cũng nhúng một NUL trong câu khẳng định của nó. Đó đúng là họ lỗi
// mà PR này sinh ra để diệt: chốt tồn tại nhưng không phủ hết thứ nó canh. Nên
// bản này quét THEO CÂY THƯ MỤC, không theo danh sách.
//
// Cách viết đúng khi thật sự cần ký tự NUL: dùng escape `'\u0000'`. Chuỗi lúc
// chạy y hệt, nhưng tệp nguồn vẫn là văn bản thuần.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCAN_DIRS = ['frontend', 'backend', 'scripts', '.github'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'venv', '__pycache__', '.git', 'dist', 'build']);
const EXT = /\.(mjs|cjs|js|jsx|ts|tsx|py|sh|yml|yaml|json|css|html|md)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;                       // thư mục không có ở nhánh này — bỏ qua
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (EXT.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

describe('mã nguồn — không nhúng byte NUL', () => {
  test('bộ quét thực sự đọc được một lượng tệp đáng kể', () => {
    // Nếu `walk` hỏng hoặc SCAN_DIRS trỏ sai, danh sách rỗng và khẳng định dưới
    // thành xanh-rỗng — đúng cái bẫy mà cả PR này đang chống.
    assert.ok(files.length > 500, `chỉ quét được ${files.length} tệp — bộ quét hỏng?`);
  });

  test('không tệp nào chứa byte NUL', () => {
    const bad = [];
    for (const f of files) {
      if (statSync(f).size > 4 * 1024 * 1024) continue;      // ảnh/gói lỡ lọt đuôi
      const buf = readFileSync(f);
      const i = buf.indexOf(0);
      if (i !== -1) bad.push(`${path.relative(ROOT, f)} (byte ${i})`);
    }
    assert.deepEqual(bad.sort(), [],
      'byte NUL biến tệp thành nhị phân trong mắt git ⇒ mất diff, mất review. '
      + "Cần ký tự NUL thì viết '\\u0000'.");
  });
});
