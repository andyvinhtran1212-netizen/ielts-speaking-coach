/**
 * frontend/tests/theme-toggle-layout-context.test.mjs
 *
 * Sprint 6.15.7-hotfix — structural-context sentinel for the theme
 * toggle button across the redesigned-page roster.
 *
 * Sprint 6.10.1 formalized Gate 3 (canonical .icon-sun / .icon-moon
 * class rendering). Existing test pins verify the markup *strings*
 * exist on each page. But they don't verify the button's DOM-tree
 * position — Andy hit a bug where `<button class="av-theme-toggle">`
 * was placed OUTSIDE the inner chrome flex container (a direct child
 * of `<nav>`), so block-flow positioning rendered it top-left with
 * stacked icons.
 *
 * This sentinel walks the file from the top and tracks open-tag depth
 * for `<div>`, `<nav>`, `<header>`. When it hits the theme-toggle
 * button, it asserts the *immediate enclosing* element is a `<div>` —
 * not `<nav>` or `<header>` or `<body>` directly. A `<div>` parent is
 * the canonical chrome wrapper (`.topnav-right`, `.flex items-center
 * gap-3`, etc.); anything else is the Sprint 6.15-era structural drift.
 *
 * Coverage: all 29 redesigned pages that ship the theme toggle. The
 * pin is generic enough to catch the same regression class on any
 * future page.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const FRONTEND = path.join(REPO_ROOT, 'frontend');


// ── Discover redesigned pages that ship the theme toggle ──────────


function findHtmlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip non-page subdirs.
      if (['css', 'js', 'tests', 'images', 'fonts', 'aver-design'].includes(entry)) continue;
      findHtmlFiles(full, acc);
    } else if (entry.endsWith('.html') && !entry.startsWith('_') && entry !== 'practice.legacy.html') {
      acc.push(full);
    }
  }
  return acc;
}

const ALL_HTML = findHtmlFiles(FRONTEND);
const REDESIGNED_PAGES = ALL_HTML
  .map((p) => ({ abs: p, rel: path.relative(REPO_ROOT, p) }))
  .filter(({ abs }) => readFileSync(abs, 'utf8').includes('av-theme-toggle'));


// ── Structural analyzer ───────────────────────────────────────────


/**
 * Find the theme-toggle button's immediate enclosing element by
 * scanning the file with a lightweight tag-depth tracker.
 *
 * Returns { parentTag, depth, charOffset } or null if no toggle found.
 *
 * Tracks open/close of <div>, <nav>, <header>, <main>, <body> only —
 * other tags can't legitimately wrap the chrome button. Self-closing
 * + void elements ignored. Comments stripped.
 */
function findToggleParent(html) {
  // Strip comments so commented-out theme toggles don't trip us.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');

  // Track only structural containers; we don't care about <span>, <a>,
  // <svg>, <button>, etc.
  const CONTAINERS = ['body', 'nav', 'header', 'main', 'div'];

  // Tag-event regex: opens like `<div ...>` or `<nav>` or closes `</div>`.
  // Captures: [1] = '/' for close, [2] = tag name.
  const tagRe = /<(\/?)(body|nav|header|main|div|button)\b[^>]*?(\/?)>/gi;
  const stack = [];

  let m;
  while ((m = tagRe.exec(stripped)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const isSelfClose = m[3] === '/';

    if (tag === 'button') {
      // Detect the theme-toggle button by inspecting the opening tag.
      const openTag = m[0];
      if (!isClose && /\bav-theme-toggle\b/.test(openTag)) {
        const parent = stack[stack.length - 1];
        return {
          parentTag: parent ? parent.tag : null,
          parentOpenTag: parent ? parent.openTag : null,
          depth: stack.length,
          charOffset: m.index,
        };
      }
      // Push/pop button so depth stays accurate, but don't fail here.
      if (isClose) {
        // Pop the matching <button>.
        while (stack.length && stack[stack.length - 1].tag !== 'button') stack.pop();
        if (stack.length) stack.pop();
      } else if (!isSelfClose) {
        stack.push({ tag: 'button', openTag });
      }
      continue;
    }

    if (!CONTAINERS.includes(tag)) continue;

    if (isClose) {
      // Pop until we balance the close.
      while (stack.length && stack[stack.length - 1].tag !== tag) stack.pop();
      if (stack.length) stack.pop();
    } else if (!isSelfClose) {
      stack.push({ tag, openTag: m[0] });
    }
  }
  return null;
}


describe('Theme toggle button — immediate parent must be a flex container', () => {
  // The Sprint 6.15-era structural drift class: the button is a direct
  // child of <nav> AFTER the inner flex <div> has closed — block flow
  // takes over and renders it top-left. The fix is to ensure the
  // immediate parent IS a flex container (whether <div class="flex ..."> or
  // a <nav> that itself has flex layout).
  REDESIGNED_PAGES.forEach(({ abs, rel }) => {
    test(`${rel} — toggle's immediate parent has flex layout`, () => {
      const html = readFileSync(abs, 'utf8');
      const parent = findToggleParent(html);
      assert.ok(
        parent,
        `${rel}: theme-toggle button not found by tag-depth scan`,
      );
      // Parent must have `flex` (Tailwind) OR a known chrome class with
      // intrinsic flex layout (`topnav-right`, `flex-row`, `inline-flex`,
      // `ob-nav`, etc.). The page-CSS adds flex for those custom classes;
      // we don't need to parse the CSS — the convention is well-known.
      const FLEX_HINTS = [
        /\bflex\b/,
        /\binline-flex\b/,
        /\btopnav-right\b/,
        /\btopnav-left\b/,
        /\bob-nav\b/,
        /\baw-header\b/,
        /\badmin-header\b/,
        /\bpf-header\b/,
        /\bmv-header\b/,
        /\bfc-header\b/,
        /\bex-header\b/,
        /\bftr-header\b/,
        /\bresult-header\b/,
        /\bpractice-header\b/,
        /\bspk-header\b/,
        /\bix-topnav\b/,
        /\bv-topnav\b/,
        /\bheader-actions\b/,
      ];
      const parentClassMatch = (parent.parentOpenTag || '').match(/class="([^"]+)"/);
      const parentClass = parentClassMatch ? parentClassMatch[1] : '';
      const isFlex = FLEX_HINTS.some((re) => re.test(parentClass));
      assert.ok(
        isFlex,
        `${rel}: theme-toggle button's immediate parent <${parent.parentTag}> ` +
        `(class="${parentClass}") does not appear to be a flex container. ` +
        `The Sprint 6.15-era drift class placed the button outside the inner ` +
        `flex wrapper — verify the button sits inside a flex chrome container.`,
      );
    });
  });
});


