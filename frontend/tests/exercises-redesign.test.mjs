/**
 * frontend/tests/exercises-redesign.test.mjs — Sprint 6.11b
 * (Phase 3 page 4).
 *
 * Run with: node --test frontend/tests/exercises-redesign.test.mjs
 *
 * Pins the Sprint 6.11b surgical migration of /pages/exercises.html
 * (Phase D Wave 2 drill hub). Inline feature-flag gating script
 * preserved byte-identical (D1 / Flashcards / D3 default-deny logic
 * lives in the inline <script> at the bottom of the page).
 *
 * Sprint 6.0.1 IIFE preserved; canonical anti-flash IIFE follows.
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

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/exercises.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/exercises.css'),    'utf8');
});


describe('exercises.html / foundation links', () => {
  test('links tokens.css before components.css before exercises.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const p = html.indexOf('css/exercises.css');
    assert.ok(t > -1 && c > -1 && p > -1);
    assert.ok(t < c && c < p);
  });

  test('still links embedded-mode.css (Sprint 6.0.1)', () => {
    assert.match(html, /css\/embedded-mode\.css/);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono, drops Inter', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('links Lucide CDN', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('no inline <style> block', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0);
  });
});


describe('exercises.html / IIFE order', () => {
  test('Sprint 6.0.1 IIFE present and runs before any stylesheet', () => {
    const iifeIdx  = html.search(/<!-- Sprint 6\.0\.1/);
    const firstCss = html.search(/<link[^>]+stylesheet/);
    assert.ok(iifeIdx > -1 && firstCss > -1);
    assert.ok(iifeIdx < firstCss);
  });

  test('canonical anti-flash IIFE runs after Sprint 6.0.1 IIFE', () => {
    const embeddedIdx = html.search(/<!-- Sprint 6\.0\.1/);
    const themeIdx    = html.search(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.ok(embeddedIdx < themeIdx);
  });

  test('canonical IIFE validates stored value', () => {
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
  });

  test('catch arm sets data-theme="light" last resort', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });
});


describe('exercises.html / JS-coupled selectors preserved', () => {
  const requiredIds = ['state-loading', 'state-disabled', 'state-error', 'hub',
                       'card-d1', 'card-flashcards', 'card-d3'];

  for (const id of requiredIds) {
    test(`id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }

  test('inline feature-flag gating script preserved (d1_enabled / d3_enabled / flashcard_enabled)', () => {
    assert.match(html, /d1_enabled\s*===\s*true/);
    assert.match(html, /d3_enabled\s*===\s*true/);
    assert.match(html, /flashcard_enabled\s*===\s*true/);
  });

  test('default-deny DOM removal preserved (parentNode.removeChild)', () => {
    assert.match(html, /parentNode\.removeChild\(card\)/);
  });

  test('GET /auth/me endpoint contract preserved', () => {
    assert.match(html, /\$\{BASE\}\/auth\/me/);
  });
});


describe('exercises.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas, no text-slate-100)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(!/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html));
    assert.ok(!/<body[^>]*class=["'][^"']*\btext-slate-100\b/.test(html));
  });

  test('header has theme toggle with canonical .icon-sun / .icon-moon', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift on the toggle', () => {
    for (const v of ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon']) {
      assert.ok(!html.includes(v));
    }
  });

  test('Sprint 6.17.1 — back-link replaced by canonical full-nav skill tabs', () => {
    // Legacy ex-back-link removed; canonical nav-links provide
    // skill navigation. The ex-context-bar now shows page title only.
    assert.match(html, /class=["']topnav["']/);
    assert.match(html, /href=["']\/pages\/vocabulary\.html["']\s+class=["']active["']/);
  });

  test('drill emoji preserved as functional microcopy (📝 📚 🎙️)', () => {
    assert.match(html, /📝/);
    assert.match(html, /📚/);
    assert.match(html, /🎙️/);
  });
});


describe('exercises.css / token discipline', () => {
  test('uses --av-* tokens', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 20, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0);
  });

  test('no hardcoded color: hex/white/black declarations', () => {
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) wrappers', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no av-space-5/7/9/10/11/13/14/15', () => {
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(forbidden, []);
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const total = (html.match(/--av-text-faint/g) || []).length + (css.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint ≤ 10, got ${total}`);
  });

  test('.ex-card + .ex-pill + .pill-live + .pill-soon all defined', () => {
    for (const sel of ['.ex-card', '.ex-pill', '.pill-live', '.pill-soon',
                       '.ex-card__title', '.ex-card__body', '.ex-card__cta']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing ${sel}`);
    }
  });
});


describe('exercises.html / inline color migration', () => {
  test('no inline style="color:#…" or "background:#…" in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });
});
