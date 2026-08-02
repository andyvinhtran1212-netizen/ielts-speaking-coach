/**
 * backend-data-layer.test.mjs — Phase 3, primitive dùng chung.
 *
 * Gate C (2026-08-02) chốt "làm tiếp toàn bộ" trong khi Gate D — vốn đòi
 * primitive ổn định qua ≥3 implementation — chưa mở. Rủi ro cụ thể của quyết
 * định đó: 125 trang legacy được chép tay thành 125 bản fetch hơi-khác-nhau,
 * mỗi bản có ngân sách abort riêng, TTL riêng và ngữ nghĩa lỗi riêng.
 *
 * Bài test này là cái chốt chống việc đó: MỌI bộ nạp nội dung công khai phải
 * đi qua `lib/backend.ts`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'lib');
const read = (rel) => readFileSync(path.join(LIB, rel), 'utf8');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('tầng gọi backend dùng chung (Phase 3)', () => {
  const backend = read('backend.ts');

  test('server-only: không được lọt vào bundle client (B25/ADR-004)', () => {
    assert.match(backend, /^import 'server-only';/m);
  });

  test('giữ đúng ngân sách ADR-008: abort 5s + cacheLife 1h/1h/1 ngày', () => {
    assert.match(backend, /AbortSignal\.timeout\(ABORT_MS\)/);
    assert.match(backend, /ABORT_MS = 5000/);
    assert.match(backend, /stale: 3600, revalidate: 3600, expire: 86400/);
    assert.match(backend, /cacheLife\(PUBLIC_CONTENT_LIFE\)/);
    assert.match(backend, /'use cache'/);
  });

  test('404 → null, lỗi khác → NÉM (không nuốt thành 404 giả)', () => {
    assert.match(backend, /res\.status === 404\) return null/);
    assert.match(backend, /if \(!res\.ok\) throw new Error/,
      'nuốt lỗi backend thành null sẽ dựng trang 404 giả khi backend sập —'
      + ' vừa lừa người đọc vừa làm hỏng chính bảng đo lỗi');
  });

  test('base URL theo đúng quy tắc runtime-config (ADR-006)', () => {
    assert.match(backend, /AVER_API_BASE/);
    assert.match(backend, /VERCEL_ENV === 'production'/);
    assert.match(backend, /staging/);
  });
});

describe('không chép lại tầng fetch ở nơi khác', () => {
  // Chốt chống-chép-dán: file nào trong lib/ gọi backend thì phải qua
  // getPublicJson. Không có nó, route thứ 10 sẽ có ngân sách abort riêng và
  // không ai nhận ra cho tới khi một trang treo lâu bất thường.
  for (const file of walk(LIB)) {
    const rel = path.relative(LIB, file);
    if (rel === 'backend.ts') continue;
    const src = readFileSync(file, 'utf8');
    if (!/\bfetch\(/.test(src) && !/AVER_API_BASE/.test(src)) continue;

    test(`${rel}: dùng lib/backend thay vì tự dựng fetch`, () => {
      // Review PR 894: đòi "import từ backend" là CHƯA ĐỦ — một loader có thể
      // `import { API_BASE }` rồi `fetch(API_BASE + path)` thẳng, không timeout
      // không cache, mà vẫn qua được mọi assertion bên dưới. Phải đòi đúng
      // getPublicJson VÀ cấm gọi fetch trần.
      assert.match(src, /\bgetPublicJson\b/,
        `${rel} phải gọi getPublicJson() — import API_BASE rồi tự fetch là lách cổng`);
      assert.ok(!/\bfetch\(/.test(src),
        `${rel} gọi fetch trần — mọi request nội dung công khai đi qua getPublicJson()`);
      assert.ok(!/AbortSignal\.timeout/.test(src),
        `${rel} tự đặt ngân sách abort riêng — ngân sách nằm ở lib/backend.ts`);
      assert.ok(!/cacheLife\(/.test(src),
        `${rel} tự đặt TTL riêng — TTL nằm ở lib/backend.ts`);
    });
  }
});

describe('bộ nạp Grammar sau khi rút về tầng chung', () => {
  const api = read('grammar-api.ts');

  test('mọi loader export đều đi qua React cache() (ADR-008)', () => {
    // Kiểm theo TÍNH CHẤT, không theo danh sách cứng: thêm loader mới (Phase 3
    // thêm getCategory) không được làm test đỏ vì lý do sai, nhưng thêm một
    // loader QUÊN cache() thì phải đỏ.
    const allExports = [...api.matchAll(/export const (\w+) = /g)].map((m) => m[1]);
    const cached = [...api.matchAll(/export const (\w+) = cache\(/g)].map((m) => m[1]);
    assert.ok(allExports.length >= 3, 'phải có ít nhất getArticle/getHome/getGroups');
    assert.deepEqual(allExports.sort(), cached.sort(),
      'loader không bọc cache() sẽ khiến generateMetadata và thân trang fetch hai lần');
  });

  test('có loader cho trang chủ + nhóm chủ đề (route Phase 3 đầu tiên cần)', () => {
    assert.match(api, /\/api\/grammar\/home/);
    assert.match(api, /\/api\/grammar\/groups/);
  });

  test('slug/category vẫn được encode (không nối chuỗi trần)', () => {
    assert.match(api, /encodeURIComponent\(category\)/);
    assert.match(api, /encodeURIComponent\(slug\)/);
  });
});
