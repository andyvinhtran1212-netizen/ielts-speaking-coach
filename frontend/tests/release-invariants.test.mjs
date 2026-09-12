import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  classifyLegacyHtml,
  collectReleaseInvariants,
  redirectSourcesFromConfig,
  retirementRedirectsInstalledFromConfig,
  retirementRedirectsPermanentFromConfig,
  summarizeCorePlayers,
} from '../tooling/release-invariants.mjs';
import { appPageRoute } from '../tooling/app-route-inventory.mjs';
import {
  buildLegacyReplacementInventory,
  canonicalNextRouteForLegacy,
} from '../tooling/legacy-url-mapping.mjs';
import { LEGACY_RETIREMENT_PATHS } from '../tooling/legacy-url-redirects.mjs';

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

test('only recognizes the generated retirement manifest when config wires all three steps', () => {
  const complete = `
    import { buildLegacyRetirementRedirects } from './tooling/legacy-url-redirects.mjs';
    const LEGACY_RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
      LEGACY_RETIREMENT_PATHS,
    );
    async function redirects() { return [...LEGACY_RETIREMENT_REDIRECTS]; }
  `;
  assert.equal(retirementRedirectsInstalledFromConfig(complete), true);
  assert.equal(retirementRedirectsPermanentFromConfig(complete), true);
  assert.equal(retirementRedirectsPermanentFromConfig(`
    const LEGACY_RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
      LEGACY_RETIREMENT_PATHS,
      options,
    );
  `), null);
  assert.equal(retirementRedirectsPermanentFromConfig(`
    const LEGACY_RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
      paths,
    );
  `), null);
  assert.equal(retirementRedirectsInstalledFromConfig(
    '// ...LEGACY_RETIREMENT_REDIRECTS from legacy-url-redirects.mjs',
  ), false);
  assert.equal(retirementRedirectsInstalledFromConfig(
    complete.replace('...LEGACY_RETIREMENT_REDIRECTS', '// omitted'),
  ), false);
  assert.equal(retirementRedirectsInstalledFromConfig(
    complete.replace('...LEGACY_RETIREMENT_REDIRECTS', '...(flag ? [] : LEGACY_RETIREMENT_REDIRECTS)'),
  ), false);
  assert.equal(retirementRedirectsInstalledFromConfig(
    complete.replace(
      'async function redirects() { return [...LEGACY_RETIREMENT_REDIRECTS]; }',
      'const unused = [...LEGACY_RETIREMENT_REDIRECTS]; async function redirects() { return []; }',
    ),
  ), false);
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
  assert.equal(canonicalNextRouteForLegacy('/pages/admin/access-codes/index.html'), '/admin/users');
  assert.equal(canonicalNextRouteForLegacy('/pages/admin/cohorts/index.html'), '/admin/classes');
  assert.equal(canonicalNextRouteForLegacy('/pages/admin/dashboard/index.html'), '/admin');
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
  const report = collectReleaseInvariants();
  assert.equal(report.schemaVersion, 6);
  assert.equal(report.appPages.source, report.appPages.product + report.appPages.excluded.length);
  assert.equal(report.legacyHtml.total, report.legacyHtml.compatibilityRedirected + report.legacyHtml.directlyRenderable);
  assert.equal(report.legacyHtml.retired, true);
  assert.deepEqual(report.legacyHtml.publicSymlinkPaths, []);
  assert.equal(report.legacyHtml.serverRedirected, report.legacyHtml.total);
  assert.deepEqual(report.legacyHtml.clientRedirectStubPaths, []);
  assert.equal(report.legacyHtml.directlyRenderable, 0);
  assert.equal(report.legacyHtml.telemetryInstrumented, report.legacyHtml.directlyRenderable);
  assert.deepEqual(report.legacyHtml.telemetryMissingPaths, []);
  assert.equal(report.retirementObservationReady, true);
  // Historical URLs still need owners after their physical artifacts retire.
  // The physical freeze is enforced independently by legacy-url-redirects.
  assert.equal(report.legacyReplacement.total, LEGACY_RETIREMENT_PATHS.length);
  assert.equal(report.legacyReplacement.nextRoutePresent, LEGACY_RETIREMENT_PATHS.length);
  assert.deepEqual(report.legacyReplacement.entries.map((entry) => entry.legacyPath).sort(),
    [...LEGACY_RETIREMENT_PATHS].sort());
  assert.deepEqual(report.legacyReplacement.missingNextRoutes, []);
  assert.ok(report.legacyReplacement.entries.every((entry) => (
    entry.redirectState === 'installed-permanent'
      && entry.deletionState === 'retired'
  )));
  assert.deepEqual(report.routeOwnershipCollisions, []);
  assert.equal(report.corePlayers.nextReady, report.corePlayers.total);
  assert.equal(report.corePlayers.admittedToNext, report.corePlayers.total);
  assert.deepEqual(report.legacyRetirementRedirects, {
    installed: true,
    permanent: true,
    artifactSet: {
      count: 129,
      sha256: '5916f9f6ce2ee703a6b69d1996237cf126750a97c952f27efc35c00f7d729aa2',
    },
    rules: 139,
    sourcePaths: 129,
  });
  assert.equal(report.releaseReady, true);
  assert.deepEqual(report.blockers, []);
  assert.ok(!report.blockers.some((blocker) => blocker.code === 'core-admission-still-legacy'));
  assert.match(report.scopeNote, /historical evidence remains documented separately/i);
});

