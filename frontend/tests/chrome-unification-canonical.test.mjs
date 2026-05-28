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


// Sprint 7.13 milestone: ALL 18 canonical chrome pages migrated to
// <aver-chrome>. CANONICAL_CHROME_PAGES (inline-chrome roster) is now
// empty — Sprint 7.14 retires `components.css` chrome rules + per-page
// CSS duplicates next.

const MIGRATED_PAGES = [
  // Sprint 7.12 batch 1 — skill landings (5)
  { path: 'frontend/pages/home.html',              active: 'home' },
  { path: 'frontend/pages/writing-dashboard.html', active: 'writing' },
  { path: 'frontend/pages/speaking.html',          active: 'speaking' },
  { path: 'frontend/grammar.html',                 active: 'grammar' },
  { path: 'frontend/pages/vocabulary.html',        active: 'vocabulary' },
  // Sprint 7.13 batch 2 — sub-pages (13)
  { path: 'frontend/pages/practice.html',          active: 'speaking' },
  { path: 'frontend/pages/result.html',            active: 'speaking' },
  { path: 'frontend/pages/full-test-result.html',  active: 'speaking' },
  { path: 'frontend/pages/writing-result.html',    active: 'writing' },
  { path: 'frontend/pages/my-vocabulary.html',     active: 'vocabulary' },
  { path: 'frontend/pages/flashcards.html',        active: 'vocabulary' },
  { path: 'frontend/pages/exercises.html',         active: 'vocabulary' },
  { path: 'frontend/pages/profile.html',           active: 'home' },
  { path: 'frontend/onboarding.html',              active: 'home' },
  { path: 'frontend/pages/grammar-roadmap.html',   active: 'grammar' },
  { path: 'frontend/pages/grammar-article.html',   active: 'grammar' },
  { path: 'frontend/pages/grammar-search.html',    active: 'grammar' },
  { path: 'frontend/pages/grammar-compare.html',   active: 'grammar' },
];

// Sprint 7.13: empty roster — all 18 pages migrated.
const CANONICAL_CHROME_PAGES = [];


// ── Canonical foundation: components.css + user-pill.js ───────────


