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
  function hasVietnamese(s) {
    return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(s || '');
  }

  // ── TTS markup transform (item 3) — content stays in the data; we transform
  // it for display. Speaker code → readable label; [stress:x] → emphasis (the
  // answer word — a learning signal); [emotion]/[breath]/[chuckle]/[pause]/…
  // directives + ``` fences → hidden. XSS-safe (escape, then layer markup). ──
  var _ACCENT_VI = { bre: 'Anh', ame: 'Mỹ', use: 'Mỹ', us: 'Mỹ', ause: 'Úc',
                     aue: 'Úc', cae: 'Canada', ca: 'Canada' };
  function _speakerLabel(code) {
    // [M-AusE-30s-professional] → "Nam (Úc)" ; [F-BrE-20s] → "Nữ (Anh)"
    var m = /^\s*([MF])\s*-\s*([A-Za-z]+)/.exec(code || '');
    if (!m) return null;
    var who = m[1].toUpperCase() === 'F' ? 'Nữ' : 'Nam';
    var acc = _ACCENT_VI[m[2].toLowerCase().replace(/[^a-z]/g, '')];
    return who + (acc ? ' (' + acc + ')' : '');
  }
  function renderScript(raw) {
    var text = String(raw || '').replace(/```/g, '').trim();   // never show fences
    var out = [];
    text.split(/\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      // a line that is ONLY a [SPEAKER-CODE] → a speaker label
      var only = /^\[([^\]]+)\]$/.exec(line);
      if (only) {
        var lbl = _speakerLabel(only[1]);
        if (lbl) { out.push('<span class="lr-tx-speaker">' + escapeHtml(lbl) + '</span>'); return; }
      }
      var safe = escapeHtml(line);
      // [stress:word] → emphasised answer word
      safe = safe.replace(/\[stress:([^\]]+)\]/g, function (_, w) {
        return '<strong class="lr-stress">' + w.trim() + '</strong>';
      });
      // (Qn) marker → subtle anchor chip (kept — helps locate)
      safe = safe.replace(/\((Q\d+)\)/g, '<span class="lr-qmark">($1)</span>');
      // every other directive [emotion:…] [breath] [pause:1s] [hesitate] … → hide
      safe = safe.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
      if (safe) out.push('<span class="lr-tx-text">' + safe + '</span>');
    });
    return out.join(' ');
  }

  // ── "Vì sao đúng" de-walling (item 6): strip the raw `_(From answer key
  // notes):_` artifact, split EN vs VN blocks, bullet on list markers. ──
  function formatWhyCorrect(raw) {
    var text = String(raw || '').replace(/```/g, '')
      .replace(/_\(From answer key notes\):_/gi, '').trim();
    if (!text) return '';
    var paras = text.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    return paras.map(function (p) {
      var lang = hasVietnamese(p) ? 'vi' : 'en';
      var label = lang === 'vi' ? 'VN' : 'EN';
      var listItems = p.split(/\n+|(?:;\s+)/).map(function (s) {
        return s.trim().replace(/^[-•]\s*/, '');
      }).filter(Boolean);
      var inner = listItems.length > 1
        ? '<ul class="lr-sol__bullets">' + listItems.map(function (s) {
            return '<li>' + formatProse(s) + '</li>'; }).join('') + '</ul>'
        : formatProse(p);
      return '<div class="lr-why lr-why--' + lang + '">' +
        '<span class="lr-why__lang">' + label + '</span>' + inner + '</div>';
    }).join('');
  }

  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('lr-content').hidden    = name !== 'ready';
    $('lr-bottombar').hidden  = name !== 'ready';
  }
  function showError(msg) { var el = $('error-msg'); if (el) el.textContent = msg; showState('error'); }
  function attemptIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('attempt_id') || '').trim() || null;
  }

  // ── 🔊 locate — full-track seek + transcript highlight (items 4 + 7) ──
  // Item 4: the player keeps the WHOLE track (free scrub); 🔊 seeks to the
  // window start and plays on from there (no segment window, no auto-stop).
  // Item 7: it also jumps the transcript pane to that question's section, scrolls
  // to the script line, and highlights it (reading-review .src-hl behaviour).
  function locate(qNum, win) {
    var player = $('lr-player');
    if (player && win) {
      // full track: ensure no segment constraint, then seek + continue.
      player.removeAttribute('segment-start');
      player.removeAttribute('segment-end');
      if (typeof player.seekTo === 'function') player.seekTo(win.start);
      var lbl = $('lr-player-label');
      if (lbl) lbl.textContent = '🔊 Tua tới ' + (win.section ? win.section + ' · ' : '') +
        clock(win.start) + '–' + clock(win.end) + ' (phát tiếp toàn bài)';
    }
    // switch section + highlight the script line for this question
    var sec = win && win.section ? parseInt(String(win.section).replace(/\D/g, ''), 10) : null;
    if (sec && sec !== SESSION.section) selectSection(sec);
    highlightTranscriptLine(qNum);
  }

  function highlightTranscriptLine(qNum) {
    var body = $('lr-transcript-body');
    if (!body) return;
    body.querySelectorAll('.lr-src-hl').forEach(function (el) { el.classList.remove('lr-src-hl'); });
    var line = body.querySelector('.lr-tx-line[data-qs~="' + qNum + '"]');
    if (line) {
      line.classList.add('lr-src-hl');
      if (line.scrollIntoView) line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
  // Build the per-section transcript lines from each question's script extract,
  // DEDUPED (item 8a: Q7/Q8 share one turn → one line tagged data-qs="7 8"),
  // each anchored by its q_num(s) for the 🔊 highlight (item 7). Render-layer
  // only — we never touch the stored payload.
  function buildTranscriptModel(review) {
    var bySection = {};   // sectionNum → [{ qs:[...], scriptHtml }]
    review.forEach(function (it) {
      var sec = it.section ? parseInt(String(it.section).replace(/\D/g, ''), 10)
                           : (Math.floor((it.q_num - 1) / 10) + 1);
      var script = (it.solution && it.solution.script) || '';
      var html = renderScript(script);
      if (!html) return;
      var lines = bySection[sec] = bySection[sec] || [];
      // dedup: shared-window questions emit identical script → merge into one line
      var existing = null;
      for (var i = 0; i < lines.length; i++) { if (lines[i].html === html) { existing = lines[i]; break; } }
      if (existing) existing.qs.push(it.q_num);
      else lines.push({ qs: [it.q_num], html: html });
    });
    return bySection;
  }

  function selectSection(num) {
    SESSION.section = num;
    var sec = (SESSION.data.sections || []).filter(function (s) { return s.section_num === num; })[0] || {};
    $('lr-transcript-title').textContent = sec.theme
      ? ('Section ' + num + ' — ' + sec.theme) : ('Section ' + num);
    var body = $('lr-transcript-body');
    body.innerHTML = '';
    var lines = (SESSION.transcript || {})[num] || [];
    if (!lines.length) {
      var empty = document.createElement('p');
      empty.className = 'lr-tx-empty';
      empty.textContent = 'Transcript theo từng câu hiển thị khi bạn bấm 🔊 ở mỗi câu.';
      body.appendChild(empty);
    }
    lines.forEach(function (ln) {
      var p = document.createElement('p');
      p.className = 'lr-tx-line';
      p.setAttribute('data-qs', ln.qs.join(' '));
      // ln.html is built by renderScript() — already escaped + safe markup
      p.innerHTML = '<span class="lr-tx-qtag">Câu ' + ln.qs.join(', ') + '</span> ' + ln.html;
      body.appendChild(p);
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
    // item 5 — skill chips (K1, K2…) removed from per-question cards (they're for
    // the summary's "skills to practise", item 9 — not shown here).
    var detail =
      _solSection('Dịch đoạn chứa đáp án', sol.translation_vi ? formatProse(sol.translation_vi) : '') +
      _solSection('Từ vựng', sol.vocab_focus ? _bulletList(sol.vocab_focus) : (sol.vocab ? _bulletList(sol.vocab) : '')) +
      _solSection('Paraphrase', sol.paraphrase ? formatProse(sol.paraphrase) : '') +
      _solSection('Vì sao đúng', sol.why_correct ? formatWhyCorrect(sol.why_correct) : '') +   // item 6 — de-walled
      _solSection('Script', sol.script ? renderScript(sol.script) : '', 'script') +            // item 3 — TTS transform
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

    // wire: timestamp → full-track seek + transcript highlight (items 4 + 7)
    var ts = card.querySelector('[data-action="play"]');
    if (ts) ts.addEventListener('click', function (e) { e.stopPropagation(); locate(item.q_num, win); });
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

  // ── Item 9 — "Kĩ năng cần luyện" (skills to practise) ─────────────
  // Aggregate the K-codes from the WRONG questions (solution.skills is free-text
  // "K1, K2") → a thin panel above the per-question cards. Labels from Andy's
  // K1–K8 legend. Link scope = option (i): a single generic CTA to the listening
  // practice library (no per-skill recommender — content isn't skill-tagged yet).
  var _K_LABELS = {
    K1: 'Nghe số / ngày / đánh vần (numbers, dates, spelling, prices, phone)',
    K2: 'Nhận diện paraphrase (synonym / đổi cấu trúc câu)',
    K3: 'Bám signpost / chuyển ý (however, actually, in fact)',
    K4: 'Theo dõi self-correction & number-correction (nói rồi sửa)',
    K5: 'Phân biệt detail vs gist (chi tiết vs ý chính)',
    K6: 'Suy luận / hàm ý (inference)',
    K7: 'Thái độ / quan điểm / cảm xúc người nói (attitude / opinion)',
    K8: 'Map / không gian (vị trí, hướng, plan labelling)',
  };
  function skillsToPractise(items) {
    var tally = {};
    items.forEach(function (it) {
      if (it.correct) return;                                  // only weak (wrong) questions
      var skills = (it.solution && it.solution.skills) || '';
      (skills.match(/K[1-8]/g) || []).forEach(function (code) {
        tally[code] = (tally[code] || 0) + 1;
      });
    });
    return Object.keys(tally)
      .map(function (code) { return { code: code, label: _K_LABELS[code] || code, count: tally[code] }; })
      .sort(function (a, b) { return b.count - a.count || a.code.localeCompare(b.code); });
  }
  function renderSkillsPanel(items) {
    var weak = skillsToPractise(items);
    if (!weak.length) return null;
    var panel = document.createElement('section');
    panel.className = 'lr-skills-panel';
    panel.setAttribute('aria-label', 'Kĩ năng cần luyện');
    var chips = weak.map(function (s) {
      return '<span class="lr-skill-chip" title="' + escapeHtml(s.label) + '">' +
        '<span class="lr-skill-chip__code">' + escapeHtml(s.code) + '</span> ' +
        escapeHtml(s.label) +
        '<span class="lr-skill-chip__count">×' + s.count + '</span></span>';
    }).join('');
    panel.innerHTML =
      '<h3 class="lr-skills-panel__title">🎯 Kĩ năng cần luyện</h3>' +
      '<p class="lr-skills-panel__sub">Tổng hợp từ các câu sai — ưu tiên luyện kĩ năng xuất hiện nhiều nhất.</p>' +
      '<div class="lr-skills-panel__chips">' + chips + '</div>' +
      '<a class="lr-skills-panel__cta" href="/pages/listening.html">Luyện nghe thêm →</a>';
    return panel;
  }

  function renderReview(items) {
    var host = $('lr-review'); host.innerHTML = '';
    var panel = renderSkillsPanel(items);
    if (panel) host.appendChild(panel);
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

  // ── Palette: ONE horizontal strip 1–40 (item 1), thin section markers ──
  function renderPalette(items) {
    var strip = $('lr-nav-grid'); strip.innerHTML = '';
    items.slice().sort(function (a, b) { return a.q_num - b.q_num; }).forEach(function (it, i) {
      // a hairline gap before each new section of 10
      if (i > 0 && it.q_num % 10 === 1) {
        var sep = document.createElement('span');
        sep.className = 'lr-palette-sep'; sep.setAttribute('aria-hidden', 'true');
        strip.appendChild(sep);
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lr-nav-q ' + (it.correct ? 'is-correct' : 'is-incorrect');
      b.setAttribute('data-q', String(it.q_num));
      b.title = (it.correct ? 'Đúng' : 'Sai') + ' — Câu ' + it.q_num;
      b.textContent = String(it.q_num);
      b.addEventListener('click', function () { jumpToQ(it.q_num); });
      strip.appendChild(b);
    });
  }

  function renderSummary(d) {
    $('lr-test-label').textContent = d.title || 'Chữa bài';
    var summary;
    if (d.band_estimate != null) {
      summary = 'Band ' + Number(d.band_estimate).toFixed(1);
    } else {
      // item 8b — below the band-conversion floor: show "< lowest band", not "—".
      var bands = (d.band_conversion || []).map(function (r) { return Number(r.band); })
        .filter(function (n) { return !isNaN(n); });
      var floor = bands.length ? Math.min.apply(null, bands) : null;
      summary = floor != null ? ('Dưới band ' + floor.toFixed(1)) : 'Chưa đủ band';
    }
    $('lr-summary').textContent = summary + ' · ' +
      (d.score != null ? d.score : '?') + '/' + (d.max_score || 40);
  }

  function render(d) {
    SESSION.data = d;
    SESSION.transcript = buildTranscriptModel(d.review || []);   // per-section, deduped, anchored
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
