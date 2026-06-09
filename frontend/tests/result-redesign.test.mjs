/**
 * frontend/tests/result-redesign.test.mjs — Sprint 6.6.
 *
 * Run with: node --test frontend/tests/result-redesign.test.mjs
 *
 * Pins the Sprint 6.6 redesign of /pages/result.html. The page is a
 * read-only feedback view backed by ~885 lines of inline JS (result.js
 * is empty — every render path is in the IIFE in result.html). The
 * redesign was therefore SURGICAL:
 *   • fonts swapped: Manrope+Fraunces → Plus Jakarta Sans + JetBrains Mono
 *   • Aver Design System foundation linked (tokens.css + components.css
 *     + result.css) on top of ds.css for the legacy .ds-band-* / .ds-crit
 *     classes that the inline JS still hard-references
 *   • all inline rgba/hex inside HTML and inside JS template literals
 *     swept to --av-* tokens (semantic role mapping per
 *     UNIFIED_DESIGN_BRIEF.md § 11)
 *   • header inline-styled back link → .result-back-link with Lucide
 *   • action buttons (file-down / layout-dashboard / rotate-ccw) →
 *     Lucide icons
 *   • full light + dark theme support FROM DAY 1 (no force-dark)
 *   • Sprint 6.5.1 ds.css legacy-override block under body.av-page
 *     (.ds-band-hero / .ds-band-value / .ds-crit / .ds-crit-score
 *     / .ds-section-head / .btn-secondary)
 *
 * What this test guards: the redesign decisions above and the inline-JS
 * coupling that mustn't break (every element ID the IIFE looks up,
 * every band-* / acc-body / acc-chevron classname the JS toggles).
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
    path.join(__dirname, '..', 'pages', 'result.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'result.css'),
    'utf8',
  );
});


// ── Foundation links ──────────────────────────────────────────────


describe('result.html / foundation links', () => {
  test('links Aver tokens.css before components.css before result.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const resultIdx = html.indexOf('css/result.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(resultIdx > -1, 'result.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx && componentsIdx < resultIdx,
      'load order must be tokens → components → result for cascade resolution',
    );
  });

  test('keeps ds.css linked (page still uses .ds-band-* / .ds-crit*)', () => {
    // result.html still renders .ds-band-hero, .ds-band-value, .ds-crit,
    // etc. through inline JS. ds.css must stay until those legacy classes
    // are migrated. Our Sprint 6.6 strategy is: keep ds.css + override
    // the broken-on-light selectors via body.av-page in result.css.
    assert.match(html, /css\/ds\.css/);
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import Manrope or Fraunces', () => {
    assert.ok(
      !/family=Manrope/.test(html),
      'Manrope was Sprint 6.2 — removed in 6.6 redesign',
    );
    assert.ok(
      !/family=Fraunces/.test(html),
      'Fraunces was Sprint 6.2 — removed in 6.6 redesign',
    );
  });

  test('Tailwind font is Plus Jakarta Sans (inline config OR static build)', () => {
    // P0-3 C-3.4: migrated pages drop the inline config; Plus Jakarta now lives
    // in tailwind.config.cjs, compiled into css/tailwind.build.css.
    const inline = /fontFamily\s*:\s*\{[\s\S]*?sans:\s*\[\s*'Plus Jakarta Sans'/.test(html);
    assert.ok(inline || /css\/tailwind\.build\.css/.test(html),
      'Plus Jakarta via inline config or the static build');
  });
});


// ── Theme support (Sprint 6.6: full light + dark from day 1) ───────


describe('result.html / theme support', () => {
  test('anti-flash IIFE reads localStorage av-theme + system preference', () => {
    const iifeIdx = html.search(/localStorage\.getItem\(['"]av-theme['"]\)/);
    const firstLinkIdx = html.search(/<link\s+rel="stylesheet"/);
    assert.ok(iifeIdx > -1, "IIFE must read localStorage 'av-theme'");
    assert.ok(firstLinkIdx > -1, 'page must link at least one stylesheet');
    assert.ok(
      iifeIdx < firstLinkIdx,
      'theme bootstrap IIFE must run BEFORE any stylesheet to prevent flash',
    );
    assert.match(
      html,
      /prefers-color-scheme:\s*dark/,
      'IIFE must fall back to system preference when no stored theme',
    );
  });

  test('IIFE does NOT hardcode data-theme="dark" (no force-dark, no DEBT)', () => {
    // Sprint 6.6 applies the Sprint 6.4.1/6.4.2 lesson — both themes ship
    // from day 1. A force-dark setAttribute would silently break light.
    const forceDark = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/.test(html);
    assert.ok(
      !forceDark,
      'force-dark setAttribute must NOT exist — result.html supports both themes from Sprint 6.6',
    );
  });

  test('Sprint 7.13 — chrome migrated to <aver-chrome active="speaking">', () => {
    assert.match(html, /<aver-chrome\s+active="speaking"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('Sprint 7.13 — inline chrome markup + bindToggleButton import retired', () => {
    assert.equal(/class="av-theme-toggle"/.test(html), false);
    assert.equal(
      /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\/js\/theme-toggle\.js['"]/.test(html),
      false,
    );
  });
});


// ── JS-coupled selectors (the inline IIFE renderers) ──────────────


describe('result.html / state container IDs', () => {
  test('all 3 state container IDs preserved', () => {
    // showState() in the IIFE toggles `hidden` on these.
    for (const id of ['state-loading', 'state-error', 'state-content']) {
      assert.match(
        html,
        new RegExp(`id="${id}"`),
        `#${id} state container must remain — showState() looks it up`,
      );
    }
  });
});


describe('result.html / band + meta + feedback IDs', () => {
  test('meta + overall band + per-criterion band IDs preserved', () => {
    for (const id of [
      'meta-part',
      'meta-topic',
      'meta-date',
      'overall-band',
      'band-fc',
      'band-lr',
      'band-gra',
      'band-p',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('feedback list + grammar + accordion IDs preserved', () => {
    for (const id of [
      'strengths-list',
      'improvements-list',
      'grammar-resources',
      'grammar-resources-cards',
      'accordion-container',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('action button + error IDs preserved', () => {
    for (const id of ['btn-pdf', 'btn-retry', 'error-msg']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });
});


describe('result.html / inline JS render contract', () => {
  test('toggleAccordion() onclick handler still wired', () => {
    // The accordion toggle is inline `onclick="toggleAccordion(idx)"`.
    // A markup rewrite that drops this breaks every per-question detail
    // panel.
    assert.match(html, /onclick="toggleAccordion\(/);
  });

  test('main IIFE bootstrap call preserved', () => {
    // The page is one big IIFE; main() at the bottom kicks it off.
    assert.match(html, /\bmain\(\s*\)\s*;\s*\}\(\s*\)\s*\)\s*;/);
  });

  test('preserves the band-* className contract on overall + crit scores', () => {
    // The IIFE assigns 'band-high' / 'band-mid' / 'band-low' / 'band-none'
    // to #overall-band and #band-fc/-lr/-gra/-p. The initial markup must
    // ship 'band-none' so the spinner-state has the right token color.
    assert.match(html, /id="overall-band"[^>]*class="[^"]*\bband-none\b/);
    for (const id of ['band-fc', 'band-lr', 'band-gra', 'band-p']) {
      assert.match(
        html,
        new RegExp(`id="${id}"[^>]*class="[^"]*\\bband-none\\b`),
        `#${id} must ship initial class="...band-none" so the score color resolves`,
      );
    }
  });
});


// ── Lucide icon swap ──────────────────────────────────────────────


describe('result.html / Lucide icon swap', () => {
  test('Lucide CDN + hydration script present', () => {
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
    assert.match(html, /lucide\.createIcons/);
  });

  test('header back link uses Lucide chevron-left (not arrow emoji)', () => {
    const header = html.match(/<header[^>]*result-header[\s\S]*?<\/header>/);
    assert.ok(header, 'result-header block must exist');
    assert.match(header[0], /data-lucide="chevron-left"/);
    assert.ok(
      !header[0].includes('← Dashboard'),
      'header must not ship the legacy ← arrow before "Dashboard"',
    );
  });

  test('error state uses Lucide alert-triangle (not emoji)', () => {
    const errBlock = html.match(/id="state-error"[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(errBlock, 'state-error block must exist');
    assert.match(errBlock[0], /data-lucide="alert-triangle"/);
  });

  test('action buttons use Lucide file-down / layout-dashboard / rotate-ccw', () => {
    assert.match(html, /<i\s+data-lucide="file-down"/);
    assert.match(html, /<i\s+data-lucide="layout-dashboard"/);
    assert.match(html, /<i\s+data-lucide="rotate-ccw"/);
  });
});


// ── Body class + legacy chrome ────────────────────────────────────


describe('result.html / body class', () => {
  test('body opts into .av-page (Aver page surface)', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });

  test('body does NOT carry the legacy ds-canvas class', () => {
    assert.ok(
      !/<body[^>]*class="[^"]*\bds-canvas\b[^"]*"/.test(html),
      'result.html should drop ds-canvas — av-page + [data-theme] handle theming',
    );
  });

  test('body does NOT hardcode text-slate-100 or text-white', () => {
    const m = html.match(/<body[^>]*class="([^"]+)"/);
    assert.ok(m, '<body> must have a class attribute');
    assert.ok(
      !/\btext-slate-100\b/.test(m[1]),
      `<body> must not hardcode text-slate-100 — light theme would render the page invisibly`,
    );
    assert.ok(
      !/\btext-white\b/.test(m[1]),
      `<body> must not hardcode text-white — same reason`,
    );
  });
});


// ── Color migration / token discipline ────────────────────────────


describe('result.html / color migration', () => {
  test('zero live inline rgba(255,255,255,X) declarations remain', () => {
    // Strip HTML/JS comments first — explanatory comments may mention
    // the literal pattern. The inline IIFE uses //-style comments too,
    // so cover both.
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const matches = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.equal(
      matches.length,
      0,
      `expected 0 live rgba(255,255,255,X) values in HTML/JS, found ${matches.length}. ` +
      `Sprint 6.6 swept these to --av-* tokens.`,
    );
  });

  test('no hardcoded brand teal #14b8a6 in inline JS render paths', () => {
    // The Tailwind theme.extend.colors.teal palette entry is allowed
    // (it's just a config palette, not a render path). Anything else
    // is drift — rendering paths must use var(--av-primary).
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    const matches = stripped.match(/#14b8a6/gi) || [];
    // Tailwind config shouldn't count: filter out the line that sits
    // inside `tailwind.config = { ... }`.
    const configMatch = stripped.match(/tailwind\.config\s*=\s*\{[\s\S]*?^\s*\}\s*$/m);
    const configCount = configMatch ? (configMatch[0].match(/#14b8a6/gi) || []).length : 0;
    const liveCount = matches.length - configCount;
    assert.equal(
      liveCount,
      0,
      `expected 0 hardcoded #14b8a6 in render paths, found ${liveCount}. ` +
      `Use var(--av-primary) instead.`,
    );
  });

  test('Vietnamese microcopy lifted from existing page (no drift)', () => {
    for (const phrase of [
      'Đang tải kết quả',
      'Không thể tải kết quả',
      'Quay lại',
      'Band tổng quan',
      'Overall Band Score',
      'Điểm mạnh',
      'Cần cải thiện',
      'Grammar Resources',
      'Chi tiết từng câu hỏi',
      'Tải báo cáo PDF',
      'Luyện lại chủ đề này',
    ]) {
      assert.ok(
        html.includes(phrase),
        `microcopy "${phrase}" must be preserved verbatim`,
      );
    }
  });
});


// ── result.css token discipline ───────────────────────────────────


describe('result.css / token discipline (Sprint 6.6)', () => {
  test('references --av-* tokens heavily', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 60,
      `result.css must reference --av-* tokens throughout (found ${avRefs}); ` +
      `if this drops, components are likely hardcoding colors again`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    // Strip comments first — historical context in comments may mention
    // the legacy token names (e.g., "ds.css line 161 paints with
    // var(--ds-teal-lt)..." is fine in a comment but a real declaration
    // would be drift).
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/var\(--ds-/.test(stripped),
      'result.css should be on --av-* (Sprint 6.6); --ds-* references would be drift',
    );
  });

  test('does NOT use the non-existent --av-space-5 / -7 / -9 / -10 / -11 / -13 / -14 / -15 tokens', () => {
    // The 4px scale skips these steps to enforce discipline. CSS silently
    // drops the entire declaration if the var() resolves to nothing →
    // padding collapses to 0 → visual regression.
    assert.ok(
      !/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(css),
      'result.css uses a skipped step in the 4px scale. ' +
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
          `result.css line ${i + 1} hardcodes a teal hex value — use var(--av-primary). ` +
          `Line: ${line.trim()}`,
        );
      }
    }
  });

  test('declares all the legacy classes that the page still uses', () => {
    // The inline IIFE renders these directly. A drop here leaves the
    // element unstyled (e.g., `.acc-body` not collapsing → all answers
    // expanded by default).
    const requiredClasses = [
      '.card',
      '.spinner',
      '.acc-body',
      '.acc-chevron',
      '.band-high',
      '.band-mid',
      '.band-low',
      '.band-none',
      '.transcript-block',
      '.improved-block',
    ];
    for (const cls of requiredClasses) {
      const re = new RegExp(`(^|[\\s,])${cls.replace('.', '\\.')}(\\s|[,{:.])`, 'm');
      assert.match(
        css,
        re,
        `result.css must declare ${cls} (the inline JS still emits it)`,
      );
    }
  });
});


// ── Sprint 6.4.2 contrast lesson applied ─────────────────────────


describe('result.css / contrast discipline (Sprint 6.4.2 lesson)', () => {
  test('--av-text-faint usage is capped (auxiliary contexts only)', () => {
    const matches = css.match(/var\(--av-text-faint\)/g) || [];
    assert.ok(
      matches.length <= 10,
      `result.css references --av-text-faint ${matches.length} times; ` +
      `expected ≤ 10. Re-review semantic mapping per Sprint 6.4.2 lesson.`,
    );
  });

  test('text-secondary usage exceeds text-faint (semantic discipline)', () => {
    const secondaryCount = (css.match(/var\(--av-text-secondary\)/g) || []).length;
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(
      secondaryCount > faintCount,
      `--av-text-secondary count (${secondaryCount}) must exceed --av-text-faint (${faintCount}) — ` +
      `helper text and content sub-labels should land on secondary, not faint.`,
    );
  });
});


// ── Sprint 6.5.1 ds.css legacy override pattern applied ───────────


describe('result.css / Sprint 6.5.1 ds.css override pattern', () => {
  test('result.css has zero hardcoded white text values', () => {
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      assert.ok(
        !/color\s*:\s*#fff\b/i.test(line),
        `result.css line ${i + 1} hardcodes color:#fff — use var(--av-text-primary). ` +
        `Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*white\b/i.test(line),
        `result.css line ${i + 1} hardcodes color:white — use var(--av-text-primary). ` +
        `Line: ${line.trim()}`,
      );
      assert.ok(
        !/color\s*:\s*rgba\(255\s*,\s*255\s*,\s*255/i.test(line),
        `result.css line ${i + 1} hardcodes color:rgba(255,255,255,X) — use a token. ` +
        `Line: ${line.trim()}`,
      );
    }
  });

  test('overrides .ds-band-hero on body.av-page (light theme readable)', () => {
    // ds.css line 161 paints .ds-band-hero with a teal-tinted gradient
    // that's hardcoded to dark. On the cream surface the overall band
    // hero needs a token-bound surface so light + dark resolve.
    const re = /body\.av-page\s+\.ds-band-hero\s*\{[\s\S]*?(background[\s\S]*?var\(--av-primary-soft|var\(--av-primary)/;
    assert.match(
      css,
      re,
      'result.css must override .ds-band-hero → token-bound surface on body.av-page',
    );
  });

  test('overrides .ds-band-value band-* color states on body.av-page', () => {
    // ds.css lines 174-177 hardcode #14b8a6 / #fbbf24 / #f97316 / #6b7280.
    // On light theme these read as raw hex, not theme-aware. Override
    // each to its semantic token.
    for (const variant of ['high', 'mid', 'low', 'none']) {
      const re = new RegExp(
        `body\\.av-page\\s+\\.ds-band-hero\\s+\\.ds-band-value\\.band-${variant}\\s*\\{[^}]*color\\s*:\\s*var\\(--av-`,
      );
      assert.match(
        css,
        re,
        `.ds-band-value.band-${variant} must be overridden to var(--av-*) on body.av-page`,
      );
    }
  });

  test('overrides .ds-crit chrome (background + border) for light theme', () => {
    // ds.css line 188 sets rgba(255,255,255,0.04) bg + 0.08 border,
    // invisible on cream. Each criterion card must flip to tokens.
    const re = /body\.av-page\s+\.ds-crit\s*\{[\s\S]*?(background[\s\S]*?var\(--av-surface[\s\S]*?border[\s\S]*?var\(--av-border|border[\s\S]*?var\(--av-border[\s\S]*?background[\s\S]*?var\(--av-surface)/;
    assert.match(
      css,
      re,
      '.ds-crit must use --av-surface-* + --av-border-* tokens on body.av-page',
    );
  });

  test('overrides .btn-secondary on body.av-page (Dashboard + retry buttons)', () => {
    // ds.css line 401 sets color: rgba(255,255,255,0.8) which is
    // white-on-cream on light. The Dashboard link + retry button use
    // .btn-secondary, so the override is required for either button to
    // be readable.
    const re = /body\.av-page\s+\.btn-secondary\s*\{[^}]*color\s*:\s*var\(--av-text-/;
    assert.match(
      css,
      re,
      '.btn-secondary must be overridden to a token-bound color on body.av-page',
    );
  });
});
