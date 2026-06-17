/**
 * frontend/tests/writing-result-redesign.test.mjs — Sprint 6.8.
 *
 * Run with: node --test frontend/tests/writing-result-redesign.test.mjs
 *
 * Pins the Sprint 6.8 SURGICAL migration of /pages/writing-result.html.
 * The page is a 671-line graded-essay feedback view backed by ~290
 * lines of inline JS plus a shared section-dispatch renderer
 * (/js/writing-renderers.js). The redesign preserves every JS-coupled
 * selector, content-{key} render target, tier-aware copy, and the
 * 5-state showState contract byte-identical.
 *
 * Pre-work clarified the spec's "Era A/B reconcile" premise was
 * falsified: backend stamps all essays uniformly as v2.1 (Sprint
 * 2.6.2), Migration 045 collapsed v2.1-quick → v2.1, and the renderer
 * already handles the L1/L2+ optional-section matrix via emptyShape().
 * These pins guard the actual production contract, not the
 * hypothetical Era reconcile that doesn't exist.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


let html;
let css;
let renderersCss;

before(() => {
  html = readFileSync(
    path.join(__dirname, '..', 'pages', 'writing-result.html'),
    'utf8',
  );
  css = readFileSync(
    path.join(__dirname, '..', 'css', 'writing-result.css'),
    'utf8',
  );
  renderersCss = readFileSync(
    path.join(__dirname, '..', 'css', 'writing-renderers.css'),
    'utf8',
  );
});


// ── Foundation links ──────────────────────────────────────────────


describe('writing-result.html / foundation links', () => {
  test('links Aver tokens.css before components.css before renderers + page', () => {
    const tokensIdx = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const renderersIdx = html.indexOf('css/writing-renderers.css');
    const pageIdx = html.indexOf('css/writing-result.css');
    assert.ok(tokensIdx > -1, 'tokens.css must be linked');
    assert.ok(componentsIdx > -1, 'components.css must be linked');
    assert.ok(renderersIdx > -1, 'writing-renderers.css must be linked');
    assert.ok(pageIdx > -1, 'writing-result.css must be linked');
    assert.ok(
      tokensIdx < componentsIdx && componentsIdx < renderersIdx && renderersIdx < pageIdx,
      'load order must be tokens → components → renderers → page',
    );
  });

  test('does NOT link ds.css (page consumed 0 .ds-* classes per pre-work)', () => {
    assert.ok(
      !/css\/ds\.css/.test(html),
      'writing-result.html consumed 0 .ds-* classes in production; ds.css link not needed',
    );
  });

  test('imports Plus Jakarta Sans + JetBrains Mono', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
  });

  test('does NOT import legacy Inter font', () => {
    assert.ok(
      !/family=Inter[:&]/.test(html),
      'Inter was the pre-6.8 font; Sprint 6.8 migration removes it',
    );
  });
});


// ── Theme support (Sprint 6.6.1 canonical IIFE) ───────────────────


describe('writing-result.html / theme support', () => {
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
    assert.ok(
      !/var\s+theme\s*=\s*stored\s*\|\|/.test(html),
      'IIFE must not use the weak short-circuit (Sprint 6.6.1 rule)',
    );
  });

  test('IIFE does NOT hardcode data-theme="dark" (no force-dark, no DEBT)', () => {
    const forceDark = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]dark['"]\s*\)/.test(html);
    assert.ok(
      !forceDark,
      'force-dark setAttribute must NOT exist — writing-result supports both themes from Sprint 6.8',
    );
  });

  test('Sprint 7.13 — chrome migrated to <aver-chrome active="writing">', () => {
    assert.match(html, /<aver-chrome\s+active="writing"\s*>/);
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


// ── 5-state showState contract ────────────────────────────────────


describe('writing-result.html / 5-state showState contract', () => {
  test('all 5 state container IDs preserved', () => {
    for (const id of [
      'state-loading',
      'state-error',
      'state-not-delivered',
      'state-flagged',
      'state-ready',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain — showState() looks it up`);
    }
  });

  test('showState() declares all 5 state keys', () => {
    // The inline showState() function ['state-loading','state-error',...]
    // toggles hidden on each one. Any state going missing breaks dispatch.
    const m = html.match(/showState\s*\([\s\S]*?\[([\s\S]*?)\]/);
    assert.ok(m, 'showState declaration must exist');
    for (const id of [
      'state-loading',
      'state-error',
      'state-not-delivered',
      'state-flagged',
      'state-ready',
    ]) {
      assert.ok(
        m[1].includes(`'${id}'`) || m[1].includes(`"${id}"`),
        `showState() must include ${id} in its toggle array`,
      );
    }
  });

  test('not-delivered state IDs preserved (tier-aware copy contract)', () => {
    for (const id of [
      'not-delivered-icon',
      'not-delivered-title',
      'not-delivered-body',
      'not-delivered-meta',
      'not-delivered-back',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain — tier-aware copy renderer targets it`);
    }
  });

  test('tier-aware Instructor copy still wired into the JS', () => {
    // The JS branches on (essay.grading_tier === 'instructor') to lift
    // the not-delivered copy to "Giảng viên đang review bài" + 24-48h.
    // The branch + canonical strings must survive the redesign.
    assert.match(html, /tierLower\s*===\s*['"]instructor['"]/);
    assert.match(html, /Giảng viên đang review bài/);
    assert.match(html, /24[–-]48\s*giờ/);
  });
});


// ── 5-tab + section/content render contract ──────────────────────


describe('writing-result.html / 5-tab contract', () => {
  test('all 5 data-tab attributes preserved', () => {
    for (const key of ['tongquan', 'loi', 'nangcao', 'baimau', 'note']) {
      assert.match(
        html,
        new RegExp(`data-tab="${key}"`),
        `data-tab="${key}" must remain — wireTabs() looks it up`,
      );
    }
  });

  test('all 5 data-panel attributes preserved', () => {
    for (const key of ['tongquan', 'loi', 'nangcao', 'baimau', 'note']) {
      assert.match(
        html,
        new RegExp(`data-panel="${key}"`),
        `data-panel="${key}" must remain — wireTabs() pairs it with data-tab`,
      );
    }
  });

  test('conditional Note giảng viên tab keeps #tab-btn-note + hidden default', () => {
    // Tab 5 is shown only when essay has instructor_note. The JS toggles
    // .hidden off via classList. Pin the ID + the initial hidden state.
    // class= may come before id= in the markup, so probe the whole tag.
    const m = html.match(/<button\b[^>]*\bid="tab-btn-note"[^>]*>/);
    assert.ok(m, '#tab-btn-note <button> must exist');
    assert.match(m[0], /class="[^"]*\bhidden\b/, '#tab-btn-note must ship class="...hidden..." so JS reveals it conditionally');
  });
});


describe('writing-result.html / section + content render targets', () => {
  // 14 content-{key} IDs filled by WritingRenderers.SECTION_RENDERERS
  // dispatch. Each pairs with a section-{key} sibling for the
  // hide-empty logic (maybeHideOptionalSections + maybeHideCounterargument).
  const RENDER_KEYS = [
    'key-takeaways',
    'overview',
    'criteria',
    'trajectory',
    'mistakes',
    'recurring',
    'lexical',
    'sentence-structure',
    'coherence',
    'idea-development',
    'counterargument',
    'improved',
    'ai-content',
    'instructor-note',
  ];

  test('all 14 content-{key} render targets preserved', () => {
    for (const key of RENDER_KEYS) {
      assert.match(
        html,
        new RegExp(`id="content-${key}"`),
        `#content-${key} must remain — WritingRenderers dispatch targets it`,
      );
    }
  });

  test('all 14 section-{key} parents preserved (hide-empty contract)', () => {
    for (const key of RENDER_KEYS) {
      assert.match(
        html,
        new RegExp(`id="section-${key}"`),
        `#section-${key} must remain — maybeHideOptionalSections() targets it`,
      );
    }
  });
});


// ── Header chrome (back-link / meta / tier badge / actions) ───────


describe('writing-result.html / header IDs preserved', () => {
  test('all header IDs preserved (back-link / meta / band / tier)', () => {
    for (const id of [
      'back-link',
      'error-back',
      'prompt-title',
      'essay-task',
      'essay-date',
      'band-display',
      'tier-wrap',
      'tier-badge',
      'btn-download',
      'btn-print',
      'essay-text',
      'word-count',
      'prompt-box',
      'error-message',
      'flagged-message',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must remain`);
    }
  });
});


// ── Tier badge contract (Sprint 2.7a / 2.7a.1) ───────────────────


describe('writing-result.css / tier badge contract', () => {
  test('all 4 tier badge classes declared (standard/deep/instructor + quick fallback)', () => {
    for (const tier of ['standard', 'deep', 'instructor', 'quick']) {
      const re = new RegExp(`\\.tier-${tier}\\s*\\{`);
      assert.match(
        css,
        re,
        `.tier-${tier} must be declared — JS sets className="tier-badge tier-{name}"`,
      );
    }
  });

  test('all 4 tier badges use --av-* tokens (no hardcoded hex)', () => {
    const tierBlock = css.match(/\.tier-quick[\s\S]*?\.tier-instructor[^}]*\}/);
    assert.ok(tierBlock, 'tier badge block must be locatable');
    assert.ok(
      !/#[0-9a-fA-F]{3,6}/.test(tierBlock[0]),
      'tier badges must not hardcode hex colors — use --av-* tokens',
    );
  });
});


// ── Lucide icon swap (chrome only — tab icons stay emoji) ─────────


describe('writing-result.html / Lucide chrome swap', () => {
  test('Lucide CDN + hydration script present', () => {
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
    assert.match(html, /lucide\.createIcons/);
  });

  test('chrome icons swapped to Lucide (download / printer / chevron-left)', () => {
    assert.match(html, /<i\s+data-lucide="download"/);
    assert.match(html, /<i\s+data-lucide="printer"/);
    assert.match(html, /<i\s+data-lucide="chevron-left"/);
  });

  test('header download button dropped legacy ⬇ + 🖨 emoji', () => {
    const headerActions = html.match(/<div\s+class="header-actions"[\s\S]*?<\/div>/);
    assert.ok(headerActions, '.header-actions block must exist');
    assert.ok(!/⬇\s+Tải\s+\.docx/.test(headerActions[0]), 'download button must not ship ⬇ emoji');
    assert.ok(!/🖨\s+In/.test(headerActions[0]), 'print button must not ship 🖨 emoji');
  });

  test('back-link in header dropped legacy ← arrow', () => {
    // ← back-arrow → Lucide chevron-left
    const backLink = html.match(/<a\s+id="back-link"[\s\S]*?<\/a>/);
    assert.ok(backLink, '#back-link anchor must exist');
    assert.ok(
      !/← Bài viết của tôi/.test(backLink[0]),
      'back-link in header must not ship the legacy ← arrow before "Bài viết của tôi"',
    );
  });

  test('tab-icon emoji preserved (functional microcopy per Sprint 6.7 precedent)', () => {
    // 📊 ❌ 🔬 📚 💬 are functional status emoji students recognize.
    // The Sprint 6.7 precedent: keep emoji in microcopy, swap only chrome.
    for (const emoji of ['📊', '❌', '🔬', '📚', '💬']) {
      assert.ok(
        html.includes(emoji),
        `tab-icon emoji "${emoji}" must be preserved (functional microcopy, Sprint 6.7 precedent)`,
      );
    }
  });
});


// ── Body class ───────────────────────────────────────────────────


describe('writing-result.html / body class', () => {
  test('body opts into .av-page', () => {
    assert.match(html, /<body[^>]*class="[^"]*\bav-page\b[^"]*"/);
  });
});


// ── Color migration / token discipline ────────────────────────────


describe('writing-result.html / color migration', () => {
  test('zero inline rgba(255,255,255,X) declarations in style attrs', () => {
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    const matches = stripped.match(/style="[^"]*rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.equal(matches.length, 0, `expected 0 inline rgba(255,...) in style="...", found ${matches.length}`);
  });

  test('zero inline hex colors in style attrs', () => {
    const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
    const matches = stripped.match(/style="[^"]*#[0-9a-fA-F]{3,6}\b/g) || [];
    assert.equal(matches.length, 0, `expected 0 inline hex colors in style="...", found ${matches.length}`);
  });

  test('Vietnamese microcopy preserved verbatim', () => {
    for (const phrase of [
      'Đang tải bài viết',
      'Không tải được bài viết',
      'Bài đang được duyệt',
      'Bài viết bị đánh dấu cần xem xét',
      'Bài viết của tôi',
      'Tải .docx',
      'Quay lại',
      'Tổng quan',
      'Nhận xét lỗi',
      'Phân tích nâng cao',
      'Bài mẫu',
      'Note giảng viên',
      'Bài viết của em',
      'Key Takeaways',
      '4 tiêu chí IELTS',
    ]) {
      assert.ok(html.includes(phrase), `microcopy "${phrase}" must be preserved verbatim`);
    }
  });
});


// ── writing-result.css token discipline ───────────────────────────


describe('writing-result.css / token discipline (Sprint 6.8)', () => {
  test('references --av-* tokens heavily', () => {
    const avRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 60,
      `writing-result.css must reference --av-* tokens throughout (found ${avRefs})`,
    );
  });

  test('does NOT reference legacy --ds-* tokens', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/var\(--ds-/.test(stripped), 'writing-result.css must be on --av-* only');
  });

  test('does NOT use the non-existent --av-space-5 / -7 / -9 / -10 / -11 / -13 / -14 / -15 tokens', () => {
    assert.ok(
      !/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(css),
      'writing-result.css uses a skipped step in the 4px scale. Allowed: 0,1,2,3,4,6,8,12,16,20,24.',
    );
  });

  test('avoids hardcoded teal hex outside @media print', () => {
    // The @media print rules hardcode #111/#555/#f5f5f5/#ffffff as a
    // documented exception (paper rendering ignores theme). Strip the
    // print block before checking for hardcoded teal/etc. in component
    // declarations.
    const withoutPrint = css.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');
    const lines = withoutPrint.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\*|^\s*\*/.test(line)) continue;
      if (/#0[Ff]766[Ee]|#14[Bb]8[Aa]6/.test(line)) {
        assert.fail(`writing-result.css line ${i + 1} hardcodes teal — use var(--av-primary). Line: ${line.trim()}`);
      }
    }
  });

  test('does NOT hardcode #ffffff / #fff / white outside @media print (Sprint 6.7.1 lesson)', () => {
    const withoutPrint = css.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');
    const fffMatches = withoutPrint.match(/color\s*:\s*#fff(?:fff)?\b/gi) || [];
    const wordMatches = withoutPrint.match(/color\s*:\s*white\b/gi) || [];
    assert.equal(
      fffMatches.length + wordMatches.length,
      0,
      'No #fff / #ffffff / white color declarations outside @media print (Sprint 6.7.1 rule)',
    );
  });

  test('declares all the JS-coupled legacy classes from the inline <style> block', () => {
    const required = [
      '.result-header',
      '.back-link',
      '.essay-meta',
      '.meta-line',
      '.band-display',
      '.tier-badge',
      '.header-actions',
      '.btn-icon',
      '.result-tabs',
      '.tab-btn',
      '.tab-icon',
      '.tab-panel',
      '.essay-section',
      '.grade-section',
      '.section-header',
      '.section-content',
      '.word-count',
      '.essay-original',
      '.state-block',
      '.btn-link',
      '.hidden',
    ];
    for (const cls of required) {
      const re = new RegExp(`\\${cls}(\\s|[.,{:])`);
      assert.match(css, re, `writing-result.css must declare ${cls}`);
    }
  });
});


