/**
 * admin-listening-attempts.js — Lượt làm bài nghe của học viên.
 *
 * Audit 2026-07-17 (AUDIT_LISTENING_ACTIVITY_REPORTING): listening_test_attempts
 * giữ toàn bộ hoạt động (lesson/mini · drill · full) nhưng admin không có mặt
 * đọc nào. Trang này list GET /admin/listening/attempts (filter học viên/bài/
 * loại/trạng thái, phân trang) và drill-down GET .../attempts/{id} — chi tiết
 * từng câu: học viên trả lời gì, đáp án, trap caught/missed.
 */

(function () {
  'use strict';

  var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var LIMIT = 50;
  var offset = 0;
  var total = 0;

  function esc(s) {
    return (window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDur(sec) {
    if (sec == null) return '—';
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m ? (m + 'm ' + s + 's') : (s + 's');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
  }

  var ST_LABEL = { submitted: 'Đã nộp', in_progress: 'Đang làm', abandoned: 'Bỏ dở' };
  var TYPE_LABEL = { mini: 'Lesson/Mini', drill: 'Drill', full: 'Full test' };

  function accClass(a) { return a >= 0.85 ? 'ok' : (a >= 0.6 ? 'warn' : 'low'); }

  function scoreHtml(r) {
    if (r.score == null || !r.total_questions) return '<span class="la-mono">—</span>';
    var acc = r.accuracy || 0;
    return r.score + '/' + r.total_questions +
      ' <span class="la-acc ' + accClass(acc) + '">(' + Math.round(acc * 100) + '%)</span>';
  }

  function rowHtml(r) {
    var u = r.user || {}, t = r.test || {};
    return '' +
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="la-mono">' + esc(fmtDate(r.created_at)) + '</td>' +
      '<td class="la-user"><b>' + esc(u.display_name || '—') + '</b>' +
        '<span>' + esc(u.email || u.id || '') + '</span></td>' +
      '<td>' + esc(t.title || '—') +
        ' <span class="la-mono">' + esc(t.test_id || '') + '</span></td>' +
      '<td><span class="la-chip">' + esc(TYPE_LABEL[t.test_type] || t.test_type || '—') + '</span></td>' +
      '<td><span class="la-st ' + esc(r.status) + '">' + esc(ST_LABEL[r.status] || r.status) + '</span></td>' +
      '<td>' + scoreHtml(r) + '</td>' +
      '<td class="la-mono">' + esc(fmtDur(r.duration_seconds)) + '</td>' +
      '</tr>';
  }

  function qRow(d) {
    var ok = !!d.correct;
    var trap = d.trap_caught ? ' 🪤✓' : (d.trap_missed ? ' 🪤✗' : '');
    return '<tr class="' + (ok ? 'la-q-ok' : 'la-q-bad') + '">' +
      '<td>' + (ok ? '✓' : '✗') + '</td>' +
      '<td class="la-mono">' + (d.q_num == null ? '—' : d.q_num) + '</td>' +
      '<td>' + esc(d.user_answer == null || d.user_answer === '' ? '(bỏ trống)' : d.user_answer) + '</td>' +
      '<td>' + esc(d.expected == null ? '—' : d.expected) + esc(trap) + '</td>' +
      '</tr>';
  }

  function showDetail(id) {
    var box = $('la-detail');
    box.hidden = false;
    box.innerHTML = '<div class="la-note">Đang tải chi tiết…</div>';
    window.api.get('/admin/listening/attempts/' + encodeURIComponent(id)).then(function (r) {
      var u = r.user || {}, t = r.test || {};
      var gd = r.grading_details || [];
      var traps = (r.trap_analytics && r.trap_analytics.trap_mechanism) || {};
      box.innerHTML = '' +
        '<div style="display:flex;align-items:flex-start;gap:var(--av-space-2)">' +
          '<h2>' + esc(u.display_name || u.email || 'Học viên') + ' · ' + esc(t.title || t.test_id || '') + '</h2>' +
          '<button type="button" class="la-close" id="la-detail-x" aria-label="Đóng">×</button>' +
        '</div>' +
        '<div class="la-detail-meta">' +
          '<span>Trạng thái: <b class="la-st ' + esc(r.status) + '">' + esc(ST_LABEL[r.status] || r.status) + '</b></span>' +
          '<span>Điểm: <b>' + (r.score == null ? '—' : r.score + '/' + (r.total_questions || '?')) + '</b></span>' +
          (r.band_estimate != null ? '<span>Band ước lượng: <b>' + esc(r.band_estimate) + '</b></span>' : '') +
          '<span>Thời lượng: <b>' + esc(fmtDur(r.duration_seconds)) + '</b></span>' +
          (traps.caught != null ? '<span>Trap: <b>' + traps.caught + ' tránh được · ' + (traps.missed || 0) + ' dính</b></span>' : '') +
        '</div>' +
        (gd.length
          ? '<div class="la-table-wrap"><table class="la-table"><thead>' +
            '<tr><th></th><th>Câu</th><th>Học viên trả lời</th><th>Đáp án</th></tr></thead><tbody>' +
            gd.map(qRow).join('') + '</tbody></table></div>'
          : '<div class="la-note">Chưa nộp bài — không có chấm điểm từng câu.</div>');
      var x = $('la-detail-x');
      if (x) x.onclick = function () { box.hidden = true; box.innerHTML = ''; };
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (e) {
      box.innerHTML = '<div class="la-note">Không tải được chi tiết: ' + esc((e && e.message) || e) + '</div>';
    });
  }

  function qs() {
    var p = [];
    var u = ($('la-user').value || '').trim();
    var t = ($('la-test').value || '').trim();
    var ty = $('la-type').value;
    var st = $('la-status').value;
    if (u) p.push('user_query=' + encodeURIComponent(u));
    if (t) p.push('test_query=' + encodeURIComponent(t));
    if (ty) p.push('test_type=' + encodeURIComponent(ty));
    if (st) p.push('status=' + encodeURIComponent(st));
    p.push('limit=' + LIMIT);
    p.push('offset=' + offset);
    return '?' + p.join('&');
  }

  function renderPager() {
    var pager = $('la-pager');
    if (total <= LIMIT) { pager.hidden = true; return; }
    pager.hidden = false;
    var page = Math.floor(offset / LIMIT) + 1;
    var pages = Math.ceil(total / LIMIT);
    $('la-page').textContent = page + '/' + pages + ' · ' + total + ' lượt';
    $('la-prev').disabled = offset <= 0;
    $('la-next').disabled = offset + LIMIT >= total;
  }

  function load() {
    $('la-loading').hidden = false;
    $('la-wrap').hidden = true;
    $('la-empty').hidden = true;
    $('la-error').hidden = true;
    window.api.get('/admin/listening/attempts' + qs()).then(function (res) {
      var items = (res && res.items) || [];
      total = (res && res.total) || 0;
      $('la-loading').hidden = true;
      renderPager();
      if (!items.length) { $('la-empty').hidden = false; return; }
      $('la-rows').innerHTML = items.map(rowHtml).join('');
      $('la-wrap').hidden = false;
      Array.prototype.forEach.call($('la-rows').querySelectorAll('tr[data-id]'), function (tr) {
        tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-id')); });
      });
    }).catch(function (e) {
      $('la-loading').hidden = true;
      $('la-error').hidden = false;
      $('la-error').textContent = 'Không tải được danh sách: ' + ((e && e.message) || e);
    });
  }

  function applyFilters() { offset = 0; load(); }

  document.addEventListener('DOMContentLoaded', function () {
    // Cho phép trang khác deep-link sẵn bộ lọc học viên: ?user=<email/tên>
    try {
      var pre = new URLSearchParams(location.search).get('user');
      if (pre) $('la-user').value = pre;
    } catch (e) {}
    $('la-apply').addEventListener('click', applyFilters);
    ['la-user', 'la-test'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFilters(); });
    });
    $('la-type').addEventListener('change', applyFilters);
    $('la-status').addEventListener('change', applyFilters);
    $('la-prev').addEventListener('click', function () { offset = Math.max(0, offset - LIMIT); load(); });
    $('la-next').addEventListener('click', function () { offset += LIMIT; load(); });
    load();
  });
})();
