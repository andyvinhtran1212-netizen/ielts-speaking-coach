/**
 * frontend/tests/theme-toggle-icon-canonical.test.mjs — Sprint 6.10.1.
 *
 * Run with: node --test frontend/tests/theme-toggle-icon-canonical.test.mjs
 *
 * Pins the canonical theme-toggle icon class names across all 8
 * redesigned pages. Sprint 6.10 (PR #138) surfaced cumulative drift:
 * 6 of the 7 prior redesigned pages (speaking, practice, result,
 * writing-dashboard, writing-result, full-test-result) used BEM-style
 * classes (`av-theme-toggle__icon--sun` / `--moon`) that components.css
 * does NOT style. The button rendered both icons stacked because neither
 * BEM class triggered the visibility swap.
 *
 * Canonical pattern (home.html + vocabulary.html since day 1):
 *   <svg class="icon-sun"  …>…</svg>
 *   <svg class="icon-moon" …>…</svg>
 *
 * components.css owns the swap (lines 78–82):
 *   .av-theme-toggle .icon-sun  { display: none; }
 *   .av-theme-toggle .icon-moon { display: block; }
 *   [data-theme="dark"] .av-theme-toggle .icon-sun  { display: block; }
 *   [data-theme="dark"] .av-theme-toggle .icon-moon { display: none; }
 *
 * theme-toggle.js itself never references the icon classes — it only
 * flips [data-theme] on <html>, and the CSS attribute selector does the
 * rest. So the pin set is HTML markup discipline + components.css rule
 * integrity.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// Sprint 7.13 milestone: ALL 18 chrome pages migrated to <aver-chrome>
// (5 in Sprint 7.12 + 13 in Sprint 7.13). Sprint 12.1 extends the
// migration to the admin surface. Sprint 12.8 cluster closure flips the
// legacy monolith `admin.html` itself to a pure redirect — its theme
// toggle is gone with the rest of the chrome. The roster here covers
// only the pages still rendering inline chrome (marketing).
const REDESIGNED_PAGES = [
  // Marketing (out of scope for chrome unification)
  'frontend/index.html',
  'frontend/pricing.html',
];

// Variants of the BEM drift that surfaced across Phase 1+2 pages. Any
// reappearance is a regression — components.css does not style any of
// these, so both SVGs would render simultaneously inside the button.
const BEM_DRIFT_VARIANTS = [
  'av-theme-toggle__icon--sun',
  'av-theme-toggle__icon--moon',
  'av-theme-toggle__icon',
  'theme-toggle__icon--sun',
  'theme-toggle__icon--moon',
  'av-theme-toggle__sun',
  'av-theme-toggle__moon',
];


// ── HTML markup — every redesigned page uses canonical classes ────


for (const rel of REDESIGNED_PAGES) {
  describe(`theme-toggle icon canonical / ${rel}`, () => {
    let html;
    before(() => {
      html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    });

    test('button uses canonical .icon-sun class on sun SVG', () => {
      assert.match(
        html,
        /class=["']icon-sun["']/,
        `${rel}: theme toggle missing canonical class="icon-sun" on the sun SVG`,
      );
    });

    test('button uses canonical .icon-moon class on moon SVG', () => {
      assert.match(
        html,
        /class=["']icon-moon["']/,
        `${rel}: theme toggle missing canonical class="icon-moon" on the moon SVG`,
      );
    });

    test('no BEM drift class variants remain', () => {
      for (const variant of BEM_DRIFT_VARIANTS) {
        assert.ok(
          !html.includes(variant),
          `${rel}: still contains BEM drift class "${variant}". ` +
          `Replace with canonical .icon-sun / .icon-moon — ` +
          `components.css does not style the BEM variants, so the ` +
          `[data-theme] visibility swap never fires.`,
        );
      }
    });

    test('exactly one .av-theme-toggle button on the page', () => {
      const count = (html.match(/class=["'][^"']*\bav-theme-toggle\b[^"']*["']/g) || []).length;
      // Some pages may include the class as a stylable hook on additional
      // elements (e.g., a print-only hidden ref); cap at 2 to be safe.
      assert.ok(count >= 1, `${rel}: no .av-theme-toggle button found`);
      assert.ok(count <= 2, `${rel}: found ${count} .av-theme-toggle elements — expected 1 (or 2 with a hidden mirror)`);
    });
  });
}


// ── components.css owns the canonical visibility swap ────────────


describe('aver-chrome.js shadow style / canonical theme-toggle icon visibility', () => {
  // Sprint 7.14 — the canonical `.av-theme-toggle` visibility-swap
  // rules moved from components.css into the shadow-root <style>
  // block in frontend/js/components/aver-chrome.js. The dark-theme
  // selectors use `:host-context([data-theme="dark"])` to cross the
  // shadow boundary (Sprint 7.11 design decision).
  let css;
  before(() => {
    css = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/components/aver-chrome.js'),
      'utf8',
    );
  });

  test('hides .icon-sun in light theme (default rule) in aver-chrome shadow style', () => {
    assert.match(
      css,
      /\.av-theme-toggle\s+\.icon-sun\s*\{\s*display:\s*none/,
      'aver-chrome.js missing default `.av-theme-toggle .icon-sun { display: none }`',
    );
  });

  test('shows .icon-moon in light theme (default rule) in aver-chrome shadow style', () => {
    assert.match(
      css,
      /\.av-theme-toggle\s+\.icon-moon\s*\{\s*display:\s*block/,
      'aver-chrome.js missing default `.av-theme-toggle .icon-moon { display: block }`',
    );
  });

  test('shows .icon-sun in dark theme via :host-context([data-theme="dark"])', () => {
    assert.match(
      css,
      /:host-context\(\[data-theme=["']dark["']\]\)\s+\.av-theme-toggle\s+\.icon-sun\s*\{\s*display:\s*block/,
      'aver-chrome.js missing `:host-context([data-theme="dark"]) .av-theme-toggle .icon-sun { display: block }`',
    );
  });

  test('hides .icon-moon in dark theme via :host-context([data-theme="dark"])', () => {
    assert.match(
      css,
      /:host-context\(\[data-theme=["']dark["']\]\)\s+\.av-theme-toggle\s+\.icon-moon\s*\{\s*display:\s*none/,
      'aver-chrome.js missing `:host-context([data-theme="dark"]) .av-theme-toggle .icon-moon { display: none }`',
    );
  });

  test('does NOT define any rule for BEM drift class names', () => {
    for (const variant of BEM_DRIFT_VARIANTS) {
      assert.ok(
        !css.includes(variant),
        `aver-chrome.js must not reference the BEM drift class "${variant}" — ` +
        `canonical pattern uses .icon-sun / .icon-moon only`,
      );
    }
  });
});


// ── No page-level CSS duplicates the components.css canonical rule ──


describe('Per-page CSS does not duplicate the components.css canonical rule', () => {
  // Single-source-of-truth: only components.css owns the visibility
  // swap. If a page CSS file redefines `.av-theme-toggle .icon-sun`
  // visibility, it would either (a) duplicate the rule (harmless but
  // confusing) or (b) override it incorrectly. Pin against duplication.
  const PER_PAGE_CSS = [
    'frontend/css/home.css',
    'frontend/css/speaking.css',
    'frontend/css/practice.css',
    'frontend/css/result.css',
    'frontend/css/writing-dashboard.css',
    'frontend/css/writing-result.css',
    'frontend/css/full-test-result.css',
    'frontend/css/vocabulary.css',
    'frontend/css/flashcards.css',
    'frontend/css/exercises.css',
    'frontend/css/profile.css',
    'frontend/css/onboarding.css',
    'frontend/css/index.css',
  ];

  for (const rel of PER_PAGE_CSS) {
    test(`${rel} does not redefine the .icon-sun/.icon-moon visibility swap`, () => {
      const css = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // A page CSS may legitimately mention `.av-theme-toggle` for size
      // overrides or media-print hiding (writing-result.css does this).
      // But it must NOT redefine the `.icon-sun` / `.icon-moon` display
      // rule — those live in components.css.
      assert.ok(
        !/\.av-theme-toggle\s+\.icon-sun\s*\{[^}]*display\s*:/i.test(css),
        `${rel}: redefines .av-theme-toggle .icon-sun display — ` +
        `let components.css own the swap`,
      );
      assert.ok(
        !/\.av-theme-toggle\s+\.icon-moon\s*\{[^}]*display\s*:/i.test(css),
        `${rel}: redefines .av-theme-toggle .icon-moon display — ` +
        `let components.css own the swap`,
      );
    });
  }
});
