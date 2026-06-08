/**
 * frontend/tests/full-test-result-redesign.test.mjs — Sprint 6.9
 * (Phase 2 closure — last of writing-dashboard / writing-result /
 * full-test-result).
 *
 * Run with: node --test frontend/tests/full-test-result-redesign.test.mjs
 *
 * Pins the Sprint 6.9 SURGICAL migration of /pages/full-test-result.html.
 * The page is a ~611-line full-mock-test summary (3 sessions in one
 * view) backed by ~346 lines of inline JS plus a Chart.js radar. The
 * redesign preserves every JS-coupled selector, onclick handler, and
 * URL contract (?p1=…&p2=…&p3=…) byte-identical.
 *
 * Sprint 6.9 also closes the last open A.1/A.2 question by implementing
 * the Chart.js theme-aware pattern from Sprint 6.4.1 (speaking dashboard):
 * tokens are resolved via getComputedStyle at draw time and the chart
 * re-renders on theme flip via a MutationObserver on <html data-theme>.
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
    path.join(__dirname, '..', 'pages', 'full-test-result.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'full-test-result.css'),
    'utf8',
  );
});


// ── Foundation links ──────────────────────────────────────────────


describe('full-test-result.html / foundation links', () => {
  test('links Aver tokens.css before components.css before full-test-result.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx = html.indexOf('css/full-test-result.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(pageIdx > -1, 'full-test-result.css must be linked');
    assert.ok(tokensIdx < componentsIdx, 'tokens.css must load before components.css');
    assert.ok(componentsIdx < pageIdx, 'components.css must load before full-test-result.css');
  });

  test('still links Chart.js CDN (radar chart depends on it)', () => {
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/chart\.js/);
  });

  test('still links Tailwind CDN (utility classes still used)', () => {
    assert.match(html, /cdn\.tailwindcss\.com/);
  });

  test('links Lucide icons (line glyphs replacing legacy SVGs)', () => {
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('drops legacy Manrope / Fraunces font links', () => {
    assert.ok(
      !/family=Manrope/.test(html),
      'Manrope must be removed in Sprint 6.9',
    );
    assert.ok(
      !/family=Fraunces/.test(html),
      'Fraunces must be removed in Sprint 6.9',
    );
  });

  test('drops the inline <style> block (now lives in full-test-result.css)', () => {
    const styleMatches = html.match(/<style[\s\S]*?<\/style>/g) || [];
    assert.equal(
      styleMatches.length,
      0,
      `Expected zero inline <style> blocks, found ${styleMatches.length}`,
    );
  });
});


// ── Anti-flash IIFE (canonical pattern, AMBER #1) ─────────────────


describe('full-test-result.html / canonical anti-flash IIFE', () => {
  test('reads localStorage av-theme', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
  });

  test('validates stored value (no weak `var theme = stored ||` short-circuit)', () => {
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
});


// ── JS-coupled IDs preserved ──────────────────────────────────────


describe('full-test-result.html / JS-coupled IDs preserved', () => {
  const required = [
    'state-loading', 'state-error', 'state-content', 'error-msg',
    'header-date', 'overall-band',
    'crit-fc', 'crit-lr', 'crit-gra', 'crit-p',
    'parts-grid', 'strengths-list', 'improvements-list',
    'grammar-section', 'grammar-list',
    'pron-accuracy', 'pron-fluency', 'pron-completeness',
    'pron-prosody', 'pron-overall',
    'pron-loading-badge', 'pron-radar', 'pron-radar-empty',
    'detail-links', 'pdf-btn',
  ];
  for (const id of required) {
    test(`id="${id}" present`, () => {
      const re = new RegExp(`id=["']${id}["']`);
      assert.match(html, re, `Required id="${id}" was removed`);
    });
  }

  test('preserves onclick="retake()" handler', () => {
    assert.match(html, /onclick=["']retake\(\)["']/);
  });

  test('preserves onclick="downloadPDFs(this)" handler', () => {
    assert.match(html, /onclick=["']downloadPDFs\(this\)["']/);
  });
});


// ── Body class + page chrome ──────────────────────────────────────


describe('full-test-result.html / body class + chrome', () => {
  test('body uses av-page font-sans (no ds-canvas)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b[^"']*["']/);
    assert.match(html, /<body[^>]*class=["'][^"']*\bfont-sans\b[^"']*["']/);
    assert.ok(
      !/<body[^>]*class=["'][^"']*\bds-canvas\b[^"']*["']/.test(html),
      'ds-canvas must be removed in Sprint 6.9 (Sprint 6.5.1 pattern)',
    );
  });

  test('back link uses Lucide chevron-left (not hand-rolled SVG)', () => {
    assert.match(html, /data-lucide=["']chevron-left["']/);
  });

  test('Sprint 7.13 — chrome migrated to <aver-chrome active="speaking">', () => {
    assert.match(html, /<aver-chrome\s+active="speaking"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
    assert.equal(/class=["'][^"']*\bav-theme-toggle\b/.test(html), false);
  });
});


// ── Action button icon swap (Lucide chrome) ──────────────────────


describe('full-test-result.html / Lucide chrome', () => {
  test('retake button uses lucide rotate-ccw', () => {
    assert.match(html, /data-lucide=["']rotate-ccw["']/);
  });

  test('PDF button uses lucide download', () => {
    assert.match(html, /data-lucide=["']download["']/);
  });

  test('error state uses lucide alert-triangle', () => {
    assert.match(html, /data-lucide=["']alert-triangle["']/);
  });
});


// ── Functional microcopy emoji preserved ─────────────────────────


describe('full-test-result.html / functional microcopy preserved', () => {
  // Sprint 6.7/6.8 lesson: tab/section indicator emoji are functional
  // microcopy and stay. Only chrome icons swap to Lucide.
  test('strengths eyebrow still says "✓ Điểm mạnh"', () => {
    assert.match(html, /✓ Điểm mạnh/);
  });
  test('improvements eyebrow still says "→ Cần cải thiện"', () => {
    assert.match(html, /→ Cần cải thiện/);
  });
});


// ── Token discipline (CSS) ───────────────────────────────────────


describe('full-test-result.css / token discipline', () => {
  test('uses --av-* tokens (canonical namespace)', () => {
    // Must reference more than one --av-* token — sanity check we're
    // not back on bare hex/rgba.
    const refs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(refs > 30, `Expected many --av-* references, got ${refs}`);
  });

  test('no hardcoded white / black / hex color: declarations', () => {
    // The single allowed literal in the .ftr-pill-icon block is a *token*
    // fallback, not a raw literal. Grep for non-token color: declarations.
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, [], `Hardcoded color declarations found: ${bad.join(', ')}`);
  });

  test('no rgba(255, ...) wrappers (force-dark assumption removed)', () => {
    // Strip /* … */ comments first — the migration history comment block
    // references the old rgba(255,…) shape as documentation.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(
      bad,
      [],
      `rgba(255,255,255,…) literals must be replaced with tokens`,
    );
  });

  test('ds.css overrides scoped under body.av-page', () => {
    assert.match(
      css,
      /body\.av-page\s+\.btn-secondary/,
      'btn-secondary override must be scoped under body.av-page (Sprint 6.5.1)',
    );
  });

  test('does NOT modify ds.css directly (Sprint 6.5.1 contract)', () => {
    // Sanity — the page CSS file must NOT contain a `.ds-*` redefinition
    // that isn't scoped under body.av-page.
    const dsLines = css.split('\n').filter(
      (l) => /\.ds-/.test(l) && !/body\.av-page/.test(l),
    );
    // Allow comments (lines starting with //, /*, or *) and selectors
    // that are continuations of a body.av-page chain.
    const violations = dsLines.filter(
      (l) => !/^\s*(\*|\/\*|\/\/)/.test(l) && !/body\.av-page/.test(l),
    );
    assert.deepEqual(
      violations,
      [],
      `ds.css redefinitions outside body.av-page scope: ${violations.join('\n')}`,
    );
  });
});


