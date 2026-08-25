/**
 * phase3-grammar-home.test.mjs — route đầu tiên của Phase 3: `/grammar`.
 *
 * Pin ba nhóm hợp đồng, mỗi nhóm đều từ một lần đã trả giá:
 *   1. **Class/id của legacy là HỢP ĐỒNG.** `grammar-wiki.css` bám vào chúng;
 *      pilot 2 (#741) từng dựng lại từ đầu và gãy cascade (chữ trắng trên nền
 *      trắng), chỉ phát hiện nhờ so ảnh chụp.
 *   2. **`searchParams` phải nằm sau `Suspense`**, không được lọt vào vùng
 *      `use cache` — ràng buộc của cacheComponents, vi phạm thì build đỏ hoặc
 *      tệ hơn là cache nhầm theo tham số.
 *   3. **Đi qua tầng dữ liệu chung**, không tự fetch (xem
 *      `backend-data-layer.test.mjs`).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const DIR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const PAGE = readFileSync(path.join(DIR, 'page.tsx'), 'utf8');
const CARDS = readFileSync(path.join(DIR, 'grammar-cards.tsx'), 'utf8');
const SEARCH = readFileSync(path.join(DIR, 'search-box.tsx'), 'utf8');
const LEGACY = readFileSync(path.join(FRONTEND, 'public', 'grammar.html'), 'utf8');

describe('route /grammar (Phase 3)', () => {
  test('là Server Component; interaction nằm trong client boundaries nhỏ', () => {
    assert.ok(!PAGE.includes("'use client'"), 'trang phải render phía máy chủ');
    assert.ok(!CARDS.includes("'use client'"), 'thẻ hiển thị không cần client');
    assert.match(SEARCH, /^'use client';/m, 'ô tìm kiếm cần state + sự kiện bàn phím');
  });

  test('searchParams đọc SAU Suspense, không nằm trong vùng cache', () => {
    assert.match(PAGE, /<Suspense fallback=/, 'phần động phải có ranh giới stream');
    // Thân đọc searchParams là một component riêng, được bọc trong Suspense.
    assert.match(PAGE, /<GrammarBody searchParams=\{searchParams\}/);
    assert.match(PAGE, /async function GrammarBody[\s\S]*?await searchParams/);
    assert.ok(!PAGE.includes("'use cache'"),
      "trang không được tự khai 'use cache' — cache nằm ở lib/backend.ts, và"
      + ' searchParams không được phép đọc bên trong vùng cache');
  });

  test('ba chế độ được giữ: ?q= · ?category= · trang chủ', () => {
    assert.match(PAGE, /redirect\(`\/grammar\/search\?q=/,
      '?q= phải chuyển sang route search Next canonical');
    assert.match(PAGE, /getCategory\(category\)/);
    assert.match(PAGE, /Promise\.all\(\[getHome\(\), getGroups\(\)\]\)/,
      'trang chủ nạp song song như legacy; tuần tự sẽ cộng dồn độ trễ');
  });

  test('đọc ĐÚNG key backend trả: featured_articles', () => {
    // Codex bắt ở vòng review đầu: backend trả `featured_articles`
    // (`grammar_content.py:315`), legacy `grammar.js:543` cũng đọc key đó.
    // Đọc nhầm thành `home.featured` thì mục "Bài nổi bật" LUÔN rỗng mà build
    // vẫn xanh và không có lỗi nào — chỉ lộ khi mở trang thật.
    const legacyJs = readFileSync(path.join(FRONTEND, 'public', 'js', 'grammar.js'), 'utf8');
    assert.match(legacyJs, /featured_articles/, 'chốt chặn: legacy vẫn dùng key này');
    assert.match(PAGE, /articles=\{home\?\.featured_articles\}/);
    assert.ok(!/home\?\.featured[^_]/.test(PAGE), 'không được đọc key `featured` cụt');
  });

  test('dựng <aver-chrome>, không chỉ nạp script', () => {
    // Layout `(public-content)` chỉ NẠP module chrome; phần tử phải do từng
    // trang render (route bài viết làm đúng vậy). Thiếu dòng này trang mất
    // toàn bộ điều hướng + khối tài khoản mà build vẫn xanh.
    const layout = readFileSync(path.join(FRONTEND, 'app', '(public-content)', 'layout.tsx'), 'utf8');
    assert.ok(!layout.includes('<aver-chrome'), 'layout cố ý KHÔNG dựng — nên trang phải dựng');
    assert.match(PAGE, /<aver-chrome active="grammar"/);
  });

  test('?category= không tồn tại → 404 thật, không bịa tên thư mục', () => {
    // `getPublicJson` biến 404 backend thành `null`. Render tiếp với `null` sẽ
    // lấy slug làm tiêu đề ⇒ link hỏng trông như thư mục hợp lệ đang trống.
    assert.match(PAGE, /if \(!data\) notFound\(\);/);
    assert.match(PAGE, /import \{ notFound, redirect \} from 'next\/navigation'/);
  });

  test('đi qua tầng dữ liệu chung, không tự fetch', () => {
    assert.ok(!PAGE.includes('fetch('), 'mọi request đi qua lib/backend.ts');
    assert.match(PAGE, /from '\.\.\/\.\.\/\.\.\/lib\/grammar-api'/);
  });
});

describe('parity với trang legacy', () => {
  test('tiêu đề trùng nguyên văn legacy', () => {
    const legacyTitle = /<title>([^<]+)<\/title>/.exec(LEGACY)?.[1];
    assert.equal(legacyTitle, 'Grammar Wiki — Aver Learning');
    assert.match(PAGE, /title: 'Grammar Wiki — Aver Learning'/);
  });

  test('H1 giữ dấu cách quanh <br> — dưới 640px br bị ẩn', () => {
    // Bộ so parity tìm ra trên production 03/08: JSX nuốt khoảng trắng chứa
    // xuống dòng giữa thẻ và chữ, HTML thì giữ. Dưới 640px `<br>` là
    // `display:none` ⇒ thiếu dấu cách thì thành "như mộthệ thống liên kết".
    // Đo thật: legacy 375px "một hệ thống" · Next 375px (trước vá) "mộthệ thống".
    // Desktop trông vẫn đúng, nên đọc mắt ở 1280px KHÔNG bắt được.
    assert.match(LEGACY, /như một<br class="hidden sm:block"\/>\s/,
      'chốt chặn: legacy có khoảng trắng ngay sau <br>');
    assert.match(PAGE, /như một<br className="hidden sm:block" \/>\{' '\}/,
      "thiếu {' '} sau <br> ⇒ hai chữ dính liền trên mọi màn hình < 640px");
  });

  test('giữ đúng các id mà grammar-wiki.css nhắm tới', () => {
    for (const id of [
      'home-content', 'groups-section', 'groups-list',
      'featured-list', 'categories', 'category-cards',
      'category-view', 'category-view-title', 'category-view-list',
    ]) {
      assert.ok(PAGE.includes(`id="${id}"`), `thiếu id="${id}" — CSS legacy bám vào nó`);
    }
    for (const id of ['search-input', 'search-btn']) {
      assert.ok(SEARCH.includes(`id="${id}"`), `thiếu id="${id}"`);
    }
  });

  test('giữ class hook cho chủ đề sáng (không quay lại inline color)', () => {
    // Sprint 6.15.6-hotfix: các chỗ này từng là rgba() inline và làm chủ đề
    // sáng đọc sai token; đã đổi sang class hook, không được lùi lại.
    for (const cls of ['gw-status-dot--planned', 'gw-status-badge--planned']) {
      assert.ok(CARDS.includes(cls), `thiếu class hook ${cls}`);
    }
    assert.ok(!CARDS.includes('gw-progress-track'),
      'editorial completion không được giả làm learner progress');
  });

  test('link bài viết trỏ URL sạch canonical (route Next của pilot 2)', () => {
    assert.match(CARDS, /\/grammar\/\$\{encodeURIComponent\(category\)\}\/\$\{encodeURIComponent\(slug\)\}/);
  });

  test('thẻ thư mục dùng <a> thật thay vì onclick giả lập', () => {
    // Legacy dựng cả thẻ thành "role=link" bằng onclick + onkeydown. Bản Next
    // dùng <a>: chuột giữa, chuột phải, và bàn phím hoạt động đúng chuẩn.
    assert.ok(!CARDS.includes('onClick={() => (window.location'), 'không giả lập link bằng JS');
    assert.match(CARDS, /href=\{`\/grammar\?category=\$\{encodeURIComponent\(cat\.slug\)\}`\}/);
  });
});

describe('mảnh dùng chung cho 4 trang Grammar còn lại', () => {
  test('thẻ tách thành module riêng, export đủ ba loại', () => {
    assert.ok(existsSync(path.join(DIR, 'grammar-cards.tsx')));
    for (const fn of ['GroupCards', 'FeaturedCards', 'CategoryCards', 'LevelBadge', 'UpdatingBadge', 'articleUrl']) {
      assert.match(CARDS, new RegExp(`export (function|const) ${fn}\\b`), `thiếu export ${fn}`);
    }
  });
});
