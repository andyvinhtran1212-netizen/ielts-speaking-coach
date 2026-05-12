/**
 * frontend/tests/chrome-unification-canonical.test.mjs
 *
 * Sprint 6.17 Phase C1 — canonical chrome sentinel.
 *
 * Pins the canonical full-nav chrome shipped by components.css + the
 * /js/user-pill.js dropdown module. Coverage: the 5 pages migrated in
 * Phase C1 (foundation):
 *
 *   - frontend/pages/home.html     (canonical reference, updated to dropdown)
 *   - frontend/pages/vocabulary.html (canonical reference, user-pill added)
 *   - frontend/pages/profile.html  (migrated)
 *
 * Phase C2 (Sprint 6.17.1) will extend this sentinel as the remaining
 * 8 Cat 2 pages migrate (speaking, practice, result, full-test-result,
 * writing-dashboard, writing-result, onboarding, my-vocabulary, flashcards,
 * exercises). Each migration adds itself to CANONICAL_CHROME_PAGES.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── Phase C1 roster ───────────────────────────────────────────────


const CANONICAL_CHROME_PAGES = [
  // Phase C1 (Sprint 6.17, PR #164)
  'frontend/pages/home.html',
  'frontend/pages/vocabulary.html',
  'frontend/pages/profile.html',
  // Phase C2 (Sprint 6.17.1)
  'frontend/pages/speaking.html',
  'frontend/pages/practice.html',
  'frontend/pages/result.html',
  'frontend/pages/full-test-result.html',
  'frontend/pages/writing-dashboard.html',
  'frontend/pages/writing-result.html',
  'frontend/onboarding.html',
  'frontend/pages/my-vocabulary.html',
  'frontend/pages/flashcards.html',
  'frontend/pages/exercises.html',
  // Sprint 6.17.2 — Grammar cluster migration (Cat 3 exclusion overridden)
  'frontend/grammar.html',
  'frontend/pages/grammar-roadmap.html',
  'frontend/pages/grammar-search.html',
  'frontend/pages/grammar-compare.html',
  'frontend/pages/grammar-article.html',
];


// ── Canonical foundation: components.css + user-pill.js ───────────


describe('Sprint 6.17 foundation — canonical chrome rules in components.css', () => {
  let components;
  before(() => {
    components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
  });

  test('.shell rule defined', () => {
    assert.match(components, /\.shell\s*\{[^}]*max-width:\s*1180px/);
  });

  test('.topnav-wrap (lightweight body-less wrapper) defined', () => {
    assert.match(components, /\.topnav-wrap\s*\{[^}]*max-width:\s*1180px/);
  });

  test('.topnav + .brand + .nav-links + .topnav-right defined', () => {
    for (const sel of ['.topnav', '.brand', '.nav-links', '.topnav-right']) {
      const escaped = sel.replace(/\./g, '\\.');
      assert.match(components, new RegExp(`${escaped}\\s*\\{`),
        `components.css should define ${sel}`);
    }
  });

  test('.user-pill + .user-menu + .user-menu-dropdown + .user-menu-item defined', () => {
    for (const sel of ['.user-pill', '.user-menu', '.user-menu-dropdown', '.user-menu-item']) {
      const escaped = sel.replace(/\./g, '\\.');
      assert.match(components, new RegExp(`${escaped}\\s*\\{`),
        `components.css should define ${sel}`);
    }
  });

  test('.nav-links .locked::after carries "Soon" label', () => {
    assert.match(components, /\.nav-links\s+\.locked::after\s*\{[^}]*content:\s*"Soon"/);
  });

  test('mobile breakpoint @media (max-width: 720px) handles topnav layout', () => {
    // Just verify both tokens appear in the same chrome section.
    const mediaIdx   = components.indexOf('@media (max-width: 720px)');
    const wrapIdx    = components.indexOf('.topnav-wrap', mediaIdx);
    assert.ok(mediaIdx > -1, 'components.css should declare @media (max-width: 720px)');
    assert.ok(wrapIdx > mediaIdx && wrapIdx - mediaIdx < 400,
      '.topnav-wrap should be scoped inside the same mobile @media block');
  });
});


describe('Sprint 6.17 foundation — /js/user-pill.js shared module', () => {
  let pill;
  before(() => {
    pill = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/user-pill.js'),
      'utf8',
    );
  });

  test('exports bindUserPill()', () => {
    assert.match(pill, /export\s+function\s+bindUserPill\s*\(/);
  });

  test('reads #user-pill toggle + .user-menu-dropdown menu', () => {
    assert.match(pill, /getElementById\(['"]user-pill['"]\)/);
    assert.match(pill, /querySelector\(['"]\.user-menu-dropdown['"]\)/);
  });

  test('wires #user-menu-logout via window.getSupabase().auth.signOut()', () => {
    assert.match(pill, /getElementById\(['"]user-menu-logout['"]\)/);
    assert.match(pill, /window\.getSupabase/);
    assert.match(pill, /signOut\s*\(/);
  });

  test('idempotent — guards against double-binding via data-user-pill-bound', () => {
    assert.match(pill, /data-user-pill-bound|userPillBound/);
  });

  test('closes dropdown on outside click + Escape', () => {
    assert.match(pill, /document\.addEventListener\(['"]click['"]/);
    assert.match(pill, /Escape/);
  });

  test('redirects to /index.html after sign-out', () => {
    assert.match(pill, /window\.location\.href\s*=\s*['"]\/index\.html['"]/);
  });
});


// ── Per-page canonical chrome ─────────────────────────────────────


describe('Sprint 6.17 Phase C1 — canonical chrome on migrated pages', () => {
  CANONICAL_CHROME_PAGES.forEach((rel) => {
    describe(rel, () => {
      let html;
      before(() => {
        html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      });

      test('carries canonical brand wordmark Aver.Learning with dotted span', () => {
        assert.match(html, /<a[^>]*class=["']brand["'][^>]*>Aver<span class=["']dot["']>\.<\/span>Learning<\/a>/);
      });

      test('ships all 5 active skill tabs (Trang chủ, Writing, Speaking, Grammar, Vocabulary)', () => {
        for (const skill of ['Trang chủ', 'Writing', 'Speaking', 'Grammar', 'Vocabulary']) {
          assert.ok(html.includes(`>${skill}</a>`),
            `${rel} should ship "${skill}" skill tab`);
        }
      });

      test('ships Reading + Listening locked tabs (Soon badge via CSS)', () => {
        assert.match(html, /<span class=["']locked["'][^>]*>Reading<\/span>/);
        assert.match(html, /<span class=["']locked["'][^>]*>Listening<\/span>/);
      });

      test('exactly one .topnav nav element', () => {
        const count = (html.match(/<nav[^>]*class=["'][^"']*\btopnav\b/g) || []).length;
        assert.equal(count, 1, `${rel} should have exactly one .topnav nav`);
      });

      test('canonical theme toggle (av-theme-toggle + .icon-sun + .icon-moon)', () => {
        assert.match(html, /class=["']av-theme-toggle["']/);
        assert.match(html, /class=["']icon-sun["']/);
        assert.match(html, /class=["']icon-moon["']/);
      });

      test('user-menu dropdown — pill button + menu items + logout', () => {
        assert.match(html, /class=["']user-menu["']/);
        assert.match(html, /id=["']user-pill["']/);
        assert.match(html, /aria-haspopup=["']true["']/);
        assert.match(html, /class=["']user-menu-dropdown["']/);
        assert.match(html, /id=["']user-menu-logout["']/);
      });

      test('loads /js/user-pill.js as ES module', () => {
        assert.match(
          html,
          /<script\s+type=["']module["']\s+src=["']\/js\/user-pill\.js["']/,
        );
      });

      test('does not regress to legacy "Aver<span>Learning" no-dot wordmark in topnav', () => {
        // Legacy speaking/practice/writing-dashboard pages used
        // Aver<span style="...">Learning</span> form. Canonical migrants
        // must use the dotted span.
        const topnavMatch = html.match(/<nav[^>]*class=["'][^"']*\btopnav\b[\s\S]*?<\/nav>/);
        assert.ok(topnavMatch, `${rel}: <nav class="topnav"> not extractable`);
        assert.ok(
          !/Aver<span\s+style=/.test(topnavMatch[0]),
          `${rel}: legacy inline-style Aver<span style="...">Learning wordmark found inside .topnav`,
        );
      });
    });
  });
});


// ── Phase C2 scope tracking ───────────────────────────────────────


describe('Sprint 6.17.1 — embedded-mode contract preserved on vocab trio', () => {
  // Cat 2B pages mount under vocabulary.html as iframe tabs when the URL
  // carries ?embedded=1. The IIFE in <head> adds .embedded-mode to <html>
  // and embedded-mode.css hides direct-child chrome via the canonical
  // selector. Sprint 6.17.1 extended that selector to include the
  // canonical .topnav-wrap wrapper.
  const EMBEDDED_PAGES = [
    'frontend/pages/my-vocabulary.html',
    'frontend/pages/flashcards.html',
    'frontend/pages/exercises.html',
  ];

  test('embedded-mode.css hides .topnav-wrap when html.embedded-mode is set', () => {
    const css = readFileSync(path.join(REPO_ROOT, 'frontend/css/embedded-mode.css'), 'utf8');
    assert.match(
      css,
      /html\.embedded-mode\s*>\s*body\s*>\s*\.topnav-wrap/,
      'embedded-mode.css must include html.embedded-mode > body > .topnav-wrap selector',
    );
  });

  EMBEDDED_PAGES.forEach((rel) => {
    test(`${rel} preserves embedded-mode IIFE (sets html.embedded-mode synchronously)`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(
        html,
        /classList\.add\(\s*['"]embedded-mode['"]\s*\)/,
        `${rel} must still set the embedded-mode class on <html> when ?embedded=1`,
      );
    });
  });
});
