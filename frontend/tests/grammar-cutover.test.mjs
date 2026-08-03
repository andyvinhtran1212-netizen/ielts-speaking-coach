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

/**
 * Backend CŨNG sinh điều hướng cho người dùng.
 * `student_home_aggregator._build_grammar()` trả `primary_cta_url`, và
 * `public/js/home.js:277-287` điều hướng bằng ĐÚNG giá trị đó khi học viên đã
 * đăng nhập bấm thẻ Grammar ở trang chủ. Chỉ quét frontend là bỏ lọt một luồng
 * chính (phát hiện review #916).
 */
const BACKEND_ROOT = path.join(FRONTEND, '..', 'backend');

/** Hai chỗ ĐƯỢC PHÉP, mỗi chỗ một lý do cụ thể. */
const ALLOWED = new Map([
  ['public/grammar.html',
   'chính bản legacy — đây là link nội bộ trong trang đó, không phải điều hướng canonical của site'],
  ['public/js/grammar.js',
   'ruột của bản legacy: JS dựng nội dung cho chính trang grammar.html, không dẫn người dùng đi đâu khác'],
]);

const SKIP_DIRS = new Set([
  'node_modules', '.next', 'out', 'test-results', 'playwright-report',
  'venv', '__pycache__', '.pytest_cache', 'content', 'data', 'migrations',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(html|js|mjs|cjs|tsx|ts|py)$/.test(name)) yield full;
  }
}

// Chỉ bắt dạng LINK có dấu nháy. Chú thích trong mã dùng dấu huyền (`grammar.html`)
// nên không dính — cố ý, vì cấm nhắc tên tệp trong chú thích là vô nghĩa.
// Dấu phân cách gồm cả BACKTICK, và cho phép đuôi `?query`/`#hash`.
// Bản đầu đòi dấu nháy NGAY SAU `grammar.html`, nên nó bỏ lọt đúng hai chỗ:
//   · `` `/grammar.html?category=${…}` `` — breadcrumb thư mục trong page-shell
//   · chuỗi Python `"/grammar.html"` ở backend
// Một bộ chốt hẹp hơn thực tế thì tệ hơn không có, vì nó tạo cảm giác đã phủ.
const LINK_SRC = '["\'`](?:\\.\\./|/)?grammar\\.html(?:[?#][^"\'`]*)?["\'`]';
const LINK_RE = new RegExp(LINK_SRC, 'g');
// Bản KHÔNG `g` cho `.test()`: regex có cờ `g` giữ `lastIndex` giữa các lần
// gọi, nên `.test()` lần sau có thể trả false một cách ngẫu nhiên.
const LINK_ONE = new RegExp(LINK_SRC);

/**
 * Bỏ CHÚ THÍCH trước khi đếm.
 *
 * Mở dấu phân cách sang backtick khiến chú thích dạng ``legacy `grammar.html``` 
 * bị tính là link — 3 báo động giả ngay trong `grammar/page.tsx`. Cấm nhắc tên
 * tệp trong chú thích là vô lý; thứ phải cấm là LINK. Đây cũng đúng bài học đã
 * ghi trong sổ tay dự án: bỏ comment trước khi đếm hit.
 */
function stripComments(text, file) {
  let out = text;
  if (/\.(py)$/.test(file)) return out.replace(/^\s*#.*$/gm, '');
  if (/\.(html)$/.test(file)) out = out.replace(/<!--[\s\S]*?-->/g, '');
  return out
    .replace(/\/\*[\s\S]*?\*\//g, '')   // khối /* … */
    .replace(/(^|[^:])\/\/.*$/gm, '$1');  // dòng // … (chừa lại https://)
}

describe('cutover /grammar — điều hướng canonical', () => {
  test('không tệp nào ngoài danh sách được phép còn LINK tới grammar.html', () => {
    const offenders = [];
    for (const file of ROOTS.flatMap((r) => [...walk(path.join(FRONTEND, r))])) {
      const rel = path.relative(FRONTEND, file);
      if ([...ALLOWED.keys()].some((a) => rel === a)) continue;
      const hits = (stripComments(readFileSync(file, 'utf8'), file).match(LINK_RE) || []).length;
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
    assert.ok(!LINK_ONE.test(stripComments(chrome, 'aver-chrome.js')),
      'chrome không được trỏ bản legacy');
    assert.match(chrome, /["']\/grammar["']/);
  });

  test('KHÔNG redirect /grammar.html — giữ cho G1 còn so được', () => {
    // Chốt chặn cho một "cải tiến" nghe rất hợp lý mà lại phá cổng: thêm
    // redirect 301 sẽ khiến hai vế cùng dừng ở /grammar, chốt `same-final-url`
    // từ chối, và khu Grammar mất luôn lớp parity trước khi Phase 7 quyết định.
    //
    // ĐỌC ĐÚNG NGUỒN: `vercel.json` chỉ khai framework + region; redirect và
    // rewrite THẬT nằm ở `next.config.ts`. Bản đầu của test này đọc vercel.json
    // nên ai thêm luật vào next.config.ts vẫn qua cửa — chốt kiểm sai tệp thì
    // không phải chốt (review #916).
    const nextCfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
    assert.ok(/async (redirects|rewrites)\(\)/.test(nextCfg),
      'next.config.ts phải là nơi khai redirect/rewrite — nếu đổi chỗ, sửa test này');
    assert.ok(!/source:\s*['"`]\/grammar\.html['"`]/.test(nextCfg),
      'redirect/rewrite /grammar.html trong next.config.ts sẽ gỡ mất cổng parity');

    const vercel = JSON.parse(readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));
    const rules = [...(vercel.redirects || []), ...(vercel.rewrites || [])];
    assert.deepEqual(rules.filter((r) => String(r.source || '') === '/grammar.html'), [],
      'kể cả nếu sau này luật chuyển sang vercel.json');
  });

  test('backend KHÔNG sinh link tới bản legacy', () => {
    // `_build_grammar()` trả `primary_cta_url`, `home.js` điều hướng bằng đúng
    // giá trị đó. Quét cả `backend/**.py` vì đây là điều hướng người dùng thấy,
    // chỉ nằm ở phía khác của hợp đồng.
    const offenders = [];
    for (const file of walk(BACKEND_ROOT)) {
      if (!file.endsWith('.py')) continue;
      const hits = (stripComments(readFileSync(file, 'utf8'), file).match(LINK_RE) || []).length;
      if (hits) offenders.push(`${path.relative(BACKEND_ROOT, file)} (${hits})`);
    }
    assert.deepEqual(offenders, [],
      'backend trả link legacy = một luồng điều hướng chính vẫn mở trang cũ:\n  '
      + offenders.join('\n  '));
  });
});
