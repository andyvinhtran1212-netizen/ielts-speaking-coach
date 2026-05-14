/**
 * frontend/tests/cross-page-navigation-canonical.test.mjs
 *
 * Sprint 6.16 — pins canonical back-button label discipline across
 * the 29 redesigned pages so future contributors cannot reintroduce
 * the "Dashboard" label drift Sprint 5.1 + Sprint 6.13a-extension
 * left behind.
 *
 * Canonical labels (Andy's call):
 *   - Pages routing to /pages/home.html → "Trang chủ" / "Quay lại trang chủ"
 *   - Pages routing to a parent module (speaking.html, writing dashboard,
 *     etc.) → "Quay lại"  (generic, module-neutral)
 *
 * Sentinel: rejects any `<a>` or `<button>` whose visible text label
 * contains the bare word "Dashboard". Internal section names (e.g.
 * `main-tab-label`, `loadGrammarDashboard()` JS, Lucide icon
 * `layout-dashboard`) are not button labels and are explicitly
 * tolerated via the matcher shape below.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

// Pages touched by Sprint 6.16 navigation discipline. Mirrors the
// PHASE_CLOSURE_LEDGER.md cumulative-29-pages list, excluding pages
// where back navigation isn't applicable (onboarding.html — no back
// link; home.html — already canonical and self-referential).
const REDESIGNED_PAGES = [
  'frontend/index.html',
  'frontend/grammar.html',
  'frontend/admin.html',
  'frontend/pages/speaking.html',
  'frontend/pages/practice.html',
  'frontend/pages/result.html',
  'frontend/pages/full-test-result.html',
  'frontend/pages/writing-dashboard.html',
  'frontend/pages/writing-result.html',
  'frontend/pages/vocabulary.html',
  'frontend/pages/my-vocabulary.html',
  'frontend/pages/flashcards.html',
  'frontend/pages/exercises.html',
  'frontend/pages/profile.html',
  'frontend/pages/admin-writing.html',
  'frontend/pages/admin-writing-new.html',
  'frontend/pages/admin-writing-status.html',
  'frontend/pages/admin-writing-prompts.html',
  'frontend/pages/admin-writing-assignments.html',
  'frontend/pages/admin-writing-grade.html',
  'frontend/pages/admin-students.html',
  'frontend/pages/admin-instructor-queue.html',
  'frontend/pages/grammar-roadmap.html',
  'frontend/pages/grammar-article.html',
  'frontend/pages/grammar-search.html',
  'frontend/pages/grammar-compare.html',
];

const fileBodies = {};

before(() => {
  REDESIGNED_PAGES.forEach((rel) => {
    fileBodies[rel] = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  });
});


/**
 * Match any `<a>` or `<button>` whose visible text label contains
 * the bare word "Dashboard". The matcher only inspects the text
 * between the opening tag and the closing tag and ignores attribute
 * values, so:
 *   - `<a data-foo="Dashboard">…</a>` is OK (attribute value)
 *   - `<a><span class="main-tab-label">Dashboard</span></a>` is OK
 *     (a child <span> with a non-link role — Speaking's internal tab)
 *   - `<a>Dashboard</a>` is flagged
 *   - `<a>Quay lại Dashboard</a>` is flagged
 *
 * Implementation: strip all `<…>` children, then check if any non-tag
 * text segment contains "Dashboard" as a whole word.
 */
function findDashboardLabelInButtonOrLink(html) {
  const re = /<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const offenders = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[2];
    // Strip nested elements — Speaking's `main-tab-label` span is the
    // canonical tab-name carrier and is NOT a back-button label.
    const textOnly = inner.replace(/<[^>]+>/g, '').trim();
    if (/\bDashboard\b/.test(textOnly)) {
      offenders.push({
        tag: m[1],
        snippet: m[0].slice(0, 200),
        textOnly: textOnly.slice(0, 80),
      });
    }
  }
  return offenders;
}

describe('Sprint 6.16 — no "Dashboard" label in back-buttons / nav links across redesigned pages', () => {
  REDESIGNED_PAGES.forEach((rel) => {
    test(`${rel} has no <a>/<button> with bare "Dashboard" text label`, () => {
      const offenders = findDashboardLabelInButtonOrLink(fileBodies[rel]);
      // Filter out Speaking's `main-tab-label` (internal tab name —
      // documented as Category D / Issue 2 boundary, not navigation
      // drift). The matcher's child-stripping should already exclude
      // these, but defense-in-depth: explicitly tolerate `<span
      // class="main-tab-label">Dashboard</span>` patterns.
      const legitOffenders = offenders.filter(
        (o) => !/main-tab-label/i.test(o.snippet),
      );
      assert.strictEqual(
        legitOffenders.length,
        0,
        `${rel} has ${legitOffenders.length} drift: ${JSON.stringify(legitOffenders)}`,
      );
    });
  });
});


describe('Canonical "Trang chủ" label present on home-bound pages', () => {
  // Sprint 7.12 + 7.13: 18 chrome pages migrated to <aver-chrome>; the
  // "Trang chủ" nav link is pinned once inside the component source
  // (chrome-unification-canonical.test.mjs). admin-writing.html keeps
  // inline chrome (Cat 5 out-of-scope), so the page-level label
  // sentinel remains for the admin family.
  const HOME_BOUND_SAMPLES = [
    'frontend/pages/admin-writing.html',
  ];

  HOME_BOUND_SAMPLES.forEach((rel) => {
    test(`${rel} contains canonical "Trang chủ" label`, () => {
      assert.match(
        fileBodies[rel],
        /trang chủ/i,
        `${rel} should carry canonical "Trang chủ" / "trang chủ" label`,
      );
    });
  });
});


describe('Canonical "Quay lại" label preserved on Speaking-flow + Writing-flow pages', () => {
  // Sample Category B pages — generic "Quay lại" (module-neutral)
  // after Sprint 6.16.
  const MODULE_BOUND_SAMPLES = [
    'frontend/pages/practice.html',
    'frontend/pages/result.html',
    'frontend/pages/full-test-result.html',
    'frontend/pages/writing-result.html',
  ];

  MODULE_BOUND_SAMPLES.forEach((rel) => {
    test(`${rel} contains canonical "Quay lại" label`, () => {
      assert.match(
        fileBodies[rel],
        /Quay lại/,
        `${rel} should carry canonical "Quay lại" label after Sprint 6.16`,
      );
    });
  });
});


describe('Destination URLs preserved byte-identical', () => {
  // Sprint 7.12 + 7.13: 18 chrome pages migrated to <aver-chrome>; the
  // canonical chrome's /pages/home.html link lives in the component
  // shadow root. Pages below carry page-content back-links OUTSIDE the
  // chrome (context bars, secondary navs), which we still pin per-page.
  const HREF_PINS = [
    { page: 'frontend/pages/practice.html',                 href: '/pages/speaking.html' },
    { page: 'frontend/pages/result.html',                   href: '/pages/speaking.html' },
    { page: 'frontend/pages/full-test-result.html',         href: '/pages/speaking.html' },
    { page: 'frontend/pages/writing-result.html',           href: '/writing/dashboard' },
    { page: 'frontend/pages/admin-writing.html',            href: '/pages/home.html' },
    { page: 'frontend/admin.html',                          href: 'pages/home.html' },
  ];

  HREF_PINS.forEach(({ page, href }) => {
    test(`${page} preserves back-link href="${href}"`, () => {
      // Escape regex specials in href
      const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        fileBodies[page],
        new RegExp(`href=["']${escaped}["']`),
        `${page} must preserve href="${href}" (Sprint 6.16 was label-only)`,
      );
    });
  });
});
