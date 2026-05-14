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


describe('vocabulary.html / Sprint 8.2 mode-card IA + module-mount contract', () => {
  // Sprint 8.2 — the ARIA tablist row (4 `#tab-{name}` buttons + their
  // `data-tab` attributes + `role="tab"` markup) was retired. Mode
  // entry now happens via `.mode-card[data-mode]` anchors on the
  // dashboard view. The 4 `#panel-{name}` panels + their
  // `role="tabpanel"` + the `data-panel` attributes are preserved —
  // activateTab() in /js/vocab-landing.js still owns the panel toggle
  // and module mount.
  const requiredPanelIds = ['panel-my-vocab', 'panel-flashcards', 'panel-exercises', 'panel-topic-bank'];
  const requiredDataPanels = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'];
  const retiredTabIds = ['tab-my-vocab', 'tab-flashcards', 'tab-exercises', 'tab-topic-bank'];

  for (const id of retiredTabIds) {
    test(`tab id="${id}" must NOT exist (Sprint 8.2 retired the tab row)`, () => {
      assert.ok(
        !new RegExp(`id=["']${id}["']`).test(html),
        `#${id} should be absent — Sprint 8.2 replaced the tab buttons with .mode-card[data-mode] anchors`,
      );
    });
  }
  for (const id of requiredPanelIds) {
    test(`panel id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }
  for (const dataPanel of requiredDataPanels) {
    test(`data-panel="${dataPanel}" present`, () => {
      assert.match(html, new RegExp(`data-panel=["']${dataPanel}["']`));
    });
  }

  // Sprint 8.2 — mode-card markup contract.
  for (const mode of requiredDataPanels) {
    test(`mode-card[data-mode="${mode}"] present (Sprint 8.2 entry surface)`, () => {
      assert.match(
        html,
        new RegExp(`<a[^>]*class="[^"]*\\bmode-card\\b[^"]*"[^>]*data-mode="${mode}"`),
        `.mode-card[data-mode="${mode}"] anchor must exist on the dashboard view`,
      );
    });
  }

  test('.vocab-modes section + "Bắt đầu học từ vựng" heading present (Phase B Q3)', () => {
    assert.match(
      html,
      /<section[^>]*class="[^"]*\bvocab-modes\b[^"]*"[^>]*aria-labelledby="modes-heading"/,
      '.vocab-modes section must carry aria-labelledby="modes-heading"',
    );
    assert.match(
      html,
      /<h2[^>]*id="modes-heading"[^>]*>\s*Bắt đầu học từ vựng\s*<\/h2>/,
      'section heading must read "Bắt đầu học từ vựng" (Phase B Andy decision)',
    );
    assert.match(
      html,
      /<div[^>]*class="[^"]*\bmodes-grid\b/,
      '.modes-grid wrapper must exist',
    );
  });

  test('Topic Bank card carries the "Soon" lock-tag badge (Phase B Q2)', () => {
    assert.match(
      html,
      /data-mode="topic-bank"[\s\S]{0,500}<span[^>]*class="[^"]*\block-tag\b[^"]*"[^>]*>Soon<\/span>/,
      'Topic Bank mode-card must carry <span class="lock-tag">Soon</span>',
    );
  });

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

  test('role="tabpanel" preserved on 4 panels; role="tab" + aria-selected retired (Sprint 8.2)', () => {
    const tabsWithRole    = (html.match(/role=["']tab["']/g) || []).length;
    const panelsWithRole  = (html.match(/role=["']tabpanel["']/g) || []).length;
    const ariaSelected    = (html.match(/aria-selected=/g) || []).length;
    assert.equal(tabsWithRole,   0, 'role="tab" must be absent (Sprint 8.2 retired the tablist row)');
    assert.equal(panelsWithRole, 4, 'role="tabpanel" stays on all 4 panels');
    assert.equal(ariaSelected,   0, 'aria-selected must be absent (no tab buttons left)');
  });

  test('all 4 panels start hidden — dashboard view is the default landing state (Sprint 8.2)', () => {
    // Every <section.tab-panel> ships the `hidden` attribute on page
    // load; activateTab() reveals the target via panel.hidden = false.
    for (const dataPanel of requiredDataPanels) {
      assert.match(
        html,
        new RegExp(`<section[^>]*data-panel=["']${dataPanel}["'][^>]*hidden`),
        `<section[data-panel="${dataPanel}"]> must start hidden — dashboard is default`,
      );
    }
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


describe('vocabulary.html / mode-card microcopy (Sprint 8.2)', () => {
  // Sprint 8.2 — the tab-row's emoji icons (📚 🔄 ✏︎ ✸) + Vietnamese
  // labels were retired alongside the row itself. Mode-cards use
  // Lucide icons (book-open / layers / dumbbell / landmark) and
  // English-cased titles (My Vocabulary / Flashcards / Exercises /
  // Topic Bank). The leaner Vietnamese subtitles live in `.lede`.

  test('mode-cards use Lucide icons (book-open / layers / dumbbell / landmark)', () => {
    const section = html.match(/<section[^>]*class="[^"]*\bvocab-modes\b[\s\S]+?<\/section>/);
    assert.ok(section, '.vocab-modes section must exist');
    for (const icon of ['book-open', 'layers', 'dumbbell', 'landmark']) {
      assert.match(
        section[0],
        new RegExp(`<i[^>]*data-lucide=["']${icon}["']`),
        `mode-card must carry <i data-lucide="${icon}">`,
      );
    }
    // Legacy tab-icon emoji must NOT appear inside the modes section.
    for (const glyph of ['📚', '🔄', '✏︎', '✸']) {
      assert.ok(
        !section[0].includes(glyph),
        `mode-card section still contains "${glyph}" — Sprint 8.2 swapped to Lucide`,
      );
    }
  });

  test('mode-card titles preserved (English-cased per Phase B Q1)', () => {
    assert.match(html, /<h3[^>]*>\s*My Vocabulary\s*<\/h3>/);
    assert.match(html, /<h3[^>]*>\s*Flashcards\s*<\/h3>/);
    assert.match(html, /<h3[^>]*>\s*Exercises\s*<\/h3>/);
    // Topic Bank h3 wraps the lock-tag badge — use a non-greedy match.
    assert.match(html, /<h3[^>]*>\s*Topic Bank\s*<span[^>]*class="[^"]*\block-tag\b/);
  });

  test('mode-card lede subtitles present (Phase B Q1 leaner copy)', () => {
    assert.match(html, /Sổ tay từ vựng cá nhân của bạn\./);
    assert.match(html, /Học từ với hệ thống lặp khoảng cách\./);
    assert.match(html, /Luyện tập đa dạng dạng bài\./);
    assert.match(html, /Khám phá từ vựng theo chủ đề\./);
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
