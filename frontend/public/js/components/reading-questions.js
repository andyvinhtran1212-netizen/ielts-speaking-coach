/* frontend/js/components/reading-questions.js — Sprint 20.3.
 *
 * Shared light-Q renderer used by L1 (reading-vocab-passage.js) and L2
 * (reading-skill-exercise.js). Extracted from the Sprint 20.2 inline L1
 * renderer; adds matching_headings support (dropdown-select, per the cluster
 * 20.0 Discovery D7 decision — same idiom as listening's plan_label).
 *
 * Usage:
 *   window.ReadingQuestions.attach({
 *     host:      HTMLElement,            // where to render
 *     questions: [...],                  // server-stripped (no answer key)
 *     library:   'vocab' | 'skill',      // routes the /check POST
 *     slug:      'passage-slug',
 *     heading:   'Câu hỏi hiểu bài',     // optional sidebar title
 *   });
 *
 * Server-side grading: POSTs to /api/reading/<library>/<slug>/check. Answer
 * keys never reach the client (strip-keys watch-item).
 */
(function () {
  'use strict';

  // ── Tiny DOM helpers (XSS-safe: textContent everywhere except option attrs) ──
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function radioOption(name, value, labelText) {
    var label = el('label', 'rq-option');
    var input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = value;
    var span = el('span', null, labelText);
    label.appendChild(input); label.appendChild(span);
    return label;
  }

  // ── Per-type renderers ──
  function renderInputs(card, q, name) {
    var type = q.question_type;
    var inputEl = null;

    if (type === 'mcq_single') {
      var opts = el('div', 'rq-options');
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var text = o.label != null ? (o.label + '. ' + (o.text || '')) : (o.text || '');
        opts.appendChild(radioOption(name, val, text));
      });
      card.appendChild(opts);
    } else if (type === 'true_false_not_given' || type === 'yes_no_not_given') {
      var vals = type === 'true_false_not_given'
        ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      var grp = el('div', 'rq-options');
      vals.forEach(function (v) { grp.appendChild(radioOption(name, v, v)); });
      card.appendChild(grp);
    } else if (type === 'matching_headings') {
      // Phase 1 matching: dropdown-select over payload.options. Per the 20.0
      // Discovery D7 decision — functionally equivalent to drag-drop for scoring,
      // far lower implementation risk. (Drag-drop UI is Phase B.)
      var sel = document.createElement('select');
      sel.className = 'rq-input';
      sel.name = name;
      var placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = '— Chọn tiêu đề —';
      sel.appendChild(placeholder);
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var text = o.label != null ? (o.label + '. ' + (o.text || '')) : (o.text || '');
        var opt = document.createElement('option');
        opt.value = val; opt.textContent = text;
        sel.appendChild(opt);
      });
      card.appendChild(sel);
      inputEl = sel;
    } else {
      // short_answer, sentence_completion, *_completion text-gap fallbacks.
      inputEl = document.createElement('input');
      inputEl.type = 'text'; inputEl.className = 'rq-input';
      inputEl.placeholder = 'Nhập câu trả lời…';
      card.appendChild(inputEl);
    }
    return inputEl;
  }

  function readAnswer(card, q, name, inputEl) {
    if (inputEl) return inputEl.value;
    var checked = card.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : null;
  }

  // ── Card ──
  function renderCard(q, idx, session) {
    var card = el('div', 'rq-card');
    var name = 'rq-' + q.q_num;
    card.appendChild(el('div', 'rq-prompt', (idx + 1) + '. ' + (q.prompt || '')));

    var inputEl = renderInputs(card, q, name);
    var feedback = el('div', 'rq-feedback'); feedback.hidden = true;

    var btn = el('button', 'rq-check', 'Kiểm tra');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var answer = readAnswer(card, q, name, inputEl);
      if (answer == null || answer === '') return;
      btn.disabled = true;
      checkAnswer(q.q_num, answer, feedback, card, btn, session);
    });

    card.appendChild(btn);
    card.appendChild(feedback);
    return card;
  }

  function checkAnswer(qNum, userAnswer, feedbackEl, card, btn, session) {
    var url = '/api/reading/' + session.library + '/' +
      encodeURIComponent(session.slug) + '/check';
    window.api.post(url, { answers: [{ q_num: qNum, user_answer: String(userAnswer) }] })
      .then(function (res) {
        var r = (res && res.results && res.results[0]) || null;
        if (!r) { btn.disabled = false; return; }
        session.answered += 1;
        if (r.correct) session.correct += 1;
        feedbackEl.hidden = false;
        feedbackEl.classList.add(r.correct ? 'is-correct' : 'is-incorrect');
        card.querySelectorAll('input, select').forEach(function (e) { e.disabled = true; });
        var msg = r.correct
          ? '✓ Đúng rồi!'
          : '✗ Chưa đúng — gợi ý kỹ năng: ' + (r.skill_tag || '') +
            '. Đáp án: ' + (r.expected || '');
        if (r.explanation) msg += ' — ' + r.explanation;
        feedbackEl.textContent = msg;
        updateSummary(session);
        // 2026-07-17 — flag người học cho practice L1/L2: sau khi kiểm tra,
        // học viên có thể báo lỗi câu này (đáp án sai / giải thích khó hiểu).
        // Anchor = passage slug (không có attempt row cho practice).
        if (window.AverFeedback) {
          window.AverFeedback.attachCardFlag({
            card: card, top: card, skill: 'reading',
            passageSlug: session.slug, qNum: qNum,
            label: 'Báo lỗi câu này',
          });
        }
      })
      .catch(function (e) {
        btn.disabled = false;
        feedbackEl.hidden = false;
        feedbackEl.classList.add('is-incorrect');
        feedbackEl.textContent = 'Không kiểm tra được. ' + (e && e.message ? e.message : '');
      });
  }

  function updateSummary(session) {
    if (session.summaryEl) {
      session.summaryEl.textContent = 'Đúng ' + session.correct + '/' + session.total;
    }
  }

  // ── Entry point ──
  function attach(opts) {
    if (!opts || !opts.host) return;
    var questions = Array.isArray(opts.questions) ? opts.questions : [];
    var host = opts.host;
    // Clear via the DOM API (XSS-safe and explicit) — never innerHTML in this
    // component, even for empty resets, so the sentinel can guard the whole file.
    host.replaceChildren();
    if (!questions.length) return;

    var session = {
      library: opts.library || 'vocab',
      slug:    opts.slug || '',
      total:   questions.length,
      answered: 0,
      correct: 0,
      summaryEl: null,
    };

    var heading = el('h2', null, opts.heading || 'Câu hỏi hiểu bài');
    heading.style.fontSize = 'var(--av-fs-lg)';
    host.appendChild(heading);

    session.summaryEl = el('div', 'rq-summary', 'Đúng 0/' + questions.length);
    host.appendChild(session.summaryEl);

    questions.forEach(function (q, i) { host.appendChild(renderCard(q, i, session)); });
  }

  window.ReadingQuestions = { attach: attach };
})();