// ── HTML migration: inline style attrs gone ──────────────────────


describe('full-test-result.html / inline color migration', () => {
  test('no inline style="color:#... or background:#... in static markup', () => {
    // Static = anything outside <script>…</script>. We strip script
    // bodies and check the rest.
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const hexMatches = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(
      hexMatches,
      [],
      `Inline style hex literals remain in static markup: ${hexMatches.join(', ')}`,
    );
  });

  test('no inline style="...rgba(255,255,255..." in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const matches = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(matches, [], 'rgba(255,255,255,…) must not appear in static markup');
  });

  test('JS template literals no longer emit inline color hex', () => {
    // Inside renderPartCard / renderCritBar / strengths/improvements
    // mappers, hardcoded #14b8a6, #4ade80, etc. should be gone. The
    // Tailwind theme config still references the brand palette
    // (preserved across all redesigned pages — see result.html), so we
    // strip the tailwind.config <script> block before scanning.
    const stripped = html.replace(
      /<script>[\s\S]*?tailwind\.config[\s\S]*?<\/script>/,
      '',
    );
    const legacyHexInJs = [
      '#14b8a6', '#4ade80', '#fb923c', '#86efac', '#fdba74',
      '#38bdf8', '#a78bfa', '#f472b6', '#f97316', '#fbbf24',
    ];
    for (const hex of legacyHexInJs) {
      assert.ok(
        !stripped.includes(hex),
        `Legacy brand hex ${hex} still appears — replace with --av-* tokens`,
      );
    }
  });
});


