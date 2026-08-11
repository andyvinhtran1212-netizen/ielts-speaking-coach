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
    assert.ok(SHELL.indexOf('/js/error-reporter.js') < SHELL.indexOf('/js/api.js'),
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
});
