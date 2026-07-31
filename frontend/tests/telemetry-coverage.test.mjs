/**
 * telemetry-coverage.test.mjs — DEBT-2026-07-31-O.
 *
 * Cổng rollback của ADR-012/ADR-013 đứng trên BA nguồn, và chúng phải cùng có
 * mặt trên mỗi trang được đo:
 *   · `analytics-beacon.js` → MẪU SỐ (page_view) của error-rate + exposure;
 *   · `error-reporter.js`   → TỬ SỐ (lỗi phía client);
 *   · `rum-vitals.js`       → trigger LCP.
 *
 * Vì sao có bài này: 2026-07-31, khi chuẩn bị pilot 3+4, đếm ra ba layout Next
 * mỗi cái thiếu một thứ khác nhau —
 *   (marketing)      : có error-reporter + rum-vitals, page_view gửi bằng fetch
 *                      riêng trong landing-behavior.tsx;
 *   (public-content) : có analytics-beacon + rum-vitals, KHÔNG có error-reporter;
 *   (authed)         : chỉ có rum-vitals.
 * Hệ quả nặng nhất: suốt cửa sổ quan sát pilot 2, route `/grammar/...` KHÔNG
 * thể báo lỗi client — nên "0 lỗi" khi đó là **đúng theo cấu tạo**, không phải
 * bằng chứng sức khoẻ. Bài test này để lần sau không ai đo vào chỗ trống.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..', 'app');
const PAGES = path.join(__dirname, '..', 'public', 'pages');

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
      const viaBeacon = src.includes('/js/analytics-beacon.js');
      const viaOwnFetch = readdirSync(path.dirname(layout))
        .filter((f) => f.endsWith('.tsx'))
        .some((f) => readFileSync(path.join(path.dirname(layout), f), 'utf8')
          .includes("event_name: 'page_view'"));
      assert.ok(viaBeacon || viaOwnFetch,
        `${name} không phát page_view ⇒ error-rate không có mẫu số, exposure = 0`);
    });

    test(`${name}: có error-reporter (tử số của error-rate)`, () => {
      assert.ok(src.includes('/js/error-reporter.js'),
        `${name} không báo lỗi client ⇒ "0 lỗi" là đúng-theo-cấu-tạo, không phải bằng chứng`
        + ' — đúng chuyện đã xảy ra với route grammar trong cửa sổ pilot 2');
    });

    test(`${name}: có rum-vitals (trigger LCP)`, () => {
      assert.ok(src.includes('/js/rum-vitals.js'), `${name} thiếu Web Vitals`);
    });
  }

  // Giao thức baseline legacy (header rum-vitals.js): trang legacy SẮP cutover
  // phải được gắn đủ ba script ≥24h trước, nếu không cửa sổ quan sát không có
  // gì để so.
  test('trang legacy đích của pilot 3+4 (profile) đã gắn đủ ba script', () => {
    const src = readFileSync(path.join(PAGES, 'profile.html'), 'utf8');
    for (const s of ['analytics-beacon.js', 'error-reporter.js', 'rum-vitals.js']) {
      assert.ok(src.includes(s),
        `profile.html thiếu ${s} — cutover mà không có baseline thì cửa sổ quan sát đo vào chỗ trống`);
    }
  });
});