// ── writing-renderers.css token discipline ─────────────────────────


describe('writing-renderers.css / token discipline (Sprint 6.8)', () => {
  test('references --av-* tokens heavily (87 colors → tokens)', () => {
    const avRefs = (renderersCss.match(/var\(--av-/g) || []).length;
    assert.ok(
      avRefs > 80,
      `writing-renderers.css must reference --av-* tokens throughout (found ${avRefs})`,
    );
  });

  test('does NOT hardcode any color literal (white / black / hex)', () => {
    const stripped = renderersCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = stripped.match(/color\s*:\s*#[0-9a-fA-F]{3,6}\b/gi) || [];
    const white = stripped.match(/color\s*:\s*white\b/gi) || [];
    const black = stripped.match(/color\s*:\s*black\b/gi) || [];
    assert.equal(
      hex.length + white.length + black.length,
      0,
      `writing-renderers.css has ${hex.length + white.length + black.length} hardcoded color literals. ` +
      `Use --av-* tokens (Sprint 6.7.1 rule).`,
    );
  });

  test('declares all renderer-emitted classes byte-identical', () => {
    // writing-renderers.js emits these classnames directly into
    // innerHTML; the CSS rules must keep matching them.
    const required = [
      '.prose-block',
      '.empty-state',
      '.subsection-heading',
      '.chip',
      '.callout-info',
      '.callout-action',
      '.callout-label',
      '.instructor-note-block',
      '.card-criterion',
      '.band-pill',
      '.band-low',
      '.band-mid',
      '.band-good',
      '.band-high',
      '.mistake-card',
      '.mistake-high',
      '.mistake-low',
      '.stat-tile',
      '.trend-improving',
      '.trend-stable',
      '.trend-declining',
      '.focus-theme-card',
      '.issue-card',
      '.complexity-meter',
      '.takeaway-block',
      '.takeaway-success',
      '.takeaway-warning',
      '.likelihood-track',
      '.likelihood-low',
      '.likelihood-mid',
      '.likelihood-high',
      '.idea-card',
      '.coherence-card',
      '.counter-block',
      '.lexical-card',
      '.essay-improved-block',
      '.rewrite-card',
    ];
    for (const cls of required) {
      const re = new RegExp(`\\${cls}(\\s|[.,{:])`);
      assert.match(
        renderersCss,
        re,
        `writing-renderers.css must declare ${cls} (writing-renderers.js emits it)`,
      );
    }
  });
});


// ── Contrast discipline (Sprint 6.4.2 lesson) ────────────────────


describe('writing-result.css / contrast discipline', () => {
  test('--av-text-faint usage capped at ≤ 10 (combined HTML + page CSS)', () => {
    const cssCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    const rendCount = (renderersCss.match(/var\(--av-text-faint\)/g) || []).length;
    const total = cssCount + rendCount;
    assert.ok(
      total <= 10,
      `--av-text-faint total count is ${total} (page=${cssCount}, renderers=${rendCount}); expected ≤ 10`,
    );
  });

  test('text-secondary usage exceeds text-faint (semantic discipline)', () => {
    const secondaryCount =
      (css.match(/var\(--av-text-secondary\)/g) || []).length +
      (renderersCss.match(/var\(--av-text-secondary\)/g) || []).length;
    const faintCount =
      (css.match(/var\(--av-text-faint\)/g) || []).length +
      (renderersCss.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(
      secondaryCount > faintCount,
      `text-secondary (${secondaryCount}) must exceed text-faint (${faintCount})`,
    );
  });
});


describe('writing-result.css / T1·2 re-skin treatment', () => {
  test('sections read as elevated cards (matches admin #501)', () => {
    const sec = css.match(/\.grade-section\s*\{[^}]*\}/);
    assert.ok(sec, '.grade-section rule present');
    assert.match(sec[0], /background:\s*var\(--av-surface-card\)/);
    assert.match(sec[0], /border-radius:\s*var\(--av-radius-lg\)/);
    assert.match(sec[0], /box-shadow:\s*var\(--av-shadow-sm\)/);
    const essay = css.match(/\.essay-section\s*\{[^}]*\}/);
    assert.match(essay[0], /box-shadow:\s*var\(--av-shadow-sm\)/);
  });

  test('overall band rendered as a hero pill', () => {
    const band = css.match(/\.band-display\s*\{[^}]*\}/);
    assert.match(band[0], /border-radius:\s*var\(--av-radius-pill\)/);
    assert.match(band[0], /background:\s*var\(--av-primary-soft\)/);
  });

  test('feedback-card family gets the shared depth + hover treatment', () => {
    assert.match(css, /\.mistake-card:hover[\s\S]{0,400}?translateY/);
    assert.match(css, /box-shadow:\s*var\(--av-shadow-md\)/);
  });

  test('load reveal is motion-safe (prefers-reduced-motion gate)', () => {
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
    assert.match(css, /@keyframes result-rise/);
  });

  test('T4 highlight component is NOT restyled here (only the page around it)', () => {
    // .wh-* lives in writing-highlight.css; T1·2 must not redefine it.
    assert.doesNotMatch(css, /\.wh-mark\b/);
    assert.doesNotMatch(css, /\.wh-popover\b/);
    assert.doesNotMatch(renderersCss, /\.wh-mark\b/);
  });
});


