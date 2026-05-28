/* frontend/js/reading-exam-mockup.js — Sprint 20.4 + 20.4b EXAM CHROME MOCKUP.
 *
 * Static-prototype interactions only. NO grading, NO real timer, NO
 * persistence to a backend — those land in Sprint 20.5 (L3 backend, clones
 * the listening grader) + Sprint 20.6 (production exam UI wired to real data).
 *
 * Sprint 20.4 baseline:
 *   • Palette click → scroll-to-Q + .is-current
 *   • Flag-for-review toggle (card + palette in sync)
 *   • Settings popover (text-size A/A/A)
 *   • Auto .is-answered on input/change
 *   • ?demo=warning|critical pre-set timer state
 *
 * Sprint 20.4b additions (Andy fidelity feedback + Mình research):
 *   • Draggable split divider (col-resize, clamped 30–70%, sessionStorage)
 *   • Right-click context menu on passage + questions (Highlight / Note / Remove)
 *   • Highlight implementation — TreeWalker text-node walking (XSS-safe,
 *     multi-paragraph capable). Click an existing highlight to open the
 *     context menu's Remove action.
 *   • Note popover — inline textarea, Save/Cancel/Delete, persists in-session
 *     via the highlight span's data-note attribute (mockup-level).
 *   • Prev/Next palette nav arrows (real-exam bottom-right idiom).
 *
 * Out of scope here: real countdown, auto-submit, section transitions
 * (Sprint 20.6).
 */
