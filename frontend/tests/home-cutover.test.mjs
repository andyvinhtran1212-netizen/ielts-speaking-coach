/**
 * home-cutover.test.mjs — `/home` là route canonical (cutover 2026-08-05).
 *
 * Cutover ở dự án này KHÔNG phải "gỡ bản cũ": nó là đổi canonical + đổi mọi
 * điều hướng nội bộ, còn bản legacy vẫn được phục vụ. Pilot 2 làm đúng vậy với
 * `/pages/grammar-article.html` (vẫn 200 tới hôm nay), và `/grammar.html` cũng
 * thế sau cutover 2026-08-03.
 *
 * Lý do giữ legacy không chỉ là tương thích bookmark: chừng nào CẢ HAI bản còn
 * sống thì cổng parity G1 còn so được — và với `/home` thì lớp đó vừa mới dựng
 * xong (authed-G1, PR #930) nên vứt đi ngay là phí nhất. Việc gỡ thuộc Phase 7.
 *
 * Cấu trúc chép từ `grammar-cutover.test.mjs` để hai cutover soi chung một
 * khuôn; các bài học ghi trong tệp đó (bỏ chú thích trước khi đếm, đọc
 * `next.config.ts` chứ không phải `vercel.json`, regex `g` giữ `lastIndex`)
 * áp dụng y nguyên ở đây.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chỉ quét nơi SINH RA ĐIỀU HƯỚNG cho người dùng: `app/` và `public/`.
 * Không quét cả `frontend/` vì `frontend/js` và `frontend/pages` là SYMLINK
 * sang `public/` — quét cả cây sẽ đếm mỗi tệp hai lần rồi báo vi phạm ma.
 */
const ROOTS = ['app', 'public'];

/** Backend cũng sinh điều hướng (bài học review #916 ở cutover grammar). */
const BACKEND_ROOT = path.join(FRONTEND, '..', 'backend');

/**
 * Ngoại lệ — mỗi chỗ một lý do cụ thể.
 *
 * Hiện KHÔNG có ngoại lệ nào: `public/pages/home.html` không hề tự trỏ vào
 * chính nó (đếm được 0 lần nhắc), khác với `grammar.html`. Giữ cấu trúc Map để
 * ai cần thêm ngoại lệ thì buộc phải viết kèm lý do.
 */
const ALLOWED = new Map();

const SKIP_DIRS = new Set([
  'node_modules', '.next', 'out', 'test-results', 'playwright-report',
  'venv', '__pycache__', '.pytest_cache', 'content', 'data', 'migrations',
  // Fixture của test backend chứa `"url": "/pages/home.html"` — đó là DỮ LIỆU
  // của một bản ghi log, không phải điều hướng. Chốt chặn phải phân biệt được
  // hai thứ đó, nếu không nó buộc người ta sửa dữ liệu test cho hợp với luật
  // điều hướng — vô nghĩa.
  'tests',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(html|js|mjs|cjs|tsx|ts|py)$/.test(name)) yield full;
  }
}

// Chỉ bắt dạng LINK có dấu nháy (gồm backtick), cho phép đuôi `?query`/`#hash`,
// và cho phép cả đường dẫn tương đối (`pages/home.html`, `../home.html`) —
// đúng ba dạng đã gặp thật khi sweep: `/pages/home.html`, `pages/home.html`
// (admin.html, onboarding.html) và `home.html` (flashcard-study.js).
const LINK_SRC = '["\'`](?:\\.\\./|/)?(?:pages/)?home\\.html(?:[?#][^"\'`]*)?["\'`]';
const LINK_RE = new RegExp(LINK_SRC, 'g');
// Bản KHÔNG cờ `g` cho `.test()`: regex có `g` giữ `lastIndex` giữa các lần gọi
// nên `.test()` lần sau có thể trả false một cách ngẫu nhiên.
const LINK_ONE = new RegExp(LINK_SRC);

