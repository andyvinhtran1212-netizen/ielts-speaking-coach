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
    return '' +
      '<tr>' +
      '<td class="dr-mono">' + esc(fmtDate(r.created_at)) + '</td>' +
      '<td class="dr-mono">' + esc(r.test_id_external || '—') + '</td>' +
      '<td>' + esc(r.section_title || ('Section ' + (r.section_num == null ? '?' : r.section_num))) + '</td>' +
      '<td>' + (r.correct_count || 0) + '/' + (r.total_sentences || 0) + '</td>' +
      '<td><span class="dr-acc ' + accClass(acc) + '">' + Math.round(acc * 100) + '%</span></td>' +
      '<td class="dr-mono">' + esc(fmtDur(r.total_time_seconds)) + '</td>' +
      '</tr>';
  }

  function load() {
    var testId = ($('dr-test-id').value || '').trim();
    var qs = testId ? ('?test_id=' + encodeURIComponent(testId)) : '';
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
    }).catch(function (e) {
      $('dr-loading').hidden = true;
      $('dr-error').hidden = false;
      $('dr-error').textContent = 'Không tải được báo cáo: ' + ((e && e.message) || e);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('dr-apply').addEventListener('click', load);
    $('dr-test-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    load();
  });
})();
