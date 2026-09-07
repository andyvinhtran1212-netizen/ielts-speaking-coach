/**
 * frontend/js/analytics-beacon.js — Sprint 17.4 (Direction D)
 *
 * Fire-and-forget `page_view` beacon, fired once per document route. Reuses
 * window.api.post, which attaches the Bearer token when the visitor is logged in
 * (the backend then attributes user_id; anonymous visitors record user_id=NULL).
 * Silent on ANY failure — tracking must never affect the page (Pattern #29).
 *
 * Install: add `<script src="/js/analytics-beacon.js" defer></script>` after
 * api.js on a page. NOT installed on admin pages (avoids counting admin's own
 * navigation as foot traffic).
 */
(function () {
  'use strict';

  // `analytics-beacon.js` vẫn tự bắn đúng một lần trên trang Legacy. Native
  // App Router gọi lại hàm công khai này khi pathname đổi; chốt theo pathname
  // ngăn Strict Mode / onReady bắn trùng nhưng vẫn cho phép A → B → A được ghi
  // thành ba lượt điều hướng thật.
  function fire() {
    try {
      window.aver = window.aver || {};
      if (!(window.api && typeof window.api.post === 'function')) return;
      var path = location.pathname;
      if (window.aver._lastPageViewPath === path) return;
      window.aver._pageViewSent = true;
      window.aver._lastPageViewPath = path;
      // ADR-012 migration tags: which stack rendered the page + which
      // release served it (cutover-dashboard denominator). Best-effort.
      var impl = 'legacy';
      var release = null;
      try {
        impl = (typeof window.__next_f !== 'undefined') ? 'next' : 'legacy';
        release = (window.__AVER_RUNTIME_CONFIG__ || {}).release || null;
      } catch (e) { /* tags must never block the beacon */ }
      window.api.post('/api/analytics/events', {
        event_name: 'page_view',
        event_data: {
          path: path,
          referrer: document.referrer || '',
          vw: window.innerWidth || 0,
          implementation: impl,
          release: release,
        },
      }).catch(function () { /* best-effort */ });
    } catch (e) { /* never affect the page */ }
  }

  window.aver = window.aver || {};
  window.aver.trackPageView = fire;

  // Review PR 887 — 'interactive' CŨNG phải chờ. Script `defer` chạy khi
  // readyState đã là 'interactive', tức TRƯỚC sự kiện DOMContentLoaded. Trang
  // nào gọi `initSupabase` trong một listener DOMContentLoaded (profile.html
  // làm vậy để chắc chắn có `createClient`) thì beacon bắn sớm hơn init, phiên
  // đăng nhập chưa sẵn, và page_view rơi vào CSDL với `user_id = NULL` — khách
  // đã đăng nhập bị đếm thành ẩn danh. Đây là lỗi DỮ LIỆU, không chỉ thứ tự:
  // baseline exposure của route authed sẽ sai ngay từ đầu.
  //
  // Listener của trang được đăng ký lúc parse (inline), còn listener này đăng
  // ký muộn hơn, nên chạy SAU init — đúng thứ tự cần.
  if (document.readyState === 'loading' || document.readyState === 'interactive') {
    document.addEventListener('DOMContentLoaded', fire);
  } else {
    fire();
  }
})();
