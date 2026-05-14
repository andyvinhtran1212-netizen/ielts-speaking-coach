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
 *   - Cat A pages (profile, writing-dashboard, my-vocabulary, flashcards,
 *     exercises) ship a Tailwind wrapper with pt-16/pt-20 to compensate
 *     for the absent .shell top padding.
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


// ── Foundation: components.css canonical reference still intact ───

describe('Sprint 6.18 foundation — components.css canonical .shell + .topnav untouched', () => {
  let components;
  before(() => {
    components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
  });

  test('.shell carries canonical padding (24px 32px 96px)', () => {
    assert.match(
      components,
      /\.shell\s*\{[\s\S]{0,400}padding:\s*var\(--av-space-6\)\s+var\(--av-space-8\)\s+var\(--av-space-24\)/,
    );
  });

  test('.topnav carries canonical margin-bottom (64px)', () => {
    assert.match(
      components,
      /\.topnav\s*\{[\s\S]{0,400}margin-bottom:\s*var\(--av-space-16\)/,
    );
  });
});


// ── Cat A — Tailwind wrapper top compensation (5 pages) ──────────

describe('Sprint 6.18 Cat A — wrapper top compensation present', () => {
  // Sprint 7.3 — my-vocabulary.html dropped from this roster. Its shell
  // <main id="mount"> is now the module mount container; the
  // pt-20 pb-6 wrapper lives inside the my-vocab.js template literal.
  // Sentinel for the in-module wrapper lives below in the Sprint 7.3
  // section of this file.
  const CAT_A = [
    { rel: 'frontend/pages/profile.html',           pattern: /<main[^>]*\bpt-16\b[^>]*\bpb-10\b/ },
    { rel: 'frontend/pages/writing-dashboard.html', pattern: /<main[^>]*\bpt-20\b[^>]*\bpb-6\b/ },
    { rel: 'frontend/pages/flashcards.html',        pattern: /<main[^>]*\bpt-20\b[^>]*\bpb-8\b/ },
    { rel: 'frontend/pages/exercises.html',         pattern: /<main[^>]*\bpt-20\b[^>]*\bpb-8\b/ },
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


// ── Cat F — speaking .main-tab-nav + onboarding <main> ──────────

describe('Sprint 6.18 Cat F — flex-layout pages canonical', () => {
  test('speaking.css .main-tab-nav ships margin-bottom: var(--av-chrome-bottom-margin)', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/speaking.css'),
      'utf8',
    );
    assert.match(
      css,
      /\.main-tab-nav\s*\{[\s\S]{0,600}margin-bottom:\s*var\(--av-chrome-bottom-margin\)/,
      'speaking.css .main-tab-nav must carry margin-bottom: var(--av-chrome-bottom-margin) per Sprint 6.18 Cat F',
    );
  });

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

  // Sprint 7.12: 5 skill landings migrated to <aver-chrome> Web Component —
  // their <nav class="topnav"> markup lives inside the component's Shadow
  // DOM, not the page HTML. Accept either the inline canonical nav (Sprint
  // 6.18 contract) OR the <aver-chrome> custom element (Sprint 7.12+).
  const MIGRATED_TO_AVER_CHROME = new Set([
    'frontend/pages/home.html',
    'frontend/pages/writing-dashboard.html',
    'frontend/pages/speaking.html',
    'frontend/grammar.html',
    'frontend/pages/vocabulary.html',
  ]);

  ROSTER.forEach((rel) => {
    test(`${rel} carries canonical .topnav or <aver-chrome> (Sprint 6.18 pre-req)`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      if (MIGRATED_TO_AVER_CHROME.has(rel)) {
        assert.match(
          html,
          /<aver-chrome\s+active=/,
          `${rel} migrated to <aver-chrome> (Sprint 7.12) — chrome lives in shadow root`,
        );
      } else {
        assert.match(
          html,
          /<nav[^>]*class=["'][^"']*\btopnav\b/,
          `${rel} must ship canonical <nav class="topnav"> — Sprint 6.18 spacing contract presumes canonical chrome`,
        );
      }
    });
  });
});


// ── Sprint 7.3 — my-vocab module owns its own page-body spacing ───

describe('Sprint 7.3 — my-vocab module template preserves Sprint 6.18 Cat A wrapper padding', () => {
  // The my-vocab.js module template ships the same pt-20 pb-6 wrapper
  // that lived in the standalone HTML pre-7.3. The Cat A sentinel
  // above dropped my-vocabulary.html from its roster because the
  // shell only carries <main id="mount">; this pin protects the
  // in-module wrapper instead.
  test('my-vocab.js template ships <main class="...pt-20 pb-6"> wrapper', () => {
    const src = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/vocab-modules/my-vocab.js'),
      'utf8',
    );
    assert.match(
      src,
      /<main[^>]*\bpt-20\b[^>]*\bpb-6\b/,
      'my-vocab module template must preserve the Sprint 6.18 pt-20 pb-6 wrapper',
    );
  });
});
