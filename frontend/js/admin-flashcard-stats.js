/**
 * admin-flashcard-stats.js — Phase 2.5 dogfood support
 *
 * Renders the "Flashcards" tab on the admin dashboard.  The host page
 * (admin.html) calls window._adminFlashcardStats.onTabActivated() the
 * first time the user clicks the tab, and refresh() on demand.  All
 * fetches go through window.api so auth + base URL are handled centrally.
 */

(function () {
  if (!window.api) {
    console.error('[admin-flashcard-stats] window.api missing — load order broken?');
    return;
  }

  let _initialised = false;
  let _inFlight = false;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function show(id) {
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }

  function hide(id) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }

  async function loadStats() {
    if (_inFlight) return;
    _inFlight = true;

    const days = parseInt($('fcs-period').value, 10) || 30;
    const errEl = $('fcs-error');
    const contentEl = $('fcs-content');

    show('fcs-loading');
    hide('fcs-error');
    contentEl.innerHTML = '';

    try {
      // window.api.get already injects the bearer token.  A 401 redirects
      // the user to login.html via api.js; a 403 (non-admin) bubbles here
      // as a thrown Error and we render it inline.
      const data = await window.api.get('/admin/flashcards/stats?days=' + days);
      renderStats(data && data.stats, days);
    } catch (e) {
      const msg = (e && e.message) || 'Failed to load flashcard stats.';
      errEl.textContent = msg;
      show('fcs-error');
    } finally {
      hide('fcs-loading');
      _inFlight = false;
    }
  }

  function renderStats(stats, days) {
    const root = $('fcs-content');
    if (!stats) {
      root.innerHTML = '<div class="fcs-empty">No data returned.</div>';
      return;
    }

    const a  = stats.activity   || {};
    const sh = stats.srs_health || {};
    const en = stats.engagement || {};
    const ts = stats.timeseries || [];
    const rd = sh.rating_distribution_percent || { again: 0, hard: 0, good: 0, easy: 0 };

    root.innerHTML = [
      activitySection(a),
      srsHealthSection(sh, rd, days),
      engagementSection(en, days),
      timeseriesSection(ts, days),
    ].join('');
  }

  function activitySection(a) {
    return (
      '<div class="fcs-section">'
      +   '<h4>Activity (all time)</h4>'
      +   '<div class="fcs-grid">'
      +     statBox(a.total_manual_stacks, 'Manual Stacks')
      +     statBox(a.total_cards_in_manual_stacks, 'Cards in Stacks')
      +     statBox(a.total_active_users, 'Active Users')
      +     statBox(a.total_reviews_all_time, 'Total Reviews')
      +   '</div>'
      + '</div>'
    );
  }

  function srsHealthSection(sh, rd, days) {
    const total = sh.rating_total_count || 0;
    return (
      '<div class="fcs-section">'
      +   '<h4>SRS Health (last ' + escapeHtml(days) + ' days · ' + total + ' ratings)</h4>'
      +   ratingRow('Quên (Again)', 'again', rd.again || 0)
      +   ratingRow('Khó (Hard)',   'hard',  rd.hard  || 0)
      +   ratingRow('Tốt (Good)',   'good',  rd.good  || 0)
      +   ratingRow('Dễ (Easy)',    'easy',  rd.easy  || 0)
      +   '<div class="fcs-secondary">'
      +     '<div>Avg ease factor: <strong>' + escapeHtml(sh.avg_ease_factor != null ? sh.avg_ease_factor : '—') + '</strong></div>'
      +     '<div>Cards mastered (&gt;30 days): <strong>' + escapeHtml(sh.cards_mastered_30plus_days || 0) + '</strong></div>'
      +     '<div>Cards with lapses: <strong>' + escapeHtml(sh.cards_with_lapses || 0) + '</strong></div>'
      +     '<div class="fcs-hint">Healthy SRS: Again 10–20%, Hard 20–30%, Good 40–50%, Easy 10–20%.</div>'
      +   '</div>'
      + '</div>'
    );
  }

  function engagementSection(en, days) {
    const top = Array.isArray(en.top_reviewed_words) ? en.top_reviewed_words : [];
    const topHtml = top.length
      ? '<ul class="fcs-top-words">'
        + top.map(function (w, i) {
            return (
              '<li>'
              +   '<span class="rank">' + (i + 1) + '</span>'
              +   '<span class="word">' + escapeHtml(w.headword) + '</span>'
              +   '<span class="count">' + escapeHtml(w.review_count) + ' reviews</span>'
              + '</li>'
            );
          }).join('')
        + '</ul>'
      : '<div class="fcs-empty">No review data in this period.</div>';

    return (
      '<div class="fcs-section">'
      +   '<h4>Engagement</h4>'
      +   '<div class="fcs-grid">'
      +     statBox(en.avg_reviews_per_user_last_7_days, 'Avg Reviews/User (7d)')
      +     statBox(en.avg_dau_last_30_days, 'Avg DAU (period)')
      +   '</div>'
      +   '<h4 style="margin-top:14px;">Top reviewed words (last ' + escapeHtml(days) + ' days)</h4>'
      +   topHtml
      + '</div>'
    );
  }

  function timeseriesSection(series, days) {
    if (!series || !series.length) {
      return (
        '<div class="fcs-section">'
        +   '<h4>Reviews per day (last ' + escapeHtml(days) + ' days)</h4>'
        +   '<div class="fcs-empty">No reviews recorded in this window.</div>'
        + '</div>'
      );
    }
    const max = Math.max.apply(null, series.map(function (d) { return d.reviews; }).concat([1]));
    const bars = series.map(function (d) {
      const h = (d.reviews / max) * 100;
      // Trim to MM-DD for the tick label so the chart fits on narrow viewports.
      const tick = String(d.date || '').slice(5);
      return (
        '<div class="fcs-bar-col" title="' + escapeHtml(d.date) + ': ' + escapeHtml(d.reviews) + ' reviews">'
        +   '<div class="fcs-bar" style="height:' + h + '%"></div>'
        +   '<div class="fcs-bar-label">' + escapeHtml(tick) + '</div>'
        + '</div>'
      );
    }).join('');
    return (
      '<div class="fcs-section">'
      +   '<h4>Reviews per day (last ' + escapeHtml(days) + ' days)</h4>'
      +   '<div class="fcs-chart">' + bars + '</div>'
      + '</div>'
    );
  }

  function statBox(value, label) {
    return (
      '<div class="fcs-stat">'
      +   '<div class="fcs-stat-value">' + escapeHtml(value != null ? value : '—') + '</div>'
      +   '<div class="fcs-stat-label">' + escapeHtml(label) + '</div>'
      + '</div>'
    );
  }

  function ratingRow(label, kind, pct) {
    return (
      '<div class="fcs-rating-row">'
      +   '<span class="label">' + escapeHtml(label) + '</span>'
      +   '<div class="fcs-rating-track">'
      +     '<div class="fcs-rating-fill ' + kind + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div>'
      +   '</div>'
      +   '<span class="pct">' + escapeHtml(pct) + '%</span>'
      + '</div>'
    );
  }

  function onTabActivated() {
    if (!_initialised) {
      const sel = $('fcs-period');
      if (sel) sel.addEventListener('change', loadStats);
      _initialised = true;
    }
    loadStats();
  }

  window._adminFlashcardStats = {
    onTabActivated: onTabActivated,
    refresh: loadStats,
  };
})();
