/**
 * grammar-cutover.test.mjs — `/grammar` là route canonical (cutover 2026-08-03).
 *
 * Cutover ở dự án này KHÔNG phải "gỡ bản cũ": nó là đổi canonical + đổi mọi
 * điều hướng nội bộ, còn bản legacy vẫn được phục vụ. Pilot 2 làm đúng vậy với
 * `/pages/grammar-article.html` (vẫn 200 tới hôm nay).
 *
 * Lý do giữ legacy không chỉ là tương thích bookmark: chừng nào CẢ HAI bản còn
 * sống thì cổng parity G1 còn so được. Redirect `/grammar.html` là gỡ luôn lớp
 * bảo vệ đó — việc gỡ thuộc Phase 7, làm sau và có chủ đích.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chỉ quét nơi SINH RA ĐIỀU HƯỚNG cho người dùng: `app/` và `public/`.
 *
 * KHÔNG quét cả `frontend/`: tệp test nhắc tới trang legacy là chính đáng (nó
 * vẫn tồn tại), và `frontend/grammar.html` + `frontend/js` là SYMLINK sang
 * `public/` nên quét cả cây sẽ đếm mỗi tệp hai lần rồi báo vi phạm ma.
 */
const ROOTS = ['app', 'public'];

/** Hai chỗ ĐƯỢC PHÉP, mỗi chỗ một lý do cụ thể. */
const ALLOWED = new Map([
  ['public/grammar.html',
   'chính bản legacy — đây là link nội bộ trong trang đó, không phải điều hướng canonical của site'],
  ['public/js/grammar.js',
   'ruột của bản legacy: JS dựng nội dung cho chính trang grammar.html, không dẫn người dùng đi đâu khác'],
]);

const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'test-results', 'playwright-report']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(html|js|mjs|cjs|tsx|ts)$/.test(name)) yield full;
  }
}

// Chỉ bắt dạng LINK có dấu nháy. Chú thích trong mã dùng dấu huyền (`grammar.html`)
// nên không dính — cố ý, vì cấm nhắc tên tệp trong chú thích là vô nghĩa.
const LINK_RE = /["'](?:\.\.\/|\/)?grammar\.html["']/g;
// Bản KHÔNG `g` cho `.test()`: regex có cờ `g` giữ `lastIndex` giữa các lần
// gọi, nên `.test()` lần sau có thể trả false một cách ngẫu nhiên.
const LINK_ONE = /["'](?:\.\.\/|\/)?grammar\.html["']/;

describe('cutover /grammar — điều hướng canonical', () => {
  test('không tệp nào ngoài danh sách được phép còn LINK tới grammar.html', () => {
    const offenders = [];
    for (const file of ROOTS.flatMap((r) => [...walk(path.join(FRONTEND, r))])) {
      const rel = path.relative(FRONTEND, file);
      if ([...ALLOWED.keys()].some((a) => rel === a)) continue;
      const hits = (readFileSync(file, 'utf8').match(LINK_RE) || []).length;
      if (hits) offenders.push(`${rel} (${hits})`);
    }
    assert.deepEqual(offenders, [],
      'link tới bản legacy = người dùng bị đẩy khỏi route canonical:\n  '
      + offenders.join('\n  '));
  });

  test('mỗi ngoại lệ đều có lý do ghi kèm', () => {
    for (const [file, reason] of ALLOWED) {
      assert.ok(reason && reason.length > 20, `ngoại lệ ${file} phải nêu lý do cụ thể`);
    }
  });

  test('chrome dùng chung trỏ route canonical', () => {
    // Đây là link điều hướng chính; sai chỗ này là toàn site đi lạc.
    const chrome = readFileSync(path.join(FRONTEND, 'public/js/components/aver-chrome.js'), 'utf8');
    assert.ok(!LINK_ONE.test(chrome), 'chrome không được trỏ bản legacy');
    assert.match(chrome, /["']\/grammar["']/);
  });

  test('KHÔNG redirect /grammar.html — giữ cho G1 còn so được', () => {
    // Chốt chặn cho một "cải tiến" nghe rất hợp lý mà lại phá cổng: thêm
    // redirect 301 sẽ khiến hai vế cùng dừng ở /grammar, chốt `same-final-url`
    // từ chối, và khu Grammar mất luôn lớp parity trước khi Phase 7 quyết định.
    const vercel = JSON.parse(readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));
    const rules = [...(vercel.redirects || []), ...(vercel.rewrites || [])];
    const bad = rules.filter((r) => String(r.source || '') === '/grammar.html');
    assert.deepEqual(bad, [],
      'redirect /grammar.html sẽ gỡ mất cổng parity của khu Grammar');
  });
});
