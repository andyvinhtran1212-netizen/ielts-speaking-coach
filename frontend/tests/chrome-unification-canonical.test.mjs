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

  // Sprint 7.8-hotfix — populate canonicalization. Bug 2 (3 pages stuck at
  // "...") + Bug 3 (1-letter vs 2-letter initials) closed by extending
  // user-pill.js to own pill population with canonical 2-letter initials.
  test('exports populateUserPill() + canonicalInitials() (Sprint 7.8-hotfix)', () => {
    assert.match(pill, /export\s+async\s+function\s+populateUserPill\s*\(/);
    assert.match(pill, /export\s+function\s+canonicalInitials\s*\(/);
  });

  test('canonicalInitials uses 2-letter algorithm (split + map + slice(0,2))', () => {
    // Canonical: "Vinh Tran" → "VT", "Vinh" → "V". Mismatched 1-letter
    // logic (legacy home.html) regresses to "V" for "Vinh Tran".
    assert.match(pill, /\.split\(\/\\s\+\/\)/);
    assert.match(pill, /\.slice\(0,\s*2\)/);
    assert.match(pill, /\.toUpperCase\(\)/);
  });

  test('populateUserPill defers to page-bootstrapped values (placeholder detection)', () => {
    // The HTML defaults are "…" (U+2026) and "·" (U+00B7). If a page
    // bootstrap (e.g., speaking.html renderUser) has already written
    // real values, populateUserPill must NOT overwrite.
    assert.match(pill, /textContent\s*===\s*['"]…['"]/);
    assert.match(pill, /textContent\s*===\s*['"]·['"]/);
  });

  test('populateUserPill is idempotent (data-user-pill-populated guard)', () => {
    assert.match(pill, /data-user-pill-populated|userPillPopulated/);
  });

  test('auto-bind runs both bindUserPill + populateUserPill', () => {
    // The DOMContentLoaded handler must call both — populate is what
    // closes Bug 2 on the 3 pages that stuck at "...".
    assert.match(pill, /bindUserPill\(\)[\s\S]{0,80}populateUserPill\(\)/);
  });
});


// ── Sprint 7.8-hotfix — chrome size consistency (Bug 1) ───────────


describe('Sprint 7.8-hotfix — .brand chrome consistency across pages', () => {
  // Bug 1: 3 different logo sizes across 5 pages. Two root causes
  // confirmed: (a) vocabulary.css explicit font-size override (1.35rem
  // vs canonical 1.125rem); (b) grammar-wiki.css body.av-page DM Sans
  // font-family cascading into .brand. Both fixed in Sprint 7.8-hotfix.

  test('vocabulary.css no longer overrides .brand font-size', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/vocabulary.css'),
      'utf8',
    );
    // The previous override was `.brand { font-size: 1.35rem; ... }`.
    // Sprint 7.8-hotfix removed the whole `.brand` rule so the canonical
    // components.css rule (var(--av-fs-lg) = 1.125rem) wins.
    assert.ok(
      !/^\.brand\s*\{/m.test(css),
      'vocabulary.css must NOT redeclare .brand — let canonical components.css rule apply',
    );
    assert.ok(
      !/font-size:\s*1\.35rem/.test(css),
      'vocabulary.css must NOT carry the 1.35rem .brand override',
    );
  });

  test('grammar-wiki.css preserves canonical font on chrome (.brand stays Plus Jakarta Sans)', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'),
      'utf8',
    );
    // body.av-page font-family switches to DM Sans (sub-system § 14.2),
    // which previously cascaded into .brand. The fix scopes the chrome
    // selectors back to var(--av-font-sans) explicitly.
    assert.match(
      css,
      /\.brand[\s\S]{0,200}font-family:\s*var\(--av-font-sans\)/,
      'grammar-wiki.css must explicitly keep .brand on var(--av-font-sans)',
    );
  });

  test('components.css canonical .brand rule uses var(--av-fs-lg)', () => {
    const components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
    assert.match(
      components,
      /\.brand\s*\{[^}]*font-size:\s*var\(--av-fs-lg\)/,
      'components.css must keep canonical .brand font-size token',
    );
    assert.match(
      components,
      /\.brand\s*\{[^}]*font-family:\s*var\(--av-font-sans\)/,
      'components.css must keep canonical .brand font-family token',
    );
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


describe('Sprint 7.6 — embedded-mode pattern fully retired (DEBT-2026-05-09-B CLOSED)', () => {
  // The Sprint 6.0.1 embedded-mode contract was the iframe-composition
  // affordance that hid child-page chrome when mounted inside the
  // vocabulary landing iframe. The whole pattern was retired across
  // Sprint 7.3 → 7.6 as DEBT-2026-05-09-B closed: all 3 vocab children
  // are now ES-module mounts under /js/vocab-modules/* and the parent
  // owns its own chrome. embedded-mode.css was deleted in Sprint 7.6.
  //
  // The 3 symmetric guards below survive as regression sentinels — they
  // prevent a future contributor from re-adding the IIFE via copy-paste
  // from an older revision.

  test('my-vocabulary.html no longer ships embedded-mode IIFE (Sprint 7.3 module migration)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/my-vocabulary.html'),
      'utf8',
    );
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'my-vocabulary.html must NOT set the embedded-mode class after Sprint 7.3 module migration',
    );
  });

  test('flashcards.html no longer ships embedded-mode IIFE (Sprint 7.4 module migration)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/flashcards.html'),
      'utf8',
    );
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'flashcards.html must NOT set the embedded-mode class after Sprint 7.4 module migration',
    );
  });

  test('exercises.html no longer ships embedded-mode IIFE (Sprint 7.5 module migration)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/exercises.html'),
      'utf8',
    );
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      'exercises.html must NOT set the embedded-mode class after Sprint 7.5 module migration',
    );
  });

  test('no embedded-mode.css link remains on the 3 vocab shells (Sprint 7.6 retirement)', () => {
    // After Sprint 7.6 the file is deleted; any surviving <link rel="stylesheet">
    // would 404 on production. Pin all 3 shells against the link reference.
    const pages = ['my-vocabulary.html', 'flashcards.html', 'exercises.html'];
    for (const name of pages) {
      const html = readFileSync(
        path.join(REPO_ROOT, 'frontend/pages', name),
        'utf8',
      );
      assert.ok(
        !/css\/embedded-mode\.css/.test(html),
        `${name} must NOT link the deleted embedded-mode.css (Sprint 7.6)`,
      );
    }
  });
});


