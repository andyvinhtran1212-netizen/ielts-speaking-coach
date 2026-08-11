// Mỗi route Next PHẢI có một hàng trong `docs/ROUTE_LEDGER.md` ghi đúng tệp sở hữu.
//
// VÌ SAO CÓ CHỐT NÀY: sổ route đã trôi qua BỐN PR liên tiếp (#953, #955, #956,
// #958) — 10 hàng vẫn ghi tệp legacy là chủ sở hữu và 2 route mới không có hàng
// nào. Mỗi lần đều do người review bắt, và tôi chỉ vá đúng hàng được nêu.
//
// Sổ sai không làm hỏng trang, nên không cổng nào đỏ. Nhưng nó là thứ mà một
// lượt rà quyền hay một lượt rollback sẽ ĐỌC — và nó sẽ chỉ họ vào bản legacy
// vốn chỉ còn là mốc dự phòng. Đó là kiểu sai âm thầm mà chỉ máy mới giữ được.
//
// PHẠM VI CÓ Ý THỨC: chốt chỉ đòi (1) có hàng cho route, (2) hàng đó nêu ĐÚNG
// đường dẫn `page.tsx`. Nó KHÔNG kiểm các cột còn lại (quyền, dữ liệu, kích
// thước) — những cột đó là phán đoán của người, không suy ra được từ mã.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'frontend', 'app');
// Đường dẫn viết thành MỘT literal, không ghép `path.join(ROOT, 'docs', …)`:
// `workflow-path-coverage.test.mjs` coi mảnh `'docs'` trong `path.join` là phụ
// thuộc THƯ MỤC và sẽ đòi glob `docs/**` — tức mọi thay đổi tài liệu đều kéo
// theo cả bộ test backend. Literal đầy đủ thì nó chỉ đòi đúng một tệp.
const LEDGER = readFileSync(path.join(ROOT, 'docs/ROUTE_LEDGER.md'), 'utf8');

// Route KHÔNG phải trang thật của học viên — không cần có mặt trong sổ.
const EXEMPT = new Set(['/next-probe', '/recorder-spike']);

/** Đường dẫn `page.tsx` → URL route, bỏ các đoạn route-group `(...)`. */
function routeOf(rel) {
  const segs = rel
    .replace(/^frontend\/app\//, '')
    .replace(/\/page\.tsx$/, '')
    .split('/')
    .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segs.join('/');
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === 'page.tsx') out.push(path.relative(ROOT, full));
  }
  return out;
}

const pages = walk(APP)
  .map((rel) => ({ rel, route: routeOf(rel) }))
  // Route động (`[slug]`) ghi trong sổ dưới dạng khác; để ngoài phạm vi.
  .filter((p) => !p.route.includes('[') && !EXEMPT.has(p.route));

describe('sổ route khớp cây app/', () => {
  test('quét được một lượng route đáng kể', () => {
    // Bộ dò hỏng ⇒ danh sách rỗng ⇒ mọi khẳng định dưới thành xanh-rỗng.
    assert.ok(pages.length >= 10, `chỉ thấy ${pages.length} route — bộ dò hỏng?`);
  });

  test('mỗi route Next có hàng trong sổ, ghi ĐÚNG tệp sở hữu', () => {
    const missing = [];
    const wrongOwner = [];
    for (const { rel, route } of pages) {
      // `/` được ghi trong sổ dưới dạng khác (khu marketing); bỏ qua.
      if (route === '/') continue;
      const row = LEDGER.split('\n').find((l) => l.startsWith(`| \`${route}\` |`));
      if (!row) { missing.push(route); continue; }
      // Đường dẫn trong sổ bỏ tiền tố `frontend/`.
      const owner = rel.replace(/^frontend\//, '');
      if (!row.includes(owner)) wrongOwner.push(`${route} → sổ chưa nêu \`${owner}\``);
    }
    assert.deepEqual([...missing, ...wrongOwner].sort(), [],
      'sổ route lệch khỏi cây app/. Một lượt rà quyền hoặc rollback đọc sổ này sẽ '
      + 'bị chỉ vào bản legacy vốn chỉ còn là mốc dự phòng.');
  });
});
