/**
 * frontend/js/analytics-beacon.js — Sprint 17.4 (Direction D)
 *
 * Fire-and-forget `page_view` beacon, fired once on page load. Reuses
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

  function fire() {
    try {
      if (!(window.api && typeof window.api.post === 'function')) return;
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
          path: location.pathname,
          referrer: document.referrer || '',
          vw: window.innerWidth || 0,
          implementation: impl,
          release: release,
        },
      }).catch(function () { /* best-effort */ });
    } catch (e) { /* never affect the page */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fire);
  } else {
    fire();
  }
})();
