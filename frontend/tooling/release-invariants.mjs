#!/usr/bin/env node
// Machine-readable permanent release invariants for the Next.js application.
//
// This reports code-side retirement truth. Historical operational evidence
// and any owner-approved exception remain documented separately. It freezes
// the exit criteria that can be derived from the repository: product App
// Router pages, legacy HTML files that are still
// directly renderable, route ownership collisions and core-player admission.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_PLAYER_AFFINITY_POLICY } from '../lib/core-player-affinity.mjs';
import { appPageRoute, NON_PRODUCT_APP_PAGE_ROUTES } from './app-route-inventory.mjs';
import { buildLegacyReplacementInventory } from './legacy-url-mapping.mjs';
import {
  buildLegacyRetirementRedirects,
  LEGACY_RETIREMENT_PATHS,
  RETIREMENT_ARTIFACT_SET,
} from './legacy-url-redirects.mjs';
import { findCollisions } from './route-ownership-check.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const LEGACY_RETIREMENT_BEACON = '/js/legacy-retirement-beacon.js';
export const RUNTIME_CONFIG_SCRIPT = 'runtime-config.js';
export const CLIENT_REDIRECT_STUB_MARKER = 'name="aver-legacy-artifact" content="redirect-stub"';

export function retirementRedirectsInstalledFromConfig(source) {
  const config = String(source || '');
  return /from '\.\/tooling\/legacy-url-redirects\.mjs'/.test(config)
    && /const LEGACY_RETIREMENT_REDIRECTS\s*=\s*buildLegacyRetirementRedirects\(/.test(config)
    && /return \[[\s\S]*\.\.\.LEGACY_RETIREMENT_REDIRECTS/.test(config);
}

export function retirementRedirectsPermanentFromConfig(source) {
  const config = String(source || '');
  const call = config.match(
    /const LEGACY_RETIREMENT_REDIRECTS\s*=\s*buildLegacyRetirementRedirects\(([\s\S]*?)\n?\s*\);/,
  );
  if (!call) return null;

  const argument = call[1].replace(/\s/g, '').replace(/,$/, '');
  return argument === 'LEGACY_RETIREMENT_PATHS' ? true : null;
}

function walkFiles(root, accept, prefix = '') {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(path.join(root, entry.name), accept, relative));
    else if (accept(entry.name)) files.push(relative);
  }
  return files;
}

function walkSymlinks(root, prefix = '') {
  const links = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) links.push(relative);
    else if (entry.isDirectory()) links.push(...walkSymlinks(path.join(root, entry.name), relative));
  }
  return links;
}

export function redirectSourcesFromConfig(source) {
  const redirects = new Map();
  const pattern = /\{\s*source:\s*'([^']+)'\s*,\s*destination:\s*'([^']+)'\s*,\s*permanent:\s*(true|false)\s*\}/g;
  for (const match of String(source || '').matchAll(pattern)) {
    redirects.set(match[1], { destination: match[2], permanent: match[3] === 'true' });
  }
  return redirects;
}

export function classifyLegacyHtml(publicHtmlPaths, redirectSources, clientRedirectPaths = []) {
  const redirected = [];
  const clientRedirected = [];
  const renderable = [];
  const clientRedirectSet = new Set(clientRedirectPaths);
  for (const publicPath of [...publicHtmlPaths].sort()) {
    if (redirectSources.has(publicPath)) redirected.push(publicPath);
    else if (clientRedirectSet.has(publicPath)) clientRedirected.push(publicPath);
    else renderable.push(publicPath);
  }
  return { redirected, clientRedirected, renderable };
}

export function summarizeCorePlayers(policy = CORE_PLAYER_AFFINITY_POLICY) {
  const entries = Object.entries(policy?.surfaces || {}).map(([surface, config]) => ({
    surface,
    nextPath: config?.next?.path || null,
    nextRouteReady: config?.next?.route_ready === true,
    admitNew: config?.admit_new || null,
  }));
  return {
    total: entries.length,
    nextReady: entries.filter((entry) => entry.nextRouteReady).length,
    admittedToNext: entries.filter((entry) => entry.admitNew === 'next').length,
    entries,
  };
}

