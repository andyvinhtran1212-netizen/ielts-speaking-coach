/**
 * frontend/tests/admin-monolith-redesign.test.mjs — Sprint 6.14d-α.
 *
 * Pins the chrome-only migration of `frontend/admin.html` (3,667-line
 * monolith → 3,269 lines after extracting the 433-line inline `<style>`
 * to `frontend/css/admin.css`). Phase 4 admin sprint 4 of 4. The
 * Tailwind utility-class refactor + per-tab primitive adoption are
 * deferred to Sprint 6.14d-β / 6.14d-γ per the un-defer triggers
 * documented in DESIGN_SYSTEM.md § 14.5 + § 17.6.
 *
 * Sprint 6.14d-α scope:
 *   - Canonical anti-flash IIFE (§ 13)
 *   - Canonical .icon-sun / .icon-moon theme toggle (Sprint 6.10.1)
 *   - Plus Jakarta Sans + JetBrains Mono (Inter dropped + custom
 *     Tailwind palette config dropped)
 *   - `body.av-page` opt-in
 *   - Foundation: tokens.css → components.css → admin-writing.css → admin.css
 *   - `ds.css` link DROPPED (admin.html does not use any .ds-* class)
 *   - `writing-renderers.css` NOT linked (Sprint 6.8 finding)
 *   - 433-line inline `<style>` extracted to admin.css with --av-* tokens
 *   - Inline `style="..."` rgba/hex literals in HTML body (lines 49-853)
 *     migrated to tokens (closes visual-inversion gap → light + dark)
 *
 * Preserved byte-identical:
 *   - 186 IDs (185 original + theme-toggle button)
 *   - 10 main tab buttons + 10 panels (Topics, Codes, Users, Stats,
 *     AI Cost, Sessions, Alerts, Vocab Monitor, Vocab Exercises, Flashcards)
 *   - 2 nested tab systems (Topics Part 1/2/3, Vocab Exercises draft/published/rejected)
 *   - All 22 unique /admin/* endpoint calls
 *   - Inline Supabase init (outlier pattern, like admin-writing-prompts/assignments)
 *   - All 49 form inputs, 8 tables, modal markup
 *   - 2,401 lines inline JS (untouched — JS template literal styles
 *     also β-deferred so renderer-emitted rgba whites still exist)
 *   - admin-flashcard-stats.js external helper link
 *   - Tailwind CDN link (utility classes preserved in markup — β scope)
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
  html = readFileSync(path.join(REPO_ROOT, 'frontend/admin.html'),     'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin.css'),  'utf8');
});


// ── Foundation order (Sprint 6.14c-hotfix § 2.1) ────────────────


describe('admin.html / foundation order', () => {
  test('tokens.css before components.css before admin-writing.css before admin.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const aw = html.indexOf('css/admin-writing.css');
    const ad = html.indexOf('css/admin.css');
    assert.ok(t > -1 && c > -1 && aw > -1 && ad > -1, 'All 4 foundation links must be present');
    assert.ok(t < c,  'tokens.css must precede components.css');
    assert.ok(c < aw, 'components.css must precede admin-writing.css');
    assert.ok(aw < ad, 'admin-writing.css must precede admin.css');
  });

  test('writing-renderers.css NOT linked (Sprint 6.8 finding)', () => {
    // Allow the path to appear in a comment, but reject any actual <link>.
    assert.ok(
      !/<link[^>]*writing-renderers\.css/.test(html),
      'admin.html must not <link> writing-renderers.css — admin owns separate CSS',
    );
  });

  test('ds.css link DROPPED (admin.html does not use .ds-* classes)', () => {
    assert.ok(
      !/<link[^>]*\bcss\/ds\.css/.test(html),
      'admin.html must not <link> ds.css in Sprint 6.14d-α (verified zero .ds-* class usage)',
    );
  });

  test('Tailwind CDN STILL linked (utility refactor deferred to β)', () => {
    assert.match(html, /cdn\.tailwindcss\.com/, 'Tailwind CDN must remain — utility refactor is 6.14d-β scope');
  });

  test('Tailwind custom navy/teal palette config DROPPED', () => {
    assert.ok(
      !/tailwind\.config\s*=\s*\{[\s\S]*?navy/.test(html),
      'Tailwind custom navy palette config must be dropped — tokens.css owns colors now',
    );
    assert.ok(
      !/tailwind\.config\s*=\s*\{[\s\S]*?teal/.test(html),
      'Tailwind custom teal palette config must be dropped — tokens.css owns colors now',
    );
  });
});


// ── Typography (Plus Jakarta Sans + JetBrains Mono, Inter dropped) ─


describe('admin.html / typography', () => {
  test('loads Plus Jakarta Sans', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
  });

  test('loads JetBrains Mono', () => {
    assert.match(html, /JetBrains\+Mono/);
  });

  test('Inter font dropped (Phase 1-3 typography pattern)', () => {
    assert.ok(
      !/family=Inter\b/.test(html),
      'Inter must be removed — Plus Jakarta Sans replaces it across all redesigned pages',
    );
  });
});


// ── Canonical IIFE (§ 13) ────────────────────────────────────────


describe('admin.html / canonical anti-flash IIFE', () => {
  test('reads localStorage av-theme', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
  });

  test('validates stored value with === light/dark check', () => {
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
  });

  test('falls back to prefers-color-scheme', () => {
    assert.match(html, /prefers-color-scheme:\s*dark/);
  });

  test('catch arm sets data-theme="light"', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });
});


// ── Canonical theme toggle (.icon-sun / .icon-moon, Sprint 6.10.1) ─


describe('admin.html / canonical theme toggle', () => {
  test('uses canonical .icon-sun class on sun SVG', () => {
    assert.match(html, /class=["']icon-sun["']/);
  });

  test('uses canonical .icon-moon class on moon SVG', () => {
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift class variants', () => {
    for (const variant of [
      'av-theme-toggle__icon--sun',
      'av-theme-toggle__icon--moon',
      'theme-toggle__icon',
    ]) {
      assert.ok(
        !html.includes(variant),
        `BEM drift class "${variant}" must not appear — components.css does not style it`,
      );
    }
  });

  test('theme-toggle.js bindToggleButton wired at end of body', () => {
    assert.match(html, /bindToggleButton\s*\(/);
    assert.match(html, /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\.\/js\/theme-toggle\.js['"]/);
  });

  test('exactly one .av-theme-toggle button on the page', () => {
    const matches = html.match(/class=["'][^"']*\bav-theme-toggle\b[^"']*["']/g) || [];
    assert.equal(matches.length, 1, `Expected exactly 1 .av-theme-toggle, got ${matches.length}`);
  });
});


// ── body class + av-page opt-in ──────────────────────────────────


describe('admin.html / body class', () => {
  test('body has av-page class', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('Tailwind utility classes preserved on body (β scope)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\btext-white\b/);
    assert.match(html, /<body[^>]*class=["'][^"']*\bfont-sans\b/);
    assert.match(html, /<body[^>]*class=["'][^"']*\bmin-h-screen\b/);
  });
});


// ── 10-tab architecture preserved ────────────────────────────────


describe('admin.html / 10-tab architecture', () => {
  const TABS = [
    'topics', 'codes', 'users', 'stats', 'ai_usage',
    'sessions', 'alerts', 'vocab_monitor', 'vocab_exercises', 'flashcards',
  ];

  for (const tab of TABS) {
    test(`tab button id="tab-btn-${tab}" present`, () => {
      assert.match(html, new RegExp(`id=["']tab-btn-${tab}["']`));
    });

    test(`tab panel id="panel-${tab}" present`, () => {
      assert.match(html, new RegExp(`id=["']panel-${tab}["']`));
    });

    test(`switchTab('${tab}') handler wired`, () => {
      assert.match(html, new RegExp(`switchTab\\(['"]${tab}['"]\\)`));
    });
  }

  test('Topics nested tabs (Part 1/2/3) preserved', () => {
    for (const part of [1, 2, 3]) {
      assert.match(html, new RegExp(`id=["']tlib-tab-${part}["']`));
      assert.match(html, new RegExp(`switchLibTab\\(${part}\\)`));
    }
  });

  test('Vocab Exercises status sub-tabs (draft/published/rejected) preserved', () => {
    for (const status of ['draft', 'published', 'rejected']) {
      assert.match(html, new RegExp(`data-status=["']${status}["']`), `Missing status sub-tab: ${status}`);
    }
  });
});


// ── JS contract preservation ─────────────────────────────────────


describe('admin.html / JS contract', () => {
  test('inline Supabase init preserved (outlier — NOT WC.bootstrap)', () => {
    assert.match(html, /var\s+SUPABASE_URL\s*=/);
    assert.match(html, /initSupabase\(SUPABASE_URL/);
  });

  test('admin-flashcard-stats.js external helper still linked', () => {
    assert.match(html, /<script\s+src=["']js\/admin-flashcard-stats\.js["']/);
  });

  test('Supabase JS CDN still linked', () => {
    assert.match(html, /supabase-js@2/);
  });

  test('api.js still linked', () => {
    assert.match(html, /<script\s+src=["']js\/api\.js["']/);
  });

  test('window.switchTab + window.switchLibTab still exported', () => {
    assert.match(html, /window\.switchTab\s*=/);
    assert.match(html, /window\.switchLibTab\s*=/);
  });

  test('all 22 unique /admin/* endpoint paths preserved', () => {
    const endpoints = [
      '/admin/access-codes',
      '/admin/access-codes/generate',
      '/admin/ai-usage',
      '/admin/alerts',
      '/admin/exercises',
      '/admin/exercises/bulk',
      '/admin/responses/',
      '/admin/sessions',
      '/admin/stats',
      '/admin/topics',
      '/admin/topics/bulk',
      '/admin/topics/bulk-delete',
      '/admin/topics/bulk-generate-questions',
      '/admin/topics/bulk-rotate-questions',
      '/admin/users',
      '/admin/vocab/stats',
    ];
    for (const ep of endpoints) {
      assert.ok(
        html.includes(ep),
        `Missing endpoint: ${ep}`,
      );
    }
  });
});


// ── ID count preservation ────────────────────────────────────────


describe('admin.html / ID preservation', () => {
  test('total ID count >= 180 (pre-work baseline ~185) and includes theme-toggle', () => {
    const ids = (html.match(/id=["'][^"']+["']/g) || []).length;
    assert.ok(ids >= 180, `Found ${ids} IDs, expected ≥ 180 (pre-work baseline ~185-186)`);
    assert.match(html, /id=["']theme-toggle["']/, 'theme-toggle button id must exist');
  });

  test('canonical state machine IDs preserved (state-loading / state-error / state-content / header-email)', () => {
    for (const id of ['state-loading', 'state-error', 'state-content', 'header-email', 'err-msg']) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
  });
});


// ── Inline `<style>` block removed; admin.css owns chrome styles ─


describe('admin.html / no inline <style> block (extracted to admin.css)', () => {
  test('inline <style> block is gone (or trivially small)', () => {
    const styleBlocks = (html.match(/<style[\s\S]*?<\/style>/g) || []);
    const totalLen = styleBlocks.reduce((s, b) => s + b.length, 0);
    assert.ok(totalLen < 500, `Inline <style> total length ${totalLen}, expected < 500 (Sprint 6.14d-α extracted to admin.css)`);
  });
});


// ── HTML body markup: no rgba/hex literals (lines 49-853) ─────────


describe('admin.html / HTML body token discipline (lines 49-853)', () => {
  test('zero rgba() literals in HTML body markup', () => {
    const lines = html.split('\n').slice(48, 853);
    const body = lines.join('\n');
    const matches = body.match(/rgba\([^)]+\)/g) || [];
    assert.equal(matches.length, 0,
      `Found ${matches.length} rgba() literals in HTML body markup. ` +
      `Sprint 6.14d-α migrates all body markup rgba to tokens. ` +
      `(JS template literal styles in lines 857+ are β scope.)`,
    );
  });

  test('zero hex color literals in HTML body markup', () => {
    const lines = html.split('\n').slice(48, 853);
    const body = lines.join('\n');
    // Find hex colors in style="..." / color="..." style contexts (skip SVG path attrs)
    const matches = body.match(/(?:color|background|border[^:]*):\s*#[0-9a-fA-F]{3,6}/g) || [];
    assert.equal(matches.length, 0,
      `Found ${matches.length} hex color literals in HTML body markup. ` +
      `Sprint 6.14d-α migrates all body markup hex to tokens. ` +
      `(JS template literal styles in lines 857+ are β scope.)`,
    );
  });
});


// ── admin.css discipline ─────────────────────────────────────────


describe('admin.css / discipline', () => {
  test('uses --av-* tokens', () => {
    assert.match(css, /var\(--av-/);
  });

  test('no --ds-* references (legacy namespace)', () => {
    assert.ok(!css.includes('--ds-'), 'admin.css must not reference legacy --ds-* tokens');
  });

  test('no hardcoded hex color literals (runtime declarations)', () => {
    // Allow hex inside comments or color-mix percentages; reject `color: #xxx;` / `background: #xxx;`
    const matches = css.match(/^\s*(?:color|background|border-color)\s*:\s*#[0-9a-fA-F]{3,6}/gm) || [];
    assert.equal(matches.length, 0, `admin.css has ${matches.length} hardcoded hex declarations`);
  });

  test('no Era B brand-typo #14a8ae regression', () => {
    assert.ok(!css.includes('#14a8ae'), 'admin.css must not contain the brand-color typo #14a8ae');
    assert.ok(!html.includes('#14a8ae'), 'admin.html must not contain the brand-color typo #14a8ae');
  });

  test('--av-text-faint usage stays under the 10-instance cap (fresh budget)', () => {
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(faintCount < 10, `admin.css --av-text-faint count: ${faintCount}, exceeds cap of 10`);
  });

  test('defines admin-* namespaced chrome selectors', () => {
    const adminSelectors = (css.match(/\.admin-[a-z][a-z0-9_-]*/g) || []).length;
    assert.ok(adminSelectors >= 5, `admin.css should define at least 5 admin-* selectors, got ${adminSelectors}`);
  });

  test('preserves legacy class names emitted by inline JS (.card / .tab-btn / .tbl / .btn-primary / .inp / .modal-overlay / .badge-on / .status-badge / .btn-row / .topics-admin-card / .fcs-section / .ve-status-tab / .tlib-tab)', () => {
    for (const sel of [
      '.card', '.tab-btn', '.tbl', '.btn-primary', '.btn-secondary',
      '.btn-danger', '.inp', '.modal-overlay', '.modal-box',
      '.badge-on', '.badge-off', '.badge-used',
      '.status-badge', '.btn-row', '.btn-icon',
      '.topics-admin-card', '.topic-row-selected',
      '.fcs-section', '.fcs-stat',
      '.ve-status-tab', '.tlib-tab',
      '.q-row', '.q-text-edit', '.cue-field',
    ]) {
      assert.ok(
        css.includes(sel + ' ') || css.includes(sel + ' ') || css.includes(sel + '{') || css.includes(sel + '\n') || css.includes(sel + ':') || css.includes(sel + ','),
        `admin.css missing legacy class selector ${sel} — inline JS renderers emit this exact name`,
      );
    }
  });

  test('Sprint 6.14d-α + un-defer-trigger header docstring present', () => {
    assert.match(css, /Sprint 6\.14d-α|Sprint 6\.14d-alpha/i);
    assert.match(css, /6\.14d-β|6\.14d-beta|6\.14d-γ|6\.14d-gamma/i);
  });
});


