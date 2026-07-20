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
  var SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
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
    currentPart: 1,             // Sprint 20.14c D1 — one-Part-at-a-time
                                // scroll model (Standards §3A.2). Only this
                                // Part's passage + questions render in the
                                // panes; palette / Prev / Next swap Parts
                                // implicitly. Answers, flags, attempt all
                                // stay scoped to the whole test (40 Qs),
                                // not the visible Part. Default 1; resume
                                // restores to Part 1 (simplest predictable
                                // behaviour — last-active Part is a 20.14c+
                                // option if Andy asks).
    highlights_by_part: new Map(), // Sprint 20.14c D1 — Part → cached
                                // passage-body innerHTML (Standards §3A.2:
                                // "Highlight đã tạo ở mỗi Part được khôi
                                // phục khi quay lại"). On Part swap, the
                                // outgoing Part's passage body is snapshot
                                // here BEFORE re-render destroys the DOM,
                                // and the incoming Part's snapshot (if any)
                                // is restored AFTER the markdown re-render.
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
    // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
    // local fallback kept so this module is safe if window.WC hasn't loaded.
    return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // reading-review-locate-exam-format B2/B3 — format a question-group
  // instruction for display: enlarge/bold the "Questions X–Y" prefix and bold
  // the format restrictions students lose marks on. Escapes FIRST, then layers
  // <span>/<strong> on the safe string (the phrases contain only '/' which
  // survives escaping), so it's XSS-safe. The instruction container is
  // white-space: pre-wrap, so the T/F/NG line breaks survive.
  function _formatInstruction(text) {
    var s = escapeHtml(text);
    s = s.replace(/^(Questions\s+[\d–—\-]+)/i,
      '<span class="exam-q-range">$1</span>');
    var emph = function (m) { return '<strong class="exam-instr-em">' + m + '</strong>'; };
    s = s.replace(/NO MORE THAN (?:ONE|TWO|THREE|FOUR|FIVE|\d+) WORDS?(?:\s+AND\/OR A NUMBER)?/gi, emph);
    s = s.replace(/ONE WORD ONLY/gi, emph);
    // option keywords leading the T/F/NG · Y/N/NG explanation lines
    s = s.replace(/(^|\n)(NOT GIVEN|TRUE|FALSE|YES|NO)(?=\s)/g,
      function (_, pre, kw) { return pre + emph(kw); });
    return s;
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
  // reading-access-tracking B2 — anonymous share-link mode. `?share=<token>`
  // opens the exam for ANYONE (no account): boot/start/submit/answers go to the
  // B1 share + anon endpoints and carry the minted anon_id as X-Reading-Anon.
  function shareTokenFromUrl() {
    return (new URLSearchParams(window.location.search).get('share') || '').trim() || null;
  }

  // ── Back target ──────────────────────────────────────────────────
  // This page serves BOTH reading libraries (reading-test.html = full,
  // reading-mini-test.html = mini), which stamp ?from= on the link in. The back
  // buttons used to hardcode the FULL library, so a mini-test taker was sent to
  // the wrong shelf. Map through an ALLOWLIST — never navigate to a raw URL from
  // the query string. Unknown/absent → full, the historical default.
  var BACK_TARGETS = { full: '/pages/reading-test.html', mini: '/pages/reading-mini-test.html' };
  function originFromUrl() {
    var v = (new URLSearchParams(window.location.search).get('from') || '').trim();
    return BACK_TARGETS[v] ? v : 'full';
  }
  function wireBack() {
    var href = BACK_TARGETS[originFromUrl()];
    document.querySelectorAll('a.exam-btn[href="/pages/reading-test.html"]')
      .forEach(function (a) { a.href = href; });
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
    // Reading mini test — the rule line must reflect the REAL shape (a mini has
    // 1 passage / fewer questions), not a hard-coded "3 đoạn và 40 câu hỏi".
    var ruleNav = $('prestart-rule-nav');
    if (ruleNav) {
      ruleNav.textContent =
        'Bạn có thể di chuyển tự do giữa ' + pCount + ' đoạn và ' + qCount + ' câu hỏi.';
    }
    $('exam-test-label').textContent = test.title || 'Reading Test';
  }

  // ── Render passages — Sprint 20.14c D1: ONE Part at a time ────────
  // Standards §3A.2 — only the current Part's passage occupies the left
  // pane. The other passages remain in SESSION.test.passages (untouched)
  // and re-render when setCurrentPart() swaps Parts. Pre-20.14c stacked
  // all 3 passages with continuous scroll; that left the passage and the
  // visible question list desynced (student reading passage 1 while
  // questions Q1-40 all scrolled together in the right pane).
  function renderCurrentPassage() {
    var host = $('exam-passage');
    host.innerHTML = '';
    var passages = (SESSION.test && SESSION.test.passages) || [];
    // Find the passage whose passage_order matches currentPart (1-based).
    // Defensive: if no exact match, fall back to passages[currentPart-1]
    // for old test bundles that didn't stamp passage_order.
    var p = null;
    for (var i = 0; i < passages.length; i++) {
      if (passages[i].passage_order === SESSION.currentPart) { p = passages[i]; break; }
    }
    if (!p) p = passages[Math.max(0, Math.min(passages.length - 1, SESSION.currentPart - 1))];
    if (!p) return;
    var wrap = document.createElement('section');
    wrap.className = 'exam-passage__part';
    wrap.id = 'passage-' + (p.passage_order || SESSION.currentPart);
    var eyebrow = document.createElement('p');
    eyebrow.className = 'exam-passage__eyebrow';
    eyebrow.textContent = 'Passage ' + (p.passage_order || SESSION.currentPart);
    var title = document.createElement('h2');
    title.className = 'exam-passage__title';
    title.textContent = p.title || '';
    var body = document.createElement('div');
    body.className = 'exam-passage__body md-body';
    // Highlight-restore (Standards §3A.2): if the student has highlighted
    // this Part on an earlier visit, the cached innerHTML carries the
    // `.exam-highlight.is-user` spans + note markers. Use it instead of
    // a fresh markdown render so the work persists across Part swaps.
    var cached = SESSION.highlights_by_part.get(p.passage_order || SESSION.currentPart);
    if (cached) {
      body.innerHTML = cached;
    } else {
      // Sprint 20.14d — `breaks: false` (CommonMark soft-break). The
      // YAML `|` literal-block body_markdown in the seed is hard-wrapped
      // at ~60 chars for editor readability; under the default
      // `breaks: true`, marked emits a `<br>` after every source line
      // and prose can't reflow to the pane width. Soft-break collapses
      // single `\n` to space (double `\n` still = paragraph break), so
      // paragraphs flow to fill the pane and respond to window resize.
      body.innerHTML = window.renderMarkdown ? window.renderMarkdown(p.body_markdown || '', { breaks: false }) : '';
    }
    wrap.appendChild(eyebrow);
    wrap.appendChild(title);
    wrap.appendChild(body);
    host.appendChild(wrap);
  }
  // Sprint 20.14c D1 — capture the live passage body innerHTML into the
  // per-Part cache. Called BEFORE setCurrentPart re-renders the pane so
  // highlights / notes survive Part swaps. Also exposed for direct calls
  // from any highlight mutation site that wants to snapshot immediately
  // (insurance against an unexpected re-render).
  function snapshotCurrentPartHighlights() {
    var body = document.querySelector('#exam-passage .exam-passage__body');
    if (!body) return;
    SESSION.highlights_by_part.set(SESSION.currentPart, body.innerHTML);
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
    // Sprint 20.14b — Phase B type instructions per Standards §2A.2 /
    // §2A.6 / §2A.7 / §2A.8 / §2A.12 / §2A.13. Wording mirrors real
    // CD-IELTS BC / IDP / Cambridge official-sample phrasing.
    mcq_multi: function (range, ctx) {
      var n = ctx.optionsCount || 5;
      var lettersUpper = String.fromCharCode(64 + n);    // 5 → "E"
      return 'Questions ' + range + ': Choose TWO letters, A–' + lettersUpper + '.';
    },
    matching_information: function (range, ctx) {
      return 'Questions ' + range + ': Reading Passage ' + ctx.part +
        ' has several paragraphs. Which paragraph contains the following ' +
        'information? Write the correct letter beside each statement.';
    },
    matching_features: function (range) {
      return 'Questions ' + range + ': Look at the following statements and ' +
        'the list of features. Match each statement with the correct feature.';
    },
    matching_sentence_endings: function (range) {
      return 'Questions ' + range + ': Complete each sentence with the ' +
        'correct ending from the list below.';
    },
    flow_chart_completion: function (range) {
      return 'Questions ' + range + ': Complete the flow-chart below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
    },
    diagram_label_completion: function (range) {
      return 'Questions ' + range + ': Label the diagram below. Choose ' +
        'NO MORE THAN TWO WORDS from the passage for each answer.';
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

  // ── Render questions — Sprint 20.14c D1: only the current Part's Qs ──
  // Standards §3A.2 — the right pane shows ONLY the questions whose
  // `passage_order` matches the currently-displayed passage. The full
  // question list (all 40) is preserved in SESSION.test.questions for
  // submit + palette + cross-Part navigation.
  function renderCurrentPartQuestions() {
    var host = $('exam-questions');
    host.innerHTML = '';
    var all = (SESSION.test && SESSION.test.questions) || [];
    var partQs = all.filter(function (q) { return (q.passage_order || 1) === SESSION.currentPart; });
    if (!partQs.length) return;
    var part = SESSION.currentPart;
    // Render the same Part-heading + typeRun structure 20.14a shipped —
    // just for this single Part now, not all three.
    var partHeading = document.createElement('div');
    partHeading.className = 'exam-questions__part-heading';
    partHeading.innerHTML = '<strong>Part ' + part + '</strong> — Questions ' +
                            partQs[0].q_num + '–' + partQs[partQs.length - 1].q_num;
    host.appendChild(partHeading);

      // Sprint 20.11 D2 — sub-group by question_type within the part.
      // Consecutive runs of the same type share one instruction block;
      // a type change starts a new block (so a Part with matching_headings
      // → T/F/NG → short_answer shows three labelled instruction blocks).
      //
      // Sprint 20.14a.1 — every run now lives in a `<section
      // class="exam-questions__group">` so any sticky element inside
      // (e.g. the matching_headings `.exam-headings-box`) is BOUNDED to
      // the run's own section. Pre-20.14a.1 the headings box was
      // appended directly to `.exam-questions` and sticky-positioned
      // against the pane's top; it persisted past the matching_headings
      // run into the next question type's view (Andy's dogfood Bug 2 —
      // the i–v heading bank lingered over the TFNG block that follows
      // matching_headings in AVR-READ-001). Wrapping in a section
      // means `position: sticky` computes its containing block as the
      // section, and the box scrolls off naturally when the section's
      // bottom edge reaches the top of the pane.
      var typeRuns = _consecutiveTypeRuns(partQs);
      typeRuns.forEach(function (run) {
        var type = run[0].question_type;
        var rangeLabel = _qRangeLabel(run);

        var groupEl = document.createElement('section');
        groupEl.className = 'exam-questions__group';
        groupEl.setAttribute('data-question-type', type);

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
        var instrText = template
          ? template(rangeLabel, ctx)
          : 'Questions ' + rangeLabel + '.';
        // reading-review-locate-exam-format B2/B3 — bold/enlarge the
        // "Questions X–Y" header + bold the format restrictions (word limits,
        // T/F/NG · Y/N/NG option words). Render-time detection (no MD change);
        // escapeHtml-first so this stays XSS-safe.
        instructionEl.innerHTML = _formatInstruction(instrText);
        groupEl.appendChild(instructionEl);

        // Sprint 20.14a T1.2 + Sprint 20.14b — bank box for the matching
        // / word-bank family (Standards §2A.5 / §2A.7 / §2A.8 / §2A.11
        // all mandate a bordered bank above the questions). The same
        // helper builds all four — variant choice is the wrapping class
        // (`exam-headings-box` / `exam-features-box` / `exam-endings-box`
        // / `exam-word-bank-box`) and the title text.
        var BANK_VARIANTS = {
          matching_headings:         { className: 'exam-headings-box',  title: 'List of Headings' },
          matching_features:         { className: 'exam-features-box',  title: 'List of Features' },
          matching_sentence_endings: { className: 'exam-endings-box',   title: 'Sentence Endings' },
          // summary_completion only renders a bank when authored with
          // `options:` (the word-bank variant); the no-bank variant
          // skips this branch.
          summary_completion:        { className: 'exam-word-bank-box', title: 'Word Bank', requireOptions: true },
        };
        var bankVariant = BANK_VARIANTS[type];
        if (bankVariant) {
          var options = run[0].payload && run[0].payload.options;
          var skip = bankVariant.requireOptions && (!Array.isArray(options) || !options.length);
          if (!skip) {
            var bankBox = _renderBankBox(options, bankVariant);
            if (bankBox) groupEl.appendChild(bankBox);
          }
        }

        // Sprint 20.14f-α — diagram_label / flow_chart with admin-
        // uploaded image (Standards §2A.13 / §2A.12 image variant). The
        // student fetch surfaces a signed `payload.image_url` on the
        // FIRST Q of a diagram/flow run when an admin has uploaded an
        // image; the renderer emits ONE `.exam-diagram-container` with
        // the image on top + a numbered side-list of inputs below.
        // Runs without an image fall through to the flowing / mono-block
        // path below (back-compat — admins upload an image when the
        // diagram is ready; legacy seeds keep working until then).
        // reading-completion-flowing-fix — this MUST run BEFORE the
        // flowing-block check so an uploaded diagram/flow image always
        // wins over the shared-summary_text path.
        if ((type === 'diagram_label_completion' || type === 'flow_chart_completion') &&
            run[0].payload && typeof run[0].payload.image_url === 'string' &&
            run[0].payload.image_url) {
          var diagramBox = _renderDiagramImageBlock(run);
          groupEl.appendChild(diagramBox);
          host.appendChild(groupEl);
          return; // skip the mono-block path for this run
        }

        // Sprint 20.14e — completion FLOWING block (Standards §2A.10 /
        // §2A.11). When the first Q of a completion run carries
        // `template.summary_text` (with `{{N}}` markers), render the WHOLE
        // run as ONE flowing block in a `.exam-gap-box` with inline inputs
        // (or selects for the word-bank variant) at each `{{N}}` marker.
        // The legacy per-Q card rendering is the fallback for runs without
        // summary_text — kept for back-compat with seeds that pre-date
        // 20.14e. See reading_content_format_v2.md §4.2 for the contract.
        // reading-header-notefill B — note_completion joins this path: an
        // authentic IELTS note/summary is ONE connected block with the
        // numbered blanks inline, not per-Q rows.
        // reading-completion-flowing-fix — the flowing path now covers
        // EVERY completion type authors emit with the shared-summary_text +
        // "(see summary above)" pattern (sentence / table / form / flow-
        // chart / diagram — not just summary / notes). Before this, those
        // types fell through to the mono-block per-Q path, which showed the
        // placeholder prompt with the summary_text + its {{N}} gaps NEVER
        // rendered → the whole run was UNANSWERABLE. The diagram/flow image
        // variant is handled above (image wins); only no-image runs reach
        // here. New types are listed FIRST so the tail keeps the original
        // `summary_completion || notes_completion)` shape (pinned by tests).
        if ((type === 'sentence_completion' || type === 'table_completion' ||
             type === 'form_completion' || type === 'flow_chart_completion' ||
             type === 'diagram_label_completion' ||
             type === 'summary_completion' || type === 'notes_completion') &&
            run[0].payload && run[0].payload.template &&
            typeof run[0].payload.template.summary_text === 'string') {
          var sumBox = _renderFlowingSummaryBlock(run);
          groupEl.appendChild(sumBox);
          host.appendChild(groupEl);
          return; // skip the per-Q card path entirely for this run
        }

        // Sprint 20.14a T1.1 / T1.3 — wrap completion runs in a `.gap-box`
        // so summary / notes / table groups read as a single block, with
        // each question's stem flowing inline (Standards §2A.10 / §2A.12).
        // sentence_completion + short_answer stay un-boxed (§2A.9 / §2A.14).
        // table/notes get the additional `.mono-block` modifier so
        // columns / arrows / indent in the stem survive layout.
        // Sprint 20.14b — Phase B completion types added. flow_chart and
        // diagram_label join the mono-block family (preserve column /
        // arrow / indent alignment); summary_completion stays in the
        // boxed-not-mono group (the no-word-bank variant; word-bank
        // variant is rendered separately in renderInputs and is also
        // wrapped here in `.exam-gap-box` so the summary reads as one
        // block).
        var boxedTypes = {
          summary_completion: false, notes_completion: true,
          table_completion: true, form_completion: true,
          flow_chart_completion: true, diagram_label_completion: true,
        };
        if (Object.prototype.hasOwnProperty.call(boxedTypes, type)) {
          var box = document.createElement('div');
          box.className = 'exam-gap-box' + (boxedTypes[type] ? ' exam-gap-box--mono' : '');
          box.setAttribute('data-question-type', type);
          run.forEach(function (q) { box.appendChild(renderQuestion(q)); });
          groupEl.appendChild(box);
        } else {
          run.forEach(function (q) { groupEl.appendChild(renderQuestion(q)); });
        }

        host.appendChild(groupEl);
      });
  }

  // Sprint 20.14a T1.2 (headings) + Sprint 20.14b (features / endings /
  // word-bank) — shared bank-box renderer. Standards §2A.5 / §2A.7 /
  // §2A.8 / §2A.11 all mandate the same shape: bordered card above the
  // questions, sticky, one entry per line with the label in bold and
  // the text in a hanging-indent column. Variant only differs by
  // wrapping class + title; the helper's `variant` arg supplies both.
  function _renderBankBox(options, variant) {
    if (!Array.isArray(options) || !options.length) return null;
    var v = variant || { className: 'exam-headings-box', title: 'List' };
    var box = document.createElement('aside');
    box.className = v.className;
    box.setAttribute('aria-label', v.title);
    var title = document.createElement('p');
    title.className = v.className + '__title';
    title.textContent = v.title;
    box.appendChild(title);
    var list = document.createElement('ol');
    list.className = v.className + '__list';
    options.forEach(function (o) {
      var item = document.createElement('li');
      item.className = v.className + '__item';
      var label = document.createElement('span');
      label.className = v.className + '__roman';
      label.textContent = o.label != null ? String(o.label) : '';
      var text = document.createElement('span');
      text.className = v.className + '__text';
      text.textContent = o.text || '';
      item.appendChild(label);
      item.appendChild(text);
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  }

  // Sprint 20.14e — render a summary_completion run as ONE flowing
  // paragraph in a single `.exam-gap-box` (Standards §2A.10 / §2A.11).
  // The first Q of the run carries `template.summary_text` containing
  // `{{N}}` markers; each marker is replaced by either:
  //   • a text `<input>` (no-word-bank variant, §2A.10), OR
  //   • a `<select>` of label-only options (word-bank variant, §2A.11
  //     — bank already rendered as `.exam-word-bank-box` above by the
  //     BANK_VARIANTS dispatch).
  // Each `{{N}}` maps to the q_num of the question that owns that gap;
  // the `<input>`/`<select>` carries `name="q-N"` so the existing
  // change/input/readAnswer/restoreAnswers path keeps grading per Q.
  var _SUMMARY_MARKER_RE = /\{\{\s*(\d{1,3})\s*\}\}/g;
  // reading-completion-flowing-fix — completion types whose summary_text keeps
  // a MULTI-LINE layout render via a line-preserving branch; only
  // summary_completion falls through to one justified prose paragraph.
  // reading-completion-mono-fix — two flavours: the MONO types (table /
  // flow-chart / diagram) convey columns/steps through spacing + indentation,
  // so they need a whitespace-preserving pre-wrap MONO block — the note-heading
  // parser's `line.trim()` + per-line <div> would collapse that alignment
  // (`--notes` sets only line-height, not white-space: pre-wrap). notes /
  // sentence / form are line-based prose → the note parser is correct. Both
  // maps built once at module scope, not rebuilt per render call.
  var MONO_LAYOUT = {
    table_completion: 1, flow_chart_completion: 1, diagram_label_completion: 1,
  };
  var STRUCTURED_LAYOUT = {
    notes_completion: 1, form_completion: 1, sentence_completion: 1,
  };
  function _renderFlowingSummaryBlock(run) {
    var first = run[0];
    var template = first.payload.template.summary_text;
    var wordBank = first.payload && Array.isArray(first.payload.options) && first.payload.options.length
      ? first.payload.options : null;
    // Build a Map<q_num, Q> so each marker resolves to the right
    // question — answers + flag state still attach via q_num.
    var byQNum = {};
    run.forEach(function (q) { byQNum[q.q_num] = q; });

    // reading-completion-mono-fix — pick layout: MONO (pre-wrap monospace for
    // table/flow/diagram), NOTES (line parser for notes/sentence/form), PROSE.
    var qType   = first.question_type;
    var isMono  = !!MONO_LAYOUT[qType];
    var isNotes = !!STRUCTURED_LAYOUT[qType];
    var box = document.createElement('div');
    box.className = 'exam-gap-box exam-gap-box--summary'
      + (isNotes ? ' exam-gap-box--notes' : '');
    box.setAttribute('data-question-type', qType || 'summary_completion');

    var src = String(template || '');

    // Fill `container` from a template segment: plain text chunks become text
    // nodes; each {{N}} marker becomes a numbered badge + input/select bound
    // to that q_num (name="q-N" + dataset.q so the existing grading path is
    // unchanged). Shared by the summary paragraph and each note line.
    function _fillTemplate(container, text) {
      var re = /\{\{\s*(\d{1,3})\s*\}\}/g;
      var last = 0, m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
        var qNum = parseInt(m[1], 10);
        var q = byQNum[qNum];
        if (!q) {
          container.appendChild(document.createTextNode(m[0]));
        } else {
          var numEl = document.createElement('span');
          numEl.className = 'exam-summary__gnum';
          numEl.textContent = String(qNum);
          container.appendChild(numEl);
          container.appendChild(document.createTextNode(' '));
          if (wordBank) {
            var sel = document.createElement('select');
            sel.className = 'exam-q__select exam-q__select--inline';
            sel.name = 'q-' + qNum; sel.dataset.q = String(qNum);
            sel.setAttribute('aria-label', 'Answer ' + qNum);
            var ph = document.createElement('option');
            ph.value = ''; ph.textContent = '— Select —';
            sel.appendChild(ph);
            wordBank.forEach(function (o) {
              var val = o.label != null ? String(o.label) : String(o.text || '');
              var opt = document.createElement('option');
              opt.value = val; opt.textContent = val;
              sel.appendChild(opt);
            });
            container.appendChild(sel);
          } else {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'exam-q__gap exam-q__gap--inline';
            input.name = 'q-' + qNum; input.dataset.q = String(qNum);
            input.setAttribute('aria-label', 'Answer ' + qNum);
            input.setAttribute('autocomplete', 'off');
            container.appendChild(input);
          }
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
    }

    if (isMono) {
      // reading-completion-mono-fix — table/flow/diagram convey structure via
      // spacing; render summary_text in ONE pre-wrap mono block so columns survive.
      var mono = document.createElement('div');
      mono.className = 'exam-summary__mono';
      _fillTemplate(mono, src);
      box.appendChild(mono);
    } else if (isNotes) {
      // reading-review-locate-exam-format B1 — render notes as a STRUCTURED
      // block: the first non-blank line is the title, bullet lines ("• …") get
      // a styled marker, and other non-blank/no-blank lines are sub-headings —
      // so it reads as a clean note, not a pre-wrap blob. Inline blanks + their
      // q_num binding are unchanged (via _fillTemplate).
      var sawTitle = false;
      src.split("\n").forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        var lineEl = document.createElement('div');
        var bm = /^[••\-*]\s+(.*)$/.exec(t);
        if (bm) {
          lineEl.className = 'exam-note__bullet';
          _fillTemplate(lineEl, bm[1]);
        } else if (!/\{\{/.test(t)) {
          // a heading line (no fill-in blank): first one = title, rest = section
          lineEl.className = sawTitle ? 'exam-note__heading' : 'exam-note__title';
          sawTitle = true;
          _fillTemplate(lineEl, t);
        } else {
          lineEl.className = 'exam-note__line';
          _fillTemplate(lineEl, t);
        }
        box.appendChild(lineEl);
      });
    } else {
      var prose = document.createElement('p');
      prose.className = 'exam-summary__prose';
      _fillTemplate(prose, src);
      box.appendChild(prose);
    }

    // The flowing summary uses the per-card change/input handlers via
    // delegation on the box. The `dataset.q` on each input + the
    // existing onAnswerChanged(qNum, card) signature mean we synthesise
    // a "card-like" wrapper: pass the box itself; readAnswer walks the
    // element and finds the focused input by name. For per-Q routing
    // we need a more targeted listener that resolves the changed
    // element's `data-q` and looks up that element only.
    box.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.q) return;
      var qNum = parseInt(t.dataset.q, 10);
      if (isNaN(qNum)) return;
      // Build a minimal "card" that readAnswer can scan to find the
      // single input/select that fired. Re-use onAnswerChanged so
      // SESSION.answers + palette state + autosave stay synchronised.
      var pseudoCard = document.createElement('div');
      pseudoCard.appendChild(t.cloneNode(true));
      // readAnswer only reads attributes, so clone-then-restore works.
      // But it's cleaner to read the value directly here.
      var value = t.tagName === 'SELECT' ? t.value : t.value;
      // Re-implement the onAnswerChanged side-effects for this single
      // gap (debounce flush, palette flip, SESSION.answers update).
      _summaryGapChanged(qNum, value);
    });
    box.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.q) return;
      var qNum = parseInt(t.dataset.q, 10);
      if (isNaN(qNum)) return;
      var value = t.tagName === 'SELECT' ? t.value : t.value;
      _summaryGapChanged(qNum, value);
    });

    return box;
  }

  // Sprint 20.14e — per-gap change handler for the flowing summary
  // block. Mirrors onAnswerChanged's side-effects (SESSION.answers +
  // answered-state + debounce-PATCH) but bypasses readAnswer's
  // card-scan since the flowing block doesn't have one card per gap.
  function _summaryGapChanged(qNum, value) {
    SESSION.answers.set(qNum, value);
    if (value === '' || value == null) {
      SESSION.answers['delete'](qNum);
      _setAnsweredState(qNum, false);
    } else {
      _setAnsweredState(qNum, true);
    }
    if (SESSION.debounce_timers.has(qNum)) clearTimeout(SESSION.debounce_timers.get(qNum));
    SESSION.debounce_timers.set(qNum, setTimeout(function () {
      patchAnswer(qNum, value);
      SESSION.debounce_timers['delete'](qNum);
    }, 500));
  }

  // Sprint 20.14f-α — render a diagram_label / flow_chart run as one
  // `.exam-diagram-container` with the admin-uploaded image on top + a
  // numbered side-list of text inputs below (Standards §2A.13). The
  // first Q of the run carries `payload.image_url` (signed by the
  // student fetch); follow-up Qs render their per-Q input row without
  // duplicating the image. Each row uses `name="q-N"` + `data-q="N"`
  // so the existing palette / answered-state / autosave wiring fires
  // unchanged via the box-level delegated change/input listeners (the
  // same delegation pattern Sprint 20.14e introduced for the flowing
  // summary block).
  function _renderDiagramImageBlock(run) {
    var first = run[0];
    var imgUrl = first.payload.image_url;

    var container = document.createElement('div');
    container.className = 'exam-diagram-container';
    container.setAttribute('data-question-type', first.question_type);

    var img = document.createElement('img');
    img.className = 'exam-diagram-image';
    img.src = imgUrl;
    img.alt = (first.question_type === 'flow_chart_completion'
      ? 'Flow chart' : 'Labeled diagram')
      + ' for questions ' + first.q_num + '–' + run[run.length - 1].q_num;
    container.appendChild(img);

    var list = document.createElement('ol');
    list.className = 'exam-diagram-rows';
    run.forEach(function (q) {
      var row = document.createElement('li');
      row.className = 'exam-diagram-row';

      var num = document.createElement('span');
      num.className = 'exam-diagram-row__num';
      num.textContent = String(q.q_num);

      var prompt = document.createElement('span');
      prompt.className = 'exam-diagram-row__prompt';
      // Author-supplied prompt is the per-callout cue (e.g. "Label
      // 3 — the part marked with arrow 3"). Pre-image content seeds
      // (AVR-READ-002) use placeholder prose; the image carries the
      // numbered cues. Either reads fine in the side-list slot.
      prompt.textContent = q.prompt || '';

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'exam-diagram-row__input';
      input.name = 'q-' + q.q_num;
      input.setAttribute('aria-label', 'Answer ' + q.q_num);
      input.setAttribute('autocomplete', 'off');
      input.dataset.q = String(q.q_num);

      row.appendChild(num);
      row.appendChild(prompt);
      row.appendChild(input);
      list.appendChild(row);
    });
    container.appendChild(list);

    // Box-level delegation: route per-gap input/change → the per-Q
    // change handler shared with the summary flowing block. Same
    // SESSION.answers / palette flip / debounce PATCH side-effects.
    container.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.q) return;
      var qNum = parseInt(t.dataset.q, 10);
      if (isNaN(qNum)) return;
      _summaryGapChanged(qNum, t.value);
    });
    container.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.q) return;
      var qNum = parseInt(t.dataset.q, 10);
      if (isNaN(qNum)) return;
      _summaryGapChanged(qNum, t.value);
    });

    return container;
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
    // Sprint 20.14b — word-bank summary (`summary_completion` WITH
    // `options:`) is an exception: even though its stem has `____`, the
    // gap accepts a label-pick from the word-bank dropdown rather than
    // free-typed text. _renderInlineStem still does the split, but the
    // input element it emits needs to be a <select>; for MVP we route
    // it through the standard prompt+control layout instead so the
    // dropdown wins. Phase B+ refinement could thread a "make-select"
    // hook into _renderInlineStem for inline-select gaps.
    if (_isInlineGapType(q.question_type) && _stemHasGap(q.prompt) && !_isWordBankSummary(q)) {
      body.appendChild(_renderInlineStem(q));
    } else {
      var prompt = document.createElement('p');
      prompt.className = 'exam-q__prompt'; prompt.textContent = q.prompt || '';
      body.appendChild(prompt);
      renderInputs(body, q);
    }

    var flag = document.createElement('button');
    flag.type = 'button'; flag.className = 'exam-q__flag';
    // Sprint 20.14c D1 — initialize from SESSION.flagged so Part swaps
    // (which re-render the card) restore the pressed state. Without
    // this, returning to a Part where the student previously flagged
    // Q3 would show Q3 unflagged on the card (palette tile is unchanged
    // and still showed the amber circle, so the cue was inconsistent).
    var isFlagged = SESSION.flagged.has(q.q_num);
    flag.setAttribute('aria-pressed', isFlagged ? 'true' : 'false');
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
  // Sprint 20.14b — diagram_label_completion + flow_chart_completion
  // join the inline-gap family. summary_completion stays inline-gap;
  // its word-bank variant (presence of `options:` on the question) is
  // routed AWAY from `_renderInlineStem` and handled by `renderInputs`
  // below (which emits a `<select>` instead of a text input).
  function _isInlineGapType(type) {
    return type === 'sentence_completion' || type === 'summary_completion' ||
           type === 'notes_completion'    || type === 'table_completion'   ||
           type === 'form_completion'     || type === 'short_answer'       ||
           type === 'flow_chart_completion' || type === 'diagram_label_completion';
  }
  // Sprint 20.14b — `summary_completion` with authored `options:` is
  // the word-bank variant (§2A.11) — the gap accepts a label-pick via
  // a dropdown, not free-typed text. Route those to the standard
  // (non-inline) renderInputs path so the dropdown wins over the
  // text-input.
  function _isWordBankSummary(q) {
    return q && q.question_type === 'summary_completion' &&
           q.payload && Array.isArray(q.payload.options) && q.payload.options.length > 0;
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
    } else if (type === 'matching_headings' || type === 'matching_features' ||
               type === 'matching_sentence_endings' ||
               (type === 'summary_completion' && _isWordBankSummary(q))) {
      // Sprint 20.14a T1.2 + Sprint 20.14b — bank-driven select. Same
      // dispatch path for matching_headings (i/ii/iii…) and the Phase B
      // matching_features (A–E), matching_sentence_endings (A–G), and
      // summary_completion word-bank variant (A–J). The bank itself
      // renders ABOVE the questions in its respective `.exam-*-box`
      // (see renderQuestions), so each `<option>` here is label-only.
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
    } else if (type === 'matching_information') {
      // Sprint 20.14b — Standards §2A.6: the "options" are the
      // passage's own paragraph labels (A–H), not an authored bank.
      // The author scopes the letters via `template: { paragraph_labels: [...] }`
      // (the builder copies template → payload.template) — if absent,
      // fall back to the conventional A–H range. No box renders above
      // the questions for this type; the student picks letters that are
      // visible inline in the passage.
      var tmpl = (q.payload && q.payload.template) || {};
      var labels = (Array.isArray(tmpl.paragraph_labels) && tmpl.paragraph_labels.length)
        ? tmpl.paragraph_labels
        : ['A','B','C','D','E','F','G','H'];
      var sel = document.createElement('select');
      sel.className = 'exam-q__select'; sel.name = name;
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— Select —';
      sel.appendChild(ph);
      labels.forEach(function (lab) {
        var opt = document.createElement('option');
        opt.value = String(lab); opt.textContent = String(lab);
        sel.appendChild(opt);
      });
      body.appendChild(sel);
    } else if (type === 'mcq_multi') {
      // Sprint 20.14b — Standards §2A.2 "Choose TWO letters, A–E".
      // Checkbox per option. Soft-lock at N picks (the count comes from
      // the authored answer-key length, propagated via payload.choose).
      // When the user already has N boxes ticked, additional clicks are
      // ignored and a tiny live-region hint fires (a11y-only — no toast,
      // matching the §2A.2 "lock additional input" hint). Submit
      // serialises the picked labels comma-joined for the grader's
      // set-equality compare (see services/reading_test_grader.py).
      // `choose` lives at template.choose (author writes
       // `template: { choose: 2 }`; builder copies to payload.template).
      var tmpl = (q.payload && q.payload.template) || {};
      var chooseN = (typeof tmpl.choose === 'number') ? tmpl.choose : null;
      var opts = document.createElement('div');
      opts.className = 'exam-q__options exam-q__options--multi';
      opts.setAttribute('role', 'group');
      opts.setAttribute('aria-label', 'Answer ' + q.q_num +
        (chooseN ? ' (choose ' + chooseN + ')' : ''));
      ((q.payload && q.payload.options) || []).forEach(function (o) {
        var val = o.label != null ? String(o.label) : String(o.text || '');
        var prefix = o.label != null ? String(o.label) : '';
        opts.appendChild(checkboxOption(name, val, prefix, o.text || ''));
      });
      // Soft-lock: when the Nth box is ticked, lock the rest until one
      // is un-ticked. Listens on the group's change events.
      if (chooseN && chooseN > 0) {
        opts.addEventListener('change', function () {
          var boxes = opts.querySelectorAll('input[type="checkbox"]');
          var checked = 0;
          for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) checked++;
          var lock = checked >= chooseN;
          for (var j = 0; j < boxes.length; j++) {
            if (!boxes[j].checked) boxes[j].disabled = lock;
          }
          if (lock) liveSay('Choose ' + chooseN + ' answers — limit reached.');
        });
      }
      body.appendChild(opts);
    } else {
      // short_answer / *_completion text gap
      var input = document.createElement('input');
      input.type = 'text'; input.className = 'exam-q__gap'; input.name = name;
      // Sprint 20.11 D4 — English inside exam content (see _qRangeLabel note).
      input.placeholder = 'Type your answer…';
      body.appendChild(input);
    }
  }
  // Sprint 20.14b — mcq_multi checkbox option. Same grid layout as
  // mcq_single radio (radio | bold prefix | text) so the visual rhythm
  // is unchanged between the two MCQ variants.
  function checkboxOption(name, value, prefix, text) {
    var label = document.createElement('label');
    label.className = 'exam-q__option exam-q__option--checkbox';
    var input = document.createElement('input');
    input.type = 'checkbox'; input.name = name; input.value = value;
    label.appendChild(input);
    var prefixEl = document.createElement('span');
    prefixEl.className = 'exam-q__option-prefix';
    prefixEl.textContent = String(prefix || '');
    var textEl = document.createElement('span');
    textEl.className = 'exam-q__option-text';
    textEl.textContent = String(text || '');
    label.appendChild(prefixEl); label.appendChild(textEl);
    return label;
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
    // Sprint 20.14b — mcq_multi: comma-join the ticked checkbox labels.
    // The grader splits on `,` and `;` and normalises each token, so
    // ordering and surrounding whitespace don't matter. Empty selection
    // returns "" which onAnswerChanged treats as "not answered".
    var multi = card.querySelectorAll('input[type="checkbox"]:checked');
    if (multi.length || card.querySelector('input[type="checkbox"]')) {
      // Has checkboxes — even if none ticked, this is the mcq_multi
      // shape (return the empty selection rather than falling through
      // to radio/select which would mis-read).
      var vals = [];
      for (var i = 0; i < multi.length; i++) vals.push(multi[i].value);
      return vals.join(',');
    }
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
    var answersUrl = '/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/answers';
    var answerBody = { q_num: qNum, user_answer: String(userAnswer || '') };
    // reading-access-tracking B2 — anonymous auto-save carries X-Reading-Anon +
    // noRedirect (a transient 401 must not bounce an anon mid-test to login);
    // the authed path keeps the plain window.api.patch call.
    var savePromise = SESSION.share_mode
      ? window.api.patchWith(answersUrl, answerBody, _anonHeaders(), { noRedirect: true })
      : window.api.patch('/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/answers',
          { q_num: qNum, user_answer: String(userAnswer || '') });
    savePromise.catch(function (e) {
      // Best-effort auto-save — the source of truth is in-memory + submit body.
      if (window.console) console.warn('auto-save failed q=' + qNum, e && e.message);
    });
    return savePromise;   // returned so the mock flush can await pending saves
  }
  function restoreAnswers() {
    SESSION.answers.forEach(function (value, qNum) {
      // Sprint 20.14e — flowing summary block: gaps live inside the
      // shared `.exam-gap-box--summary` (NOT inside a `.exam-q` card).
      // Sprint 20.14f-α — diagram/flow image block: same out-of-card
      // pattern under `.exam-diagram-container`. Both lookups land on
      // a single per-q_num input; markAnswered fires the standard
      // SESSION.flagged + palette + Q-card-class side-effects.
      var outOfCardInput = document.querySelector(
        '.exam-gap-box--summary [name="q-' + qNum + '"], ' +
        '.exam-diagram-container [name="q-' + qNum + '"]',
      );
      if (outOfCardInput) {
        outOfCardInput.value = value || '';
        if (value !== '' && value != null) markAnswered(qNum);
        return;
      }
      var card = document.getElementById('q-' + qNum);
      if (!card) return;
      var input = card.querySelector('.exam-q__gap');
      if (input) { input.value = value || ''; markAnswered(qNum); return; }
      var sel = card.querySelector('select');
      if (sel) { sel.value = value || ''; markAnswered(qNum); return; }
      // Sprint 20.14b — mcq_multi: split the comma-joined value, tick
      // each matching checkbox. The escape-on-attribute-selector pattern
      // mirrors the radio branch below.
      var checkboxes = card.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length) {
        var labels = String(value || '').replace(/;/g, ',').split(',')
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length; });
        labels.forEach(function (lab) {
          try {
            var safe = (window.CSS && CSS.escape) ? CSS.escape(lab) : lab.replace(/"/g, '\\"');
            var cb = card.querySelector('input[type="checkbox"][value="' + safe + '"]');
            if (cb) cb.checked = true;
          } catch (e) {}
        });
        if (labels.length) markAnswered(qNum);
        return;
      }
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
    // Sprint 20.14c D1 — palette / Prev / Next click handler. If the
    // target question belongs to a different Part than the one currently
    // rendered, swap Parts FIRST (re-render both panes, restore answers
    // + highlights), then scroll to the question in the freshly-rendered
    // pane. Standards §3A.2 — no confirm dialog, instant swap.
    var all = (SESSION.test && SESSION.test.questions) || [];
    var targetQ = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].q_num === qNum) { targetQ = all[i]; break; }
    }
    var targetPart = (targetQ && targetQ.passage_order) || SESSION.currentPart;
    if (targetPart !== SESSION.currentPart) {
      setCurrentPart(targetPart, /* skipScrollTop */ true);
      // Re-render destroyed the prior `#q-N`; the new pane has the
      // matching card now. Continue with scrollIntoView below.
    }
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

  // ── Sprint 20.14c D1 — Part swap orchestrator (Standards §3A.2) ───
  // Snapshots the outgoing Part's highlights, updates state, re-renders
  // BOTH panes (passage + questions), restores answers + answered-state
  // markers, and scrolls both panes to the top (matches the standards'
  // "Part mới load cuộn về đầu cả hai pane" rule). `skipScrollTop` is
  // used by jumpTo so the subsequent scrollIntoView(qNum) lands the
  // student on the clicked question rather than the Part's top.
  function setCurrentPart(part, skipScrollTop) {
    if (!part || part === SESSION.currentPart) return;
    // 1) Snapshot the outgoing Part's highlights/notes before re-render.
    snapshotCurrentPartHighlights();
    // 2) Flip state.
    SESSION.currentPart = part;
    // 3) Re-render both panes.
    renderCurrentPassage();
    renderCurrentPartQuestions();
    // 4) Restore answers + answered-state markers for the new Part's Qs
    //    (answers held in SESSION.answers; markers are DOM-level so a
    //    re-render wipes them and they need re-applying).
    restoreAnswers();
    // 5) Scroll-to-top both panes (Standards §3A.2). The student starts
    //    fresh on the new Part instead of inheriting a mid-scroll
    //    position from the prior Part.
    if (!skipScrollTop) {
      var passagePane = $('exam-passage');
      var questionsPane = $('exam-questions');
      if (passagePane) passagePane.scrollTop = 0;
      if (questionsPane) questionsPane.scrollTop = 0;
    }
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
    // 4-skill mock (mock_embed): the parent page owns the single TOTAL timer.
    // Skip the per-section countdown — it would auto-submit Reading prematurely
    // at the section limit while the mock is still running.
    if (window.MockHook && MockHook.embedded && MockHook.embedded()) return;
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

    // reading-access-tracking B2 — anonymous submit carries X-Reading-Anon
    // (ownership) + noRedirect; the authed path is unchanged.
    var submitPromise = SESSION.share_mode
      ? window.api.postWith(
          '/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/submit',
          { answers: answers }, _anonHeaders(), { noRedirect: true })
      : window.api.post(
          '/api/reading/test/attempts/' + encodeURIComponent(SESSION.attempt_id) + '/submit',
          { answers: answers }
        );
    submitPromise.then(function (result) {
      // Mock sitting: a sealed submit returns {received:true} (no score).
      // Embedded (3-tab mock) → the parent finalises, stay quiet. Standalone
      // sealed mock → hand back to the orchestrator.
      if (window.MockHook && MockHook.isSealedResponse(result)) {
        if (!(MockHook.embedded && MockHook.embedded())) MockHook.showSealedAndReturn('reading');
        return;
      }
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
    // reading-access-tracking B2 — the diagnostic endpoint is auth-only (it ties
    // weak-skill history to an account). An anonymous share-link taker has no
    // account, so skip it (calling it would 401); the band + skill breakdown +
    // chữa-bài above already give full per-attempt feedback.
    if (SESSION.share_mode) {
      if (intro) intro.textContent = 'Phân tích weak-skill theo tài khoản không áp dụng cho bài làm ẩn danh — bạn vẫn có đầy đủ điểm, skill breakdown và chữa bài ở trên.';
      host.innerHTML = '';
      return;
    }
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

    // Reading mini test — iterate the parts that ACTUALLY exist in by_part
    // (sorted), not a hard-coded p1/p2/p3. A mini yields only {p1}; this also
    // future-proofs any N-passage test. The grader emits keys p1..pN dynamically.
    var byPartHost = $('results-by-part'); byPartHost.innerHTML = '';
    var partKeys = Object.keys(result.by_part || {}).sort(function (a, b) {
      return (parseInt(a.slice(1), 10) || 0) - (parseInt(b.slice(1), 10) || 0);
    });
    var byPartTitle = $('results-by-part-title');
    if (byPartTitle) {
      byPartTitle.textContent = 'Theo đoạn (' + partKeys.length + ' parts)';
    }
    partKeys.forEach(function (key) {
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

    // reading-rich Part C — point the CTA at the chữa-bài review for this
    // attempt (the rich solution is revealed only post-submit, server-gated).
    var chuaBai = $('results-chuabai-link');
    if (chuaBai && result.attempt_id) {
      // reading-access-tracking B2 — an anonymous taker owns the review via the
      // anon_id capability token, so append it on the chữa-bài URL (the review
      // page replays it as X-Reading-Anon). Authed takers use their session.
      var anonSuffix = (SESSION.share_mode && _getAnonId())
        ? '&anon=' + encodeURIComponent(_getAnonId()) : '';
      // Carry the origin through to the review page too — it has the same
      // both-libraries problem and would otherwise guess.
      chuaBai.href = '/pages/reading-review.html?attempt_id=' + encodeURIComponent(result.attempt_id)
        + anonSuffix + '&from=' + originFromUrl();
      chuaBai.hidden = false;
    }

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
    // Sprint 20.14c D1 — render only the currentPart's passage + Qs
    // (Standards §3A.2). The palette still receives the FULL question
    // list (so all 40 tiles render in the bottom bar) — only the panes
    // are filtered. Default currentPart is 1 from SESSION init; resume
    // keeps it 1 too (last-active-Part is a future option if Andy asks).
    renderCurrentPassage();
    renderCurrentPartQuestions();
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
    // reading-access-tracking B2 — anonymous share-link start. Mints an anon_id
    // (stored so resume + review work) and creates a user_id-NULL attempt; no
    // password gate (the share token already bypassed the lock at boot).
    var startPromise = SESSION.share_mode
      ? window.api.postWith(
          '/api/reading/test/share/' + encodeURIComponent(SESSION.share_token) + '/attempts',
          null, _anonHeaders(), { noRedirect: true })
        .then(function (res) { _setAnonId(res && res.anon_id); return res; })
      // F1 — carry the locked-test password (if any) so start passes the gate.
      : window.api.postWith('/api/reading/test/' + encodeURIComponent(SESSION.test_id) + '/attempts', null, _pwHeaders());
    return startPromise
      .then(function (res) {
        SESSION.attempt_id = res.attempt_id;
        SESSION.started_at = res.started_at;
        SESSION.time_limit_minutes = res.time_limit_minutes;
        // Clear the resumed answers — this is a fresh attempt.
        SESSION.answers = new Map();
        SESSION.flagged = new Set();
        SESSION.resume_inprogress = false;
        // Mock sitting: link this attempt so its submit is sealed server-side.
        // Fail-closed — the exam must not start until the link is written.
        if (window.MockHook && MockHook.active()) {
          return MockHook.attach('reading', res.attempt_id).then(enterInProgress);
        }
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

  // reading-access-tracking F1 — locked-test password gate. The password is
  // held in sessionStorage (per test_id) and sent as X-Reading-Password on
  // boot + start; a 403 means locked/wrong → prompt + retry. The gate is
  // enforced server-side (the bundle is never returned without it).
  function _pwKey() { return 'reading-pw:' + SESSION.test_id; }
  function _pwHeaders() {
    var pw = null;
    try { pw = sessionStorage.getItem(_pwKey()); } catch (e) {}
    return pw ? { 'X-Reading-Password': pw } : null;
  }
  function _promptPasswordThenRetry() {
    var pw = window.prompt('🔒 Bài thi này đang khoá. Nhập mật khẩu để vào:');
    if (pw == null || !pw.trim()) {
      showError('Bài thi đang khoá — cần mật khẩu đúng để truy cập.');
      return;
    }
    try { sessionStorage.setItem(_pwKey(), pw.trim()); } catch (e) {}
    _doBoot();
  }

  // reading-access-tracking B2 — anonymous identity. The minted anon_id is the
  // ONLY credential for a share-link attempt (the server verifies it on
  // submit/review/answers), so persist it in localStorage keyed by the share
  // token — that survives a refresh/return so resume + chữa-bài work. (If the
  // user clears storage they lose access to that attempt; the anon_id is
  // unrecoverable by design — there's no account to fall back on.)
  function _anonKey() { return 'reading-anon:' + SESSION.share_token; }
  function _getAnonId() {
    try { return localStorage.getItem(_anonKey()) || null; } catch (e) { return null; }
  }
  function _setAnonId(id) {
    if (!id) return;
    try { localStorage.setItem(_anonKey(), id); } catch (e) {}
  }
  function _anonHeaders() {
    if (!SESSION.share_mode) return null;
    var id = _getAnonId();
    return id ? { 'X-Reading-Anon': id } : null;
  }

  function boot() {
    wireBack();                 // before any early return — the error state is
                                // exactly when a working way out matters most
    // Share-link mode wins when `?share=<token>` is present (anonymous, no
    // test_id needed). Otherwise the normal authed `?test_id=…` path.
    var shareToken = shareTokenFromUrl();
    if (shareToken) {
      SESSION.share_mode = true;
      SESSION.share_token = shareToken;
      _doBoot();
      return;
    }
    var testId = testIdFromUrl();
    if (!testId) { showError('No test specified (use ?test_id=…).'); return; }
    SESSION.test_id = testId;
    _doBoot();
  }
  function _doBoot() {
    // reading-access-tracking B2 — anonymous share boot (no auth, lock-bypassed,
    // solution-stripped). Carries the stored anon_id so an interrupted attempt
    // resumes. noRedirect: a rejected token must show a friendly state, never
    // bounce to login (the user has no account).
    var testId = SESSION.test_id;
    var bootPromise = SESSION.share_mode
      ? window.api.getWith(
          '/api/reading/test/share/' + encodeURIComponent(SESSION.share_token) + '/boot',
          _anonHeaders(), { noRedirect: true })
      : window.api.getWith('/api/reading/test/' + encodeURIComponent(testId) + '/boot', _pwHeaders());
    bootPromise
      .then(function (bootPayload) {
        var test = bootPayload && bootPayload.test;
        if (!test) throw new Error('Boot payload missing test');
        // In share mode there is no ?test_id= — adopt the bundle's test_id so
        // the per-test cache namespace + downstream display work (reassign the
        // local testId too so the cache call below keys correctly).
        if (SESSION.share_mode) {
          SESSION.test_id = test.test_id || SESSION.share_token;
          testId = SESSION.test_id;
        }
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
          // Mock sitting: re-link on resume (idempotent) in case a create-time
          // attach failed and left the attempt unsealed. User interaction before
          // resume gives this time to complete.
          if (window.MockHook && MockHook.active()) {
            MockHook.attach('reading', inprog.attempt_id).catch(function () {});
          }
          SESSION.resume_inprogress = true;
          configurePreStartActions(true);
        } else {
          SESSION.resume_inprogress = false;
          configurePreStartActions(false);
        }
        showState('prestart');
      })
      .catch(function (e) {
        // reading-access-tracking B2 — in share mode a 403 (expired / rotated)
        // or 404 (unknown / revoked) token is a dead link, NOT a locked test:
        // show a clear friendly state, never the password prompt or login.
        if (SESSION.share_mode) {
          if (e && (e.status === 403 || e.status === 404)) {
            showError('Liên kết chia sẻ đã hết hạn hoặc không hợp lệ. Hãy xin người gửi một liên kết mới.');
          } else {
            showError('Không tải được bài thi. ' + (e && e.message ? e.message : ''));
          }
          return;
        }
        if (e && e.status === 403) { _promptPasswordThenRetry(); return; }
        if (e && e.status === 404) showError('Test not found or not published.');
        else showError('Failed to load test. ' + (e && e.message ? e.message : ''));
      });
  }
  boot();

  // 4-skill mock (mock_embed): the parent one-timer page asks this runner to
  // FLUSH its debounced auto-saves before it submits the attempt — so an answer
  // typed just before "Nộp toàn bộ" isn't stranded in the debounce queue.
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'mock-flush') return;
    var pending = [];
    try {
      SESSION.debounce_timers.forEach(function (handle, qNum) {
        clearTimeout(handle);
        // Flush from the IN-MEMORY answer store (source of truth), not the DOM
        // card — the card may be unmounted (student switched Part within the
        // debounce window) or be a non-#q-N input (summary/diagram), in which
        // case readAnswer(card) would be null and the answer silently lost.
        pending.push(patchAnswer(qNum, SESSION.answers.get(qNum)));
      });
      SESSION.debounce_timers.clear();
    } catch (e) { /* best-effort */ }
    Promise.all(pending.map(function (p) { return (p && p.catch) ? p.catch(function () {}) : Promise.resolve(); }))
      .then(function () { if (ev.source) ev.source.postMessage({ type: 'mock-flushed', section: 'reading' }, '*'); });
  });
})();
