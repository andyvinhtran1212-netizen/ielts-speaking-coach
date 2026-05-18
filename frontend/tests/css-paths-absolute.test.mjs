/**
 * frontend/tests/css-paths-absolute.test.mjs
 *
 * Sprint 6.15.8-hotfix — CSS-path absolutization sentinel.
 *
 * Vercel rewrites (frontend/vercel.json) change the served URL's depth
 * relative to the underlying HTML file. Example:
 *   /grammar/:category/:slug  →  /pages/grammar-article.html
 *   /writing/dashboard        →  /pages/writing-dashboard.html
 *   /admin/writing/prompts    →  /pages/admin/writing/prompts.html
 *
 * Browser sees the original URL when resolving relative paths, so
 * `<link href="../css/...">` on grammar-article.html resolves to
 * `/grammar/css/...` (404) rather than `/css/...`.
 *
 * The fix: every <link rel="stylesheet"> on a redesigned page must
 * use an absolute path (leading `/`) or a full URL (http/https/protocol-
 * relative). This sentinel pins that invariant.
 *
 * Coverage: all redesigned pages — discovered by the `av-theme-toggle`
 * filter (same heuristic as theme-toggle-layout-context.test.mjs).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');


// ── Discover redesigned pages ─────────────────────────────────────


function findHtmlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (['css', 'js', 'tests', 'images', 'fonts', 'aver-design'].includes(entry)) continue;
      findHtmlFiles(full, acc);
    } else if (entry.endsWith('.html') && !entry.startsWith('_') && entry !== 'practice.legacy.html') {
      acc.push(full);
    }
  }
  return acc;
}

const ALL_HTML = findHtmlFiles(FRONTEND);
// Sprint 7.12: pages migrated to <aver-chrome> no longer carry inline
// `av-theme-toggle` markup (it lives in the component's shadow root).
// Include them via the `<aver-chrome` substring so the absolute-path
// sentinel still audits their stylesheets.
const REDESIGNED_PAGES = ALL_HTML
  .map((p) => ({ abs: p, rel: path.relative(REPO_ROOT, p) }))
  .filter(({ abs }) => {
    const html = readFileSync(abs, 'utf8');
    return html.includes('av-theme-toggle') || html.includes('<aver-chrome');
  });


// ── href extractor ────────────────────────────────────────────────


/**
 * Extract every `<link rel="stylesheet" href="...">` href value from the
 * given HTML. Comments are stripped first so commented-out links don't
 * trip the assertion.
 */
function extractStylesheetHrefs(html) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<link\b[^>]*\brel\s*=\s*"stylesheet"[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) out.push(m[1]);
  return out;
}

function isAbsoluteOrExternal(href) {
  return (
    href.startsWith('/') ||      // absolute (incl. protocol-relative //)
    href.startsWith('http://') ||
    href.startsWith('https://')
  );
}


// ── Pins ──────────────────────────────────────────────────────────


describe('Stylesheet hrefs — absolute paths only (Vercel-rewrite safety)', () => {
  REDESIGNED_PAGES.forEach(({ abs, rel }) => {
    test(`${rel} — every <link rel="stylesheet"> href is absolute or external`, () => {
      const html = readFileSync(abs, 'utf8');
      const hrefs = extractStylesheetHrefs(html);
      assert.ok(
        hrefs.length > 0,
        `${rel}: no <link rel="stylesheet"> tags found — discovery walk regressed?`,
      );
      const relativeHrefs = hrefs.filter((h) => !isAbsoluteOrExternal(h));
      assert.deepStrictEqual(
        relativeHrefs, [],
        `${rel}: relative stylesheet hrefs found: ${JSON.stringify(relativeHrefs)}. ` +
        `Vercel rewrites (e.g. /grammar/:category/:slug → /pages/grammar-article.html) ` +
        `cause relative paths to 404 — use absolute /css/... instead.`,
      );
    });
  });
});


describe('Stylesheet href coverage — roster sanity', () => {
  test('discovers ≥ 25 redesigned pages with stylesheets to audit', () => {
    assert.ok(
      REDESIGNED_PAGES.length >= 25,
      `Expected ≥ 25 redesigned pages carrying the theme toggle, found ${REDESIGNED_PAGES.length}. ` +
      `If pages were intentionally removed, lower this bound; otherwise the discovery walk regressed.`,
    );
  });
});


// ── Grammar cluster dedicated pins (Sprint 6.15.8-hotfix root cause) ─


describe('Grammar Wiki cluster — Vercel-rewrite explicit hrefs', () => {
  // All 5 grammar pages are served under URLs that differ from the
  // underlying HTML path. Pin the exact canonical absolute hrefs so
  // future edits can't silently re-introduce relative paths.
  const EXPECTED_GRAMMAR_HREFS = [
    '/css/aver-design/tokens.css',
    '/css/aver-design/components.css',
    '/css/ds.css',
    '/css/grammar-wiki.css',
  ];

  const SUB_PAGES = [
    'frontend/pages/grammar-article.html',
    'frontend/pages/grammar-roadmap.html',
    'frontend/pages/grammar-search.html',
    'frontend/pages/grammar-compare.html',
  ];

  SUB_PAGES.forEach((rel) => {
    test(`${rel} — has all 4 canonical absolute CSS imports`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      const hrefs = extractStylesheetHrefs(html);
      EXPECTED_GRAMMAR_HREFS.forEach((expected) => {
        assert.ok(
          hrefs.includes(expected),
          `${rel}: missing canonical absolute CSS import "${expected}". ` +
          `Found hrefs: ${JSON.stringify(hrefs)}`,
        );
      });
    });
  });

  test('frontend/grammar.html — has all 4 canonical absolute CSS imports', () => {
    const html = readFileSync(path.join(REPO_ROOT, 'frontend/grammar.html'), 'utf8');
    const hrefs = extractStylesheetHrefs(html);
    EXPECTED_GRAMMAR_HREFS.forEach((expected) => {
      assert.ok(
        hrefs.includes(expected),
        `frontend/grammar.html: missing canonical absolute CSS import "${expected}". ` +
        `Found hrefs: ${JSON.stringify(hrefs)}`,
      );
    });
  });
});
