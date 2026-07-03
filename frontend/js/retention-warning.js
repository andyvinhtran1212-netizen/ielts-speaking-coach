/**
 * frontend/js/retention-warning.js — Sprint 16.3.1 (Warning UI v2)
 *
 * Deletion-warning chips + aggregate banner for the speaking.html session
 * history list. Pure consumers of the Sprint 16.2.1 v2 `retention` block that
 * GET /sessions attaches to each row:
 *   { days_until_audio_purge, days_until_content_purge,
 *     is_audio_purged, is_content_purged, is_hidden }
 *
 * Three chip states (priority order — most urgent wins):
 *   content-soon (red)   — report deletion imminent (≤7d, permanent loss)
 *   audio-soon   (amber)  — audio deletion imminent (≤3d)
 *   audio-gone   (gray)   — audio already deleted; report + scores still kept
 *
 * NOTE on ordering: audio (15d) is always purged long before content nears its
 * 60d purge, so `content-soon` MUST be checked before `audio-gone` or it would be
 * unreachable (audio-gone would mask it). The public API (chipHtml /
 * countSoonHidden / bannerHtml) is unchanged from 16.3 so speaking.html is untouched.
 *
 * Pattern #25/#26: colour comes from .ds-* classes (ds.css tokens, both themes) —
 * NO inline color/background/hex literals. Pattern #29: a missing/legacy retention
 * block (v1 fields, or none) yields no chip and no crash.
 */
(function () {
  'use strict';

  var AUDIO_WARN_DAYS = 3;     // warn this many days before the 15d audio purge
  var CONTENT_WARN_DAYS = 7;   // warn this many days before the 60d content purge

  function _esc(s) {
    // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
    // local fallback kept so this module is safe if window.WC hasn't loaded.
    return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _num(v) { return typeof v === 'number' ? v : null; }

  // Pure: v2 retention block → { variant, days } or null when no chip.
  // Two actionable states only. Sprint 16.4.1 (Andy D2): the old "audio-gone"
  // informational chip is removed — it showed on every 15-60d session (clutter),
  // and content-soon (checked first) already covers the only window where it would
  // matter. Users learn audio is gone on the result page, not via a list chip.
  function chipFor(retention) {
    if (!retention || typeof retention !== 'object') return null;   // Pattern #29
    if (retention.is_content_purged) return null;                    // already gone from list
    var dc = _num(retention.days_until_content_purge);
    var da = _num(retention.days_until_audio_purge);

    // 1. Content deletion imminent — most urgent (report permanently removed soon).
    if (dc !== null && dc <= CONTENT_WARN_DAYS) {
      return { variant: 'content-soon', days: dc };
    }
    // 2. Audio deletion imminent.
    if (!retention.is_audio_purged && da !== null && da <= AUDIO_WARN_DAYS) {
      return { variant: 'audio-soon', days: da };
    }
    return null;
  }

  var _LABEL = {
    'content-soon': function (d) { return d <= 0 ? 'Báo cáo sắp xóa' : ('Báo cáo sắp xóa trong ' + d + ' ngày'); },
    'audio-soon':   function (d) { return d <= 0 ? 'Audio sắp xóa'   : ('Audio sắp xóa trong ' + d + ' ngày'); },
  };
  var _TITLE = {
    'content-soon': 'Báo cáo bị xóa khi phiên quá 60 ngày không mở. Vào phiên để tải báo cáo PDF, hoặc mở lại (Xem lại) để gia hạn.',
    'audio-soon':   'Audio chỉ lưu 15 ngày kể từ khi ghi. Vào phiên để tải audio.',
  };

  // Pure: v2 retention block → chip HTML (class-based, themed) or ''.
  function chipHtml(retention) {
    var c = chipFor(retention);
    if (!c) return '';
    return '<span class="ds-retention-chip ds-retention-chip--' + c.variant + '"'
      + ' title="' + _esc(_TITLE[c.variant]) + '">'
      + _esc(_LABEL[c.variant](c.days)) + '</span>';
  }

  // Pure: count of sessions with a warning. Every remaining chip variant is
  // actionable (audio-soon / content-soon), so any non-null chip counts.
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
      +   '<b>' + count + ' phiên</b> có audio hoặc báo cáo sắp bị xóa. '
      +   'Vào phiên để tải về, hoặc mở lại (Xem lại) để gia hạn — điểm thành phần luôn được giữ.'
      + '</span></div>';
  }

  window.RetentionWarning = {
    AUDIO_WARN_DAYS: AUDIO_WARN_DAYS,
    CONTENT_WARN_DAYS: CONTENT_WARN_DAYS,
    chipFor: chipFor,
    chipHtml: chipHtml,
    countSoonHidden: countSoonHidden,
    bannerHtml: bannerHtml,
  };
})();
