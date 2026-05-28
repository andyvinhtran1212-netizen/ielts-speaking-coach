/* frontend/js/reading-exam-mockup.js — Sprint 20.4 EXAM CHROME MOCKUP.
 *
 * Static-prototype interactions only. NO grading, NO real timer, NO
 * persistence — those land in Sprint 20.5 (L3 backend, clones the
 * listening grader) + Sprint 20.6 (production exam UI wired to real data).
 *
 * What this file does (mockup-level only):
 *   • Question palette click → scrolls the matching question into view
 *     and updates the `.is-current` highlight (both on the palette button
 *     and the question card).
 *   • Flag-for-review toggle (on each question card) → flips aria-pressed
 *     and syncs the palette button's `.is-flagged` corner indicator.
 *   • Settings popover open/close (text-size A/A/A picker).
 *   • Text-size buttons → set `data-text-size` on the exam chrome root so
 *     CSS can re-scale the type base (institutional UX cue from BC/IDP).
 *   • Auto-answered state: when a student selects/types an answer, mark
 *     the corresponding palette button `.is-answered`.
 *
 * Out of scope here: real countdown, auto-submit, highlight tool
 * (Phase B per Discovery §5), contrast toggle (Phase B placeholder in the
 * settings popover), section transitions.
 */
(function () {
  'use strict';

  var chrome = document.querySelector('.exam-chrome');
  if (!chrome) return;

  var $  = function (sel) { return chrome.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(chrome.querySelectorAll(sel)); };

  // ── Question palette: click → scroll-to-Q + highlight ──────────────
  function setCurrent(qNum) {
    $$('.exam-palette__q').forEach(function (b) {
      b.classList.toggle('is-current', b.dataset.q === String(qNum));
    });
    $$('.exam-q').forEach(function (card) {
      card.classList.toggle('is-current', card.dataset.q === String(qNum));
    });
  }
  $$('.exam-palette__q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var qNum = btn.dataset.q;
      var card = chrome.querySelector('#q-' + qNum);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrent(qNum);
    });
  });

  // ── Flag-for-review: toggle on question card + palette button ──────
  function syncFlag(qNum, pressed) {
    var paletteBtn = chrome.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (paletteBtn) paletteBtn.classList.toggle('is-flagged', !!pressed);
  }
  $$('.exam-q__flag').forEach(function (flag) {
    flag.addEventListener('click', function () {
      var pressed = flag.getAttribute('aria-pressed') !== 'true';
      flag.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      var card = flag.closest('.exam-q');
      if (card) syncFlag(card.dataset.q, pressed);
    });
  });

  // ── Auto-answered state: any input change marks the palette button ──
  function markAnswered(qNum) {
    var paletteBtn = chrome.querySelector('.exam-palette__q[data-q="' + qNum + '"]');
    if (paletteBtn) paletteBtn.classList.add('is-answered');
  }
  $$('.exam-q').forEach(function (card) {
    card.addEventListener('change', function () { markAnswered(card.dataset.q); });
    card.addEventListener('input',  function () { markAnswered(card.dataset.q); });
  });

  // ── Settings popover (text size + Phase-B contrast placeholder) ────
  var toggle  = $('#exam-settings-toggle');
  var popover = $('#exam-settings');
  if (toggle && popover) {
    var setOpen = function (open) {
      popover.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', function () { setOpen(popover.hidden); });
    // Close on outside click + Esc — mirrors the lightbox/glossary idiom.
    document.addEventListener('click', function (ev) {
      if (popover.hidden) return;
      if (toggle.contains(ev.target) || popover.contains(ev.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !popover.hidden) setOpen(false);
    });

    // Text-size buttons (S / M / L) → data-text-size on the chrome root.
    popover.querySelectorAll('[data-size]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var size = btn.dataset.size;
        popover.querySelectorAll('[data-size]').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        chrome.setAttribute('data-text-size', size);
      });
    });
  }

  // ── Reviewer affordance: ?demo=warning|critical pre-sets timer state ─
  // Lets Andy preview the warning/critical timer presentations without
  // waiting on a real countdown (this whole interaction is mockup-only).
  var demoState = new URLSearchParams(window.location.search).get('demo');
  if (demoState === 'warning' || demoState === 'critical') {
    var timer = $('#exam-timer');
    if (timer) {
      timer.setAttribute('data-state', demoState);
      timer.textContent = demoState === 'critical' ? '04:59' : '09:59';
    }
  }
})();
