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

  test('HTML template ships the canonical subpage-header + Vocabulary back-link', () => {
    // Sprint 9.1 — .mv-header retired in favor of the shared
    // .subpage-header primitive (components.css).
    // Sprint 9.2 — the eyebrow <p> was promoted to an interactive
    // back-link button (data-action="back-to-dashboard") so users can
    // return to the parent Vocabulary dashboard without a page reload.
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="subpage-header__back"[^>]*data-action="back-to-dashboard"/);
    assert.match(src, /<span>Vocabulary<\/span>/);
    assert.match(src, /My Vocab Bank/);
  });

  test('HTML template ships the 6 active filter buttons (Sprint 10.1.5 retired needs_review pill)', () => {
    // Sprint 10.1.5 — `needs_review` items now live on the dedicated
    // Needs Review tab (vocabulary.html#needs-review); the corresponding
    // filter pill was retired from My Vocab Bank. The remaining 6 pills
    // span both filter axes: source_type {all, used_well, upgrade_suggested,
    // manual} + mastery_status {learning, mastered}.
    const filters = ['all', 'used_well', 'upgrade_suggested', 'manual', 'learning', 'mastered'];
    filters.forEach((f) => {
      const re = new RegExp(`data-action="set-filter"[^>]*data-filter="${f}"`);
      assert.match(src, re, `missing filter button for ${f}`);
    });
    // Negative pin: the retired filter must not regress.
    assert.ok(
      !/data-action="set-filter"[^>]*data-filter="needs_review"/.test(src),
      'My Vocab Bank must NOT redeclare the needs_review filter pill — Sprint 10.1.5 retired it in favor of the dedicated Needs Review tab',
    );
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
    // P0-3 C-3.4: Tailwind utilities (.hidden/.grid/…) for embedded module
    // templates now come from EITHER the Play-CDN (legacy) OR the static build.
    assert.ok(
      /cdn\.tailwindcss\.com/.test(html) || /css\/tailwind\.build\.css/.test(html),
      'vocabulary.html must load Tailwind (Play-CDN or static build) so module ' +
      'templates that use `.hidden`, `.grid`, etc. render correctly when embedded',
    );
    // P0-3 C-3.4: the canonical palette/font (navy/teal + Plus Jakarta) is now
    // in tailwind.config.cjs → css/tailwind.build.css when migrated, else still
    // in the inline Play-CDN config.
    assert.ok(
      /tailwind\.config\s*=\s*\{[\s\S]{0,400}Plus Jakarta Sans/.test(html)
        || /css\/tailwind\.build\.css/.test(html),
      'vocabulary.html must declare the canonical Tailwind palette/font via the ' +
      'inline config or the static build',
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

  test('HTML template ships the canonical subpage-header + Vocabulary back-link', () => {
    // Sprint 9.1 — .fc-header retired (shared .subpage-header primitive
    // in components.css). 📚 emoji prefix dropped per Phase D Q5.
    // Sprint 9.2 — eyebrow → interactive back-link button.
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="subpage-header__back"[^>]*data-action="back-to-dashboard"/);
    assert.match(src, /<span>Vocabulary<\/span>/);
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

  test('HTML template ships the canonical subpage-header + Vocabulary back-link', () => {
    // Sprint 9.1 — .ex-header retired (shared .subpage-header primitive
    // in components.css).
    // Sprint 9.2 — eyebrow → interactive back-link button.
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="subpage-header__back"[^>]*data-action="back-to-dashboard"/);
    assert.match(src, /<span>Vocabulary<\/span>/);
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

  test('no inline onclick (Sprint 9.2 — only data-action="back-to-dashboard" is allowed)', () => {
    const m = src.match(/const HTML = \/\* html \*\/ `([\s\S]+?)`;/);
    assert.ok(m, 'HTML template literal not extractable');
    assert.ok(
      !/onclick=/.test(m[1]),
      'HTML template must not contain inline onclick attributes',
    );
    // Sprint 9.2 — the only data-action introduced into this drill-hub
    // template is "back-to-dashboard" on the .subpage-header__back
    // button. The drill cards themselves are still plain <a href>
    // links per Sprint 7.5's Phase B contract — no interactive handlers.
    const actions = [...m[1].matchAll(/data-action="([^"]+)"/g)].map(a => a[1]);
    assert.deepEqual(
      actions,
      ['back-to-dashboard'],
      'exercises template must only carry the Sprint 9.2 back-link data-action; drill cards remain plain links',
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


// ─────────────────────────────────────────────────────────────────────
// Sprint 9.2 — back-link contract (vocab side).
//
// Sprint 9.2 promoted the static <p class="eyebrow">Vocabulary</p>
// tier label inside each vocab module template to an interactive
// <button class="subpage-header__back" data-action="back-to-dashboard">
// so users can return to the parent Vocabulary dashboard view without
// reloading the page. Sentinel pins the three contract surfaces:
//   1. button markup with the new BEM class + data-action
//   2. arrow-left Lucide icon + "Vocabulary" label inside the button
//   3. aria-label for screen-reader users
//   4. module JS handles the 'back-to-dashboard' action (delegation)
// ─────────────────────────────────────────────────────────────────────

describe('Sprint 9.2 — vocab modules ship the .subpage-header__back contract', () => {
  const VOCAB_MODULES = [
    'frontend/js/vocab-modules/my-vocab.js',
    'frontend/js/vocab-modules/flashcards.js',
    'frontend/js/vocab-modules/exercises.js',
  ];

  for (const modulePath of VOCAB_MODULES) {
    test(`${modulePath} — back-link markup is present (button + arrow-left + label + aria)`, () => {
      const src = readFileSync(path.join(REPO_ROOT, modulePath), 'utf8');
      assert.match(
        src,
        /<button[^>]*\bclass="subpage-header__back"[^>]*\bdata-action="back-to-dashboard"[^>]*\baria-label="Quay về dashboard Vocabulary"/,
        `${modulePath} must ship the Sprint 9.2 back-link button with class + data-action + aria-label`,
      );
      assert.match(
        src,
        /<i\s+data-lucide="arrow-left"[^>]*><\/i>\s*<span>Vocabulary<\/span>/,
        `${modulePath} must ship an arrow-left Lucide icon followed by a "Vocabulary" label inside the back-link`,
      );
    });

    test(`${modulePath} — module JS wires the 'back-to-dashboard' action`, () => {
      const src = readFileSync(path.join(REPO_ROOT, modulePath), 'utf8');
      assert.match(
        src,
        /back-to-dashboard/,
        `${modulePath} must reference 'back-to-dashboard' in its handler logic`,
      );
      // Embedded path clears the hash (vocab-landing.js handles
      // hashchange → showDashboard); standalone path navigates to
      // /pages/vocabulary.html.
      assert.match(
        src,
        /\/pages\/vocabulary\.html/,
        `${modulePath} must navigate to /pages/vocabulary.html in standalone mode`,
      );
    });
  }
});


describe('Sprint 9.2 — vocab-landing.js owns showDashboard() + pushState navigation', () => {
  let src;
  before(() => {
    src = readFileSync(path.join(REPO_ROOT, 'frontend/js/vocab-landing.js'), 'utf8');
  });

  test('exposes showDashboard() and reveals .vocab-modes + hides every panel', () => {
    assert.match(src, /function\s+showDashboard\s*\(\s*\)/);
    const fn = src.match(/function\s+showDashboard\s*\(\s*\)\s*\{([\s\S]+?)\n\s*\}/);
    assert.ok(fn, 'showDashboard() body must be extractable');
    assert.match(fn[1], /\.vocab-modes/);
    assert.match(fn[1], /\.tab-panel/);
    assert.match(fn[1], /\.hidden\s*=\s*false/);
    assert.match(fn[1], /\.hidden\s*=\s*true/);
  });

  test('mode-card activation uses pushState (not replaceState) for browser back support', () => {
    assert.match(
      src,
      /history\.pushState\([^)]*['"`]#['"`]\s*\+\s*tabName/,
      'activateTab() must use history.pushState so visited modes become history entries',
    );
    // The pre-Sprint-9.2 replaceState call inside activateTab() must
    // be gone (allow the comment that documents the change to keep
    // the word for context, but no live call).
    assert.ok(
      !/history\.replaceState\(/.test(src),
      'vocab-landing.js must NOT call history.replaceState — Sprint 9.2 promoted it to pushState',
    );
  });

  test('hashchange listener falls back to showDashboard on empty/unknown hash', () => {
    // Capture the full listener — the outer `}\)\;` sits at the lowest
    // indent column of the addEventListener call (3 spaces here), so
    // match up to a `\n  }\);` to skip nested `});` that belong to
    // inner expressions (e.g. activateTab(fromHash, { ... });).
    const m = src.match(/window\.addEventListener\(\s*['"]hashchange['"][\s\S]*?\n\s{4}\}\);/);
    assert.ok(m, 'hashchange listener must be present');
    assert.match(m[0], /showDashboard\(\)/);
    assert.match(m[0], /VALID_TABS\.has\(/);
  });

  test('window.__vocabLanding test seam exposes showDashboard', () => {
    assert.match(src, /__vocabLanding\s*=\s*\{[\s\S]*?showDashboard/);
  });
});


// ─────────────────────────────────────────────────────────────────────
// Sprint 9.3 — flashcards stack cards adopt canonical .mode-card.
//
// Pre-Sprint-9.3, autoCard() / manualCard() emitted ad-hoc inner
// classes (.stack-icon / .stack-name / .stack-meta + corner pill
// .pill-auto / .pill-manual + 3D emoji icons). Sprint 9.3 promotes
// the markup to the canonical Sprint 9.1 .mode-card inner skeleton
// (.head > .icon + .arrow, h3, .lede) with Lucide outline icons and
// an inline .mode-card__badge for the "Tự động" indicator (auto
// stacks only; manual stacks remain unbadged). Visual consistency
// with the 6 surfaces already on .mode-card (3 vocab dashboards + 3
// speaking dashboards / home / exercises drills) is the goal.
// ─────────────────────────────────────────────────────────────────────

describe('Sprint 9.3 — flashcards stack cards render canonical .mode-card', () => {
  let src;
  before(() => {
    src = readFileSync(path.join(REPO_ROOT, 'frontend/js/vocab-modules/flashcards.js'), 'utf8');
  });

  test('autoCard() emits the canonical .mode-card head + h3 + lede skeleton', () => {
    const fn = src.match(/function\s+autoCard\s*\(\s*s\s*\)\s*\{[\s\S]+?\n\s{2}\}/);
    assert.ok(fn, 'autoCard() must be extractable');
    assert.match(fn[0], /class="mode-card[^"]*"/);
    assert.match(fn[0], /<div class="head">/);
    assert.match(fn[0], /<div class="icon"><i data-lucide="\$\{iconName\}"><\/i><\/div>/);
    assert.match(fn[0], /<span class="arrow"[^>]*>→<\/span>/);
    assert.match(fn[0], /<h3>/);
    assert.match(fn[0], /<span class="mode-card__badge">Tự động<\/span>/);
    assert.match(fn[0], /<p class="lede">\$\{s\.card_count\} thẻ<\/p>/);
  });

  test('autoCard() maps stack ids to Lucide icon names (library / sparkles / target)', () => {
    const fn = src.match(/function\s+autoCard\s*\(\s*s\s*\)\s*\{[\s\S]+?\n\s{2}\}/);
    assert.ok(fn, 'autoCard() must be extractable');
    assert.match(fn[0], /['"`]auto:all_vocab['"`]\s*\?\s*['"`]library['"`]/);
    assert.match(fn[0], /['"`]auto:recent['"`]\s*\?\s*['"`]sparkles['"`]/);
    assert.match(fn[0], /:\s*['"`]target['"`]/);
    // Negative: no emoji icons remain in the autoCard template.
    assert.ok(
      !/📚|🆕|🎯/.test(fn[0]),
      'autoCard() must no longer ship 3D emoji icons (Sprint 9.3 replaced with Lucide outlines)',
    );
  });

  test('manualCard() emits the canonical .mode-card skeleton with folder Lucide icon', () => {
    const fn = src.match(/function\s+manualCard\s*\(\s*s\s*\)\s*\{[\s\S]+?\n\s{2}\}/);
    assert.ok(fn, 'manualCard() must be extractable');
    assert.match(fn[0], /class="mode-card[^"]*"/);
    assert.match(fn[0], /<div class="head">/);
    assert.match(fn[0], /<i data-lucide="folder"><\/i>/);
    assert.match(fn[0], /<span class="arrow"[^>]*>→<\/span>/);
    assert.match(fn[0], /<p class="lede">\$\{s\.card_count\} thẻ<\/p>/);
    // Negative: no 📂 emoji + no .mode-card__badge (manual stacks are
    // identified by the ABSENCE of the "Tự động" badge).
    assert.ok(!/📂/.test(fn[0]), 'manualCard() must drop the 📂 emoji (Sprint 9.3 Lucide migration)');
    assert.ok(
      !/mode-card__badge/.test(fn[0]),
      'manualCard() must NOT emit .mode-card__badge — manual stacks are unbadged by design',
    );
  });

  test('legacy .stack-icon / .stack-name / .stack-meta / .pill-* classes are gone from the module', () => {
    for (const cls of ['stack-icon', 'stack-name', 'stack-meta', 'pill-auto', 'pill-manual']) {
      assert.ok(
        !new RegExp(`class="[^"]*\\b${cls}\\b`).test(src),
        `Sprint 9.3 retired class="${cls}" from flashcards.js — canonical .mode-card inner skeleton owns this slot`,
      );
    }
  });

  test('setFcContainerHtml re-hydrates Lucide icons after innerHTML swap', () => {
    const fn = src.match(/function\s+setFcContainerHtml\s*\([^)]*\)\s*\{[\s\S]+?\n\s{2}\}/);
    assert.ok(fn, 'setFcContainerHtml() must be extractable');
    assert.match(fn[0], /window\.lucide\.createIcons\(\)/);
  });
});


describe('Sprint 9.3 — .mode-card__badge primitive lives in components.css', () => {
  let componentsCSS;
  let flashcardsCSS;
  before(() => {
    componentsCSS = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'), 'utf8');
    flashcardsCSS = readFileSync(path.join(REPO_ROOT, 'frontend/css/flashcards.css'), 'utf8');
  });

  test('.mode-card__badge rule declared with --av-info family styling', () => {
    const block = componentsCSS.match(/\.mode-card__badge\s*\{([\s\S]+?)\}/);
    assert.ok(block, 'components.css must declare .mode-card__badge');
    assert.match(block[1], /background:\s*var\(--av-info-soft\)/);
    assert.match(block[1], /color:\s*var\(--av-info\)/);
    assert.match(block[1], /border-radius:\s*var\(--av-radius-pill\)/);
  });

  test('.mode-card h3 keeps display:flex (Sprint 9.1) and gains flex-wrap:wrap (Sprint 9.3)', () => {
    // .mode-card h3 spans two blocks now (Sprint 9.1 base + 9.3 flex-wrap)
    assert.match(componentsCSS, /\.mode-card\s+h3\s*\{[\s\S]+?display:\s*flex/);
    assert.match(componentsCSS, /\.mode-card\s+h3\s*\{\s*flex-wrap:\s*wrap/);
  });

  test('flashcards.css no longer declares the legacy stack inner classes', () => {
    for (const cls of ['.stack-icon', '.stack-name', '.stack-meta', '.pill-auto', '.pill-manual']) {
      const re = new RegExp(`^\\${cls}\\s*[\\s,{:]`, 'm');
      assert.ok(
        !re.test(flashcardsCSS),
        `flashcards.css must NOT redeclare ${cls} — Sprint 9.3 retired it in favor of the canonical .mode-card skeleton`,
      );
    }
  });

  test('flashcards.css keeps .delete-btn (manual-stack-specific overlay)', () => {
    // The delete-btn remains a flashcards-specific concern (no other
    // mode-card surface needs a hover-revealed removal control).
    assert.match(flashcardsCSS, /^\.delete-btn\s*\{/m);
  });
});


// ─────────────────────────────────────────────────────────────────────
// Sprint 10.1.5 — Needs Review tab (capture re-architecture).
//
// Sprint 6.0 archived source_type='needs_review' from persistence
// because surfacing it in the main vocab bank encouraged learners to
// memorise wrong forms. Sprint 10.1.5 reverses that archival —
// needs_review items ARE useful as a "learning from mistakes"
// surface, just not in the same bucket as the items the learner used
// correctly. The implementation routes them to a dedicated Needs
// Review tab in vocabulary.html via a 4th vocab-module sibling
// (alongside my-vocab / flashcards / exercises) and adds a 5th
// mode-card on the dashboard.
// ─────────────────────────────────────────────────────────────────────

describe('Sprint 10.1.5 — needs-review.js module contract', () => {
  let src;
  before(() => {
    src = readFileSync(path.join(REPO_ROOT, 'frontend/js/vocab-modules/needs-review.js'), 'utf8');
  });

  test('exports async mount(container, opts) → { unmount }', () => {
    assert.match(src, /export\s+async\s+function\s+mount\s*\(\s*container\s*,/);
    assert.match(src, /function\s+unmount\s*\(\s*\)/);
  });

  test('mount() respects guardMount + reads opts.embedded', () => {
    assert.match(src, /guardMount\s*\(\s*container\s*\)/);
    assert.match(src, /alreadyMounted/);
    assert.match(src, /\{\s*embedded\s*=\s*false\s*\}\s*=\s*opts/);
  });

  test('HTML template ships the canonical .subpage-header with Vocabulary back-link (Sprint 9.2 pattern)', () => {
    assert.match(src, /<header class="subpage-header/);
    assert.match(src, /class="subpage-header__back"[^>]*data-action="back-to-dashboard"[^>]*aria-label="Quay về dashboard Vocabulary"/);
    assert.match(src, /<i\s+data-lucide="arrow-left"[^>]*><\/i>\s*<span>Vocabulary<\/span>/);
    assert.match(src, /<h1[^>]*class="[^"]*\bsubpage-header__title\b[^"]*"[^>]*>\s*Needs Review\s*<\/h1>/);
  });

  test('Needs Review card layout ships original → suggestion + context + feedback + 2 actions', () => {
    // Sprint 10.4.1-hotfix — module emits the canonical .vocab-card
    // family (declared in my-vocabulary.css) rather than bespoke
    // .nr-card* primitives. Pin the new class skeleton + the action-
    // button data-action values.
    assert.match(src, /class="vocab-card"/);
    assert.match(src, /class="source-badge badge-needs_review"/);
    assert.match(src, /class="vocab-action vocab-action--fixed"/);
    assert.match(src, /class="vocab-action vocab-action--skip"/);
    // Original (strikethrough) + suggestion arrow pattern still pinned.
    assert.match(src, /<s>\$\{esc\(original\)\}<\/s>/);
    assert.match(src, /data-lucide="arrow-right"/);
    assert.match(src, /data-action="mark-fixed"/);
    assert.match(src, /data-action="dismiss"/);
  });

  test('module wires the 3 required data-action values', () => {
    // back-to-dashboard (Sprint 9.2) + mark-fixed (promote → main bank
    // as manual) + dismiss (soft-delete via DELETE endpoint).
    for (const action of ['back-to-dashboard', 'mark-fixed', 'dismiss']) {
      assert.ok(
        src.includes(`'${action}'`) || src.includes(`"${action}"`),
        `module must reference data-action="${action}" in its switch`,
      );
    }
  });

  test('module hits the dedicated /needs-review backend endpoint on load', () => {
    assert.match(src, /\/api\/vocabulary\/bank\/needs-review/);
  });

  test('mark-fixed action posts to the /mark-fixed promote endpoint', () => {
    // The pre-Sprint-10.1.5 endpoint was already wired for the main-
    // bank triage flow (POST /api/vocabulary/bank/{id}/mark-fixed).
    // Sprint 10.1.5 reuses it from the needs-review surface — the
    // server-side semantic (flip source_type='needs_review' → 'manual')
    // is exactly what we want.
    assert.match(src, /\/\$\{vocabId\}\/mark-fixed/);
  });

  test('dismiss action posts to the DELETE soft-delete endpoint', () => {
    assert.match(src, /method:\s*['"]DELETE['"]/);
  });

  test('HTML template body must not contain backticks (Sprint 9.1.1-hotfix sentinel)', () => {
    const match = src.match(/const HTML\s*=\s*\/\*\s*html\s*\*\/\s*`([\s\S]*?)\n`;/);
    assert.ok(match, 'needs-review.js must have a HTML template literal');
    assert.ok(
      !match[1].includes('`'),
      'needs-review.js HTML template body must not contain backticks (Sprint 9.1.1-hotfix backtick-in-template-literal sentinel)',
    );
  });
});


describe('Sprint 10.1.5 — vocabulary.html exposes the Needs Review surface', () => {
  let html;
  before(() => {
    html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/vocabulary.html'), 'utf8');
  });

  test('5th mode card on the dashboard wires data-mode="needs-review" with the alert-circle icon', () => {
    assert.match(
      html,
      /<a[^>]*\bclass="mode-card"[^>]*\bdata-mode="needs-review"[^>]*\baria-label="Mở Needs Review"/,
      'vocabulary.html must ship the Sprint 10.1.5 Needs Review mode card',
    );
    // Card body — Lucide icon + canonical .head + .arrow + h3 + .lede.
    const block = html.match(/data-mode="needs-review"[\s\S]{0,400}<\/a>/);
    assert.ok(block, 'Needs Review mode-card body must be extractable');
    assert.match(block[0], /<i\s+data-lucide="alert-circle"[^>]*><\/i>/);
    assert.match(block[0], /<h3>\s*Needs Review\s*<\/h3>/);
  });

  test('panel-needs-review section + tab-mount container are present', () => {
    assert.match(
      html,
      /<section[^>]*class="tab-panel"[^>]*data-panel="needs-review"[^>]*id="panel-needs-review"[^>]*hidden/,
      'vocabulary.html must ship the panel-needs-review tab-panel (hidden by default)',
    );
    assert.match(
      html,
      /<div[^>]*class="tab-mount"[^>]*id="mount-needs-review"/,
      'vocabulary.html must ship the mount-needs-review tab-mount container',
    );
  });

  test('needs-review.css stylesheet is linked', () => {
    assert.match(
      html,
      /<link[^>]*rel="stylesheet"[^>]*href="\/css\/needs-review\.css"/,
      'vocabulary.html must link /css/needs-review.css',
    );
  });
});


describe('Sprint 10.1.5 — vocab-landing.js wires needs-review into VALID_TABS + TAB_LOADERS', () => {
  let src;
  before(() => {
    src = readFileSync(path.join(REPO_ROOT, 'frontend/js/vocab-landing.js'), 'utf8');
  });

  test('TAB_LOADERS registers needs-review dynamic-import', () => {
    assert.match(
      src,
      /['"]needs-review['"]\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]\/js\/vocab-modules\/needs-review\.js['"]\s*\)/,
      'vocab-landing.js must wire needs-review into TAB_LOADERS',
    );
  });

  test('VALID_TABS Set lists needs-review', () => {
    // Match across the new Set([...]) literal — needs-review must
    // appear alongside the other 4 entries.
    const m = src.match(/VALID_TABS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
    assert.ok(m, 'VALID_TABS Set literal must be extractable');
    assert.match(m[1], /['"]needs-review['"]/);
    assert.match(m[1], /['"]my-vocab['"]/);
    assert.match(m[1], /['"]flashcards['"]/);
    assert.match(m[1], /['"]exercises['"]/);
    assert.match(m[1], /['"]topic-bank['"]/);
  });
});
