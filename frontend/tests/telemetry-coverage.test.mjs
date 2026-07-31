/**
 * telemetry-coverage.test.mjs — DEBT-2026-07-31-O.
 *
 * Cổng rollback của ADR-012/ADR-013 đứng trên BA nguồn, và chúng phải cùng có
 * mặt trên mỗi trang được đo:
 *   · `analytics-beacon.js` → MẪU SỐ (page_view) của error-rate + exposure;
 *   · `error-reporter.js`   → TỬ SỐ (lỗi phía client);
 *   · `rum-vitals.js`       → trigger LCP.
 *
 * Vì sao vẫn đòi thẻ TƯỜNG MINH dù `aver-chrome.js` có tự chèn error-reporter
 * trong `connectedCallback()`: đường nạp động chỉ tới SAU khi custom element
 * upgrade, nên lỗi parse/exec sớm — đúng loại `SyntaxError` iOS 15 của DEBT-K —
 * rơi vào khoảng mù. Thẻ `<script defer>` sớm thu hẹp khoảng đó.
 *
 * Vì sao có bài này: 2026-07-31, khi chuẩn bị pilot 3+4, đếm ra ba layout Next
 * mỗi cái thiếu một thứ khác nhau —
 *   (marketing)      : có error-reporter + rum-vitals, page_view gửi bằng fetch
 *                      riêng trong landing-behavior.tsx;
 *   (public-content) : có analytics-beacon + rum-vitals, KHÔNG có error-reporter;
 *   (authed)         : chỉ có rum-vitals.
 * Hệ quả: suốt cửa sổ quan sát pilot 2, route `/grammar/...` chỉ báo lỗi client
 * SAU khi chrome upgrade (đường nạp động), nên "0 lỗi" ở đó không nói được gì
 * về lỗi parse/exec SỚM. Bài test này để lần sau không ai đo vào khoảng mù.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..', 'app');
const PAGES = path.join(__dirname, '..', 'public', 'pages');

/**
 * Có THẺ SCRIPT thật trỏ tới file đó không — không phải "cái tên có xuất hiện
 * đâu đó trong file". Review #887 bắt đúng lỗi này: chính đoạn bình luận tôi
 * thêm vào profile.html có nhắc `rum-vitals.js`, nên xoá thẻ script thật mà
 * test vẫn xanh. Cùng một lớp lỗi với bộ quét sàn trình duyệt hồi #882.
 */
function loadsScript(src, file) {
  const name = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Phải là THẺ <script> thật với thuộc tính `src` của CHÍNH nó. Bản trước chỉ
  // đòi "một thuộc tính kết thúc bằng src" nên `<img src="/js/x.js">` hay
  // `<div data-src="…">` cũng qua (review #887) — vẫn là đường xanh-giả, chỉ
  // hẹp hơn lần đầu. `[^>]*` chặn không cho vượt qua dấu `>` sang thẻ khác;
  // `(?<![-\\w])src` loại `data-src`/`asset-src`.
  return new RegExp(
    `<script\\b[^>]*(?<![-\\w])src\\s*=\\s*["'][^"'>]*${name}["']`,
  ).test(file);
}

/** Layout của route group = nơi khai báo script cho mọi trang trong nhóm. */
function groupLayouts() {
  return readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('('))
    .map((e) => path.join(APP, e.name, 'layout.tsx'))
    .filter(existsSync);
}

