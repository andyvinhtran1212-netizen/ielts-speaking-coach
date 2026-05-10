/**
 * frontend/tests/speaking-redesign.test.mjs — Sprint 6.4.
 *
 * Run with: node --test frontend/tests/speaking-redesign.test.mjs
 *
 * Pins the Sprint 6.4 redesign of /pages/speaking.html. The page is
 * 2,200+ lines with deeply inline JS, so the redesign was scoped:
 *   • fonts swapped: Manrope+Fraunces → Plus Jakarta Sans + JetBrains Mono
 *   • Aver Design System foundation linked (tokens.css + components.css)
 *   • inline <style> block extracted to /css/speaking.css using --av-* tokens
 *   • main-tab-nav emojis replaced with Lucide icons
 *   • dashboard quick-access card emojis replaced with Lucide icons
 *
 * Scope-deviated (deliberate, called out in PR body):
 *   • The page stays dark-only on Sprint 6.4. The inline <head> IIFE
 *     forces data-theme="dark" because ~159 hardcoded rgba(255,255,255)
 *     inline color values in tab panels + history table would render
 *     invisible on light theme. Theme toggle button is omitted.
 *   • A follow-up sweep sprint will migrate the inline color values and
 *     restore the toggle.
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


describe('speaking.html / dark-only stance', () => {
  test('inline IIFE forces data-theme="dark" before stylesheets', () => {
    // The IIFE must run before any <link rel="stylesheet">. Without
    // it, the page would render in the user's globally chosen theme,
    // which is light by default → the ~159 inline rgba(255,255,255)
    // color values would all become invisible.
    const iifeIdx = html.indexOf("setAttribute('data-theme', 'dark')");
    const firstLinkIdx = html.search(/<link\s+rel="stylesheet"/);
    assert.ok(iifeIdx > -1, 'data-theme="dark" force-IIFE must be present');
    assert.ok(firstLinkIdx > -1, 'page must link at least one stylesheet');
    assert.ok(
      iifeIdx < firstLinkIdx,
      'force-dark IIFE must run BEFORE any stylesheet to prevent flash',
    );
  });

  test('does NOT include the theme toggle button', () => {
    // The toggle is intentionally omitted on this page. Adding it
    // back without first sweeping the inline color values means the
    // user can flip into a broken light-theme state.
    assert.ok(
      !/class="av-theme-toggle"/.test(html),
      'speaking.html must NOT show the theme toggle until the inline-style sweep ships',
    );
  });

  test('does NOT call bindToggleButton (no toggle wired)', () => {
    assert.ok(
      !/bindToggleButton/.test(html),
      'no toggle is rendered, so bindToggleButton must not be imported',
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
    assert.ok(
      lucideCount >= 6,
      `expected ≥ 6 Lucide icons in main-tab-nav (4 buttons + 2 anchor links), found ${lucideCount}`,
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
});
