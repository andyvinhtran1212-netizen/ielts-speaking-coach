// `components/authed-shell.tsx` là khung `<head>` DUY NHẤT cho mọi route-group
// cần đăng nhập. Test này giữ hai thứ:
//   1. Không ai chép lại khung đó vào một layout mới (nợ vừa trả xong).
//   2. Những bất biến đắt giá bên trong khung — thứ tự cascade, reporter trước
//      api.js — không bị xê dịch.
//
// BỐI CẢNH: `(authed)` và `(authed-home)` từng là hai bản chép gần trùng nhau,
// khác đúng danh sách stylesheet. Mỗi bài học về thứ tự script phải vá hai chỗ,
// và quên một chỗ thì trang đó âm thầm khác trang kia. Đến trang thứ ba
// (`/speaking`) thì chép lần nữa là hỏng hẳn.
//
// Bản refactor được kiểm bằng cách so HTML THẬT của `/profile` và `/home`
// trước/sau: 36 và 39 thẻ `link`/`script` trùng hoàn toàn, đúng thứ tự. (Payload
// RSC có lệch — thẻ sinh từ `.map()` nay mang `key` — nhưng đó là metadata của
// cây React, không phải thứ trình duyệt dựng.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * PHẢI bỏ chú thích trước khi quét. Chính tệp khung giải thích các bẫy này
 * bằng tên tệp (`ds.css`, `profile.css`, `home-mock-tiles.js`), nên quét thô sẽ
 * tính lời giải thích là vi phạm. Đây là bẫy đã dính bốn lần trong dự án —
 * lần này viết thẳng vào chỗ quét.
 */
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // {/* … */} trong JSX
    .replace(/\/\*[\s\S]*?\*\//g, '')        // /* … */
    .replace(/(^|[^:])\/\/.*$/gm, '$1');       // // … (chừa https://)
}

const SHELL = stripComments(
  readFileSync(path.join(FRONTEND, 'components/authed-shell.tsx'), 'utf8'));
const RUNTIME_BOUNDARY = stripComments(
  readFileSync(path.join(FRONTEND, 'components/supabase-runtime-boundary.tsx'), 'utf8'));

