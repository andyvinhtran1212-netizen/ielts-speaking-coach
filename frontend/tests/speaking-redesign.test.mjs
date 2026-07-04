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

  test('Tailwind font is Plus Jakarta Sans (inline config OR static build)', () => {
    // P0-3 C-3.4: migrated pages drop the inline config; Plus Jakarta now lives
    // in tailwind.config.cjs, compiled into css/tailwind.build.css.
    const inline = /fontFamily\s*:\s*\{[\s\S]*?sans:\s*\[\s*'Plus Jakarta Sans'/.test(html);
    assert.ok(inline || /css\/tailwind\.build\.css/.test(html),
      'Plus Jakarta via inline config or the static build');
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

  test('Sprint 7.12 — chrome migrated to <aver-chrome active="speaking">', () => {
    // trailing attrs allowed (role-source="page" perf opt-out) — see P1.1/P1.2
    assert.match(html, /<aver-chrome\s+active="speaking"[^>]*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('Sprint 7.12 — inline .av-theme-toggle + bindToggleButton import removed (moved into shadow root)', () => {
    assert.equal(/class="av-theme-toggle"/.test(html), false);
    assert.equal(
      /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"][^'"]*theme-toggle\.js['"]/.test(html),
      false,
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
  test('Sprint 8.1 — main-tab-nav tab row retired (no #mtab-* buttons + no .main-tab-nav element)', () => {
    // Sprint 8.1 deleted the tab row. Mode entry is via the
    // `.mode-card[data-mode]` grid on the dashboard view. The four
    // #tab-{name} panels are still toggled by switchMainTab() — see
    // the panel-id pin below.
    for (const id of ['mtab-dashboard', 'mtab-practice', 'mtab-partbpart', 'mtab-fulltest']) {
      assert.ok(
        !new RegExp(`id="${id}"`).test(html),
        `${id} must NOT exist — Sprint 8.1 retired the tab-row buttons`,
      );
    }
    assert.ok(
      !/<nav[^>]*class="[^"]*\bmain-tab-nav\b/.test(html),
      'speaking.html must NOT carry <nav class="main-tab-nav"> — Sprint 8.1 retired the tab row',
    );
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

  test('greeting + dashboard-empty IDs preserved (Sprint 8.1: continue-cta retired)', () => {
    // Sprint 8.1 deleted #continue-cta + #cta-topic-label +
    // #continue-cta-link. Re-entering practice now happens through the
    // unified `.mode-card` grid. #greeting-name + #dashboard-empty
    // remain — renderUser() and the empty-state branch still target
    // them.
    for (const id of ['greeting-name', 'dashboard-empty']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
    for (const id of ['continue-cta', 'cta-topic-label', 'continue-cta-link']) {
      assert.ok(
        !new RegExp(`id="${id}"`).test(html),
        `#${id} must NOT exist — Sprint 8.1 retired the "Tiếp tục luyện tập" banner`,
      );
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

  test('Sprint 7.12 — user-pill IDs moved into <aver-chrome> shadow root', () => {
    // Sprint 6.17.1 migrated the legacy custom dropdown to the canonical
    // user-pill (#user-pill, #user-avatar, #user-pill-name, #user-menu-logout)
    // shipped inline in the chrome markup. Sprint 7.12 moves the chrome into
    // a Shadow DOM Web Component, so those IDs are no longer in the page DOM —
    // they live inside <aver-chrome>'s shadow root. The renderUser() refactor
    // (this sprint) calls aver-chrome.setUser({ name }) instead of poking
    // #user-pill-name / #user-avatar directly across the shadow boundary.
    for (const id of ['user-pill', 'user-avatar', 'user-pill-name', 'user-menu-logout']) {
      assert.equal(
        new RegExp(`\\bid="${id}"`).test(html),
        false,
        `#${id} must NOT be in page DOM (moved into <aver-chrome> shadow root Sprint 7.12)`,
      );
    }
    // Legacy IDs from Sprint 6.17.1 retirement still must not return.
    for (const id of ['avatar-menu', 'avatar-img', 'btn-logout', 'avatar-wrap', 'avatar-dropdown-wrap']) {
      assert.ok(!new RegExp(`\\bid="${id}"`).test(html),
        `legacy #${id} must remain removed (Sprint 6.17.1 + Sprint 7.12 contracts)`);
    }
  });

  test('Sprint 7.12 — renderUser() delegates pill population to aver-chrome.setUser()', () => {
    // Page-authoritative override pattern: renderUser() carries permissions
    // context from /auth/me and must keep populating the chrome via the
    // typed setUser() API (Phase B Q4 contract) rather than DOM-poking
    // across the shadow boundary.
    assert.match(
      html,
      /document\.querySelector\(\s*['"]aver-chrome['"]\s*\)[\s\S]*?\.setUser\(/,
      'renderUser must call document.querySelector("aver-chrome").setUser(...)',
    );
  });
});


// ── Lucide icon swap (no emoji in nav / cards) ────────────────────


describe('speaking.html / Lucide icon swap', () => {
  // Sprint 8.1 — main-tab-nav emoji + Lucide-in-nav pins retired
  // alongside the tab row itself. The mode-cards' own Lucide audit
  // lives in the Sprint 8.1 sentinel block further below.

  test('the 3 dashboard mode-cards use Lucide icons (no emoji)', () => {
    // Sprint 8.1 renamed "PART 2: Quick Access" → "PART 2: Mode entry
    // cards" and replaced the 3 .part-card divs with .mode-card
    // anchors. Lucide discipline preserved.
    const section = html.match(/<!-- ── PART 2: Mode entry cards[\s\S]*?<\/section>/);
    assert.ok(section, 'PART 2 mode-entry section must exist (Sprint 8.1)');
    const sectionHtml = section[0];
    for (const glyph of ['🎯', '📋', '🏆']) {
      assert.ok(
        !sectionHtml.includes(glyph),
        `mode-card still contains "${glyph}" — canonical pattern uses Lucide`,
      );
    }
    const lucideCount = (sectionHtml.match(/<i\s+data-lucide=/g) || []).length;
    assert.ok(
      lucideCount >= 3,
      `expected ≥ 3 Lucide icons across the 3 mode-cards, found ${lucideCount}`,
    );
  });

  test('Lucide CDN script + hydration fallback are loaded', () => {
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
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
    // Sprint 8.1 — `.part-card` + `.main-tab-nav` + `.main-tab-btn` +
    // `.main-tab-label` + `.main-tab-sub` retired alongside the tab
    // row. `.main-tab-panel` stays — the 4 panels still toggle via
    // switchMainTab().
    // Sprint 9.1 — `.mode-card` + `.modes-grid` were lifted from
    // speaking.css to components.css as a shared primitive (consumed
    // by speaking + vocabulary + flashcards + exercises). They are
    // NOT pinned in this speaking-page roster any more — see Sprint
    // 9.1 sentinel block below for the components.css pins.
    const requiredClasses = [
      '.sidebar-bg', '.main-bg',
      '.stat-card',
      '.btn-start', '.btn-fulltest', '.btn-test',
      '.skeleton', '.session-row',
      '.badge-done', '.badge-pending',
      '.modal-backdrop', '.modal-box',
      '.topic-tab', '.topic-input', '.btn-confirm', '.modal-error',
      '.main-tab-panel',
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

  // Sprint 8.1 — `.main-tab-btn` padding/nowrap pin retired alongside
  // the tab-row markup. The Sprint 6.4.1 padding-scale lesson is now
  // enforced at the global-token level (--av-space-4/--av-space-6).

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


// ── Sprint 8.1 — mode-card grid + IA refactor ─────────────────────


describe('Sprint 8.1 — speaking.html dashboard mode-card grid', () => {
  test('3 .mode-card anchors with canonical data-mode attributes', () => {
    // The page-load contract: switchMainTab() reads card.dataset.mode
    // for delegation. data-mode values must match the four panel IDs
    // minus 'dashboard' (which is the default landing state).
    for (const mode of ['practice', 'partbpart', 'fulltest']) {
      assert.match(
        html,
        new RegExp(`<a[^>]*class="[^"]*\\bmode-card\\b[^"]*"[^>]*data-mode="${mode}"`),
        `mode-card[data-mode="${mode}"] must exist as an <a> element`,
      );
    }
  });

  test('mode-card grid uses the canonical headings + section wrapper', () => {
    assert.match(
      html,
      /<section[^>]*class="[^"]*\bspeaking-modes\b[^"]*"[^>]*aria-labelledby="modes-heading"/,
      '.speaking-modes section must carry aria-labelledby="modes-heading"',
    );
    assert.match(
      html,
      /<h2[^>]*id="modes-heading"[^>]*>\s*Bắt đầu luyện tập\s*<\/h2>/,
      'the section heading must read "Bắt đầu luyện tập" (Phase B Andy decision)',
    );
    assert.match(
      html,
      /<div[^>]*class="[^"]*\bmodes-grid\b/,
      '.modes-grid wrapper must exist',
    );
  });

  test('mode-card click delegation wired via DOMContentLoaded + data-mode', () => {
    // The delegation block lives in the inline <script> at the foot of
    // speaking.html. It selects `.mode-card[data-mode]` and routes the
    // click through switchMainTab(card.dataset.mode) — the same panel
    // toggle used by the empty-state button. preventDefault keeps the
    // `href="#"` from advancing the URL hash.
    assert.match(
      html,
      /querySelectorAll\(\s*['"]\.mode-card\[data-mode\]['"]\s*\)/,
      'inline JS must querySelectorAll(".mode-card[data-mode]") for delegation',
    );
    assert.match(
      html,
      /switchMainTab\s*\(\s*card\.dataset\.mode\s*\)/,
      'mode-card click handler must call switchMainTab(card.dataset.mode)',
    );
  });

  test('switchMainTab no longer toggles tab-row buttons (Sprint 8.1 trim)', () => {
    // Sprint 8.1 deleted the #mtab-{tab} button-toggle branch from
    // switchMainTab. The function still toggles the four #tab-{name}
    // panels and still lazy-loads topics for practice/partbpart.
    const fn = html.match(/function\s+switchMainTab\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fn, 'switchMainTab function block must be extractable');
    assert.ok(
      !/document\.getElementById\(\s*['"]mtab-/.test(fn[1]),
      'switchMainTab must NOT reference #mtab-* button IDs — Sprint 8.1 retired the tab row',
    );
    assert.match(
      fn[1],
      /document\.getElementById\(\s*['"]tab-['"]\s*\+\s*t/,
      'switchMainTab must still resolve #tab-{name} panels',
    );
  });

  test('default landing state — #tab-dashboard ships .active by default', () => {
    // Page-load contract: dashboard is the default view. Sprint 8.1
    // moved the "active" marker from `.main-tab-btn.active` (button)
    // to `.main-tab-panel.active` (panel) since the button row is
    // gone.
    assert.match(
      html,
      /<div\s+id="tab-dashboard"[^>]*class="[^"]*\bmain-tab-panel\b[^"]*\bactive\b/,
      '#tab-dashboard must carry .active by default (page default landing state)',
    );
  });

  test('permission gating extends to .mode-card[data-mode] selectors', () => {
    // Sprint 8.1: applyPermissions() was extended to disable mode-cards
    // by data-mode attribute (in addition to the legacy [onclick*=...]
    // and .btn-fulltest selectors). Regression guard.
    assert.match(
      html,
      /\.mode-card\[data-mode="practice"\]/,
      'applyPermissions must include .mode-card[data-mode="practice"] in the practice_single gate',
    );
    assert.match(
      html,
      /\.mode-card\[data-mode="partbpart"\]/,
      'applyPermissions must include .mode-card[data-mode="partbpart"] in the practice_part gate',
    );
    assert.match(
      html,
      /\.mode-card\[data-mode="fulltest"\]/,
      'applyPermissions must include .mode-card[data-mode="fulltest"] in the practice_full gate',
    );
  });
});


describe('Sprint 9.1 — .mode-card primitive lifted to components.css', () => {
  // Sprint 9.1 — the .mode-card + .modes-grid rules were promoted
  // from speaking.css (Sprint 8.1) + vocabulary.css (Sprint 8.2) to
  // components.css when the 3rd adopter (vocab sub-pages) fired the
  // rule-of-three trigger. These pins assert the primitive lives in
  // its new canonical home.
  let componentsCSS;
  before(() => {
    componentsCSS = readFileSync(
      path.join(__dirname, '..', 'css', 'aver-design', 'components.css'),
      'utf8',
    );
  });

  test('components.css declares the .mode-card inner-class skeleton', () => {
    for (const sel of ['.mode-card', '.modes-grid', '.mode-card .head', '.mode-card .icon', '.mode-card .arrow', '.mode-card h3', '.mode-card .lede']) {
      const escaped = sel.replace(/\./g, '\\.');
      assert.match(
        componentsCSS,
        new RegExp(`${escaped}\\s*\\{`),
        `components.css must declare ${sel} (Sprint 9.1 mode-card primitive)`,
      );
    }
  });

  test('.modes-grid uses auto-fit minmax(260px) in components.css', () => {
    const m = componentsCSS.match(/\.modes-grid\s*\{([^}]+)\}/);
    assert.ok(m, '.modes-grid rule must exist in components.css');
    assert.match(
      m[1],
      /grid-template-columns\s*:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*260px/,
      '.modes-grid grid-template-columns must use auto-fit minmax(260px, 1fr)',
    );
  });

  test('.mode-card surface uses canonical --av-* tokens in components.css', () => {
    const m = componentsCSS.match(/\.mode-card\s*\{([^}]+)\}/);
    assert.ok(m, '.mode-card rule must exist in components.css');
    assert.match(m[1], /background\s*:\s*var\(--av-surface-card\)/);
    assert.match(m[1], /border\s*:\s*1px solid var\(--av-border-subtle\)/);
    assert.match(m[1], /border-radius\s*:\s*var\(--av-radius-lg\)/);
  });

  test('speaking.css no longer redeclares .mode-card / .modes-grid (Sprint 9.1 lift)', () => {
    for (const sel of ['.mode-card', '.modes-grid']) {
      const escaped = sel.replace(/\./g, '\\.');
      const re = new RegExp(`^${escaped}\\s*\\{`, 'm');
      assert.ok(
        !re.test(css),
        `speaking.css must NOT redeclare ${sel} — Sprint 9.1 lifted it to components.css`,
      );
    }
  });
});


describe('Sprint 8.1 — retired CSS surfaces', () => {
  test('speaking.css no longer declares .main-tab-nav / .main-tab-btn / .main-tab-label / .main-tab-sub', () => {
    // Sprint 8.1 retired the four tab-row rules. .main-tab-panel
    // stays — see the required-classes roster above.
    for (const sel of ['.main-tab-nav', '.main-tab-btn', '.main-tab-label', '.main-tab-sub']) {
      const escaped = sel.replace(/\./g, '\\.');
      const re = new RegExp(`^${escaped}\\s*[\\s,{:]`, 'm');
      assert.ok(
        !re.test(css),
        `speaking.css must NOT redeclare ${sel} — Sprint 8.1 retired the tab-row rules`,
      );
    }
  });

  test('speaking.css no longer declares .part-card', () => {
    assert.ok(
      !/^\.part-card\s*\{/m.test(css),
      'speaking.css must NOT redeclare .part-card — Sprint 8.1 replaced the 3 part-cards with .mode-card',
    );
  });
});


// ─────────────────────────────────────────────────────────────────────
// Sprint 9.2 — speaking mode panels adopt .subpage-header + back-link.
//
// Pre-Sprint-9.2, the 3 speaking mode panels (#tab-practice /
// #tab-partbpart / #tab-fulltest) used an ad-hoc inline header:
//   <p class="eyebrow">Speaking</p>
//   <h1 class="text-2xl ...">Title</h1>
//   <p class="text-sm ...">Description</p>
//
// Sprint 9.2 promotes the eyebrow + title rows to the canonical
// .subpage-header primitive (lifted to components.css in Sprint 9.1)
// with an interactive back-link button replacing the static eyebrow.
// The description paragraph stays underneath the header as a separate
// <p>. The back-link click is delegated to switchMainTab('dashboard')
// in the inline JS so the user returns to the speaking dashboard
// without a page reload.
// ─────────────────────────────────────────────────────────────────────

describe('Sprint 9.2 — speaking mode panels ship .subpage-header with Speaking back-link', () => {
  const PANELS = [
    { id: 'tab-practice',  title: 'Luyện tập' },
    { id: 'tab-partbpart', title: 'Luyện từng Part' },
    { id: 'tab-fulltest',  title: 'Full Test' },
  ];

  PANELS.forEach(({ id, title }) => {
    test(`#${id} panel ships a .subpage-header with .subpage-header__back to Speaking`, () => {
      // Capture the panel's first ~30 lines and assert structure.
      const re = new RegExp(
        `<div\\s+id="${id}"[^>]*>[\\s\\S]{0,2500}`,
      );
      const block = html.match(re);
      assert.ok(block, `${id} panel must be extractable`);
      assert.match(
        block[0],
        /<header[^>]*\bclass="[^"]*\bsubpage-header\b[^"]*"/,
        `${id} must open with a .subpage-header element`,
      );
      assert.match(
        block[0],
        /<button[^>]*\bclass="subpage-header__back"[^>]*\bdata-action="back-to-dashboard"[^>]*\baria-label="Quay về dashboard Speaking"/,
        `${id} must ship the Sprint 9.2 back-link button with the Speaking aria-label`,
      );
      assert.match(
        block[0],
        /<i\s+data-lucide="arrow-left"[^>]*><\/i>\s*<span>Speaking<\/span>/,
        `${id} back-link must contain a lucide arrow-left icon followed by "Speaking" label`,
      );
      const titleRe = new RegExp(
        `<h1[^>]*\\bclass="[^"]*\\bsubpage-header__title\\b[^"]*"[^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h1>`,
      );
      assert.match(
        block[0],
        titleRe,
        `${id} must carry the canonical title "${title}" inside .subpage-header__title`,
      );
    });

    test(`#${id} no longer ships the pre-Sprint-9.2 <p class="eyebrow">Speaking</p>`, () => {
      const re = new RegExp(
        `<div\\s+id="${id}"[^>]*>[\\s\\S]{0,2500}`,
      );
      const block = html.match(re);
      assert.ok(block, `${id} panel must be extractable`);
      assert.ok(
        !/<p[^>]*\bclass="eyebrow"[^>]*>\s*Speaking\s*<\/p>/.test(block[0]),
        `${id} must NOT redeclare the legacy static <p class="eyebrow">Speaking</p> — Sprint 9.2 promoted it to a back-link`,
      );
    });
  });

  test('inline JS wires back-to-dashboard click to switchMainTab(\'dashboard\')', () => {
    // The delegation lives inside the DOMContentLoaded handler that
    // also binds the mode-card clicks (Sprint 8.1). Pin both signatures.
    assert.match(
      html,
      /\[data-action="back-to-dashboard"\]/,
      'inline JS must reference the back-link selector',
    );
    assert.match(
      html,
      /switchMainTab\(\s*['"]dashboard['"]\s*\)/,
      'inline JS must call switchMainTab(\'dashboard\') in the back-link branch',
    );
    assert.match(
      html,
      /#tab-practice,\s*#tab-partbpart,\s*#tab-fulltest/,
      'back-link delegation must scope to the 3 mode-panel selectors',
    );
  });
});

// ── 2026-07-02 — progress charts work for practice-only users ───────────────
describe('2026-07-02 — Band-over-time chart uses overall_band', () => {
  const html = readFileSync(path.join(__dirname, '..', 'pages', 'speaking.html'), 'utf8');

  test('line chart leads with an overall_band dataset (practice sessions have only overall)', () => {
    // Practice grading is holistic — no band_fc/lr/gra/p — so the "band score
    // theo thời gian" line MUST plot overall_band or it is blank for practice users.
    assert.match(html, /lineDS\(\s*'Tổng \(Overall\)'\s*,\s*'overall_band'/);
  });

  test('the 4-criteria lines are conditional on having criteria data', () => {
    assert.match(html, /var hasCriteria = completed\.some/);
    assert.match(html, /if \(hasCriteria\)/);
  });

  test('radar empty state explains a full Test is needed', () => {
    assert.match(html, /Test đầy đủ/);
  });
});


// ── Perf P2.2 — skeletons replace misleading first-paint placeholders ────────
describe('Perf P2.2 — dashboard skeleton on first paint', () => {
  const html = readFileSync(path.join(__dirname, '..', 'pages', 'speaking.html'), 'utf8');

  test('each hero-stat value paints a .skeleton span (no static 0/— flash)', () => {
    for (const id of ['stat-band', 'stat-total', 'stat-last-date', 'stat-streak']) {
      const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</p>`));
      assert.ok(m, `#${id} <p> must exist`);
      assert.match(m[1], /class="skeleton"/, `#${id} must render a skeleton placeholder, not a static 0/—`);
    }
  });

  test('renderStats clears the band + last-date skeletons on the no-data path', () => {
    // Without an else-branch the shimmer would run forever for users with no
    // 30-day band / no sessions.
    assert.match(html, /getElementById\('stat-band'\)\.textContent = '—';/);
    assert.match(html, /getElementById\('stat-last-date'\)\.textContent = '—';/);
  });

  test('history shows a skeleton, and the empty state is hidden until confirmed', () => {
    assert.match(html, /id="history-skeleton"/, 'history skeleton placeholder must exist');
    // history-empty must NOT show on first paint (old flash) — hidden by default.
    assert.match(html, /id="history-empty"[^>]*class="[^"]*\bhidden\b/,
      '#history-empty must be hidden by default (revealed only when 0 sessions confirmed)');
  });

  test('renderHistory resolves the skeleton and picks empty|table from the result', () => {
    assert.match(html, /getElementById\('history-skeleton'\)[\s\S]*?classList\.add\('hidden'\)/);
    // filtered 0-result must NOT claim "no sessions" — gated on active filters.
    assert.match(html, /_historyHasActiveFilters\(\)\) emptyEl\.classList\.add\('hidden'\)/);
  });
});


// ── Perf P2.1 — SWR for DISPLAY-ONLY dashboard aggregate ─────────────────────
describe('Perf P2.1 — dashboard SWR cache (display-only)', () => {
  const html = readFileSync(path.join(__dirname, '..', 'pages', 'speaking.html'), 'utf8');

  test('caches into sessionStorage keyed by user id, TTL-bounded', () => {
    assert.match(html, /function _dashCacheKey\(uid\)\s*{\s*return 'swr:dash:' \+ uid/);
    assert.match(html, /_DASH_SWR_TTL_MS/);
    assert.match(html, /sessionStorage\.getItem\(_dashCacheKey/);
    assert.match(html, /sessionStorage\.setItem\(_dashCacheKey/);
    // max-age guard so we never paint very old numbers
    assert.match(html, /Date\.now\(\) - o\.t\) > _DASH_SWR_TTL_MS/);
  });

  test('paints cached stats + charts before the live fetch resolves', () => {
    assert.match(html, /_readDashCache\(_uid\)/);
    assert.match(html, /if \(_cachedDash && _cachedDash\.summary\)/);
  });

  test('ONLY display data is cached — never /auth/me permissions', () => {
    // the write payload is exactly {summary, sessions} — no permissions/role.
    assert.match(html, /_writeDashCache\(_uid, \{\s*summary: aggregate\.summary,\s*sessions: aggregate\.sessions \|\| \[\],\s*\}\)/);
    // canonical-truth guardrail: the /auth/me payload must never be persisted.
    assert.doesNotMatch(html, /setItem\([^)]*auth\/me/);
    assert.doesNotMatch(html, /_writeDashCache\([^)]*permissions/);
  });
});


// ── Perf P1.3 follow-up (Codex P3) — history count shows the paginated total ──
describe('Perf P1.3 follow-up — history count uses response total', () => {
  const html = readFileSync(path.join(__dirname, '..', 'pages', 'speaking.html'), 'utf8');

  it('renderHistory accepts a total and shows it (not just the current page length)', () => {
    assert.match(html, /function renderHistory\(sessions, total\)/);
    assert.match(html, /const count = \(typeof total === 'number'\) \? total : visible\.length;/);
    assert.match(html, /history-count'\)\.textContent = `\$\{count\} sessions`/);
  });

  it('loadHistory passes the paginated total into renderHistory', () => {
    assert.match(html, /renderHistory\(sessions, total\);/);
  });
});
