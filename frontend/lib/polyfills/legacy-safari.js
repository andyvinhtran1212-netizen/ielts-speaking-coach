/**
 * legacy-safari.js — polyfill cho sàn iOS/Safari 15.0 (DEBT-2026-07-29-K).
 *
 * JS THUẦN, không kiểu, và là script tự chạy — CỐ Ý. Review #882 (vòng 4) chỉ
 * ra rằng cổng CI mới chỉ tin vào dòng khai báo `POLYFILLED:` chứ chưa bao giờ
 * CHẠY THỬ phần cài đặt: xoá sạch thân hàm mà cổng vẫn xanh. Tách ra đây để
 * `tests/legacy-safari-polyfills.test.mjs` nạp được vào một realm sạch (vm),
 * xoá API gốc đi, rồi kiểm hành vi thật của từng receiver.
 *
 * `frontend/instrumentation-client.ts` chỉ import file này — nó chạy TRƯỚC code
 * frontend của ứng dụng (file convention của Next), nên mọi phép gán dưới đây
 * chắc chắn xong trước khi runtime gọi tới.
 *
 * Vì sao cần: `browserslist` chỉ hạ target CÚ PHÁP, không thêm polyfill API;
 * Next chỉ tự chèn fetch/URL/Object.assign, và chunk polyfill riêng của nó nạp
 * bằng `noModule` nên KHÔNG chạy trên iOS 15 (iOS 15 có ES module).
 */

(function installLegacySafariPolyfills() {
  // Object.hasOwn — Safari 16.4. Runtime App Router gọi thẳng (adapter
  // `searchParams`).
  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      value: function hasOwn(target, property) {
        if (target === null || target === undefined) {
          throw new TypeError('Cannot convert undefined or null to object');
        }
        return Object.prototype.hasOwnProperty.call(Object(target), property);
      },
      configurable: true,
      writable: true,
    });
  }

  // `.at()` — Safari 15.4, tức iOS 15.0–15.3 (vẫn trong sàn) thiếu nó.
  // Chỉ số âm đếm ngược từ cuối; ngoài khoảng trả undefined, KHÔNG throw.
  function at(index) {
    var len = this.length;
    var i = Math.trunc(index) || 0;
    if (i < 0) i += len;
    if (i < 0 || i >= len) return undefined;
    return this[i];
  }

  // Typed array KHÔNG kế thừa Array.prototype — chúng dùng
  // %TypedArray%.prototype riêng, lấy qua prototype cha của Uint8Array.
  var typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype);

  var targets = [Array.prototype, String.prototype, typedArrayProto];
  for (var i = 0; i < targets.length; i++) {
    var proto = targets[i];
    if (proto && typeof proto.at !== 'function') {
      Object.defineProperty(proto, 'at', {
        value: at,
        configurable: true,
        writable: true,
      });
    }
  }
})();
