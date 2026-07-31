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
 * Quét chunk đã build (2026-07-31) tìm API mốc Safari 16.4+:
 *   - `Object.hasOwn` — CÓ, gọi trực tiếp trong runtime App Router
 *     (adapter `searchParams`), nên phải tự vá.
 *   - `findLast` / `toSorted` / `toReversed` / `Object.groupBy` — không có.
 *   - `structuredClone` / `replaceAll` — không có; `.at()` có nhưng là mốc
 *     Safari 15.4 và máy quan sát được là iOS 15.8.5, vẫn để trong tầm.
 *
 * File này chạy TRƯỚC code frontend của ứng dụng (file convention của Next),
 * nên phép gán dưới đây chắc chắn xong trước khi runtime gọi tới.
 * Quét lại danh sách trên mỗi lần nâng Next — API mới có thể lọt vào chunk.
 */

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: function hasOwn(target: unknown, property: PropertyKey) {
      if (target === null || target === undefined) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.prototype.hasOwnProperty.call(Object(target), property);
    },
    configurable: true,
    writable: true,
  });
}
