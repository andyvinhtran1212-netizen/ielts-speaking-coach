/*
 * home-mock-tiles.js — released mock-result tiles on the student home.
 *
 * When a mock sitting has been RELEASED (giám khảo bấm CÔNG BỐ), a result tile
 * appears next to the "Thi thử Full Test" start card → clicking it opens the TRF
 * (mock-result.html) with the 4-skill bands + per-skill chữa-bài links.
 * Best-effort + non-blocking: the start card always renders on its own.
 */
(function () {
  'use strict';

  function esc(s) {
    return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
  }
  function fmtBand(v) { return (v == null || v === '') ? '—' : Number(v).toFixed(1); }

  function tile(s) {
    return '<a class="mock-result-tile" href="/pages/mock-result.html?sitting=' + encodeURIComponent(s.sitting_id) + '">'
      + '<span class="mock-result-tile__band">' + fmtBand(s.overall) + '</span>'
      + '<span class="mock-result-tile__body">'
      + '<span class="mock-result-tile__title">Kết quả: ' + esc(s.code || 'Thi thử') + '</span>'
      + '<span class="mock-result-tile__hint">Xem điểm 4 kỹ năng + chữa bài →</span>'
      + '</span></a>';
  }

  function boot() {
    // Named `hub` (not "grid"): a negated grid var would make Tailwind's content
    // scanner emit a spurious important-grid utility into the built CSS.
    var hub = document.getElementById('mock-hub-grid');
    if (!hub || !window.api) return;
    window.api.get('/api/mock-exams/my-sittings').then(function (res) {
      var sittings = (res && res.sittings) || [];
      // Newest-released first (the endpoint already orders newest-first).
      sittings.filter(function (s) { return s.released; }).forEach(function (s) {
        hub.insertAdjacentHTML('beforeend', tile(s));
      });
    }).catch(function () { /* silent — the start card still shows */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
