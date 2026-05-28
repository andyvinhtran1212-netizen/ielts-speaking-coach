/**
 * frontend/tests/sprint-20-4-exam-chrome-mockup.test.mjs
 *
 * Sprint 20.4 — exam-chrome mockup sentinel (cluster 20.x approval gate).
 * Static-analysis pins on the structural choices Andy is approving so the
 * shape can't drift before 20.6 wraps it in the production exam chrome.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


describe('Sprint 20.4 — exam mockup page (reading-exam-mockup.html)', () => {
  const html = read('frontend/pages/reading-exam-mockup.html');

  test('uses the dedicated exam-chrome shell, NOT the student aver-chrome', () => {
    assert.match(html, /class="exam-chrome"/);
    // The student web-component must NOT be on the exam page — exam is the
    // 3rd chrome, distinct from student/aver-admin (Pattern #11).
    assert.ok(!/<aver-chrome\b/.test(html),
      'exam mockup must not include <aver-chrome> (student chrome)');
    assert.ok(!/<aver-admin-chrome\b/.test(html),
      'exam mockup must not include <aver-admin-chrome>');
  });
  test('links the exam-chrome stylesheet + tokens', () => {
    assert.match(html, /href="\/css\/reading-exam-mockup\.css"/);
    assert.match(html, /href="\/css\/aver-design\/tokens\.css"/);
  });
  test('ships the canonical top bar — candidate, section, timer, settings', () => {
    assert.match(html, /class="exam-topbar__candidate"/);
    assert.match(html, /class="exam-topbar__section"/);
    assert.match(html, /id="exam-timer"[^>]*data-state="normal"/);
    assert.match(html, /id="exam-settings-toggle"/);
    assert.match(html, /id="exam-settings"[^>]*hidden/);   // popover closed by default
  });
  test('ships the split-view shell (passage + questions panels)', () => {
    assert.match(html, /class="exam-split"/);
    assert.match(html, /class="exam-passage"[^>]*id="exam-passage"/);
    assert.match(html, /class="exam-questions"[^>]*id="exam-questions"/);
  });
  test('mockup banner explicitly flags this is a prototype', () => {
    assert.match(html, /class="exam-mockup-banner"/);
    assert.match(html, /mockup/i);
  });
  test('ships ≥ 10 questions covering the Phase-1 type mix', () => {
    // 10 question cards = #q-1 .. #q-10 (matching the palette).
    for (let q = 1; q <= 10; q++) {
      assert.match(html, new RegExp(`id="q-${q}"\\s+data-q="${q}"`),
        `missing question card q-${q}`);
    }
    // Type coverage — at least one of each Phase-1 idiom we render.
    assert.match(html, /<select class="exam-q__select"/, 'matching_headings (dropdown) missing');
    assert.match(html, /type="radio"\s+name="q4"/,        'T/F/NG radio set missing');
    assert.match(html, /type="radio"\s+name="q7"/,        'MCQ radio set missing');
    assert.match(html, /class="exam-q__gap"/,             'sentence-completion gap input missing');
  });
  test('ships the bottom palette (1..10) with answered/current/flagged states', () => {
    assert.match(html, /class="exam-palette"/);
    for (let q = 1; q <= 10; q++) {
      assert.match(html, new RegExp(`exam-palette__q[^"]*"[^>]*data-q="${q}"`),
        `palette button for q${q} missing`);
    }
    assert.match(html, /is-current/);
    assert.match(html, /is-answered/);
    assert.match(html, /is-flagged/);
  });
});


describe('Sprint 20.4 — exam mockup interactions (reading-exam-mockup.js)', () => {
  const js = read('frontend/js/reading-exam-mockup.js');
  test('palette click → scrolls the question into view + sets is-current', () => {
    assert.match(js, /scrollIntoView/);
    assert.match(js, /\.is-current/);
  });
  test('flag toggle keeps palette is-flagged in sync', () => {
    assert.match(js, /aria-pressed/);
    // Sprint 20.4b — assert the real implementation (classList.toggle on the
    // palette button) rather than a comment-style "`.is-flagged`" reference.
    assert.match(js, /classList\.toggle\(\s*['"]is-flagged['"]/);
  });
  test('text-size buttons re-scale via data-text-size on the chrome root', () => {
    assert.match(js, /data-text-size/);
  });
  test('?demo=warning|critical lets reviewers preview timer states', () => {
    assert.match(js, /demoState/);
    assert.match(js, /warning/);
    assert.match(js, /critical/);
  });
  test('NO real countdown or grading wiring (those are 20.5/20.6)', () => {
    assert.ok(!/setInterval\s*\(/.test(js),
      'mockup must not run a real countdown — that is Sprint 20.6');
    assert.ok(!/window\.api\.(get|post|upload)/.test(js),
      'mockup must not call any backend endpoint — it is a static prototype');
  });
});


describe('Sprint 20.4 — exam chrome CSS (reading-exam-mockup.css)', () => {
  const css = read('frontend/css/reading-exam-mockup.css');
  test('uses neutral institutional surfaces, not the warm student palette', () => {
    // Override layer scoped to .exam-chrome — must define its own surface tokens.
    assert.match(css, /--exam-surface-page:\s*#F[0-9A-Fa-f]{2}/);
    assert.match(css, /--exam-border-default:/);
  });
  test('split-view: draggable divider with --exam-split-left default 50%, independent scroll', () => {
    // Sprint 20.4b — replaced fixed 55/45 with a CSS-var-driven split + 6px
    // divider column. Default 50% matches the real exam "two halves".
    assert.match(css, /--exam-split-left:\s*50%/);
    assert.match(css, /grid-template-columns:\s*var\(--exam-split-left[^)]*\)\s*6px\s*1fr/);
    assert.match(css, /\.exam-divider[\s\S]{0,80}cursor:\s*col-resize/);
    assert.match(css, /\.exam-passage[\s\S]{0,80}overflow-y:\s*auto/);
    assert.match(css, /\.exam-questions[\s\S]{0,80}overflow-y:\s*auto/);
  });
  test('timer uses the mono token + critical state has a pulse + reduced-motion guard', () => {
    assert.match(css, /\.exam-timer[\s\S]{0,200}var\(--exam-font-mono\)/);
    assert.match(css, /data-state="critical"/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });
  test('palette flag indicator is a corner triangle (faithful to BC/IDP marker)', () => {
    assert.match(css, /\.exam-palette__q\.is-flagged::after/);
    assert.match(css, /border-style:\s*solid/);
  });
});


describe('Sprint 20.4b — Andy fidelity feedback applied', () => {
  const html = read('frontend/pages/reading-exam-mockup.html');
  const js   = read('frontend/js/reading-exam-mockup.js');
  const css  = read('frontend/css/reading-exam-mockup.css');

  test('institutional font override (resolves 20.4 open-question Q1)', () => {
    // Real IELTS CD exam uses a system/Arial-family sans, NOT the brand font.
    // Override is scoped to .exam-chrome only — student + admin chromes untouched.
    assert.match(css, /--exam-font-sans:\s*system-ui[^;]*Arial/);
  });
  test('larger rubric text (Andy feedback #1)', () => {
    // Bumped from 13px (Sprint 20.4) to 15px so the instruction reads with
    // the same weight as the question prompt.
    assert.match(css, /\.exam-questions__instructions\s*\{[\s\S]{0,200}font-size:\s*15px/);
  });
  test('timer moved upper-MIDDLE with minutes-only display (Mình research)', () => {
    // The timer block lives in the centre column of the 3-col top bar,
    // wrapped in .exam-timer-wrap (label = "min remaining").
    assert.match(html, /<div class="exam-timer-wrap">/);
    assert.match(html, /class="exam-timer__label">min remaining/);
    // The current value is a bare integer (not mm:ss) — minutes-only per research.
    assert.match(html, /id="exam-timer"[^>]*>\s*59\s*<\/div>/);
  });
  test('draggable split divider element + JS handler (Andy feedback #2)', () => {
    assert.match(html, /id="exam-divider"[^>]*role="separator"[^>]*aria-orientation="vertical"/);
    // JS owns mousedown / touchstart drag + clamp + sessionStorage persistence.
    assert.match(js, /divider\.addEventListener\(\s*'mousedown'/);
    assert.match(js, /Math\.max\(30,\s*Math\.min\(70/);
    assert.match(js, /sessionStorage\.setItem\(\s*['"]exam-split-pct['"]/);
  });
  test('right-click context menu HTML + JS dispatch (Andy feedback #3)', () => {
    assert.match(html, /id="exam-context-menu"[^>]*role="menu"[^>]*hidden/);
    for (const a of ['highlight', 'note', 'remove']) {
      assert.match(html, new RegExp(`data-action="${a}"`), `context menu missing action=${a}`);
    }
    // JS captures right-click in BOTH panels (passage + questions) per research.
    assert.match(js, /#exam-passage[\s\S]{0,60}#exam-questions/);
    assert.match(js, /addEventListener\(\s*'contextmenu'/);
  });
  test('highlight implementation is XSS-safe (TreeWalker + textContent, no innerHTML)', () => {
    assert.match(js, /createTreeWalker/);
    assert.match(js, /span\.textContent\s*=/);
    // The applyHighlight body must not assign innerHTML to a created span.
    const fn = (js.split('function applyHighlight')[1] || '').split('function attachNoteMarker')[0];
    assert.ok(fn.length > 0, 'applyHighlight body not found');
    assert.ok(!/\.innerHTML\s*=/.test(fn),
      'applyHighlight must not assign innerHTML — XSS guard');
  });
  test('note popover HTML + Save/Cancel/Delete handlers', () => {
    assert.match(html, /id="exam-note-popover"[^>]*role="dialog"[^>]*hidden/);
    assert.match(html, /id="exam-note-textarea"/);
    for (const id of ['exam-note-save', 'exam-note-cancel', 'exam-note-delete']) {
      assert.match(html, new RegExp(`id="${id}"`), `note popover missing #${id}`);
      assert.match(js,   new RegExp(`#${id}`),     `note popover JS missing #${id}`);
    }
    // The note marker is a real element, not an inline emoji.
    assert.match(css, /\.exam-note-marker/);
  });
  test('palette prev/next nav arrows (real-exam bottom-right idiom)', () => {
    assert.match(html, /id="exam-prev"[^>]*aria-label="Previous question"/);
    assert.match(html, /id="exam-next"[^>]*aria-label="Next question"/);
    assert.match(js, /function navTo\(/);
  });
});


describe('Sprint 20.4 — approval-gate doc', () => {
  const doc = read('docs/clusters/20_x/exam_chrome_mockup.md');
  test('declares the no-screenshots fidelity caveat + the open questions + acceptance criteria', () => {
    assert.match(doc, /No screenshots were attached/);
    // Sprint 20.4b renamed the section to reflect resolution status; match
    // the broader "Open questions" header (still present in either form).
    assert.match(doc, /Open questions/);
    assert.match(doc, /Acceptance criteria/);
  });
  test('points reviewers at the ?demo= flag for timer states', () => {
    assert.match(doc, /\?demo=warning/);
    assert.match(doc, /\?demo=critical/);
  });
});
