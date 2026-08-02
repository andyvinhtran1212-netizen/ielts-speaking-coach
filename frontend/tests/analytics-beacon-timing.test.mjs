/**
 * analytics-beacon-timing.test.mjs — review #887.
 *
 * `page_view` là MẪU SỐ của trigger error-rate và là con số exposure mà cổng
 * cutover đọc. Nếu beacon bắn TRƯỚC khi phiên đăng nhập sẵn sàng, hàng ghi vào
 * CSDL mang `user_id = NULL`: khách đã đăng nhập bị đếm thành ẩn danh. Đó là
 * lỗi DỮ LIỆU, và nó rơi đúng vào route authed — chính là route pilot 3+4 sắp
 * cutover.
 *
 * Cơ chế: script `defer` chạy khi `document.readyState` đã là `'interactive'`,
 * tức TRƯỚC sự kiện `DOMContentLoaded`. Trang nào gọi `initSupabase` trong một
 * listener `DOMContentLoaded` (profile.html làm vậy để chắc chắn có
 * `createClient`) thì beacon phải chờ, không được bắn ngay.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'analytics-beacon.js'), 'utf8');

/** Chạy beacon trong một realm giả với readyState cho trước. */
function run(readyState) {
  const posts = [];
  const listeners = {};
  const location = { pathname: '/pages/profile.html' };
  const window = {
    api: { post: (url, body) => { posts.push({ url, body }); return Promise.resolve({}); } },
    location,
    innerWidth: 390,
  };
  const document = {
    readyState,
    referrer: '',
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
  };
  window.document = document;
  // `fire()` dùng biến toàn cục trần (`location`, `document`) chứ không qua
  // `window.` — sandbox phải cấp đúng như trình duyệt, nếu không ReferenceError
  // bị `catch` nuốt và test "không bắn" xanh vì lý do sai.
  const ctx = vm.createContext({ window, document, location, Object, JSON, Math, Date });
  vm.runInContext(SOURCE, ctx);
  return {
    posts,
    fireDomContentLoaded: () => (listeners.DOMContentLoaded || []).forEach((f) => f()),
  };
}

describe('thời điểm bắn page_view (review #887)', () => {
  test("readyState='interactive' (script defer) → CHỜ, không bắn ngay", () => {
    const sb = run('interactive');
    assert.equal(sb.posts.length, 0,
      'bắn ngay ở interactive = bắn trước initSupabase của trang ⇒ user_id NULL');
    sb.fireDomContentLoaded();
    assert.equal(sb.posts.length, 1, 'phải bắn sau DOMContentLoaded');
  });

  test("readyState='loading' → chờ DOMContentLoaded (hành vi cũ, giữ nguyên)", () => {
    const sb = run('loading');
    assert.equal(sb.posts.length, 0);
    sb.fireDomContentLoaded();
    assert.equal(sb.posts.length, 1);
  });

  test("readyState='complete' → bắn ngay (nạp muộn, DOMContentLoaded đã qua)", () => {
    const sb = run('complete');
    assert.equal(sb.posts.length, 1,
      'chờ một sự kiện đã xảy ra thì không bao giờ bắn — mất luôn page_view');
  });

  test('chỉ bắn ĐÚNG MỘT lần cho mỗi trang', () => {
    const sb = run('interactive');
    sb.fireDomContentLoaded();
    sb.fireDomContentLoaded();
    assert.equal(sb.posts.length, 1, 'đếm trùng làm phồng mẫu số của error-rate');
  });
});
