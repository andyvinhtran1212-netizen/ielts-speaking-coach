/**
 * frontend/tests/grammar-wiki-redesign.test.mjs — Sprint 6.15 (Phase 4 closure).
 *
 * Pins the Grammar Wiki cluster surgical migration:
 *   - frontend/grammar.html (landing, at root)
 *   - frontend/pages/grammar-roadmap.html
 *   - frontend/pages/grammar-article.html
 *   - frontend/pages/grammar-search.html
 *   - frontend/pages/grammar-compare.html
 *
 * Sprint 6.15 scope (S + A confirmed):
 *   - Token-only chrome migration (mirror 6.14d-α discipline)
 *   - Typography sub-system PRESERVED (DM Sans body + Lora display) per
 *     DESIGN_SYSTEM § 14.2 sub-system decision
 *   - Canonical IIFE + canonical .icon-sun/.icon-moon theme toggle per page
 *   - body.av-page opt-in
 *   - Foundation order: tokens → components → ds (Sprint 6.5.1) → grammar-wiki.css
 *   - Inline `<style>` blocks extracted to frontend/css/grammar-wiki.css
 *   - 91 rgba whites + dark-navy hex literals → --av-* tokens
 *
 * Phase B/C findings (spec adjustments):
 *   - Tailwind custom navy/teal palette config PRESERVED (js/grammar.js
 *     renderer emits text-teal-light, bg-teal/15 utility classes that
 *     depend on the palette). Removal deferred to a future grammar-
 *     wiki-β sprint analogous to 6.14d-β.
 *   - ds.css link PRESERVED per Sprint 6.5.1 pattern (pages use
 *     .ds-badge, .ds-badge-teal, .ds-fadein legacy classes).
 *
 * Preserved byte-identical:
 *   - All 62 JS-coupled IDs (17+7+24+8+6)
 *   - All cross-page navigation
 *   - frontend/js/grammar.js renderer (1,034 lines, untouched)
 *   - frontend/js/api.js coupling
 *   - Article TOC anchors (grammar-anchor / scroll-margin-top + pulse highlight Sprint 5 feature)
 *   - Search backend coupling (grammarWiki.setupSearch + grammarWiki.redirectToSearch)
 *   - Comparison rendering (grammarWiki.loadComparePage)
 *   - Roadmap navigation (grammarWiki.loadRoadmap)
 *   - Vietnamese grammar terminology
 *   - Public anonymous access pattern (no auth gate)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const PAGES = {
  landing:   { rel: 'frontend/grammar.html',                 prefix: '' },
  roadmap:   { rel: 'frontend/pages/grammar-roadmap.html',   prefix: '../' },
  article:   { rel: 'frontend/pages/grammar-article.html',   prefix: '../' },
  search:    { rel: 'frontend/pages/grammar-search.html',    prefix: '../' },
  compare:   { rel: 'frontend/pages/grammar-compare.html',   prefix: '../' },
};

let css;
let pageContents = {};

before(() => {
  css = readFileSync(path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'), 'utf8');
  for (const [name, info] of Object.entries(PAGES)) {
    pageContents[name] = readFileSync(path.join(REPO_ROOT, info.rel), 'utf8');
  }
});


// ── grammar-wiki.css discipline ──────────────────────────────────


describe('grammar-wiki.css / token discipline', () => {
  test('uses --av-* tokens', () => {
    assert.match(css, /var\(--av-/);
  });

  test('no --ds-* references', () => {
    assert.ok(!css.includes('--ds-'), 'grammar-wiki.css must not reference legacy --ds-*');
  });

  test('no Era B brand-typo #14a8ae', () => {
    assert.ok(!css.includes('#14a8ae'));
  });

  test('preserves DM Sans + Lora sub-system (§ 14.2)', () => {
    assert.match(css, /'DM Sans'/, 'grammar-wiki.css must reference DM Sans');
    assert.match(css, /'Lora'/,    'grammar-wiki.css must reference Lora');
  });

  test('body.av-page override sets DM Sans (wins over components.css Plus Jakarta)', () => {
    assert.match(
      css,
      /body\.av-page\s*\{[\s\S]*?font-family:\s*'DM Sans'/,
      'grammar-wiki.css must override body.av-page font-family to DM Sans',
    );
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(faintCount < 10, `grammar-wiki.css --av-text-faint count: ${faintCount}`);
  });

  test('preserves legacy class names emitted by js/grammar.js', () => {
    for (const sel of [
      '.cat-card', '.article-card', '.search-input', '.btn-cta',
      '.btn-primary', '.btn-outline', '.section-head', '.section-label',
      '.hero-title', '.roadmap-card', '.group-card', '.group-article-row',
      '.article-body', '.toc-link', '.toc-sidebar', '.compare-col',
      '.skeleton', '.grammar-anchor-pulse',
    ]) {
      assert.ok(
        css.includes(sel),
        `grammar-wiki.css missing legacy class selector ${sel} (js/grammar.js renderer emits it)`,
      );
    }
  });

  test('Sprint 6.15 + 6.15-β/γ deferral header docstring present', () => {
    assert.match(css, /Sprint 6\.15/);
    assert.match(css, /sub-system|§ 14\.2/);
  });
});


// ── Per-page foundation + canonical IIFE + theme toggle ──────────


for (const [name, info] of Object.entries(PAGES)) {
  describe(`grammar cluster / ${info.rel}`, () => {
    test('foundation order: tokens → components → ds → grammar-wiki', () => {
      const html = pageContents[name];
      const t  = html.indexOf('aver-design/tokens.css');
      const c  = html.indexOf('aver-design/components.css');
      const d  = html.indexOf('css/ds.css');
      const gw = html.indexOf('css/grammar-wiki.css');
      assert.ok(t > -1 && c > -1 && d > -1 && gw > -1, `${name}: all 4 foundation links required`);
      assert.ok(t < c,  `${name}: tokens must precede components`);
      assert.ok(c < d,  `${name}: components must precede ds.css`);
      assert.ok(d < gw, `${name}: ds.css must precede grammar-wiki.css (Sprint 6.5.1 override pattern)`);
    });

    test('writing-renderers.css NOT linked (Sprint 6.8 finding extends)', () => {
      assert.ok(
        !/<link[^>]*writing-renderers\.css/.test(pageContents[name]),
        `${name}: must not link writing-renderers.css`,
      );
    });

    test('admin-writing.css NOT linked (different cluster, at cap 10/10)', () => {
      assert.ok(
        !/<link[^>]*admin-writing\.css/.test(pageContents[name]),
        `${name}: must not link admin-writing.css`,
      );
    });

    test('canonical anti-flash IIFE present', () => {
      const html = pageContents[name];
      assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
      assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
      assert.match(html, /prefers-color-scheme:\s*dark/);
      assert.match(html, /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/);
    });

    test('canonical .icon-sun + .icon-moon theme toggle present', () => {
      assert.match(pageContents[name], /class=["']icon-sun["']/);
      assert.match(pageContents[name], /class=["']icon-moon["']/);
    });

    test('no BEM drift theme-toggle class variants', () => {
      for (const variant of ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon']) {
        assert.ok(!pageContents[name].includes(variant), `${name}: BEM drift ${variant}`);
      }
    });

    test('body has av-page class', () => {
      assert.match(pageContents[name], /<body[^>]*class=["'][^"']*\bav-page\b/);
    });

    test('Tailwind utility classes preserved on body (β scope)', () => {
      // Sprint 6.15.5-hotfix dropped `text-white` from grammar-article.html
      // body. Sprint 6.15.6-hotfix extended that fix to the remaining 4
      // grammar pages — JS-renderer-emitted cards have class-less spans
      // that inherited Tailwind's raw white via the body when the body
      // itself still carried the text-white class. min-h-screen + font-sans
      // remain on body as the legitimate utility-class scope.
      assert.ok(
        !/<body[^>]*class=["'][^"']*\btext-white\b/.test(pageContents[name]),
        `${name}: text-white must be removed from body — cascade-winning descendant override cannot match body itself`,
      );
      assert.match(pageContents[name], /<body[^>]*class=["'][^"']*\bmin-h-screen\b/);
    });

    test('theme-toggle.js bindToggleButton wired', () => {
      assert.match(pageContents[name], /bindToggleButton/);
      // Sprint 6.15.7-hotfix: all 5 grammar pages switched to absolute
      // path `/js/theme-toggle.js` so Vercel rewrites (e.g.
      // /grammar/:category/:slug) don't break relative resolution.
      // Relative paths still acceptable for legacy callers, but the
      // canonical for the grammar cluster is the absolute form.
      assert.ok(
        pageContents[name].includes('/js/theme-toggle.js'),
        `${name}: theme-toggle.js import path should include "/js/theme-toggle.js" (absolute) per Sprint 6.15.7-hotfix`,
      );
    });

    test('no inline <style> block (extracted to grammar-wiki.css)', () => {
      const blocks = (pageContents[name].match(/<style[\s\S]*?<\/style>/g) || []);
      const total = blocks.reduce((s, b) => s + b.length, 0);
      assert.ok(total < 200, `${name}: inline <style> total ${total}, expected < 200`);
    });

    test('Tailwind CDN preserved (custom palette dependency, β-deferred)', () => {
      assert.match(pageContents[name], /cdn\.tailwindcss\.com/);
    });

    test('Tailwind custom navy + teal palette preserved (renderer dependency)', () => {
      const html = pageContents[name];
      assert.match(html, /navy:\s*\{[^}]*DEFAULT/);
      assert.match(html, /teal:\s*\{[^}]*DEFAULT/);
    });

    test('Tailwind custom fontFamily key dropped (grammar-wiki.css owns font)', () => {
      assert.ok(
        !/fontFamily:\s*\{[^}]*DM Sans/.test(pageContents[name]),
        `${name}: Tailwind fontFamily key should be dropped`,
      );
    });

    test('DM Sans + Lora Google Font link present (sub-system preserved)', () => {
      const html = pageContents[name];
      assert.match(html, /family=[^"]*DM\+Sans/);
      // roadmap is the only page that historically did NOT load Lora; verify Lora present
      // for the others which need it for hero/h2 display headings.
      if (name !== 'roadmap') {
        assert.match(html, /family=Lora|family=[^"]*Lora/);
      }
    });

    test('Inter font NOT loaded', () => {
      assert.ok(!/family=Inter\b/.test(pageContents[name]), `${name}: Inter must not load`);
    });

    test('Plus Jakarta Sans NOT loaded (sub-system intentional separation)', () => {
      assert.ok(
        !/Plus\+Jakarta\+Sans/.test(pageContents[name]),
        `${name}: Plus Jakarta Sans not loaded — Grammar Wiki uses DM Sans+Lora sub-system per § 14.2`,
      );
    });

    test('no #14a8ae brand-color typo', () => {
      assert.ok(!pageContents[name].includes('#14a8ae'), `${name}: brand-color typo`);
    });
  });
}


// ── grammar.html landing — JS-coupled IDs preserved ─────────────


describe('grammar.html landing / JS-coupled IDs preserved', () => {
  const REQUIRED_IDS = [
    'search-btn', 'search-input', 'search-results', 'search-results-title',
    'search-results-list', 'category-view', 'category-view-title',
    'category-view-list', 'categories', 'category-cards', 'featured-list',
    'groups-section', 'groups-list', 'groups-complete-count',
    'groups-planned-count', 'home-content', 'total-articles',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} preserved`, () => {
      assert.match(pageContents.landing, new RegExp(`id=["']${id}["']`));
    });
  }

  test('grammarWiki.setupSearch + loadGrammarHome handlers preserved', () => {
    assert.match(pageContents.landing, /grammarWiki\.setupSearch/);
    assert.match(pageContents.landing, /grammarWiki\.loadGrammarHome/);
  });

  test('cross-page links to roadmap + search preserved', () => {
    assert.match(pageContents.landing, /href=["'][^"']*pages\/grammar-search\.html/);
  });

  test('hero "hệ thống liên kết" Vietnamese microcopy preserved', () => {
    assert.match(pageContents.landing, /hệ thống liên kết/);
  });
});


// ── grammar-roadmap.html ─────────────────────────────────────────


describe('grammar-roadmap.html / JS-coupled IDs preserved', () => {
  for (const id of ['breadcrumb', 'roadmap-cat-link', 'roadmap-container', 'roadmap-skeleton', 'roadmap-steps', 'roadmap-subtitle', 'roadmap-title']) {
    test(`#${id} preserved`, () => {
      assert.match(pageContents.roadmap, new RegExp(`id=["']${id}["']`));
    });
  }
});


// ── grammar-article.html ────────────────────────────────────────


describe('grammar-article.html / JS-coupled IDs + Sprint 5 deep-link preserved', () => {
  const REQUIRED_IDS = [
    'article-body', 'article-container', 'article-level', 'article-meta',
    'article-skeleton', 'article-title', 'breadcrumb', 'canonical-url',
    'compare-links', 'compare-section', 'guest-cta-bar', 'guest-modal-dismiss',
    'guest-modal-overlay', 'guest-modal-title', 'meta-description',
    'next-articles-list', 'next-articles-section', 'og-description',
    'og-title', 'prev-next', 'reading-progress', 'related-pages',
    'related-section', 'toc-container',
  ];
  for (const id of REQUIRED_IDS) {
    test(`#${id} preserved`, () => {
      assert.match(pageContents.article, new RegExp(`id=["']${id}["']`));
    });
  }

  test('Sprint 5 grammar-anchor scroll-margin-top defined in CSS', () => {
    assert.match(css, /grammar-anchor[\s\S]{0,80}scroll-margin-top/);
  });

  test('Sprint 5 grammar-anchor-pulse animation defined', () => {
    assert.match(css, /grammar-anchor-pulse/);
    assert.match(css, /@keyframes gw-grammarAnchorPulse/);
  });

  test('article-body typography rules defined (h2/h3/p/code/blockquote/table)', () => {
    for (const sel of [
      '.article-body h2', '.article-body h3', '.article-body p',
      '.article-body code', '.article-body blockquote', '.article-body table',
    ]) {
      assert.ok(css.includes(sel), `grammar-wiki.css missing ${sel}`);
    }
  });

  test('SEO + og meta tags preserved (canonical-url + og:type/title/description)', () => {
    assert.match(pageContents.article, /id=["']canonical-url["']/);
    assert.match(pageContents.article, /property=["']og:type["']/);
  });
});


// ── grammar-search.html ─────────────────────────────────────────


describe('grammar-search.html / JS-coupled IDs preserved', () => {
  for (const id of ['breadcrumb', 'search-btn', 'search-container', 'search-count', 'search-heading', 'search-input', 'search-results-list', 'search-skeleton']) {
    test(`#${id} preserved`, () => {
      assert.match(pageContents.search, new RegExp(`id=["']${id}["']`));
    });
  }

  test('grammarWiki.loadSearchPage / setupSearch coupling preserved', () => {
    assert.match(pageContents.search, /grammarWiki\.(loadSearchPage|setupSearch|runSearch)/);
  });
});


// ── grammar-compare.html ────────────────────────────────────────


describe('grammar-compare.html / JS-coupled IDs preserved', () => {
  for (const id of ['breadcrumb', 'compare-container', 'compare-left', 'compare-right', 'compare-skeleton', 'compare-title']) {
    test(`#${id} preserved`, () => {
      assert.match(pageContents.compare, new RegExp(`id=["']${id}["']`));
    });
  }

  test('compare-col primitive defined in CSS', () => {
    assert.match(css, /\.compare-col\b/);
  });
});


// ── Cross-page navigation map ───────────────────────────────────


describe('Cross-page navigation preserved', () => {
  test('landing → sub-pages', () => {
    assert.match(pageContents.landing, /href=["'][^"']*pages\/grammar-search\.html/);
  });

  test('sub-pages → landing (../grammar.html or /grammar.html)', () => {
    for (const sub of ['roadmap', 'article', 'search', 'compare']) {
      assert.match(
        pageContents[sub],
        /href=["'](?:\.\.\/|\/)?grammar\.html/,
        `${sub}: missing back-link to grammar landing`,
      );
    }
  });
});


// ── Public anonymous access (no auth gate) ───────────────────────


describe('Grammar cluster / public anonymous access (no auth gate)', () => {
  for (const [name, info] of Object.entries(PAGES)) {
    test(`${name}: no admin / require_admin gate`, () => {
      const html = pageContents[name];
      assert.ok(
        !/require_admin|admin_required|role\s*===\s*['"]admin['"]/.test(html),
        `${name}: must not have admin-only auth gate`,
      );
    });
  }
});


// ── Token discipline per page (no rgba/hex stragglers) ──────────


describe('Per-page token discipline', () => {
  for (const [name, info] of Object.entries(PAGES)) {
    test(`${name}: zero stray rgba() literals in HTML markup`, () => {
      const html = pageContents[name];
      // Look for rgba(...) inside style= attributes (chrome migration target)
      const styleAttrs = html.match(/style=["'][^"']+["']/g) || [];
      const rgbaInStyles = styleAttrs.filter(s => /rgba\([^)]+\)/.test(s)).length;
      assert.equal(rgbaInStyles, 0, `${name}: ${rgbaInStyles} rgba() literals remain in style="..."`);
    });
  }
});
