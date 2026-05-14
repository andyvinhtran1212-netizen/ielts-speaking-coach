/**
 * frontend/tests/vocabulary-redesign.test.mjs — Sprint 6.10
 * (Phase 3 page 1).
 *
 * Run with: node --test frontend/tests/vocabulary-redesign.test.mjs
 *
 * Pins the Sprint 6.10 SURGICAL migration of /pages/vocabulary.html.
 * The landing is the 4-tab iframe host introduced in Sprint 6.0 (PR
 * #115) and hardened in Sprint 6.0.1 (PR #116, embedded-mode hotfix).
 * DEBT-2026-05-09-B remains DEFERRED for this sprint — no un-defer
 * triggers fired during pre-work — so the iframe contract is
 * byte-identical and `vocab-landing.test.js` continues to pass.
 *
 * This file pins the redesign-specific contract (canonical IIFE, body
 * class, fonts, tokens), NOT the iframe + tab-switching behaviour
 * (which lives in vocab-landing.test.js).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


let html;
let css;

before(() => {
  html = readFileSync(
    path.join(__dirname, '..', 'pages', 'vocabulary.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'vocabulary.css'),
    'utf8',
  );
});


// ── Foundation links ──────────────────────────────────────────────


describe('vocabulary.html / foundation links', () => {
  test('links Aver tokens.css before components.css before vocabulary.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/vocabulary.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(pageIdx > -1, 'vocabulary.css must be linked');
    assert.ok(tokensIdx < componentsIdx, 'tokens before components');
    assert.ok(componentsIdx < pageIdx, 'components before vocabulary.css');
  });

  test('loads Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('drops legacy Fraunces / Manrope', () => {
    assert.ok(!/family=Fraunces/.test(html), 'Fraunces must be removed');
    assert.ok(!/family=Manrope/.test(html), 'Manrope must be removed');
  });

  test('links Lucide icons CDN (for chrome glyphs)', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('still loads Supabase CDN + api.js + vocab-landing.js (JS contract)', () => {
    assert.match(html, /@supabase\/supabase-js@2/);
    assert.match(html, /js\/api\.js/);
    assert.match(html, /js\/vocab-landing\.js/);
  });

  test('has no inline <style> block (all styling lives in vocabulary.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0, `Found ${blocks} inline <style> block(s)`);
  });
});


// ── Anti-flash IIFE (canonical pattern, AMBER #1) ─────────────────


describe('vocabulary.html / canonical anti-flash IIFE', () => {
  test('reads localStorage av-theme', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
  });

  test('validates stored value (no weak `stored ||` short-circuit)', () => {
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
    assert.ok(
      !/var\s+theme\s*=\s*stored\s*\|\|/.test(html),
      'Weak `var theme = stored ||` short-circuit must not appear',
    );
  });

  test('falls back to system preference', () => {
    assert.match(html, /prefers-color-scheme:\s*dark/);
  });

  test('wraps localStorage access in try/catch', () => {
    assert.match(
      html,
      /try\s*\{[\s\S]*?localStorage\.getItem[\s\S]*?\}\s*catch\s*\(/,
    );
  });

  test('catch arm sets data-theme="light" as last-resort fallback', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });

  test('exactly one localStorage.getItem("av-theme") call (the IIFE itself)', () => {
    const calls = (html.match(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/g) || []).length;
    assert.equal(calls, 1, `Expected exactly 1 av-theme read, got ${calls}`);
  });
});


// ── JS-coupled iframe contract preserved (DEBT-2026-05-09-B defer) ──


describe('vocabulary.html / Sprint 6.0 iframe contract preserved', () => {
  // The 4-tab iframe approach is deferred per DEBT-2026-05-09-B. Sprint
  // 6.10 pre-work confirmed no triggers fired; the contract stays.
  const requiredTabIds   = ['tab-my-vocab', 'tab-flashcards', 'tab-exercises', 'tab-topic-bank'];
  const requiredPanelIds = ['panel-my-vocab', 'panel-flashcards', 'panel-exercises', 'panel-topic-bank'];
  const requiredDataTabs   = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'];

  for (const id of requiredTabIds) {
    test(`tab id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }
  for (const id of requiredPanelIds) {
    test(`panel id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }
  for (const dataTab of requiredDataTabs) {
    test(`data-tab="${dataTab}" present`, () => {
      assert.match(html, new RegExp(`data-tab=["']${dataTab}["']`));
    });
  }

  // Sprint 7.3 — my-vocab tab migrated from <iframe> to ES-module mount
  // (DEBT-2026-05-09-B Phase 1). Sprint 7.4 — flashcards joined the
  // module path. Sprint 7.5 — exercises joined the module path. **All
  // 3 vocab children are now on the module path; zero iframes remain
  // in vocabulary.html.** Sprint 7.6 retires the legacy iframe branch
  // in vocab-landing.js + embedded-mode.css.
  test('zero iframes remain post Sprint 7.5 (all 3 vocab children migrated)', () => {
    const frameCount = (html.match(/<iframe\s+class=["']tab-frame["']/g) || []).length;
    assert.equal(frameCount, 0, `Expected 0 .tab-frame iframes after Sprint 7.5, got ${frameCount}`);
  });

  test('my-vocab tab uses module-mount container (Sprint 7.3)', () => {
    const myVocabSection = html.match(
      /<section[^>]*data-panel=["']my-vocab["'][^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(myVocabSection, 'my-vocab tab-panel section missing');
    assert.match(
      myVocabSection[0],
      /<div[^>]*class=["'][^"']*\btab-mount\b/,
      'my-vocab panel must ship <div class="tab-mount"> for module mount',
    );
    assert.ok(
      !/<iframe\b/.test(myVocabSection[0]),
      'my-vocab panel must NOT contain <iframe> after Sprint 7.3 module migration',
    );
  });

  test('flashcards tab uses module-mount container (Sprint 7.4)', () => {
    const flashcardsSection = html.match(
      /<section[^>]*data-panel=["']flashcards["'][^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(flashcardsSection, 'flashcards tab-panel section missing');
    assert.match(
      flashcardsSection[0],
      /<div[^>]*class=["'][^"']*\btab-mount\b/,
      'flashcards panel must ship <div class="tab-mount"> for module mount',
    );
    assert.ok(
      !/<iframe\b/.test(flashcardsSection[0]),
      'flashcards panel must NOT contain <iframe> after Sprint 7.4 module migration',
    );
  });

  test('exercises tab uses module-mount container (Sprint 7.5)', () => {
    const exercisesSection = html.match(
      /<section[^>]*data-panel=["']exercises["'][^>]*>[\s\S]+?<\/section>/,
    );
    assert.ok(exercisesSection, 'exercises tab-panel section missing');
    assert.match(
      exercisesSection[0],
      /<div[^>]*class=["'][^"']*\btab-mount\b/,
      'exercises panel must ship <div class="tab-mount"> for module mount',
    );
    assert.ok(
      !/<iframe\b/.test(exercisesSection[0]),
      'exercises panel must NOT contain <iframe> after Sprint 7.5 module migration',
    );
  });

  test('topic-bank panel has the static "coming soon" placeholder (no iframe)', () => {
    assert.match(
      html,
      /data-panel=["']topic-bank["'][\s\S]*?coming-soon/,
      'topic-bank panel must render the static coming-soon placeholder',
    );
  });

  test('no loading="lazy" / referrerpolicy attrs remain (Sprint 7.5 — iframes gone)', () => {
    const lazyCount = (html.match(/loading=["']lazy["']/g) || []).length;
    const refCount  = (html.match(/referrerpolicy=["']same-origin["']/g) || []).length;
    assert.equal(lazyCount, 0);
    assert.equal(refCount, 0);
  });

  test('three stat IDs preserved (vocab-landing.js reads by id)', () => {
    assert.match(html, /id=["']stat-words-count["']/);
    assert.match(html, /id=["']stat-flashcards-due["']/);
    assert.match(html, /id=["']stat-stacks-count["']/);
  });

  test('aria-controls + role="tab" + role="tabpanel" preserved', () => {
    const tabsWithRole    = (html.match(/role=["']tab["']/g) || []).length;
    const panelsWithRole  = (html.match(/role=["']tabpanel["']/g) || []).length;
    assert.equal(tabsWithRole, 4, 'expected 4 role="tab"');
    assert.equal(panelsWithRole, 4, 'expected 4 role="tabpanel"');
  });
});


// ── Body class + page chrome ──────────────────────────────────────


describe('vocabulary.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(
      !/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html),
      'ds-canvas must be removed in Sprint 6.10',
    );
  });

  test('Sprint 7.12 — chrome migrated to <aver-chrome active="vocabulary">', () => {
    // Sprint 6.10 / 6.17 contracts (theme toggle present, .icon-sun /
    // .icon-moon, Vocabulary tab marked active, 4 sibling skill links)
    // are now guaranteed by the <aver-chrome> Web Component contract +
    // active="vocabulary" attribute. Chrome markup lives inside the
    // component's shadow root. The chrome-unification-canonical suite
    // asserts the byte-equivalent template + active highlighting +
    // all 5 data-tab hrefs once for the component; this test verifies
    // the page consumes it.
    assert.match(html, /<aver-chrome\s+active="vocabulary"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
    // Inline chrome must be gone — markup ownership moved to shadow root.
    assert.equal(/class=["'][^"']*\bav-theme-toggle\b/.test(html), false);
  });
});


// ── Functional microcopy emoji preserved ─────────────────────────


describe('vocabulary.html / functional microcopy preserved', () => {
  // Sprint 6.7+ precedent: tab icons are functional microcopy and stay.
  // Only chrome glyphs swap to Lucide.
  test('tab icons preserve emoji (📚 🔄 ✏︎ ✸)', () => {
    assert.match(html, /📚/);
    assert.match(html, /🔄/);
    assert.match(html, /✏︎/);
    assert.match(html, /✸/);
  });

  test('Vietnamese tab labels preserved', () => {
    assert.match(html, /Từ vựng của tôi/);
    assert.match(html, /Flashcards/);
    assert.match(html, /Bài tập/);
    assert.match(html, /Kho theo chủ đề/);
  });
});


// ── Token discipline (CSS) ───────────────────────────────────────


describe('vocabulary.css / token discipline', () => {
  test('uses --av-* tokens (canonical namespace)', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    const dsRefs = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(avRefs > 30, `Expected many --av-* references, got ${avRefs}`);
    assert.equal(dsRefs, 0, `Found ${dsRefs} legacy --ds-* references — migrate them`);
  });

  test('no hardcoded color: hex/white/black declarations', () => {
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, [], `Hardcoded color declarations: ${bad.join(', ')}`);
  });

  test('no rgba(255, ...) wrappers (force-dark assumption removed)', () => {
    // Strip comments first — the migration history block may reference
    // the old rgba shape as documentation.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, [], 'rgba(255,255,255,…) must be replaced with tokens');
  });

  test('no hardcoded rgba(20, 184, 166, ...) teal wrappers', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*20\s*,\s*184\s*,\s*166/g) || [];
    assert.deepEqual(bad, [], 'rgba(20,184,166,…) must be --av-primary-soft');
  });

  test('--av-text-faint usage stays under the 10-instance auxiliary cap', () => {
    const htmlRefs = (html.match(/--av-text-faint/g) || []).length;
    const cssRefs  = (css.match(/--av-text-faint/g)  || []).length;
    const total = htmlRefs + cssRefs;
    assert.ok(
      total <= 10,
      `--av-text-faint must be auxiliary-only (≤10 refs), got ${total}`,
    );
  });

  test('no av-space-5 / 7 / 9 / 10 / 11 / 13 / 14 / 15 (4px grid skips)', () => {
    // UNIFIED_DESIGN_BRIEF.md § 5: spacing scale skips 5/7/9/10/11/13/14/15.
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(
      forbidden,
      [],
      `Forbidden av-space values used: ${forbidden.join(', ')}`,
    );
  });
});


// ── Sprint 6.10 / DEBT-2026-05-09-B status pin ───────────────────


describe('vocabulary.html / iframe seam documented', () => {
  test('CSS or HTML comment explains the parent/child theme seam', () => {
    // The seam (parent in active theme, iframe children locked to legacy
    // dark) is intentional and documented. Future contributors who edit
    // this page need to see why the children look different.
    const combined = html + css;
    assert.match(
      combined,
      /Sprint 6\.11|legacy dark|iframe contract|DEBT-2026-05-09-B/i,
      'Sprint 6.10 must document the iframe-child theme seam somewhere',
    );
  });
});
