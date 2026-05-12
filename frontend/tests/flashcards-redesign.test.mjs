/**
 * frontend/tests/flashcards-redesign.test.mjs — Sprint 6.11b
 * (Phase 3 page 3).
 *
 * Run with: node --test frontend/tests/flashcards-redesign.test.mjs
 *
 * Pins the Sprint 6.11b surgical migration of /pages/flashcards.html
 * (Phase D Wave 2 stack-list page). All JS-coupled selectors preserved
 * byte-identical so `js/flashcards.js` continues to drive the page:
 * #fc-container, #fc-modal, .stack-card[data-stack-id], 4
 * chip[data-cat], modal field IDs, #fc-toast.
 *
 * The Sprint 6.0.1 embedded-mode IIFE block stays byte-identical
 * (embedded-mode.test.js pins it across my-vocabulary / flashcards /
 * exercises). Canonical anti-flash IIFE runs after it.
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
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/flashcards.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/flashcards.css'),    'utf8');
  js   = readFileSync(path.join(REPO_ROOT, 'frontend/js/flashcards.js'),       'utf8');
});


// ── Foundation links ──────────────────────────────────────────────


describe('flashcards.html / foundation links', () => {
  test('links tokens.css before components.css before flashcards.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/flashcards.css');
    assert.ok(tokensIdx > -1 && componentsIdx > -1 && pageIdx > -1);
    assert.ok(tokensIdx < componentsIdx);
    assert.ok(componentsIdx < pageIdx);
  });

  test('still links embedded-mode.css (Sprint 6.0.1)', () => {
    assert.match(html, /css\/embedded-mode\.css/);
  });

  test('still links ds.css for iframe-parent compatibility', () => {
    assert.match(html, /css\/ds\.css/);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono, drops Inter', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html), 'Inter must be removed');
  });

  test('links Lucide CDN', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('still loads Supabase + api.js + flashcards.js', () => {
    assert.match(html, /@supabase\/supabase-js@2/);
    assert.match(html, /js\/api\.js/);
    assert.match(html, /js\/flashcards\.js/);
  });

  test('no inline <style> block (all styling lives in flashcards.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0);
  });
});


// ── Sprint 6.0.1 IIFE preserved + canonical IIFE follows ─────────


describe('flashcards.html / IIFE order', () => {
  test('Sprint 6.0.1 comment + IIFE block present', () => {
    assert.match(html, /<!-- Sprint 6\.0\.1[\s\S]*?<script>/);
    assert.match(html, /embedded.*===\s*['"]1['"]/);
    assert.match(html, /document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/);
  });

  test('canonical anti-flash IIFE runs AFTER Sprint 6.0.1 IIFE', () => {
    const embeddedIdx = html.search(/<!-- Sprint 6\.0\.1/);
    const themeIdx    = html.search(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.ok(embeddedIdx > -1 && themeIdx > -1);
    assert.ok(embeddedIdx < themeIdx, 'Sprint 6.0.1 IIFE must run before the anti-flash IIFE');
  });

  test('canonical IIFE validates stored value (no weak `stored ||`)', () => {
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
    assert.ok(!/var\s+theme\s*=\s*stored\s*\|\|/.test(html));
  });

  test('catch arm sets data-theme="light" last resort', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });
});


// ── JS-coupled selectors preserved ────────────────────────────────


describe('flashcards.html / JS-coupled selectors preserved', () => {
  const requiredIds = [
    'fc-container', 'fc-modal', 'vocab-moved-banner',
    'm-name', 'm-topics', 'm-search', 'm-after', 'm-preview',
    'm-cancel', 'm-save', 'fc-toast',
  ];

  for (const id of requiredIds) {
    test(`id="${id}" present`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }

  test('4 chip[data-cat] options preserved', () => {
    for (const c of ['used_well', 'needs_review', 'upgrade_suggested', 'manual']) {
      assert.match(html, new RegExp(`data-cat=["']${c}["']`));
    }
  });

  test('modal-backdrop + modal-input + chip-group classes preserved', () => {
    assert.match(html, /class=["']modal-backdrop["']/);
    assert.match(html, /class=["']modal-input["']/);
    assert.match(html, /class=["']chip-group["']/);
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('flashcards.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas, no text-slate-100)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(!/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html));
    assert.ok(!/<body[^>]*class=["'][^"']*\btext-slate-100\b/.test(html));
  });

  test('header has theme toggle button with canonical .icon-sun / .icon-moon', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift on the toggle (Sprint 6.10.1)', () => {
    const drifts = ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon'];
    for (const v of drifts) assert.ok(!html.includes(v));
  });

  test('Sprint 6.17.1 — back-link replaced by canonical full-nav skill tabs', () => {
    assert.match(html, /class=["']topnav["']/);
    assert.match(html, /href=["']\/pages\/vocabulary\.html["']\s+class=["']active["']/);
  });

  test('functional microcopy preserved (📚 in title)', () => {
    assert.match(html, /📚 Flashcards/);
  });
});


// ── Token discipline (CSS) ────────────────────────────────────────


describe('flashcards.css / token discipline', () => {
  test('uses --av-* tokens', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 50, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0, 'Legacy --ds-* tokens must be migrated');
  });

  test('no hardcoded color: hex/white/black declarations', () => {
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255, ...) wrappers (force-dark assumption)', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no av-space-5/7/9/10/11/13/14/15 (4px-grid skips)', () => {
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(forbidden, []);
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const total = (html.match(/--av-text-faint/g) || []).length + (css.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint ≤ 10, got ${total}`);
  });

  test('btn-primary CTA routes through --av-text-on-primary (Sprint 6.7.1)', () => {
    assert.match(
      css,
      /\.btn-primary[\s\S]{0,400}--av-text-on-primary/,
      'Primary CTA missing --av-text-on-primary text color',
    );
  });

  test('all 4 modal/preview/chip/toast component class blocks defined', () => {
    for (const sel of ['.stack-card', '.pill-auto', '.pill-manual', '.delete-btn',
                       '.btn-primary', '.btn-secondary', '.btn-ghost',
                       '.modal-backdrop', '.chip', '.preview-box', '.toast']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });
});


// ── HTML migration: inline color literals gone ────────────────────


describe('flashcards.html / inline color migration', () => {
  test('no inline style="color:#…" or "background:#…" in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) literals in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });
});


// ── flashcards.js inline-style template literals migrated ─────────


describe('flashcards.js / preview error inline styles migrated to class hooks', () => {
  test('emits .fc-preview-error class instead of inline color:#fca5a5', () => {
    assert.match(js, /class=["']text-xs fc-preview-error["']/);
    assert.ok(
      !/style=["'][^"']*color:\s*#fca5a5/i.test(js),
      'flashcards.js still emits inline color:#fca5a5',
    );
  });

  test('preview-error class defined in flashcards.css', () => {
    assert.match(css, /\.fc-preview-error/);
  });
});
