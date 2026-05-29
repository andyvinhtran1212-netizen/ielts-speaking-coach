/**
 * frontend/tests/sprint-20-13b-standards-a11y.test.mjs
 *
 * Sprint 20.13b — Interactive HTML Standards v1.0 compliance, LAYER B
 * (accessibility / WCAG AA). Static-analysis only; the live keyboard /
 * AT verification lives in the Lesson-10 prod-dogfood checklist.
 *
 *   B1 — Shared openOverlay/closeOverlay helpers with focus trap,
 *        background inert + aria-hidden, return focus to opener, global
 *        Escape close on the topmost overlay (standards §4.3,
 *        anti-pattern §10.3).
 *   B2 — Skip link + persistent polite live region + timer role=timer
 *        aria-live=off (standards §4.1, §4.2, §4.7).
 *   B3 — `prefers-reduced-motion` covers every CSS animation/transition
 *        in the exam UI + JS path has a prefersReducedMotion() helper
 *        (standards §4.9, anti-pattern §10.3).
 *   B4 — Palette container has role="group"; tile aria-labels update
 *        per state via _updatePaletteAriaLabel (standards §4.6,
 *        anti-pattern §10.3 — "role=tablist for palette").
 *   B5 — Alt+H / Alt+N / Alt+C keyboard parity with right-click
 *        highlight/note/clear (standards §4.8).
 *
 *   + Touch-target audit fixes (the 20.13a colour swatches were 20×20
 *     below the WCAG AA 24px desktop floor; theme swatches 36×28 below
 *     the spacious-target threshold).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── B1 — Shared modal helpers with trap + inert + return focus ───────


describe('Sprint 20.13b B1 — shared openOverlay / closeOverlay helpers', () => {
  const js = read('frontend/js/reading-exam.js');

  test('openOverlay + closeOverlay are defined and visible to the module', () => {
    assert.match(js, /function\s+openOverlay\s*\(\s*overlay\s*,\s*opener\s*\)/);
    assert.match(js, /function\s+closeOverlay\s*\(\s*overlay\s*\)/);
  });

  test('openOverlay remembers the opener for return-focus', () => {
    // We persist the opener on the overlay instance so closeOverlay can
    // re-focus it. The exact attribute name is implementation detail; the
    // sentinel only pins that we DO remember an opener.
    assert.match(js, /overlay\._a11yOpener\s*=\s*opener/);
  });

  test('focus trap on Tab cycles within the overlay (forward and shift+Tab back)', () => {
    // The trap MUST handle both Tab boundaries — without the Shift+Tab
    // branch, a user can fall out of the modal backwards.
    assert.match(js, /_installTrap[\s\S]{0,400}ev\.shiftKey[\s\S]{0,300}last\.focus\(\)/);
    assert.match(js, /_installTrap[\s\S]{0,400}!ev\.shiftKey[\s\S]{0,300}first\.focus\(\)/);
  });

  test('background regions get inert + aria-hidden while a modal is open', () => {
    assert.match(js, /_setBackgroundInert[\s\S]{0,400}setAttribute\(\s*['"]inert['"]/);
    assert.match(js, /_setBackgroundInert[\s\S]{0,400}setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]/);
    // And the inverse — they're cleared on close.
    assert.match(js, /_setBackgroundInert[\s\S]{0,400}removeAttribute\(\s*['"]inert['"]/);
  });

  test('closeOverlay returns focus to the remembered opener', () => {
    assert.match(js, /function\s+closeOverlay[\s\S]{0,800}opener\.focus\(\)/);
  });

  test('global Escape handler closes the topmost overlay (anti-pattern §10.3 guard)', () => {
    // The anti-pattern is "Escape only hides class; doesn't release
    // trap+inert → keyboard-stuck". The single Escape handler that walks
    // _overlayStack via closeOverlay eliminates that class of bug. Accept
    // either `=== 'Escape'` or the negated early-exit `!== 'Escape'`.
    assert.match(
      js,
      /document\.addEventListener\(\s*['"]keydown['"][\s\S]{0,400}ev\.key\s*[!=]==\s*['"]Escape['"][\s\S]{0,400}closeOverlay\(_overlayStack\[_overlayStack\.length - 1\]\)/,
    );
  });

  test('all five true modals route through openOverlay + closeOverlay', () => {
    // The five modals: Hide, Help, Submit-confirm, Restart-confirm, Note.
    // Each opener call site must use openOverlay; each closer must use
    // closeOverlay. Settings popover is the exception (lighter, not aria-modal).
    for (const modal of [
      'exam-hide-overlay',
      'exam-help-modal',
      'exam-submit-modal',
      'exam-restart-modal',
      'exam-note-popover',
    ]) {
      assert.match(
        js,
        new RegExp(`openOverlay\\(.{0,80}${modal}|openOverlay\\([^)]*notePop`),
        `expected openOverlay route for #${modal}`,
      );
    }
    // And the five closers — same set.
    for (const modal of [
      'exam-hide-overlay',
      'exam-help-modal',
      'exam-submit-modal',
      'exam-restart-modal',
    ]) {
      assert.match(
        js,
        new RegExp(`closeOverlay\\(\\$\\(['"]${modal}['"]\\)\\)`),
        `expected closeOverlay route for #${modal}`,
      );
    }
    // Note popover closes via the renamed hideNotePopover → closeOverlay.
    assert.match(js, /hideNotePopover[\s\S]{0,200}closeOverlay\(notePop\)/);
  });
});


describe('Sprint 20.13b B1 — modal HTML carries the required ARIA', () => {
  const html = read('frontend/pages/reading-exam.html');

  test('every true modal has role="dialog" + aria-modal="true" + aria-labelledby', () => {
    const modals = [
      { id: 'exam-hide-overlay',   labelledBy: 'exam-hide-title' },
      { id: 'exam-help-modal',     labelledBy: 'help-modal-title' },
      { id: 'exam-submit-modal',   labelledBy: 'submit-modal-title' },
      { id: 'exam-restart-modal',  labelledBy: 'restart-modal-title' },
      { id: 'exam-note-popover',   labelledBy: 'exam-note-title' },
    ];
    for (const { id, labelledBy } of modals) {
      // Find the opening tag for the modal — accept attributes in any order.
      const re = new RegExp(`<[^>]*id="${id}"[^>]*>`);
      const m = html.match(re);
      assert.ok(m, `missing element with id="${id}"`);
      const tag = m[0];
      assert.match(tag, /role="dialog"/, `#${id} missing role="dialog"`);
      assert.match(tag, /aria-modal="true"/, `#${id} missing aria-modal="true"`);
      assert.match(
        tag,
        new RegExp(`aria-labelledby="${labelledBy}"`),
        `#${id} missing aria-labelledby="${labelledBy}"`,
      );
      // And the labelled heading exists.
      assert.match(html, new RegExp(`id="${labelledBy}"`));
    }
  });
});


// ── B2 — Skip link + live region + timer role=timer ──────────────────


describe('Sprint 20.13b B2 — skip link + persistent live region', () => {
  const html = read('frontend/pages/reading-exam.html');
  const css  = read('frontend/css/reading-exam.css');
  const js   = read('frontend/js/reading-exam.js');

  test('skip link is the first focusable element and uses class="vh"', () => {
    // Anti-pattern §10.3: "Skip link ẩn vĩnh viễn". The .vh class hides
    // it visually but it stays in the focus order, and .vh:focus
    // un-hides it on tab.
    assert.match(html, /<a class="vh"[^>]+href="#exam-questions"[^>]+id="exam-skip-link"/);
  });

  test('CSS defines .vh + .vh:focus reveal', () => {
    assert.match(css, /\.vh\s*\{[\s\S]{0,400}clip:\s*rect\(0\s*0\s*0\s*0\)/);
    assert.match(css, /\.vh:focus\s*\{[\s\S]{0,400}clip:\s*auto/);
  });

  test('persistent live region exists with aria-live="polite" + aria-atomic="true"', () => {
    assert.match(
      html,
      /<div\s+id="exam-live-region"[^>]*class="vh"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
    );
  });

  test('timer has role="timer" + aria-live="off" (standards §4.7)', () => {
    // Don't read every second — the timer's role makes screen readers
    // aware of it without spamming announcements; the live region above
    // delivers the 10/5/0 warnings instead.
    assert.match(
      html,
      /id="exam-timer"[\s\S]{0,200}role="timer"[\s\S]{0,200}aria-live="off"/,
    );
  });

  test('liveSay helper is defined and re-populates with setTimeout', () => {
    // Empty-then-fill makes AT re-announce repeated strings (e.g. another
    // "10 minutes remaining" if the timer re-warns).
    assert.match(
      js,
      /function\s+liveSay[\s\S]{0,300}textContent\s*=\s*['"]['"][\s\S]{0,200}setTimeout/,
    );
  });

  test('timer 10/5/0 thresholds + submit success route through liveSay', () => {
    assert.match(js, /liveSay\(['"]Warning: 10 minutes/);
    assert.match(js, /liveSay\(['"]Warning: 5 minutes/);
    assert.match(js, /liveSay\(['"]Time is up\./);
    assert.match(js, /liveSay\(['"]Test submitted/);
  });
});


// ── B3 — prefers-reduced-motion ──────────────────────────────────────


describe('Sprint 20.13b B3 — prefers-reduced-motion respected everywhere', () => {
  const mockup = read('frontend/css/reading-exam-mockup.css');
  const css = read('frontend/css/reading-exam.css');
  const js  = read('frontend/js/reading-exam.js');

  test('mockup CSS @media disables the timer-critical pulse (regression — present since 20.4c)', () => {
    assert.match(
      mockup,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,300}timer\[data-state="critical"\][\s\S]{0,80}animation:\s*none/,
    );
  });

  test('production CSS @media disables the divider transition + time-toast animation', () => {
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(
      css,
      /@media\s*\(prefers-reduced-motion[\s\S]{0,400}\.exam-divider\s*\{[\s\S]{0,80}transition:\s*none/,
    );
  });

  test('JS has a prefersReducedMotion() helper using matchMedia', () => {
    assert.match(
      js,
      /function\s+prefersReducedMotion\s*\(\)[\s\S]{0,300}matchMedia\(['"]\(prefers-reduced-motion:\s*reduce\)/,
    );
  });
});


// ── B4 — Palette role + dynamic aria-labels ──────────────────────────


describe('Sprint 20.13b B4 — palette role="group" + dynamic aria-labels', () => {
  const html = read('frontend/pages/reading-exam.html');
  const js   = read('frontend/js/reading-exam.js');

  test('palette grid has role="group" (NOT role="tablist", anti-pattern §10.3)', () => {
    assert.match(html, /id="exam-palette-grid"[^>]*role="group"/);
    // And there's no rogue role="tablist" lurking on the palette tree.
    assert.ok(
      !/exam-palette[^>]*role="tablist"/.test(html),
      'palette must not use role="tablist"',
    );
  });

  test('palette buttons use a single _updatePaletteAriaLabel helper', () => {
    assert.match(js, /function\s+_updatePaletteAriaLabel\s*\(/);
    // The helper composes a comma-separated label from state classes.
    assert.match(js, /_updatePaletteAriaLabel[\s\S]{0,600}is-answered[\s\S]{0,200}is-flagged[\s\S]{0,200}is-current/);
  });

  test('every palette state mutation calls _updatePaletteAriaLabel', () => {
    // setCurrent, markAnswered, toggleFlag, _makePaletteBtn all need to
    // sync the aria-label or screen readers fall behind state.
    for (const fn of ['setCurrent', 'markAnswered', 'toggleFlag', '_makePaletteBtn']) {
      assert.match(
        js,
        new RegExp(`function\\s+${fn}[\\s\\S]{0,800}_updatePaletteAriaLabel`),
        `${fn} must call _updatePaletteAriaLabel`,
      );
    }
  });
});


// ── B5 — Alt+H / Alt+N / Alt+C keyboard shortcuts ────────────────────


describe('Sprint 20.13b B5 — keyboard parity for highlight + note + clear', () => {
  const js = read('frontend/js/reading-exam.js');

  test('the keydown handler watches Alt without Ctrl/Meta', () => {
    assert.match(js, /if\s*\(\s*!ev\.altKey\s*\|\|\s*ev\.ctrlKey\s*\|\|\s*ev\.metaKey\s*\)\s*return/);
  });

  test('Alt+H applies the default-yellow highlight to the current selection', () => {
    assert.match(
      js,
      /key\s*===\s*['"]h['"]\s*\)[\s\S]{0,400}applyHighlight\(range,\s*\{\s*color:\s*['"]c-yellow['"]\s*\}\)/,
    );
  });

  test('Alt+N highlights then opens the note editor', () => {
    assert.match(
      js,
      /key\s*===\s*['"]n['"]\s*\)[\s\S]{0,500}applyHighlight[\s\S]{0,200}openNoteEditor/,
    );
  });

  test('Alt+C clears the highlight at focus / selection', () => {
    assert.match(
      js,
      /key\s*===\s*['"]c['"]\s*\)[\s\S]{0,400}removeHighlight\(hl\)/,
    );
  });

  test('selection check refuses silently when nothing is selected in a panel', () => {
    // _selectionInsidePanels returns null when there's no live selection
    // in the passage / questions surfaces — the handler then exits without
    // preventDefault so Alt+H/N don't hijack the browser.
    assert.match(
      js,
      /function\s+_selectionInsidePanels[\s\S]{0,400}isCollapsed[\s\S]{0,200}return null/,
    );
  });
});


// ── Touch-target audit fixes ──────────────────────────────────────────


describe('Sprint 20.13b — touch-target audit trivial fixes', () => {
  const css = read('frontend/css/reading-exam.css');

  test('A5 colour swatch is at least 24x24 (was 20x20, below WCAG AA)', () => {
    const m = css.match(/\.exam-context-menu__color\s*\{([\s\S]*?)\}/);
    assert.ok(m, 'missing .exam-context-menu__color rule');
    assert.match(m[1], /width:\s*24px/);
    assert.match(m[1], /height:\s*24px/);
  });

  test('A3 theme swatch height bumped to 32px (was 28px)', () => {
    const m = css.match(/(?:^|\n)\.exam-theme-swatch\s*\{([\s\S]*?)\}/);
    assert.ok(m, 'missing standalone .exam-theme-swatch rule');
    assert.match(m[1], /height:\s*32px/);
  });
});
