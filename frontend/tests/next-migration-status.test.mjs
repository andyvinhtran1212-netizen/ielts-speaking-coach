import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appPageRoute,
  classifyLegacyHtml,
  collectNextMigrationStatus,
  redirectSourcesFromConfig,
  summarizeCorePlayers,
} from '../tooling/next-migration-status.mjs';

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
  assert.deepEqual(classifyLegacyHtml(['/legacy.html', '/served.html'], redirects), {
    redirected: ['/legacy.html'],
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

test('repository report is internally consistent and cannot overclaim completion', () => {
  const report = collectNextMigrationStatus();
  assert.equal(report.appPages.source, report.appPages.product + report.appPages.excluded.length);
  assert.equal(report.legacyHtml.total, report.legacyHtml.compatibilityRedirected + report.legacyHtml.directlyRenderable);
  assert.deepEqual(report.routeOwnershipCollisions, []);
  assert.equal(report.staticCutoverReady, false, 'remove this pin only in the intentional final static cutover');
  assert.ok(report.blockers.some((blocker) => blocker.code === 'legacy-html-renderable'));
  assert.ok(report.blockers.some((blocker) => blocker.code === 'core-admission-still-legacy'));
  assert.match(report.scopeNote, /operational evidence/i);
});