/** Mọi layout của route-group cần đăng nhập. */
function authedLayouts() {
  const appDir = path.join(FRONTEND, 'app');
  return readdirSync(appDir)
    .filter((d) => /^\(authed/.test(d))
    .filter((d) => statSync(path.join(appDir, d)).isDirectory())
    .map((d) => ({ group: d, file: path.join(appDir, d, 'layout.tsx') }))
    .filter((x) => {
      try { return statSync(x.file).isFile(); } catch { return false; }
    });
}

describe('AuthedShell — khung dùng chung cho route cần đăng nhập', () => {
  test('đánh dấu route auth-gated để chrome chọn đích Vocabulary ổn định', () => {
    assert.match(SHELL, /authGated = true/);
    assert.match(SHELL, /authGated && <meta name="aver-auth-gated" content="1" \/>/);
  });

  test('có ít nhất hai route-group và MỌI layout đều đi qua AuthedShell', () => {
    const layouts = authedLayouts();
    assert.ok(layouts.length >= 2, 'phải có ≥2 route-group authed, nếu không test này vô nghĩa');
    for (const { group, file } of layouts) {
      const src = stripComments(readFileSync(file, 'utf8'));
      assert.match(src, /<AuthedShell\b/, `${group}: layout phải dựng qua <AuthedShell>`);
      // Dấu hiệu chép lại khung: layout tự khai font/CDN/telemetry.
      for (const marker of [
        'fonts.googleapis.com', 'unpkg.com/lucide', 'supabase-js',
        '/js/api.js', '/js/error-reporter.js', '/js/rum-vitals.js',
        'aver-chrome.js', 'av-page font-sans min-h-screen',
      ]) {
        assert.ok(!src.includes(marker),
          `${group}: «${marker}» phải nằm trong AuthedShell, không chép vào layout`);
      }
    }
  });

  test('thứ tự cascade: tokens → components → ds → CSS trang → tailwind CUỐI', () => {
    // Tailwind phải đứng SAU cùng để utilities/.hidden thắng (P0-3 C-3.4).
    // Đây là loại lỗi im lặng: sai thứ tự thì trang vẫn dựng, chỉ là một số
    // utility không có tác dụng.
    const order = ['tokens.css', 'components.css', 'ds.css', 'pageStylesheets.map', 'tailwind.build.css'];
    let at = -1;
    for (const needle of order) {
      const i = SHELL.indexOf(needle);
      assert.ok(i > at, `«${needle}» phải đứng sau «${order[order.indexOf(needle) - 1]}»`);
      at = i;
    }
  });

  test('error-reporter nạp TRƯỚC api.js (DEBT-2026-07-31-O)', () => {
    // Script `defer` chạy theo THỨ TỰ TÀI LIỆU. Đặt reporter sau api.js nghĩa là
    // một lỗi trong api.js xảy ra khi listener chưa gắn — đúng khoảng mù mà
    // review #887 đã đóng.
    assert.ok(RUNTIME_BOUNDARY.indexOf('/js/error-reporter.js')
      < RUNTIME_BOUNDARY.indexOf('/js/api.js'),
      'reporter phải đứng trước api.js');
  });

  test('KHÔNG layout nào nạp script tự-khởi-động-và-gọi-API', () => {
    // `home-mock-tiles.js` tự chạy lúc DOMContentLoaded và gọi ngay
    // `/api/mock-exams/my-sittings`. Trong Next nó bắn request TRƯỚC khi phiên
    // sẵn sàng → 401 → `api.js:130` đẩy sang `/login.html` và CẢ TRANG biến mất.
    // Cổng parity authed bắt đúng vậy ở PR #930 (68 phát hiện, dấu hiệu nhận
    // biết: nội dung TĨNH cũng "missing" + `title-mismatch: Trang chủ → Đăng
    // nhập`). Loại script đó phải port vào tầng behavior.
    const BANNED = ['home-mock-tiles.js'];
    for (const { group, file } of authedLayouts()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const b of BANNED) {
        assert.ok(!src.includes(b), `${group}: ${b} tự gọi API lúc nạp — port vào behavior`);
      }
    }
    assert.ok(!SHELL.includes('home-mock-tiles.js'), 'AuthedShell cũng vậy');
  });

  test('CSS trang là THAM SỐ, không hardcode trong khung', () => {
    // `home.css` có luật toàn cục (`*`, `html, body`, `a`) mà `profile.css` và
    // `speaking.css` không có (đếm được: 0). Nạp chung một danh sách cố định là
    // đổ luật toàn cục lên những trang đang chạy.
    for (const css of ['profile.css', 'home.css', 'speaking.css']) {
      assert.ok(!SHELL.includes(css), `${css} không được hardcode trong AuthedShell`);
    }
    assert.match(SHELL, /pageStylesheets: PageStylesheet\[\]/);
  });

  test('design="v2" bỏ toàn bộ CSS/script cũ, giữ nguyên phần còn lại (UIBASE-0056 FR-002)', () => {
    // Mỗi thẻ cũ tự mang `v1 &&` (không bọc fragment) nên cây v1 giữ nguyên
    // byte (FR-003, so <head> trong PR G03-T12). Ở đây giữ: mọi <link> cũ,
    // pageStylesheets, Lucide, aver-chrome và aver-admin-chrome đều có cổng v1.
    assert.match(SHELL, /design = 'v1'/);
    assert.match(SHELL, /const v1 = design === 'v1';/);
    for (const href of ['tokens.css', 'components.css', 'ds.css', 'tailwind.build.css']) {
      const line = SHELL.split('\n').find((l) => l.includes(`/css/${href.startsWith('tokens') || href.startsWith('components') ? 'aver-design/' : ''}${href}`));
      assert.ok(line && /\{v1 && /.test(line), `${href} phải nằm sau \`v1 &&\``);
    }
    assert.match(SHELL, /\{v1 && pageStylesheets\.map\(/);
    assert.match(SHELL, /\{v1 && lucideRuntime && <Script src="\/vendor\/lucide\.min\.js"/);
    assert.match(SHELL, /\{v1 && chrome === 'student' && \(/);
    assert.match(SHELL, /\{v1 && chrome === 'admin' && \(/);
    assert.equal((SHELL.match(/<link\b/g) || []).length, 5, 'chỉ 5 <link>, cả 5 đều có cổng v1');
    assert.equal((SHELL.match(/<Script\b/g) || []).length, 3, 'chỉ 3 <Script>, cả 3 đều có cổng v1');
    // Khung v2 không nhận CSS cũ và gắn class body của cây v2.
    assert.match(SHELL, /design: 'v2';\s*pageStylesheets\?: never;/);
    assert.match(SHELL, /bodyClass = design === 'v2' \? 'av2-body' : 'av-page font-sans min-h-screen'/);
  });

  test('layout v2 dùng design="v2", tự nạp CSS v2 và bọc .av2-root', () => {
    const v2 = authedLayouts().filter(({ file }) => /design="v2"/.test(readFileSync(file, 'utf8')));
    assert.ok(v2.length >= 1, 'G03-T12 có ít nhất trang thử (authed-v2-pilot)');
    for (const { group, file } of v2) {
      const src = stripComments(readFileSync(file, 'utf8'));
      assert.match(group, /^\(authed-v2-/, `${group}: route group v2 đặt tên (authed-v2-<khu>) (plan 5.7.2)`);
      assert.match(src, /import '@\/styles\/av2\/tokens\.css';/);
      assert.match(src, /import '@\/styles\/av2\/base\.css';/);
      assert.match(src, /className=\{`av2-root \$\{av2FontClass\}`\}/);
      assert.doesNotMatch(src, /pageStylesheets|\/css\//, `${group}: cây v2 không nạp CSS cũ`);
    }
  });
});
