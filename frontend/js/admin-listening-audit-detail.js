/**
 * admin-listening-audit-detail.js — per-test audit + IN-PLACE editor.
 *
 * Loads GET /admin/listening/tests/{id}/audit (editor sections + live issues +
 * saved audit) and the audio signed URLs, then lets an admin FIX content
 * without re-importing:
 *   • transcript per section → PATCH /admin/listening/content/{content_id}
 *   • per question (prompt/answer/alternatives/solution/audio_window) →
 *     PATCH /admin/listening/exercises/{exercise_id}/questions/{q_num}
 *   • ▶ nghe → plays exactly the question's audio_window (segment mode)
 *   • Chạy audit đầy đủ → POST .../audit/run (structural + audio + LLM)
 *   • Lưu trạng thái → PATCH .../audit (reviewer status + notes)
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

  var STATE = { testId: null, data: null, issuesByQ: {}, audioUrl: null };

  function testIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('id') || '').trim() || null;
  }

  function indexIssues(issues) {
    var by = {};
    (issues || []).forEach(function (it) {
      if (it.resolved) return;
      var k = it.q_num == null ? '_test' : String(it.q_num);
      (by[k] = by[k] || []).push(it);
    });
    return by;
  }

  function issueChips(qnum) {
    var arr = STATE.issuesByQ[String(qnum)] || [];
    if (!arr.length) return '';
    return '<div class="ad-issues">' + arr.map(function (i) {
      var cls = i.severity === 'error' ? 'err' : 'warn';
      return '<span class="ad-pill ' + cls + '" title="' + esc(i.dimension) + '">' + esc(i.message) + '</span>';
    }).join('') + '</div>';
  }

  function healthPill(health) {
    var e = (health && health.error_count) || 0, w = (health && health.warning_count) || 0;
    var el = $('ad-health');
    el.className = 'ad-pill ' + (e ? 'err' : (w ? 'warn' : 'ok'));
    el.textContent = e ? (e + ' lỗi' + (w ? ' · ' + w + ' cảnh báo' : ''))
                       : (w ? (w + ' cảnh báo') : 'Sạch');
  }

  function qRow(sec, q) {
    var alt = (q.alternatives || []).join(', ');
    var w = q.audio_window || {};
    var hasErr = (STATE.issuesByQ[String(q.q_num)] || []).some(function (i) { return i.severity === 'error'; });
    return '' +
      '<div class="ad-q' + (hasErr ? ' has-err' : '') + '" data-ex="' + esc(q.exercise_id) + '" data-q="' + esc(q.q_num) + '">' +
        '<div class="ad-q-top">' +
          '<span class="ad-q-num">Câu ' + esc(q.q_num) + '</span>' +
          '<span class="ad-pill muted">' + esc(q.template_kind || '') + '</span>' +
          '<button class="ad-btn secondary mini" data-act="play"' + (w.start == null ? ' disabled' : '') + '>▶ nghe' +
            (w.start != null ? ' (' + Math.round(w.start) + '–' + Math.round(w.end) + 's)' : '') + '</button>' +
        '</div>' +
        issueChips(q.q_num) +
        '<div class="ad-field"><label>Prompt / câu hỏi</label>' +
          '<textarea data-f="prompt" rows="2">' + esc(q.prompt || '') + '</textarea></div>' +
        '<div class="ad-grid">' +
          '<div class="ad-field"><label>Đáp án</label><input data-f="answer" value="' + esc(q.answer || '') + '" /></div>' +
          '<div class="ad-field"><label>Alternatives (phẩy)</label><input data-f="alternatives" value="' + esc(alt) + '" /></div>' +
        '</div>' +
        '<div class="ad-field"><label>Bài giải (vì sao đúng)</label>' +
          '<textarea data-f="solution" rows="2">' + esc(q.solution || '') + '</textarea></div>' +
        '<div class="ad-win">' +
          '<div class="ad-field"><label>Window start (s)</label><input data-f="win_start" type="number" step="0.01" value="' + esc(w.start != null ? w.start : '') + '" /></div>' +
          '<div class="ad-field"><label>end (s)</label><input data-f="win_end" type="number" step="0.01" value="' + esc(w.end != null ? w.end : '') + '" /></div>' +
          '<button class="ad-btn mini" data-act="save">Lưu câu</button>' +
          '<span class="ad-note" data-role="q-status"></span>' +
        '</div>' +
      '</div>';
  }

  function sectionHtml(sec) {
    return '' +
      '<section class="ad-card" data-content="' + esc(sec.content_id) + '">' +
        '<div class="ad-section-title">Section ' + esc(sec.section_num) + '</div>' +
        '<div class="ad-field"><label>Transcript (bản đọc)</label>' +
          '<textarea class="ad-transcript" data-role="transcript">' + esc(sec.transcript || '') + '</textarea></div>' +
        '<div class="ad-toolbar"><button class="ad-btn secondary mini" data-act="save-transcript">Lưu transcript</button>' +
          '<span class="ad-note" data-role="tx-status"></span></div>' +
        (sec.questions || []).map(function (q) { return qRow(sec, q); }).join('') +
      '</section>';
  }

  function render() {
    var d = STATE.data;
    $('ad-title').textContent = d.title || d.test_id || 'Audit';
    $('ad-meta').textContent = (d.test_id || '') + ' · ' + (d.test_type || 'full') +
      ' · ' + d.question_count + ' câu · ' + d.section_count + ' section · status=' + (d.status || '');
    STATE.issuesByQ = indexIssues(d.live && d.live.issues);
    healthPill(d.live && d.live.health);
    if (d.saved) {
      if (d.saved.status) $('ad-status').value = d.saved.status;
      if (d.saved.notes) $('ad-notes').value = d.saved.notes;
    }
    $('ad-sections').innerHTML = (d.sections || []).map(sectionHtml).join('');
    wire();
  }

  // ── audio ─────────────────────────────────────────────────────────────────
  function playWindow(start, end) {
    var p = $('ad-player');
    if (!p || start == null) return;
    if (STATE.audioUrl && p.getAttribute('src') !== STATE.audioUrl) p.setAttribute('src', STATE.audioUrl);
    p.setAttribute('segment-start', String(start));
    p.setAttribute('segment-end', String(end));
    if (typeof p.seekTo === 'function') p.seekTo(Number(start));
    if (typeof p.play === 'function') { try { p.play(); } catch (e) {} }
  }

  // ── saves ───────────────────────────────────────────────────────────────
  async function saveQuestion(card) {
    var exId = card.getAttribute('data-ex');
    var qNum = card.getAttribute('data-q');
    var g = function (f) { return card.querySelector('[data-f="' + f + '"]'); };
    var body = {
      prompt:       g('prompt').value,
      answer:       g('answer').value,
      alternatives: g('alternatives').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      solution:     g('solution').value,
    };
    var s = g('win_start').value, e = g('win_end').value;
    if (s !== '' && e !== '') body.audio_window = { start: Number(s), end: Number(e) };
    var status = card.querySelector('[data-role="q-status"]');
    status.textContent = 'Đang lưu…';
    try {
      var res = await window.api.patch(
        '/admin/listening/exercises/' + encodeURIComponent(exId) + '/questions/' + encodeURIComponent(qNum), body);
      status.textContent = res.ok ? '✓ đã lưu' : '⚠ còn lỗi';
      // refresh this question's issue chips from the re-check
      STATE.issuesByQ[String(qNum)] = (res.issues || []).filter(function (i) { return !i.resolved; });
      var chips = card.querySelector('.ad-issues');
      var html = issueChips(qNum);
      if (chips) chips.outerHTML = html; else if (html) card.querySelector('.ad-q-top').insertAdjacentHTML('afterend', html);
      card.classList.toggle('has-err', !res.ok);
    } catch (err) {
      status.textContent = '✗ ' + ((err && err.message) || err);
    }
  }

  async function saveTranscript(sectionEl) {
    var contentId = sectionEl.getAttribute('data-content');
    var ta = sectionEl.querySelector('[data-role="transcript"]');
    var status = sectionEl.querySelector('[data-role="tx-status"]');
    status.textContent = 'Đang lưu…';
    try {
      await window.api.patch('/admin/listening/content/' + encodeURIComponent(contentId), { transcript: ta.value });
      status.textContent = '✓ đã lưu';
    } catch (err) {
      status.textContent = '✗ ' + ((err && err.message) || err);
    }
  }

  function wire() {
    $('ad-sections').querySelectorAll('[data-act="play"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.ad-q');
        playWindow(Number(card.querySelector('[data-f="win_start"]').value),
                   Number(card.querySelector('[data-f="win_end"]').value));
      });
    });
    $('ad-sections').querySelectorAll('[data-act="save"]').forEach(function (btn) {
      btn.addEventListener('click', function () { saveQuestion(btn.closest('.ad-q')); });
    });
    $('ad-sections').querySelectorAll('[data-act="save-transcript"]').forEach(function (btn) {
      btn.addEventListener('click', function () { saveTranscript(btn.closest('.ad-card')); });
    });
  }

  async function runFullAudit() {
    var btn = $('ad-run'); btn.disabled = true;
    $('ad-run-status').textContent = 'Đang chạy audit (gồm LLM)…';
    try {
      var res = await window.api.post('/admin/listening/tests/' + encodeURIComponent(STATE.testId) + '/audit/run', {});
      STATE.data.live = { issues: res.issues, health: res.health };
      STATE.data.saved = { status: res.status, notes: $('ad-notes').value };
      $('ad-run-status').textContent = '✓ xong · ' + (res.status);
      render();
    } catch (err) {
      $('ad-run-status').textContent = '✗ ' + ((err && err.message) || err);
    } finally { btn.disabled = false; }
  }

  async function saveTriage() {
    try {
      await window.api.patch('/admin/listening/tests/' + encodeURIComponent(STATE.testId) + '/audit',
        { status: $('ad-status').value, notes: $('ad-notes').value });
      $('ad-run-status').textContent = '✓ đã lưu trạng thái';
    } catch (err) {
      // 404 → chưa có bản audit; chạy audit trước.
      $('ad-run-status').textContent = '✗ ' + ((err && err.message) || err) + ' (chạy audit trước nếu chưa có).';
    }
  }

  async function load() {
    STATE.testId = testIdFromUrl();
    if (!STATE.testId) { $('ad-title').textContent = 'Thiếu ?id'; return; }
    try {
      STATE.data = await window.api.get('/admin/listening/tests/' + encodeURIComponent(STATE.testId) + '/audit');
      try {
        var urls = await window.api.get('/admin/listening/tests/' + encodeURIComponent(STATE.testId) + '/audio/signed-urls');
        STATE.audioUrl = (urls && (urls.assembled || urls.full)) ||
          (urls && urls.sections && urls.sections[0] && urls.sections[0].signed_url) || null;
        if (STATE.audioUrl) $('ad-player').setAttribute('src', STATE.audioUrl);
      } catch (e) { /* audio optional */ }
      render();
      $('ad-run').addEventListener('click', runFullAudit);
      $('ad-triage').addEventListener('click', saveTriage);
    } catch (err) {
      $('ad-title').textContent = 'Lỗi tải audit';
      var el = $('ad-error'); el.textContent = (err && err.message) || err; el.hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
