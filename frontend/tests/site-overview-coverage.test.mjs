/**
 * frontend/tests/site-overview-coverage.test.mjs
 *
 * Keeps docs/SITE_OVERVIEW.md from silently rotting (Lesson 5 — light, tolerant
 * doc sentinel). Checks:
 *   A. No dead references — every `pages/….html` (and root page) the doc cites
 *      actually exists under frontend/.
 *   B. Coverage floor — the doc documents the large majority of REAL product
 *      pages (route-bearing .html under frontend/, excluding test fixtures /
 *      graphify / theme-test / legacy). Trips when many new pages land
 *      undocumented, without being brittle about every utility page.
 *   C. Spine pages — a few must-document surfaces are present.
 *
 * Intentionally tolerant: update the doc when this trips, don't loosen blindly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const FRONTEND = path.join(REPO, 'frontend');
const doc = readFileSync(path.join(REPO, 'docs/SITE_OVERVIEW.md'), 'utf8');

// ── Real product pages (route-bearing .html under frontend/) ──────────
function walk(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (['node_modules', 'graphify-out', 'tests', 'public', '.next', 'app'].includes(e.name)) continue; // public/ reached via compat symlinks at legacy paths (Phase 1)
      out.push(...walk(path.join(dir, e.name), r));
    } else if (e.name.endsWith('.html')) {
      if (e.name === '_theme-test.html' || e.name.includes('.legacy.')) continue;
      out.push(r);
    }
  }
  return out;
}
const productPages = walk(FRONTEND);            // e.g. "pages/practice.html", "index.html"

// ── Paths cited in the doc (full relative paths only) ─────────────────
// Root pages are cited like `admin.html (root)`; pages/* are cited as full paths.
const ROOT_PAGES = ['index.html', 'login.html', 'onboarding.html', 'pricing.html',
                    'admin.html', 'grammar.html', 'vocabulary.html'];
const citedFull = new Set();
for (const m of doc.matchAll(/`(pages\/[A-Za-z0-9_/-]+\.html)`/g)) citedFull.add(m[1]);
for (const root of ROOT_PAGES) {
  if (new RegExp('`' + root.replace('.', '\\.') + '`').test(doc)) citedFull.add(root);
}


describe('SITE_OVERVIEW — no dead references (A)', () => {
  test('every cited page path exists under frontend/', () => {
    const dead = [...citedFull].filter((p) => !existsSync(path.join(FRONTEND, p)));
    assert.deepEqual(dead, [], 'doc cites non-existent pages: ' + dead.join(', '));
  });
});

describe('SITE_OVERVIEW — coverage floor (B)', () => {
  test('documents the large majority of real product pages', () => {
    const documented = productPages.filter((p) => citedFull.has(p));
    const coverage = documented.length / productPages.length;
    const missing = productPages.filter((p) => !citedFull.has(p));
    assert.ok(coverage >= 0.85,
      `coverage ${(coverage * 100).toFixed(0)}% (${documented.length}/${productPages.length}); ` +
      `undocumented: ${missing.join(', ')}`);
  });
});

describe('SITE_OVERVIEW — README points here (D)', () => {
  // Single-source guard: README must defer to SITE_OVERVIEW for the product
  // map, so the detailed per-page/feature map lives in exactly one place.
  test('README links to docs/SITE_OVERVIEW.md', () => {
    const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
    assert.match(readme, /docs\/SITE_OVERVIEW\.md/,
      'README must point to docs/SITE_OVERVIEW.md (single source of truth)');
  });
});

describe('SITE_OVERVIEW — spine pages present (C)', () => {
  const spine = [
    'pages/practice.html', 'pages/reading-exam.html', 'pages/reading-review.html',
    'pages/admin/dashboard/reading-attempts.html', 'pages/admin/reading/content.html',
    'login.html',
  ];
  for (const p of spine) {
    test(`documents ${p}`, () => {
      assert.ok(citedFull.has(p), `SITE_OVERVIEW must document ${p}`);
    });
  }
});