describe('Sprint 6.17 foundation — canonical chrome rules (Sprint 7.14: now in <aver-chrome> shadow style)', () => {
  // Sprint 7.14 — the canonical chrome rules (.topnav-wrap, .topnav,
  // .brand, .nav-links, .topnav-right, .user-pill, .user-menu*) moved
  // from components.css into the shadow-root <style> block in
  // frontend/js/components/aver-chrome.js. components.css now only
  // owns the page-level `.shell` primitive. These pins point at the
  // new source of truth.
  let components;
  let chromeJs;
  before(() => {
    components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
    chromeJs = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/components/aver-chrome.js'),
      'utf8',
    );
  });

  test('.shell rule defined in components.css', () => {
    assert.match(components, /\.shell\s*\{[^}]*max-width:\s*1180px/);
  });

  test('.topnav-wrap (lightweight body-less wrapper) defined in aver-chrome shadow style', () => {
    assert.match(chromeJs, /\.topnav-wrap\s*\{[^}]*max-width:\s*1180px/);
  });

  test('.topnav + .brand + .nav-links + .topnav-right defined in aver-chrome shadow style', () => {
    for (const sel of ['.topnav', '.brand', '.nav-links', '.topnav-right']) {
      const escaped = sel.replace(/\./g, '\\.');
      assert.match(chromeJs, new RegExp(`${escaped}\\s*\\{`),
        `aver-chrome.js shadow style should define ${sel}`);
    }
  });

  test('.user-pill + .user-menu + .user-menu-dropdown + .user-menu-item defined in aver-chrome shadow style', () => {
    for (const sel of ['.user-pill', '.user-menu', '.user-menu-dropdown', '.user-menu-item']) {
      const escaped = sel.replace(/\./g, '\\.');
      assert.match(chromeJs, new RegExp(`${escaped}\\s*\\{`),
        `aver-chrome.js shadow style should define ${sel}`);
    }
  });

  test('.nav-links .locked::after carries "Soon" label in aver-chrome shadow style', () => {
    assert.match(chromeJs, /\.nav-links\s+\.locked::after\s*\{[^}]*content:\s*"Soon"/);
  });

  test('mobile breakpoint @media (max-width: 720px) handles topnav layout in aver-chrome shadow style', () => {
    const mediaIdx = chromeJs.indexOf('@media (max-width: 720px)');
    const wrapIdx  = chromeJs.indexOf('.topnav-wrap', mediaIdx);
    assert.ok(mediaIdx > -1, 'aver-chrome.js should declare @media (max-width: 720px)');
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

  test('grammar-wiki.css no longer needs the Sprint 7.8-hotfix font-family scoping override', () => {
    // Sprint 7.14 — chrome moved into <aver-chrome>'s shadow root, so
    // the editorial DM Sans body font on grammar-wiki pages can no
    // longer cascade into .brand / .topnav etc. The defensive scoping
    // rule was retired in Sprint 7.14. Guard against accidental
    // re-introduction.
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'),
      'utf8',
    );
    assert.ok(
      !/body\.av-page\s+\.topnav-wrap\s*,/m.test(css),
      'grammar-wiki.css must NOT redeclare the body.av-page chrome font-family override (Sprint 7.14 retired it)',
    );
  });

  test('canonical .brand rule (Sprint 7.14: lives in aver-chrome shadow style) uses var(--av-fs-lg) + var(--av-font-sans)', () => {
    const chromeJs = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/components/aver-chrome.js'),
      'utf8',
    );
    assert.match(
      chromeJs,
      /\.brand\s*\{[^}]*font-size:\s*var\(--av-fs-lg\)/,
      'aver-chrome.js shadow style must keep canonical .brand font-size token',
    );
    assert.match(
      chromeJs,
      /\.brand\s*\{[^}]*font-family:\s*var\(--av-font-sans\)/,
      'aver-chrome.js shadow style must keep canonical .brand font-family token',
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

      test('ships all 6 active skill tabs (Trang chủ, Writing, Speaking, Listening, Grammar, Vocabulary)', () => {
        // Sprint 11.1 — Listening promoted from locked tab to active
        // tab (DEBT-LISTENING-MODULE foundation 1/5).
        for (const skill of ['Trang chủ', 'Writing', 'Speaking', 'Listening', 'Grammar', 'Vocabulary']) {
          assert.ok(html.includes(`>${skill}</a>`),
            `${rel} should ship "${skill}" skill tab`);
        }
      });

      test('ships exactly 1 locked tab (Reading — Listening promoted to active in Sprint 11.1)', () => {
        assert.match(html, /<span class=["']locked["'][^>]*>Reading<\/span>/);
        // Sprint 11.1 — Listening is no longer locked.
        assert.ok(
          !/<span class=["']locked["'][^>]*>Listening<\/span>/.test(html),
          `${rel} must NOT carry a locked Listening span — promoted to active link in Sprint 11.1`,
        );
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


// ── Sprint 7.11 — <aver-chrome> component source pins ────────────


describe('Sprint 7.11 — <aver-chrome> Web Component contract', () => {
  let component;
  before(() => {
    component = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/components/aver-chrome.js'),
      'utf8',
    );
  });

  test('component file exists and is non-empty', () => {
    assert.ok(component.length > 1000, 'aver-chrome.js should be a substantive module');
  });

  test('exports AverChrome class extending HTMLElement', () => {
    assert.match(component, /export\s+class\s+AverChrome\s+extends\s+HTMLElement/);
  });

  test('observedAttributes returns ["active"] (Phase B Q2)', () => {
    assert.match(component, /static\s+get\s+observedAttributes\s*\(\s*\)\s*\{\s*return\s*\[\s*['"]active['"]\s*\]\s*;?\s*\}/);
  });

  test('registers custom element via customElements.define("aver-chrome", AverChrome)', () => {
    assert.match(component, /customElements\.define\(\s*['"]aver-chrome['"]\s*,\s*AverChrome\s*\)/);
  });

  test('imports bindToggleButton from /js/theme-toggle.js (Phase B reuse)', () => {
    assert.match(component, /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"]\/js\/theme-toggle\.js['"]/);
  });

  test('imports canonicalInitials from /js/user-pill.js (Phase B reuse + single source of truth)', () => {
    assert.match(component, /import\s*\{\s*canonicalInitials\s*\}\s*from\s*['"]\/js\/user-pill\.js['"]/);
  });

  test('attaches Shadow DOM with mode:"open" (Phase B Q1)', () => {
    assert.match(component, /attachShadow\(\s*\{\s*mode:\s*['"]open['"]\s*\}\s*\)/);
  });

  test('setUser method defined on prototype (Phase B Q4)', () => {
    assert.match(component, /\bsetUser\s*\(\s*\{[^}]*name[^}]*\}\s*=\s*\{\}\s*\)\s*\{/);
  });

  test('setUser marks _userOverride = true so auto-fetch skips', () => {
    assert.match(component, /this\._userOverride\s*=\s*true/);
  });

  test('connectedCallback wires shadow → render → active → toggle → dropdown → logout → populate', () => {
    assert.match(component, /connectedCallback\s*\(\s*\)\s*\{[\s\S]*attachShadow[\s\S]*_applyActive[\s\S]*_bindToggle[\s\S]*_bindDropdown[\s\S]*_bindLogout[\s\S]*_schedulePopulate/);
  });

  test('attributeChangedCallback observes only "active"', () => {
    assert.match(component, /attributeChangedCallback\s*\(\s*name\s*,\s*prev\s*,\s*next\s*\)\s*\{[\s\S]*?if\s*\(\s*name\s*!==\s*['"]active['"]\s*\)\s*return/);
  });

  test('disconnectedCallback tears down toggle + abort controller + doc listeners + poll timer', () => {
    const m = component.match(/disconnectedCallback\s*\(\s*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(m, 'disconnectedCallback must exist');
    const body = m[0];
    assert.match(body, /_toggleTeardown/);
    assert.match(body, /_abortController/);
    assert.match(body, /_docClickHandler/);
    assert.match(body, /_docKeydownHandler/);
    assert.match(body, /_pollTimer/);
  });

  test('logout dispatches av-chrome-signed-out CustomEvent (composed) before redirect', () => {
    assert.match(component, /new CustomEvent\(\s*['"]av-chrome-signed-out['"]\s*,\s*\{[\s\S]*?composed:\s*true/);
  });

  test('logout calls window.getSupabase().auth.signOut() in try/catch', () => {
    assert.match(component, /window\.getSupabase\s*===\s*['"]function['"][\s\S]*?signOut/);
  });

  test('Supabase polling pattern (Phase B Q5) — recursive setTimeout up to POLL_MAX_TRIES', () => {
    assert.match(component, /POLL_INTERVAL_MS\s*=\s*\d+/);
    assert.match(component, /POLL_MAX_TRIES\s*=\s*\d+/);
    assert.match(component, /setTimeout\(\s*tick\s*,\s*POLL_INTERVAL_MS\s*\)/);
  });

  test('AbortController used for dropdown listener cleanup', () => {
    assert.match(component, /new AbortController\(\s*\)/);
  });

  test('VALID_ACTIVE enum lists exactly the 5 skills (Phase B Q2)', () => {
    const m = component.match(/VALID_ACTIVE\s*=\s*\[([^\]]+)\]/);
    assert.ok(m);
    const skills = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    // Sprint 11.1 — 'listening' added as the 6th skill (DEBT-LISTENING-
    // MODULE foundation 1/5). VALID_ACTIVE now has 6 entries.
    assert.deepEqual(skills.sort(), ['grammar', 'home', 'listening', 'speaking', 'vocabulary', 'writing']);
  });

  test('shadow tree contains canonical brand wordmark with span.dot', () => {
    assert.match(component, /Aver<span class="dot">\.<\/span>Learning/);
  });

  test('shadow tree contains all 7 skill links with data-tab attrs', () => {
    // Sprint 11.1 — 'listening' joined the canonical 5; Sprint 20.2 — 'reading'
    // promoted from locked tab to active link (cluster 20.x L1 Vocab Reading).
    for (const tab of ['home', 'writing', 'speaking', 'listening', 'grammar', 'vocabulary', 'reading']) {
      const re = new RegExp(`data-tab="${tab}"`);
      assert.match(component, re, `nav-links must include data-tab="${tab}"`);
    }
  });

  test('shadow tree contains zero locked spans (Reading promoted to active in Sprint 20.2)', () => {
    const matches = component.match(/<span class="locked"/g) || [];
    assert.equal(matches.length, 0, 'expected 0 locked tabs; Reading promoted to active in Sprint 20.2');
    // Reading is now an active nav link, not a locked span.
    assert.match(
      component,
      /href="\/pages\/reading-vocab\.html"\s+data-tab="reading">Reading<\/a>/,
      'Reading must be an active nav link (Sprint 20.2 unlock).',
    );
    assert.ok(
      !/<span class="locked" aria-disabled="true">Reading<\/span>/.test(component),
      'Reading must NOT carry the locked class anymore (Sprint 20.2).',
    );
  });

  test('shadow tree contains theme toggle button with both SVG icons', () => {
    assert.match(component, /<button class="av-theme-toggle" id="theme-toggle"/);
    assert.match(component, /class="icon-sun"/);
    assert.match(component, /class="icon-moon"/);
  });

  test('shadow tree contains user pill + dropdown + 2 menu items', () => {
    assert.match(component, /<button class="user-pill" id="user-pill"/);
    assert.match(component, /<span class="avatar" id="user-avatar">/);
    assert.match(component, /<span id="user-pill-name">/);
    assert.match(component, /class="user-menu-dropdown" role="menu" hidden/);
    assert.match(component, /href="\/pages\/profile\.html"[^>]*role="menuitem">Hồ sơ/);
    assert.match(component, /id="user-menu-logout"[^>]*role="menuitem">Đăng xuất/);
  });

  test('ARIA preserved: aria-label="Primary" on nav, aria-haspopup on pill, role="menu" on dropdown', () => {
    assert.match(component, /<nav class="topnav" aria-label="Primary">/);
    assert.match(component, /aria-haspopup="true"/);
    assert.match(component, /role="menu"/);
  });

  test('inline style block uses --av-* tokens (CSS custom properties cross shadow boundary)', () => {
    assert.match(component, /var\(--av-fs-lg\)/);
    assert.match(component, /var\(--av-primary\)/);
    assert.match(component, /var\(--av-text-primary\)/);
    assert.match(component, /var\(--av-border-subtle\)/);
    assert.match(component, /var\(--av-surface-card\)/);
  });

  test('theme-aware icon swap uses :host-context([data-theme="dark"])', () => {
    assert.match(component, /:host-context\(\[data-theme="dark"\]\)\s+\.av-theme-toggle\s+\.icon-sun/);
    assert.match(component, /:host-context\(\[data-theme="dark"\]\)\s+\.av-theme-toggle\s+\.icon-moon/);
  });

  test(':host { display: block } so the component is a block-level container', () => {
    assert.match(component, /:host\s*\{[^}]*display:\s*block/);
  });

  test('no window.* global handler leaks (event-delegation hygiene per Sprint 7.3 pattern)', () => {
    // Allow window.getSupabase / window.location / window.matchMedia / window.location.href reads;
    // but no `window.foo = ...` assignments that leak handlers globally.
    const leakRe = /window\.[A-Za-z_]\w*\s*=\s*function|window\.[A-Za-z_]\w*\s*=\s*\(/g;
    const matches = component.match(leakRe) || [];
    assert.equal(matches.length, 0, `no window.* handler assignment leaks: found ${matches.join(', ')}`);
  });

  test('idempotent mount — connectedCallback short-circuits on second mount', () => {
    assert.match(component, /if\s*\(\s*this\._mounted\s*\)\s*return/);
    assert.match(component, /this\._mounted\s*=\s*true/);
  });

  test('href targets match canonical chrome contract (7 skill landings + profile)', () => {
    // Sprint 11.1 — Listening href joined the canonical 5; Sprint 20.2 — Reading.
    assert.match(component, /href="\/pages\/home\.html"\s+data-tab="home"/);
    assert.match(component, /href="\/pages\/writing-dashboard\.html"\s+data-tab="writing"/);
    assert.match(component, /href="\/pages\/speaking\.html"\s+data-tab="speaking"/);
    assert.match(component, /href="\/pages\/listening\.html"\s+data-tab="listening"/);
    assert.match(component, /href="\/grammar\.html"\s+data-tab="grammar"/);
    assert.match(component, /href="\/pages\/vocabulary\.html"\s+data-tab="vocabulary"/);
    assert.match(component, /href="\/pages\/reading-vocab\.html"\s+data-tab="reading"/);
  });
});


// ── Sprint 7.12 — batch 1 migration contract (5 skill landings) ────


describe('Sprint 7.12 — migrated pages consume <aver-chrome>', () => {
  MIGRATED_PAGES.forEach(({ path: rel, active }) => {
    describe(rel, () => {
      let html;
      before(() => {
        html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      });

      test(`carries <aver-chrome active="${active}"> element`, () => {
        const re = new RegExp(`<aver-chrome\\s+active="${active}"\\s*>`);
        assert.match(html, re,
          `${rel}: must declare <aver-chrome active="${active}"> (Sprint 7.12 migration).`);
      });

      test('loads /js/components/aver-chrome.js as ES module', () => {
        assert.match(
          html,
          /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
          `${rel}: must include the component module so customElements.define runs.`,
        );
      });

      test('no inline .topnav-wrap markup (shadow root owns chrome)', () => {
        assert.equal(
          /<div\s+class="topnav-wrap"/.test(html),
          false,
          `${rel}: chrome markup must live inside the component shadow root, not inline.`,
        );
      });

      test('no inline canonical chrome IDs (#theme-toggle / #user-pill / #user-avatar)', () => {
        for (const id of ['theme-toggle', 'user-pill', 'user-avatar', 'user-pill-name', 'user-menu-logout']) {
          assert.equal(
            new RegExp(`\\bid="${id}"`).test(html),
            false,
            `${rel}: must not retain inline id="${id}" (now in shadow root).`,
          );
        }
      });

      test('no per-page bindToggleButton import or /js/user-pill.js src tag', () => {
        assert.equal(
          /import\s*\{\s*bindToggleButton\s*\}\s*from\s*['"]\/js\/theme-toggle\.js['"]/.test(html),
          false,
          `${rel}: theme-toggle.js binding moved into <aver-chrome>.`,
        );
        assert.equal(
          /<script[^>]+src="\/js\/user-pill\.js"/.test(html),
          false,
          `${rel}: user-pill.js auto-bind moved into <aver-chrome>.`,
        );
      });

      test('preserves anti-flash IIFE in <head> (pre-CSS-load requirement)', () => {
        // The IIFE must still set [data-theme] BEFORE any stylesheet.
        // It lives per-page because it must run pre-paint — the component
        // attaches shadow on connectedCallback, well after first paint.
        const headIdx = html.indexOf('</head>');
        const head = html.slice(0, headIdx);
        assert.match(head, /document\.documentElement\.setAttribute\(\s*['"]data-theme['"]/);
      });
    });
  });
});


// ── Sprint 7.14 — chrome-unification cleanup closure ──────────────


describe('Sprint 7.14 — components.css chrome rules retired (chrome lives in <aver-chrome>)', () => {
  // Sprint 7.14 closure: the duplicate chrome rules in components.css
  // are fully retired. Source of truth is aver-chrome.js (shadow root
  // <style>). This block guards against accidental re-introduction of
  // the legacy rules in components.css.
  test('components.css no longer ships .topnav-wrap / .topnav / .brand / .user-pill rules', () => {
    const components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
    // Match the start-of-line selectors only — avoids matching the
    // retirement comment block that still mentions these names.
    for (const sel of ['.topnav-wrap', '.topnav', '.brand', '.user-pill', '.user-menu', '.nav-links', '.topnav-right']) {
      const escaped = sel.replace(/\./g, '\\.');
      const re = new RegExp(`^${escaped}\\s*\\{`, 'm');
      assert.ok(
        !re.test(components),
        `components.css must NOT redeclare ${sel} — chrome lives in aver-chrome.js shadow style (Sprint 7.14)`,
      );
    }
  });

  test('user-pill.js + theme-toggle.js remain as shared helpers consumed by <aver-chrome>', () => {
    // Sprint 7.11/7.13 — aver-chrome.js imports bindToggleButton from
    // /js/theme-toggle.js and canonicalInitials from /js/user-pill.js.
    // Both modules still exist as the canonical source for the chrome
    // behavior (now consumed via ES module import, no longer via
    // DOMContentLoaded auto-bind on every page).
    const userPill = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/user-pill.js'),
      'utf8',
    );
    const themeToggle = readFileSync(
      path.join(REPO_ROOT, 'frontend/js/theme-toggle.js'),
      'utf8',
    );
    assert.match(userPill, /export\s+function\s+canonicalInitials/);
    assert.match(themeToggle, /export\s+function\s+bindToggleButton/);
  });
});


// ── Sprint 7.13.1-hotfix — every chrome page calls initSupabase() ───


describe('Sprint 7.13.1-hotfix — every <aver-chrome> page must call initSupabase()', () => {
  // The <aver-chrome> component polls window.getSupabase for ~3s after
  // mount. window.getSupabase is only exposed once initSupabase() runs
  // (api.js contract, Sprint 6.x). 5 grammar pages shipped supabase-js +
  // api.js but never called initSupabase — pill stuck at placeholder.
  // This sentinel guards against the same omission recurring on any
  // future migrated page.
  MIGRATED_PAGES.forEach(({ path: rel }) => {
    test(`${rel} calls initSupabase()`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(
        html,
        /\binitSupabase\s*\(/,
        `${rel}: must call initSupabase(SUPABASE_URL, SUPABASE_ANON) so <aver-chrome> can resolve window.getSupabase and populate the user pill`,
      );
    });
  });

  test('canonical Supabase URL pinned across migrated pages', () => {
    // All migrated pages reference the same project URL. If a page is
    // pointed at a different project, that's a configuration drift.
    const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
    MIGRATED_PAGES.forEach(({ path: rel }) => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.ok(
        html.includes(SUPABASE_URL),
        `${rel}: must reference canonical SUPABASE_URL "${SUPABASE_URL}"`,
      );
    });
  });
});
