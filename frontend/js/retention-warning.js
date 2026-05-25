/**
 * frontend/js/retention-warning.js — Sprint 16.3 (Direction B)
 *
 * Deletion-warning chips + aggregate banner for the speaking.html session
 * history list. Pure consumers of the Sprint 16.2 `retention` block that
 * GET /sessions attaches to each row:
 *     { days_until_hide, days_until_purge, is_hidden, is_purged }
 *
 * Tier 1 only (soft-hide warning): a session inactive for ≥ (7 − HIDE_WARN_DAYS)
 * days shows an amber chip. Tier 2 (purge warning) is inherently a hidden-view
 * feature — visible rows are by definition not yet hidden (days_until_purge > 23)
 * — so it ships with the hidden view in 16.3.1.
 *
 * Pattern #25/#26: colour comes from .ds-* classes (ds.css --ds-warning-* tokens,
 * both themes) — this module emits NO inline color/background/hex literals.
 * Pattern #29: a missing/absent retention block (legacy API response) yields no
 * chip and no crash.
 */
(function () {
  'use strict';

  // Warn when a session is within this many days of being soft-hidden (7d).
  var HIDE_WARN_DAYS = 3;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Pure: retention block → { variant, days, label } or null when no warning.
  function chipFor(retention) {
    if (!retention || typeof retention !== 'object') return null;   // Pattern #29
    if (retention.is_hidden || retention.is_purged) return null;     // already gone from list
    var d = retention.days_until_hide;
    if (typeof d !== 'number' || d > HIDE_WARN_DAYS) return null;
    var label = d <= 0 ? 'Sắp ẩn' : ('Sắp ẩn trong ' + d + ' ngày');
    return { variant: 'soon', days: d, label: label };
  }

  // Pure: retention block → chip HTML (class-based, themed) or '' .
  function chipHtml(retention) {
    var c = chipFor(retention);
    if (!c) return '';
    return '<span class="ds-retention-chip ds-retention-chip--' + c.variant + '"'
      + ' title="Phiên không được mở trong 7 ngày sẽ tự ẩn khỏi danh sách (điểm vẫn được giữ).">'
      + _esc(c.label) + '</span>';
  }

  // Pure: how many sessions are within the soft-hide warning window.
  function countSoonHidden(sessions) {
    return (sessions || []).filter(function (s) {
      return !!chipFor(s && s.retention);
    }).length;
  }

  // Pure: aggregate banner HTML (reuses .ds-warning-banner) or '' when count 0.
  function bannerHtml(count) {
    if (!count) return '';
    return '<div class="ds-warning-banner" role="alert" aria-label="Cảnh báo lưu trữ">'
      + '<span class="ds-warning-icon" aria-hidden="true">⏳</span>'
      + '<span class="ds-warning-message">'
      +   '<b>' + count + ' phiên sắp bị ẩn</b> khỏi danh sách (không được mở trong 7 ngày). '
      +   'Mở lại một phiên sẽ gia hạn, hoặc vào phiên để tải báo cáo PDF — điểm thành phần luôn được giữ.'
      + '</span></div>';
  }

  window.RetentionWarning = {
    HIDE_WARN_DAYS: HIDE_WARN_DAYS,
    chipFor: chipFor,
    chipHtml: chipHtml,
    countSoonHidden: countSoonHidden,
    bannerHtml: bannerHtml,
  };
})();