test('retirement redirects compose with all-Next admission to close static cutover', () => {
  const allNextPolicy = { surfaces: Object.fromEntries([
    'speaking',
    'reading_exam',
    'listening_test',
    'listening_dictation',
    'writing_assignment',
  ].map((surface) => [surface, {
    admit_new: 'next',
    next: { path: `/native/${surface}`, route_ready: true },
  }])) };
  const report = collectReleaseInvariants(undefined, {
    corePlayerPolicy: allNextPolicy,
  });
  assert.equal(report.corePlayers.admittedToNext, report.corePlayers.total);
  assert.equal(report.legacyHtml.directlyRenderable, 0);
  assert.equal(report.releaseReady, true);
  assert.deepEqual(report.blockers, []);
});

test('retired HTML cannot erase the redirect or replacement denominator', (t) => {
  const frontend = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const fixture = mkdtempSync(path.join(tmpdir(), 'aver-retirement-inventory-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(path.join(frontend, 'app'), path.join(fixture, 'app'), { recursive: true });
  cpSync(path.join(frontend, 'next.config.ts'), path.join(fixture, 'next.config.ts'));
  mkdirSync(path.join(fixture, 'public'));

  // A simulated empty public HTML tree, not deletion of repository artifacts.
  const retired = collectReleaseInvariants(fixture);
  assert.equal(retired.legacyHtml.total, 0);
  assert.equal(retired.legacyRetirementRedirects.sourcePaths, 129);
  assert.equal(retired.legacyRetirementRedirects.rules, 139);
  assert.equal(retired.legacyReplacement.total, 129);
  assert.equal(retired.legacyReplacement.nextRoutePresent, 129);
  assert.ok(retired.legacyReplacement.entries.every((entry) => entry.deletionState === 'retired'));

  symlinkSync(
    path.join(frontend, 'tests', 'fixtures', 'legacy-html-retired'),
    path.join(fixture, 'public', 'legacy'),
  );
  const linkedArchive = collectReleaseInvariants(fixture);
  assert.equal(linkedArchive.legacyHtml.retired, false);
  assert.deepEqual(linkedArchive.legacyHtml.publicSymlinkPaths, ['/legacy']);
  assert.ok(linkedArchive.blockers.some((row) => row.code === 'public-symlink-present'
    && row.paths.includes('/legacy')));
  assert.equal(linkedArchive.releaseReady, false);
  assert.ok(linkedArchive.legacyReplacement.entries.every((entry) => (
    entry.deletionState === 'blocked-release-safety-review'
  )));
  rmSync(path.join(fixture, 'public', 'legacy'));

  // Partial retirement must not shrink identity coverage either. This input
  // is a disposable source fixture, not a change to public repository files.
  writeFileSync(path.join(fixture, 'public', 'pricing.html'), '<h1>Historical</h1>');
  const partial = collectReleaseInvariants(fixture);
  assert.equal(partial.legacyHtml.total, 1);
  assert.deepEqual(partial.legacyHtml.serverRedirectedPaths, ['/pricing.html']);
  assert.equal(partial.legacyRetirementRedirects.sourcePaths, 129);
  assert.equal(partial.legacyReplacement.total, 129);
  assert.equal(partial.legacyReplacement.nextRoutePresent, 129);
  assert.ok(partial.legacyReplacement.entries.every((entry) => (
    entry.deletionState === 'blocked-release-safety-review'
  )));
  const withoutDeletionState = (entries) => entries.map(({ deletionState: _state, ...entry }) => entry);
  assert.deepEqual(
    withoutDeletionState(partial.legacyReplacement.entries),
    withoutDeletionState(retired.legacyReplacement.entries),
  );
  rmSync(path.join(fixture, 'public', 'pricing.html'));

  rmSync(path.join(fixture, 'app', '(authed-home)', 'home', 'page.tsx'));
  const missingOwner = collectReleaseInvariants(fixture);
  assert.equal(missingOwner.legacyReplacement.total, 129);
  assert.ok(missingOwner.legacyReplacement.missingNextRoutes.some((row) => row.nextPath === '/home'));
  assert.equal(missingOwner.legacyReplacement.nextRoutePresent, 128);
  assert.equal(missingOwner.legacyReplacement.entries.find((row) => row.nextPath === '/home')
    .deletionState, 'blocked-missing-next-route');
  assert.equal(missingOwner.releaseReady, false);

  writeFileSync(path.join(fixture, 'public', 'unexpected.html'), '<h1>Unowned</h1>');
  const extraHtml = collectReleaseInvariants(fixture);
  assert.ok(extraHtml.blockers.some((row) => row.code === 'legacy-html-renderable'
    && row.paths.includes('/unexpected.html')));

  writeFileSync(path.join(fixture, 'public', 'unexpected.html'),
    '<meta name="aver-legacy-artifact" content="redirect-stub">');
  const claimedStub = collectReleaseInvariants(fixture);
  assert.equal(claimedStub.legacyHtml.directlyRenderable, 0);
  assert.ok(claimedStub.blockers.some((row) => row.code === 'legacy-retirement-unregistered-html'
    && row.paths.includes('/unexpected.html')));
  assert.equal(claimedStub.releaseReady, false);
});
