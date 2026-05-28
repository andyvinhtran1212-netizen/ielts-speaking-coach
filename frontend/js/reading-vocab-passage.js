/* frontend/js/reading-vocab-passage.js — Sprint 20.2 L1 passage detail.
 *
 * Loads one published L1 passage (GET /api/reading/vocab/{slug}), renders the
 * markdown body, highlights glossary terms (GlossaryPopover), wires the image
 * lightbox, drives the reading-progress bar, and renders light comprehension
 * questions with server-side instant feedback (POST .../check — answer keys
 * never reach the client). No persistence: L1 is ungraded practice.
 *
 * Code-authoritative (Discovery blind-spot #5): a compact purpose-built
 * instant-feedback renderer for the 4 Phase-1 L1 types, NOT the attempt-mode
 * listening player (which is coupled to its own STATE/auto-save).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { slug: null, total: 0, answered: 0, correct: 0 };

  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('rv-passage').hidden    = name !== 'ready';
  }
  function showError(msg) { $('state-error').textContent = msg; showState('error'); }

  function slugFromUrl() {
    return (new URLSearchParams(window.location.search).get('slug') || '').trim() || null;
  }

  // ── Reading progress bar ──
  function updateProgress() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var pct = max > 0 ? Math.min(100, (doc.scrollTop || window.scrollY) / max * 100) : 0;
    $('rv-progress-fill').style.width = pct + '%';
  }

  // ── Light comprehension questions ──
  function radioOption(name, value, labelText) {
    var label = document.createElement('label');
    label.className = 'rq-option';
    var input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = value;
    var span = document.createElement('span');
    span.textContent = labelText;
    label.appendChild(input); label.appendChild(span);
    return label;
  }

  function renderQuestion(q, idx) {
    var card = document.createElement('div');
    card.className = 'rq-card';
    var name = 'rq-' + q.q_num;

    var prompt = document.createElement('div');
    prompt.className = 'rq-prompt';
    prompt.textContent = (idx + 1) + '. ' + (q.prompt || '');
    card.appendChild(prompt);

    var type = q.question_type;
    var inputEl = null; // for text types

    if (type === 'mcq_single') {
      var opts = document.createElement('div'); opts.className = 'rq-options';
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var text = o.label != null ? (o.label + '. ' + (o.text || '')) : (o.text || '');
        opts.appendChild(radioOption(name, val, text));
      });
      card.appendChild(opts);
    } else if (type === 'true_false_not_given' || type === 'yes_no_not_given') {
      var vals = type === 'true_false_not_given'
        ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      var grp = document.createElement('div'); grp.className = 'rq-options';
      vals.forEach(function (v) { grp.appendChild(radioOption(name, v, v)); });
      card.appendChild(grp);
    } else { // short_answer, sentence_completion, *_completion fallbacks
      inputEl = document.createElement('input');
      inputEl.type = 'text'; inputEl.className = 'rq-input';
      inputEl.placeholder = 'Nhập câu trả lời…';
      card.appendChild(inputEl);
    }

    var feedback = document.createElement('div');
    feedback.className = 'rq-feedback'; feedback.hidden = true;

    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'rq-check'; btn.textContent = 'Kiểm tra';
    btn.addEventListener('click', function () {
      var answer = inputEl ? inputEl.value
        : (card.querySelector('input[name="' + name + '"]:checked') || {}).value;
      if (answer == null || answer === '') { return; }
      btn.disabled = true;
      checkAnswer(q.q_num, answer, feedback, card, btn);
    });

    card.appendChild(btn);
    card.appendChild(feedback);
    return card;
  }

  function checkAnswer(qNum, userAnswer, feedbackEl, card, btn) {
    window.api.post('/api/reading/vocab/' + encodeURIComponent(SESSION.slug) + '/check',
      { answers: [{ q_num: qNum, user_answer: String(userAnswer) }] })
      .then(function (res) {
        var r = (res && res.results && res.results[0]) || null;
        if (!r) { btn.disabled = false; return; }
        SESSION.answered += 1;
        if (r.correct) SESSION.correct += 1;
        feedbackEl.hidden = false;
        feedbackEl.classList.add(r.correct ? 'is-correct' : 'is-incorrect');
        card.querySelectorAll('input').forEach(function (el) { el.disabled = true; });
        var msg = r.correct
          ? '✓ Đúng rồi!'
          : '✗ Chưa đúng — gợi ý kỹ năng: ' + (r.skill_tag || '') +
            '. Đáp án: ' + (r.expected || '');
        if (r.explanation) msg += ' — ' + r.explanation;
        feedbackEl.textContent = msg;
        updateSummary();
      })
      .catch(function (e) {
        btn.disabled = false;
        feedbackEl.hidden = false;
        feedbackEl.classList.add('is-incorrect');
        feedbackEl.textContent = 'Không kiểm tra được. ' + (e && e.message ? e.message : '');
      });
  }

  function updateSummary() {
    var el = $('rq-summary');
    if (el) el.textContent = 'Đúng ' + SESSION.correct + '/' + SESSION.total;
  }

  function renderQuestions(questions) {
    var host = $('rv-questions');
    host.innerHTML = '';
    if (!questions.length) { return; }
    SESSION.total = questions.length;
    var heading = document.createElement('h2');
    heading.textContent = 'Câu hỏi hiểu bài';
    heading.style.fontSize = 'var(--av-fs-lg)';
    host.appendChild(heading);
    var summary = document.createElement('div');
    summary.className = 'rq-summary'; summary.id = 'rq-summary';
    summary.textContent = 'Đúng 0/' + questions.length;
    host.appendChild(summary);
    questions.forEach(function (q, i) { host.appendChild(renderQuestion(q, i)); });
  }

  // ── Passage render ──
  function renderPassage(p) {
    document.title = (p.title || 'Bài đọc') + ' — Aver Learning';
    $('rv-title').textContent = p.title || 'Bài đọc';

    var body = $('rv-body');
    body.innerHTML = window.renderMarkdown ? window.renderMarkdown(p.body_markdown || '') : '';

    // Lead image (Cloudinary) → lightbox. Also wire any inline images.
    if (p.image_url) {
      var img = document.createElement('img');
      img.className = 'prompt-chart-img'; img.src = p.image_url;
      img.alt = p.title || ''; img.setAttribute('role', 'button'); img.tabIndex = 0;
      body.insertBefore(img, body.firstChild);
    }
    body.querySelectorAll('img').forEach(function (im) {
      im.classList.add('prompt-chart-img');
      im.addEventListener('click', function () {
        if (window.AvImageLightbox) window.AvImageLightbox.open(im.src, im.alt);
      });
    });

    if (window.GlossaryPopover) window.GlossaryPopover.attach(body, p.glossary || []);
    renderQuestions(p.questions || []);
  }

  function load(slug) {
    showState('loading');
    SESSION.slug = slug;
    window.api.get('/api/reading/vocab/' + encodeURIComponent(slug))
      .then(function (p) {
        if (!p) { showState('empty'); return; }
        renderPassage(p);
        showState('ready');
        updateProgress();
      })
      .catch(function (e) {
        if (e && e.status === 404) { showState('empty'); }
        else { showError('Không tải được bài đọc. ' + (e && e.message ? e.message : '')); }
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.addEventListener('scroll', updateProgress, { passive: true });
    var slug = slugFromUrl();
    if (!slug) { showState('empty'); return; }
    load(slug);
  });
})();
