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
    test_version: null,         // Sprint 20.13c C3 — `updated_at` from the
                                // backend; used as the version-gate key for
                                // per-test localStorage cache (highlights,
                                // notes, anything Phase B may add). The
                                // primary student state (answers, attempt)
                                // is server-authoritative, so this gate is
                                // forward-compatible insurance against
                                // stale local caches after admin re-imports.
  };

  // ── Per-test localStorage version-gate (Standards §5.1, anti §10.2) ──
  // Format: per-test cache lives under the namespace key
  //   `ielts-exam:${test_id}` → JSON-encoded `{ ver, data }`
  // On boot, if the stored `ver` does not match the live `${test_id}|${updated_at}`,
  // the whole namespace is dropped and a fresh empty entry is created. This
  // applies to every piece of per-test local state, present or future.
  // App-wide display prefs (text-size, theme) live under their own keys —
  // they are intentionally test-agnostic and not gated.
  var EXAM_CACHE_NS_PREFIX = 'ielts-exam:';
  function _examCacheKey(testId) { return EXAM_CACHE_NS_PREFIX + testId; }
  function _examVer(testId, version) {
    return String(testId || '') + '|' + String(version || '');
  }
  function loadExamCache(testId, version) {
    if (!testId) return {};
    var key = _examCacheKey(testId);
    var expectedVer = _examVer(testId, version);
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.ver === expectedVer && parsed.data) {
          return parsed.data;
        }
        // ver mismatch (or malformed) — discard so we never serve stale
        // content for a re-imported / re-edited test.
        localStorage.removeItem(key);
      }
    } catch (e) { /* private browsing / quota — degrade silently */ }
    return {};
  }
  function saveExamCache(testId, version, data) {
    if (!testId) return;
    try {
      localStorage.setItem(_examCacheKey(testId), JSON.stringify({
        ver:  _examVer(testId, version),
        data: data || {},
      }));
    } catch (e) { /* see above */ }
  }
  // Expose for sentinels (jsdom tests) without leaking onto the global
  // window object in production — only mounted when a test harness asks.
  if (typeof window !== 'undefined' && window.__READING_EXAM_TEST_HOOK__) {
    window.__READING_EXAM_CACHE__ = {
      load:  loadExamCache,
      save:  saveExamCache,
      key:   _examCacheKey,
      ver:   _examVer,
    };
  }

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

  // ── Sprint 20.13b — a11y shared helpers (Standards §4.3 + §4.9) ───
  // Shared modal lifecycle. One `openOverlay()` + `closeOverlay()` pair
  // wraps the 5 true modals (Help, Hide overlay, Submit-confirm,
  // Restart-confirm, Note popover) so every open/close path runs the
  // SAME a11y discipline:
  //   • on open: remember opener; move focus into the modal; install a
  //     Tab trap on the modal; mark the rest of the chrome `inert` +
  //     `aria-hidden="true"` so AT users can't escape upward.
  //   • on close (button OR Escape OR backdrop): uninstall the trap;
  //     clear `inert`/`aria-hidden`; return focus to the opener.
  // Anti-pattern §10.3 ("Escape chỉ ẩn class mà không gỡ trap+inert →
  // kẹt bàn phím") is the regression this rule eliminates.
  //
  // The Settings popover (anchored, not aria-modal) keeps its lighter
  // 20.11 pattern — it doesn't take focus from the chrome, just opens
  // a small disclosure menu.
  var _BG_REGIONS_FOR_INERT = [
    '.exam-topbar', '.exam-mobile-notice', '#state-loading',
    '#state-error', '#state-prestart', '#state-inprogress',
    '#state-results', '.exam-palette',
  ];
  var _overlayStack = [];   // tracks open modals so Escape always closes the topmost
  function _focusableIn(root) {
    if (!root) return [];
    var sel = 'a[href], button:not([disabled]), input:not([disabled]),'
            + ' select:not([disabled]), textarea:not([disabled]),'
            + ' [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(root.querySelectorAll(sel))
      .filter(function (el) {
        // exclude controls that are themselves hidden / inside a hidden ancestor.
        if (el.hasAttribute('hidden')) return false;
        var p = el.parentElement;
        while (p && p !== root) {
          if (p.hasAttribute('hidden')) return false;
          p = p.parentElement;
        }
        return true;
      });
  }
  function _setBackgroundInert(on) {
    _BG_REGIONS_FOR_INERT.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (on) {
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    });
  }
  function _installTrap(overlay) {
    overlay._a11yTrap = function (ev) {
      if (ev.key !== 'Tab') return;
      var f = _focusableIn(overlay);
      if (!f.length) { ev.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault(); first.focus();
      }
    };
    overlay.addEventListener('keydown', overlay._a11yTrap);
  }
  function _releaseTrap(overlay) {
    if (overlay && overlay._a11yTrap) {
      overlay.removeEventListener('keydown', overlay._a11yTrap);
      overlay._a11yTrap = null;
    }
  }
  function openOverlay(overlay, opener) {
    if (!overlay) return;
    // Track who opened so we can return focus there on close.
    overlay._a11yOpener = opener || document.activeElement;
    overlay.hidden = false;
    // First overlay opens → mark the background inert; nested opens
    // (e.g. confirm-from-restart) keep the existing inert and push.
    if (_overlayStack.length === 0) _setBackgroundInert(true);
    _overlayStack.push(overlay);
    _installTrap(overlay);
    // Move focus into the modal. Prefer the first focusable; fall back
    // to focusing the modal itself with tabindex -1 if it has no
    // controls (extremely defensive — every overlay we ship has at
    // least one button).
    setTimeout(function () {
      var f = _focusableIn(overlay);
      if (f.length) f[0].focus();
      else { overlay.setAttribute('tabindex', '-1'); overlay.focus(); }
    }, 0);
  }
  function closeOverlay(overlay) {
    if (!overlay) return;
    var idx = _overlayStack.indexOf(overlay);
    if (idx !== -1) _overlayStack.splice(idx, 1);
    _releaseTrap(overlay);
    overlay.hidden = true;
    var opener = overlay._a11yOpener;
    overlay._a11yOpener = null;
    // Last overlay closes → release background; otherwise keep inert
    // because another overlay is still on top.
    if (_overlayStack.length === 0) _setBackgroundInert(false);
    if (opener && typeof opener.focus === 'function') {
      try { opener.focus(); } catch (e) {}
    }
  }
  // Global Escape: close the topmost overlay (anti-pattern §10.3 guard).
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!_overlayStack.length) return;
    closeOverlay(_overlayStack[_overlayStack.length - 1]);
  });

  // Sprint 20.13b B2 — polite live-region announcer. Cleared then
  // re-populated with a tiny setTimeout so AT clients re-announce the
  // same string (e.g. successive 10/5 min warnings or a repeated
  // "submitted" message after a retry). Wrapped in try/catch because
  // the live region is the FIRST DOM element after <body> — if the
  // document hasn't parsed it yet (extremely defensive), we degrade
  // silently rather than throw.
  function liveSay(msg) {
    try {
      var lr = $('exam-live-region');
      if (!lr) return;
      lr.textContent = '';
      setTimeout(function () { lr.textContent = String(msg || ''); }, 30);
    } catch (e) {}
  }

  // Sprint 20.13b B3 — reduced-motion detector. JS-driven animations
  // (e.g. the timer toast wobble Layer C may add) check this before
  // firing; the CSS @media block above handles all declarative cases.
  function prefersReducedMotion() {
    try {
      return window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
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
    // Sprint 20.13c C4 — derive every number from the test payload
    // (Standards §5.3, anti-pattern §10.2). If a value is genuinely
    // missing, surface it as `?` rather than mislabelling with the
    // Cambridge default `40` / `60` so a broken test reads as broken.
    var qCount = (typeof test.total_questions === 'number')
      ? test.total_questions
      : (Array.isArray(test.questions) ? test.questions.length : '?');
    var pCount = (typeof test.passage_count === 'number')
      ? test.passage_count
      : (Array.isArray(test.passages) ? test.passages.length : '?');
    var minutes = (typeof test.time_limit_minutes === 'number')
      ? test.time_limit_minutes
      : '?';
    $('prestart-meta').textContent =
      pCount + ' parts · ' + qCount + ' questions · ' + minutes + ' minutes';
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
      // Sprint 20.14a T1.5 — 3-line pre-wrap block per Standards §2A.3.
      // Real BC/IDP exam ships this as a three-line vertical instruction
      // (TRUE if… / FALSE if… / NOT GIVEN if…); the one-line variant the
      // 20.11 D2 sprint shipped scanned as a paragraph and lost the
      // structure students rely on. The renderer keeps these as line
      // breaks; `.exam-questions__instructions--type` sets pre-wrap so
      // the breaks survive layout.
      return 'Questions ' + range + ': Do the following statements agree with ' +
        'the information given in Reading Passage ' + ctx.part + '?\n' +
        'TRUE        if the statement agrees with the information\n' +
        'FALSE       if the statement contradicts the information\n' +
        'NOT GIVEN   if there is no information on this';
    },
    yes_no_not_given: function (range, ctx) {
      // Sprint 20.14a T1.5 — same 3-line pre-wrap treatment as TFNG.
      return 'Questions ' + range + ': Do the following statements agree with ' +
        "the claims of the writer in Reading Passage " + ctx.part + '?\n' +
        "YES         if the statement agrees with the writer's claims\n" +
        "NO          if the statement contradicts the writer's claims\n" +
        "NOT GIVEN   if it is impossible to say what the writer thinks about this";
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

        // Sprint 20.14a T1.2 — matching_headings: emit the heading bank
        // BOX above the question list (Standards §2A.5 BẮT BUỘC). The
        // dropdown options drop the heading TEXT since the bank is now
        // visible (renderInputs reads the same flag), keeping the select
        // narrow to "i / ii / iii…" labels.
        if (type === 'matching_headings') {
          var headingsBox = _renderHeadingsBox(run[0].payload && run[0].payload.options);
          if (headingsBox) host.appendChild(headingsBox);
        }

        // Sprint 20.14a T1.1 / T1.3 — wrap completion runs in a `.gap-box`
        // so summary / notes / table groups read as a single block, with
        // each question's stem flowing inline (Standards §2A.10 / §2A.12).
        // sentence_completion + short_answer stay un-boxed (§2A.9 / §2A.14).
        // table/notes get the additional `.mono-block` modifier so
        // columns / arrows / indent in the stem survive layout.
        var boxedTypes = { summary_completion: false, notes_completion: true, table_completion: true, form_completion: true };
        if (Object.prototype.hasOwnProperty.call(boxedTypes, type)) {
          var box = document.createElement('div');
          box.className = 'exam-gap-box' + (boxedTypes[type] ? ' exam-gap-box--mono' : '');
          box.setAttribute('data-question-type', type);
          run.forEach(function (q) { box.appendChild(renderQuestion(q)); });
          host.appendChild(box);
        } else {
          run.forEach(function (q) { host.appendChild(renderQuestion(q)); });
        }
      });
    });
  }

  // Sprint 20.14a T1.2 — heading-bank box for matching_headings (§2A.5).
  // The box sits above the question list, sticky so it stays visible as
  // the student scrolls through the questions. Roman numerals in bold,
  // one heading per line, hanging indent inside each line.
  function _renderHeadingsBox(options) {
    if (!Array.isArray(options) || !options.length) return null;
    var box = document.createElement('aside');
    box.className = 'exam-headings-box';
    box.setAttribute('aria-label', 'List of Headings');
    var title = document.createElement('p');
    title.className = 'exam-headings-box__title';
    title.textContent = 'List of Headings';
    box.appendChild(title);
    var list = document.createElement('ol');
    list.className = 'exam-headings-box__list';
    options.forEach(function (o) {
      var item = document.createElement('li');
      item.className = 'exam-headings-box__item';
      var label = document.createElement('span');
      label.className = 'exam-headings-box__roman';
      label.textContent = o.label != null ? String(o.label) : '';
      var text = document.createElement('span');
      text.className = 'exam-headings-box__text';
      text.textContent = o.text || '';
      item.appendChild(label);
      item.appendChild(text);
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
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
    card.dataset.questionType = String(q.question_type || '');

    var num = document.createElement('span');
    num.className = 'exam-q__num'; num.textContent = String(q.q_num);

    var body = document.createElement('div');
    body.className = 'exam-q__body';

    // Sprint 20.14a T1.1 — inline-gap rendering for completion types
    // (Standards §2A.9 / §2A.10 / §2A.12 / §2A.14). When the stem contains
    // `____` (≥2 underscores), the input slots IN PLACE of the underscores
    // — not as a separate element appended after the prompt. For types
    // that don't carry a gap glyph in the stem (mcq, TFNG/YNG, matching),
    // fall back to the historic "prompt then control" layout.
    if (_isInlineGapType(q.question_type) && _stemHasGap(q.prompt)) {
      body.appendChild(_renderInlineStem(q));
    } else {
      var prompt = document.createElement('p');
      prompt.className = 'exam-q__prompt'; prompt.textContent = q.prompt || '';
      body.appendChild(prompt);
      renderInputs(body, q);
    }

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
  // Sprint 20.14a T1.1 — types whose stems can carry a `____` gap.
  // form_completion stems are typically `key: ____` style; same renderer.
  function _isInlineGapType(type) {
    return type === 'sentence_completion' || type === 'summary_completion' ||
           type === 'notes_completion'    || type === 'table_completion'   ||
           type === 'form_completion'     || type === 'short_answer';
  }
  var _GAP_RE = /_{2,}/;
  function _stemHasGap(prompt) {
    return typeof prompt === 'string' && _GAP_RE.test(prompt);
  }
  function _renderInlineStem(q) {
    // Split the stem on the FIRST `____` run; the suffix may itself
    // contain more gaps, but per AVR-READ-001 the seed shape is one
    // gap per question, so we render one inline input. Multi-gap stems
    // (Phase B) can extend this with a /g split.
    var p = document.createElement('p');
    p.className = 'exam-q__prompt exam-q__prompt--inline';
    var s = String(q.prompt || '');
    var idx = s.search(_GAP_RE);
    var match = s.match(_GAP_RE);
    var prefix = idx >= 0 ? s.slice(0, idx) : s;
    var suffix = idx >= 0 ? s.slice(idx + (match ? match[0].length : 0)) : '';
    if (prefix) p.appendChild(document.createTextNode(prefix));
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'exam-q__gap exam-q__gap--inline';
    input.name = 'q-' + q.q_num;
    input.setAttribute('aria-label', 'Answer ' + q.q_num);
    input.setAttribute('autocomplete', 'off');
    p.appendChild(input);
    if (suffix) p.appendChild(document.createTextNode(suffix));
    return p;
  }

  function renderInputs(body, q) {
    var name = 'q-' + q.q_num;
    var type = q.question_type;
    if (type === 'mcq_single') {
      // Sprint 20.14a T1.4 — bold A/B/C/D prefix as a separate span so
      // CSS can weight it independently (Standards §2A.1). The label
      // text wraps under itself via the grid layout in
      // `.exam-q__option` (hanging indent).
      var opts = document.createElement('div'); opts.className = 'exam-q__options';
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var prefix = o.label != null ? String(o.label) : '';
        opts.appendChild(radioOption(name, val, prefix, o.text || ''));
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
      // Sprint 20.14a T1.2 — the heading bank now renders ABOVE the
      // question list in `.exam-headings-box` (Standards §2A.5), so the
      // dropdown only needs to surface the LABEL (i, ii, iii…). The
      // student maps "label → heading text" by reading the visible bank.
      // Dropping the text from each `<option>` also keeps the select
      // narrow and prevents Roman numerals from being lost in long lines.
      var sel = document.createElement('select');
      sel.className = 'exam-q__select'; sel.name = name;
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— Select —';
      sel.appendChild(ph);
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var opt = document.createElement('option');
        opt.value = val; opt.textContent = val;
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
  function radioOption(name, value, prefixOrText, optionalText) {
    // Sprint 20.14a T1.4 — accept either (name, value, fullText) for
    // back-compat with internal callers OR (name, value, prefix, text)
    // for the bold-prefix split. When `optionalText` is supplied the
    // prefix renders as its own bold span; the text follows in a sibling
    // span so the grid layout hangs the wrap under the text column.
    var label = document.createElement('label'); label.className = 'exam-q__option';
    var input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = value;
    label.appendChild(input);
    if (optionalText !== undefined) {
      var prefixEl = document.createElement('span');
      prefixEl.className = 'exam-q__option-prefix';
      prefixEl.textContent = String(prefixOrText || '');
      var textEl = document.createElement('span');
      textEl.className = 'exam-q__option-text';
      textEl.textContent = String(optionalText || '');
      label.appendChild(prefixEl); label.appendChild(textEl);
    } else {
      var span = document.createElement('span'); span.textContent = prefixOrText;
      label.appendChild(span);
    }
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
    // Sprint 20.14a T2.3 — clearing the input drops the `is-answered`
    // class on the card AND the palette (Standards §3A.4: "xoá nội dung
    // ô text → tự gỡ trạng thái đã làm"). For non-text inputs (radio,
    // select) a value of '' shouldn't occur via interaction (the change
    // event only fires on a selection), so treat any falsy value as
    // "not answered".
    if (value === '' || value == null) {
      SESSION.answers['delete'](qNum);
      _setAnsweredState(qNum, false);
    } else {
      _setAnsweredState(qNum, true);
    }
    if (SESSION.debounce_timers.has(qNum)) clearTimeout(SESSION.debounce_timers.get(qNum));
    SESSION.debounce_timers.set(qNum, setTimeout(function () {
      patchAnswer(qNum, value);
      SESSION.debounce_timers.delete(qNum);
    }, 500));
  }
  // Sprint 20.14a T2.3 — single source of truth for "this question now
  // is / is not answered" (Standards §3A.4). Toggles BOTH the palette
  // tile and the question card so the answered cue reads at the answer
  // site itself (left blue border via `.exam-q.is-answered`) and on the
  // bottom palette simultaneously.
  function _setAnsweredState(qNum, answered) {
    var btn = document.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (btn) {
      btn.classList.toggle('is-answered', !!answered);
      _updatePaletteAriaLabel(btn);
    }
    var card = document.getElementById('q-' + qNum);
    if (card) card.classList.toggle('is-answered', !!answered);
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
    btn.textContent = String(q);
    btn.addEventListener('click', function () { jumpTo(q); });
    // Sprint 20.13b B4 — initial aria-label includes "not answered" so
    // a fresh palette reads consistently from the first focus.
    _updatePaletteAriaLabel(btn);
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
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Sprint 20.14a T2.3 — jump-flash (Standards §3A.4). 0.5s yellow
      // background pulse lands the eye on the just-clicked question.
      // `prefersReducedMotion()` (20.13b helper) caller skips the flash
      // class so the underlying transition rule (also reduced-motion-
      // gated in CSS) doesn't try to animate.
      if (!prefersReducedMotion()) {
        card.classList.remove('is-flash');           // restart if mid-animation
        // Force reflow so re-adding the class re-triggers the animation.
        void card.offsetWidth;
        card.classList.add('is-flash');
        card.addEventListener('animationend', function _drop() {
          card.classList.remove('is-flash');
          card.removeEventListener('animationend', _drop);
        });
      }
    }
    setCurrent(qNum);
  }
  // Sprint 20.13b B4 — keep palette-tile `aria-label` in sync with state
  // (standards §4.6). Single helper called from every state mutation so
  // screen-reader users hear "Question N, answered, flagged for review,
  // current" instead of the static "Question N" from 20.10.
  function _updatePaletteAriaLabel(btn) {
    if (!btn) return;
    var q = btn.dataset.q;
    var parts = ['Question ' + q];
    if (btn.classList.contains('is-answered')) parts.push('answered');
    else parts.push('not answered');
    if (btn.classList.contains('is-flagged')) parts.push('flagged for review');
    if (btn.classList.contains('is-current')) parts.push('current');
    btn.setAttribute('aria-label', parts.join(', '));
  }
  function setCurrent(qNum) {
    document.querySelectorAll('.exam-palette__q').forEach(function (b) {
      b.classList.toggle('is-current', b.dataset.q === String(qNum));
      _updatePaletteAriaLabel(b);
    });
    document.querySelectorAll('.exam-q').forEach(function (c) {
      c.classList.toggle('is-current', c.dataset.q === String(qNum));
    });
  }
  function markAnswered(qNum) {
    // Sprint 20.14a T2.3 — delegate to _setAnsweredState so the Q-card
    // `.is-answered` left-border lights up on resume too (not just the
    // palette tile). Restoring a saved attempt that had answers persisted
    // server-side now visually matches a freshly typed answer.
    _setAnsweredState(qNum, true);
  }
  function toggleFlag(qNum, flagBtn) {
    var pressed = flagBtn.getAttribute('aria-pressed') !== 'true';
    flagBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (pressed) SESSION.flagged.add(qNum); else SESSION.flagged['delete'](qNum);
    var btn = document.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (btn) { btn.classList.toggle('is-flagged', pressed); _updatePaletteAriaLabel(btn); }
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
        // Sprint 20.13b B2 — announce the 5-minute warning ONCE (the
        // attribute guard above keeps it from re-firing every tick).
        liveSay('Warning: 5 minutes remaining.');
        // Sprint 20.14a T2.2 — visible toast for sighted users
        // (Standards §3A.3). The CSS for `.exam-time-toast` shipped in
        // 20.13b but JS wiring was missing — toast was SR-only.
        _showTimeToast('5 minutes remaining');
      } else if (remaining <= 600 && timer.getAttribute('data-state') === 'normal') {
        timer.setAttribute('data-state', 'warning');
        liveSay('Warning: 10 minutes remaining.');
        _showTimeToast('10 minutes remaining');
      }
      if (remaining <= 0) {
        if (SESSION.timer_interval) {
          clearInterval(SESSION.timer_interval);
          SESSION.timer_interval = null;
        }
        // Sprint 20.13b B2 — announce auto-submit so AT users know the
        // exam has just been finalised on their behalf.
        liveSay('Time is up. Your test has been submitted automatically.');
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
  // Sprint 20.14a T2.2 — time-warning toast (Standards §3A.3). 4-second
  // visible toast at the 10-/5-minute thresholds, fixed-positioned at
  // the top of the viewport. Pointer-events-none so it never blocks
  // input. Only ONE toast lives at a time — opening a new one removes
  // any prior toast (covers the corner case where the user pauses on
  // a slow tab and both thresholds fire in the same tick).
  var _timeToastEl = null;
  var _timeToastTimer = null;
  function _showTimeToast(message) {
    if (_timeToastEl && _timeToastEl.parentNode) {
      _timeToastEl.parentNode.removeChild(_timeToastEl);
    }
    if (_timeToastTimer) clearTimeout(_timeToastTimer);
    var toast = document.createElement('div');
    toast.className = 'exam-time-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = String(message || '');
    document.body.appendChild(toast);
    _timeToastEl = toast;
    _timeToastTimer = setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (_timeToastEl === toast) _timeToastEl = null;
      _timeToastTimer = null;
    }, 4000);
  }
  // Sprint 20.13c C4 — single source of truth for "how many questions in
  // this test". Prefer the spec value; fall back to the rendered length.
  // Never the hard-coded "40" (Standards §5.3, anti-pattern §10.2).
  function _totalQuestions() {
    var t = SESSION.test || {};
    if (typeof t.total_questions === 'number') return t.total_questions;
    return Array.isArray(t.questions) ? t.questions.length : 0;
  }
  function lockExam() {
    if (chrome) chrome.classList.add('is-locked');
    SESSION.timer_locked = true;
  }

  // ── Submit flow ───────────────────────────────────────────────────
  function openSubmitModal() {
    // Sprint 20.13c C4 — derive total from data, never the hard-coded
    // "40" (Standards §5.3). `total_questions` is the spec value;
    // `questions.length` is the live count from the rendered payload.
    var total = _totalQuestions();
    var answered = SESSION.answers.size;
    var unanswered = total - answered;
    $('exam-submit-warn').textContent = unanswered > 0
      ? 'Bạn còn ' + unanswered + '/' + total + ' câu chưa trả lời. Nộp luôn?'
      : 'Bạn đã trả lời tất cả ' + total + ' câu.';
    // Sprint 20.13b B1 — open via shared helper; opener is the Submit
    // button so closing the modal returns focus there.
    openOverlay($('exam-submit-modal'), $('exam-submit-btn'));
  }
  function closeSubmitModal() { closeOverlay($('exam-submit-modal')); }

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
      // Sprint 20.13b B2 — announce the score on the polite live region
      // so AT users get an immediate read of "X out of Y, band Z".
      try {
        var score = (result && result.score != null) ? result.score : '?';
        // Sprint 20.13c C4 — derive from data (Standards §5.3). Fall back
        // to the test's total_questions, not the hard-coded "40".
        var max   = (result && result.max_score != null) ? result.max_score : _totalQuestions();
        var band  = (result && result.band_estimate != null) ? result.band_estimate : null;
        liveSay('Test submitted. You scored ' + score + ' out of ' + max +
                (band != null ? ', estimated band ' + Number(band).toFixed(1) : '') + '.');
      } catch (_e) {}
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
    // Sprint 20.13c C4 — derive max from result, fall through to the
    // test's total_questions, finally `—` if neither is known. The
    // hard-coded "40" is gone (Standards §5.3, anti §10.2).
    var maxDisplay;
    if (result.max_score != null) maxDisplay = result.max_score;
    else { var tq = _totalQuestions(); maxDisplay = tq > 0 ? tq : '—'; }
    $('results-score').textContent = (result.score != null ? result.score : '—') + '/' + maxDisplay;
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
    // Sprint 20.13b B1 — through the shared modal helper.
    openOverlay($('exam-hide-overlay'), $('exam-hide-toggle'));
    $('exam-hide-toggle').setAttribute('aria-pressed', 'true');
  });
  $('exam-resume-btn').addEventListener('click', function () {
    // Sprint 20.13b B1 — uniform close path (releases trap + returns focus).
    closeOverlay($('exam-hide-overlay'));
    $('exam-hide-toggle').setAttribute('aria-pressed', 'false');
  });
  // Sprint 20.13b B1 — Help modal through shared helper.
  $('exam-help-toggle').addEventListener('click', function () {
    openOverlay($('exam-help-modal'), $('exam-help-toggle'));
  });
  $('exam-help-close').addEventListener('click', function () {
    closeOverlay($('exam-help-modal'));
  });
  $('exam-help-modal').querySelector('[data-close="help"]').addEventListener('click',
    function () { closeOverlay($('exam-help-modal')); });

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
    // Sprint 20.13b B1 — the Note popover is a true modal now (aria-modal,
    // focus-trapped). Route close through the shared helper so the trap
    // is released + focus returned to the opener.
    function hideNotePopover() {
      if (!notePop.hidden) closeOverlay(notePop);
      notePopTargetSpan = null;
    }
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
      // Sprint 20.13b B1 — the note-popover Escape close is now handled by
      // the global Escape handler near the top of this module (which walks
      // _overlayStack). This local handler only closes the context menu
      // (which is `role="menu"`, NOT a modal — not in the overlay stack).
      if (ev.key === 'Escape') { hideContextMenu(); }
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
      // Sprint 20.13b B1 — through the shared modal helper. The opener
      // remembered is whatever had focus when openNoteEditor was called
      // (typically the context menu Note button or the Alt+N source) so
      // close-via-Escape returns focus there.
      openOverlay(notePop, document.activeElement);
      positionPopover(notePop, x, y);
      // openOverlay focuses the first focusable (the textarea wins in
      // this modal — explicit re-focus is defensive only).
      try { noteTA.focus(); } catch (e) {}
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

    // Sprint 20.13b B5 — keyboard parity with right-click highlight + note.
    // Alt+H / Alt+N / Alt+C let the student work from the keyboard alone
    // (standards §4.8). Behaviour:
    //   Alt+H — apply the default-yellow highlight to the current selection
    //           (no-selection → refuse silently)
    //   Alt+N — apply highlight + open the Note editor on it
    //   Alt+C — if focus or selection is inside an existing highlight,
    //           clear it. Caret position is used; selection ignored.
    // We refuse silently when nothing applies so the keys don't surprise
    // users who happen to hold Alt for other reasons.
    //
    // Selection must intersect the passage pane or the questions pane
    // (the same surfaces the right-click menu listens on) so the
    // shortcuts can't accidentally fire from a stray Alt-press inside a
    // modal or the chrome.
    var ALT_TARGET_PANELS = ['#exam-passage', '#exam-questions'];
    function _selectionInsidePanels() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
      var anchor = sel.anchorNode;
      var ok = false;
      ALT_TARGET_PANELS.forEach(function (s) {
        var p = document.querySelector(s);
        if (p && anchor && p.contains(anchor)) ok = true;
      });
      return ok ? sel.getRangeAt(0).cloneRange() : null;
    }
    function _highlightAtFocus() {
      // Find a `.exam-highlight.is-user` ancestor of the active element
      // or of the selection's anchor node — whichever exists.
      var el = document.activeElement;
      var sel = window.getSelection();
      var node = (sel && sel.anchorNode) || el || null;
      while (node && node !== document.body) {
        if (node.classList && node.classList.contains('exam-highlight')
            && node.classList.contains('is-user')) return node;
        node = node.parentNode;
      }
      return null;
    }
    document.addEventListener('keydown', function (ev) {
      if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var key = String(ev.key || '').toLowerCase();
      if (key === 'h') {
        var range = _selectionInsidePanels();
        if (!range) return;          // no selection or wrong surface → silent
        ev.preventDefault();
        applyHighlight(range, { color: 'c-yellow' });
      } else if (key === 'n') {
        var range2 = _selectionInsidePanels();
        if (!range2) return;
        ev.preventDefault();
        var spans = applyHighlight(range2, { color: 'c-yellow' });
        if (spans && spans.length) {
          var last = spans[spans.length - 1];
          var r = last.getBoundingClientRect();
          openNoteEditor(last, r.left + window.scrollX, r.bottom + window.scrollY + 6);
        }
      } else if (key === 'c') {
        var hl = _highlightAtFocus();
        if (!hl) return;
        ev.preventDefault();
        removeHighlight(hl);
      }
    });
  })();

  // ── Boot: combined test + resume payload ──────────────────────────
  function enterInProgress() {
    renderPassages((SESSION.test && SESSION.test.passages) || []);
    renderQuestions((SESSION.test && SESSION.test.questions) || []);
    renderPalette(
      // Sprint 20.13c C4 — derive from data, not the "40" anti-pattern.
      _totalQuestions(),
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
      // Sprint 20.13b B1 — through the shared modal helper.
      openOverlay($('exam-restart-modal'), $('exam-start-btn'));
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
  // Sprint 20.13b B1 — every close path goes through closeOverlay so the
  // trap is released and focus returns to the Start button (the opener).
  $('exam-restart-cancel').addEventListener('click', function () {
    closeOverlay($('exam-restart-modal'));
  });
  $('exam-restart-confirm').addEventListener('click', function () {
    closeOverlay($('exam-restart-modal'));
    startFreshAttempt();
  });
  // Backdrop click closes the modal (does not confirm).
  document.querySelector('#exam-restart-modal .exam-modal__backdrop')
    .addEventListener('click', function () { closeOverlay($('exam-restart-modal')); });

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
        // Sprint 20.13c C3 — version-gate cache (Standards §5.1).
        // `test.updated_at` is the canonical version proxy; loading
        // through this helper drops any stale per-test cache from a
        // prior version of the same test_id and re-seeds the namespace.
        SESSION.test_version = test.updated_at || null;
        loadExamCache(testId, SESSION.test_version);
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
