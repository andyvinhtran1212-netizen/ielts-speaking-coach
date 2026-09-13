/**
 * SITE_OVERVIEW's nine original obligations, now measured against native pages:
 * A. No dead page references. Historical HTML names resolve through the durable
 *    redirect manifest plus a present Next owner, not a retained physical file.
 * B. At least 85% of product App Router pages have a purpose/audience row in §4.
 * C. The six original must-document product surfaces remain required.
 * D. README still points to this single product map.
 * Source/doc coverage only; no assertion of rendered UI or endpoint correctness.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectOverviewPages, inspectOverview } from '../tooling/site-overview-coverage.mjs';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(path.join(REPO, 'docs/SITE_OVERVIEW.md'), 'utf8');
const { routes } = collectOverviewPages(path.join(REPO, 'frontend'));
const report = inspectOverview(doc, routes);

describe('SITE_OVERVIEW — no dead references (A)', () => {
  test('every cited page has a native owner or registered historical replacement', () => {
    assert.deepEqual(report.invalidReferences, [], 'Unknown or non-canonical page references');
    assert.deepEqual(report.deadLegacyReferences, [], 'Unknown historical HTML or missing native replacement');
  });
});

describe('SITE_OVERVIEW — coverage floor (B)', () => {
  test('documents the large majority of real product pages', () => {
    assert.ok(report.coverage >= 0.85,
      'coverage ' + (report.coverage * 100).toFixed(0) + '% (' +
      report.documented.length + '/' + routes.length + '); undocumented: ' + report.missing.join(', '));
  });
});

describe('SITE_OVERVIEW — README points here (D)', () => {
  test('README links to docs/SITE_OVERVIEW.md', () => {
    const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
    assert.match(readme, /docs\/SITE_OVERVIEW\.md/,
      'README must point to docs/SITE_OVERVIEW.md (single source of truth)');
  });
});

describe('SITE_OVERVIEW — spine pages present (C)', () => {
  // Pin the six expected identities independently and verify their canonical
  // mapping too; blindly deriving both sides could hide a wrong-owner change.
  const spine = [
    ['/pages/practice.html', '/practice/session'],
    ['/pages/reading-exam.html', '/reading/exam/session'],
    ['/pages/reading-review.html', '/reading/review'],
    ['/pages/admin/dashboard/reading-attempts.html', '/admin/dashboard/reading-attempts'],
    ['/pages/admin/reading/content.html', '/admin/reading/content'],
    ['/login.html', '/login'],
  ];
  for (const [legacy, route] of spine) {
    test('documents ' + route, () => {
      assert.equal(canonicalNextRouteForLegacy(legacy), route, 'Spine replacement changed: ' + legacy);
      assert.ok(report.documented.includes(route), 'SITE_OVERVIEW must document ' + route);
    });
  }
});