// ── Sprint 6.20 — Gate 10 cross-page anchor sentinel ──────────────


// Pages where the canonical chrome IS a direct body child via
// `<div class="topnav-wrap"><nav class="topnav">...</nav></div>`. Gate
// 10 (DESIGN_SYSTEM.md § 17.14) requires this anchoring so the rendered
// nav position stays stationary cross-page. Two pages (home, vocabulary)
// previously nested `<nav class="topnav">` inside `<div class="shell">`,
// inheriting `.shell`'s 24px top padding — Andy reported nav drift on
// page navigation. Sprint 6.20 lifted both to canonical.
describe('Sprint 6.20 Gate 10 — .topnav-wrap is a direct <body> child on every canonical page', () => {
  CANONICAL_CHROME_PAGES.forEach((rel) => {
    test(`${rel} — .topnav-wrap is NOT nested inside .shell, <main>, <section>, or <article>`, () => {
      const raw = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Strip HTML comments so commented-out tag text doesn't trip the
      // depth counters. Sprint 6.17.2 + Sprint 6.20 changelog comments
      // contain literal `<main class="...">` and `<div class="shell">`
      // snippets that must not register as real elements.
      const html = raw.replace(/<!--[\s\S]*?-->/g, '');

      // Find the index of the first `.topnav-wrap` opening tag.
      const openMatch = html.match(/<div[^>]*\bclass=["'][^"']*\btopnav-wrap\b[^"']*["'][^>]*>/);
      assert.ok(openMatch,
        `${rel}: <div class="topnav-wrap"> must be present (Sprint 6.17.2 / 6.20 chrome contract)`);
      const wrapIdx = html.indexOf(openMatch[0]);
      const head = html.slice(0, wrapIdx);

      // .shell must not open before .topnav-wrap (Sprint 6.20 fix).
      // If `<div class="shell">` appears in `head`, chrome inherits
      // .shell's 24px top padding and drifts cross-page.
      const shellOpens = (head.match(/<div\b[^>]*\bclass=["'][^"']*\bshell\b/g) || []).length;
      assert.equal(
        shellOpens, 0,
        `${rel}: <div class="shell"> must NOT open before <div class="topnav-wrap"> ` +
        `— Sprint 6.20 fix lifted chrome out of .shell so nav anchors at viewport top edge`,
      );

      // <main>, <section>, <article> must be balanced (no unclosed
      // ancestor wrapping .topnav-wrap). These tags don't usually have
      // matching close in `head` if they wrap the wrap; if they do
      // have a balanced close, that's fine.
      const balanceCheck = (tag) => {
        const opens  = (head.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
        const closes = (head.match(new RegExp(`</${tag}>`,    'gi')) || []).length;
        assert.ok(
          opens - closes <= 0,
          `${rel}: <${tag}> must NOT be open when <div class="topnav-wrap"> opens ` +
          `(opens=${opens}, closes=${closes}). Gate 10 requires .topnav-wrap as a direct body child.`,
        );
      };
      ['main', 'section', 'article'].forEach(balanceCheck);
    });
  });
});
