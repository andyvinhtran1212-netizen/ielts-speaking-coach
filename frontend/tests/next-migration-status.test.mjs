import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appPageRoute,
  classifyLegacyHtml,
  collectNextMigrationStatus,
  redirectSourcesFromConfig,
  summarizeCorePlayers,
} from '../tooling/next-migration-status.mjs';
import {
  buildLegacyReplacementInventory,
  canonicalNextRouteForLegacy,
} from '../tooling/gate-f-route-replacement-inventory.mjs';

test('derives App Router page paths without counting route groups or private folders', () => {
  assert.equal(appPageRoute('(marketing)/page.tsx'), '/');
  assert.equal(appPageRoute('(authed)/admin/classes/[cohortId]/page.tsx'), '/admin/classes/[cohortId]');
  assert.equal(appPageRoute('(authed)/@modal/profile/page.ts'), '/profile');
  assert.equal(appPageRoute('_components/example/page.tsx'), null);
  assert.equal(appPageRoute('api/route.ts'), null);
});

test('only treats actual Next redirects as compatibility redirects', () => {
  const config = `
    { source: '/legacy.html', destination: '/native', permanent: false },
    { source: '/old.html', destination: '/new', permanent: true },
    { source: '/clean', destination: '/pages/clean.html' },
  `;
  const redirects = redirectSourcesFromConfig(config);
  assert.deepEqual([...redirects.keys()], ['/legacy.html', '/old.html']);
  assert.deepEqual(classifyLegacyHtml(
    ['/client-stub.html', '/legacy.html', '/served.html'],
    redirects,
    ['/client-stub.html'],
  ), {
    redirected: ['/legacy.html'],
    clientRedirected: ['/client-stub.html'],
    renderable: ['/served.html'],
  });
});

test('reports core route readiness separately from new-session admission', () => {
  const report = summarizeCorePlayers({ surfaces: {
    ready_dark: { admit_new: 'legacy', next: { path: '/next', route_ready: true } },
    cut_over: { admit_new: 'next', next: { path: '/next-2', route_ready: true } },
    unfinished: { admit_new: 'legacy', next: { path: '/next-3', route_ready: false } },
  } });
  assert.equal(report.total, 3);
  assert.equal(report.nextReady, 2);
  assert.equal(report.admittedToNext, 1);
});

test('maps legacy aliases and nested filename families to canonical Next routes', () => {
  assert.equal(canonicalNextRouteForLegacy('/pages/admin/classes/index.html'), '/admin/classes');
  assert.equal(canonicalNextRouteForLegacy('/pages/grammar-search.html'), '/grammar/search');
  assert.equal(canonicalNextRouteForLegacy('/pages/reading-exam.html'), '/reading/exam/session');
  assert.equal(canonicalNextRouteForLegacy('/pages/listening-test.html'), '/listening/test/session');
  assert.equal(canonicalNextRouteForLegacy('/pages/admin/listening/content-detail.html'), '/admin/listening/content/[contentId]');
  assert.equal(canonicalNextRouteForLegacy('/pages/vocabulary.html'), '/vocabulary/hub');
  assert.equal(canonicalNextRouteForLegacy('/vocabulary.html'), '/vocabulary');
  assert.equal(buildLegacyReplacementInventory(['/pages/exam.html'], ['/exam']).entries[0].owner, 'exam-platform');
  assert.equal(canonicalNextRouteForLegacy('not-a-route'), null);
});

test('replacement inventory fails closed when an App Router owner is absent', () => {
  const inventory = buildLegacyReplacementInventory(
    ['/pages/home.html', '/pages/mock-exam.html'],
    ['/home'],
  );
  assert.equal(inventory.total, 2);
  assert.equal(inventory.nextRoutePresent, 1);
  assert.deepEqual(inventory.missingNextRoutes, [{
    legacyPath: '/pages/mock-exam.html',
    nextPath: '/mock-exam',
    owner: 'mock-exam',
  }]);
  assert.equal(inventory.entries[1].deletionState, 'blocked-missing-next-route');
});

test('repository report is internally consistent and cannot overclaim completion', () => {
  const report = collectNextMigrationStatus();
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.appPages.source, report.appPages.product + report.appPages.excluded.length);
  assert.equal(report.legacyHtml.total, report.legacyHtml.compatibilityRedirected + report.legacyHtml.directlyRenderable);
  assert.equal(report.legacyHtml.serverRedirected, 4);
  assert.deepEqual(report.legacyHtml.clientRedirectStubPaths, [
    '/admin.html',
    '/pages/admin/cohorts/index.html',
    '/pages/admin/students/index.html',
    '/pricing.html',
  ]);
  assert.equal(report.legacyHtml.telemetryInstrumented, report.legacyHtml.directlyRenderable);
  assert.deepEqual(report.legacyHtml.telemetryMissingPaths, []);
  assert.equal(report.gateFObservationReady, true);
  assert.equal(report.legacyReplacement.total, report.legacyHtml.directlyRenderable);
  assert.equal(report.legacyReplacement.nextRoutePresent, 120);
  assert.deepEqual(report.legacyReplacement.missingNextRoutes, [
    { legacyPath: '/pages/mock-exam.html', nextPath: '/mock-exam', owner: 'mock-exam' },
  ]);
  assert.deepEqual(report.routeOwnershipCollisions, []);
  assert.equal(report.corePlayers.nextReady, report.corePlayers.total);
  assert.equal(report.corePlayers.admittedToNext, 0);
  assert.equal(report.staticCutoverReady, false, 'remove this pin only in the intentional final static cutover');
  assert.ok(report.blockers.some((blocker) => blocker.code === 'legacy-html-renderable'));
  assert.ok(report.blockers.some((blocker) => blocker.code === 'core-admission-still-legacy'));
  assert.ok(report.blockers.some((blocker) => blocker.code === 'legacy-next-replacement-missing'));
  assert.ok(!report.blockers.some((blocker) => blocker.code === 'core-next-route-not-ready'));
  assert.ok(!report.blockers.some((blocker) => blocker.code === 'legacy-retirement-telemetry-missing'));
  assert.match(report.scopeNote, /operational evidence/i);
});