/** Bỏ CHÚ THÍCH trước khi đếm — cấm nhắc tên tệp trong chú thích là vô lý. */
function stripComments(text, file) {
  let out = text;
  if (/\.py$/.test(file)) return out.replace(/^\s*#.*$/gm, '');
  if (/\.html$/.test(file)) out = out.replace(/<!--[\s\S]*?-->/g, '');
  return out
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('cutover /home — điều hướng canonical', () => {
  test('không tệp nào ngoài danh sách được phép còn LINK tới home.html', () => {
    const offenders = [];
    for (const file of ROOTS.flatMap((r) => [...walk(path.join(FRONTEND, r))])) {
      const rel = path.relative(FRONTEND, file);
      if (ALLOWED.has(rel)) continue;
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
    // Link điều hướng chính của toàn site — sai chỗ này là cả site đi lạc.
    // `aver-chrome.js` có BA chỗ: logo thương hiệu, tab "Trang chủ", và luật
    // prefetch `href_matches` (speculation rules). Luật prefetch phải khớp
    // đường người dùng THẬT SỰ bấm, nếu không nó lặng lẽ mất tác dụng.
    const chrome = readFileSync(
      path.join(FRONTEND, 'public/js/components/aver-chrome.js'), 'utf8');
    const body = stripComments(chrome, 'aver-chrome.js');
    assert.ok(!LINK_ONE.test(body), 'chrome không được trỏ bản legacy');
    assert.ok((body.match(/["']\/home["']/g) || []).length >= 3,
      'cần đủ 3 chỗ: logo, tab Trang chủ, và luật prefetch href_matches');
  });

  test('KHÔNG rewrite /home và KHÔNG redirect /pages/home.html', () => {
    // Hai chốt khác nhau, đừng gộp:
    //  · rewrite `/home` → bản legacy: nếu còn thì route Next bị CHE và cutover
    //    chỉ là hình thức. Cổng route-ownership cũng chặn, nhưng nó chỉ chạy khi
    //    build — chốt ở đây đọc được ngay.
    //  · redirect `/pages/home.html` → `/home`: nghe rất hợp lý mà lại phá cổng.
    //    Hai vế sẽ cùng dừng ở `/home`, chốt `same-final-url` từ chối, và trang
    //    chủ mất luôn lớp parity vừa dựng xong (authed-G1, PR #930).
    //
    // ĐỌC ĐÚNG NGUỒN: `vercel.json` chỉ khai framework + region; redirect và
    // rewrite THẬT nằm ở `next.config.ts` (bài học review #916).
    const nextCfg = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');
    assert.ok(/async (redirects|rewrites)\(\)/.test(nextCfg),
      'next.config.ts phải là nơi khai redirect/rewrite — nếu đổi chỗ, sửa test này');
    assert.ok(!/source:\s*['"`]\/home['"`]/.test(nextCfg),
      'rewrite /home còn sót = route Next bị che, cutover chỉ là hình thức');
    assert.ok(!/source:\s*['"`]\/pages\/home\.html['"`]/.test(nextCfg),
      'redirect /pages/home.html sẽ gỡ mất lớp parity authed vừa dựng');

    const vercel = JSON.parse(readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8'));
    const rules = [...(vercel.redirects || []), ...(vercel.rewrites || [])];
    assert.deepEqual(
      rules.filter((r) => ['/home', '/pages/home.html'].includes(String(r.source || ''))), [],
      'kể cả nếu sau này luật chuyển sang vercel.json');
  });

  test('route Next tồn tại đúng chỗ', () => {
    // Đổi tên thư mục route mà quên sửa cặp parity thì cổng authed so nhầm một
    // URL 404 và vẫn có thể báo "xanh" theo kiểu vô nghĩa.
    const pairs = JSON.parse(readFileSync(
      path.join(FRONTEND, 'tooling/parity-pairs-authed.json'), 'utf8'));
    const home = pairs.find((p) => p.name === 'home');
    assert.ok(home, 'cặp parity "home" phải còn');
    assert.equal(home.next, '/home');
    assert.equal(home.legacy, '/pages/home.html');
    assert.deepEqual(home.allow || [], [],
      'behavior đã port xong — không còn lý do miễn trừ mục nào');

    assert.ok(statSync(path.join(FRONTEND, 'app/(authed-home)/home/page.tsx')).isFile());
  });

  test('backend KHÔNG sinh link tới bản legacy', () => {
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
