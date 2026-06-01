/* frontend/js/reading-review.js — reading-rich Part C — chữa bài (solution review).
 *
 * After a student submits an L3 full test, this renders the post-submit
 * review: a band/score summary + skill breakdown, then a 2-pane (passage |
 * per-question solution) view per part. Each card shows the user's answer vs
 * the correct one with an instantly-legible verdict, and an expandable rich
 * solution (các bước / trích nguồn / từ vựng / paraphrase / bẫy+kỹ năng / mẹo)
 * that was stripped during the test (Part A) and is revealed only here.
 *
 * Data: GET /api/reading/test/attempts/{attempt_id}/review (submitted-only).
 * Reuses the #372 translation toggle + glossary popover; tokens are theme-aware.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { attemptId: null, data: null, part: null };

  // skill_tag enum → Vietnamese label (mirrors the diagnostic tags).
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

  // ── Summary hero ──────────────────────────────────────────────────
  function renderSummary(d) {
    var host = $('rr-summary');
    var band = (d.band_estimate != null) ? d.band_estimate : '—';
    var score = (d.score != null ? d.score : '—') + '/' + (d.max_score || 40);
    var parts = Object.keys(d.by_part || {}).sort().map(function (k) {
      var r = d.by_part[k];
      var label = k.replace('p', 'Phần ');
      return '<div class="rr-summary__part"><span>' + escapeHtml(label) + '</span>' +
        '<strong>' + r.correct + '/' + r.total + '</strong></div>';
    }).join('');
    host.innerHTML =
      '<div class="rr-summary__band">' +
        '<span class="rr-summary__band-label">Band ước tính</span>' +
        '<span class="rr-summary__band-value">' + escapeHtml(band) + '</span>' +
      '</div>' +
      '<div class="rr-summary__meta">' +
        '<div class="rr-summary__title">' + escapeHtml(d.title || d.test_id || 'Chữa bài') + '</div>' +
        '<div class="rr-summary__score">Số câu đúng: <strong>' + escapeHtml(score) + '</strong></div>' +
        '<div class="rr-summary__parts">' + parts + '</div>' +
      '</div>';
  }

  // ── Skill breakdown bars ──────────────────────────────────────────
  function renderSkills(d) {
    var host = $('rr-skills');
    var skills = d.skill_breakdown || {};
    var keys = Object.keys(skills).filter(function (k) { return (skills[k] || {}).total; });
    if (!keys.length) { host.hidden = true; return; }
    keys.sort(function (a, b) {
      return (skills[a].correct / skills[a].total) - (skills[b].correct / skills[b].total);
    });
    host.innerHTML =
      '<h2 class="rr-skills__title">Kỹ năng — điểm mạnh & điểm yếu</h2>' +
      '<div class="rr-skills__grid">' +
      keys.map(function (k) {
        var r = skills[k];
        var pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
        var tone = pct >= 75 ? 'is-strong' : (pct >= 50 ? 'is-mid' : 'is-weak');
        return '<div class="rr-skill ' + tone + '">' +
          '<div class="rr-skill__head"><span class="rr-skill__name">' +
            escapeHtml(SKILL_LABEL[k] || k) + '</span>' +
            '<span class="rr-skill__count">' + r.correct + '/' + r.total + '</span></div>' +
          '<div class="rr-skill__bar"><div class="rr-skill__fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  // ── Part tabs ─────────────────────────────────────────────────────
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
  }

  // ── Passage pane (#372 translation + glossary) ────────────────────
  function renderPassage(p) {
    var host = $('rr-passage');
    host.innerHTML =
      '<h2 class="rr-passage__title">' + escapeHtml(p.title || ('Phần ' + p.passage_order)) + '</h2>' +
      '<div class="rr-passage__body md-body" id="rr-passage-body"></div>';
    var body = $('rr-passage-body');
    body.innerHTML = window.renderMarkdown
      ? window.renderMarkdown(p.body_markdown || '', { breaks: false }) : escapeHtml(p.body_markdown || '');
    if (window.GlossaryPopover) window.GlossaryPopover.attach(body, []);
    renderTranslation(host, p.translation_vi);
  }

  // Reuse the #372 collapsible VI-translation pattern.
  function renderTranslation(host, translationVi) {
    var text = (translationVi || '').trim();
    if (!text) return;
    var wrap = document.createElement('div');
    wrap.className = 'rv-translation';
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rv-translation__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Xem bản dịch tiếng Việt';
    var panel = document.createElement('div');
    panel.className = 'rv-translation__body md-body';
    panel.hidden = true;
    text.split(/\n\s*\n/).forEach(function (para) {
      var t = para.trim();
      if (!t) return;
      var pEl = document.createElement('p');
      pEl.textContent = t;            // XSS-safe — plain prose
      panel.appendChild(pEl);
    });
    toggle.addEventListener('click', function () {
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      toggle.textContent = willOpen ? 'Ẩn bản dịch' : 'Xem bản dịch tiếng Việt';
    });
    wrap.appendChild(toggle); wrap.appendChild(panel);
    host.appendChild(wrap);
  }

  // ── Per-question solution cards ───────────────────────────────────
  // A rich-solution section (the value: steps/source/vocab/paraphrase/trap/
  // tips). All values are set via textContent — XSS-safe.
  function _solSection(label, value, cls) {
    if (!value) return null;
    var sec = document.createElement('div');
    sec.className = 'rr-sol__sec' + (cls ? ' ' + cls : '');
    var h = document.createElement('div');
    h.className = 'rr-sol__label'; h.textContent = label;
    var b = document.createElement('div');
    b.className = 'rr-sol__text'; b.textContent = value;
    sec.appendChild(h); sec.appendChild(b);
    return sec;
  }

  function renderCard(item) {
    var card = document.createElement('article');
    var correct = !!item.correct;
    card.className = 'rr-card ' + (correct ? 'is-correct' : 'is-incorrect');

    var sol = item.solution || {};
    var bandStr = (sol.band != null) ? (' · Band ' + sol.band) : '';
    var skillStr = sol.skill_name ? (' · ' + sol.skill_name)
      : (item.skill_tag ? (' · ' + (SKILL_LABEL[item.skill_tag] || item.skill_tag)) : '');

    // header (built as HTML — all interpolations escaped)
    var head =
      '<header class="rr-card__head">' +
        '<span class="rr-card__num">Câu ' + escapeHtml(item.q_num) + '</span>' +
        '<span class="rr-card__verdict">' + (correct ? '✓ Đúng' : '✗ Sai') + '</span>' +
        '<span class="rr-card__tag">' + escapeHtml((item.question_type || '') + skillStr + bandStr) + '</span>' +
      '</header>' +
      (item.prompt ? '<p class="rr-card__prompt">' + escapeHtml(item.prompt) + '</p>' : '') +
      '<div class="rr-card__answers">' +
        '<div class="rr-card__ans is-user"><span>Bạn trả lời</span><code>' +
          escapeHtml(item.user_answer || '—') + '</code></div>' +
        '<div class="rr-card__ans is-correct"><span>Đáp án</span><code>' +
          escapeHtml(item.expected || '') + '</code></div>' +
      '</div>';
    card.innerHTML = head;

    // expandable rich solution (collapsed by default)
    var hasRich = sol.steps || sol.source_excerpt || sol.paraphrase ||
      sol.trap_analysis || sol.tips || (sol.vocab && sol.vocab.length) || item.explanation;
    if (hasRich) {
      var det = document.createElement('details');
      det.className = 'rr-sol';
      var sum = document.createElement('summary');
      sum.className = 'rr-sol__summary';
      sum.textContent = 'Giải chi tiết';
      det.appendChild(sum);
      var body = document.createElement('div');
      body.className = 'rr-sol__body';
      [
        _solSection('Các bước ra đáp án', sol.steps),
        _solSection('Trích đoạn nguồn', sol.source_excerpt, 'rr-sol__sec--quote'),
        _solSection('Từ vựng', (sol.vocab && sol.vocab.length) ? sol.vocab.join(' · ') : null),
        _solSection('Paraphrase', sol.paraphrase),
        _solSection('Phân tích bẫy & kỹ năng', sol.trap_analysis, 'rr-sol__sec--trap'),
        _solSection('Mẹo làm bài', sol.tips, 'rr-sol__sec--tip'),
        // fall back to the plain explanation for older content with no rich solution
        (!sol.steps && item.explanation) ? _solSection('Lời giải', item.explanation) : null,
      ].forEach(function (sec) { if (sec) body.appendChild(sec); });
      det.appendChild(body);
      card.appendChild(det);
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
      '<div class="rr-review__bar">' +
        '<h2 class="rr-review__title">Chữa từng câu — Phần ' + escapeHtml(order) + '</h2>' +
        '<button type="button" class="rr-expand-all" id="rr-expand-all" aria-pressed="false">Mở tất cả</button>' +
      '</div>' +
      '<div class="rr-cards" id="rr-cards"></div>';
    var cards = $('rr-cards');
    items.forEach(function (it) { cards.appendChild(renderCard(it)); });

    var expandBtn = $('rr-expand-all');
    expandBtn.addEventListener('click', function () {
      var open = expandBtn.getAttribute('aria-pressed') !== 'true';
      cards.querySelectorAll('details.rr-sol').forEach(function (d2) { d2.open = open; });
      expandBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
      expandBtn.textContent = open ? 'Thu gọn tất cả' : 'Mở tất cả';
    });
  }

  function render(d) {
    SESSION.data = d;
    renderSummary(d);
    renderSkills(d);
    renderParts(d);
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
