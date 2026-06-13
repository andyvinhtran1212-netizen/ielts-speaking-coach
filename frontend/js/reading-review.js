/* frontend/js/reading-review.js — reading-rich Part C, chuabai-redesign.
 *
 * Post-submit chữa-bài (solution review). Mirrors the test-taking view (2-pane
 * passage | question cards, part tabs) with corrections layered in: each Q has
 * a dropdown that expands a richly-formatted solution (steps as bullets, trap /
 * tips colour-coded, vocab as a definition list, source as a quote) and — on
 * expand — highlights the matching paragraph(s) in the passage. The passage
 * pane toggles between "Văn bản gốc" (English) and "Bài dịch" (VI, #372).
 *
 * Data: GET /api/reading/test/attempts/{attempt_id}/review (submitted-only;
 * the rich solution is stripped during the test — Part A — and revealed here).
 * XSS-safe: prose is escaped before any <strong>/<mark> is layered on.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { attemptId: null, data: null, part: null, passageMode: 'original', passage: null };

  var SKILL_LABEL = {
    skimming:              'Đọc lướt ý chính',
    scanning:              'Định vị thông tin',
    detail:                'Chi tiết / số liệu',
    main_idea:             'Ý chính',
    inference:             'Suy luận',
    vocabulary_in_context: 'Từ vựng theo ngữ cảnh',
    reference_cohesion:    'Liên kết & tham chiếu',
    writer_view_TFNG:      'Quan điểm tác giả (T/F/NG)',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  // Escape, THEN layer formatting — XSS-safe (escape first, so any HTML in the
  // data is already inert before we add <code>/<strong>).
  //  • `backtick` spans → styled mono (chuabai-refine #5 — no literal backticks)
  //  • "quoted" spans   → bold for legibility
  function formatProse(s) {
    var out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, function (_, t) { return '<code class="rr-code">' + t + '</code>'; });
    out = out.replace(/(&quot;|&#39;|“|”)([^&"'“”]+?)(&quot;|&#39;|“|”)/g,
      function (_, a, mid, b) { return '<strong>' + a + mid + b + '</strong>'; });
    return out;
  }
  // Split a prose block into bullet-sized pieces (chuabai-refine #6). Splits on
  // ';' and sentence boundaries ('. '); a single sentence → one bullet.
  function _bulletList(text) {
    var items = String(text).split(/;\s+|\.\s+/).map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (!items.length) return '';
    return '<ul class="rr-sol__bullets">' +
      items.map(function (s) { return '<li>' + formatProse(s) + '</li>'; }).join('') + '</ul>';
  }
  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('rr-content').hidden    = name !== 'ready';
  }
  function showError(msg) {
    var el = $('error-msg'); if (el) el.textContent = msg;
    showState('error');
  }
  function attemptIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('attempt_id') || '').trim() || null;
  }
  // reading-access-tracking B2 — an anonymous (share-link) taker owns this
  // review via the anon_id capability token, passed on the URL by the exam
  // results CTA. When present we replay it as X-Reading-Anon and suppress the
  // 401→login bounce (the user has no account).
  function anonIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('anon') || '').trim() || null;
  }

  // ── Compact top-bar summary (band + score) + skills popover ───────
  function renderSummary(d) {
    var band = (d.band_estimate != null) ? d.band_estimate : '—';
    var score = (d.score != null ? d.score : '—') + '/' + (d.max_score || 40);
    var label = $('rr-test-label');
    if (label) label.textContent = (d.title || d.test_id || 'Chữa bài');
    $('rr-summary').innerHTML =
      '<span class="rr-topbar-summary__band">Band ' + escapeHtml(band) + '</span>' +
      '<span class="rr-topbar-summary__score">Đúng ' + escapeHtml(score) + '</span>';
  }
  // reading-header-notefill A — skills shown INLINE in the top-right as
  // compact tinted chips (skill code · correct/total), sorted weakest-first,
  // visible at a glance (no dropdown). Hover/title gives the full VN name.
  function renderSkills(d) {
    var host = $('rr-skills');
    var skills = d.skill_breakdown || {};
    var keys = Object.keys(skills).filter(function (k) { return (skills[k] || {}).total; });
    if (!keys.length) { host.hidden = true; return; }
    keys.sort(function (a, b) {
      return (skills[a].correct / skills[a].total) - (skills[b].correct / skills[b].total);
    });
    host.innerHTML = keys.map(function (k) {
      var r = skills[k], pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
      var tone = pct >= 75 ? 'is-strong' : (pct >= 50 ? 'is-mid' : 'is-weak');
      return '<span class="rr-skill-chip ' + tone + '" title="' + escapeHtml(SKILL_LABEL[k] || k) + '">' +
        '<span class="rr-skill-chip__name">' + escapeHtml(SKILL_LABEL[k] || k) + '</span>' +
        '<span class="rr-skill-chip__count">' + r.correct + '/' + r.total + '</span></span>';
    }).join('');
  }

  // ── 40-question navigator (reuses the exam palette, grouped by passage) ──
  // chuabai-refine #3 — replaces the 3 "Phần" tabs. Each number jumps to that
  // question's review; the button is tinted by right/wrong (#42 latitude).
  function renderNavigator(d) {
    var grid = $('rr-nav-grid');
    var correctByQ = {};
    (d.review || []).forEach(function (r) { correctByQ[r.q_num] = !!r.correct; });
    var byPart = {};
    (d.review || []).forEach(function (r) {
      (byPart[r.passage_order] = byPart[r.passage_order] || []).push(r.q_num);
    });
    var orders = Object.keys(byPart).map(Number).sort(function (a, b) { return a - b; });
    grid.innerHTML = '';
    orders.forEach(function (order) {
      var groupEl = document.createElement('div');
      groupEl.className = 'exam-palette__group';
      var labelEl = document.createElement('span');
      labelEl.className = 'exam-palette__group-label';
      labelEl.textContent = 'Passage ' + order;
      groupEl.appendChild(labelEl);
      var btns = document.createElement('div');
      btns.className = 'exam-palette__group-btns';
      byPart[order].sort(function (a, b) { return a - b; }).forEach(function (qn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'exam-palette__q rr-nav-q ' + (correctByQ[qn] ? 'is-correct' : 'is-incorrect');
        b.dataset.q = String(qn);
        b.textContent = String(qn);
        b.setAttribute('aria-label', 'Câu ' + qn + (correctByQ[qn] ? ' — đúng' : ' — sai'));
        b.addEventListener('click', function () { jumpToQ(qn); });
        btns.appendChild(b);
      });
      groupEl.appendChild(btns);
      grid.appendChild(groupEl);
    });
    $('rr-mode-original').addEventListener('click', function () { setPassageMode('original'); });
    $('rr-mode-translation').addEventListener('click', function () { setPassageMode('translation'); });
  }

  // Jump to a question's review: switch to its passage if needed, scroll the
  // card into view, expand it (which highlights the source), mark nav active.
  function jumpToQ(qNum) {
    var item = (SESSION.data.review || []).filter(function (r) { return r.q_num === qNum; })[0];
    if (!item) return;
    if (item.passage_order !== SESSION.part) selectPart(item.passage_order);
    document.querySelectorAll('.rr-nav-q').forEach(function (b) {
      b.classList.toggle('is-current', parseInt(b.getAttribute('data-q'), 10) === qNum);
    });
    var card = document.querySelector('.rr-card[data-q="' + qNum + '"]');
    if (!card) return;
    if (card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var detail = card.querySelector('.rr-card__detail');
    if (detail && detail.hidden) { var top = card.querySelector('.rr-card__top'); if (top) top.click(); }
  }

  function setPassageMode(mode) {
    SESSION.passageMode = mode;
    var on = $('rr-mode-original'), tr = $('rr-mode-translation');
    on.classList.toggle('is-active', mode === 'original');
    on.setAttribute('aria-pressed', mode === 'original' ? 'true' : 'false');
    tr.classList.toggle('is-active', mode === 'translation');
    tr.setAttribute('aria-pressed', mode === 'translation' ? 'true' : 'false');
    if (SESSION.passage) renderPassageBody(SESSION.passage);
  }

  // ── Passage pane ──────────────────────────────────────────────────
  // The toggle + title + body live in the HTML (persistent); we only set the
  // title text + (re)render the body, so the gốc/dịch toggle isn't wiped.
  function renderPassage(passage) {
    SESSION.passage = passage;
    var titleEl = $('rr-passage-title');
    if (titleEl) titleEl.textContent = passage.title || ('Phần ' + passage.passage_order);
    renderPassageBody(passage);
  }
  function renderPassageBody(passage) {
    var body = $('rr-passage-body');
    if (!body) return;
    if (SESSION.passageMode === 'translation') {
      var t = (passage.translation_vi || '').trim();
      if (!t) {
        body.innerHTML = '<p class="rr-passage__notrans">Chưa có bản dịch cho phần này.</p>';
        return;
      }
      body.innerHTML = '';
      t.split(/\n\s*\n/).forEach(function (para) {
        var s = para.trim(); if (!s) return;
        var p = document.createElement('p'); p.textContent = s;   // XSS-safe
        body.appendChild(p);
      });
    } else {
      body.innerHTML = window.renderMarkdown
        ? window.renderMarkdown(passage.body_markdown || '', { breaks: false })
        : escapeHtml(passage.body_markdown || '');
      if (window.GlossaryPopover) window.GlossaryPopover.attach(body, []);
    }
  }

  // ── Source highlight (paragraph-level, text-match; chuabai-redesign) ──
  function _normMatch(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function clearHighlight() {
    var body = $('rr-passage-body');
    if (!body) return;
    body.querySelectorAll('.rr-src-hl').forEach(function (el) { el.classList.remove('rr-src-hl'); });
  }
  // Split a source excerpt into findable segments (drop surrounding quotes,
  // split on ellipsis), highlight the passage paragraph(s) containing each,
  // and scroll the first into view. Translation mode → switch to original first.
  function highlightSource(excerpt) {
    if (!excerpt) return;
    if (SESSION.passageMode !== 'original') setPassageMode('original');
    clearHighlight();
    var body = $('rr-passage-body');
    if (!body) return;
    var segments = String(excerpt)
      .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
      .split(/\s*(?:…|\.\.\.)\s*/)
      .map(_normMatch)
      .filter(function (s) { return s.length >= 8; });
    if (!segments.length) return;
    var blocks = body.querySelectorAll('p, li, td, h1, h2, h3, h4');
    var first = null;
    blocks.forEach(function (el) {
      var txt = _normMatch(el.textContent);
      for (var i = 0; i < segments.length; i++) {
        if (txt.indexOf(segments[i]) !== -1) { el.classList.add('rr-src-hl'); if (!first) first = el; break; }
      }
    });
    if (first && first.scrollIntoView) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Rich solution formatting ──────────────────────────────────────
  function _stepsList(steps) {
    // "(1) … (2) … (3) …" → bullets; else a single paragraph.
    var parts = String(steps).split(/\s*\(\d+\)\s*/).map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (parts.length > 1) {
      return '<ol class="rr-sol__steps">' +
        parts.map(function (s) { return '<li>' + formatProse(s) + '</li>'; }).join('') + '</ol>';
    }
    return '<p>' + formatProse(steps) + '</p>';
  }
  function _vocabList(vocab) {
    // each "term (pos) = meaning" → a definition row.
    return '<dl class="rr-sol__vocab">' + vocab.map(function (v) {
      var m = String(v).split(/\s*(?:=|—)\s*/);
      var term = m[0] || v, def = m.slice(1).join(' — ');
      return '<div class="rr-sol__vocab-row"><dt>' + formatProse(term) + '</dt>' +
        (def ? '<dd>' + escapeHtml(def) + '</dd>' : '') + '</div>';
    }).join('') + '</dl>';
  }
  function _section(label, innerHtml, cls) {
    if (!innerHtml) return '';
    return '<div class="rr-sol__sec' + (cls ? ' ' + cls : '') + '">' +
      '<div class="rr-sol__label">' + escapeHtml(label) + '</div>' +
      '<div class="rr-sol__text">' + innerHtml + '</div></div>';
  }

  function renderCard(item) {
    var correct = !!item.correct;
    var sol = item.solution || {};
    var card = document.createElement('article');
    card.className = 'rr-card ' + (correct ? 'is-correct' : 'is-incorrect');
    card.dataset.q = String(item.q_num);

    var bandStr = (sol.band != null) ? (' · Band ' + sol.band) : '';
    var skillStr = sol.skill_name ? (' · ' + sol.skill_name)
      : (item.skill_tag ? (' · ' + (SKILL_LABEL[item.skill_tag] || item.skill_tag)) : '');

    var sections = [
      _section('Các bước ra đáp án', sol.steps ? _stepsList(sol.steps) : '', 'rr-sol__sec--steps'),
      _section('Trích đoạn nguồn', sol.source_excerpt
        ? ('<blockquote>' + formatProse(sol.source_excerpt) + '</blockquote>' +
           // reading-review-locate-exam-format A2 — explicit locate trigger
           // (the expand toggle no longer auto-highlights).
           '<button type="button" class="rr-locate-btn" data-locate>📍 Locate trong bài đọc</button>')
        : '', 'rr-sol__sec--quote'),
      _section('Từ vựng', (sol.vocab && sol.vocab.length) ? _vocabList(sol.vocab) : '', 'rr-sol__sec--vocab'),
      _section('Paraphrase', sol.paraphrase ? _bulletList(sol.paraphrase) : ''),
      _section('Phân tích bẫy & kỹ năng', sol.trap_analysis ? _bulletList(sol.trap_analysis) : '', 'rr-sol__sec--trap'),
      _section('💡 Mẹo làm bài', sol.tips ? _bulletList(sol.tips) : '', 'rr-sol__sec--tip'),
      (!sol.steps && item.explanation) ? _section('Lời giải', '<p>' + formatProse(item.explanation) + '</p>') : '',
    ].join('');
    var hasRich = sections.replace(/\s/g, '') !== '';

    card.innerHTML =
      '<div class="rr-card__top" role="button" tabindex="0" aria-expanded="false">' +
        '<span class="rr-card__num">Câu ' + escapeHtml(item.q_num) + '</span>' +
        '<span class="rr-card__verdict">' + (correct ? '✓ Đúng' : '✗ Sai') + '</span>' +
        '<span class="rr-card__tag">' + escapeHtml((item.question_type || '') + skillStr + bandStr) + '</span>' +
        // chuabai-refine #4 — prominent, clearly-labelled expand affordance.
        (hasRich ? '<span class="rr-card__toggle"><span class="rr-card__toggle-text">Xem lời giải</span>' +
                   '<span class="rr-card__chevron" aria-hidden="true">▸</span></span>' : '') +
      '</div>' +
      (item.prompt ? '<p class="rr-card__prompt">' + escapeHtml(item.prompt) + '</p>' : '') +
      '<div class="rr-card__answers">' +
        '<div class="rr-card__ans is-user"><span>Bạn trả lời</span><code>' +
          escapeHtml(item.user_answer || '—') + '</code></div>' +
        '<div class="rr-card__ans is-correct"><span>Đáp án</span><code>' +
          escapeHtml(item.expected || '') + '</code></div>' +
      '</div>' +
      (hasRich ? '<div class="rr-card__detail" hidden>' + sections + '</div>' : '');

    if (hasRich) {
      var top = card.querySelector('.rr-card__top');
      var detail = card.querySelector('.rr-card__detail');
      var toggleText = top.querySelector('.rr-card__toggle-text');
      // A2 — the toggle now ONLY shows/collapses the solution (no auto-locate,
      // no auto-scroll, no mode switch). Locating is an explicit button below.
      var toggle = function () {
        var open = detail.hidden;
        detail.hidden = !open;
        top.setAttribute('aria-expanded', open ? 'true' : 'false');
        card.classList.toggle('is-open', open);
        if (toggleText) toggleText.textContent = open ? 'Ẩn lời giải' : 'Xem lời giải';
      };
      top.addEventListener('click', toggle);
      top.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      // A2 — explicit "Locate trong bài đọc": highlight the source paragraph(s),
      // scroll into view, switch to "Văn bản gốc" (handled inside highlightSource).
      var locateBtn = detail.querySelector('[data-locate]');
      if (locateBtn) {
        locateBtn.addEventListener('click', function () { highlightSource(sol.source_excerpt); });
      }
    }
    return card;
  }

  function selectPart(order) {
    SESSION.part = order;
    var d = SESSION.data;
    var passage = (d.passages || []).filter(function (p) { return p.passage_order === order; })[0];
    if (passage) renderPassage(passage);

    var items = (d.review || []).filter(function (r) { return r.passage_order === order; })
      .sort(function (a, b) { return (a.q_num || 0) - (b.q_num || 0); });
    var review = $('rr-review');
    review.innerHTML =
      '<div class="rr-review__bar"><h2 class="rr-review__title">Chữa từng câu — Phần ' +
        escapeHtml(order) + '</h2>' +
        '<button type="button" class="rr-expand-all" id="rr-expand-all" aria-pressed="false">Mở tất cả</button></div>' +
      '<div class="rr-cards" id="rr-cards"></div>';
    var cards = $('rr-cards');
    items.forEach(function (it) { cards.appendChild(renderCard(it)); });

    $('rr-expand-all').addEventListener('click', function () {
      var btn = $('rr-expand-all');
      var open = btn.getAttribute('aria-pressed') !== 'true';
      cards.querySelectorAll('.rr-card').forEach(function (c) {
        var det = c.querySelector('.rr-card__detail');
        if (!det) return;
        det.hidden = !open;
        c.classList.toggle('is-open', open);
        var top = c.querySelector('.rr-card__top');
        if (top) top.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      if (!open) clearHighlight();
      btn.setAttribute('aria-pressed', open ? 'true' : 'false');
      btn.textContent = open ? 'Thu gọn tất cả' : 'Mở tất cả';
    });

    // Feedback (PR-2) — show-once survey at the top of the review + a per-card
    // "flag bài giải" button. Reading rebuilds #rr-review per part, so re-mount
    // each time (both calls are idempotent + the survey is show-once per attempt).
    if (window.AverFeedback) {
      var anonId = anonIdFromUrl();
      var qNums = ((SESSION.data && SESSION.data.review) || [])
        .map(function (r) { return r.q_num; })
        .filter(function (n) { return n != null; })
        .sort(function (a, b) { return a - b; });
      window.AverFeedback.mountSurvey(review, {
        skill: 'reading', attemptId: SESSION.attemptId, hasAudio: false,
        anonId: anonId, qNums: qNums,
      });
      cards.querySelectorAll('.rr-card').forEach(function (c) {
        window.AverFeedback.attachCardFlag({
          card: c, top: c.querySelector('.rr-card__top'), skill: 'reading',
          attemptId: SESSION.attemptId, qNum: Number(c.dataset.q), anonId: anonId,
        });
      });
    }
  }

  function render(d) {
    SESSION.data = d;
    renderSummary(d); renderSkills(d); renderNavigator(d);
    showState('ready');
    $('rr-palette').hidden = false;
    var first = (d.passages || []).slice().sort(function (a, b) {
      return (a.passage_order || 0) - (b.passage_order || 0);
    })[0];
    var order = first ? first.passage_order : 1;
    selectPart(order);
    // mark the first nav button current
    var firstBtn = document.querySelector('.rr-nav-q');
    if (firstBtn) firstBtn.classList.add('is-current');
  }

  function load(attemptId) {
    showState('loading');
    SESSION.attemptId = attemptId;
    // reading-access-tracking B2 — anonymous ownership header + noRedirect when
    // an anon_id is on the URL; otherwise the plain authed fetch.
    var anonId = anonIdFromUrl();
    var reviewUrl = '/api/reading/test/attempts/' + encodeURIComponent(attemptId) + '/review';
    var reviewPromise = anonId
      ? window.api.getWith(reviewUrl, { 'X-Reading-Anon': anonId }, { noRedirect: true })
      : window.api.get(reviewUrl);
    reviewPromise
      .then(function (d) {
        if (!d || !(d.review || []).length) { showState('empty'); return; }
        render(d);
      })
      .catch(function (e) {
        if (e && e.status === 409) {
          showError('Bài làm này chưa nộp — chưa có chữa bài. Hãy hoàn thành và nộp bài trước.');
        } else if (e && (e.status === 403 || e.status === 401)) {
          // 403 = foreign owner; 401 = anon link lost its credential. Both are
          // ownership failures for the anonymous path → one clear message.
          showError(anonId
            ? 'Không xem được chữa bài của bài làm này (liên kết không còn hiệu lực hoặc thuộc phiên khác).'
            : 'Bài làm này không thuộc tài khoản của bạn.');
        } else if (e && e.status === 404) {
          showState('empty');
        } else {
          showError('Không tải được chữa bài. ' + (e && e.message ? e.message : ''));
        }
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var id = attemptIdFromUrl();
    if (!id) { showState('empty'); return; }
    load(id);
  });
})();
