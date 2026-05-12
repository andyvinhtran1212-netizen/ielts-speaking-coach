/**
 * frontend/tests/speaking-redesign.test.mjs — Sprint 6.4 + 6.4.1.
 *
 * Run with: node --test frontend/tests/speaking-redesign.test.mjs
 *
 * Pins the Sprint 6.4 redesign of /pages/speaking.html and the 6.4.1
 * hotfix. The page is 2,300+ lines with deeply inline JS, so the
 * redesign was scoped:
 *   • fonts swapped: Manrope+Fraunces → Plus Jakarta Sans + JetBrains Mono
 *   • Aver Design System foundation linked (tokens.css + components.css)
 *   • inline <style> block extracted to /css/speaking.css using --av-* tokens
 *   • main-tab-nav emojis replaced with Lucide icons
 *   • dashboard quick-access card emojis replaced with Lucide icons
 *
 * Sprint 6.4.1 closed DEBT-2026-05-10-A:
 *   • all ~136 inline rgba(255,255,255,X) values migrated to --av-text-*
 *     / --av-border-* / --av-surface-* tokens
 *   • IIFE switched from force-dark to the canonical anti-flash bootstrap
 *     (localStorage 'av-theme' → system preference → 'light')
 *   • theme toggle re-enabled (.av-theme-toggle in header, bindToggleButton
 *     wired via /js/theme-toggle.js)
 *   • Chart.js options resolve --av-* tokens via getComputedStyle so axes
 *     re-color on theme flip; window._dashboard.refreshCharts is exposed
 *     and wired to a MutationObserver on <html data-theme>
 *   • the broken `var(--av-space-5)` references (3 places — token isn't
 *     defined; the scale skips 5/7/9) re-pinned to --av-space-4 / -6
 *
 * What this test guards: the redesign decisions above and the JS
 * coupling that mustn't break (every #mtab-* button, every #stat-*
 * id, every chart container id, the switchMainTab onclick string,
 * the .main-tab-btn class on each button).
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
    path.join(__dirname, '..', 'pages', 'speaking.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'speaking.css'),
    'utf8',
  );
});


// ── Foundation links ───────────────────────────────────────────────


describe('speaking.html / foundation links', () => {
  test('links Aver tokens.css before components.css before speaking.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const speakingIdx = html.indexOf('css/speaking.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(speakingIdx > -1, 'speaking.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx && componentsIdx < speakingIdx,
      'load order must be tokens → components → speaking so the cascade resolves correctly',
    );
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import Manrope, Fraunces, or Inter', () => {
    assert.ok(!/family=Manrope/.test(html), 'Manrope was Sprint 6.2 — removed in 6.4 redesign');
    assert.ok(!/family=Fraunces/.test(html), 'Fraunces was Sprint 6.2 — removed in 6.4 redesign');
    assert.ok(!/family=Inter[:&]/.test(html), 'Inter must not return on the redesigned page');
  });

  test('Tailwind config fontFamily.sans is Plus Jakarta Sans', () => {
    // The Tailwind CDN config block was kept; only the font family
    // changed. This pin catches a future "I migrated the <link> but
    // forgot the config" regression.
    assert.match(html, /fontFamily\s*:\s*\{[\s\S]*?sans:\s*\[\s*'Plus Jakarta Sans'/);
  });
});


// ── Dark-only stance (Sprint 6.4 scope deviation) ─────────────────


describe('speaking.html / theme support (Sprint 6.4.1)', () => {
  test('anti-flash IIFE reads localStorage av-theme + system preference', () => {
    // The IIFE must run BEFORE any <link rel="stylesheet"> to prevent a
    // flash. It must NOT hardcode 'dark' (Sprint 6.4 force-dark was
    // un-deferred in 6.4.1 once the inline rgba sweep landed).
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

  test('IIFE does NOT hardcode data-theme="dark" (force-dark removed)', () => {
    // Sprint 6.4 wrote `setAttribute('data-theme', 'dark')` unconditionally.
    // Sprint 6.4.1 replaced that with the conditional bootstrap. The only
    // hardcoded 'dark' allowed is inside string literals or comments —
    // never as a setAttribute(...) call.
    const forceDark = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/.test(html);
    assert.ok(
      !forceDark,
      "force-dark setAttribute call must be removed — the IIFE should resolve theme via localStorage/system preference",
    );
  });

  test('header includes the theme toggle button (.av-theme-toggle)', () => {
    assert.match(
      html,
      /class="av-theme-toggle"/,
      'speaking.html must show the theme toggle (Sprint 6.4.1 — DEBT-2026-05-10-A closed)',
    );
  });

  test('binds the toggle via /js/theme-toggle.js bindToggleButton import', () => {
    assert.match(
      html,
      /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"][^'"]*theme-toggle\.js['"]/,
      'speaking.html must import bindToggleButton',
    );
    assert.match(
      html,
      /bindToggleButton\s*\(/,
      'speaking.html must call bindToggleButton on the toggle element',
    );
  });

  test('exposes window._dashboard.refreshCharts for theme flip', () => {
    assert.match(
      html,
      /window\._dashboard\.refreshCharts\s*=/,
      'a refreshCharts hook must exist so the MutationObserver can rebuild charts on theme flip',
    );
    assert.match(
      html,
      /MutationObserver[\s\S]{0,300}data-theme/,
      'a MutationObserver must watch [data-theme] to trigger refreshCharts',
    );
  });
});


// ── JS-coupled selectors (the inline state machine contract) ──────


describe('speaking.html / JS-coupled selectors', () => {
  test('all four main-tab buttons preserved with id + class + onclick', () => {
    // switchMainTab(...) is reached via the onclick attribute on each
    // button. A future redesign that converts these to <a href> would
    // silently break the tab state machine.
    const mtabIds = ['mtab-dashboard', 'mtab-practice', 'mtab-partbpart', 'mtab-fulltest'];
    for (const id of mtabIds) {
      const re = new RegExp(
        `<button[^>]*id="${id}"[^>]*class="[^"]*\\bmain-tab-btn\\b[^"]*"[^>]*onclick="switchMainTab\\('`,
      );
      assert.match(
        html,
        re,
        `the ${id} button must keep its id, .main-tab-btn class, and switchMainTab(...) onclick`,
      );
    }
  });

  test('main-tab panels keep id="tab-{name}" + .main-tab-panel class', () => {
    const panelIds = ['tab-dashboard', 'tab-practice', 'tab-partbpart', 'tab-fulltest'];
    for (const id of panelIds) {
      assert.match(
        html,
        new RegExp(`<div\\s+id="${id}"[^>]*class="[^"]*\\bmain-tab-panel\\b`),
        `${id} panel id + class must be preserved (display: none/block toggling depends on it)`,
      );
    }
  });

  test('chart canvas IDs preserved', () => {
    // Chart.js attaches to these canvases by id. Renaming would
    // silently break the band-trajectory + radar charts.
    assert.match(html, /<canvas\s+id="chart-line"/);
    assert.match(html, /<canvas\s+id="chart-radar"/);
  });

  test('chart wrapper + empty-state IDs preserved', () => {
    for (const id of ['line-chart-wrap', 'radar-chart-wrap', 'line-chart-empty', 'radar-chart-empty', 'charts-section']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain (chart show/hide JS depends on it)`);
    }
  });

  test('hero-stat IDs preserved (renderStats / renderStreak targets)', () => {
    for (const id of ['stat-band', 'stat-band-sub', 'stat-total', 'stat-last-date', 'stat-last-topic', 'stat-streak']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('continue-CTA + greeting + empty-state IDs preserved', () => {
    for (const id of ['continue-cta', 'cta-topic-label', 'continue-cta-link', 'greeting-name', 'dashboard-empty']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('grammar dashboard panel IDs preserved (loadGrammar() targets)', () => {
    for (const id of [
      'grammar-dashboard-section',
      'grammar-loading',
      'grammar-content',
      'grammar-focus-pills',
      'grammar-weak-list',
      'grammar-recent-list',
      'grammar-saved-list',
      'grammar-empty',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('history filter + table IDs preserved', () => {
    for (const id of [
      'history-filters',
      'history-empty',
      'history-table-wrap',
      'history-pagination',
      'hf-search',
      'hf-sort',
      'hf-date-from',
      'hf-date-to',
      'history-tbody',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });

  test('topic modal IDs + onclick handlers preserved', () => {
    for (const id of ['topic-modal', 'panel-list', 'panel-custom', 'panel-myq', 'topic-select-wrap', 'pbp-topic-section']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
    // The modal click-outside-to-close behavior is wired via onclick="handleModalBackdropClick(event)"
    assert.match(html, /onclick="handleModalBackdropClick\(event\)"/);
  });

  test('avatar dropdown IDs preserved', () => {
    for (const id of ['user-name', 'user-name-skeleton', 'avatar-dropdown-wrap', 'avatar-wrap', 'avatar-menu', 'avatar-initials', 'avatar-img', 'btn-logout']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });
});


// ── Lucide icon swap (no emoji in nav / cards) ────────────────────


describe('speaking.html / Lucide icon swap', () => {
  test('main-tab-nav buttons no longer ship emoji prefixes', () => {
    const nav = html.match(/<nav class="main-tab-nav">[\s\S]*?<\/nav>/);
    assert.ok(nav, 'main-tab-nav block must exist');
    const navHtml = nav[0];
    // Pin the specific emojis that lived in the Sprint 5.1 nav.
    const oldGlyphs = ['📊', '🎯', '📋', '🏆', '📖', '📚'];
    for (const glyph of oldGlyphs) {
      assert.ok(
        !navHtml.includes(glyph),
        `main-tab-nav still contains "${glyph}" — Sprint 6.4 swapped to Lucide icons`,
      );
    }
  });

  test('main-tab-nav buttons each carry a Lucide <i data-lucide=...>', () => {
    const nav = html.match(/<nav class="main-tab-nav">[\s\S]*?<\/nav>/);
    const navHtml = nav[0];
    const lucideCount = (navHtml.match(/<i\s+data-lucide=/g) || []).length;
    // Sprint 6.16: dropped 2 anchor links (Grammar Wiki + Từ vựng) for IA
    // cleanup — cross-skill discovery lives on home.html. Pin relaxed to
    // ≥ 4 (the 4 internal tabs that switchMainTab() handles).
    assert.ok(
      lucideCount >= 4,
      `expected ≥ 4 Lucide icons in main-tab-nav (4 internal tabs after Sprint 6.16), found ${lucideCount}`,
    );
  });

  test('the 3 dashboard quick-access cards use Lucide icons (no 🎯/📋/🏆)', () => {
    const section = html.match(/<!-- ── PART 2: Quick Access[\s\S]*?<\/section>/);
    assert.ok(section, 'PART 2 quick-access section must exist');
    const sectionHtml = section[0];
    for (const glyph of ['🎯', '📋', '🏆']) {
      assert.ok(
        !sectionHtml.includes(glyph),
        `quick-access card still contains "${glyph}" — Sprint 6.4 swapped to Lucide`,
      );
    }
    const lucideCount = (sectionHtml.match(/<i\s+data-lucide=/g) || []).length;
    assert.ok(
      lucideCount >= 3,
      `expected ≥ 3 Lucide icons across the 3 quick-access cards, found ${lucideCount}`,
    );
  });

  test('Lucide CDN script + hydration fallback are loaded', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
    // Fallback hydration: createIcons must be called both on
    // DOMContentLoaded and on window 'load' so a deferred CDN script
    // that finishes after DOMContentLoaded still gets a render.
    assert.match(html, /lucide\.createIcons/);
  });
});


// ── speaking.css / token discipline ───────────────────────────────


describe('speaking.css / token discipline', () => {
  test('references --av-* tokens heavily', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 80,
      `speaking.css must reference --av-* tokens throughout (found ${avRefs}); ` +
      `if this drops, components are likely hardcoding colors again`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    assert.ok(
      !/var\(--ds-/.test(css),
      'speaking.css should be on --av-* (Sprint 6.4); --ds-* references would be drift',
    );
  });

  test('avoids bare hardcoded teal hex values in component declarations', () => {
    // Allow the legacy hex inside comments (block strings); only
    // flag value declarations that hardcode the brand teal instead
    // of using var(--av-primary).
    const lines = css.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines.
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      if (/#0[Ff]766[Ee]|#14[Bb]8[Aa]6/.test(line)) {
        assert.fail(
          `speaking.css line ${i + 1} hardcodes a teal hex value — use var(--av-primary). ` +
          `Line: ${line.trim()}`,
        );
      }
    }
  });

  test('declares all the Sprint 5.1 legacy classes that the page still uses', () => {
    // The old inline <style> block was extracted to speaking.css. A
    // future cleanup that drops a class without checking the markup
    // would leave the page unstyled. Pin the canonical list.
    const requiredClasses = [
      '.sidebar-bg', '.main-bg',
      '.stat-card', '.part-card',
      '.btn-start', '.btn-fulltest', '.btn-test',
      '.skeleton', '.session-row',
      '.badge-done', '.badge-pending',
      '.modal-backdrop', '.modal-box',
      '.topic-tab', '.topic-input', '.btn-confirm', '.modal-error',
      '.main-tab-nav', '.main-tab-btn', '.main-tab-label', '.main-tab-sub', '.main-tab-panel',
      '.option-card', '.part-select-btn', '.tab-input', '.tab-error',
      '.pbp-part-card', '.ft-part-row',
      '.grammar-section', '.grammar-sub-title', '.grammar-pill',
      '.grammar-weak-item', '.grammar-weak-dot',
      '.grammar-recent-item', '.grammar-saved-item', '.grammar-empty-text',
    ];
    for (const cls of requiredClasses) {
      // Match either as a leading selector or as part of a comma-separated rule.
      const re = new RegExp(`(^|[\\s,])${cls.replace('.', '\\.')}(\\s|[,{:])`, 'm');
      assert.match(
        css,
        re,
        `speaking.css must declare ${cls} (the page still uses it; dropping it leaves elements unstyled)`,
      );
    }
  });
});


// ── Body class ────────────────────────────────────────────────────


describe('speaking.html / body class', () => {
  test('body opts into .av-page (Aver page surface)', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });

  test('body does NOT carry the legacy ds-canvas class', () => {
    assert.ok(
      !/<body[^>]*class="[^"]*\bds-canvas\b[^"]*"/.test(html),
      'speaking.html should drop ds-canvas — av-page + [data-theme] handle theming',
    );
  });

  test('body does NOT hardcode text-white (Sprint 6.4.1)', () => {
    // Sprint 6.4 left `text-white` on <body> as a fallback while
    // ~159 inline rgba(255,255,255) values rendered the page. Sprint
    // 6.4.1 swept those values to tokens; the body now inherits color
    // from .av-page (var(--av-text-primary)). Keeping text-white on
    // body would re-paint cream-on-cream in light theme.
    const m = html.match(/<body[^>]*class="([^"]+)"/);
    assert.ok(m, '<body> must have a class attribute');
    assert.ok(
      !/\btext-white\b/.test(m[1]),
      `<body> must not include Tailwind's text-white — light theme would render the page invisibly`,
    );
  });
});


// ── Sprint 6.4.1 — inline color sweep + tab nav fix ───────────────


describe('speaking.html / Sprint 6.4.1 hotfix', () => {
  test('zero live inline rgba(255,255,255,X) declarations remain', () => {
    // The Sprint 5.1 inline color ladder was migrated to tokens. Any
    // future regression that re-introduces a hardcoded white-with-alpha
    // would render invisible on the cream light surface.
    //
    // Scan only HTML content, not comments — the explanatory comment
    // about the original sweep can mention the literal.
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    const matches = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.equal(
      matches.length,
      0,
      `expected 0 inline rgba(255,255,255,X) values in HTML, found ${matches.length}. ` +
      `Sprint 6.4.1 swept these to --av-text-* / --av-border-* / --av-surface-* tokens.`,
    );
  });

  test('chart configs resolve --av-* tokens via getComputedStyle (not raw CSS strings)', () => {
    // Chart.js does NOT understand `var(--av-text-muted)` as a string.
    // The dashboard must call getComputedStyle().getPropertyValue() for
    // each token used in axes/grid/tooltip/series colors. The token
    // name is passed as a variable (e.g. _tokenColor('--av-text-muted'))
    // so we don't strictly require the literal at the call site — but
    // we DO require token literals to appear in the helper invocations.
    assert.match(
      html,
      /getComputedStyle\(\s*document\.documentElement\s*\)/,
      'renderCharts() must read tokens via getComputedStyle on the documentElement',
    );
    assert.match(
      html,
      /\.getPropertyValue\(/,
      'renderCharts() must invoke getPropertyValue (likely via a token-resolver helper)',
    );
    // At least one --av-* token literal must appear in the chart code so
    // the colors are actually wired to the design system.
    assert.match(
      html,
      /['"]--av-(text|border|surface|primary)/,
      'chart code must reference at least one --av-* token literal',
    );
  });

  test('removed `text-white` Tailwind class on stat numbers got a token-aware override', () => {
    // The dashboard PR keeps `text-white` on a few elements (stat-total,
    // stat-last-date, stat-streak, continue-cta copy) so the inline JS
    // that mutates those nodes doesn't have to be touched. speaking.css
    // must override Tailwind's `.text-white` for THIS page so light
    // theme remains readable.
    assert.match(
      css,
      /body\.av-page\s+\.text-white\s*\{[^}]*color\s*:\s*var\(--av-text-/,
      'speaking.css must override .text-white on .av-page to use --av-text-* (else light theme paints white-on-cream)',
    );
  });
});


// ── Sprint 6.4.1 — speaking.css token + spacing discipline ────────


// ── Sprint 6.4.2 — light theme contrast hotfix ───────────────────


describe('speaking.html / Sprint 6.4.2 light contrast', () => {
  test('--av-text-faint usage is capped to truly auxiliary contexts', () => {
    // Sprint 6.4.1 over-mapped rgba opacity 0.30/0.35 → --av-text-faint.
    // On light theme, faint resolves to ~32% navy = ~3:1 contrast against
    // the cream surface, failing WCAG AA. Sprint 6.4.2 lifted helper
    // text + sub-labels + stat sub-text to --av-text-secondary or
    // --av-text-muted. The only legitimate uses left are: em-dash empty
    // cells, disabled pagination buttons, and relative timestamps.
    const matches = html.match(/var\(--av-text-faint\)/g) || [];
    assert.ok(
      matches.length <= 8,
      `--av-text-faint usage in HTML is ${matches.length}; expected ≤ 8 ` +
      `(em-dash, disabled-state, timestamps). Anything more means helper ` +
      `text or sub-labels are being painted at ~3:1 contrast on light theme.`,
    );
  });

  test('helper text in parentheses uses --av-text-secondary', () => {
    // Andy's smoke report: "(tùy chọn — để trống = ngẫu nhiên từ thư viện)"
    // was unreadable on light theme. Pin both occurrences (PART 1 + PART 2)
    // and the question hint "(mỗi dòng một câu, tối đa 10)".
    const tuyChonMatches = html.match(/\(tùy chọn — để trống = ngẫu nhiên từ thư viện\)/g) || [];
    assert.equal(tuyChonMatches.length, 2, 'expected 2 occurrences of the optional-helper string');

    // Each occurrence must wrap in --av-text-secondary, not --av-text-faint.
    const faintHelper = /color:var\(--av-text-faint\);">\(tùy chọn/.test(html);
    assert.ok(
      !faintHelper,
      'Full Test helper text "(tùy chọn — ...)" must use --av-text-secondary, not --av-text-faint',
    );
  });

  test('PART sub-labels (cue card / câu hỏi / câu) use --av-text-secondary', () => {
    // The small inline labels next to "PART 1" / "PART 2" / "PART 3"
    // (e.g. "1 cue card", "5 câu hỏi", "3 chủ đề × 3 câu = 9 câu") are
    // structural cues, not auxiliary metadata.
    const candidates = [
      '3 chủ đề × 3 câu = 9 câu',
      '1 cue card',
      '5 câu hỏi',
    ];
    for (const label of candidates) {
      // Build a regex that requires --av-text-secondary (or stronger)
      // immediately preceding the label inside the same span style.
      const faintRe = new RegExp(`color:var\\(--av-text-faint\\);">\\s*${label.replace(/[\.\*\+\?\(\)\\\[\]]/g, '\\$&')}\\s*<`);
      assert.ok(
        !faintRe.test(html),
        `PART sub-label "${label}" must NOT use --av-text-faint (fails WCAG AA on light theme)`,
      );
    }
  });

  test('stat-card sub-text (Chưa có dữ liệu / Kể từ khi tham gia) uses --av-text-muted', () => {
    // Stat-card sub-lines are visible to every user on first load. The
    // empty-data placeholder ("Chưa có dữ liệu") and the meta line
    // ("Kể từ khi tham gia", "Chưa có buổi học nào") need to read clearly
    // even when they're the only content the user sees.
    const noData = /id="stat-band-sub"[^>]*style="color:var\(--av-text-muted\)/.test(html);
    assert.ok(noData, '#stat-band-sub must use --av-text-muted on light theme');

    const lastTopic = /id="stat-last-topic"[^>]*style="color:var\(--av-text-muted\)/.test(html);
    assert.ok(lastTopic, '#stat-last-topic must use --av-text-muted on light theme');
  });
});


describe('speaking.css / Sprint 6.4.2 fixes', () => {
  test('.grammar-sub-title uses --av-text-secondary (eyebrow labels)', () => {
    // Eyebrow labels (CẦN LUYỆN, ĐIỂM YẾU, ĐÃ XEM, BÀI ĐÃ LƯU) drive
    // the grammar dashboard's information hierarchy. They were faint
    // in 6.4.1 and disappeared on light cream surface.
    const m = css.match(/\.grammar-sub-title\s*\{([^}]+)\}/);
    assert.ok(m, '.grammar-sub-title rule must exist');
    assert.match(
      m[1],
      /color\s*:\s*var\(--av-text-secondary\)/,
      '.grammar-sub-title must use --av-text-secondary so the eyebrow labels read on cream',
    );
  });

  test('.grammar-empty-text uses --av-text-secondary (only visible copy)', () => {
    // Empty-state copy in the grammar dashboard is the entire content
    // when the user has no data. It must read as primary copy, not
    // ghost text.
    const m = css.match(/\.grammar-empty-text\s*\{([^}]+)\}/);
    assert.ok(m, '.grammar-empty-text rule must exist');
    assert.match(
      m[1],
      /color\s*:\s*var\(--av-text-secondary\)/,
      '.grammar-empty-text must use --av-text-secondary',
    );
  });

  test('.grammar-pill-sub uses --av-text-muted (legible secondary copy)', () => {
    const m = css.match(/\.grammar-pill-sub\s*\{([^}]+)\}/);
    assert.ok(m, '.grammar-pill-sub rule must exist');
    assert.match(
      m[1],
      /color\s*:\s*var\(--av-text-muted\)/,
      '.grammar-pill-sub must use --av-text-muted (was --av-text-faint in 6.4.1)',
    );
  });

  test('--av-text-faint usage in CSS is limited to placeholder rules', () => {
    // Placeholder convention (browser default UX) is the only place the
    // 32%-opacity tier reads correctly — the user expects ghost text.
    // Anything else is a contrast bug waiting to happen.
    const faintMatches = css.match(/var\(--av-text-faint\)/g) || [];
    assert.ok(
      faintMatches.length <= 4,
      `speaking.css references --av-text-faint ${faintMatches.length} times; ` +
      `expected ≤ 4 (placeholder rules only)`,
    );

    // Each remaining --av-text-faint reference must be on a ::placeholder
    // selector or inside a rule whose selector contains "placeholder".
    const lines = css.split('\n');
    let inRule = false;
    let ruleSelector = '';
    let ruleBody = '';
    for (const line of lines) {
      if (line.includes('{')) {
        inRule = true;
        ruleSelector = line.split('{')[0].trim();
        ruleBody = '';
      }
      if (inRule) ruleBody += line + '\n';
      if (line.includes('}')) {
        if (/var\(--av-text-faint\)/.test(ruleBody)) {
          assert.ok(
            /placeholder/.test(ruleSelector),
            `speaking.css uses --av-text-faint in non-placeholder rule "${ruleSelector}" — ` +
            `lift to --av-text-muted or --av-text-secondary`,
          );
        }
        inRule = false;
      }
    }
  });
});


describe('speaking.css / Sprint 6.4.1 fixes', () => {
  test('does NOT reference the non-existent --av-space-5 token', () => {
    // The 4px-grid scale in tokens.css intentionally skips 5/7/9. Sprint
    // 6.4 used --av-space-5 in 3 places (tab nav, pbp card, ft-part-row),
    // which silently invalidated the padding declaration → crowded UI.
    assert.ok(
      !/var\(--av-space-5\)/.test(css),
      'speaking.css references --av-space-5, which is NOT defined in tokens.css. Use --av-space-4 or --av-space-6 instead.',
    );
    assert.ok(
      !/var\(--av-space-(7|9|10|11|13|14|15)\)/.test(css),
      'speaking.css uses a skipped step in the 4px scale. Allowed steps: 0,1,2,3,4,6,8,12,16,20,24.',
    );
  });

  test('.main-tab-btn has both horizontal padding AND nowrap (Sprint 6.4.1 fix)', () => {
    // Andy's smoke-test report: tab nav was crowded because the original
    // padding referenced --av-space-5 (silently invalid). The fix uses
    // --av-space-4 horizontal + white-space: nowrap so labels never wrap.
    const m = css.match(/\.main-tab-btn\s*\{([^}]+)\}/);
    assert.ok(m, '.main-tab-btn rule must exist');
    assert.match(
      m[1],
      /padding\s*:\s*var\(--av-space-3\)\s+var\(--av-space-[46]/,
      '.main-tab-btn padding must use a non-skipped scale step (--av-space-4 or --av-space-6)',
    );
    assert.match(
      m[1],
      /white-space\s*:\s*nowrap/,
      '.main-tab-btn must declare white-space: nowrap so labels never wrap',
    );
  });

  test('.ft-part-row + .pbp-part-card have generous padding (--av-space-6)', () => {
    // Andy's report: "Chủ đề 1/2/3" in Full Test had inputs sát viền.
    // Padding was --av-space-4 var(--av-space-5) — the second arg was
    // invalid → effectively 16px / 0. The fix bumps both to --av-space-6.
    const ft = css.match(/\.ft-part-row\s*\{([^}]+)\}/);
    assert.ok(ft, '.ft-part-row rule must exist');
    assert.match(
      ft[1],
      /padding\s*:\s*var\(--av-space-6\)/,
      '.ft-part-row padding must be --av-space-6 (24px) so Full Test inputs breathe',
    );
    const pbp = css.match(/\.pbp-part-card\s*\{([^}]+)\}/);
    assert.ok(pbp, '.pbp-part-card rule must exist');
    assert.match(
      pbp[1],
      /padding\s*:\s*var\(--av-space-6\)/,
      '.pbp-part-card padding must be --av-space-6 so Part 1/2/3 cards breathe',
    );
  });

  test('declares a .text-white override scoped to .av-page', () => {
    // See body-class assertion above for the why; this one pins the CSS
    // side of the contract.
    assert.match(
      css,
      /body\.av-page\s+\.text-white\b/,
      'speaking.css must scope its .text-white override to body.av-page so it never leaks to other pages',
    );
  });
});
