/**
 * frontend/tests/sprint-20-13a-standards-fidelity.test.mjs
 *
 * Sprint 20.13a — Interactive HTML Standards v1.0 compliance, LAYER A
 * (visible fidelity). Pins the five must-haves the standards doc + gold
 * reference (docs/clusters/20_x/standards/) classify as anti-patterns
 * §10.1 fidelity:
 *
 *   A1 — Palette tile becomes a CIRCLE on review-flag (not a corner
 *        triangle/icon); standards §2.7.
 *   A2 — TFNG / YNG render as a <select> dropdown (not radios);
 *        standards §2.3a.
 *   A3 — Four colour themes (default / cream / dark / yellow-on-blue)
 *        wired via body[data-exam-theme]; standards §2.10 + §3.
 *   A4 — Text-size choice persists in localStorage across reload/resume;
 *        standards §2.10.
 *   A5 — Multi-colour highlight (yellow / green / pink) via context-menu
 *        swatches; standards §2.11 + §3 tokens.
 *
 * Layers B (a11y) and C (behaviour) are deferred to Sprint 20.13b/c —
 * separate PRs per governance §6 ("each gate is its own merge so the
 * change is auditable").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── A1 — Palette tile: square → circle on review flag ────────────────


describe('Sprint 20.13a A1 — palette flag = circle (not corner triangle)', () => {
  const css = read('frontend/css/reading-exam.css');

  test('is-flagged tile gets border-radius: 50%', () => {
    // Match the standalone `.exam-palette__q.is-flagged { … }` rule.
    const m = css.match(/(?:^|\n)\.exam-palette__q\.is-flagged\s*\{([\s\S]*?)\}/);
    assert.ok(m, 'missing standalone .exam-palette__q.is-flagged rule');
    assert.match(m[1], /border-radius:\s*50%/);
  });

  test('the 20.4c corner-triangle ::after is explicitly cleared', () => {
    // Standards §10.1 calls out "icon cờ/đổi màu" as an anti-pattern; the
    // 20.13a fix must positively remove the pre-existing pseudo-element.
    assert.match(
      css,
      /\.exam-palette__q\.is-flagged::after\s*\{[\s\S]{0,80}content:\s*none/,
    );
  });
});


// ── A2 — TFNG / YNG dropdown (not radios) ─────────────────────────────


describe('Sprint 20.13a A2 — TFNG / YNG render as <select>', () => {
  const js = read('frontend/js/reading-exam.js');

  test('the TFNG branch creates a <select>, not a radio group', () => {
    // Locate the TFNG branch.
    const m = js.match(
      /type\s*===\s*'true_false_not_given'[\s\S]{0,1000}\}\s*else if/,
    );
    assert.ok(m, 'TFNG/YNG render branch not found');
    const body = m[0];
    assert.match(body, /createElement\(['"]select['"]\)/,
      'TFNG branch must createElement(\'select\')');
    // And must NOT use the radio-option helper anymore.
    assert.ok(!/radioOption\(name/.test(body),
      'TFNG branch must not call radioOption() — that was the 20.6 radio path');
  });

  test('the dropdown carries the canonical TRUE / FALSE / NOT GIVEN values', () => {
    // Pins the value semantics — these strings flow through to the grader.
    assert.match(js, /\[\s*['"]TRUE['"]\s*,\s*['"]FALSE['"]\s*,\s*['"]NOT GIVEN['"]\s*\]/);
    assert.match(js, /\[\s*['"]YES['"]\s*,\s*['"]NO['"]\s*,\s*['"]NOT GIVEN['"]\s*\]/);
  });

  test('matching_headings select pattern stays unchanged (regression)', () => {
    // 20.13a only swaps TFNG/YNG; matching_headings was already a select
    // since 20.6. The branch must still exist.
    assert.match(js, /type\s*===\s*['"]matching_headings['"]/);
  });
});


// ── A3 — Four colour themes via body[data-exam-theme] ────────────────


describe('Sprint 20.13a A3 — four colour themes', () => {
  const html = read('frontend/pages/reading-exam.html');
  const css  = read('frontend/css/reading-exam.css');
  const js   = read('frontend/js/reading-exam.js');

  test('body has data-exam-theme attribute (default)', () => {
    assert.match(html, /<body[^>]*data-exam-theme="default"/);
  });

  test('all four theme buttons exist in the Settings popover', () => {
    for (const theme of ['default', 'cream', 'dark', 'yellow-on-blue']) {
      assert.match(
        html,
        new RegExp(`data-theme="${theme}"`),
        `missing theme swatch button for '${theme}'`,
      );
    }
    // The standalone "Theme" group label must be present (replaces the
    // 20.4c "Contrast Phase B" placeholder).
    assert.match(html, /class="exam-settings__title">Theme<\/div>/);
    // And the disabled placeholder buttons must be gone. (My own commit
    // comment can still mention "Phase B" — what we're checking is that
    // no surviving `<button … disabled title="Phase B">` lingers.)
    assert.ok(
      !/<button[^>]*disabled[^>]*title="Phase B"/.test(html),
      'disabled "Phase B" placeholder buttons must be removed',
    );
  });

  test('CSS declares theme overrides for cream / dark / yellow-on-blue', () => {
    for (const theme of ['cream', 'dark', 'yellow-on-blue']) {
      assert.match(
        css,
        new RegExp(`body\\.exam-chrome\\[data-exam-theme="${theme}"\\]\\s*\\{`),
        `missing CSS theme rule for '${theme}'`,
      );
    }
  });

  test('highlights force #1a1a1a text on dark + yellow-on-blue themes', () => {
    // Standards §3: "Highlight luôn ép color:#1a1a1a để đọc được trên
    // theme tối." This is the legibility-on-dark guard.
    assert.match(
      css,
      /data-exam-theme="dark"\][\s\S]{0,80}\.exam-highlight[\s\S]{0,200}color:\s*#1a1a1a/,
    );
  });

  test('JS persists theme to localStorage and restores on boot', () => {
    assert.match(js, /['"]ielts-exam-theme['"]/);
    // Persistence path:
    assert.match(js, /_safeSetStorage\(EXAM_PREFS_KEY_THEME/);
    // Restore path on early boot:
    assert.match(
      js,
      /applyStoredDisplayPrefs[\s\S]{0,400}data-exam-theme/,
    );
  });

  test('JS validates theme value before applying (no arbitrary attribute injection)', () => {
    assert.match(js, /VALID_THEMES\s*=\s*\[\s*['"]default['"]\s*,\s*['"]cream['"]/);
  });
});


// ── A4 — Text-size persistence ───────────────────────────────────────


describe('Sprint 20.13a A4 — text-size persisted across reload', () => {
  const js = read('frontend/js/reading-exam.js');

  test('size change writes to localStorage on click', () => {
    assert.match(js, /['"]ielts-exam-text-size['"]/);
    assert.match(
      js,
      /\[data-size\][\s\S]{0,400}_safeSetStorage\(EXAM_PREFS_KEY_SIZE/,
    );
  });

  test('boot restores stored size before the user opens Settings', () => {
    assert.match(
      js,
      /applyStoredDisplayPrefs[\s\S]{0,400}data-text-size/,
    );
  });

  test('storage access is wrapped in try/catch (private-browsing safe)', () => {
    // Standards §5.1: "localStorage bọc trong try/catch (chế độ riêng tư
    // không vỡ)."
    assert.match(js, /function\s+_safeGetStorage[\s\S]{0,200}try\s*\{[\s\S]{0,100}return null/);
    assert.match(js, /function\s+_safeSetStorage[\s\S]{0,200}try\s*\{[\s\S]{0,100}catch/);
  });
});


// ── A5 — Multi-colour highlight via context-menu swatches ────────────


describe('Sprint 20.13a A5 — multi-colour highlight', () => {
  const html = read('frontend/pages/reading-exam.html');
  const css  = read('frontend/css/reading-exam.css');
  const js   = read('frontend/js/reading-exam.js');

  test('context menu has three colour swatches', () => {
    for (const color of ['c-yellow', 'c-green', 'c-pink']) {
      assert.match(html, new RegExp(`data-color="${color}"`));
    }
    // The swatches sit inside an explicit group container so the
    // showContextMenu() helper can hide them when no selection is live.
    assert.match(html, /class="exam-context-menu__colors"/);
  });

  test('CSS ships the three highlight colour classes + swatch styles', () => {
    for (const color of ['c-yellow', 'c-green', 'c-pink']) {
      assert.match(
        css,
        new RegExp(`\\.exam-highlight\\.is-user\\.${color}\\s*\\{`),
      );
      assert.match(
        css,
        new RegExp(`\\.exam-context-menu__color\\.is-(?:yellow|green|pink)\\s*\\{`),
      );
    }
  });

  test('applyHighlight accepts an options.color and validates it', () => {
    assert.match(js, /function\s+applyHighlight\s*\(\s*range\s*,\s*options\s*\)/);
    assert.match(js, /VALID_HL_COLORS\s*=\s*\{[\s\S]{0,80}c-yellow[\s\S]{0,80}c-green[\s\S]{0,80}c-pink/);
    // The created span MUST get the color class. (Matches a single string
    // literal ending with a space then `+ colorClass` — my actual
    // implementation: `'exam-highlight is-user ' + colorClass`.)
    assert.match(js, /span\.className\s*=\s*['"]exam-highlight is-user\s+['"]\s*\+\s*colorClass/);
  });

  test('context-menu swatch click applies the chosen colour', () => {
    // The handler must take the swatch path BEFORE the action-button path
    // so a swatch click doesn't fall through to the default yellow.
    assert.match(
      js,
      /var\s+swatch\s*=\s*ev\.target\.closest\(['"]\.exam-context-menu__color['"]\)[\s\S]{0,300}applyHighlight\(savedRange,\s*\{\s*color:\s*swatch\.dataset\.color\s*\}\)/,
    );
  });

  test('showContextMenu hides the colour row when there is no selection', () => {
    // Otherwise the swatches show on a "right-click an existing highlight
    // to remove" flow and look broken.
    assert.match(
      js,
      /colorRow\s*=\s*ctxMenu\.querySelector\(['"]\.exam-context-menu__colors['"]\)[\s\S]{0,200}colorRow\.hidden\s*=\s*!hasSelection/,
    );
  });
});


// ── Reference pin — the standards docs sit alongside the code ────────


describe('Sprint 20.13a — standards docs are versioned alongside code', () => {
  test('Interactive_HTML_Standards.md is in the cluster docs', () => {
    const sniff = read('docs/clusters/20_x/standards/Interactive_HTML_Standards.md');
    assert.match(sniff, /Interactive HTML Standards/);
    assert.match(sniff, /v1\.\d+/);
  });
  test('Gold reference (IELTS_Reading_Test_01_Interactive.html) is in the cluster docs', () => {
    const sniff = read('docs/clusters/20_x/standards/IELTS_Reading_Test_01_Interactive.html');
    // Two structural pins: the palette circle rule + the TFNG select code path.
    assert.match(sniff, /\.palette-btn\.review\s*\{[\s\S]{0,80}border-radius:\s*50%/);
    assert.match(sniff, /True\/False\/Not Given/);
  });
});
