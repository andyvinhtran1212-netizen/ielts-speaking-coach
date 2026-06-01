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
  // Escape, THEN bold "quoted" spans for legibility — XSS-safe (escape first).
  function formatProse(s) {
    return escapeHtml(s).replace(/(&quot;|&#39;|“|”)(.+?)(&quot;|&#39;|“|”)/g,
      function (_, a, mid, b) { return '<strong>' + a + mid + b + '</strong>'; });
  }
  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('rr-content').hidden    = name !== 'ready';
  }
  function showError(msg) { $('state-error').textContent = msg; showState('error'); }
  function attemptIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('attempt_id') || '').trim() || null;
  }

  // ── Summary + skills (overview) ───────────────────────────────────
  function renderSummary(d) {
    var band = (d.band_estimate != null) ? d.band_estimate : '—';
    var score = (d.score != null ? d.score : '—') + '/' + (d.max_score || 40);
    var parts = Object.keys(d.by_part || {}).sort().map(function (k) {
      var r = d.by_part[k];
      return '<div class="rr-summary__part"><span>' + escapeHtml(k.replace('p', 'Phần ')) +
        '</span><strong>' + r.correct + '/' + r.total + '</strong></div>';
    }).join('');
    $('rr-summary').innerHTML =
      '<div class="rr-summary__band"><span class="rr-summary__band-label">Band ước tính</span>' +
        '<span class="rr-summary__band-value">' + escapeHtml(band) + '</span></div>' +
      '<div class="rr-summary__meta">' +
        '<div class="rr-summary__title">' + escapeHtml(d.title || d.test_id || 'Chữa bài') + '</div>' +
        '<div class="rr-summary__score">Số câu đúng: <strong>' + escapeHtml(score) + '</strong></div>' +
        '<div class="rr-summary__parts">' + parts + '</div>' +
      '</div>';
  }
  function renderSkills(d) {
    var host = $('rr-skills');
    var skills = d.skill_breakdown || {};
    var keys = Object.keys(skills).filter(function (k) { return (skills[k] || {}).total; });
    if (!keys.length) { host.hidden = true; return; }
    keys.sort(function (a, b) {
      return (skills[a].correct / skills[a].total) - (skills[b].correct / skills[b].total);
    });
    host.innerHTML = '<h2 class="rr-skills__title">Kỹ năng — điểm mạnh & điểm yếu</h2>' +
      '<div class="rr-skills__grid">' + keys.map(function (k) {
        var r = skills[k], pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
        var tone = pct >= 75 ? 'is-strong' : (pct >= 50 ? 'is-mid' : 'is-weak');
        return '<div class="rr-skill ' + tone + '"><div class="rr-skill__head">' +
          '<span class="rr-skill__name">' + escapeHtml(SKILL_LABEL[k] || k) + '</span>' +
          '<span class="rr-skill__count">' + r.correct + '/' + r.total + '</span></div>' +
          '<div class="rr-skill__bar"><div class="rr-skill__fill" style="width:' + pct + '%"></div></div></div>';
      }).join('') + '</div>';
  }

  // ── Part tabs + passage original/translation toggle ───────────────
  function renderParts(d) {
    var host = $('rr-parts');
    var passages = (d.passages || []).slice().sort(function (a, b) {
      return (a.passage_order || 0) - (b.passage_order || 0);
    });
    host.innerHTML = passages.map(function (p) {
      return '<button type="button" class="rr-part-tab" role="tab" data-part="' +
        escapeHtml(p.passage_order) + '">Phần ' + escapeHtml(p.passage_order) + '</button>';
    }).join('');
    host.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('.rr-part-tab');
      if (btn) selectPart(parseInt(btn.getAttribute('data-part'), 10));
    });
    $('rr-mode-original').addEventListener('click', function () { setPassageMode('original'); });
    $('rr-mode-translation').addEventListener('click', function () { setPassageMode('translation'); });
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
  function renderPassage(passage) {
    SESSION.passage = passage;
    var host = $('rr-passage');
    host.innerHTML =
      '<h2 class="rr-passage__title">' + escapeHtml(passage.title || ('Phần ' + passage.passage_order)) + '</h2>' +
      '<div class="rr-passage__body md-body" id="rr-passage-body"></div>';
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
      _section('Trích đoạn nguồn', sol.source_excerpt ? ('<blockquote>' + formatProse(sol.source_excerpt) + '</blockquote>') : '', 'rr-sol__sec--quote'),
      _section('Từ vựng', (sol.vocab && sol.vocab.length) ? _vocabList(sol.vocab) : '', 'rr-sol__sec--vocab'),
      _section('Paraphrase', sol.paraphrase ? ('<p>' + formatProse(sol.paraphrase) + '</p>') : ''),
      _section('Phân tích bẫy & kỹ năng', sol.trap_analysis ? ('<p>' + formatProse(sol.trap_analysis) + '</p>') : '', 'rr-sol__sec--trap'),
      _section('Mẹo làm bài', sol.tips ? ('<p>' + formatProse(sol.tips) + '</p>') : '', 'rr-sol__sec--tip'),
      (!sol.steps && item.explanation) ? _section('Lời giải', '<p>' + formatProse(item.explanation) + '</p>') : '',
    ].join('');
    var hasRich = sections.replace(/\s/g, '') !== '';

    card.innerHTML =
      '<div class="rr-card__top" role="button" tabindex="0" aria-expanded="false">' +
        '<span class="rr-card__num">Câu ' + escapeHtml(item.q_num) + '</span>' +
        '<span class="rr-card__verdict">' + (correct ? '✓ Đúng' : '✗ Sai') + '</span>' +
        '<span class="rr-card__tag">' + escapeHtml((item.question_type || '') + skillStr + bandStr) + '</span>' +
        (hasRich ? '<span class="rr-card__chevron" aria-hidden="true">▸</span>' : '') +
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
      var toggle = function () {
        var open = detail.hidden;
        detail.hidden = !open;
        top.setAttribute('aria-expanded', open ? 'true' : 'false');
        card.classList.toggle('is-open', open);
        if (open) highlightSource(sol.source_excerpt); else clearHighlight();
      };
      top.addEventListener('click', toggle);
      top.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
    return card;
  }

  function selectPart(order) {
    SESSION.part = order;
    var d = SESSION.data;
    document.querySelectorAll('.rr-part-tab').forEach(function (b) {
      var on = parseInt(b.getAttribute('data-part'), 10) === order;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
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
  }

  function render(d) {
    SESSION.data = d;
    renderSummary(d); renderSkills(d); renderParts(d);
    showState('ready');
    var first = (d.passages || []).slice().sort(function (a, b) {
      return (a.passage_order || 0) - (b.passage_order || 0);
    })[0];
    selectPart(first ? first.passage_order : 1);
  }

  function load(attemptId) {
    showState('loading');
    SESSION.attemptId = attemptId;
    window.api.get('/api/reading/test/attempts/' + encodeURIComponent(attemptId) + '/review')
      .then(function (d) {
        if (!d || !(d.review || []).length) { showState('empty'); return; }
        render(d);
      })
      .catch(function (e) {
        if (e && e.status === 409) {
          showError('Bài làm này chưa nộp — chưa có chữa bài. Hãy hoàn thành và nộp bài trước.');
        } else if (e && e.status === 403) {
          showError('Bài làm này không thuộc tài khoản của bạn.');
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
