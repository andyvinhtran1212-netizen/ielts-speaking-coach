/* frontend/js/reading-exam.js — Sprint 20.6 L3 production exam UI.
 *
 * Wires the approved 20.4c exam-chrome mockup to the 20.5 backend. State
 * machine: loading → pre_start (or resume) → in_progress → results. Single
 * page, inline state switching (mirrors listening test-player).
 *
 * Backend contract (cluster 20.5 + 20.6):
 *   GET   /api/reading/test/{test_id}                            → test + passages + Qs (no answer keys)
 *   GET   /api/reading/test/{test_id}/attempts/in-progress       → resume an open attempt
 *   POST  /api/reading/test/{test_id}/attempts                   → start new attempt
 *   PATCH /api/reading/test/attempts/{attempt_id}/answers        → auto-save one answer
 *   POST  /api/reading/test/attempts/{attempt_id}/submit         → grade + finalise
 *
 * Code-authoritative decisions (surfaced in PR):
 *   • Chrome mechanism: scoped `.exam-chrome` (same CSS as 20.4c mockup);
 *     no Shadow-DOM web component (would be awkward for a full-page layout).
 *   • Interactions: duplicate mockup's palette/divider/contextmenu/highlight
 *     logic here rather than refactor into a shared module — keeps the
 *     approved mockup + its 20.4c sentinel untouched. Tech-debt acknowledged.
 *   • Auto-save: 500ms debounce per q_num on input/change. PATCH /answers is
 *     best-effort (soft-fail; in-memory + submit body are the source of truth).
 *   • Results inline (single page, no separate result URL).
 *   • Time-up: client auto-submits at zero + locks the chrome (.is-locked
 *     class disables inputs). Server-side Q5 guard backs this up (20.5).
 */
