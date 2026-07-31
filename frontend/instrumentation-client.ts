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
 *     Router (adapter `searchParams`), phải tự vá.
 *   - `.at()` (Safari 15.4) — CÓ. Sàn khai báo là `ios_saf 15`, tức **15.0**,
 *     nên máy iOS 15.0–15.3 nằm trong cam kết mà lại thiếu API này (review
 *     #882). Vá luôn thay vì nâng sàn lên 15.4: nâng sàn là bỏ rơi máy thật
 *     để hồ sơ trông sạch, còn bản vá dưới đây tốn vài dòng.
 *   - `findLast` / `toSorted` / `toReversed` / `Object.groupBy` /
 *     `structuredClone` / `replaceAll` — quét: không có trong chunk.
 *
 * File này chạy TRƯỚC code frontend của ứng dụng (file convention của Next),
 * nên phép gán dưới đây chắc chắn xong trước khi runtime gọi tới.
 * Quét lại danh sách trên mỗi lần nâng Next — API mới có thể lọt vào chunk.
 *
 * Dòng dưới đây là HỢP ĐỒNG với `tooling/legacy-browser-scan.mjs`: bộ quét đọc
 * nó để biết API nào đã được vá mà cho qua. Sửa code thì sửa cả dòng này.
 * POLYFILLED: Object.hasOwn, Array.prototype.at, String.prototype.at
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

// `.at()` — Safari 15.4 / iOS 15.4. Chỉ số âm đếm ngược từ cuối; ngoài khoảng
// thì trả undefined (KHÔNG throw) — đúng đặc tả, và cũng là hành vi mà code
// gọi nó đang trông đợi.
function atPolyfill(this: { length: number; [index: number]: unknown }, index: number) {
  const len = this.length;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += len;
  if (i < 0 || i >= len) return undefined;
  return this[i];
}

for (const proto of [Array.prototype, String.prototype] as Array<Record<string, unknown>>) {
  if (typeof proto.at !== 'function') {
    Object.defineProperty(proto, 'at', {
      value: atPolyfill,
      configurable: true,
      writable: true,
    });
  }
}