export function collectReleaseInvariants(
  frontendRoot = FRONTEND,
  { corePlayerPolicy = CORE_PLAYER_AFFINITY_POLICY } = {},
) {
  const sourceAppPages = [...new Set(walkFiles(path.join(frontendRoot, 'app'), (name) => /^page\.(tsx|ts)$/.test(name))
    .map(appPageRoute)
    .filter(Boolean))]
    .sort();
  const excludedAppPages = sourceAppPages.filter((route) => NON_PRODUCT_APP_PAGE_ROUTES.includes(route));
  const productAppPages = sourceAppPages.filter((route) => !NON_PRODUCT_APP_PAGE_ROUTES.includes(route));
  const publicHtmlPaths = walkFiles(path.join(frontendRoot, 'public'), (name) => name.endsWith('.html'))
    .map((relative) => `/${relative}`)
    .sort();
  const publicSymlinkPaths = walkSymlinks(path.join(frontendRoot, 'public'))
    .map((relative) => `/${relative}`)
    .sort();
  const artifactsRetired = publicHtmlPaths.length === 0 && publicSymlinkPaths.length === 0;
  const configSource = readFileSync(path.join(frontendRoot, 'next.config.ts'), 'utf8');
  const redirects = redirectSourcesFromConfig(configSource);
  const retirementRedirectsInstalled = retirementRedirectsInstalledFromConfig(configSource);
  const retirementRedirectsPermanent = retirementRedirectsPermanentFromConfig(configSource);
  const retirementRedirectRules = retirementRedirectsInstalled
    && retirementRedirectsPermanent === true
    ? buildLegacyRetirementRedirects(LEGACY_RETIREMENT_PATHS)
    : [];
  for (const redirect of retirementRedirectRules) {
    redirects.set(redirect.source, {
      destination: redirect.destination,
      permanent: redirect.permanent,
    });
  }
  const clientRedirectPaths = publicHtmlPaths.filter((publicPath) => (
    readFileSync(path.join(frontendRoot, 'public', publicPath.slice(1)), 'utf8')
      .includes(CLIENT_REDIRECT_STUB_MARKER)
  ));
  const legacyHtml = classifyLegacyHtml(publicHtmlPaths, redirects, clientRedirectPaths);
  const telemetryMissingPaths = legacyHtml.renderable.filter((publicPath) => {
    const source = readFileSync(path.join(frontendRoot, 'public', publicPath.slice(1)), 'utf8');
    return !source.includes(`src="${LEGACY_RETIREMENT_BEACON}"`)
      || !source.includes(RUNTIME_CONFIG_SCRIPT);
  });
  const corePlayers = summarizeCorePlayers(corePlayerPolicy);
  const ownership = findCollisions();
  // Once final redirects are installed, keep proving an App Router owner for
  // every retired artifact. Scoping only to still-renderable paths would make
  // this inventory empty and allow a redirect-to-404 regression to look green.
  const replacementPaths = retirementRedirectsInstalled
    ? LEGACY_RETIREMENT_PATHS
    : legacyHtml.renderable;
  const legacyReplacement = buildLegacyReplacementInventory(
    replacementPaths,
    productAppPages,
    {
      redirectsInstalled: retirementRedirectsInstalled,
      redirectsPermanent: retirementRedirectsPermanent,
      artifactsRetired,
    },
  );
  const blockers = [];
  // A claimed client-side redirect is not authority to add a new HTML URL.
  // Before decoupling, the filesystem-based hash check rejected all drift;
  // retain fail-closed visibility for extra files, including redirect stubs.
  const registeredPaths = new Set(LEGACY_RETIREMENT_PATHS);
  const unregisteredHtml = retirementRedirectsInstalled
    ? publicHtmlPaths.filter((publicPath) => !registeredPaths.has(publicPath))
    : [];
  if (unregisteredHtml.length) blockers.push({
    code: 'legacy-retirement-unregistered-html',
    count: unregisteredHtml.length,
    paths: unregisteredHtml,
  });
  if (publicSymlinkPaths.length) blockers.push({
    code: 'public-symlink-present',
    count: publicSymlinkPaths.length,
    paths: publicSymlinkPaths,
  });
  if (retirementRedirectsInstalled && retirementRedirectsPermanent === null) blockers.push({
    code: 'legacy-retirement-redirect-permanence-unproven',
    count: 1,
  });
  if (legacyHtml.renderable.length) blockers.push({
    code: 'legacy-html-renderable',
    count: legacyHtml.renderable.length,
    paths: legacyHtml.renderable,
  });
  if (telemetryMissingPaths.length) blockers.push({
    code: 'legacy-retirement-telemetry-missing',
    count: telemetryMissingPaths.length,
    paths: telemetryMissingPaths,
  });
  if (legacyReplacement.missingNextRoutes.length) blockers.push({
    code: 'legacy-next-replacement-missing',
    count: legacyReplacement.missingNextRoutes.length,
    routes: legacyReplacement.missingNextRoutes,
  });
  const coreNotReady = corePlayers.entries.filter((entry) => !entry.nextRouteReady).map((entry) => entry.surface);
  if (coreNotReady.length) blockers.push({ code: 'core-next-route-not-ready', count: coreNotReady.length, surfaces: coreNotReady });
  const coreStillLegacy = corePlayers.entries.filter((entry) => entry.admitNew !== 'next').map((entry) => entry.surface);
  if (coreStillLegacy.length) blockers.push({ code: 'core-admission-still-legacy', count: coreStillLegacy.length, surfaces: coreStillLegacy });
  if (ownership.collisions.length) blockers.push({ code: 'route-ownership-collision', count: ownership.collisions.length, details: ownership.collisions });

  return {
    schemaVersion: 6,
    scope: 'permanent-release-invariants',
    scopeNote: 'Repository release truth; historical evidence remains documented separately.',
    appPages: {
      source: sourceAppPages.length,
      product: productAppPages.length,
      excluded: excludedAppPages,
    },
    legacyHtml: {
      total: publicHtmlPaths.length,
      retired: artifactsRetired,
      publicSymlinkPaths,
      compatibilityRedirected: legacyHtml.redirected.length + legacyHtml.clientRedirected.length,
      serverRedirected: legacyHtml.redirected.length,
      clientRedirectStubs: legacyHtml.clientRedirected.length,
      directlyRenderable: legacyHtml.renderable.length,
      telemetryInstrumented: legacyHtml.renderable.length - telemetryMissingPaths.length,
      telemetryMissingPaths,
      redirectedPaths: [...legacyHtml.redirected, ...legacyHtml.clientRedirected].sort(),
      serverRedirectedPaths: legacyHtml.redirected,
      clientRedirectStubPaths: legacyHtml.clientRedirected,
      renderablePaths: legacyHtml.renderable,
    },
    legacyReplacement,
    legacyRetirementRedirects: {
      installed: retirementRedirectsInstalled,
      permanent: retirementRedirectsPermanent,
      artifactSet: RETIREMENT_ARTIFACT_SET,
      rules: retirementRedirectRules.length,
      sourcePaths: [...new Set(retirementRedirectRules.map((entry) => entry.source))].length,
    },
    corePlayers,
    routeOwnershipCollisions: ownership.collisions,
    retirementObservationReady: telemetryMissingPaths.length === 0,
    releaseReady: blockers.length === 0,
    blockers,
  };
}