describe('phủ telemetry (DEBT-2026-07-31-O)', () => {
  for (const layout of groupLayouts()) {
    const name = path.basename(path.dirname(layout));
    const src = readFileSync(layout, 'utf8');

    test(`${name}: có nguồn page_view (mẫu số của error-rate)`, () => {
      // Hoặc nạp beacon dùng chung, hoặc tự gửi page_view (landing làm vậy vì
      // cố ý không kéo api.js) — cái nào cũng được, KHÔNG có mới là hỏng.
      const viaBeacon = loadsScript('analytics-beacon.js', src);
      const viaOwnFetch = readdirSync(path.dirname(layout))
        .filter((f) => f.endsWith('.tsx'))
        .some((f) => readFileSync(path.join(path.dirname(layout), f), 'utf8')
          .includes("event_name: 'page_view'"));
      assert.ok(viaBeacon || viaOwnFetch,
        `${name} không phát page_view ⇒ error-rate không có mẫu số, exposure = 0`);
    });

    test(`${name}: có error-reporter (tử số của error-rate)`, () => {
      assert.ok(loadsScript('error-reporter.js', src),
        `${name} không nạp reporter SỚM ⇒ chỉ còn đường động qua aver-chrome, và lỗi`
        + ' parse/exec sớm rơi vào khoảng mù — đúng chuyện đã xảy ra với route grammar'
        + ' trong cửa sổ quan sát pilot 2');
    });

    test(`${name}: có rum-vitals (trigger LCP)`, () => {
      assert.ok(loadsScript('rum-vitals.js', src), `${name} thiếu Web Vitals`);
    });
  }

  // Review #887 — CHỈ CÓ MẶT LÀ CHƯA ĐỦ. Script `defer` chạy theo THỨ TỰ TÀI
  // LIỆU, nên reporter đứng sau `api.js` thì lỗi trong api.js xảy ra khi
  // listener chưa gắn: khoảng mù vẫn còn, chỉ hẹp hơn. Bài này pin thứ tự.
  const tagIndex = (src, file) =>
    src.search(new RegExp(`<script\\b[^>]*(?<![-\\w])src\\s*=\\s*["'][^"'>]*${file}["']`));

  const reporterFirst = (src, label) => {
    const iReporter = tagIndex(src, 'error-reporter\\.js');
    assert.ok(iReporter !== -1, `${label}: không thấy thẻ error-reporter`);
    // Mọi script trong hàng đợi defer — kể cả MODULE (module defer mặc định) —
    // chạy theo thứ tự tài liệu, nên bất cứ cái nào đứng trước reporter đều có
    // thể ném lỗi khi listener chưa gắn (review #887 bắt `aver-chrome.js` đứng
    // trước ở (public-content) dù comment nói ngược lại).
    for (const [file, why] of [
      ['\\/api\\.js', 'lỗi trong api.js'],
      ['aver-chrome\\.js', 'lỗi lúc đánh giá module chrome'],
    ]) {
      const i = tagIndex(src, file);
      if (i === -1) continue;
      assert.ok(iReporter < i,
        `${label}: error-reporter phải đứng TRƯỚC ${file.replace(/\\/g, '')} — nếu không, ${why}`
        + ' xảy ra trước khi listener gắn và không bao giờ được báo');
    }
  };

  for (const layout of groupLayouts()) {
    const name = path.basename(path.dirname(layout));
    test(`${name}: error-reporter đứng trước api.js`, () => {
      reporterFirst(readFileSync(layout, 'utf8'), name);
    });
  }

  test('profile.html: error-reporter đứng trước api.js', () => {
    reporterFirst(readFileSync(path.join(PAGES, 'profile.html'), 'utf8'), 'profile.html');
  });

  // Giao thức baseline legacy (header rum-vitals.js): trang legacy SẮP cutover
  // phải được gắn đủ ba script ≥24h trước, nếu không cửa sổ quan sát không có
  // gì để so.
  test('trang legacy đích của pilot 3+4 (profile) đã gắn đủ ba script', () => {
    const src = readFileSync(path.join(PAGES, 'profile.html'), 'utf8');
    for (const s of ['analytics-beacon.js', 'error-reporter.js', 'rum-vitals.js']) {
      assert.ok(loadsScript(s, src),
        `profile.html thiếu ${s} — cutover mà không có baseline thì cửa sổ quan sát đo vào chỗ trống`);
    }
  });
});
