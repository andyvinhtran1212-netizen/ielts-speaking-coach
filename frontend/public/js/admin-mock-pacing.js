/*
 * admin-mock-pacing.js — how one student SPENT a mock exam.
 *
 * Built entirely from `answered_at` stamps the platform has always written and
 * nobody has ever read: the order answers actually landed in, the pauses
 * between them, rushed finishes, and where the work stopped.
 *
 * The caveats are rendered as prominently as the numbers on purpose. These
 * figures LOOK more precise than they are — answered_at is the LAST touch of a
 * question, so a gap brackets think-time rather than being it. A teacher acting
 * on "8 phút cho câu 12" when the data cannot support that claim is worse off
 * than with no chart at all.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var LABEL = { listening: '🎧 Listening', reading: '📖 Reading', writing: '✍️ Writing' };
  // Bars are capped so one long break doesn't flatten the rest of the exam
  // into an unreadable baseline.
  var GAP_CAP_SECONDS = 240;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }

  function show(name) {
    ['loading', 'error', 'content'].forEach(function (s) {
      el('state-' + s).classList.toggle('hidden', s !== name);
    });
  }

  function mmss(secs) {
    if (secs == null) return '—';
    var s = Math.max(0, Math.round(secs));
    var m = Math.floor(s / 60), r = s % 60;
    return m + 'p' + (r < 10 ? '0' : '') + r + 's';
  }
  function hhmm(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function kpi(k, n, warn) {
    return '<div><span class="mp-kpi__k">' + esc(k) + '</span>' +
      '<span class="mp-kpi__n' + (warn ? ' mp-kpi__n--warn' : '') + '">' + esc(n) + '</span></div>';
  }

  function renderLR(key, d) {
    if (!d) return '';
    var tl = d.timeline || [];
    // A CLEARED FIELD IS ACTIVITY, NOT AN ANSWER. The backend deliberately keeps
    // timestamped clears in the timeline (they move the last-touch time, close a
    // gap and shorten the idle tail), but drawing them as answer bars claimed an
    // answer landed — contradicting both the "Đã trả lời" and final-minutes KPIs
    // and giving the teacher a false answer sequence (Codex review, PR #848).
    var cleared = tl.filter(function (r) { return r.is_answered === false; }).length;
    var bars = tl.length
      ? '<div class="mp-strip">' + tl.map(function (r) {
          var g = r.gap_seconds == null ? 0 : Math.min(r.gap_seconds, GAP_CAP_SECONDS);
          var h = Math.max(3, Math.round((g / GAP_CAP_SECONDS) * 80));
          var isLong = r.gap_seconds && r.gap_seconds >= 90;
          var isClear = r.is_answered === false;
          return '<div class="mp-bar' + (isLong ? ' is-long' : '') +
            (isClear ? ' is-cleared' : '') + '" style="height:' + h + 'px" ' +
            'title="Câu ' + esc(r.q_num) + ' — ' + (isClear ? 'XOÁ ô' : 'lưu đáp án') +
            ' lúc ' + esc(hhmm(r.at)) +
            ', cách lần trước ' + esc(mmss(r.gap_seconds)) + '">' +
            '<span class="mp-bar__q">' + esc(r.q_num) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="mp-striplegend">Mỗi cột = một lần lưu, xếp theo <b>thứ tự về máy chủ</b>. ' +
        'Cột càng cao = càng lâu mới có lần lưu tiếp theo; cột <span style="color:var(--av-warning)">vàng</span> = nghỉ trên 90 giây' +
        (cleared ? '; cột <span class="mp-bar__legendclear">gạch chéo</span> = học viên XOÁ ô (không phải đáp án)' : '') +
        '.</p>'
      : '<p class="mp-empty">Không có đáp án nào được lưu — không có gì để dựng lại nhịp làm bài.</p>';

    return '<section class="mp-sec">' +
      '<div class="mp-sec__h"><span class="mp-sec__t">' + esc(LABEL[key] || key) + '</span>' +
        '<span class="mp-muted">' + esc(hhmm(d.started_at)) + ' → ' + esc(hhmm(d.ended_at)) + '</span></div>' +
      '<div class="mp-kpis">' +
        kpi('Đã trả lời', (d.answered == null ? '—' : d.answered) + (d.total ? '/' + d.total : '')) +
        // null = no timestamped answers at all, so the order is UNKNOWN. It
        // used to render "Có" beside its own "không có đáp án nào" message.
        kpi('Làm theo thứ tự đề',
            d.worked_in_paper_order == null ? '—' : (d.worked_in_paper_order ? 'Có' : 'Không')) +
        kpi('Lần nghỉ dài', (d.long_gaps || []).length, (d.long_gaps || []).length > 0) +
        kpi('Đáp án 5 phút cuối', d.answers_in_final_minutes == null ? '—' : d.answers_in_final_minutes,
            d.answers_in_final_minutes > 5) +
        kpi('Ngừng làm sớm', mmss(d.idle_tail_seconds), d.idle_tail_seconds > 300) +
      '</div>' + bars +
    '</section>';
  }

  function renderWriting(d) {
    if (!d) return '';
    var tasks = (d.tasks || []).map(function (t) {
      return '<div>' + kpi(t.task === 'task1' ? 'Task 1 — số từ' : 'Task 2 — số từ',
        t.word_count == null ? '—' : t.word_count) +
        '<span class="mp-muted">lưu lần cuối ' + esc(hhmm(t.last_saved_at)) + '</span></div>';
    }).join('');
    return '<section class="mp-sec">' +
      '<div class="mp-sec__h"><span class="mp-sec__t">' + esc(LABEL.writing) + '</span>' +
        '<span class="mp-muted">' + esc(hhmm(d.started_at)) + ' → ' + esc(hhmm(d.ended_at)) + '</span></div>' +
      '<div class="mp-kpis">' + tasks + '</div>' +
      '<p class="mp-striplegend">Writing không có mốc theo từng câu. Số từ và giờ lưu cuối đến từ bản nháp tự lưu.</p>' +
    '</section>';
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    var sitting = new URLSearchParams(location.search).get('sitting');
    if (!sitting) {
      el('state-error').textContent = 'Thiếu ?sitting=<id>.';
      show('error'); return;
    }
    var d;
    try {
      d = await window.api.get('/admin/mock-exams/sittings/' + encodeURIComponent(sitting) + '/pacing');
    } catch (e) {
      el('state-error').textContent = 'Không tải được nhịp làm bài: ' + (e && e.message ? e.message : e);
      show('error'); return;
    }

    // Return to the SAME classroom. Without the exam id the live console falls
    // back to the first published exam, silently switching which class the
    // invigilator is monitoring after a normal round trip.
    var back = document.querySelector('a[href="/pages/admin/mock-live/index.html"]');
    if (back && d.exam_id) back.href += '?exam_id=' + encodeURIComponent(d.exam_id);

    el('head').innerHTML =
      '<span class="mp-name">' + esc(d.student_name) + '</span>' +
      '<span class="mp-code">' + esc(d.exam_code || '') + '</span>' +
      '<span class="mp-muted">' + esc(d.status || '') + '</span>';

    // Straight from the payload's own caveats — the UI is not allowed to be
    // more confident than the data.
    el('caveat').innerHTML =
      '<b>Đọc số liệu này thế nào.</b> Mỗi đáp án chỉ lưu <b>thời điểm sửa cuối cùng</b>, không lưu ' +
      'lịch sử. Vì vậy khoảng cách giữa hai cột là <b>thời gian từ đáp án trước tới đáp án này</b> — ' +
      'nó <i>khoanh vùng</i> thời gian suy nghĩ chứ không phải chính nó. Học viên quay lại sửa một câu cũ ' +
      'sẽ hiện ra dưới dạng "không làm theo thứ tự đề", không phải một số lần sửa. ' +
      'Và học viên không trả lời gì thì không để lại dấu vết nào — vắng dữ liệu không có nghĩa là vắng nỗ lực.';

    el('sections').innerHTML =
      renderLR('listening', d.sections.listening) +
      renderLR('reading', d.sections.reading) +
      renderWriting(d.sections.writing);
    show('content');
  }
  boot();
})();