describe('writing-result.html / U2 hide-all scores (overall band gated)', () => {
  test('overall band pill is gated on essay.hide_subbands (hidden when set)', () => {
    assert.match(html, /var hideScores = !!essay\.hide_subbands/);
    assert.match(html, /if \(hideScores\)\s*\{[\s\S]*?bandEl\.classList\.add\('hidden'\)/);
  });
  test('default (flag false) still renders the band pill (apply-forward)', () => {
    assert.match(html, /else\s*\{[\s\S]*?bandEl\.textContent = bandText/);
  });
  test('hidden band omitted from the document title too (no tab-title leak)', () => {
    assert.match(html, /document\.title = 'Phân tích bài viết';/);
  });
  // Print needs no separate rule: .hidden is display:none !important, so the
  // gated pill is absent in @media print as well.
  test('.hidden is display:none !important (covers screen + print)', () => {
    assert.match(css, /\.hidden\s*\{\s*display:\s*none\s*!important/);
  });
});

describe('writing-result.css / U3 layout aligned to nav width (1180)', () => {
  test('shared gutter centers content to the 1180 nav column', () => {
    assert.match(css, /--rg:\s*max\(var\(--av-space-8\),\s*calc\(\(100% - 1180px\) \/ 2\)\)/);
  });
  test('header + tabs + content + tips all use the shared gutter (no more 920 block)', () => {
    assert.match(css, /\.result-header\s*\{[^}]*padding:\s*var\(--av-space-4\)\s+var\(--rg\)/);
    assert.match(css, /\.result-tabs\s*\{[^}]*padding:\s*0\.625rem\s+var\(--rg\)/);
    assert.match(css, /main\.result-content\s*\{[^}]*var\(--rg\)/);
    // The old narrower centered column is gone (header was full-bleed → mismatch).
    assert.doesNotMatch(css, /main\.result-content\s*\{[^}]*max-width:\s*920px/);
  });
});
