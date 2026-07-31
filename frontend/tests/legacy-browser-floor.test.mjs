/**
 * legacy-browser-floor.test.mjs — DEBT-2026-07-29-K.
 *
 * 2026-07-28, production ghi 6 lỗi `SyntaxError: Unexpected token '{'` từ một
 * iPhone iOS 15.8.5 (Google Search App + Safari) trên `/`. Nguyên nhân: chunk
 * của CHÍNH Next chứa `class ... { static { ... } }` — class static block, chỉ
 * có từ **Safari 16.4**, mà đó cũng đúng là sàn mặc định của Next 16
 * (`chrome 111 / edge 111 / firefox 111 / safari 16.4`). Chunk không parse được
 * ⇒ KHÔNG hydrate trên MỌI route Next; nội dung SSR vẫn đọc được nhưng mọi thứ
 * chạy bằng JS thì chết.
 *
 * Bài test này pin phần CẤU HÌNH của bản vá (chạy trong mọi lần CI, không cần
 * build). Phần kiểm chunk thật nằm ở `tooling/legacy-browser-scan.mjs`, chạy
 * sau `npm run build` trong workflow route-manifest — vì nó cần output build.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(FRONTEND, 'package.json'), 'utf8'));

// Phiên bản lớn nhất còn được coi là "đủ thấp" cho từng engine.
const FLOOR = { safari: 15, ios_saf: 15 };

describe('sàn trình duyệt (DEBT-2026-07-29-K)', () => {
  test('package.json khai báo browserslist — thiếu nó là quay lại sàn 16.4 của Next', () => {
    assert.ok(Array.isArray(pkg.browserslist) && pkg.browserslist.length,
      'không có `browserslist` ⇒ Next dùng mặc định safari 16.4 ⇒ iOS ≤16.3 không hydrate');
  });

  test('sàn Safari/iOS ≤ 15 — class static block cần 16.4 nên đây là ranh giới thật', () => {
    for (const [engine, max] of Object.entries(FLOOR)) {
      const entry = pkg.browserslist.find((q) => q.startsWith(engine + ' '));
      assert.ok(entry, `browserslist thiếu mục cho \`${engine}\``);
      const version = Number.parseFloat(entry.slice(engine.length + 1));
      assert.ok(version <= max,
        `\`${entry}\` cao hơn sàn ${engine} ${max}. Nâng sàn = bỏ rơi thiết bị đang dùng thật;`
        + ' nếu thực sự muốn thì phải đo lại UA trên production trước.');
    }
  });

  test('instrumentation-client khai báo + nạp polyfill — browserslist KHÔNG tự vá API', () => {
    // browserslist chỉ hạ target CÚ PHÁP. Next chỉ tự chèn polyfill cho
    // fetch/URL/Object.assign, và chunk polyfill riêng của nó nạp bằng
    // `noModule` nên không chạy trên iOS 15 (iOS 15 có ES module).
    const file = ['instrumentation-client.ts', 'instrumentation-client.js']
      .map((f) => path.join(FRONTEND, f))
      .find(existsSync);
    assert.ok(file, 'thiếu frontend/instrumentation-client.* — nơi duy nhất chạy TRƯỚC code app');
    const src = readFileSync(file, 'utf8');
    assert.match(src, /POLYFILLED:.*Object\.hasOwn/,
      'runtime App Router gọi thẳng Object.hasOwn (Safari 16.4+) — phải khai + vá');
    assert.match(src, /import '\.\/lib\/polyfills\/legacy-safari\.js'/,
      'phần cài đặt nằm ở module riêng để test chạy được nó trong realm sạch');
    // Hành vi của từng polyfill do tests/legacy-safari-polyfills.test.mjs kiểm —
    // ở đây chỉ pin rằng file cài đặt tồn tại và được nạp.
    assert.ok(existsSync(path.join(FRONTEND, 'lib', 'polyfills', 'legacy-safari.js')));
  });

  // Review #882 vòng 8 — phần quét nguồn TĨNH không cần build, nên chạy thẳng
  // ở đây: mọi PR đều qua, không phụ thuộc path filter của job có build.
  // Đây là cách duy nhất bắt được lỗi kiểu speaking.html (`.at(-1)` inline)
  // trong một PR chỉ sửa HTML.
  test('nguồn tĩnh + script inline hiện tại đều dưới sàn iOS 15', () => {
    const r = spawnSync(process.execPath,
      [path.join(FRONTEND, 'tooling', 'legacy-browser-scan.mjs'), '--static-only'],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  });

  test('bộ quét chunk tồn tại và được CI gọi sau build', () => {
    assert.ok(existsSync(path.join(FRONTEND, 'tooling', 'legacy-browser-scan.mjs')));
    const wf = readFileSync(
      path.join(FRONTEND, '..', '.github', 'workflows', 'route-manifest.yml'), 'utf8');
    assert.match(wf, /legacy-browser-scan\.mjs/,
      'workflow phải chạy bộ quét sau khi build, nếu không thì lần nâng Next sau lại lọt');
    assert.match(wf, /frontend\/package\.json/,
      'workflow phải kích hoạt khi package.json đổi — browserslist nằm trong đó');
  });
});
