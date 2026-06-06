/* frontend/js/listening-review.js — listening-review-ui (Phase B).
 *
 * Post-submit chữa-bài for a listening full test, full-screen in the shared
 * exam chrome (.exam-chrome / .exam-split / .exam-palette). Left pane = the
 * section transcript; right pane = per-question review cards (verdict, your vs
 * correct answer, a 🔊 timestamp that replays JUST that answer's audio window,
 * and a solution accordion: skills · VN · vocab+IPA · paraphrase · traps ·
 * why-correct · script). A sticky <audio-player> (segment mode) does the
 * window replay: seek to start → play → auto-pause at end.
 *
 * Data: GET /api/reading… no — GET /api/listening/tests/attempts/{id}/review
 * (submitted-only; audio windows are full_test-absolute seconds). XSS-safe:
 * prose is escaped before any <strong>/<mark> is layered on.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { attemptId: null, data: null, section: null };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  // Escape first, THEN render **bold** / `code` — XSS-safe (#381 pattern).
  function formatProse(s) {
    var out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, function (_, t) { return '<code class="lr-code">' + t + '</code>'; });
    out = out.replace(/\*\*([^*]+)\*\*/g, function (_, t) { return '<strong>' + t + '</strong>'; });
    return out;
  }
  function _bulletList(text) {
    var items = String(text).split(/\n+|;\s+/).map(function (s) { return s.trim().replace(/^[-•]\s*/, ''); })
      .filter(Boolean);
    if (!items.length) return '';
    return '<ul class="lr-sol__bullets">' +
      items.map(function (s) { return '<li>' + formatProse(s) + '</li>'; }).join('') + '</ul>';
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('lr-content').hidden    = name !== 'ready';
    $('lr-palette').hidden    = name !== 'ready';
    $('lr-player-bar').hidden = name !== 'ready';
  }
  function showError(msg) { var el = $('error-msg'); if (el) el.textContent = msg; showState('error'); }
  function attemptIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('attempt_id') || '').trim() || null;
  }

  // ── Sticky audio player — window replay ───────────────────────────
  // Drives the shared <audio-player> segment mode: set [segment-start,
  // segment-end] (full_test-absolute seconds from the question's audio_window),
  // rewind to start, then play — the component auto-pauses at segment-end.
  function playWindow(win) {
    var player = $('lr-player');
    if (!player || !win) return;
    player.setAttribute('segment-start', String(win.start));
    player.setAttribute('segment-end', String(win.end));
    if (typeof player.reset === 'function') player.reset();   // seek to segment start
    if (typeof player.play === 'function') player.play();     // play → auto-pause at end
    var lbl = $('lr-player-label');
    if (lbl) lbl.textContent = '🔊 Đang phát ' + (win.section ? win.section + ' · ' : '') +
      clock(win.start) + '–' + clock(win.end);
  }

  // ── Section transcript pane ───────────────────────────────────────
  function renderSectionTabs(sections) {
    var host = $('lr-section-tabs'); host.innerHTML = '';
    sections.forEach(function (sec) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lr-section-tab' + (sec.section_num === SESSION.section ? ' is-active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('data-section', String(sec.section_num));
      b.textContent = 'Section ' + sec.section_num;
      b.addEventListener('click', function () { selectSection(sec.section_num); });
      host.appendChild(b);
    });
  }
  function selectSection(num) {
    SESSION.section = num;
    var sec = (SESSION.data.sections || []).filter(function (s) { return s.section_num === num; })[0] || {};
    $('lr-transcript-title').textContent = sec.theme
      ? ('Section ' + num + ' — ' + sec.theme) : ('Section ' + num);
    var body = $('lr-transcript-body');
    // transcript is plain text — render paragraphs via textContent (XSS-safe)
    body.innerHTML = '';
    String(sec.transcript || '').split(/\n\s*\n/).forEach(function (para) {
      var t = para.trim(); if (!t) return;
      var p = document.createElement('p'); p.textContent = t; body.appendChild(p);
    });
    renderSectionTabs(SESSION.data.sections || []);
  }

  // ── Per-question review cards ─────────────────────────────────────
  var _SKILL_NOTE = '';   // skills are stored as codes (K1…); shown verbatim

  function _solSection(label, html, mod) {
    if (!html) return '';
    return '<div class="lr-sol__sec' + (mod ? ' lr-sol__sec--' + mod : '') + '">' +
      '<div class="lr-sol__label">' + escapeHtml(label) + '</div>' +
      '<div class="lr-sol__text">' + html + '</div></div>';
  }

  function renderCard(item) {
    var card = document.createElement('article');
    card.className = 'lr-card ' + (item.correct ? 'is-correct' : 'is-incorrect');
    card.setAttribute('data-q', String(item.q_num));

    var win = item.audio_window;
    var tsLabel = win
      ? ((win.section ? win.section + ' · ' : '') + clock(win.start) + '–' + clock(win.end))
      : '';
    var tsBtn = win
      ? '<button type="button" class="lr-card__ts" data-action="play">🔊 ' + escapeHtml(tsLabel) + '</button>'
      : '';

    var sol = item.solution || {};
    var detail =
      _solSection('Kĩ năng', sol.skills ? escapeHtml(sol.skills) : '') +
      _solSection('Dịch đoạn chứa đáp án', sol.translation_vi ? formatProse(sol.translation_vi) : '') +
      _solSection('Từ vựng', sol.vocab_focus ? _bulletList(sol.vocab_focus) : (sol.vocab ? _bulletList(sol.vocab) : '')) +
      _solSection('Paraphrase', sol.paraphrase ? formatProse(sol.paraphrase) : '') +
      _solSection('Vì sao đúng', sol.why_correct ? formatProse(sol.why_correct) : '') +
      _solSection('Script', sol.script ? formatProse(sol.script) : '', 'script') +
      _solSection('Bẫy', sol.trap ? formatProse(sol.trap) : '', 'trap');

    card.innerHTML =
      '<div class="lr-card__top" role="button" tabindex="0" aria-expanded="false">' +
        '<span class="lr-card__num">Câu ' + item.q_num + '</span>' +
        '<span class="lr-card__verdict">' + (item.correct ? '✓ Đúng' : '✗ Sai') + '</span>' +
        '<span class="lr-card__toggle">Lời giải ▸</span>' +
      '</div>' +
      (item.prompt ? '<div class="lr-card__prompt">' + escapeHtml(item.prompt) + '</div>' : '') +
      '<div class="lr-card__answers">' +
        '<div class="lr-card__ans is-user"><span>Bạn:</span> <code>' + escapeHtml(item.user_answer || '—') + '</code></div>' +
        '<div class="lr-card__ans is-correct"><span>Đáp án:</span> <code>' + escapeHtml(item.expected || '') + '</code></div>' +
      '</div>' +
      (tsBtn ? '<div class="lr-card__tsrow">' + tsBtn + '</div>' : '') +
      '<div class="lr-card__detail" hidden>' + (detail || '<p class="lr-sol__empty">Chưa có lời giải chi tiết.</p>') + '</div>';

    // wire: timestamp → window replay
    var ts = card.querySelector('[data-action="play"]');
    if (ts) ts.addEventListener('click', function (e) { e.stopPropagation(); playWindow(win); });
    // wire: expand/collapse solution
    var top = card.querySelector('.lr-card__top');
    var det = card.querySelector('.lr-card__detail');
    function toggle() {
      var open = det.hidden;
      det.hidden = !open;
      top.setAttribute('aria-expanded', open ? 'true' : 'false');
      card.classList.toggle('is-open', open);
    }
    top.addEventListener('click', toggle);
    top.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    return card;
  }

  function renderReview(items) {
    var host = $('lr-review'); host.innerHTML = '';
    items.forEach(function (it) { host.appendChild(renderCard(it)); });
  }

  function jumpToQ(qNum) {
    var card = document.querySelector('.lr-card[data-q="' + qNum + '"]');
    if (!card) return;
    document.querySelectorAll('.lr-nav-q').forEach(function (b) { b.classList.remove('is-current'); });
    var btn = document.querySelector('.lr-nav-q[data-q="' + qNum + '"]');
    if (btn) btn.classList.add('is-current');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var det = card.querySelector('.lr-card__detail');
    if (det && det.hidden) card.querySelector('.lr-card__top').click();
  }

  // ── Palette: 40 Qs grouped by section (4 groups) ──────────────────
  function renderPalette(items) {
    var grid = $('lr-nav-grid'); grid.innerHTML = '';
    var bySection = {};
    items.forEach(function (it) {
      var s = (it.section) || ('S' + (Math.floor((it.q_num - 1) / 10) + 1));
      (bySection[s] = bySection[s] || []).push(it);
    });
    Object.keys(bySection).sort().forEach(function (s) {
      var group = document.createElement('div');
      group.className = 'exam-palette__group';
      var label = document.createElement('span');
      label.className = 'exam-palette__group-label';
      label.textContent = s;
      group.appendChild(label);
      bySection[s].forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'exam-palette__q lr-nav-q ' + (it.correct ? 'is-correct' : 'is-incorrect');
        b.setAttribute('data-q', String(it.q_num));
        b.textContent = String(it.q_num);
        b.addEventListener('click', function () { jumpToQ(it.q_num); });
        group.appendChild(b);
      });
      grid.appendChild(group);
    });
  }

  function renderSummary(d) {
    $('lr-test-label').textContent = d.title || 'Chữa bài';
    var band = (d.band_estimate != null) ? Number(d.band_estimate).toFixed(1) : '—';
    $('lr-summary').textContent = 'Band ' + band + ' · ' +
      (d.score != null ? d.score : '?') + '/' + (d.max_score || 40);
  }

  function render(d) {
    SESSION.data = d;
    renderSummary(d);
    var player = $('lr-player');
    if (player && d.audio_url) player.setAttribute('src', d.audio_url);
    SESSION.section = (d.sections && d.sections[0] && d.sections[0].section_num) || 1;
    selectSection(SESSION.section);
    renderReview(d.review || []);
    renderPalette(d.review || []);
    showState('ready');
  }

  function load(attemptId) {
    showState('loading');
    SESSION.attemptId = attemptId;
    window.api.get('/api/listening/tests/attempts/' + encodeURIComponent(attemptId) + '/review')
      .then(function (d) {
        if (!d || !(d.review || []).length) { showState('empty'); return; }
        render(d);
      })
      .catch(function (e) {
        if (e && e.status === 409) showError('Bài làm này chưa nộp — chưa có chữa bài.');
        else if (e && e.status === 403) showError('Bài làm này không thuộc tài khoản của bạn.');
        else if (e && e.status === 404) showState('empty');
        else showError('Không tải được chữa bài. ' + (e && e.message ? e.message : ''));
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var id = attemptIdFromUrl();
    if (!id) { showState('empty'); return; }
    load(id);
  });
})();