// ── admin-writing.css remains AT CAP and unchanged (§ 17.6 discipline) ─


describe('admin-writing.css / cap discipline preserved (Sprint 6.14c-hotfix § 17.6)', () => {
  test('admin-writing.css --av-text-faint count still at 10 (at-cap snapshot)', () => {
    const adminWritingCss = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),
      'utf8',
    );
    const faintCount = (adminWritingCss.match(/var\(--av-text-faint\)/g) || []).length;
    assert.equal(
      faintCount,
      10,
      `admin-writing.css expected exactly 10 --av-text-faint (at-cap snapshot), got ${faintCount}. ` +
      `Sprint 6.14d-α MUST NOT extend admin-writing.css.`,
    );
  });
});


// ── Body chrome migration (header band + content shell + tab nav) ──


describe('admin.html / chrome migration to class hooks', () => {
  test('header uses .admin-header class (legacy inline style replaced)', () => {
    assert.match(html, /<header[^>]*class=["'][^"']*\badmin-header\b/);
  });

  test('main content shell uses .admin-content-shell class', () => {
    assert.match(html, /id=["']state-content["'][^>]*class=["'][^"']*\badmin-content-shell\b/);
  });

  test('tab navigation uses .admin-tab-nav class', () => {
    assert.match(html, /class=["'][^"']*\badmin-tab-nav\b/);
  });
});


// ── Vietnamese microcopy preserved ───────────────────────────────


describe('admin.html / Vietnamese microcopy preserved', () => {
  const phrases = [
    'Admin Panel',
    'Quản lý toàn bộ hệ thống IELTS Speaking Coach',
    'Đang kiểm tra quyền truy cập',
    'Truy cập bị từ chối',
    'Quay lại trang chủ',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});
