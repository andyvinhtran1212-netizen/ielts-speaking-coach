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

  async function load() {
    try {
      // All tests (any status) — audit applies to drafts + published alike.
      var res = await window.api.get('/admin/listening/tests?status=all&limit=100');
      var items = (res && res.items) || [];
      // Fast per-test audit in parallel (structural only, no LLM).
      var audits = await Promise.all(items.map(function (it) {
        return window.api.get('/admin/listening/tests/' + encodeURIComponent(it.id) + '/audit')
          .catch(function () { return null; });
      }));
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
