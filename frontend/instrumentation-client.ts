/**
 * instrumentation-client.ts — DEBT-2026-07-29-K, vế API.
 *
 * `browserslist` trong package.json hạ TARGET CÚ PHÁP xuống iOS 15 (nó là thứ
 * đã gây `SyntaxError: Unexpected token '{'` trên production: chunk của Next
 * chứa class static block, chỉ có từ Safari 16.4). Nhưng browserslist KHÔNG
 * thêm polyfill cho API thư viện — tài liệu Next chỉ hứa tự chèn fetch / URL /
 * Object.assign, và chunk polyfill dành riêng của Next được nạp bằng
 * `noModule`, tức KHÔNG chạy trên iOS 15 (iOS 15 có hỗ trợ ES module).
 *
 * Quét chunk đã build (2026-07-31) tìm API vượt sàn:
 *   - `Object.hasOwn` (Safari 16.4) — CÓ, gọi trực tiếp trong runtime App
 *     Router (adapter `searchParams`).
 *   - `.at()` (Safari 15.4) — CÓ. Sàn khai báo là `ios_saf 15`, tức **15.0**,
 *     nên máy iOS 15.0–15.3 nằm trong cam kết mà lại thiếu API này (review
 *     #882). Vá luôn thay vì nâng sàn lên 15.4: nâng sàn là bỏ rơi máy thật
 *     để hồ sơ trông sạch.
 *   - `findLast` / `toSorted` / `toReversed` / `Object.groupBy` /
 *     `structuredClone` / `replaceAll` — quét: không có trong chunk.
 *
 * Phần CÀI ĐẶT nằm ở `lib/polyfills/legacy-safari.js` (JS thuần) để test nạp
 * được vào realm sạch và kiểm hành vi thật — xem
 * `tests/legacy-safari-polyfills.test.mjs`. Trước đây nó nằm ngay trong file
 * này và chỉ được "khai báo" chứ chưa từng được chạy thử (review #882 vòng 4).
 *
 * File này chạy TRƯỚC code frontend của ứng dụng (file convention của Next).
 * Quét lại danh sách trên mỗi lần nâng Next — API mới có thể lọt vào chunk.
 *
 * Dòng dưới đây là HỢP ĐỒNG với `tooling/legacy-browser-scan.mjs` VÀ với bài
 * test hành vi: bộ quét đọc nó để biết API nào đã vá mà cho qua, còn test lấy
 * đúng danh sách này để chạy thử từng receiver. Thêm tên vào đây mà không cài
 * đặt thật thì test đỏ.
 * POLYFILLED: Object.hasOwn, Array.prototype.at, String.prototype.at, TypedArray.prototype.at
 */

import './lib/polyfills/legacy-safari.js';