(function () {
  'use strict';

  // ── Bootstrap supabase (same anon key pattern as L1/L2 pages) ──────
  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {}
  }

  var $ = function (id) { return document.getElementById(id); };
  var chrome = document.querySelector('.exam-chrome');

  var SESSION = {
    test_id: null,
    test: null,
    attempt_id: null,
    started_at: null,
    time_limit_minutes: 60,
    answers: new Map(),         // q_num → user_answer (in-memory authoritative)
    flagged: new Set(),
    timer_interval: null,
    timer_locked: false,
    debounce_timers: new Map(), // q_num → setTimeout handle (auto-save debounce)
    resume_inprogress: false,   // Sprint 20.11 D5 — true when boot detected an
                                // open attempt; pre-start surfaces the Resume
                                // affordance and the Start button confirms.
  };

  // ── State machine ─────────────────────────────────────────────────
  // Sprint 20.10 D2 — the timer interval is now tied to the in_progress
  // state explicitly. Pre-20.10 the interval kept ticking after a
  // transition away from in_progress (e.g. an unexpected results render),
  // which combined with the CSS-hidden-override bug surfaced a visible
  // ticking timer on the loading / pre-start screens. Stopping the
  // interval here also guards against the same class of bug surfacing
  // again if a future state ever re-enters in_progress.
  function showState(name) {
    ['loading', 'error', 'prestart', 'inprogress', 'results'].forEach(function (s) {
      var elNode = $('state-' + s);
      if (elNode) elNode.hidden = s !== name;
    });
    $('exam-palette').hidden = name !== 'inprogress';
    $('exam-timer-wrap').hidden = name !== 'inprogress';
    if (name !== 'inprogress') stopTimer();
  }
  function stopTimer() {
    if (SESSION.timer_interval) {
      clearInterval(SESSION.timer_interval);
      SESSION.timer_interval = null;
    }
    // Blank the display so a stale "58:58" can't leak through if the wrap
    // is ever shown again before startTimer fires a fresh tick.
    var timer = $('exam-timer');
    if (timer) {
      timer.textContent = '--:--';
      timer.setAttribute('data-state', 'normal');
    }
  }
  function showError(msg) {
    $('error-msg').textContent = msg;
    showState('error');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ── URL parsing ───────────────────────────────────────────────────
  function testIdFromUrl() {
    return (new URLSearchParams(window.location.search).get('test_id') || '').trim() || null;
  }

  // Sprint 20.11 D5 — surface a resume affordance on pre-start when an
  // open attempt is detected. The 20.6 boot auto-resumed; that meant a
  // student stuck mid-attempt could not see the pre-start screen again
  // (Andy's dogfood: needed a SQL UPDATE to abandon the attempt and
  // start fresh). Now the pre-start shows BOTH "Resume" and "Start
  // fresh" when SESSION.resume_inprogress is set.
  function configurePreStartActions(hasResumable) {
    var startBtn = $('exam-start-btn');
    var resumeBtn = $('exam-resume-btn-prestart');
    if (resumeBtn) resumeBtn.hidden = !hasResumable;
    if (startBtn) {
      startBtn.textContent = hasResumable
        ? 'Bắt đầu lại từ đầu'        // restart wins (existing button)
        : 'Bắt đầu bài thi';          // fresh path (no prior attempt)
    }
  }

  // ── Pre-start render ──────────────────────────────────────────────
  function renderPreStart(test) {
    $('prestart-title').textContent = test.title || 'Reading Test';
    var meta = (test.passage_count || 3) + ' parts · ' +
               (test.total_questions || 40) + ' questions · ' +
               (test.time_limit_minutes || 60) + ' minutes';
    $('prestart-meta').textContent = meta;
    $('exam-test-label').textContent = test.title || 'Reading Test';
  }

  // ── Render passages (markdown body, all 3 stacked, independent scroll) ──
  function renderPassages(passages) {
    var host = $('exam-passage');
    host.innerHTML = '';
    passages.forEach(function (p, i) {
      var wrap = document.createElement('section');
      wrap.className = 'exam-passage__part';
      wrap.id = 'passage-' + (p.passage_order || (i + 1));
      var eyebrow = document.createElement('p');
      eyebrow.className = 'exam-passage__eyebrow';
      eyebrow.textContent = 'Passage ' + (p.passage_order || (i + 1));
      var title = document.createElement('h2');
      title.className = 'exam-passage__title';
      title.textContent = p.title || '';
      var body = document.createElement('div');
      body.className = 'exam-passage__body md-body';
      body.innerHTML = window.renderMarkdown ? window.renderMarkdown(p.body_markdown || '') : '';
      wrap.appendChild(eyebrow);
      wrap.appendChild(title);
      wrap.appendChild(body);
      host.appendChild(wrap);
    });
  }

  // ── Question-type instruction templates (Sprint 20.11 D2) ────────
  // English-language instruction blocks rendered above each consecutive
  // run of same-type questions inside a passage. Wording follows real BC /
  // IDP / Cambridge official-sample patterns so the surface feels familiar
  // to anyone who has practised against released materials. The optional
  // {part} and {options_count} placeholders are filled from runtime data.
  var QTYPE_INSTRUCTIONS = {
    matching_headings: function (range, ctx) {
      // The list of headings is shown per-question (dropdown), so the
      // instruction names the heading bank size when the part has a
      // consistent set, and references the choice slot otherwise.
      var n = ctx.optionsCount || '';
      return 'Questions ' + range + ': Reading Passage ' + ctx.part +
        ' has several paragraphs. Choose the correct heading for each ' +
        'paragraph from the list of headings' +
        (n ? ' (i–' + _toRoman(n) + ')' : '') + '. ' +
        'Select your answer from the dropdown beside each question.';
    },
    true_false_not_given: function (range, ctx) {
      return 'Questions ' + range + ': Do the following statements agree with ' +
        'the information given in Reading Passage ' + ctx.part + '? Choose ' +
        'TRUE if the statement agrees with the information, FALSE if the ' +
        'statement contradicts the information, or NOT GIVEN if there is ' +
        'no information on this in the passage.';
    },
    yes_no_not_given: function (range, ctx) {
      return 'Questions ' + range + ': Do the following statements agree with ' +
        "the claims of the writer in Reading Passage " + ctx.part + '? Choose ' +
        "YES if the statement agrees with the writer's claims, NO if the " +
        "statement contradicts the writer's claims, or NOT GIVEN if it is " +
        "impossible to say what the writer thinks about this.";
    },
    mcq_single: function (range, ctx) {
      var n = ctx.optionsCount;
      var letters = n === 5 ? 'A, B, C, D or E'
                   : n === 3 ? 'A, B or C'
                   : 'A, B, C or D';
      return 'Questions ' + range + ': Choose the correct letter, ' +
        letters + '.';
    },
    sentence_completion: function (range) {
      return 'Questions ' + range + ': Complete the sentences below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    summary_completion: function (range) {
      return 'Questions ' + range + ': Complete the summary below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    notes_completion: function (range) {
      return 'Questions ' + range + ': Complete the notes below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    table_completion: function (range) {
      return 'Questions ' + range + ': Complete the table below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    form_completion: function (range) {
      return 'Questions ' + range + ': Complete the form below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    short_answer: function (range) {
      return 'Questions ' + range + ': Answer the questions below. Choose ' +
        'NO MORE THAN THREE WORDS from the passage for each answer.';
    },
  };
  function _toRoman(n) {
    var roman = ['','i','ii','iii','iv','v','vi','vii','viii','ix','x',
                 'xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx'];
    return roman[n] || String(n);
  }
  function _qRangeLabel(qs) {
    var first = qs[0].q_num, last = qs[qs.length - 1].q_num;
    return first === last ? String(first) : first + '–' + last;
  }

  // ── Render questions (grouped by passage_order; per-type instruction
  //    block above each consecutive run of same-typed questions) ───
  function renderQuestions(questions) {
    var host = $('exam-questions');
    host.innerHTML = '';
    // Group by passage_order (preserves the part-level header from 20.6).
    var byPart = new Map();
    questions.forEach(function (q) {
      var part = q.passage_order || 1;
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push(q);
    });
    Array.from(byPart.keys()).sort(function (a, b) { return a - b; }).forEach(function (part) {
      var partQs = byPart.get(part);
      var partHeading = document.createElement('div');
      partHeading.className = 'exam-questions__part-heading';
      partHeading.innerHTML = '<strong>Part ' + part + '</strong> — Questions ' +
                              partQs[0].q_num + '–' + partQs[partQs.length - 1].q_num;
      host.appendChild(partHeading);

      // Sprint 20.11 D2 — sub-group by question_type within the part.
      // Consecutive runs of the same type share one instruction block;
      // a type change starts a new block (so a Part with matching_headings
      // → T/F/NG → short_answer shows three labelled instruction blocks).
      var typeRuns = _consecutiveTypeRuns(partQs);
      typeRuns.forEach(function (run) {
        var type = run[0].question_type;
        var rangeLabel = _qRangeLabel(run);
        var instructionEl = document.createElement('div');
        instructionEl.className = 'exam-questions__instructions exam-questions__instructions--type';
        instructionEl.setAttribute('data-question-type', type);
        var template = QTYPE_INSTRUCTIONS[type];
        // optionsCount: matching_headings uses the heading-bank size; mcq uses
        // the choice count. Read from the FIRST question in the run as a
        // representative — same-typed runs in real IELTS share the same
        // option bank.
        var optionsCount = (run[0].payload && Array.isArray(run[0].payload.options))
          ? run[0].payload.options.length : 0;
        var ctx = { part: part, optionsCount: optionsCount };
        instructionEl.textContent = template
          ? template(rangeLabel, ctx)
          : 'Questions ' + rangeLabel + '.';
        host.appendChild(instructionEl);
        run.forEach(function (q) { host.appendChild(renderQuestion(q)); });
      });
    });
  }
  function _consecutiveTypeRuns(qs) {
    if (!qs.length) return [];
    var runs = []; var cur = [qs[0]];
    for (var i = 1; i < qs.length; i++) {
      if (qs[i].question_type === cur[0].question_type) cur.push(qs[i]);
      else { runs.push(cur); cur = [qs[i]]; }
    }
    runs.push(cur);
    return runs;
  }

  function renderQuestion(q) {
    var card = document.createElement('div');
    card.className = 'exam-q';
    card.id = 'q-' + q.q_num;
    card.dataset.q = String(q.q_num);

    var num = document.createElement('span');
    num.className = 'exam-q__num'; num.textContent = String(q.q_num);

    var body = document.createElement('div');
    body.className = 'exam-q__body';
    var prompt = document.createElement('p');
    prompt.className = 'exam-q__prompt'; prompt.textContent = q.prompt || '';
    body.appendChild(prompt);
    renderInputs(body, q);

    var flag = document.createElement('button');
    flag.type = 'button'; flag.className = 'exam-q__flag';
    flag.setAttribute('aria-pressed', 'false');
    flag.setAttribute('aria-label', 'Flag question ' + q.q_num + ' for review');
    flag.textContent = '⚑';
    flag.addEventListener('click', function () { toggleFlag(q.q_num, flag); });

    card.appendChild(num); card.appendChild(body); card.appendChild(flag);

    card.addEventListener('change', function () { onAnswerChanged(q.q_num, card); });
    card.addEventListener('input',  function () { onAnswerChanged(q.q_num, card); });
    return card;
  }

  function renderInputs(body, q) {
    var name = 'q-' + q.q_num;
    var type = q.question_type;
    if (type === 'mcq_single') {
      var opts = document.createElement('div'); opts.className = 'exam-q__options';
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var text = o.label != null ? (o.label + '. ' + (o.text || '')) : (o.text || '');
        opts.appendChild(radioOption(name, val, text));
      });
      body.appendChild(opts);
    } else if (type === 'true_false_not_given' || type === 'yes_no_not_given') {
      // Sprint 20.13a A2 — TFNG / YNG render as <select> dropdown (standards
      // §2.3a, anti-pattern §10.1: "TFNG/YNG bắt gõ chữ 'TRUE/FALSE' (phải
      // là dropdown)"). The 20.6 implementation used three radio buttons;
      // gold reference + BC/IDP both use a dropdown so the input control
      // matches Matching Headings + Matching Features etc. The control type
      // change is silent for grading — the persisted value is the same
      // canonical TRUE/FALSE/NOT GIVEN string.
      var vals = type === 'true_false_not_given'
        ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
      var sel = document.createElement('select');
      sel.className = 'exam-q__select'; sel.name = name;
      sel.setAttribute('aria-label', 'Answer ' + q.q_num);
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— Select —';
      sel.appendChild(ph);
      vals.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      });
      body.appendChild(sel);
    } else if (type === 'matching_headings') {
      var sel = document.createElement('select');
      sel.className = 'exam-q__select'; sel.name = name;
      var ph = document.createElement('option');
      // Sprint 20.11 D4 — English inside exam content (real IELTS fidelity).
      // The pre-start, modals, and Hide/Help chrome stay Vietnamese (app
      // voice); the surface a student reads to answer an IELTS question
      // is English to match BC / IDP / Cambridge official samples.
      ph.value = ''; ph.textContent = '— Select —';
      sel.appendChild(ph);
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var text = o.label != null ? (o.label + '. ' + (o.text || '')) : (o.text || '');
        var opt = document.createElement('option');
        opt.value = val; opt.textContent = text;
        sel.appendChild(opt);
      });
      body.appendChild(sel);
    } else {
      // short_answer / *_completion text gap
      var input = document.createElement('input');
      input.type = 'text'; input.className = 'exam-q__gap'; input.name = name;
      // Sprint 20.11 D4 — English inside exam content (see _qRangeLabel note).
      input.placeholder = 'Type your answer…';
      body.appendChild(input);
    }
  }
  function radioOption(name, value, labelText) {
    var label = document.createElement('label'); label.className = 'exam-q__option';
    var input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = value;
    var span = document.createElement('span'); span.textContent = labelText;
    label.appendChild(input); label.appendChild(span);
    return label;
  }
  function readAnswer(card) {
    var input = card.querySelector('.exam-q__gap');
    if (input) return input.value;
    var checked = card.querySelector('input[type="radio"]:checked');
    if (checked) return checked.value;
    var sel = card.querySelector('select');
    if (sel) return sel.value;
    return '';
  }

  // ── Answer state + auto-save (debounced) ───────────────────────────
  function onAnswerChanged(qNum, card) {
    var value = readAnswer(card);
    SESSION.answers.set(qNum, value);
    markAnswered(qNum);
    if (SESSION.debounce_timers.has(qNum)) clearTimeout(SESSION.debounce_timers.get(qNum));
    SESSION.debounce_timers.set(qNum, setTimeout(function () {
      patchAnswer(qNum, value);
      SESSION.debounce_timers.delete(qNum);
    }, 500));
  }
  function patchAnswer(qNum, userAnswer) {
    if (!SESSION.attempt_id || SESSION.timer_locked) return;
    window.api.patch('/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/answers',
      { q_num: qNum, user_answer: String(userAnswer || '') }
    ).catch(function (e) {
      // Best-effort auto-save — the source of truth is in-memory + submit body.
      if (window.console) console.warn('auto-save failed q=' + qNum, e && e.message);
    });
  }
  function restoreAnswers() {
    SESSION.answers.forEach(function (value, qNum) {
      var card = document.getElementById('q-' + qNum);
      if (!card) return;
      var input = card.querySelector('.exam-q__gap');
      if (input) { input.value = value || ''; markAnswered(qNum); return; }
      var sel = card.querySelector('select');
      if (sel) { sel.value = value || ''; markAnswered(qNum); return; }
      try {
        var radio = card.querySelector('input[type="radio"][value="' +
          (window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"')) + '"]');
        if (radio) { radio.checked = true; markAnswered(qNum); }
      } catch (e) {}
    });
  }

  // ── Palette ───────────────────────────────────────────────────────
  // Sprint 20.10 D3 — group questions by passage_order ("Part 1 / 2 / 3")
  // to match real Cambridge IELTS / BC / IDP exam UX. The mockup approval
  // (20.4c) shipped a flat 1-N grid; production dogfood surfaced that the
  // grouping is institutional-fidelity. Layout: 3 groups in a single
  // flex row across the bottom (CSS gates each group's width), each with
  // its own label + buttons. Falls back gracefully to a flat layout if
  // `questions` is absent (legacy callers or partial test bundles).
  function renderPalette(totalQs, questions) {
    var grid = $('exam-palette-grid'); grid.innerHTML = '';
    var groups = _groupQuestionsByPart(totalQs, questions);
    if (groups.length === 1) {
      // Flat fallback — unchanged shape from the pre-20.10 renderer.
      groups[0].qnums.forEach(function (q) { grid.appendChild(_makePaletteBtn(q)); });
      return;
    }
    groups.forEach(function (group) {
      var groupEl = document.createElement('div');
      groupEl.className = 'exam-palette__group';
      groupEl.setAttribute('aria-label', group.label);
      var labelEl = document.createElement('span');
      labelEl.className = 'exam-palette__group-label';
      labelEl.textContent = group.label;
      groupEl.appendChild(labelEl);
      var btnsEl = document.createElement('div');
      btnsEl.className = 'exam-palette__group-btns';
      group.qnums.forEach(function (q) { btnsEl.appendChild(_makePaletteBtn(q)); });
      groupEl.appendChild(btnsEl);
      grid.appendChild(groupEl);
    });
  }
  function _makePaletteBtn(q) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'exam-palette__q';
    btn.dataset.q = String(q);
    btn.setAttribute('aria-label', 'Question ' + q);
    btn.textContent = String(q);
    btn.addEventListener('click', function () { jumpTo(q); });
    return btn;
  }
  function _groupQuestionsByPart(totalQs, questions) {
    // Build {1: [q_nums], 2: […], 3: […]} from the questions list's
    // per-question passage_order (stamped server-side in 20.6 student
    // detail). Fall back to a single flat group when grouping data is
    // missing — this lets the UI degrade safely on legacy tests.
    if (!Array.isArray(questions) || !questions.length) {
      var flat = [];
      for (var q = 1; q <= totalQs; q++) flat.push(q);
      return [{ label: 'Questions', qnums: flat }];
    }
    var byOrder = {};
    questions.forEach(function (q) {
      var order = q && q.passage_order;
      if (!order || !q.q_num) return;
      (byOrder[order] = byOrder[order] || []).push(q.q_num);
    });
    var orders = Object.keys(byOrder).map(Number).sort(function (a, b) { return a - b; });
    if (!orders.length) {
      var fallback = [];
      for (var i = 1; i <= totalQs; i++) fallback.push(i);
      return [{ label: 'Questions', qnums: fallback }];
    }
    return orders.map(function (order) {
      var qnums = byOrder[order].slice().sort(function (a, b) { return a - b; });
      return { label: 'Part ' + order, qnums: qnums };
    });
  }
  function jumpTo(qNum) {
    var card = document.getElementById('q-' + qNum);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrent(qNum);
  }
  function setCurrent(qNum) {
    document.querySelectorAll('.exam-palette__q').forEach(function (b) {
      b.classList.toggle('is-current', b.dataset.q === String(qNum));
    });
    document.querySelectorAll('.exam-q').forEach(function (c) {
      c.classList.toggle('is-current', c.dataset.q === String(qNum));
    });
  }
  function markAnswered(qNum) {
    var btn = document.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (btn) btn.classList.add('is-answered');
  }
  function toggleFlag(qNum, flagBtn) {
    var pressed = flagBtn.getAttribute('aria-pressed') !== 'true';
    flagBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (pressed) SESSION.flagged.add(qNum); else SESSION.flagged['delete'](qNum);
    var btn = document.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (btn) btn.classList.toggle('is-flagged', pressed);
  }

  // ── Timer: production countdown from started_at + time_limit ──────
  function startTimer() {
    // Sprint 20.10 D2 — defence in depth. Clear any prior interval (so a
    // second enterInProgress call from an unusual code path doesn't run
    // two ticks per second) and require the in_progress state shell to
    // be visible. If the state machine is somewhere else, don't tick.
    stopTimer();
    if ($('state-inprogress') && $('state-inprogress').hidden) return;
    var limitSec = (SESSION.time_limit_minutes || 60) * 60;
    var startedMs = SESSION.started_at ? Date.parse(SESSION.started_at) : Date.now();
    var tick = function () {
      var elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      var remaining = Math.max(0, limitSec - elapsed);
      var timer = $('exam-timer');
      timer.textContent = formatTime(remaining);
      if (remaining <= 300 && timer.getAttribute('data-state') !== 'critical') {
        timer.setAttribute('data-state', 'critical');
      } else if (remaining <= 600 && timer.getAttribute('data-state') === 'normal') {
        timer.setAttribute('data-state', 'warning');
      }
      if (remaining <= 0) {
        if (SESSION.timer_interval) {
          clearInterval(SESSION.timer_interval);
          SESSION.timer_interval = null;
        }
        autoSubmit();
      }
    };
    tick();
    SESSION.timer_interval = setInterval(tick, 1000);
  }
  function formatTime(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function lockExam() {
    if (chrome) chrome.classList.add('is-locked');
    SESSION.timer_locked = true;
  }

  // ── Submit flow ───────────────────────────────────────────────────
  function openSubmitModal() {
    var total = (SESSION.test && SESSION.test.total_questions) || 40;
    var answered = SESSION.answers.size;
    var unanswered = total - answered;
    $('exam-submit-warn').textContent = unanswered > 0
      ? 'Bạn còn ' + unanswered + '/' + total + ' câu chưa trả lời. Nộp luôn?'
      : 'Bạn đã trả lời tất cả ' + total + ' câu.';
    $('exam-submit-modal').hidden = false;
  }
  function closeSubmitModal() { $('exam-submit-modal').hidden = true; }

  function autoSubmit() {
    // Time-up: lock UI first so further input is impossible, then submit.
    lockExam();
    submitAttempt(/* fromAutoSubmit */ true);
  }
  function submitAttempt(fromAutoSubmit) {
    if (!SESSION.attempt_id) return;
    // Flush any pending debounced PATCH for cleanliness (best-effort).
    SESSION.debounce_timers.forEach(function (handle, qNum) {
      clearTimeout(handle);
      var card = document.getElementById('q-' + qNum);
      if (card) patchAnswer(qNum, readAnswer(card));
    });
    SESSION.debounce_timers.clear();

    var answers = [];
    SESSION.answers.forEach(function (value, qNum) {
      answers.push({ q_num: qNum, user_answer: String(value) });
    });

    window.api.post(
      '/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/submit',
      { answers: answers }
    ).then(function (result) {
      lockExam();
      if (SESSION.timer_interval) {
        clearInterval(SESSION.timer_interval);
        SESSION.timer_interval = null;
      }
      renderResults(result);
      showState('results');
    }).catch(function (e) {
      if (e && e.status === 422) {
        showError('Bài thi đã hết giờ. ' + (e.message || ''));
      } else {
        showError('Không nộp được bài. ' + (e && e.message ? e.message : ''));
      }
    });
  }

  // ── Results render ────────────────────────────────────────────────
  var SKILL_LABEL = {
    skimming: 'Skimming', scanning: 'Scanning', detail: 'Detail',
    main_idea: 'Main idea', inference: 'Inference',
    vocabulary_in_context: 'Vocab in context',
    reference_cohesion: 'Reference / cohesion',
    writer_view_TFNG: "Writer's view (T/F/NG)",
  };
  function diagnosticLevelLabel(level) {
    if (level === 'weak') return 'Cần ưu tiên';
    if (level === 'watch') return 'Nên luyện thêm';
    return 'Ổn định';
  }
  function diagnosticTrendText(trend) {
    if (!trend || trend.direction === 'first_attempt') {
      return 'Chưa có attempt trước để so sánh xu hướng.';
    }
    if (trend.direction === 'improving') {
      return 'Đang cải thiện +' + Math.abs(trend.delta_pct || 0) + ' điểm so với lần trước.';
    }
    if (trend.direction === 'declining') {
      return 'Đang giảm ' + Math.abs(trend.delta_pct || 0) + ' điểm so với lần trước.';
    }
    return 'Xu hướng đang ổn định so với lần trước.';
  }
  function setDiagnosticStatus(message, isError) {
    var status = $('results-diagnostic-status');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
    status.style.color = isError ? 'var(--exam-critical)' : 'var(--exam-text-secondary)';
  }
  function renderDiagnostic(diag) {
    var host = $('results-diagnostic');
    var intro = $('results-diagnostic-intro');
    if (!host || !intro) return;
    host.innerHTML = '';

    if (!diag || !diag.skills || !diag.skills.length) {
      intro.textContent = 'Chưa có đủ dữ liệu submitted để tạo diagnostic. Hãy hoàn thành ít nhất một full test.';
      host.innerHTML = '<div class="exam-results-diagnostic__empty">Diagnostic sẽ xuất hiện sau khi bạn có submitted attempt đầu tiên.</div>';
      return;
    }

    var focus = diag.focus_skills || [];
    if (!focus.length) {
      intro.textContent = 'Hiện chưa có kỹ năng nào rơi vào vùng yếu hoặc cần theo dõi. Bạn vẫn có thể xem breakdown phía trên để duy trì phong độ.';
      host.innerHTML = '<div class="exam-results-diagnostic__empty">Không có skill nào dưới ngưỡng 75% ở attempt này.</div>';
      return;
    }

    intro.textContent = 'Các skill dưới đây được xếp theo mức cần ưu tiên dựa trên attempt vừa nộp, có kèm xu hướng từ các full-test trước và bài L2 nên luyện tiếp.';
    focus.forEach(function (item) {
      var card = document.createElement('section');
      card.className = 'exam-diagnostic-card';
      var recs = item.recommendations || [];
      var links = recs.length
        ? recs.map(function (rec) {
            var meta = [];
            if (rec.skill_focus) meta.push(SKILL_LABEL[rec.skill_focus] || rec.skill_focus);
            if (rec.difficulty_level) meta.push(rec.difficulty_level);
            if (rec.estimated_minutes) meta.push(rec.estimated_minutes + ' phút');
            return '<a href="/pages/reading-skill-exercise.html?slug=' + encodeURIComponent(rec.slug) + '">' +
              '<strong>' + escapeHtml(rec.title || rec.slug || 'Bài luyện kỹ năng') + '</strong>' +
              '<span>' + escapeHtml(meta.join(' · ')) + '</span>' +
            '</a>';
          }).join('')
        : '<div class="exam-results-diagnostic__empty">Chưa có bài L2 published khớp trực tiếp với skill này.</div>';

      card.innerHTML =
        '<div class="exam-diagnostic-card__top">' +
          '<div>' +
            '<h4 class="exam-diagnostic-card__title">' + escapeHtml(item.label || item.skill_tag) + '</h4>' +
            '<p class="exam-diagnostic-card__meta">' + escapeHtml(diagnosticTrendText(item.trend)) + '</p>' +
          '</div>' +
          '<span class="exam-diagnostic-card__pill" data-level="' + escapeHtml(item.diagnostic_level || 'strong') + '">' +
            escapeHtml(diagnosticLevelLabel(item.diagnostic_level)) +
          '</span>' +
        '</div>' +
        '<div class="exam-diagnostic-card__stats">' +
          '<div class="exam-diagnostic-card__stat">' +
            '<span class="exam-diagnostic-card__stat-label">Attempt này</span>' +
            '<div class="exam-diagnostic-card__stat-value">' + item.current.correct + '/' + item.current.total + ' · ' + item.current.accuracy_pct + '%</div>' +
          '</div>' +
          '<div class="exam-diagnostic-card__stat">' +
            '<span class="exam-diagnostic-card__stat-label">Tổng gần đây</span>' +
            '<div class="exam-diagnostic-card__stat-value">' + item.aggregate.correct + '/' + item.aggregate.total + ' · ' + item.aggregate.accuracy_pct + '%</div>' +
          '</div>' +
          '<div class="exam-diagnostic-card__stat">' +
            '<span class="exam-diagnostic-card__stat-label">Bài L2 gợi ý</span>' +
            '<div class="exam-diagnostic-card__stat-value">' + (item.recommendation_count || 0) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="exam-diagnostic-card__links">' + links + '</div>';
      host.appendChild(card);
    });
  }
  function loadDiagnostic(attemptId) {
    var host = $('results-diagnostic');
    var intro = $('results-diagnostic-intro');
    if (!host || !attemptId) return;
    host.innerHTML = '';
    if (intro) intro.textContent = 'Đang phân tích weak skills và gợi ý bài L2 phù hợp…';
    setDiagnosticStatus('Đang tải diagnostic...', false);
    window.api.get('/api/reading/diagnostic?attempt_id=' + encodeURIComponent(attemptId))
      .then(function (diag) {
        setDiagnosticStatus('', false);
        renderDiagnostic(diag);
      })
      .catch(function (e) {
        if (intro) intro.textContent = 'Kết quả bài thi vẫn chính xác, nhưng diagnostic nâng cao chưa tải được.';
        host.innerHTML = '<div class="exam-results-diagnostic__empty">Bạn có thể quay lại thư viện L2 để luyện thêm theo skill breakdown phía trên.</div>';
        setDiagnosticStatus('Không tải được diagnostic. ' + (e && e.message ? e.message : ''), true);
      });
  }
  function renderResults(result) {
    $('results-score').textContent = (result.score != null ? result.score : '—') + '/' + (result.max_score != null ? result.max_score : '40');
    $('results-band').textContent = result.band_estimate != null ? ('Band ' + result.band_estimate) : 'Band —';

    var byPartHost = $('results-by-part'); byPartHost.innerHTML = '';
    ['p1', 'p2', 'p3'].forEach(function (key) {
      var row = (result.by_part || {})[key];
      if (!row) return;
      var cell = document.createElement('div');
      cell.className = 'exam-results-bygrid__cell';
      cell.innerHTML =
        '<div class="exam-results-bygrid__label">Part ' + key.slice(1) + '</div>' +
        '<div class="exam-results-bygrid__value">' + row.correct + '/' + row.total + '</div>';
      byPartHost.appendChild(cell);
    });

    var skillHost = $('results-skill'); skillHost.innerHTML = '';
    Object.keys(result.skill_breakdown || {}).forEach(function (tag) {
      var row = result.skill_breakdown[tag];
      var pct = row.total ? Math.round((row.correct / row.total) * 100) : 0;
      var div = document.createElement('div');
      div.className = 'exam-results-skillrow';
      div.innerHTML =
        '<div class="exam-results-skillrow__label">' + escapeHtml(SKILL_LABEL[tag] || tag) + '</div>' +
        '<div class="exam-results-skillrow__bar"><div class="exam-results-skillrow__bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="exam-results-skillrow__value">' + row.correct + '/' + row.total + '</div>';
      skillHost.appendChild(div);
    });

    var revHost = $('results-review'); revHost.innerHTML = '';
    (result.per_question || []).forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'exam-results-review__row';
      row.innerHTML =
        '<div class="exam-results-review__num">' + r.q_num + '</div>' +
        '<div class="exam-results-review__verdict ' + (r.correct ? 'is-correct' : 'is-incorrect') + '">' +
          (r.correct ? '✓' : '✗') + '</div>' +
        '<div class="exam-results-review__user">' + escapeHtml(r.user_answer || '—') + '</div>' +
        '<div class="exam-results-review__expected">' + escapeHtml(r.expected || '') + '</div>';
      revHost.appendChild(row);
    });

    loadDiagnostic(result.attempt_id);
  }

  // ── Settings popover (text-size A/A/A + theme swatches) ─────────
  // Sprint 20.13a A3 + A4 — persist text-size and exam theme to
  // localStorage so the student's display preferences survive page
  // refresh + resume. Keys are SCOPED to the exam page (not the global
  // av-theme app theme) and read with try/catch so private-browsing
  // failures degrade silently (standards §5.1).
  var EXAM_PREFS_KEY_SIZE  = 'ielts-exam-text-size';
  var EXAM_PREFS_KEY_THEME = 'ielts-exam-theme';
  var VALID_SIZES  = ['small', 'medium', 'large'];
  var VALID_THEMES = ['default', 'cream', 'dark', 'yellow-on-blue'];
  function _safeGetStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function _safeSetStorage(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  (function applyStoredDisplayPrefs() {
    var size = _safeGetStorage(EXAM_PREFS_KEY_SIZE);
    if (size && VALID_SIZES.indexOf(size) !== -1) {
      chrome.setAttribute('data-text-size', size);
    }
    var theme = _safeGetStorage(EXAM_PREFS_KEY_THEME);
    if (theme && VALID_THEMES.indexOf(theme) !== -1) {
      chrome.setAttribute('data-exam-theme', theme);
    }
  })();

  (function wireSettings() {
    var toggle = $('exam-settings-toggle'), popover = $('exam-settings');
    if (!toggle || !popover) return;
    var setOpen = function (open) {
      popover.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', function () { setOpen(popover.hidden); });
    document.addEventListener('click', function (ev) {
      if (popover.hidden) return;
      if (toggle.contains(ev.target) || popover.contains(ev.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !popover.hidden) setOpen(false);
    });

    // Reflect any stored prefs into aria-pressed states so the open popover
    // shows the right active swatches before the user clicks anything.
    function syncPressedFromAttributes() {
      var size = chrome.getAttribute('data-text-size') || 'medium';
      popover.querySelectorAll('[data-size]').forEach(function (b) {
        var on = b.dataset.size === size;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var theme = chrome.getAttribute('data-exam-theme') || 'default';
      popover.querySelectorAll('[data-theme]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.theme === theme ? 'true' : 'false');
      });
    }
    syncPressedFromAttributes();

    popover.querySelectorAll('[data-size]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        chrome.setAttribute('data-text-size', btn.dataset.size);
        _safeSetStorage(EXAM_PREFS_KEY_SIZE, btn.dataset.size);    // 20.13a A4
        syncPressedFromAttributes();
      });
    });
    // Sprint 20.13a A3 — theme swatch handlers.
    popover.querySelectorAll('[data-theme]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        chrome.setAttribute('data-exam-theme', btn.dataset.theme);
        _safeSetStorage(EXAM_PREFS_KEY_THEME, btn.dataset.theme);
        syncPressedFromAttributes();
      });
    });
  })();

  // ── Hide / Help / submit-modal wiring ─────────────────────────────
  $('exam-hide-toggle').addEventListener('click', function () {
    $('exam-hide-overlay').hidden = false;
    $('exam-hide-toggle').setAttribute('aria-pressed', 'true');
  });
  $('exam-resume-btn').addEventListener('click', function () {
    $('exam-hide-overlay').hidden = true;
    $('exam-hide-toggle').setAttribute('aria-pressed', 'false');
  });
  $('exam-help-toggle').addEventListener('click', function () { $('exam-help-modal').hidden = false; });
  $('exam-help-close').addEventListener('click', function () { $('exam-help-modal').hidden = true; });
  $('exam-help-modal').querySelector('[data-close="help"]').addEventListener('click',
    function () { $('exam-help-modal').hidden = true; });

  $('exam-submit-btn').addEventListener('click', openSubmitModal);
  $('exam-submit-cancel').addEventListener('click', closeSubmitModal);
  $('exam-submit-modal').querySelector('[data-close="submit"]').addEventListener('click', closeSubmitModal);
  $('exam-submit-confirm').addEventListener('click', function () {
    closeSubmitModal();
    submitAttempt(false);
  });
  $('exam-prev').addEventListener('click', function () { navStep(-1); });
  $('exam-next').addEventListener('click', function () { navStep(1); });
  function navStep(delta) {
    var palette = Array.from(document.querySelectorAll('.exam-palette__q'));
    if (!palette.length) return;
    var idx = palette.findIndex(function (b) { return b.classList.contains('is-current'); });
    if (idx < 0) idx = 0;
    var next = Math.max(0, Math.min(palette.length - 1, idx + delta));
    palette[next].click();
  }

  // ── Draggable divider (port from mockup) ──────────────────────────
  (function wireDivider() {
    var split = document.querySelector('.exam-split');
    var divider = $('exam-divider');
    if (!split || !divider) return;
    try {
      var saved = parseFloat(sessionStorage.getItem('exam-split-pct'));
      if (Number.isFinite(saved) && saved >= 30 && saved <= 70) {
        split.style.setProperty('--exam-split-left', saved + '%');
      }
    } catch (e) {}
    var dragging = false;
    var dragX = function (ev) {
      if (ev.clientX != null) return ev.clientX;
      if (ev.touches && ev.touches[0]) return ev.touches[0].clientX;
      return null;
    };
    var onMove = function (ev) {
      if (!dragging) return;
      var x = dragX(ev); if (x == null) return;
      var rect = split.getBoundingClientRect();
      var pct = ((x - rect.left) / rect.width) * 100;
      var clamped = Math.max(30, Math.min(70, pct));
      split.style.setProperty('--exam-split-left', clamped + '%');
      try { sessionStorage.setItem('exam-split-pct', String(clamped)); } catch (e) {}
      ev.preventDefault();
    };
    var endDrag = function () {
      if (!dragging) return;
      dragging = false;
      divider.classList.remove('is-dragging');
      document.body.style.userSelect = '';
    };
    var startDrag = function (ev) {
      dragging = true;
      divider.classList.add('is-dragging');
      document.body.style.userSelect = 'none';
      ev.preventDefault();
    };
    divider.addEventListener('mousedown',  startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   endDrag);
    document.addEventListener('touchend',  endDrag);
    divider.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var cs = getComputedStyle(split).getPropertyValue('--exam-split-left');
      var cur = parseFloat(cs) || 50;
      var delta = ev.key === 'ArrowLeft' ? -2 : 2;
      var clamped = Math.max(30, Math.min(70, cur + delta));
      split.style.setProperty('--exam-split-left', clamped + '%');
      try { sessionStorage.setItem('exam-split-pct', String(clamped)); } catch (e) {}
      ev.preventDefault();
    });
  })();

  // ── Right-click context menu + highlight + note popover (port from mockup) ──
  (function wireContextMenu() {
    var ctxMenu = $('exam-context-menu');
    var notePop = $('exam-note-popover');
    var noteTA  = $('exam-note-textarea');
    if (!ctxMenu) return;

    var savedRange = null;
    var ctxTargetSpan = null;
    var notePopTargetSpan = null;

    function positionPopover(el, x, y) {
      var maxLeft = window.innerWidth - el.offsetWidth - 8;
      var maxTop  = window.innerHeight - el.offsetHeight - 8;
      el.style.left = Math.max(8, Math.min(x, maxLeft)) + 'px';
      el.style.top  = Math.max(8, Math.min(y, maxTop)) + 'px';
    }
    function hideContextMenu() { ctxMenu.hidden = true; }
    function hideNotePopover() { notePop.hidden = true; notePopTargetSpan = null; }
    function showContextMenu(x, y) {
      var sel = window.getSelection();
      var hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
      savedRange = hasSelection ? sel.getRangeAt(0).cloneRange() : null;
      var onHl = ctxTargetSpan;
      ctxMenu.querySelector('[data-action="highlight"]').hidden = !hasSelection;
      ctxMenu.querySelector('[data-action="note"]').hidden      = !hasSelection;
      ctxMenu.querySelector('[data-action="remove"]').hidden    = !onHl;
      // Sprint 20.13a A5 — colour swatches relevant only when something is
      // selected (we can recolour by re-highlighting the selection); hide
      // on "click an existing highlight to remove" path.
      var colorRow = ctxMenu.querySelector('.exam-context-menu__colors');
      if (colorRow) colorRow.hidden = !hasSelection;
      if (!hasSelection && !onHl) return;
      ctxMenu.hidden = false;
      positionPopover(ctxMenu, x, y);
    }
    ['#exam-passage', '#exam-questions'].forEach(function (sel) {
      var panel = document.querySelector(sel); if (!panel) return;
      panel.addEventListener('contextmenu', function (ev) {
        ctxTargetSpan = ev.target.closest && ev.target.closest('.exam-highlight.is-user');
        ev.preventDefault();
        showContextMenu(ev.pageX, ev.pageY);
      });
    });
    document.addEventListener('mousedown', function (ev) {
      if (!ctxMenu.hidden && !ctxMenu.contains(ev.target)) hideContextMenu();
      if (!notePop.hidden && !notePop.contains(ev.target)
          && !(ev.target.classList && ev.target.classList.contains('exam-note-marker'))) {
        hideNotePopover();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { hideContextMenu(); hideNotePopover(); }
    });

    function applyHighlight(range, options) {
      options = options || {};
      var startNode = range.startContainer, endNode = range.endContainer;
      var root = range.commonAncestorContainer;
      var textNodes = [];
      if (startNode === endNode && startNode.nodeType === 3) {
        textNodes.push(startNode);
      } else {
        var walkerRoot = root.nodeType === 3 ? root.parentNode : root;
        var walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT);
        var cur, inRange = false;
        while ((cur = walker.nextNode())) {
          if (cur === startNode) inRange = true;
          if (inRange && cur.nodeValue.length > 0) textNodes.push(cur);
          if (cur === endNode) break;
        }
      }
      // Sprint 20.13a A5 — multi-colour highlight per standards §3 tokens.
      // 20.4b used a single yellow tint hard-coded in CSS. The standards-
      // compliant version stamps the colour as a class on each created
      // span (`c-yellow|c-green|c-pink`) so persistence + theme
      // legibility work uniformly. Falls back to `c-yellow` when no
      // colour is passed (matches the 20.4b default).
      var VALID_HL_COLORS = { 'c-yellow': 1, 'c-green': 1, 'c-pink': 1 };
      var colorClass = (options.color && VALID_HL_COLORS[options.color])
        ? options.color : 'c-yellow';
      var created = [];
      textNodes.forEach(function (textNode) {
        var startOff = (textNode === startNode) ? range.startOffset : 0;
        var endOff   = (textNode === endNode)   ? range.endOffset   : textNode.nodeValue.length;
        if (startOff >= endOff) return;
        var before = textNode.nodeValue.slice(0, startOff);
        var middle = textNode.nodeValue.slice(startOff, endOff);
        var after  = textNode.nodeValue.slice(endOff);
        if (!middle.replace(/\s/g, '').length) return;
        var span = document.createElement('span');
        span.className = 'exam-highlight is-user ' + colorClass;
        span.textContent = middle;
        var parent = textNode.parentNode, next = textNode.nextSibling;
        parent.removeChild(textNode);
        if (before) parent.insertBefore(document.createTextNode(before), next);
        parent.insertBefore(span, next);
        if (after) parent.insertBefore(document.createTextNode(after), next);
        created.push(span);
      });
      if (options.note != null && created.length) attachNoteMarker(created, options.note);
      window.getSelection().removeAllRanges();
      return created;
    }
    function attachNoteMarker(spans, noteText) {
      if (!spans || !spans.length) return null;
      spans.forEach(function (s) { s.setAttribute('data-note', noteText || ''); });
      var marker = document.createElement('span');
      marker.className = 'exam-note-marker';
      marker.setAttribute('role', 'button'); marker.setAttribute('tabindex', '0');
      marker.setAttribute('aria-label', 'View note');
      marker.textContent = 'note';
      marker._highlightSpans = spans;
      spans[spans.length - 1].after(marker);
      spans.forEach(function (s) { s._noteMarker = marker; });
      return marker;
    }
    function removeHighlight(span) {
      if (!span) return;
      if (span._noteMarker && span._noteMarker.parentNode) {
        span._noteMarker.parentNode.removeChild(span._noteMarker);
      }
      var parent = span.parentNode; if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    function openNoteEditor(span, x, y) {
      notePopTargetSpan = span;
      noteTA.value = span.getAttribute('data-note') || '';
      notePop.hidden = false;
      positionPopover(notePop, x, y);
      noteTA.focus();
    }
    ctxMenu.addEventListener('click', function (ev) {
      // Sprint 20.13a A5 — colour-swatch path: apply highlight with the
      // chosen colour. The swatch click takes precedence over the
      // (default-yellow) Highlight item because the user has explicitly
      // picked a colour.
      var swatch = ev.target.closest('.exam-context-menu__color');
      if (swatch && savedRange) {
        applyHighlight(savedRange, { color: swatch.dataset.color });
        ctxTargetSpan = null; savedRange = null;
        hideContextMenu();
        return;
      }

      var btn = ev.target.closest('.exam-context-menu__item');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'highlight' && savedRange) {
        applyHighlight(savedRange);                 // default c-yellow
      } else if (action === 'note' && savedRange) {
        var spans = applyHighlight(savedRange);
        if (spans.length) {
          var last = spans[spans.length - 1];
          var rect = last.getBoundingClientRect();
          openNoteEditor(last, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
        }
      } else if (action === 'remove' && ctxTargetSpan) {
        removeHighlight(ctxTargetSpan);
      }
      ctxTargetSpan = null; savedRange = null;
      hideContextMenu();
    });
    document.addEventListener('click', function (ev) {
      var marker = ev.target.closest && ev.target.closest('.exam-note-marker');
      if (!marker || !marker._highlightSpans || !marker._highlightSpans.length) return;
      var span = marker._highlightSpans[marker._highlightSpans.length - 1];
      var rect = marker.getBoundingClientRect();
      openNoteEditor(span, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
    });
    $('exam-note-save').addEventListener('click', function () {
      if (!notePopTargetSpan) return hideNotePopover();
      var text = noteTA.value || '';
      var marker = notePopTargetSpan._noteMarker;
      var spans = (marker && marker._highlightSpans) || [notePopTargetSpan];
      spans.forEach(function (s) { s.setAttribute('data-note', text); });
      if (!marker && text) attachNoteMarker(spans, text);
      hideNotePopover();
    });
    $('exam-note-cancel').addEventListener('click', hideNotePopover);
    $('exam-note-delete').addEventListener('click', function () {
      if (!notePopTargetSpan) return hideNotePopover();
      var marker = notePopTargetSpan._noteMarker;
      var spans = (marker && marker._highlightSpans) || [notePopTargetSpan];
      spans.forEach(function (s) { s.removeAttribute('data-note'); s._noteMarker = null; });
      if (marker && marker.parentNode) marker.parentNode.removeChild(marker);
      hideNotePopover();
    });
  })();

  // ── Boot: combined test + resume payload ──────────────────────────
  function enterInProgress() {
    renderPassages((SESSION.test && SESSION.test.passages) || []);
    renderQuestions((SESSION.test && SESSION.test.questions) || []);
    renderPalette(
      (SESSION.test && SESSION.test.total_questions) || 40,
      (SESSION.test && SESSION.test.questions) || []
    );
    restoreAnswers();
    showState('inprogress');
    startTimer();
  }

  // Sprint 20.11 D5 — POST /attempts. The 20.5/20.9 backend abandons any
  // prior in_progress row for (user, test) before inserting the new one
  // (mig 088 partial unique index + router retry). So "Start fresh" is
  // simply this same POST — no extra "abandon" endpoint needed.
  function startFreshAttempt() {
    return window.api.post('/api/reading/test/' + encodeURIComponent(SESSION.test_id) + '/attempts')
      .then(function (res) {
        SESSION.attempt_id = res.attempt_id;
        SESSION.started_at = res.started_at;
        SESSION.time_limit_minutes = res.time_limit_minutes;
        // Clear the resumed answers — this is a fresh attempt.
        SESSION.answers = new Map();
        SESSION.flagged = new Set();
        SESSION.resume_inprogress = false;
        enterInProgress();
      })
      .catch(function (e) {
        showError('Không bắt đầu được bài thi. ' + (e && e.message || ''));
      });
  }

  $('exam-start-btn').addEventListener('click', function () {
    // If a resumable attempt is live, the Start button means "abandon the
    // current attempt and start over" — confirm before destroying state.
    if (SESSION.resume_inprogress) {
      $('exam-restart-modal').hidden = false;
      return;
    }
    startFreshAttempt();
  });

  // Sprint 20.11 D5 — Resume button (visible only when boot detected an
  // open attempt). Skips the restart-confirm modal and re-enters in_progress
  // with the resumed SESSION state.
  $('exam-resume-btn-prestart').addEventListener('click', function () {
    if (!SESSION.resume_inprogress) return;
    enterInProgress();
  });

  // Sprint 20.11 D5 — Restart-confirm modal handlers.
  $('exam-restart-cancel').addEventListener('click', function () {
    $('exam-restart-modal').hidden = true;
  });
  $('exam-restart-confirm').addEventListener('click', function () {
    $('exam-restart-modal').hidden = true;
    startFreshAttempt();
  });
  // Backdrop click closes the modal (does not confirm).
  document.querySelector('#exam-restart-modal .exam-modal__backdrop')
    .addEventListener('click', function () { $('exam-restart-modal').hidden = true; });

  function boot() {
    var testId = testIdFromUrl();
    if (!testId) { showError('No test specified (use ?test_id=…).'); return; }
    SESSION.test_id = testId;
    window.api.get('/api/reading/test/' + encodeURIComponent(testId) + '/boot')
      .then(function (bootPayload) {
        var test = bootPayload && bootPayload.test;
        if (!test) throw new Error('Boot payload missing test');
        SESSION.test = test;
        SESSION.time_limit_minutes = test.time_limit_minutes || 60;
        renderPreStart(test);
        var inprog = bootPayload.in_progress;
        if (inprog) {
          // Sprint 20.11 D5 — surface the resume affordance on pre-start
          // instead of auto-entering in_progress. Perf-1 keeps that UX while
          // loading test detail + resume state through one backend request.
          SESSION.attempt_id = inprog.attempt_id;
          SESSION.started_at = inprog.started_at;
          SESSION.time_limit_minutes = inprog.time_limit_minutes;
          (inprog.answers || []).forEach(function (a) {
            SESSION.answers.set(a.q_num, a.user_answer);
          });
          SESSION.resume_inprogress = true;
          configurePreStartActions(true);
        } else {
          SESSION.resume_inprogress = false;
          configurePreStartActions(false);
        }
        showState('prestart');
      })
      .catch(function (e) {
        if (e && e.status === 404) showError('Test not found or not published.');
        else showError('Failed to load test. ' + (e && e.message ? e.message : ''));
      });
  }
  boot();
})();
