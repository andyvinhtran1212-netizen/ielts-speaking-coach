/* kp-result-widget.js — "Điểm cần luyện" nudge on the result page (Phase 2 FE).
 *
 * After a graded session, surface the learner's persistent weak GRAMMAR knowledge
 * points (aggregated across all practice, from GET /api/me/kp-mastery) and funnel
 * them to their personal roadmap. Distinct from the per-session Grammar Resources
 * card (which reflects THIS session's detected issues).
 *
 * Silent + non-blocking: uses noRedirect and hides itself on any empty/error, so
 * it never disturbs the result page. All styling from --av-* tokens.
 */
(function () {
  'use strict';

  function esc(s) {
    if (window.WC && typeof window.WC.escapeHtml === 'function') return window.WC.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pretty(s) {
    return String(s || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  async function mount() {
    var el = document.getElementById('kp-weak-mount');
    if (!el || !window.api || !window.api.getWith) return;
    var data;
    try {
      data = await window.api.getWith('/api/me/kp-mastery?status=weak&kp_type=grammar', {}, { noRedirect: true });
    } catch (_) { return; }
    var items = (data && data.items) || [];
    if (!items.length) return;

    var chips = items.slice(0, 3).map(function (it) {
      return '<span style="display:inline-block;font-size:var(--av-fs-xs);font-weight:600;' +
        'padding:2px 10px;border-radius:999px;margin:0 6px 6px 0;' +
        'color:var(--av-error);background:var(--av-error-soft);">' +
        esc(pretty(it.ref_slug)) + '</span>';
    }).join('');

    el.innerHTML =
      '<div class="card p-5">' +
        '<p class="result-card-eyebrow result-card-eyebrow--brand text-xs font-bold uppercase tracking-wider mb-1">Điểm cần luyện</p>' +
        '<p class="text-sm mb-3" style="color:var(--av-text-secondary);">' +
          items.length + ' điểm ngữ pháp cần củng cố qua các buổi luyện của bạn.</p>' +
        '<div style="margin-bottom:var(--av-space-3);">' + chips + '</div>' +
        '<a href="/pages/grammar-roadmap.html" ' +
          'style="font-size:var(--av-fs-sm);font-weight:600;color:var(--av-primary);text-decoration:none;">' +
          'Xem lộ trình của bạn →</a>' +
      '</div>';
    el.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', mount);
  window.kpResultWidget = { mount: mount };
})();
