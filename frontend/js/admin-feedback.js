/* frontend/js/admin-feedback.js — Feedback PR-3 (admin inbox).
 *
 * Lists user feedback (rating | report | flag) for Reading + Listening, GROUPED
 * BY TEST (each test shows avg rating + report/flag/new counts). Filter by type
 * (segmented) + status + skill. Toggle status → PATCH /api/admin/feedback/{id}
 * (optimistic + revert on error). Click a row → deep-link to the test's admin
 * management page (+ #q<n> when the feedback targets a question).
 *
 * Endpoint (#458): GET /api/admin/feedback (?skill&type&status&test_id, grouped)
 *                  PATCH /api/admin/feedback/{id} {status: new|resolved}
 * Pattern reused from admin-access-codes.js: client-side filter + re-render.
 */
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var _all = [];                         // every feedback row (unfiltered)
  var _filter = { type: '', status: '', skill: '' };

  var TYPE_LABEL = { rating: 'ĐÁNH GIÁ', report: 'BÁO LỖI', flag: 'FLAG GIẢI' };
  var CATEGORY_LABEL = {
    wrong_answer: 'Sai đáp án', audio_issue: 'Lỗi audio',
    unclear_typo: 'Đề khó hiểu / lỗi chính tả', other: 'Khác',
  };
  // skill → admin test-management deep-link base (test_id passed as ?test=).
  var DEEP_LINK = {
    reading:   '/pages/admin/reading/content.html',
    listening: '/pages/admin/listening/tests.html',
  };

  function banner(msg, isErr) {
    var b = $('fbx-banner');
    if (!msg) { b.hidden = true; return; }
    b.hidden = false; b.textContent = msg;
    b.classList.toggle('is-error', !!isErr);
  }

  // ── filtering (client-side, mirrors admin-access-codes rowMatchesFilters) ───
  function rowMatchesFilters(r, f) {
    if (f.type && r.type !== f.type) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.skill && r.skill !== f.skill) return false;
    return true;
  }

  function relTime(iso) {
    if (!iso) return '';
    var then = Date.parse(iso);
    if (isNaN(then)) return '';
    var diff = (Date.now() - then) / 1000;
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
    if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
    if (diff < 172800) return 'hôm qua';
    return Math.floor(diff / 86400) + ' ngày trước';
  }

  function who(r) {
    if (r.created_by) return 'học viên #' + String(r.created_by).slice(0, 6);
    if (r.anon_id) return 'ẩn danh (share-link)';
    return '—';
  }

  function stars(n) {
    n = Number(n) || 0;
    var out = '';
    for (var i = 1; i <= 5; i++) out += (i <= n ? '★' : '<i>★</i>');
    return '<span class="fbx-stars" aria-label="' + n + '/5">' + out + '</span>';
  }

  function deepLink(r) {
    var base = DEEP_LINK[r.skill];
    if (!base || !r.test_id) return null;
    var href = base + '?test=' + encodeURIComponent(r.test_id);
    if (r.q_num != null) href += '#q' + r.q_num;
    return href;
  }

  // ── per-test grouping (re-grouped client-side after filtering) ──────────────
  function groupByTest(rows) {
    var index = {}, groups = [];
    rows.forEach(function (r) {
      var key = r.test_id || '(không rõ đề)';
      var g = index[key];
      if (!g) { g = { test_id: r.test_id, skill: r.skill, items: [] }; index[key] = g; groups.push(g); }
      g.items.push(r);
    });
    return groups;
  }

  function avg(nums) {
    var v = nums.filter(function (x) { return x != null; });
    if (!v.length) return null;
    return Math.round((v.reduce(function (a, b) { return a + b; }, 0) / v.length) * 10) / 10;
  }

  function render() {
    var rows = _all.filter(function (r) { return rowMatchesFilters(r, _filter); });
    $('fbx-count-n').textContent = String(rows.filter(function (r) { return r.status === 'new'; }).length);
    $('fbx-loading').hidden = true;

    if (!rows.length) {
      $('fbx-empty').hidden = false; $('fbx-groups').hidden = true; $('fbx-groups').innerHTML = '';
      return;
    }
    $('fbx-empty').hidden = true; $('fbx-groups').hidden = false;

    var groups = groupByTest(rows);
    $('fbx-groups').innerHTML = groups.map(function (g) {
      var ratings = g.items.filter(function (i) { return i.type === 'rating'; });
      var avgDe = avg(ratings.map(function (i) { return i.rating_de; }));
      var avgAudio = avg(ratings.map(function (i) { return i.rating_audio; }));
      var reports = g.items.filter(function (i) { return i.type === 'report'; }).length;
      var flags = g.items.filter(function (i) { return i.type === 'flag'; }).length;
      var news = g.items.filter(function (i) { return i.status === 'new'; }).length;

      var stat = [];
      if (avgDe != null) stat.push('Đề ' + avgDe + '★');
      if (avgAudio != null) stat.push('Audio ' + avgAudio + '★');
      if (reports) stat.push(reports + ' báo lỗi');
      if (flags) stat.push(flags + ' flag');

      return '<section class="fbx-group">' +
        '<header class="fbx-group__head">' +
          '<span class="fbx-group__skill fbx-skill--' + esc(g.skill) + '">' + esc((g.skill || '').toUpperCase()) + '</span>' +
          '<span class="fbx-group__id">' + esc(g.test_id || '(không rõ đề)') + '</span>' +
          '<span class="fbx-group__stat">' + esc(stat.join(' · ')) + '</span>' +
          (news ? '<span class="fbx-group__new"><span class="fbx-dot" aria-hidden="true"></span>' + news + ' mới</span>' : '') +
        '</header>' +
        g.items.map(renderRow).join('') +
      '</section>';
    }).join('');

    wireRows();
  }

  function renderRow(r) {
    var resolved = r.status === 'resolved';
    var tagCls = r.type === 'rating' ? 'is-rating' : 'is-flag';   // report+flag share terracotta
    var loc = (r.test_id || '(không rõ đề)') + (r.q_num != null ? ' · Câu ' + r.q_num : '');
    var href = deepLink(r);

    var bodyParts = [];
    if (r.type === 'rating') {
      var rb = [];
      if (r.rating_de != null) rb.push('Đề ' + stars(r.rating_de));
      if (r.rating_audio != null) rb.push('Audio ' + stars(r.rating_audio));
      bodyParts.push(rb.join(' · '));
    } else if (r.type === 'report' && r.category) {
      bodyParts.push('<b>' + esc(CATEGORY_LABEL[r.category] || r.category) + '</b>');
    }
    if (r.note) bodyParts.push('“' + esc(r.note) + '”');

    var locHtml = href
      ? '<a class="fbx-row__loc" href="' + esc(href) + '">' + esc(loc) + '</a>'
      : '<span class="fbx-row__loc">' + esc(loc) + '</span>';

    return '<div class="fbx-row' + (resolved ? ' is-resolved' : '') + '" data-id="' + esc(r.id) + '">' +
      '<span class="fbx-tag ' + tagCls + '">' + esc(TYPE_LABEL[r.type] || r.type) + '</span>' +
      '<div class="fbx-row__body">' +
        '<div class="fbx-row__main">' + locHtml +
          (bodyParts.length ? ' <span class="fbx-row__detail">' + bodyParts.join(' — ') + '</span>' : '') + '</div>' +
        '<div class="fbx-row__who">' + esc((r.skill || '')) + ' · ' + esc(who(r)) + ' · ' + esc(relTime(r.created_at)) + '</div>' +
      '</div>' +
      '<button type="button" class="fbx-status' + (resolved ? ' is-done' : '') + '" ' +
        'data-id="' + esc(r.id) + '" data-status="' + (resolved ? 'resolved' : 'new') + '">' +
        (resolved ? '✓ Đã xử lý' : 'Đánh dấu đã xử lý') + '</button>' +
    '</div>';
  }

  function wireRows() {
    $('fbx-groups').querySelectorAll('.fbx-status').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleStatus(btn.getAttribute('data-id'), btn.getAttribute('data-status'));
      });
    });
  }

  // ── status PATCH (optimistic + revert) ──────────────────────────────────────
  function toggleStatus(id, current) {
    var row = _all.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    var next = current === 'resolved' ? 'new' : 'resolved';
    var prev = row.status;
    row.status = next;                    // optimistic
    render();
    window.api.patch('/api/admin/feedback/' + encodeURIComponent(id), { status: next })
      .catch(function () {
        row.status = prev;                // revert
        render();
        banner('Không cập nhật được trạng thái, đã hoàn tác.', true);
      });
  }

  // ── load ────────────────────────────────────────────────────────────────────
  function load() {
    banner('');
    window.api.get('/api/admin/feedback')
      .then(function (d) {
        _all = (d && d.items) || [];
        render();
      })
      .catch(function (e) {
        $('fbx-loading').hidden = true;
        banner('Không tải được feedback: ' + ((e && e.message) || e), true);
      });
  }

  function wireFilters() {
    $('fbx-type').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]'); if (!b) return;
      _filter.type = b.getAttribute('data-type');
      $('fbx-type').querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      render();
    });
    $('fbx-skill').addEventListener('change', function () { _filter.skill = $('fbx-skill').value; render(); });
    $('fbx-status').addEventListener('change', function () { _filter.status = $('fbx-status').value; render(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireFilters(); load(); });
  } else { wireFilters(); load(); }

  // exposed for tests
  window.__adminFeedback = { rowMatchesFilters: rowMatchesFilters, groupByTest: groupByTest, deepLink: deepLink, avg: avg };
})();