describe('Theme toggle button — must sit at meaningful depth (not page root)', () => {
  // Belt-and-suspenders: the toggle should be inside a chrome container
  // (<nav>, <header>, etc.), not a direct page-root child.
  REDESIGNED_PAGES.forEach(({ abs, rel }) => {
    test(`${rel} — toggle nested at least 2 levels deep`, () => {
      const html = readFileSync(abs, 'utf8');
      const parent = findToggleParent(html);
      assert.ok(parent, `${rel}: theme-toggle button not found`);
      assert.ok(
        parent.depth >= 2,
        `${rel}: toggle depth ${parent.depth} is too shallow — expected ≥ 2 (e.g. body > nav > button). ` +
        `Shallow placement suggests the button isn't inside a chrome container.`,
      );
    });
  });
});


describe('Theme toggle button — coverage roster', () => {
  test('discovers at least 25 redesigned pages with theme toggle', () => {
    assert.ok(
      REDESIGNED_PAGES.length >= 25,
      `Expected ≥ 25 redesigned pages carrying the theme toggle, found ${REDESIGNED_PAGES.length}. ` +
      `If pages were intentionally removed, lower this bound; otherwise the discovery walk regressed.`,
    );
  });
});


// Grammar cluster gets dedicated pins because Sprint 6.15.7-hotfix
// directly restructured these four files. Pin the canonical wrapper.
describe('Grammar Wiki cluster — Sprint 6.15.7-hotfix nav wrapper', () => {
  const GRAMMAR_PAGES = [
    'frontend/grammar.html',
    'frontend/pages/grammar-article.html',
    'frontend/pages/grammar-roadmap.html',
    'frontend/pages/grammar-search.html',
    'frontend/pages/grammar-compare.html',
  ];

  GRAMMAR_PAGES.forEach((rel) => {
    test(`${rel} — toggle uses absolute /js/theme-toggle.js import`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Absolute path eliminates the Vercel-rewrite relative-resolution
      // ambiguity (/grammar/:category/:slug → /pages/grammar-article.html).
      assert.match(
        html,
        /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\/js\/theme-toggle\.js['"]/,
        `${rel}: must import bindToggleButton from absolute path /js/theme-toggle.js (Sprint 6.15.7-hotfix Item 3)`,
      );
      assert.ok(
        !/import[^;]*from\s+['"]\.\.\/js\/theme-toggle\.js/.test(html),
        `${rel}: stale relative ../js/theme-toggle.js import must be removed`,
      );
    });
  });

  // Sprint 6.17.2: the 4 grammar sub-pages now ship the canonical full
  // nav (Cat 3 exclusion overridden). The Sprint 6.15.7-hotfix wrapper
  // requirement was specific to the breadcrumb-style chrome; under the
  // canonical chrome the toggle lives inside .topnav-right which is
  // itself a flex container — already pinned by the structural sentinel
  // earlier in this file (`toggle's immediate parent has flex layout`).
  const SUB_PAGES = [
    'frontend/pages/grammar-article.html',
    'frontend/pages/grammar-roadmap.html',
    'frontend/pages/grammar-search.html',
    'frontend/pages/grammar-compare.html',
  ];

  SUB_PAGES.forEach((rel) => {
    test(`${rel} — theme toggle sits inside canonical .topnav-right flex container`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Match: <div class="topnav-right"> ... <button class="av-theme-toggle"> ... </div>
      const wrapperPattern = /<div[^>]*class="[^"]*\btopnav-right\b[^"]*"[^>]*>[\s\S]{0,500}<button[^>]*\bav-theme-toggle\b[\s\S]{0,1500}<\/button>/;
      assert.match(
        html, wrapperPattern,
        `${rel}: theme-toggle button must sit inside <div class="topnav-right"> (canonical chrome)`,
      );
    });
  });
});