// ── Chart.js A.2 theme-aware pattern ─────────────────────────────


describe('full-test-result.html / Chart.js A.2 theme-aware', () => {
  test('defines _tokenColor() helper that reads getComputedStyle', () => {
    assert.match(html, /function\s+_tokenColor/);
    assert.match(html, /getComputedStyle\(\s*document\.documentElement\s*\)/);
    assert.match(html, /getPropertyValue\(\s*name\s*\)/);
  });

  test('radar dataset colors are resolved from --av-* tokens (not hardcoded)', () => {
    // The legacy radar hardcoded `rgba(20,184,166,0.15)` + '#14b8a6' for
    // backgroundColor / borderColor. After the migration the colors come
    // from _tokenColor('--av-primary') etc.
    assert.match(html, /_tokenColor\(\s*['"]--av-primary['"]\s*\)/);
    assert.match(html, /_tokenColor\(\s*['"]--av-primary-soft['"]\s*\)/);
    assert.ok(
      !/backgroundColor:\s*['"]rgba\(20\s*,\s*184\s*,\s*166/.test(html),
      'Legacy hardcoded rgba(20,184,166,…) must be replaced with token-resolved color',
    );
    assert.ok(
      !/borderColor:\s*['"]#14b8a6['"]/.test(html),
      'Legacy hardcoded #14b8a6 must be replaced with token-resolved color',
    );
  });

  test('radar axes/grid/tooltip read tokens (not rgba(255,…)/literal hex)', () => {
    // The radar options block now sources scale + tooltip colors from
    // _tokenColor() — sanity check the helper is called inside the chart
    // config rather than literals.
    const tokenCalls = (html.match(/_tokenColor\(/g) || []).length;
    assert.ok(
      tokenCalls >= 6,
      `Expected ≥6 _tokenColor() calls in radar config, got ${tokenCalls}`,
    );
  });

  test('caches last payload so refresh works after theme flip', () => {
    assert.match(html, /_lastPronAvgs/);
    assert.match(html, /function\s+refreshPronChart/);
  });

  test('exposes refresh hook on window._fullTestResult', () => {
    assert.match(
      html,
      /window\._fullTestResult\s*=\s*\{\s*refreshPronChart/,
    );
  });

  test('MutationObserver watches [data-theme] and triggers refresh', () => {
    assert.match(html, /new\s+MutationObserver/);
    assert.match(
      html,
      /observe\(\s*html\s*,\s*\{\s*attributes:\s*true\s*,\s*attributeFilter:\s*\[\s*['"]data-theme['"]\s*\]/,
    );
    assert.match(html, /refreshPronChart\(\)/);
  });
});


// ── Contrast cap discipline (text-faint use ≤ 10 instances) ──────


describe('full-test-result.html + .css / contrast cap', () => {
  test('--av-text-faint usage stays under the 10-instance auxiliary cap', () => {
    const htmlRefs = (html.match(/--av-text-faint/g) || []).length;
    const cssRefs  = (css.match(/--av-text-faint/g)  || []).length;
    const total = htmlRefs + cssRefs;
    assert.ok(
      total <= 10,
      `--av-text-faint must be auxiliary-only (≤10 refs), got ${total}`,
    );
  });
});


// ── Smoke: still ships a single canonical IIFE bootstrap ─────────


describe('full-test-result.html / single bootstrap', () => {
  test('exactly one localStorage.getItem("av-theme") call (the IIFE)', () => {
    const calls = (html.match(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/g) || []).length;
    assert.equal(calls, 1, `Expected exactly 1 av-theme read (the IIFE), got ${calls}`);
  });
});
