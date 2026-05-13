/**
 * frontend/tests/vocab-module-loader.test.mjs
 *
 * Sprint 7.3 — DEBT-2026-05-09-B Phase 1 sentinel.
 *
 * Pins the vocab-module loader contract and the my-vocab migration:
 *
 *   1. Loader helper module — /js/vocab-modules/_loader.js exports
 *      renderSkeleton, renderError, redirectToLogin, guardMount.
 *   2. my-vocab module — /js/vocab-modules/my-vocab.js exports mount()
 *      and ships the canonical HTML body template (template literal,
 *      Phase B Q2). All 11 legacy window.* handlers are replaced by
 *      `data-action="…"` attributes (Phase B Q1 — event delegation).
 *   3. Parent loader — /js/vocab-landing.js carries a TAB_LOADERS
 *      branch with `my-vocab` mapped to dynamic import().
 *   4. Parent shell — /pages/vocabulary.html ships a `<div class="tab-mount">`
 *      inside the my-vocab tab panel (no more <iframe>).
 *   5. Standalone shell — /pages/my-vocabulary.html preserves canonical
 *      chrome, retired the embedded-mode IIFE, and ships an inline
 *      script that imports the module + calls mount() on
 *      <main id="mount">.
 *
 * Tests for flashcards + exercises module migrations land in
 * subsequent sprints (7.4 / 7.5). Sprint 7.6 retires embedded-mode.css.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── 1. Loader helper module ───────────────────────────────────────

describe('Sprint 7.3 — /js/vocab-modules/_loader.js shared helper', () => {
  let src;
  before(() => {
    src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/_loader.js'),
      'utf8',
    );
  });

  test('exports renderSkeleton(container)', () => {
    assert.match(src, /export\s+function\s+renderSkeleton\s*\(\s*container/);
  });

  test('exports renderError(container, err, opts)', () => {
    assert.match(src, /export\s+function\s+renderError\s*\(/);
  });

  test('exports redirectToLogin with embedded-aware behavior', () => {
    assert.match(src, /export\s+function\s+redirectToLogin/);
    // Embedded-aware: navigates window.top when embedded === true.
    assert.match(src, /window\.top/);
    assert.match(src, /['"]\/index\.html['"]/);
  });

  test('exports guardMount(container) for idempotent mount guard', () => {
    assert.match(src, /export\s+function\s+guardMount\s*\(\s*container/);
    assert.match(src, /data-mounted/);
  });

  test('renderSkeleton uses canonical .spinner class', () => {
    assert.match(src, /class=["']spinner["']|class="[^"]*\bspinner\b/);
  });
});


// ── 2. my-vocab module ────────────────────────────────────────────

describe('Sprint 7.3 — /js/vocab-modules/my-vocab.js module', () => {
  let src;
  before(() => {
    src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/my-vocab.js'),
      'utf8',
    );
  });

  test('imports guardMount + redirectToLogin from _loader', () => {
    assert.match(
      src,
      /import\s*\{\s*guardMount\s*,\s*redirectToLogin\s*\}\s+from\s+['"]\.\/_loader\.js['"]/,
    );
  });

  test('exports async mount(container, opts) → { unmount }', () => {
    assert.match(src, /export\s+async\s+function\s+mount\s*\(\s*container\s*,/);
    // Returns a handle with unmount lifecycle.
    assert.match(src, /function\s+unmount\s*\(\s*\)/);
  });

  test('mount() consumes opts.embedded for auth-redirect routing', () => {
    assert.match(src, /opts\s*=\s*\{\s*\}/);
    assert.match(src, /redirectToLogin\s*\(\s*\{\s*embedded\s*\}/);
  });

  test('mount() respects idempotent guard (guardMount + alreadyMounted)', () => {
    assert.match(src, /guardMount\s*\(\s*container\s*\)/);
    assert.match(src, /alreadyMounted/);
  });

  test('HTML template ships the canonical mv-header + Vocabulary eyebrow', () => {
    assert.match(src, /<header class="mv-header mv-context-bar/);
    assert.match(src, /class="eyebrow"[^>]*>Vocabulary/);
    assert.match(src, /My Vocab Bank/);
  });

  test('HTML template ships all 7 filter buttons with data-action="set-filter"', () => {
    const filters = ['all', 'used_well', 'needs_review', 'upgrade_suggested', 'manual', 'learning', 'mastered'];
    filters.forEach((f) => {
      const re = new RegExp(`data-action="set-filter"[^>]*data-filter="${f}"`);
      assert.match(src, re, `missing filter button for ${f}`);
    });
  });

  test('HTML template ships both modals (fc-picker + report)', () => {
    assert.match(src, /data-modal="fc-picker"/);
    assert.match(src, /data-modal="report"/);
  });

  test('HTML template ships add-form + stats-bar + export buttons', () => {
    assert.match(src, /data-add-form/);
    assert.match(src, /data-stats-bar/);
    assert.match(src, /data-action="download-csv"/);
    assert.match(src, /data-action="download-json"/);
  });

  test('event delegation: NO inline onclick attributes inside template literal', () => {
    // Strip the HTML template literal between the opening `const HTML = /* html */ \`` and the
    // closing backtick of that literal. Then assert no onclick="" remains there.
    const m = src.match(/const HTML = \/\* html \*\/ `([\s\S]+?)`;/);
    assert.ok(m, 'HTML template literal not extractable');
    assert.ok(
      !/onclick=/.test(m[1]),
      'HTML template must not contain inline onclick attributes (Phase B Q1 — event delegation)',
    );
  });

  test('all required data-action values present in module', () => {
    const ACTIONS = [
      'toggle-add-form', 'submit-add-word', 'set-filter',
      'submit-report', 'close-report', 'close-fc-picker',
      'download-csv', 'download-json',
      'open-report', 'toggle-mastery', 'open-fc-picker',
      'preview-flashcard', 'accept-suggestion',
      'mark-fixed', 'skip-vocab', 'add-to-fc-stack',
    ];
    ACTIONS.forEach((a) => {
      assert.ok(
        src.includes(`'${a}'`) || src.includes(`"${a}"`),
        `module must reference data-action="${a}" (switch case + delegation)`,
      );
    });
  });

  test('no leakage of window.* handler globals (Phase B Q1)', () => {
    // Module must not bind window.setFilter / window.toggleAddForm / etc.
    const LEGACY_GLOBALS = [
      'window.setFilter', 'window.toggleAddForm', 'window.submitAddWord',
      'window.toggleMastery', 'window.openReport', 'window.closeReport',
      'window.submitReport', 'window.openFlashcardPicker',
      'window.closeFlashcardPicker', 'window.addToFlashcardStack',
      'window._myVocab',
    ];
    LEGACY_GLOBALS.forEach((g) => {
      assert.ok(
        !src.includes(g),
        `module must NOT leak ${g} — Phase B Q1 requires event delegation, not window globals`,
      );
    });
  });

  test('unmount() lifecycle: removes click listener + clears container + clears guard', () => {
    assert.match(src, /container\.removeEventListener\(\s*['"]click['"]\s*,\s*handleClick\s*\)/);
    assert.match(src, /container\.innerHTML\s*=\s*['"]['"]|container\.innerHTML\s*=\s*``/);
    assert.match(src, /guard\.clearHandle\s*\(\s*\)/);
  });
});


// ── 3. Parent loader (vocab-landing.js) ───────────────────────────

describe('Sprint 7.3 — /js/vocab-landing.js gains TAB_LOADERS module path', () => {
  let src;
  before(() => {
    src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-landing.js'),
      'utf8',
    );
  });

  test('declares TAB_LOADERS with my-vocab entry', () => {
    assert.match(src, /TAB_LOADERS\s*=\s*\{[\s\S]{0,200}['"]my-vocab['"]\s*:/);
    assert.match(src, /import\(['"]\/js\/vocab-modules\/my-vocab\.js['"]\)/);
  });

  test('TAB_SOURCES still includes flashcards + exercises (iframe path preserved)', () => {
    assert.match(src, /['"]flashcards['"]\s*:[\s\S]{0,200}flashcards\.html\?embedded=1/);
    assert.match(src, /['"]exercises['"]\s*:[\s\S]{0,200}exercises\.html\?embedded=1/);
  });

  test('TAB_SOURCES no longer carries my-vocab entry (module path takes over)', () => {
    // Match the TAB_SOURCES object literal only — avoid catching TAB_LOADERS.
    const sourcesBlock = src.match(/const TAB_SOURCES\s*=\s*\{[\s\S]+?\};/);
    assert.ok(sourcesBlock, 'TAB_SOURCES block not extractable');
    assert.ok(
      !/['"]my-vocab['"]\s*:/.test(sourcesBlock[0]),
      'TAB_SOURCES must not carry a my-vocab entry after Sprint 7.3 (module path owns it)',
    );
  });

  test('activateTab branches into module path when TAB_LOADERS[tabName] exists', () => {
    assert.match(src, /const\s+loader\s*=\s*TAB_LOADERS\[tabName\]/);
    assert.match(src, /\.tab-mount/);
    assert.match(src, /data-mounted/);
  });

  test('test seam exposes TAB_LOADERS keys', () => {
    assert.match(src, /TAB_LOADERS:\s*Object\.keys\(TAB_LOADERS\)/);
  });
});


// ── 4. Parent shell (vocabulary.html) ─────────────────────────────

describe('Sprint 7.3 — /pages/vocabulary.html my-vocab tab uses mount container', () => {
  let html;
  before(() => {
    html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/vocabulary.html'),
      'utf8',
    );
  });

  test('my-vocab tab panel ships <div class="tab-mount">', () => {
    // The my-vocab section should contain a .tab-mount div.
    const section = html.match(
      /<section[^>]*data-panel="my-vocab"[^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(section, 'my-vocab tab-panel section not found');
    assert.match(section[0], /<div[^>]*class=["'][^"']*\btab-mount\b/);
    // No iframe in this panel anymore.
    assert.ok(
      !/<iframe\b/.test(section[0]),
      'my-vocab tab-panel must NOT contain an <iframe> after Sprint 7.3',
    );
  });

  test('flashcards + exercises tab panels still use iframe (legacy path preserved)', () => {
    const flashSection = html.match(
      /<section[^>]*data-panel="flashcards"[^>]*>[\s\S]+?<\/section>/,
    );
    const exSection = html.match(
      /<section[^>]*data-panel="exercises"[^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(flashSection && /<iframe\b/.test(flashSection[0]),
      'flashcards tab must still use <iframe> until Sprint 7.4');
    assert.ok(exSection && /<iframe\b/.test(exSection[0]),
      'exercises tab must still use <iframe> until Sprint 7.5');
  });
});


// ── 5. Standalone shell (my-vocabulary.html) ──────────────────────

describe('Sprint 7.3 — /pages/my-vocabulary.html is a thin shell that mounts the module', () => {
  let html;
  before(() => {
    html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/my-vocabulary.html'),
      'utf8',
    );
  });

  test('canonical chrome preserved (Sprint 6.17.1 / 6.20)', () => {
    assert.match(html, /<div\s+class="topnav-wrap"/);
    assert.match(html, /<nav\s+class="topnav"/);
    assert.match(html, /class="av-theme-toggle"/);
    assert.match(html, /id="user-pill"/);
  });

  test('canonical eyebrow tier label removed from shell HTML (now lives in module template)', () => {
    // Eyebrow no longer in the shell because the page body has moved into
    // the module. Subheading sentinel relaxes its my-vocabulary pin
    // accordingly; see subheading-pattern-canonical.test.mjs update.
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    // The shell-level eyebrow is absent; only the module template carries it.
    // This is a contract pin — drift would mean someone duplicated the
    // eyebrow into the shell, defeating the module-owns-page-body boundary.
    const shellEyebrow = body[0].match(/<p[^>]*class="eyebrow"/);
    assert.ok(
      !shellEyebrow,
      'shell HTML must not carry .eyebrow — module template owns it',
    );
  });

  test('embedded-mode IIFE retired (Sprint 7.3 Phase B Q3 incremental closure)', () => {
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'my-vocabulary.html must NOT set embedded-mode class anymore',
    );
  });

  test('embedded-mode.css link preserved (flashcards + exercises still depend on it)', () => {
    // Sprint 7.6 retires the file; until then the link stays for cross-page CSS uniformity.
    assert.match(html, /css\/embedded-mode\.css/);
  });

  test('<main id="mount"> mount container present', () => {
    assert.match(html, /<main\s+id="mount"/);
  });

  test('inline module script imports + calls mount() with embedded:false', () => {
    assert.match(
      html,
      /import\s*\{\s*mount\s*\}\s+from\s+['"]\/js\/vocab-modules\/my-vocab\.js['"]/,
    );
    assert.match(html, /mount\s*\(\s*document\.getElementById\(\s*['"]mount['"]\s*\)\s*,\s*\{\s*embedded:\s*false/);
  });

  test('legacy <script src="../js/my-vocabulary.js"> removed', () => {
    assert.ok(
      !/<script[^>]*src=["'][^"']*my-vocabulary\.js["']/.test(html),
      'legacy /js/my-vocabulary.js script tag must be removed after Sprint 7.3',
    );
  });

  test('no inline body markup — the page-context-bar, modals, etc. live in the module', () => {
    // The mv-header, filter buttons, modals must NOT be in the shell HTML —
    // they live in the my-vocab.js module template. If they reappeared in
    // the shell, the module would render them twice.
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    assert.ok(
      !/<header[^>]*\bmv-header\b/.test(body[0]),
      'mv-header must not appear in shell — module template owns it',
    );
    assert.ok(
      !/<div[^>]*\bid="fc-picker-modal"/.test(body[0]),
      'fc-picker modal must not appear in shell',
    );
    assert.ok(
      !/<div[^>]*\bid="report-modal"/.test(body[0]),
      'report modal must not appear in shell',
    );
  });
});