function printHuman(report) {
  console.log('Next.js permanent release invariants');
  console.log(`  App Router product pages: ${report.appPages.product} (${report.appPages.source} source; ${report.appPages.excluded.length} non-product excluded)`);
  console.log(`  Legacy HTML: ${report.legacyHtml.total} total; ${report.legacyHtml.serverRedirected} server-redirected; ${report.legacyHtml.clientRedirectStubs} client redirect stubs; ${report.legacyHtml.directlyRenderable} still directly renderable`);
  console.log(`  Retirement telemetry: ${report.legacyHtml.telemetryInstrumented}/${report.legacyHtml.directlyRenderable} renderable legacy pages instrumented`);
  console.log(`  Legacy replacements: ${report.legacyReplacement.nextRoutePresent}/${report.legacyReplacement.total} retirement-scope paths have an App Router owner`);
  console.log(`  Core players: ${report.corePlayers.nextReady}/${report.corePlayers.total} Next routes ready; ${report.corePlayers.admittedToNext}/${report.corePlayers.total} admitting new sessions to Next`);
  console.log(`  Route ownership collisions: ${report.routeOwnershipCollisions.length}`);
  console.log(`  Release ready: ${report.releaseReady ? 'YES' : 'NO'}`);
  if (report.blockers.length) {
    console.log('  Blockers:');
    for (const blocker of report.blockers) console.log(`    - ${blocker.code}: ${blocker.count}`);
  }
  console.log(`  Note: ${report.scopeNote}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = collectReleaseInvariants();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (process.argv.includes('--assert-release-ready') && !report.releaseReady) process.exitCode = 1;
}
