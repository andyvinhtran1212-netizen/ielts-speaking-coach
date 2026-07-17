/**
 * admin-listening-dictation-reports.js — Dictation ("chép chính tả") reports.
 *
 * Lists learner dictation sessions (GET /admin/listening/dictation-reports) and
 * per-test analytics (…/aggregate): mean accuracy + the words most often missed
 * or typed wrong, so admins can spot weak / ambiguous content. Content-error
 * flags live in the shared /admin/feedback inbox (reused, not duplicated here).
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

  function accClass(a) { return a >= 0.85 ? 'ok' : (a >= 0.6 ? 'warn' : 'low'); }

  function wordChips(arr, key) {
    if (!arr || !arr.length) return '<span class="dr-word" style="color:var(--av-text-muted)">—</span>';
    return arr.map(function (w) {
      return '<span class="dr-word">' + esc(w[key]) + '<b>' + (w.count || 0) + '</b></span>';
    }).join('');
  }

  function renderAggregate(agg) {
    $('dr-agg').innerHTML = '' +
      '<div class="dr-agg-tile"><span class="dr-agg-label">Số phiên</span>' +
        '<span class="dr-agg-value">' + (agg.session_count || 0) + '</span></div>' +
      '<div class="dr-agg-tile"><span class="dr-agg-label">Chính xác TB</span>' +
        '<span class="dr-agg-value">' + Math.round((agg.mean_accuracy || 0) * 100) + '%</span></div>';
    $('dr-agg-words').innerHTML = '' +
      '<div class="dr-card" style="margin-top:var(--av-space-3)"><h2>Từ hay bỏ sót</h2>' +
        '<div class="dr-words">' + wordChips(agg.top_missed, 'word') + '</div></div>' +
      '<div class="dr-card" style="margin-top:var(--av-space-3)"><h2>Từ hay viết sai</h2>' +
        '<div class="dr-words">' + wordChips(agg.top_wrong, 'expected') + '</div></div>';
  }

  function rowHtml(r) {
    var acc = r.accuracy || 0;
    var u = r.user || {};
    return '' +
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="dr-mono">' + esc(fmtDate(r.created_at)) + '</td>' +
      '<td class="dr-user"><b>' + esc(u.display_name || '—') + '</b>' +
        '<span>' + esc(u.email || u.id || '') + '</span></td>' +
      '<td class="dr-mono">' + esc(r.test_id_external || '—') + '</td>' +
      '<td>' + esc(r.section_title || ('Section ' + (r.section_num == null ? '?' : r.section_num))) + '</td>' +
      '<td>' + (r.correct_count || 0) + '/' + (r.total_sentences || 0) + '</td>' +
      '<td><span class="dr-acc ' + accClass(acc) + '">' + Math.round(acc * 100) + '%</span></td>' +
      '<td class="dr-mono">' + esc(fmtDur(r.total_time_seconds)) + '</td>' +
      '</tr>';
  }

  function load() {
    var testId = ($('dr-test-id').value || '').trim();
    var userQ = ($('dr-user').value || '').trim();
    var parts = [];
    if (testId) parts.push('test_id=' + encodeURIComponent(testId));
    if (userQ) parts.push('user_query=' + encodeURIComponent(userQ));
    var qs = parts.length ? ('?' + parts.join('&')) : '';
    $('dr-loading').hidden = false;
    $('dr-wrap').hidden = true;
    $('dr-empty').hidden = true;
    $('dr-error').hidden = true;
    $('dr-agg-scope').textContent = testId ? ('· ' + testId) : '· tất cả';

    Promise.all([
      window.api.get('/admin/listening/dictation-reports/aggregate' + qs),
      window.api.get('/admin/listening/dictation-reports' + (qs ? qs + '&' : '?') + 'limit=100'),
    ]).then(function (res) {
      renderAggregate(res[0] || {});
      var items = (res[1] && res[1].items) || [];
      $('dr-loading').hidden = true;
      if (!items.length) { $('dr-empty').hidden = false; return; }
      $('dr-rows').innerHTML = items.map(rowHtml).join('');
      $('dr-wrap').hidden = false;
      Array.prototype.forEach.call($('dr-rows').querySelectorAll('tr[data-id]'), function (tr) {
        tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-id')); });
      });
    }).catch(function (e) {
      $('dr-loading').hidden = true;
      $('dr-error').hidden = false;
      $('dr-error').textContent = 'Không tải được báo cáo: ' + ((e && e.message) || e);
    });
  }

  function sentenceRow(s) {
    var pct = Math.round((s.score || 0) * 100);
    var ops = s.ops || {};
    var errs = [];
    if (ops.miss) errs.push('sót ' + ops.miss);
    if (ops.wrong) errs.push('sai ' + ops.wrong);
    if (ops.extra) errs.push('thừa ' + ops.extra);
    return '<tr>' +
      '<td class="dr-mono">' + ((s.sentence_idx == null ? 0 : s.sentence_idx) + 1) + '</td>' +
      '<td><span class="dr-acc ' + accClass(s.score || 0) + '">' + pct + '%</span></td>' +
      '<td>' + esc(s.user_text || '(bỏ trống)') + '</td>' +
      '<td class="dr-mono">' + (s.listen_count == null ? '—' : s.listen_count + '×') + '</td>' +
      '<td class="dr-mono">' + esc(fmtDur(s.time_seconds)) + '</td>' +
      '<td class="dr-mono">' + esc(errs.join(' · ') || '—') + '</td>' +
      '</tr>';
  }

  function showDetail(id) {
    var box = $('dr-detail');
    box.hidden = false;
    box.innerHTML = '<div class="dr-note">Đang tải chi tiết phiên…</div>';
    window.api.get('/admin/listening/dictation-reports/' + encodeURIComponent(id)).then(function (r) {
      var results = r.results || [];
      box.innerHTML = '' +
        '<div style="display:flex;align-items:flex-start;gap:var(--av-space-2)">' +
          '<h2>Phiên ' + esc(r.test_id_external || '') + ' · ' +
            esc(r.section_title || ('Section ' + (r.section_num == null ? '?' : r.section_num))) + '</h2>' +
          '<button type="button" class="dr-close" id="dr-detail-x" aria-label="Đóng">×</button>' +
        '</div>' +
        '<div class="dr-mono">' + esc(fmtDate(r.completed_at || r.created_at)) +
          ' · đúng ' + (r.correct_count || 0) + '/' + (r.total_sentences || 0) +
          ' · ' + Math.round((r.accuracy || 0) * 100) + '%' +
          ' · ' + esc(fmtDur(r.total_time_seconds)) + '</div>' +
        (results.length
          ? '<div class="dr-table-wrap"><table class="dr-table"><thead>' +
            '<tr><th>Câu</th><th>Điểm</th><th>Học viên gõ</th><th>Nghe</th><th>Thời gian</th><th>Lỗi</th></tr>' +
            '</thead><tbody>' + results.map(sentenceRow).join('') + '</tbody></table></div>'
          : '<div class="dr-note">Phiên không có chi tiết từng câu.</div>');
      var x = $('dr-detail-x');
      if (x) x.onclick = function () { box.hidden = true; box.innerHTML = ''; };
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (e) {
      box.innerHTML = '<div class="dr-note">Không tải được chi tiết: ' + esc((e && e.message) || e) + '</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('dr-apply').addEventListener('click', load);
    $('dr-test-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    $('dr-user').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    load();
  });
})();
