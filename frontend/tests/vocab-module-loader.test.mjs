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
 * Sprint 7.4 — DEBT-2026-05-09-B Phase 2 extends this sentinel for the
 * flashcards module migration. Same contract as my-vocab; only the
 * surface area of the legacy /js/flashcards.js translates into module
 * data-actions and unmount cleanup. Section 6 covers the flashcards
 * module file, parent-loader update, and standalone-shell rewrite.
 *
 * Sprint 7.5 — DEBT-2026-05-09-B Phase 3 extends this sentinel for the
 * exercises module migration. Smallest of the three modules — a drill-hub
 * landing with 3 cards gated by feature flags, no interactive handlers,
 * no timers, no audio. Section 7 covers the exercises module + shell.
 *
 * Sprint 7.6 — **DEBT-2026-05-09-B CLOSED**. embedded-mode.css deleted,
 * the legacy iframe branch in vocab-landing.js.activateTab() retired,
 * the 3 `<link rel="stylesheet" href="/css/embedded-mode.css">` tags
 * removed from each shell. The "css link preserved" pins flipped to
 * "css link removed" sentinels; the TAB_SOURCES + _loaded + frame.src
 * pins flipped to retirement guards.
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

  test('HTML template ships the canonical subpage-header + Vocabulary eyebrow', () => {
    // Sprint 9.1 — `.mv-header mv-context-bar` retired in favor of the
    // shared `.subpage-header` primitive (components.css). Eyebrow +
    // page title still rendered inside the header.
    assert.match(src, /<header class="subpage-header/);
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

  test('declares TAB_LOADERS with my-vocab + flashcards + exercises entries', () => {
    assert.match(src, /TAB_LOADERS\s*=\s*\{[\s\S]{0,500}['"]my-vocab['"]\s*:/);
    assert.match(src, /import\(['"]\/js\/vocab-modules\/my-vocab\.js['"]\)/);
    assert.match(src, /TAB_LOADERS\s*=\s*\{[\s\S]{0,500}['"]flashcards['"]\s*:/);
    assert.match(src, /import\(['"]\/js\/vocab-modules\/flashcards\.js['"]\)/);
    assert.match(src, /TAB_LOADERS\s*=\s*\{[\s\S]{0,500}['"]exercises['"]\s*:/);
    assert.match(src, /import\(['"]\/js\/vocab-modules\/exercises\.js['"]\)/);
  });

  test('TAB_SOURCES + _loaded + iframe branch fully removed (Sprint 7.6 closure)', () => {
    // The legacy iframe lazy-load path is gone. activateTab() has no
    // else-branch anymore; tabs not in TAB_LOADERS (topic-bank only)
    // are pure CSS reveals.
    assert.ok(
      !/const\s+TAB_SOURCES\s*=/.test(src),
      'TAB_SOURCES const must be removed after Sprint 7.6',
    );
    assert.ok(
      !/const\s+_loaded\s*=\s*new Set/.test(src),
      '_loaded Set must be removed after Sprint 7.6 (no iframe lazy-load to track)',
    );
    assert.ok(
      !/frame\.src\s*=/.test(src),
      'frame.src assignment must be removed after Sprint 7.6',
    );
    assert.ok(
      !/\.tab-frame/.test(src),
      '.tab-frame selector must be removed after Sprint 7.6',
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

  test('flashcards tab panel ships <div class="tab-mount"> (Sprint 7.4)', () => {
    const flashSection = html.match(
      /<section[^>]*data-panel="flashcards"[^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(flashSection, 'flashcards tab-panel section not found');
    assert.match(flashSection[0], /<div[^>]*class=["'][^"']*\btab-mount\b/);
    assert.ok(
      !/<iframe\b/.test(flashSection[0]),
      'flashcards tab-panel must NOT contain an <iframe> after Sprint 7.4',
    );
  });

  test('exercises tab panel ships <div class="tab-mount"> (Sprint 7.5)', () => {
    const exSection = html.match(
      /<section[^>]*data-panel="exercises"[^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(exSection, 'exercises tab-panel section not found');
    assert.match(exSection[0], /<div[^>]*class=["'][^"']*\btab-mount\b/);
    assert.ok(
      !/<iframe\b/.test(exSection[0]),
      'exercises tab-panel must NOT contain an <iframe> after Sprint 7.5',
    );
  });

  test('no <iframe> elements remain anywhere in vocabulary.html — Sprint 7.5 milestone', () => {
    // After Sprint 7.5 all 3 vocab children are on the module path.
    // vocabulary.html should ship zero iframes. Sprint 7.6 retires the
    // legacy iframe branch in vocab-landing.js.activateTab() + the
    // _loaded Set + TAB_SOURCES.
    assert.ok(
      !/<iframe\b/.test(html),
      'vocabulary.html must contain ZERO <iframe> elements after Sprint 7.5 milestone',
    );
  });

  test('Sprint 7.7-hotfix — vocab module resources eagerly loaded for embedded path', () => {
    // The 3 vocab modules render embedded into this page; their HTML
    // templates depend on Tailwind utility classes (`hidden`, `grid`,
    // `flex`, `text-*`, font-weight, spacing) + per-module CSS namespaces
    // (`.mv-*`, `.fc-*`, `.ex-*`). Without these the embedded render
    // shows unstyled / stacked-state regression. Sprint 7.3 → 7.6
    // migrations moved page bodies into modules but missed the resource
    // import migration — this pin prevents the regression from
    // re-occurring (drop of any one import = test fail).
    assert.match(
      html,
      /<script\s+src="https:\/\/cdn\.tailwindcss\.com"/,
      'vocabulary.html must load Tailwind CDN so module templates that ' +
      'use `.hidden`, `.grid`, etc. render correctly when embedded',
    );
    assert.match(
      html,
      /tailwind\.config\s*=\s*\{[\s\S]{0,400}Plus Jakarta Sans/,
      'vocabulary.html must declare the canonical Tailwind config ' +
      '(navy/teal palette + Plus Jakarta Sans) — matches standalone shells',
    );
    for (const css of ['my-vocabulary.css', 'flashcards.css', 'exercises.css']) {
      const re = new RegExp(`<link\\s+rel="stylesheet"\\s+href="/css/${css.replace('.', '\\.')}"`);
      assert.match(
        html, re,
        `vocabulary.html must load /css/${css} so the embedded module renders styled`,
      );
    }
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

  test('chrome migrated to <aver-chrome> (Sprint 7.13)', () => {
    // Sprint 6.17.1 + 6.20 canonical chrome → Sprint 7.13 moved into
    // <aver-chrome> Web Component. The shell carries the custom element
    // + component module script; chrome markup lives in shadow root.
    assert.match(html, /<aver-chrome\s+active="vocabulary"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
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

  test('embedded-mode.css link removed (Sprint 7.6 — file deleted)', () => {
    assert.ok(
      !/css\/embedded-mode\.css/.test(html),
      'my-vocabulary.html must NOT link the deleted embedded-mode.css',
    );
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
    // The subpage-header, filter buttons, modals must NOT be in the
    // shell HTML — they live in the my-vocab.js module template. If
    // they reappeared in the shell, the module would render them twice.
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    assert.ok(
      !/<header[^>]*\bsubpage-header\b/.test(body[0]),
      'subpage-header must not appear in shell — module template owns it (Sprint 9.1)',
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


// ── 6. flashcards module + shell (Sprint 7.4) ─────────────────────

describe('Sprint 7.4 — /js/vocab-modules/flashcards.js module', () => {
  let src;
  before(() => {
    src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/flashcards.js'),
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

  test('HTML template ships the canonical subpage-header + Vocabulary eyebrow', () => {
    // Sprint 9.1 — `.fc-header fc-context-bar` retired (shared
    // `.subpage-header` primitive in components.css). 📚 emoji prefix
    // dropped per Phase D Q5.
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="eyebrow"[^>]*>Vocabulary/);
    assert.match(src, /<h1[^>]*class="[^"]*\bsubpage-header__title\b[^"]*"[^>]*>\s*Flashcards\s*<\/h1>/);
    assert.ok(
      !src.includes('📚 Flashcards'),
      'Sprint 9.1 dropped the 📚 emoji prefix from the Flashcards title (Phase D Q5)',
    );
  });

  test('HTML template ships the moved banner + container + create-stack modal + toast', () => {
    assert.match(src, /data-banner="moved"/);
    assert.match(src, /data-fc-container/);
    assert.match(src, /data-fc-modal/);
    assert.match(src, /data-fc-topics/);
    assert.match(src, /data-fc-preview/);
    assert.match(src, /data-fc-toast/);
    assert.match(src, /data-fc-save/);
  });

  test('HTML template ships all 4 category chips with data-action="toggle-category"', () => {
    const cats = ['used_well', 'needs_review', 'upgrade_suggested', 'manual'];
    cats.forEach((c) => {
      const re = new RegExp(`data-action="toggle-category"[^>]*data-cat="${c}"`);
      assert.match(src, re, `missing category chip for ${c}`);
    });
  });

  test('event delegation: NO inline onclick attributes inside template literal', () => {
    const m = src.match(/const HTML = \/\* html \*\/ `([\s\S]+?)`;/);
    assert.ok(m, 'HTML template literal not extractable');
    assert.ok(
      !/onclick=/.test(m[1]),
      'HTML template must not contain inline onclick attributes (Phase B Q1 — event delegation)',
    );
  });

  test('all required data-action values present in module', () => {
    const ACTIONS = [
      'open-stack-modal', 'close-stack-modal', 'save-stack',
      'open-stack', 'toggle-topic', 'toggle-category', 'delete-stack',
    ];
    ACTIONS.forEach((a) => {
      assert.ok(
        src.includes(`'${a}'`) || src.includes(`"${a}"`),
        `module must reference data-action="${a}" (switch case + delegation)`,
      );
    });
  });

  test('no leakage of window.* handler globals (Phase B Q1)', () => {
    const LEGACY_GLOBALS = [
      'window.openStackModal', 'window.closeStackModal', 'window.saveStack',
      'window.openStack', 'window.deleteStack', 'window.toggleTopicChip',
      'window.toggleCategoryChip', 'window._fc', 'window.fcSelected',
    ];
    LEGACY_GLOBALS.forEach((g) => {
      assert.ok(
        !src.includes(g),
        `module must NOT leak ${g} — Phase B Q1 requires event delegation, not window globals`,
      );
    });
  });

  test('embedded-aware navigateToStudy() uses window.top when embedded', () => {
    assert.match(src, /window\.top\.location\.href/);
  });

  test('banner visibility driven by opts.embedded (no URL sniffing)', () => {
    assert.match(src, /\[data-banner="moved"\]/);
    assert.match(src, /banner\.classList\.toggle\(\s*['"]hidden['"]\s*,\s*!!embedded\s*\)/);
  });

  test('delete-stack handler intercepts BEFORE stack-card parent (e.stopPropagation)', () => {
    // delete-btn lives inside stack-card; both carry data-action. The
    // module must call e.stopPropagation() on delete to avoid double-fire.
    assert.match(
      src,
      /\[data-action="delete-stack"\][\s\S]{0,200}stopPropagation/,
    );
  });

  test('unmount() lifecycle: removes 3 listeners + clears 2 timers + clears container + guard', () => {
    assert.match(src, /container\.removeEventListener\(\s*['"]click['"]\s*,\s*handleClick\s*\)/);
    assert.match(src, /container\.removeEventListener\(\s*['"]input['"]\s*,\s*handleInput\s*\)/);
    assert.match(src, /container\.removeEventListener\(\s*['"]change['"]\s*,\s*handleChange\s*\)/);
    assert.match(src, /clearTimeout\(\s*_state\.previewTimer\s*\)/);
    assert.match(src, /clearTimeout\(\s*_toastTimer\s*\)/);
    assert.match(src, /container\.innerHTML\s*=\s*['"]['"]|container\.innerHTML\s*=\s*``/);
    assert.match(src, /guard\.clearHandle\s*\(\s*\)/);
  });
});


describe('Sprint 7.4 — /pages/flashcards.html is a thin shell that mounts the module', () => {
  let html;
  before(() => {
    html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/flashcards.html'),
      'utf8',
    );
  });

  test('chrome migrated to <aver-chrome> (Sprint 7.13)', () => {
    // Sprint 6.17.1 + 6.20 canonical chrome → Sprint 7.13 moved into
    // <aver-chrome> Web Component. The shell carries the custom element
    // + component module script; chrome markup lives in shadow root.
    assert.match(html, /<aver-chrome\s+active="vocabulary"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('embedded-mode IIFE retired (Sprint 7.4 Phase B Q3 incremental closure)', () => {
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'flashcards.html must NOT set embedded-mode class anymore',
    );
  });

  test('embedded-mode.css link removed (Sprint 7.6 — file deleted)', () => {
    assert.ok(
      !/css\/embedded-mode\.css/.test(html),
      'flashcards.html must NOT link the deleted embedded-mode.css',
    );
  });

  test('<main id="mount"> mount container present', () => {
    assert.match(html, /<main\s+id="mount"/);
  });

  test('inline module script imports + calls mount() with embedded:false', () => {
    assert.match(
      html,
      /import\s*\{\s*mount\s*\}\s+from\s+['"]\/js\/vocab-modules\/flashcards\.js['"]/,
    );
    assert.match(html, /mount\s*\(\s*document\.getElementById\(\s*['"]mount['"]\s*\)\s*,\s*\{\s*embedded:\s*false/);
  });

  test('legacy <script src="../js/flashcards.js"> removed', () => {
    assert.ok(
      !/<script[^>]*src=["'][^"']*\/flashcards\.js["']/.test(html),
      'legacy /js/flashcards.js script tag must be removed after Sprint 7.4',
    );
  });

  test('no inline body markup — context bar, modal, toast live in the module', () => {
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    assert.ok(
      !/<header[^>]*\bsubpage-header\b/.test(body[0]),
      'subpage-header must not appear in shell — module template owns it (Sprint 9.1)',
    );
    assert.ok(
      !/<div[^>]*\bid="fc-modal"/.test(body[0]),
      'fc-modal must not appear in shell',
    );
    assert.ok(
      !/<div[^>]*\bid="fc-toast"/.test(body[0]),
      'fc-toast must not appear in shell',
    );
    assert.ok(
      !/<div[^>]*\bid="fc-container"/.test(body[0]),
      'fc-container must not appear in shell',
    );
  });
});


// ── 7. exercises module + shell (Sprint 7.5) ──────────────────────

describe('Sprint 7.5 — /js/vocab-modules/exercises.js module', () => {
  let src;
  before(() => {
    src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/exercises.js'),
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

  test('HTML template ships the canonical subpage-header + Vocabulary eyebrow', () => {
    // Sprint 9.1 — `.ex-header ex-context-bar` retired (shared
    // `.subpage-header` primitive in components.css).
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="eyebrow"[^>]*>Vocabulary/);
    assert.match(src, /<h1[^>]*class="[^"]*\bsubpage-header__title\b[^"]*"[^>]*>\s*Exercises\s*<\/h1>/);
  });

  test('HTML template ships the 4 render states + 2 drill cards (Sprint 9.1: D3 retired)', () => {
    // Render states use data-state attrs (scoped to container, not IDs).
    for (const state of ['loading', 'disabled', 'error', 'hub']) {
      const re = new RegExp(`data-state="${state}"`);
      assert.match(src, re, `missing data-state="${state}"`);
    }
    // Cards use data-card attrs (scoped to container, not IDs).
    // Sprint 9.1 — D3 "Speak with target" card retired per Phase D Q8.
    // Only D1 + flashcards remain.
    for (const card of ['d1', 'flashcards']) {
      const re = new RegExp(`data-card="${card}"`);
      assert.match(src, re, `missing data-card="${card}"`);
    }
    assert.ok(
      !/data-card="d3"/.test(src),
      'data-card="d3" must NOT exist — Sprint 9.1 retired the D3 "Speak with target" card',
    );
  });

  test('card hrefs are absolute paths (Sprint 6.15.8-hotfix lesson)', () => {
    assert.match(src, /href="\/pages\/d1-exercise\.html"/);
    assert.match(src, /href="\/pages\/flashcards\.html"/);
    // No relative hrefs that would break under Vercel rewrites.
    assert.ok(
      !/href="d1-exercise\.html"/.test(src) &&
      !/href="flashcards\.html"/.test(src),
      'card hrefs must be absolute (no bare relative paths)',
    );
  });

  test('no inline onclick / no event delegation needed (cards are plain links)', () => {
    const m = src.match(/const HTML = \/\* html \*\/ `([\s\S]+?)`;/);
    assert.ok(m, 'HTML template literal not extractable');
    assert.ok(
      !/onclick=/.test(m[1]),
      'HTML template must not contain inline onclick attributes',
    );
    // Sanity: no data-action either (Phase A audit: zero interactive handlers).
    assert.ok(
      !/data-action=/.test(m[1]),
      'exercises template has no interactive handlers — no data-action expected',
    );
  });

  test('no leakage of window.* handler globals', () => {
    const LEGACY_GLOBALS = [
      'window.showState', 'window._exercises', 'window.exercisesInit',
    ];
    LEGACY_GLOBALS.forEach((g) => {
      assert.ok(
        !src.includes(g),
        `module must NOT leak ${g} — closure-scoped state only`,
      );
    });
  });

  test('init() fetches /auth/me for feature flags + default-deny DOM mutation', () => {
    assert.match(src, /\/auth\/me/);
    // Default-deny D1: remove from DOM, not display:none.
    assert.match(src, /parentNode\.removeChild\(card\)/);
    // Default-deny flashcards: same pattern.
    assert.match(src, /flashcardsCard\.parentNode\.removeChild/);
  });

  test('unmount() lifecycle: clears container + clears guard (no timers/listeners to clean)', () => {
    assert.match(src, /container\.innerHTML\s*=\s*['"]['"]|container\.innerHTML\s*=\s*``/);
    assert.match(src, /guard\.clearHandle\s*\(\s*\)/);
  });
});


describe('Sprint 7.5 — /pages/exercises.html is a thin shell that mounts the module', () => {
  let html;
  before(() => {
    html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/exercises.html'),
      'utf8',
    );
  });

  test('chrome migrated to <aver-chrome> (Sprint 7.13)', () => {
    // Sprint 6.17.1 + 6.20 canonical chrome → Sprint 7.13 moved into
    // <aver-chrome> Web Component. The shell carries the custom element
    // + component module script; chrome markup lives in shadow root.
    assert.match(html, /<aver-chrome\s+active="vocabulary"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('embedded-mode IIFE retired (Sprint 7.5 Phase B Q3 final closure)', () => {
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'exercises.html must NOT set embedded-mode class anymore',
    );
  });

  test('embedded-mode.css link removed (Sprint 7.6 — file deleted)', () => {
    assert.ok(
      !/css\/embedded-mode\.css/.test(html),
      'exercises.html must NOT link the deleted embedded-mode.css',
    );
  });

  test('<main id="mount"> mount container present', () => {
    assert.match(html, /<main\s+id="mount"/);
  });

  test('inline module script imports + calls mount() with embedded:false', () => {
    assert.match(
      html,
      /import\s*\{\s*mount\s*\}\s+from\s+['"]\/js\/vocab-modules\/exercises\.js['"]/,
    );
    assert.match(html, /mount\s*\(\s*document\.getElementById\(\s*['"]mount['"]\s*\)\s*,\s*\{\s*embedded:\s*false/);
  });

  test('no inline body markup — context bar + 4 states + 3 cards live in the module', () => {
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    assert.ok(
      !/<header[^>]*\bsubpage-header\b/.test(body[0]),
      'subpage-header must not appear in shell — module template owns it (Sprint 9.1)',
    );
    assert.ok(
      !/<div[^>]*\bid="state-loading"/.test(body[0]),
      'state-loading must not appear in shell',
    );
    assert.ok(
      !/<div[^>]*\bid="hub"/.test(body[0]),
      'hub must not appear in shell',
    );
    assert.ok(
      !/<a[^>]*\bid="card-d1"/.test(body[0]),
      'card-d1 must not appear in shell',
    );
  });

  test('no inline auth-gate IIFE remains (logic moved to module init())', () => {
    const body = html.match(/<body[\s\S]+?<\/body>/);
    assert.ok(body, '<body> block not extractable');
    assert.ok(
      !/fetch\(`\$\{BASE\}\/auth\/me`/.test(body[0]),
      'inline /auth/me fetch must not appear in shell — module owns it',
    );
  });
});


// ─────────────────────────────────────────────────────────────────────
// Sprint 9.1.1-hotfix — JS template literal hygiene sentinel.
//
// Sprint 9.1's retirement comments wrapped CSS class names in backticks
// inside HTML comments (e.g. `<!-- .subpage-header primitive ... -->`).
// Backticks inside a template literal terminate the literal early, so
// `.subpage-header` parsed as a property access, and a subsequent
// `header` token surfaced as an unqualified identifier — causing a
// runtime `ReferenceError: header is not defined` when the module
// loader evaluated the file. Andy's Vercel preview smoke caught all 3
// modules crashing on mount. Lesson: HTML comments inside JS template
// literals must contain NO backticks, even decorative ones around
// identifiers.
// ─────────────────────────────────────────────────────────────────────

describe('Sprint 9.1.1-hotfix — vocab module template literals must not contain backticks inside HTML body', () => {
  const VOCAB_MODULES = [
    'frontend/js/vocab-modules/my-vocab.js',
    'frontend/js/vocab-modules/flashcards.js',
    'frontend/js/vocab-modules/exercises.js',
  ];

  for (const modulePath of VOCAB_MODULES) {
    test(`${modulePath} — HTML template literal body must not contain backticks`, () => {
      const src = readFileSync(path.join(REPO_ROOT, modulePath), 'utf8');

      const match = src.match(/const HTML\s*=\s*\/\*\s*html\s*\*\/\s*`([\s\S]*?)\n`;/);
      assert.ok(match, `${modulePath} must have HTML template literal opened with \`const HTML = /* html */ \`\``);

      const htmlBody = match[1];
      assert.ok(
        !htmlBody.includes('`'),
        `${modulePath} HTML template literal body must not contain backticks — they terminate the template early and cause "ReferenceError: header is not defined" at runtime (Sprint 9.1.1-hotfix).`,
      );
    });
  }
});
