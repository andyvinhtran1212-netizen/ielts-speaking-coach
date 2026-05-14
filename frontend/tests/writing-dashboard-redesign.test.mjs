/**
 * frontend/tests/writing-dashboard-redesign.test.mjs — Sprint 6.7.
 *
 * Run with: node --test frontend/tests/writing-dashboard-redesign.test.mjs
 *
 * Pins the Sprint 6.7 SURGICAL migration of /pages/writing-dashboard.html.
 * The page is a 1377-line teacher-assignment workflow backed by ~1060
 * lines of inline JS (no writing-dashboard.js file). The redesign
 * preserves every JS-coupled selector, class hook, data-attribute, and
 * pill map byte-identical — only fonts / tokens / anti-flash IIFE /
 * theme toggle / Lucide chrome icons swap.
 *
 * The spec described a self-directed Writing dashboard (Task 1/Task 2
 * cards + 4 stat strip + streak + continue-draft) — production is
 * actually a teacher-assignment workflow. These pins guard the
 * REAL production contract, not the hypothetical one.
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
    path.join(__dirname, '..', 'pages', 'writing-dashboard.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'writing-dashboard.css'),
    'utf8',
  );
});


// ── Foundation links ──────────────────────────────────────────────


describe('writing-dashboard.html / foundation links', () => {
  test('links Aver tokens.css before components.css before writing-dashboard.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx = html.indexOf('css/writing-dashboard.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(pageIdx > -1, 'writing-dashboard.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx && componentsIdx < pageIdx,
      'load order must be tokens → components → writing-dashboard for cascade resolution',
    );
  });

  test('keeps ds.css linked (compatibility layer per UNIFIED_DESIGN_BRIEF § 12)', () => {
    assert.match(html, /css\/ds\.css/);
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import Manrope or Fraunces', () => {
    assert.ok(!/family=Manrope/.test(html), 'Manrope was Sprint 6.2 — removed in 6.7 redesign');
    assert.ok(!/family=Fraunces/.test(html), 'Fraunces was Sprint 6.2 — removed in 6.7 redesign');
  });

  test('Tailwind config fontFamily.sans is Plus Jakarta Sans', () => {
    assert.match(
      html,
      /fontFamily\s*:\s*\{[\s\S]*?sans:\s*\[\s*'Plus Jakarta Sans'/,
    );
  });
});


// ── Theme support (Sprint 6.6.1 canonical IIFE) ───────────────────


describe('writing-dashboard.html / theme support', () => {
  test('uses the canonical anti-flash IIFE with validation (Sprint 6.6.1)', () => {
    const iifeIdx = html.search(/localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    const firstLinkIdx = html.search(/<link\s+rel="stylesheet"/);
    assert.ok(iifeIdx > -1, "IIFE must read localStorage 'av-theme'");
    assert.ok(firstLinkIdx > -1, 'page must link at least one stylesheet');
    assert.ok(
      iifeIdx < firstLinkIdx,
      'theme bootstrap IIFE must run BEFORE any stylesheet to prevent flash',
    );
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
      'IIFE must use the canonical (stored === "light" || stored === "dark") validation form',
    );
    assert.match(
      html,
      /prefers-color-scheme:\s*dark/,
      'IIFE must fall back to system preference when no stored theme',
    );
  });

  test('IIFE does NOT use the weak `var theme = stored ||` short-circuit', () => {
    const weakPattern = /var\s+theme\s*=\s*stored\s*\|\|/;
    assert.ok(
      !weakPattern.test(html),
      'IIFE uses the weak `var theme = stored ||` short-circuit. ' +
      'Replace with the canonical pattern (DESIGN_SYSTEM.md § 13).',
    );
  });

  test('IIFE does NOT hardcode data-theme="dark" (no force-dark, no DEBT)', () => {
    const forceDark = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/.test(html);
    assert.ok(
      !forceDark,
      'force-dark setAttribute must NOT exist — writing-dashboard supports both themes from Sprint 6.7',
    );
  });

  test('Sprint 7.12 — chrome migrated to <aver-chrome active="writing">', () => {
    assert.match(html, /<aver-chrome\s+active="writing"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('Sprint 7.12 — inline .av-theme-toggle + bindToggleButton import removed (moved into shadow root)', () => {
    assert.equal(/class="av-theme-toggle"/.test(html), false);
    assert.equal(
      /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\/js\/theme-toggle\.js['"]/.test(html),
      false,
    );
  });
});


// ── JS-coupled selectors (1060 lines of inline JS) ────────────────


describe('writing-dashboard.html / state container IDs', () => {
  test('top-level state container IDs preserved', () => {
    for (const id of ['loading', 'error', 'error-message', 'error-cta', 'content']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('greeting + student-meta IDs preserved', () => {
    for (const id of ['greeting-name', 'student-code', 'target-band', 'target-band-section']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('writing-permission preview banner ID preserved (Sprint 5.2 contract)', () => {
    assert.match(html, /id="writing-preview-banner"/);
  });

  test('Sprint 7.12 — logout moved into <aver-chrome> shadow root', () => {
    // Sprint 6.17.1 retired legacy #logout-btn in favor of #user-menu-logout
    // (inline in canonical chrome). Sprint 7.12 moves that markup into the
    // component's shadow root, so #user-menu-logout is no longer in page DOM.
    // Logout still works — the component owns the signOut() + redirect flow.
    assert.equal(/\bid="user-menu-logout"/.test(html), false);
    assert.ok(
      !/\bid="logout-btn"/.test(html),
      'legacy #logout-btn must remain removed (Sprint 6.17.1 contract)',
    );
  });
});


describe('writing-dashboard.html / 2-tab nav contract (Phase 2.3b)', () => {
  test('2 primary tabs preserved with their inline JS IDs', () => {
    for (const id of [
      'tab-assignments',
      'tab-essays',
      'assignments-count',
      'essays-count',
      'content-assignments',
      'content-essays',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('assignments list + empty-state IDs preserved', () => {
    for (const id of ['assignments-list', 'assignments-empty']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('essays list + empty-state IDs preserved', () => {
    for (const id of ['essays-list', 'empty-state', 'filter-empty-state']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });
});


describe('writing-dashboard.html / 4 status sub-filters (Sprint 2.5.5)', () => {
  test('all 4 filter buttons with data-filter attribute preserved', () => {
    for (const filter of ['all', 'delivered', 'pending', 'flagged']) {
      assert.match(
        html,
        new RegExp(`data-filter="${filter}"`),
        `filter button data-filter="${filter}" must remain — wireEssayFilterTabs() looks it up`,
      );
    }
  });

  test('4 filter-count span IDs preserved', () => {
    for (const filter of ['all', 'delivered', 'pending', 'flagged']) {
      assert.match(
        html,
        new RegExp(`id="filter-count-${filter}"`),
        `#filter-count-${filter} must remain — _updateFilterCounts() writes to it`,
      );
    }
  });
});


describe('writing-dashboard.html / 6-state essay pill (STATUS_CONFIG)', () => {
  test('STATUS_CONFIG map declares all 6 lifecycle states + submitted alias', () => {
    // The page's status pill render path looks up STATUS_CONFIG[e.status].
    // Drop a key here and a status flashes the unknown-state pill.
    const m = html.match(/var\s+STATUS_CONFIG\s*=\s*\{([\s\S]*?)\};/);
    assert.ok(m, 'STATUS_CONFIG declaration must exist in the inline IIFE');
    for (const key of ['pending', 'submitted', 'grading', 'graded', 'reviewed', 'delivered', 'failed']) {
      assert.match(m[1], new RegExp(`\\b${key}\\s*:`), `STATUS_CONFIG.${key} must remain`);
    }
  });

  test('TASK_LABELS map declares task1_academic, task1_general, task2', () => {
    const m = html.match(/var\s+TASK_LABELS\s*=\s*\{([\s\S]*?)\};/);
    assert.ok(m, 'TASK_LABELS declaration must exist in the inline IIFE');
    for (const key of ['task1_academic', 'task1_general', 'task2']) {
      assert.match(m[1], new RegExp(`\\b${key}\\s*:`), `TASK_LABELS.${key} must remain`);
    }
  });

  test('ASSIGNMENT_STATUS map declares all 5 workflow states', () => {
    const m = html.match(/var\s+ASSIGNMENT_STATUS\s*=\s*\{([\s\S]*?)\};/);
    assert.ok(m, 'ASSIGNMENT_STATUS declaration must exist in the inline IIFE');
    for (const key of ['pending', 'in_progress', 'submitted', 'graded', 'delivered']) {
      assert.match(m[1], new RegExp(`\\b${key}\\s*:`), `ASSIGNMENT_STATUS.${key} must remain`);
    }
  });

  test('ACTIVE_ASSIGNMENT_STATES preserves the filter set', () => {
    assert.match(
      html,
      /ACTIVE_ASSIGNMENT_STATES\s*=\s*\[\s*['"]pending['"]\s*,\s*['"]in_progress['"]\s*\]/,
    );
  });
});


// ── Submit modal (Sprint 2.6.1) ───────────────────────────────────


describe('writing-dashboard.html / submit modal IDs (Sprint 2.6.1)', () => {
  test('all submit-modal child IDs preserved', () => {
    for (const id of [
      'submit-modal',
      'modal-title',
      'modal-close',
      'modal-loading',
      'modal-content',
      'modal-timer',
      'modal-timer-total',
      'modal-timer-display',
      'modal-prompt-meta',
      'modal-prompt-title',
      'modal-prompt-image',
      'modal-prompt-text',
      'modal-instructions',
      'modal-instructions-text',
      'modal-file-input',
      'modal-upload-status',
      'modal-essay-textarea',
      'modal-word-counter',
      'modal-save-status',
      'modal-save-pending',
      'modal-btn-save',
      'modal-btn-submit',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('textarea anti-Grammarly attributes preserved', () => {
    // The page's defence against Grammarly/autocorrect leaking suggestions
    // into a timed exercise. Each attribute MUST stay or the contract breaks.
    const textarea = html.match(/<textarea[^>]*id="modal-essay-textarea"[^>]*>/);
    assert.ok(textarea, 'textarea#modal-essay-textarea must exist');
    for (const attr of [
      'spellcheck="false"',
      'autocorrect="off"',
      'autocapitalize="off"',
      'autocomplete="off"',
      'data-gramm="false"',
      'data-gramm_editor="false"',
      'data-enable-grammarly="false"',
    ]) {
      assert.ok(
        textarea[0].includes(attr),
        `textarea must keep ${attr} — Grammarly opt-out + autocorrect defence`,
      );
    }
  });
});


// ── Lucide icon swap (limited — chrome only) ──────────────────────


describe('writing-dashboard.html / Lucide icon swap', () => {
  test('Lucide CDN + hydration script present', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
    assert.match(html, /lucide\.createIcons/);
  });

  test('modal close button uses Lucide x (not ✕ emoji)', () => {
    const closeBtn = html.match(/<button[^>]*id="modal-close"[\s\S]*?<\/button>/);
    assert.ok(closeBtn, '#modal-close button must exist');
    assert.match(closeBtn[0], /data-lucide="x"/);
    assert.ok(
      !closeBtn[0].includes('✕'),
      'modal-close must not ship the legacy ✕ emoji',
    );
  });
});


// ── Body class + legacy chrome ────────────────────────────────────


describe('writing-dashboard.html / body class', () => {
  test('body opts into .av-page (Aver page surface)', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });

  test('body does NOT carry the legacy ds-canvas class', () => {
    assert.ok(
      !/<body[^>]*class="[^"]*\bds-canvas\b[^"]*"/.test(html),
      'writing-dashboard should drop ds-canvas — av-page + [data-theme] handle theming',
    );
  });
});


// ── Color migration / token discipline ────────────────────────────


describe('writing-dashboard.html / color migration', () => {
  test('zero live inline rgba(255,255,255,X) declarations remain', () => {
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const matches = stripped.match(/style="[^"]*rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.equal(
      matches.length,
      0,
      `expected 0 inline rgba(255,255,255,X) values in style attributes, found ${matches.length}. ` +
      `Sprint 6.7 swept these to --av-* tokens via class hooks.`,
    );
  });

  test('zero live inline hex declarations in style attributes', () => {
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const matches = stripped.match(/style="[^"]*#[0-9a-fA-F]{3,6}\b/g) || [];
    assert.equal(
      matches.length,
      0,
      `expected 0 inline hex colors in style="..." attributes, found ${matches.length}`,
    );
  });

  test('Vietnamese microcopy lifted from existing page (no drift)', () => {
    for (const phrase of [
      // "Đăng xuất" microcopy now lives inside <aver-chrome> shadow root
      // (Sprint 7.12); page-level body microcopy pinned below.
      'Đang tải',
      'Quay về trang chủ',
      'Chế độ xem trước',
      'Bài giao',
      'Bài đã nộp',
      'Tất cả',
      'Đã chấm',
      'Đang chấm',
      'Bị đánh dấu',
      'Em chưa có bài giao nào',
      'Em chưa có bài viết nào',
      'Làm bài',
      'Lưu bản nháp',
      'Nộp bài',
      'IELTS-mode',
    ]) {
      assert.ok(
        html.includes(phrase),
        `microcopy "${phrase}" must be preserved verbatim`,
      );
    }
  });
});


// ── writing-dashboard.css token discipline ────────────────────────


describe('writing-dashboard.css / token discipline (Sprint 6.7)', () => {
  test('references --av-* tokens heavily', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 80,
      `writing-dashboard.css must reference --av-* tokens throughout (found ${avRefs}); ` +
      `if this drops, components are likely hardcoding colors again`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/var\(--ds-/.test(stripped),
      'writing-dashboard.css should be on --av-* (Sprint 6.7); --ds-* references would be drift',
    );
  });

  test('does NOT use the non-existent --av-space-5 / -7 / -9 / -10 / -11 / -13 / -14 / -15 tokens', () => {
    assert.ok(
      !/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(css),
      'writing-dashboard.css uses a skipped step in the 4px scale. ' +
      'Allowed steps: 0,1,2,3,4,6,8,12,16,20,24.',
    );
  });

  test('avoids hardcoded teal hex in component declarations', () => {
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      if (/#0[Ff]766[Ee]|#14[Bb]8[Aa]6/.test(line)) {
        assert.fail(
          `writing-dashboard.css line ${i + 1} hardcodes a teal hex value — use var(--av-primary). ` +
          `Line: ${line.trim()}`,
        );
      }
    }
  });

  test('declares all the JS-rendered legacy classes', () => {
    // The inline JS render functions emit these directly. A drop here
    // leaves the element unstyled (e.g., .essay-card not collapsing →
    // visual regression).
    const requiredClasses = [
      '.essay-card',
      '.assignment-card',
      '.pill',
      '.pill-green',
      '.pill-amber',
      '.pill-blue',
      '.pill-red',
      '.pill-gray',
      '.pill-purple',
      '.pill-timed',
      '.tab-btn',
      '.essay-filter-btn',
      '.filter-count',
      '.essay-band-pill',
      '.band-low',
      '.band-mid',
      '.band-good',
      '.band-high',
      '.btn-primary',
      '.btn-secondary',
      '.btn-start-assignment',
      '.line-clamp-2',
    ];
    for (const cls of requiredClasses) {
      // Match the class as a selector token: the `.` itself is the
      // class-selector boundary in CSS, so we just check the dotted
      // name appears followed by a selector-end character (`{` opens a
      // block, `:` precedes a pseudo, `,` separates selectors, `.` or
      // whitespace continues a compound).
      const re = new RegExp(`\\${cls}(\\s|[.,{:])`);
      assert.match(
        css,
        re,
        `writing-dashboard.css must declare ${cls} (the inline JS still emits it)`,
      );
    }
  });
});


// ── Sprint 6.4.2 contrast discipline ─────────────────────────────


describe('writing-dashboard.css / contrast discipline (Sprint 6.4.2 lesson)', () => {
  test('--av-text-faint usage is capped (auxiliary contexts only)', () => {
    const matches = css.match(/var\(--av-text-faint\)/g) || [];
    assert.ok(
      matches.length <= 10,
      `writing-dashboard.css references --av-text-faint ${matches.length} times; ` +
      `expected ≤ 10. Re-review semantic mapping per Sprint 6.4.2 lesson.`,
    );
  });

  test('text-secondary usage exceeds text-faint (semantic discipline)', () => {
    const secondaryCount = (css.match(/var\(--av-text-secondary\)/g) || []).length;
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(
      secondaryCount > faintCount,
      `--av-text-secondary count (${secondaryCount}) must exceed --av-text-faint (${faintCount})`,
    );
  });
});


// ── Sprint 6.5.1 ds.css legacy override pattern ───────────────────


describe('writing-dashboard.css / Sprint 6.5.1 utility override pattern', () => {
  test('zero hardcoded white text values in component declarations', () => {
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      assert.ok(
        !/color\s*:\s*#fff\b/i.test(line),
        `writing-dashboard.css line ${i + 1} hardcodes color:#fff. Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*white\b/i.test(line),
        `writing-dashboard.css line ${i + 1} hardcodes color:white. Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/i.test(line),
        `writing-dashboard.css line ${i + 1} hardcodes color:rgba(255,255,255,X). Line: ${line.trim()}`,
      );
    }
  });

  test('overrides text-gray-* Tailwind utilities under body.av-page', () => {
    // The inline JS render functions emit text-gray-100/200/300/400/500
    // directly inside innerHTML. On the cream light surface those resolve
    // to white-on-cream (gray-100) or invisible (gray-300/400). Override
    // each under body.av-page so the contract holds in both themes.
    for (const variant of ['100', '200', '300', '400', '500']) {
      const re = new RegExp(
        `body\\.av-page\\s+\\.text-gray-${variant}\\b[^{]*\\{[^}]*color\\s*:\\s*var\\(--av-text-`,
      );
      assert.match(
        css,
        re,
        `.text-gray-${variant} must be overridden to a token under body.av-page`,
      );
    }
  });

  test('overrides semantic Tailwind accents (amber / emerald / red / teal)', () => {
    const probes = [
      [/body\.av-page\s+\.text-amber-(?:300|400)[^{]*\{[^}]*color\s*:\s*var\(--av-warning\)/, 'text-amber-*'],
      [/body\.av-page\s+\.text-emerald-400[^{]*\{[^}]*color\s*:\s*var\(--av-success\)/, 'text-emerald-400'],
      [/body\.av-page\s+\.text-red-(?:300|400|500)[^{]*\{[^}]*color\s*:\s*var\(--av-error\)/, 'text-red-*'],
      [/body\.av-page\s+\.text-teal-(?:light|400|300)[^{]*\{[^}]*color\s*:\s*var\(--av-primary\)/, 'text-teal-*'],
    ];
    for (const [re, label] of probes) {
      assert.match(css, re, `${label} must be overridden to a semantic token under body.av-page`);
    }
  });

  test('overrides bg-white/5 + bg-red-500/5 + border-white/10 under body.av-page', () => {
    // Tailwind opacity-suffixed utilities are escaped with `\/` in CSS.
    assert.match(
      css,
      /body\.av-page\s+\.bg-white\\\/5\s*\{[^}]*background-color\s*:\s*var\(--av-/,
    );
    assert.match(
      css,
      /body\.av-page\s+\.bg-red-500\\\/5\s*\{[^}]*background-color\s*:\s*var\(--av-/,
    );
    assert.match(
      css,
      /body\.av-page\s+\.border-white\\\/10\s*\{[^}]*border-color\s*:\s*var\(--av-/,
    );
  });
});
