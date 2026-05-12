/**
 * frontend/tests/my-vocabulary-redesign.test.mjs — Sprint 6.11a
 * (Phase 3 page 2).
 *
 * Run with: node --test frontend/tests/my-vocabulary-redesign.test.mjs
 *
 * Pins the Sprint 6.11a SURGICAL migration of /pages/my-vocabulary.html
 * (the Personal Vocab Bank, iframe child #1 of the unified vocabulary
 * landing). Preserves all JS-coupled selectors that `js/my-vocabulary.js`
 * targets: 5 states, 7 filter buttons + data-filter, 4 source badges,
 * 2 mastery pills, 8 vocab-action variants, 2 modals, manual add form,
 * stats bar with CSV/JSON exports, and the test seam `window._myVocab`.
 *
 * The Sprint 6.0.1 embedded-mode IIFE block is preserved byte-identical
 * (embedded-mode.test.js pins it across my-vocabulary / flashcards /
 * exercises). The canonical anti-flash IIFE runs *after* that block.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


let html;
let css;
let js;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/my-vocabulary.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/my-vocabulary.css'),    'utf8');
  js   = readFileSync(path.join(REPO_ROOT, 'frontend/js/my-vocabulary.js'),       'utf8');
});


// ── Foundation links ──────────────────────────────────────────────


describe('my-vocabulary.html / foundation links', () => {
  test('links Aver tokens.css before components.css before my-vocabulary.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/my-vocabulary.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(pageIdx > -1, 'my-vocabulary.css must be linked');
    assert.ok(tokensIdx < componentsIdx, 'tokens before components');
    assert.ok(componentsIdx < pageIdx, 'components before page CSS');
  });

  test('still links embedded-mode.css (Sprint 6.0.1)', () => {
    assert.match(html, /css\/embedded-mode\.css/);
  });

  test('still links ds.css for iframe-parent compatibility', () => {
    assert.match(html, /css\/ds\.css/);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('drops legacy Inter font', () => {
    assert.ok(!/family=Inter\b/.test(html), 'Inter must be removed');
  });

  test('links Lucide CDN for chrome glyphs', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('still loads Supabase + api.js + my-vocabulary.js (JS contract)', () => {
    assert.match(html, /@supabase\/supabase-js@2/);
    assert.match(html, /js\/api\.js/);
    assert.match(html, /js\/my-vocabulary\.js/);
  });

  test('no inline <style> block (all styling lives in my-vocabulary.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0, `Found ${blocks} inline <style> block(s)`);
  });
});


// ── Sprint 6.0.1 embedded-mode IIFE preserved byte-identical ──────


describe('my-vocabulary.html / Sprint 6.0.1 embedded-mode contract', () => {
  test('Sprint 6.0.1 comment + IIFE block present', () => {
    assert.match(
      html,
      /<!-- Sprint 6\.0\.1[\s\S]*?<script>([\s\S]*?)<\/script>/,
      'Sprint 6.0.1 embedded-mode IIFE block missing or comment changed',
    );
  });

  test('IIFE detects ?embedded=1 and toggles html.embedded-mode', () => {
    assert.match(html, /embedded.*===\s*['"]1['"]/);
    assert.match(html, /document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/);
  });

  test('embedded-mode IIFE runs in <head> before any stylesheet link', () => {
    const iifeIdx  = html.search(/<!-- Sprint 6\.0\.1/);
    const firstCss = html.search(/<link[^>]+stylesheet/);
    assert.ok(iifeIdx > -1, 'IIFE block not found');
    assert.ok(firstCss > -1, 'no stylesheet link found');
    assert.ok(
      iifeIdx < firstCss,
      'Sprint 6.0.1 IIFE must run before stylesheet linking (anti-flash-of-unhidden-chrome)',
    );
  });
});


// ── Canonical anti-flash IIFE (after Sprint 6.0.1) ────────────────


describe('my-vocabulary.html / canonical anti-flash theme bootstrap', () => {
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
      'weak `var theme = stored ||` short-circuit must not appear',
    );
  });

  test('falls back to system preference', () => {
    assert.match(html, /prefers-color-scheme:\s*dark/);
  });

  test('catch arm sets data-theme="light" as last-resort fallback', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });

  test('exactly one av-theme localStorage read (the canonical IIFE)', () => {
    const calls = (html.match(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/g) || []).length;
    assert.equal(calls, 1);
  });
});


// ── JS-coupled selector contract preserved ────────────────────────


describe('my-vocabulary.html / JS-coupled selectors preserved', () => {
  const stateIds = ['state-loading', 'state-disabled', 'state-error', 'state-empty'];
  const statsIds = ['stats-bar', 'stat-total', 'stat-learning', 'stat-mastered', 'btn-export-csv', 'btn-export-json'];
  const formIds  = ['add-form', 'add-headword', 'add-context', 'add-error'];
  const modalIds = ['fc-picker-modal', 'fc-picker-headword', 'fc-picker-list', 'fc-picker-new', 'report-modal', 'report-reason'];
  const listIds  = ['vocab-list', 'vocab-moved-banner'];

  for (const id of [...stateIds, ...statsIds, ...formIds, ...modalIds, ...listIds]) {
    test(`id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing required id="${id}"`);
    });
  }

  test('7 filter buttons with data-filter cover all states', () => {
    const filters = ['all', 'used_well', 'needs_review', 'upgrade_suggested', 'manual', 'learning', 'mastered'];
    for (const f of filters) {
      assert.match(
        html,
        new RegExp(`data-filter=["']${f}["']`),
        `Missing filter button data-filter="${f}"`,
      );
    }
  });

  test('onclick handlers preserved (toggleAddForm/submitAddWord/setFilter/closeFlashcardPicker/submitReport/closeReport)', () => {
    assert.match(html, /onclick=["']toggleAddForm\(\)["']/);
    assert.match(html, /onclick=["']submitAddWord\(\)["']/);
    assert.match(html, /onclick=["']setFilter\(/);
    assert.match(html, /onclick=["']closeFlashcardPicker\(\)["']/);
    assert.match(html, /onclick=["']submitReport\(\)["']/);
    assert.match(html, /onclick=["']closeReport\(\)["']/);
  });

  test('window._myVocab test seam still invoked from export buttons', () => {
    assert.match(html, /window\._myVocab\s*&&\s*window\._myVocab\.downloadCsv/);
    assert.match(html, /window\._myVocab\s*&&\s*window\._myVocab\.downloadJson/);
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('my-vocabulary.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(
      !/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html),
      'ds-canvas must be removed in Sprint 6.11a',
    );
  });

  test('header has theme toggle button', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
  });

  test('theme toggle uses canonical .icon-sun / .icon-moon classes (Sprint 6.10.1)', () => {
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift classes on the toggle', () => {
    const bem = ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon'];
    for (const v of bem) {
      assert.ok(!html.includes(v), `BEM drift "${v}" reappeared`);
    }
  });

  test('Sprint 6.17.1 — back-link replaced by canonical full-nav skill tabs', () => {
    assert.match(html, /class=["']topnav["']/);
    assert.match(html, /href=["']\/pages\/vocabulary\.html["']\s+class=["']active["']/);
  });

  test('header add-word button uses Lucide plus', () => {
    assert.match(html, /data-lucide=["']plus["']/);
  });
});


// ── Token discipline (CSS) ────────────────────────────────────────


describe('my-vocabulary.css / token discipline', () => {
  test('uses --av-* tokens (canonical namespace)', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    const dsRefs = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(avRefs > 50, `Expected many --av-* references, got ${avRefs}`);
    assert.equal(dsRefs, 0, `Legacy --ds-* references must be migrated, found ${dsRefs}`);
  });

  test('no hardcoded color: hex/white/black declarations', () => {
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, [], `Hardcoded color declarations: ${bad.join(', ')}`);
  });

  test('no rgba(255, ...) wrappers', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, [], 'rgba(255,255,255,…) must be replaced with tokens');
  });

  test('no av-space-5 / 7 / 9 / 10 / 11 / 13 / 14 / 15 (4px grid skips)', () => {
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(forbidden, [], `Forbidden av-space values: ${forbidden.join(', ')}`);
  });

  test('--av-text-faint usage stays under the 10-instance auxiliary cap', () => {
    const htmlRefs = (html.match(/--av-text-faint/g) || []).length;
    const cssRefs  = (css.match(/--av-text-faint/g)  || []).length;
    const total = htmlRefs + cssRefs;
    assert.ok(total <= 10, `--av-text-faint must be auxiliary-only (≤10), got ${total}`);
  });

  test('CTA buttons use --av-text-on-primary (Sprint 6.7.1)', () => {
    // The Save button is the primary CTA on the page; its text color must
    // route through --av-text-on-primary so dark theme flips to dark text.
    assert.match(
      css,
      /\.mv-save-btn[\s\S]{0,300}--av-text-on-primary/,
      'Primary "Save" CTA missing --av-text-on-primary text color',
    );
  });

  test('source badges, mastery pills, 8 vocab-action variants all defined', () => {
    const requiredClasses = [
      '.badge-used_well', '.badge-needs_review', '.badge-upgrade_suggested', '.badge-manual',
      '.mastery-learning', '.mastery-mastered',
      '.vocab-action--source', '.vocab-action--practice', '.vocab-action--preview',
      '.vocab-action--stack', '.vocab-action--accept', '.vocab-action--locked',
      '.vocab-action--fixed', '.vocab-action--skip',
    ];
    for (const sel of requiredClasses) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('flashToast palette classes (mv-toast--success/info/error) defined', () => {
    assert.match(css, /\.mv-toast--success/);
    assert.match(css, /\.mv-toast--info/);
    assert.match(css, /\.mv-toast--error/);
  });
});


// ── HTML migration: inline style attrs gone from static markup ────


describe('my-vocabulary.html / inline color migration', () => {
  test('no inline style="color:#..." or "background:#..." in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, [], `Inline style hex literals: ${bad.join(', ')}`);
  });

  test('no inline rgba(255,255,255,…) wrappers in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, [], 'rgba(255,255,255,…) must not appear in static markup');
  });
});


// ── JS template literal migration (Sprint 6.8 pattern) ────────────


describe('my-vocabulary.js / inline-style template literals migrated', () => {
  test('cardHtml emits class hooks (no inline style="color:rgba(...)")', () => {
    // Sprint 6.11a moved the cardHtml inline styles to class hooks so the
    // cascade can theme both light + dark. Confirm the class hooks land
    // and the literals don't.
    assert.match(js, /class=["'][^"']*\bmv-def-block\b/);
    assert.match(js, /class=["'][^"']*\bmv-def-vi\b/);
    assert.match(js, /class=["'][^"']*\bmv-upgrade-hint\b/);
    assert.match(js, /class=["'][^"']*\bmv-suggestion-hint\b/);
    assert.match(js, /class=["'][^"']*\bmv-context\b/);
    assert.match(js, /class=["'][^"']*\bmv-reason\b/);
  });

  test('cardHtml no longer emits literal rgba(255,...) or rgba(148,163,184) colors', () => {
    // Limit to the cardHtml region (between `function cardHtml` and the
    // next top-level function). The preview modal is intentionally out
    // of scope this sprint — Sprint 6.11b will migrate it alongside
    // flashcards.html which owns the same visual language.
    const cardHtmlRegion = js.match(/function cardHtml[\s\S]*?\n  \}\s*\n/);
    assert.ok(cardHtmlRegion, 'cardHtml function not found');
    const region = cardHtmlRegion[0];
    assert.ok(
      !/rgba\(255\s*,\s*255\s*,\s*255/.test(region),
      'cardHtml still emits rgba(255,255,255,…) literals',
    );
    assert.ok(
      !/rgba\(148\s*,\s*163\s*,\s*184/.test(region),
      'cardHtml still emits rgba(148,163,184,…) literals',
    );
  });

  test('flashToast palette migrated to mv-toast--* classes', () => {
    const toastFn = js.match(/function flashToast[\s\S]*?\n  \}\s*\n/);
    assert.ok(toastFn, 'flashToast function not found');
    const region = toastFn[0];
    assert.match(region, /mv-toast--\$\{variant\}/);
    assert.ok(
      !/background:\s*rgba\(20\s*,\s*184\s*,\s*166/.test(region),
      'flashToast still hardcodes the success rgba',
    );
  });

  test('window._myVocab seam preserved (downloadCsv/downloadJson/markFixed/skipVocab/previewFlashcard/acceptSuggestion)', () => {
    for (const k of ['downloadCsv', 'downloadJson', 'markFixed', 'skipVocab', 'previewFlashcard', 'acceptSuggestion']) {
      assert.match(js, new RegExp(`window\\._myVocab[\\s\\S]{0,2000}${k}`), `_myVocab.${k} no longer exposed`);
    }
  });
});


// ── Sprint 6.11b followup: preview modal documented as out-of-scope ──


describe('my-vocabulary.css / Sprint 6.11b followup documented', () => {
  test('CSS or JS comment notes that _renderPreviewModal stays legacy this sprint', () => {
    const combined = css + js;
    assert.match(
      combined,
      /Sprint 6\.11b|_renderPreviewModal|preview-flashcard modal|preview modal/i,
      'Sprint 6.11a must document the preview-modal seam (will migrate in 6.11b)',
    );
  });
});
