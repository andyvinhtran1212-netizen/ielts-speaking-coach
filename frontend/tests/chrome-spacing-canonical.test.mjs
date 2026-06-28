/**
 * frontend/tests/chrome-spacing-canonical.test.mjs
 *
 * Sprint 6.18 — canonical chrome spacing sentinel.
 *
 * Pins the vertical spacing contract for the 18 canonical-chrome pages:
 *
 *   - tokens.css declares the 4 new canonical spacing tokens:
 *     --av-chrome-top-padding, --av-chrome-bottom-margin,
 *     --av-chrome-to-content-single, --av-secondary-nav-height
 *
 *   - components.css `.shell` preserves the canonical
 *     padding: var(--av-space-6) var(--av-space-8) var(--av-space-24)
 *
 *   - components.css `.topnav` preserves
 *     margin-bottom: var(--av-space-16) (64px)
 *
 *   - Cat A pages (profile) ship a Tailwind wrapper with pt-16/pt-20 to
 *     compensate for the absent .shell top padding. (writing-dashboard
 *     migrated onto the canonical .shell — pinned separately below.)
 *
 *   - Cat E secondary nav rules (.gw-subnav, .practice-header,
 *     .result-header, .ftr-header) ship margin-bottom referencing
 *     --av-chrome-bottom-margin.
 *
 *   - Cat F: speaking .main-tab-nav has margin-bottom canonical token.
 *     Onboarding <main> wrapper has pt-20.
 *
 * Sprint 6.19 (deferred) will pin horizontal alignment + subheading
 * patterns; this file is vertical-only.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── Foundation: tokens.css declares the 4 canonical spacing tokens ──

describe('Sprint 6.18 foundation — tokens.css declares canonical chrome spacing', () => {
  let tokens;
  before(() => {
    tokens = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/tokens.css'),
      'utf8',
    );
  });

  test('--av-chrome-top-padding declared (24px via --av-space-6)', () => {
    assert.match(
      tokens,
      /--av-chrome-top-padding\s*:\s*var\(--av-space-6\)/,
    );
  });

  test('--av-chrome-bottom-margin declared (64px via --av-space-16)', () => {
    assert.match(
      tokens,
      /--av-chrome-bottom-margin\s*:\s*var\(--av-space-16\)/,
    );
  });

  test('--av-chrome-to-content-single declared (88px)', () => {
    assert.match(
      tokens,
      /--av-chrome-to-content-single\s*:\s*88px/,
    );
  });

  test('--av-secondary-nav-height declared (48px)', () => {
    assert.match(
      tokens,
      /--av-secondary-nav-height\s*:\s*48px/,
    );
  });
});


// ── Foundation: canonical chrome-spacing source of truth ──────────
//
// Sprint 7.14 — `.topnav` rule moved out of components.css into
// <aver-chrome>'s shadow-root <style> block (frontend/js/components/
// aver-chrome.js). Components.css still owns the page-level `.shell`
// primitive. The 64px chrome-to-content rhythm is now pinned in
// aver-chrome.js where the live `.topnav` rule lives.

describe('Sprint 6.18 foundation — canonical .shell + .topnav margin-bottom untouched', () => {
  test('.shell carries canonical padding (24px 32px 96px) in components.css', () => {
    const components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
    assert.match(
      components,
      /\.shell\s*\{[\s\S]{0,400}padding:\s*var\(--av-space-6\)\s+var\(--av-space-8\)\s+var\(--av-space-24\)/,
    );
  });

  test('.topnav carries canonical margin-bottom (64px) inside aver-chrome.js shadow style', () => {
    const chromeJs = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/components/aver-chrome.js'),
      'utf8',
    );
    assert.match(
      chromeJs,
      /\.topnav\s*\{[\s\S]{0,400}margin-bottom:\s*var\(--av-space-16\)/,
      '<aver-chrome> shadow-root .topnav must carry margin-bottom: var(--av-space-16) (64px chrome-to-content rhythm)',
    );
  });
});


// ── Cat A — Tailwind wrapper top compensation (5 pages) ──────────

describe('Sprint 6.18 Cat A — wrapper top compensation present', () => {
  // Sprint 7.3 — my-vocabulary.html dropped from this roster. Its shell
  // <main id="mount"> is now the module mount container; the
  // pt-20 pb-6 wrapper lives inside the my-vocab.js template literal.
  // Sprint 7.4/7.5 — flashcards.html and exercises.html dropped from this
  // roster for the same reason. Their wrappers now live inside the
  // /js/vocab-modules/flashcards.js + exercises.js template literals.
  // Sentinels for the in-module wrappers live below in the Sprint 7.3/7.4
  // section of this file.
  // writing-dashboard.html migrated OFF this Tailwind wrapper onto the canonical
  // .shell (1180px) to match home / vocabulary / speaking — its .shell usage is
  // pinned in the describe block below, so it's no longer a Cat A page.
  const CAT_A = [
    { rel: 'frontend/pages/profile.html',           pattern: /<main[^>]*\bpt-16\b[^>]*\bpb-10\b/ },
  ];

  CAT_A.forEach(({ rel, pattern }) => {
    test(`${rel} <main> ships canonical wrapper top padding`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(html, pattern,
        `${rel}: <main> must ship pt-16/pt-20 Tailwind utility to compensate for absent .shell top padding`);
    });
  });

  // Defense in depth: the bare `py-N` shorthand must NOT appear on the
  // primary <main> wrapper for these pages. py-N collapses to symmetric
  // top/bottom and re-introduces the drift the canonical fix removed.
  CAT_A.forEach(({ rel }) => {
    test(`${rel} <main> does NOT regress to symmetric py-N shorthand`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Match the first <main ...> element only (page-primary wrapper).
      const firstMain = html.match(/<main\b[^>]*>/);
      assert.ok(firstMain, `${rel}: no <main> tag found`);
      assert.ok(
        !/\bpy-\d+\b/.test(firstMain[0]),
        `${rel}: primary <main> regressed to py-N shorthand — Sprint 6.18 mandates explicit pt-N + pb-N`,
      );
    });
  });
});


// ── writing-dashboard migrated to the canonical .shell (width parity) ──────

describe('writing-dashboard uses the canonical .shell wrapper (matches home/vocabulary)', () => {
  test('<main> is .shell, not the narrow Tailwind max-w-3xl wrapper', () => {
    const html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/writing-dashboard.html'), 'utf8');
    const firstMain = html.match(/<main\b[^>]*>/);
    assert.ok(firstMain, 'no <main> tag found');
    assert.match(firstMain[0], /class="[^"]*\bshell\b[^"]*"/,
      'writing-dashboard <main> must use .shell (1180px) to align width with home/vocabulary');
    assert.ok(!/\bmax-w-3xl\b/.test(firstMain[0]),
      'writing-dashboard <main> must NOT use the 768px max-w-3xl wrapper anymore');
  });
});


// ── Cat B — writing-result main.result-content top padding ──────

describe('Sprint 6.18 Cat B — writing-result.css main.result-content top padding canonical', () => {
  test('main.result-content uses --av-space-20 (80px) top padding to clear sticky tabs', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/writing-result.css'),
      'utf8',
    );
    assert.match(
      css,
      /main\.result-content\s*\{[\s\S]{0,400}padding:\s*var\(--av-space-20\)/,
      'writing-result.css main.result-content must carry top padding --av-space-20 (Sprint 6.18 Cat B fix)',
    );
  });
});


// ── Cat E — secondary nav margin-bottom uses canonical token ─────

describe('Sprint 6.18 Cat E — secondary nav rules use --av-chrome-bottom-margin', () => {
  const CAT_E = [
    { file: 'frontend/css/grammar-wiki.css',     selector: '.gw-subnav' },
    { file: 'frontend/css/practice.css',         selector: '.practice-header' },
    { file: 'frontend/css/result.css',           selector: '.result-header' },
    { file: 'frontend/css/full-test-result.css', selector: '.ftr-header' },
  ];

  CAT_E.forEach(({ file, selector }) => {
    test(`${file} — ${selector} ships margin-bottom: var(--av-chrome-bottom-margin)`, () => {
      const css = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const escaped = selector.replace(/\./g, '\\.');
      const re = new RegExp(
        `${escaped}\\s*\\{[\\s\\S]{0,600}margin-bottom:\\s*var\\(--av-chrome-bottom-margin\\)`,
      );
      assert.match(css, re,
        `${file}: ${selector} must carry margin-bottom: var(--av-chrome-bottom-margin) per Sprint 6.18 Cat E`);
    });
  });
});


// ── Cat F — onboarding <main> + (retired Sprint 8.1) speaking .main-tab-nav ──

describe('Sprint 6.18 Cat F — flex-layout pages canonical', () => {
  // Sprint 8.1 — the `.main-tab-nav` margin-bottom pin in speaking.css
  // was retired alongside the tab row itself. speaking.html no longer
  // has a secondary nav between chrome and content; the canonical 64px
  // chrome-to-content rhythm is enforced entirely by the chrome
  // component's own bottom margin (.topnav { margin-bottom:
  // var(--av-space-16) } inside aver-chrome.js shadow style, pinned
  // by chrome-spacing-canonical's "foundation" describe block).

  test('onboarding.html primary <main> ships pt-20', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/onboarding.html'),
      'utf8',
    );
    const firstMain = html.match(/<main\b[^>]*>/);
    assert.ok(firstMain, 'onboarding.html: no <main> tag found');
    assert.match(
      firstMain[0],
      /\bpt-20\b/,
      'onboarding.html primary <main> must carry pt-20 per Sprint 6.18 Cat F',
    );
  });
});


// ── Roster coverage ─────────────────────────────────────────────

describe('Sprint 6.18 — 18 canonical-chrome-page roster intact', () => {
  // The 18 pages on the canonical chrome contract. Mirrors the roster
  // pinned in chrome-unification-canonical.test.mjs.
  const ROSTER = [
    'frontend/pages/home.html',
    'frontend/pages/vocabulary.html',
    'frontend/pages/profile.html',
    'frontend/pages/speaking.html',
    'frontend/pages/practice.html',
    'frontend/pages/result.html',
    'frontend/pages/full-test-result.html',
    'frontend/pages/writing-dashboard.html',
    'frontend/pages/writing-result.html',
    'frontend/onboarding.html',
    'frontend/pages/my-vocabulary.html',
    'frontend/pages/flashcards.html',
    'frontend/pages/exercises.html',
    'frontend/grammar.html',
    'frontend/pages/grammar-roadmap.html',
    'frontend/pages/grammar-search.html',
    'frontend/pages/grammar-compare.html',
    'frontend/pages/grammar-article.html',
  ];

  test('roster contains exactly 18 canonical-chrome pages', () => {
    assert.equal(ROSTER.length, 18,
      'Sprint 6.18 roster should mirror Sprint 6.17.2 cumulative 18-page chrome unification');
  });

  // Sprint 7.13 milestone: ALL 18 chrome pages migrated to <aver-chrome>.
  // Every page asserts the custom element; no inline <nav class="topnav">
  // remains. Sprint 7.14 retires components.css chrome rules next.
  ROSTER.forEach((rel) => {
    test(`${rel} carries <aver-chrome> (Sprint 7.13 milestone)`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(
        html,
        /<aver-chrome\s+active=/,
        `${rel}: must declare <aver-chrome> (chrome lives in shadow root post Sprint 7.13)`,
      );
    });
  });
});


// ── Sprint 7.3 — my-vocab module owns its own page-body spacing ───

describe('Sprint 7.3 — my-vocab module template preserves Sprint 6.18 Cat A wrapper padding', () => {
  // Sprint 9.1 — `pt-20 pb-6` tightened to `pt-4 pb-8` for the vocab
  // sub-pages. The pre-9.1 pt-20 compensated for the absence of
  // `.shell` top padding, but it stacked on top of the (now retired)
  // .{prefix}-header context bar to produce ~200px chrome→content.
  // Post-9.1 the shared .subpage-header primitive flows inside main;
  // chrome-to-content is ~108px, in line with sibling pages.
  // The my-vocab.js module template ships the canonical pt-4 pb-8 wrapper
  // that lived in the standalone HTML pre-7.3. The Cat A sentinel
  // above dropped my-vocabulary.html from its roster because the
  // shell only carries <main id="mount">; this pin protects the
  // in-module wrapper instead.
  test('my-vocab.js template ships <main class="...pt-4 pb-8"> wrapper (Sprint 9.1 tightened)', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/my-vocab.js'),
      'utf8',
    );
    assert.match(
      src,
      /<main[^>]*\bpt-4\b[^>]*\bpb-8\b/,
      'my-vocab module template must ship the Sprint 9.1 pt-4 pb-8 wrapper (chrome→content ~108px)',
    );
  });
});


// ── Sprint 7.4/7.5 — flashcards + exercises modules own their wrappers ─

describe('Sprint 7.4/7.5 — flashcards + exercises module templates preserve Cat A wrapper padding', () => {
  // Sprint 7.4 migrated flashcards.html and Sprint 7.5 migrated
  // exercises.html to the vocab-module pattern. Both standalone shells
  // now carry only <main id="mount"> + a module bootstrap script; the
  // Sprint 9.1 — pt-20 pb-8 tightened to pt-4 pb-8 alongside the
  // shared .subpage-header primitive lift (~108px chrome→content).
  const MODULES = [
    { rel: 'frontend/js/vocab-modules/flashcards.js', label: 'flashcards' },
    { rel: 'frontend/js/vocab-modules/exercises.js',  label: 'exercises'  },
  ];

  MODULES.forEach(({ rel, label }) => {
    test(`${rel} template ships <main class="...pt-4 pb-8"> wrapper (Sprint 9.1 tightened)`, () => {
      const src = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(
        src,
        /<main[^>]*\bpt-4\b[^>]*\bpb-8\b/,
        `${label} module template must ship the Sprint 9.1 pt-4 pb-8 wrapper`,
      );
    });
  });
});
