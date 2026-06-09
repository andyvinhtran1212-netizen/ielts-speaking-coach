/**
 * frontend/tests/home-redesign.test.mjs — Sprint 6.3.
 *
 * Run with: node --test frontend/tests/home-redesign.test.mjs
 *
 * Pins the home.html redesign onto the Aver Design System foundation.
 * The page is HEAVILY JS-driven (js/home.js renderSkillCard replaces
 * innerHTML on .skill-card.skeleton elements), so the tests focus on
 * the contract between markup and JS rather than rendered text:
 *
 *   • foundation files are linked and ordered correctly
 *   • the anti-flash IIFE runs before stylesheets
 *   • JS-coupled IDs (#hero-streak, #hero-sessions, #hero-essays,
 *     #greeting-name, #user-pill, #user-avatar, #user-pill-name,
 *     #error-banner) are present so renderHero / user-pill bootstrap
 *     can find them
 *   • the 4 active + 2 coming-soon .skill-card.skeleton placeholders
 *     are present (data-skill values matter — home.js iterates them)
 *   • the .value-num / .unit children inside hero stats are present
 *     (renderHero querySelector reaches in for these)
 *   • theme toggle button + module wiring is in place
 *   • Vietnamese microcopy lifted from UNIFIED_DESIGN_BRIEF
 *
 * What the tests deliberately do NOT pin: the visual styling (covered
 * by the home.css file checks below) and the dynamic card content
 * (covered by frontend/tests/home.test.js which exercises home.js
 * directly via window.__home).
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
    path.join(__dirname, '..', 'pages', 'home.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'home.css'),
    'utf8',
  );
});


// ── Foundation links ────────────────────────────────────────────────


describe('home.html / foundation links', () => {
  test('links Aver tokens.css before components.css', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx,
      'tokens.css must load before components.css so cascade resolves',
    );
  });

  test('links page-specific home.css after the foundation', () => {
    const componentsIdx = html.indexOf('aver-design/components.css');
    const homeIdx = html.indexOf('css/home.css');
    assert.ok(homeIdx > componentsIdx, 'home.css must load after components.css');
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import Manrope, Fraunces, or Inter (legacy fonts)', () => {
    assert.ok(!/family=Manrope/.test(html), 'Manrope was Sprint 6.2 — removed in 6.3 redesign');
    assert.ok(!/family=Fraunces/.test(html), 'Fraunces was Sprint 6.2 — removed in 6.3 redesign');
    assert.ok(!/family=Inter[:&]/.test(html), 'Inter must not return on the redesigned page');
  });

  test('does NOT link legacy ds.css (page is on Aver tokens)', () => {
    assert.ok(!/css\/ds\.css/.test(html), 'home.html should no longer use the legacy --ds-* token sheet');
  });
});


// ── CLS reservation (P0-3) ─────────────────────────────────────────
// home.js renders short .skill-card.skeleton placeholders on first paint
// then swaps in much taller hydrated cards. Without a reserved height the
// grid row jumps ~140px on hydration (the page's dominant CLS source). The
// base .skill-card rule must carry a min-height so skeleton and real card
// occupy the same box. Measured real card height is 258–281px across widths.


describe('home.css / skill-card CLS height reservation', () => {
  test('.skill-card reserves a min-height so the skeleton swap does not shift layout', () => {
    // Match the base `.skill-card {…}` rule only (not .skill-card.skeleton / :hover / .coming-soon).
    const m = css.match(/\.skill-card\s*\{([^}]*)\}/);
    assert.ok(m, 'base .skill-card rule must exist in home.css');
    const minH = m[1].match(/min-height:\s*(\d+)px/);
    assert.ok(minH, '.skill-card must declare a min-height to reserve card height (CLS guard)');
    assert.ok(
      Number(minH[1]) >= 240,
      `min-height must be >= 240px to cover the rendered card (got ${minH[1]}px)`,
    );
  });
});


// ── Anti-flash bootstrap ───────────────────────────────────────────


describe('home.html / anti-flash theme bootstrap', () => {
  test('inline IIFE runs in <head>', () => {
    // The IIFE must appear before any <link rel="stylesheet">.
    const iifeIdx = html.indexOf("localStorage.getItem('av-theme')");
    const firstLinkIdx = html.search(/<link\s+rel="stylesheet"/);
    assert.ok(iifeIdx > -1, 'theme bootstrap IIFE must be present');
    assert.ok(firstLinkIdx > -1, 'page must link at least one stylesheet');
    assert.ok(
      iifeIdx < firstLinkIdx,
      'theme IIFE must run BEFORE any stylesheet to prevent flash',
    );
  });

  test('IIFE applies data-theme attribute on documentElement', () => {
    assert.match(
      html,
      /document\.documentElement\.setAttribute\(\s*['"]data-theme['"]/,
    );
  });

  test('IIFE handles localStorage failure (privacy mode)', () => {
    // Look for a try/catch around the localStorage read.
    assert.match(html, /try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/);
  });
});


// ── Theme toggle ───────────────────────────────────────────────────


describe('home.html / chrome (Sprint 7.12 — <aver-chrome> Web Component)', () => {
  test('renders <aver-chrome active="home"> (theme toggle inside shadow root)', () => {
    assert.match(html, /<aver-chrome\s+active="home"\s*>/);
  });

  test('loads /js/components/aver-chrome.js as ES module (registers element)', () => {
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('no inline .av-theme-toggle / theme-toggle.js binding (chrome moved into shadow root)', () => {
    assert.equal(/class="av-theme-toggle"/.test(html), false);
    assert.equal(
      /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"][.\/]*js\/theme-toggle\.js['"]/.test(html),
      false,
    );
  });
});


// ── JS-coupled IDs and selectors ───────────────────────────────────


describe('home.html / JS-coupled selectors (home.js contract)', () => {
  test('#greeting-name span exists (renderHero target)', () => {
    assert.match(html, /id="greeting-name"/);
  });

  test('hero-stat IDs are present and unrenamed', () => {
    // These three IDs are reached by getElementById in renderHero. The
    // spec proposed #stat-speaking / #stat-writing / #stat-vocab — but
    // home.js looks for #hero-streak / #hero-sessions / #hero-essays.
    // Renaming to the spec's IDs would break the data binding (Risk #5
    // in the sprint spec, called out explicitly).
    assert.match(html, /id="hero-streak"/);
    assert.match(html, /id="hero-sessions"/);
    assert.match(html, /id="hero-essays"/);
  });

  test('hero-stat inner .value-num + .unit spans exist', () => {
    // renderHero querySelector('.value-num') and ('.unit') reach in
    // for these. Without them, the streak / sessions / essays numbers
    // never render.
    const valueNumCount = (html.match(/class="value-num"/g) || []).length;
    const unitCount = (html.match(/class="unit"/g) || []).length;
    assert.ok(
      valueNumCount >= 3,
      `expected at least 3 .value-num spans (one per hero-stat), found ${valueNumCount}`,
    );
    assert.ok(
      unitCount >= 3,
      `expected at least 3 .unit spans (one per hero-stat), found ${unitCount}`,
    );
  });

  test('user-pill IDs no longer in page DOM (Sprint 7.12 — moved into <aver-chrome> shadow root)', () => {
    assert.equal(/\bid="user-pill"/.test(html), false);
    assert.equal(/\bid="user-avatar"/.test(html), false);
    assert.equal(/\bid="user-pill-name"/.test(html), false);
  });

  test('error banner is present and starts hidden', () => {
    assert.match(html, /id="error-banner"/);
    assert.match(
      html,
      /id="error-banner"[^>]*\bhidden\b/,
      'error banner should be hidden by default — JS un-hides on fetch failure',
    );
  });
});


// ── Skill cards ────────────────────────────────────────────────────


describe('home.html / skill-card skeletons', () => {
  test('has .skill-card.skeleton placeholders for all 4 active skills', () => {
    // home.js iterates SKILLS_ORDER = ['writing','speaking','grammar','vocabulary']
    // and reaches in via querySelector('[data-skill="..."]'). All four
    // placeholders must be present and start as .skeleton (so the page
    // reads as "loading" before the API responds).
    for (const skill of ['writing', 'speaking', 'grammar', 'vocabulary']) {
      const re = new RegExp(
        `<article[^>]*class="skill-card skeleton"[^>]*data-skill="${skill}"`,
      );
      assert.match(html, re, `missing .skill-card.skeleton for ${skill}`);
    }
  });

  test('has .skill-card.skeleton placeholders for 2 coming-soon skills', () => {
    // home.js iterates COMING_SOON_ORDER = ['reading','listening']. The
    // article elements must exist as skeletons; the JS later swaps them
    // into the .coming-soon variant when it sees status='coming_soon'
    // (or the default fallback in loadHome's COMING_SOON_ORDER call).
    for (const skill of ['reading', 'listening']) {
      const re = new RegExp(
        `<article[^>]*class="skill-card skeleton"[^>]*data-skill="${skill}"`,
      );
      assert.match(html, re, `missing .skill-card.skeleton for ${skill}`);
    }
  });

  test('skill-card placeholders are empty (JS replaces innerHTML wholesale)', () => {
    // If the redesign baked static content into the cards (e.g., "Vào
    // luyện →" before the API responds), it would briefly display until
    // home.js overwrote it. Keep them empty so the only visible state
    // before render is the CSS skeleton ::before / ::after pulse.
    const articles = html.match(
      /<article\s+class="skill-card skeleton"[^>]*>[\s\S]*?<\/article>/g,
    ) || [];
    assert.ok(articles.length === 6, `expected 6 skeleton articles, found ${articles.length}`);
    for (const article of articles) {
      const innerStart = article.indexOf('>') + 1;
      const innerEnd = article.lastIndexOf('</article>');
      const inner = article.slice(innerStart, innerEnd).trim();
      assert.equal(
        inner,
        '',
        'skill-card.skeleton must have empty inner HTML — home.js writes the content',
      );
    }
  });

  test('uses the .skill-grid class for layout (preserved from Sprint 5.1)', () => {
    assert.match(html, /class="skill-grid"/);
  });
});


// ── Vietnamese microcopy (lifted from UNIFIED_DESIGN_BRIEF) ────────


describe('home.html / Vietnamese microcopy', () => {
  test('greeting uses "Xin chào, {name}" pattern', () => {
    assert.match(html, /Xin chào,\s*<span[^>]*id="greeting-name"/);
  });

  test('lede copy is present and on-brand', () => {
    // The exact wording from Sprint 5.1 was good copy; preserve it as
    // the warm-teacher tone matches DESIGN_SYSTEM.md § 1 (Brand voice).
    assert.match(html, /Tiếp tục hành trình IELTS/);
    assert.match(html, /luyện đều mỗi ngày/);
  });

  test('coming-soon section title uses "Sắp ra mắt"', () => {
    assert.match(html, /Sắp ra mắt/);
  });

  test('section title for active skills uses "Kỹ năng IELTS"', () => {
    assert.match(html, /Kỹ năng IELTS/);
  });

  test('does NOT use Title Case headings', () => {
    // Heuristic check: heading content like ">Xin Chào<" or ">Kỹ Năng<"
    // would indicate Title Case slipped in. Allow capitalized first
    // word, but flag if every word inside an <h1>/<h2> starts with a
    // capital letter (>3 words, Vietnamese-aware).
    const headings = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g) || [];
    for (const heading of headings) {
      const text = heading.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, '').trim();
      const words = text.split(/\s+/).filter(w => /[a-zA-ZÀ-ỹ]/.test(w));
      if (words.length < 3) continue;
      const allCapitalized = words.every(w => /^[A-ZĐÀ-Ỹ]/.test(w));
      assert.ok(
        !allCapitalized,
        `heading "${text}" looks like Title Case — DESIGN_SYSTEM.md mandates sentence case`,
      );
    }
  });
});


// ── home.css token usage ───────────────────────────────────────────


describe('home.css / token discipline', () => {
  test('references --av-* tokens throughout', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 80,
      `home.css must reference --av-* tokens heavily (found ${avRefs}); ` +
      `if this drops, components are likely hardcoding colors`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    // The page migrated from --ds-* (Sprint 5.1 / 6.2) to --av-* (6.3).
    // Carrying both is double-bookkeeping that drifts.
    assert.ok(
      !/var\(--ds-/.test(css),
      'home.css should be fully migrated off --ds-* tokens (DEBT-2026-05-09-C)',
    );
  });

  test('does NOT reference unprefixed legacy tokens like --bg / --accent', () => {
    assert.ok(!/var\(--bg\)/.test(css));
    assert.ok(!/var\(--accent\)/.test(css));
    assert.ok(!/var\(--text\)/.test(css));
    assert.ok(!/var\(--border\)/.test(css));
  });

  test('avoids hardcoded teal color values', () => {
    // The brand teal lives in tokens. Hardcoded #0F766E or #14B8A6 in a
    // page-specific stylesheet is a drift creator (Anti-pattern § 8.1).
    assert.ok(!/#0[Ff]766[Ee]/.test(css), 'hardcoded #0F766E found — use var(--av-primary)');
    assert.ok(!/#14[Bb]8[Aa]6/.test(css), 'hardcoded #14B8A6 found — use var(--av-primary) (dark resolves automatically)');
  });

  test('does not declare its own body background (av-page handles it)', () => {
    // In Sprint 6.2 the body background was provided by ds.css's
    // body.ds-canvas rule. In 6.3, it comes from the .av-page class
    // applied to <body>, which resolves through --av-surface-page.
    // Page-specific home.css declaring body { background: ... } would
    // conflict with theme switching.
    assert.ok(
      !/\bbody\s*\{[^}]*background\s*:/.test(css),
      'home.css must not declare body background — .av-page handles it via tokens',
    );
  });
});


// ── home.html body class ───────────────────────────────────────────


describe('home.html / body class', () => {
  test('body opts into .av-page (Aver page surface)', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });

  test('body does NOT carry the legacy ds-canvas class', () => {
    // ds-canvas applies the dark navy ground from ds.css. The redesign
    // is light-default with [data-theme] flipping; ds-canvas would
    // collide with that.
    assert.ok(
      !/<body[^>]*class="[^"]*\bds-canvas\b[^"]*"/.test(html),
      'home.html should drop ds-canvas — av-page + [data-theme] handle theming',
    );
  });
});