(function () {
  'use strict';

  var chrome = document.querySelector('.exam-chrome');
  if (!chrome) return;

  var $  = function (sel) { return chrome.querySelector(sel) || document.querySelector(sel); };
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

  // ── Sprint 20.4b — Prev / Next nav arrows ─────────────────────────
  function navTo(delta) {
    var palette = $$('.exam-palette__q');
    if (!palette.length) return;
    var idx = palette.findIndex(function (b) { return b.classList.contains('is-current'); });
    if (idx < 0) idx = 0;
    var next = Math.max(0, Math.min(palette.length - 1, idx + delta));
    palette[next].click();
  }
  var prevBtn = $('#exam-prev'); if (prevBtn) prevBtn.addEventListener('click', function () { navTo(-1); });
  var nextBtn = $('#exam-next'); if (nextBtn) nextBtn.addEventListener('click', function () { navTo(1); });

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
    document.addEventListener('click', function (ev) {
      if (popover.hidden) return;
      if (toggle.contains(ev.target) || popover.contains(ev.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !popover.hidden) setOpen(false);
    });
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

  // ── Sprint 20.4b — Draggable split divider (clamped 30–70%) ────────
  var split = $('.exam-split');
  var divider = $('#exam-divider');
  if (split && divider) {
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

    // Keyboard a11y — left/right arrows nudge the split when divider is focused.
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
  }

  // ── Sprint 20.4b — Highlight + Note (right-click context menu) ─────
  // Real-exam idiom: select text → right-click → menu (Highlight / Note).
  // Works on BOTH passage and question panels (Mình's research). The
  // highlight implementation walks text nodes inside the selection range
  // and wraps each segment in <span class="exam-highlight is-user"> —
  // XSS-safe (DOM API + textContent, never innerHTML).
  var ctxMenu = $('#exam-context-menu');
  var notePop = $('#exam-note-popover');
  var noteTA = $('#exam-note-textarea');
  var savedRange = null;        // selection range captured at right-click
  var ctxTargetSpan = null;     // existing highlight when right-clicked on one
  var notePopTargetSpan = null; // highlight span the note popover is editing

  function positionPopover(el, x, y) {
    var maxLeft = window.innerWidth - el.offsetWidth - 8;
    var maxTop  = window.innerHeight - el.offsetHeight - 8;
    el.style.left = Math.max(8, Math.min(x, maxLeft)) + 'px';
    el.style.top  = Math.max(8, Math.min(y, maxTop))  + 'px';
  }

  function hideContextMenu() { if (ctxMenu) ctxMenu.hidden = true; }
  function hideNotePopover() { if (notePop) notePop.hidden = true; notePopTargetSpan = null; }

  function showContextMenu(x, y) {
    if (!ctxMenu) return;
    var sel = window.getSelection();
    var hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    savedRange = hasSelection ? sel.getRangeAt(0).cloneRange() : null;
    var onHl = ctxTargetSpan;

    ctxMenu.querySelector('[data-action="highlight"]').hidden = !hasSelection;
    ctxMenu.querySelector('[data-action="note"]').hidden      = !hasSelection;
    ctxMenu.querySelector('[data-action="remove"]').hidden    = !onHl;
    if (!hasSelection && !onHl) return;

    ctxMenu.hidden = false;
    positionPopover(ctxMenu, x, y);
  }

  // Right-click capture inside the passage / questions panels — real-exam
  // surface area for the highlight workflow.
  ['#exam-passage', '#exam-questions'].forEach(function (sel) {
    var panel = $(sel); if (!panel) return;
    panel.addEventListener('contextmenu', function (ev) {
      ctxTargetSpan = ev.target.closest && ev.target.closest('.exam-highlight.is-user');
      ev.preventDefault();
      showContextMenu(ev.pageX, ev.pageY);
    });
  });

  // Click outside / Esc dismiss (matches the lightbox + glossary idiom).
  document.addEventListener('mousedown', function (ev) {
    if (ctxMenu && !ctxMenu.hidden && !ctxMenu.contains(ev.target))   hideContextMenu();
    if (notePop && !notePop.hidden && !notePop.contains(ev.target)
        && !(ev.target.classList && ev.target.classList.contains('exam-note-marker'))) {
      hideNotePopover();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { hideContextMenu(); hideNotePopover(); }
  });

  // ── Highlight algorithm: walk text nodes inside the range, wrap each ──
  function applyHighlight(range, options) {
    options = options || {};
    var startNode = range.startContainer;
    var endNode   = range.endContainer;
    var root      = range.commonAncestorContainer;

    // Collect text nodes in document order between start and end (inclusive).
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

    var created = [];
    textNodes.forEach(function (textNode) {
      var startOff = (textNode === startNode) ? range.startOffset : 0;
      var endOff   = (textNode === endNode)   ? range.endOffset   : textNode.nodeValue.length;
      if (startOff >= endOff) return;
      var before = textNode.nodeValue.slice(0, startOff);
      var middle = textNode.nodeValue.slice(startOff, endOff);
      var after  = textNode.nodeValue.slice(endOff);
      if (!middle.replace(/\s/g, '').length) return; // skip pure-whitespace fragments

      var span = document.createElement('span');
      span.className = 'exam-highlight is-user';
      span.textContent = middle;                  // XSS-safe: never innerHTML

      var parent = textNode.parentNode;
      var next   = textNode.nextSibling;
      parent.removeChild(textNode);
      if (before) parent.insertBefore(document.createTextNode(before), next);
      parent.insertBefore(span, next);
      if (after)  parent.insertBefore(document.createTextNode(after), next);
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
    marker.setAttribute('role', 'button');
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('aria-label', 'View note');
    marker.textContent = 'note';
    marker._highlightSpans = spans;
    spans[spans.length - 1].after(marker);
    spans.forEach(function (s) { s._noteMarker = marker; });
    return marker;
  }

  function removeHighlight(span) {
    if (!span) return;
    // If there's a note marker tied to this highlight, remove it too.
    if (span._noteMarker && span._noteMarker.parentNode) {
      span._noteMarker.parentNode.removeChild(span._noteMarker);
    }
    var parent = span.parentNode; if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }

  // Context-menu action dispatch.
  if (ctxMenu) {
    ctxMenu.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.exam-context-menu__item');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'highlight' && savedRange) {
        applyHighlight(savedRange);
      } else if (action === 'note' && savedRange) {
        var spans = applyHighlight(savedRange);
        if (spans.length) {
          // Open note popover near the last span to type a note.
          var last = spans[spans.length - 1];
          var rect = last.getBoundingClientRect();
          openNoteEditor(last, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
        }
      } else if (action === 'remove' && ctxTargetSpan) {
        removeHighlight(ctxTargetSpan);
      }
      ctxTargetSpan = null;
      savedRange = null;
      hideContextMenu();
    });
  }

  // ── Note popover: textarea + Save / Cancel / Delete ─────────────────
  function openNoteEditor(span, x, y) {
    if (!notePop || !noteTA) return;
    notePopTargetSpan = span;
    noteTA.value = span.getAttribute('data-note') || '';
    notePop.hidden = false;
    positionPopover(notePop, x, y);
    noteTA.focus();
  }

  // Click an existing note marker → open the editor for its highlight.
  document.addEventListener('click', function (ev) {
    var marker = ev.target.closest && ev.target.closest('.exam-note-marker');
    if (!marker || !marker._highlightSpans || !marker._highlightSpans.length) return;
    var span = marker._highlightSpans[marker._highlightSpans.length - 1];
    var rect = marker.getBoundingClientRect();
    openNoteEditor(span, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
  });

  var noteSave   = $('#exam-note-save');
  var noteCancel = $('#exam-note-cancel');
  var noteDelete = $('#exam-note-delete');
  if (noteSave) noteSave.addEventListener('click', function () {
    if (!notePopTargetSpan) return hideNotePopover();
    var text = noteTA.value || '';
    // Update all sibling highlight spans sharing this marker.
    var marker = notePopTargetSpan._noteMarker;
    var spans = (marker && marker._highlightSpans) || [notePopTargetSpan];
    spans.forEach(function (s) { s.setAttribute('data-note', text); });
    if (!marker && text) attachNoteMarker(spans, text);
    hideNotePopover();
  });
  if (noteCancel) noteCancel.addEventListener('click', hideNotePopover);
  if (noteDelete) noteDelete.addEventListener('click', function () {
    if (!notePopTargetSpan) return hideNotePopover();
    var marker = notePopTargetSpan._noteMarker;
    var spans = (marker && marker._highlightSpans) || [notePopTargetSpan];
    spans.forEach(function (s) { s.removeAttribute('data-note'); s._noteMarker = null; });
    if (marker && marker.parentNode) marker.parentNode.removeChild(marker);
    hideNotePopover();
  });

  // ── Reviewer affordance: ?demo=warning|critical pre-sets timer state ─
  // Sprint 20.4b — minutes-only display (real exam hides seconds). The
  // critical pulse is the same CSS animation; the value changes only.
  var demoState = new URLSearchParams(window.location.search).get('demo');
  if (demoState === 'warning' || demoState === 'critical') {
    var timer = $('#exam-timer');
    if (timer) {
      timer.setAttribute('data-state', demoState);
      timer.textContent = demoState === 'critical' ? '4' : '9';
    }
  }
})();
