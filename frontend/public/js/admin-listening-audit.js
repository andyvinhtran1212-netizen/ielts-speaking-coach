/**
 * admin-listening-audit.js — Listening content-audit DASHBOARD.
 *
 * Lists every listening test and runs the fast structural + audio-bounds audit
 * (GET /admin/listening/tests/{id}/audit) for each so admins see health at a
 * glance, plus the last saved audit status (pending/passed/has_issues/fixed).
 * "Mở audit" → audit-detail.html?id=<uuid> where content is verified + fixed in
 * place (no re-import).
 */

(function () {
  'use strict';

  var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return (window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var SAVED_LABEL = {
    pending:    ['Chưa audit', 'muted'],
    passed:     ['Đạt', 'ok'],
    has_issues: ['Có lỗi', 'err'],
    fixed:      ['Đã sửa', 'ok'],
  };

  function healthPill(live) {
    var h = (live && live.health) || {};
    var e = h.error_count || 0, w = h.warning_count || 0;
    if (e) return '<span class="au-pill err">' + e + ' lỗi' + (w ? ' · ' + w + ' cảnh báo' : '') + '</span>';
    if (w) return '<span class="au-pill warn">' + w + ' cảnh báo</span>';
    return '<span class="au-pill ok">Sạch</span>';
  }

  function savedPill(saved) {
    var st = (saved && saved.status) || 'pending';
    var pair = SAVED_LABEL[st] || SAVED_LABEL.pending;
    return '<span class="au-pill ' + pair[1] + '">' + esc(pair[0]) + '</span>';
  }

  function rowHtml(item, audit) {
    var type = (audit && audit.test_type) || 'full';
    return '' +
      '<tr>' +
      '<td class="au-mono">' + esc(item.test_id || '') + '</td>' +
      '<td>' + esc(type) + '</td>' +
      '<td>' + esc(audit ? audit.question_count : '—') + '</td>' +
      '<td>' + (audit ? healthPill(audit.live) : '<span class="au-pill muted">?</span>') + '</td>' +
      '<td>' + (audit ? savedPill(audit.saved) : '<span class="au-pill muted">—</span>') + '</td>' +
      '<td><a class="au-open" href="/pages/admin/listening/audit-detail.html?id=' +
        encodeURIComponent(item.id) + '">Mở audit →</a></td>' +
      '</tr>';
  }

  // ── Paging + bounded concurrency ─────────────────────────────────────────

  var PAGE_LIMIT = 100;    // the endpoint's own cap
  var MAX_PAGES  = 30;     // runaway guard; 3000 rows is far beyond any library

  async function fetchAllTests() {
    var all = [];
    for (var page = 0; page < MAX_PAGES; page += 1) {
      var res = await window.api.get(
        '/admin/listening/tests?status=all&limit=' + PAGE_LIMIT
        + '&offset=' + (page * PAGE_LIMIT));
      var items = (res && res.items) || [];
      all = all.concat(items);
      var total = (res && res.total) || 0;
      if (items.length < PAGE_LIMIT || all.length >= total) return all;
    }
    // Hit the guard: say so rather than quietly presenting a partial audit as
    // if it covered everything.
    console.warn('[audit] dừng ở ' + all.length + ' bài (chạm trần phân trang)');
    return all;
  }

  async function mapBatched(items, size, fn) {
    var out = [];
    for (var i = 0; i < items.length; i += size) {
      out = out.concat(await Promise.all(items.slice(i, i + size).map(fn)));
    }
    return out;
  }

  async function load() {
    try {
      // All tests (any status) — audit applies to drafts + published alike.
      //
      // PAGED, not one fixed grab. The list endpoint caps `limit` at 100 and
      // orders newest-first, so a single page silently dropped every older
      // full/mini/drill test the moment the generated practice bank grew past
      // 100 rows — on a dashboard whose whole promise is "every test".
      var items = await fetchAllTests();
      // Fast per-test audit (structural only, no LLM). Batched rather than one
      // Promise.all over the whole list: that used to mean 100 concurrent
      // requests and now would mean as many as the bank has.
      var audits = await mapBatched(items, 8, function (it) {
        return window.api.get('/admin/listening/tests/' + encodeURIComponent(it.id) + '/audit')
          .catch(function () { return null; });
      });
      var rows = items.map(function (it, i) { return rowHtml(it, audits[i]); }).join('');
      $('au-rows').innerHTML = rows || '<tr><td colspan="6" class="au-note">Chưa có test nào.</td></tr>';
      $('au-loading').hidden = true;
      $('au-wrap').hidden = false;
    } catch (e) {
      $('au-loading').hidden = true;
      var err = $('au-error');
      err.textContent = 'Không tải được danh sách audit: ' + ((e && e.message) || e);
      err.hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
