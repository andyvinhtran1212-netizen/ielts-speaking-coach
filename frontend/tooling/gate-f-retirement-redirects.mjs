// Final Gate F redirect plan for every frozen Legacy HTML artifact.
//
// The artifact set is hash-pinned so adding/removing/renaming a Legacy page
// cannot silently change production routing. Dynamic detail pages translate
// their required query identity into the App Router path; a missing identity
// falls back to the nearest safe index instead of rendering Legacy HTML.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { canonicalNextRouteForLegacy } from './gate-f-route-replacement-inventory.mjs';

export const RETIREMENT_ARTIFACT_SET = Object.freeze({
  count: 129,
  sha256: '5916f9f6ce2ee703a6b69d1996237cf126750a97c952f27efc35c00f7d729aa2',
});

const DYNAMIC_ROUTES = Object.freeze({
  '/pages/admin/classes/index.html': Object.freeze({
    destination: '/admin/classes/:cohortId',
    fallback: '/admin/classes',
    query: Object.freeze([Object.freeze({ key: 'cohort_id', parameter: 'cohortId' })]),
  }),
  '/pages/admin/cohorts/index.html': Object.freeze({
    destination: '/admin/classes/:cohortId',
    fallback: '/admin/classes',
    query: Object.freeze([Object.freeze({ key: 'cohort_id', parameter: 'cohortId' })]),
  }),
  '/pages/admin/listening/content-detail.html': Object.freeze({
    destination: '/admin/listening/content/:contentId',
    fallback: '/admin/listening',
    query: Object.freeze([Object.freeze({ key: 'id', parameter: 'contentId' })]),
  }),
  '/pages/admin/listening/content-meta.html': Object.freeze({
    destination: '/admin/listening/content/:contentId/edit',
    fallback: '/admin/listening',
    query: Object.freeze([Object.freeze({ key: 'id', parameter: 'contentId' })]),
  }),
  '/pages/admin/listening/tests-detail.html': Object.freeze({
    destination: '/admin/listening/tests/:testId',
    fallback: '/admin/listening/tests',
    query: Object.freeze([Object.freeze({ key: 'id', parameter: 'testId' })]),
  }),
  '/pages/grammar-article.html': Object.freeze({
    destination: '/grammar/:category/:slug',
    fallback: '/grammar',
    query: Object.freeze([
      Object.freeze({ key: 'category', parameter: 'category' }),
      Object.freeze({ key: 'slug', parameter: 'slug' }),
    ]),
  }),
  '/pages/reading-skill-exercise.html': Object.freeze({
    destination: '/reading/skill/:slug',
    fallback: '/reading/skill',
    query: Object.freeze([Object.freeze({ key: 'slug', parameter: 'slug' })]),
  }),
  '/pages/reading-vocab-passage.html': Object.freeze({
    destination: '/reading/vocab/:slug',
    fallback: '/reading/vocab',
    query: Object.freeze([Object.freeze({ key: 'slug', parameter: 'slug' })]),
  }),
});

const LEGACY_CLASS_WORKSPACE_PATHS = new Set([
  '/pages/admin/classes/index.html',
  '/pages/admin/cohorts/index.html',
]);

const DESTINATION_OVERRIDES = Object.freeze({
  '/pages/admin/access-codes/index.html': '/admin/users?tab=codes',
});

function walkHtml(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walkHtml(path.join(root, entry.name), relative);
    return entry.name.endsWith('.html') ? [`/${relative}`] : [];
  });
}

export function discoverLegacyHtmlPaths(publicRoot) {
  return walkHtml(publicRoot).sort();
}

export function legacyArtifactSetDigest(paths) {
  return createHash('sha256').update([...paths].sort().join('\n')).digest('hex');
}

export function assertFrozenLegacyArtifactSet(paths) {
  const normalized = [...new Set(paths)].sort();
  if (normalized.length !== RETIREMENT_ARTIFACT_SET.count) {
    throw new Error(
      `legacy-retirement-artifact-count-drift:${normalized.length}:expected-${RETIREMENT_ARTIFACT_SET.count}`,
    );
  }
  const digest = legacyArtifactSetDigest(normalized);
  if (digest !== RETIREMENT_ARTIFACT_SET.sha256) {
    throw new Error(`legacy-retirement-artifact-set-drift:${digest}`);
  }
  return normalized;
}

export function buildLegacyRetirementRedirects(paths) {
  const frozenPaths = assertFrozenLegacyArtifactSet(paths);
  return frozenPaths.flatMap((source) => {
    const dynamic = DYNAMIC_ROUTES[source];
    if (dynamic) {
      const rules = [
        {
          source,
          destination: dynamic.destination,
          permanent: true,
          has: dynamic.query.map(({ key, parameter }) => ({
            type: 'query',
            key,
            value: `(?<${parameter}>[^/]+)`,
          })),
        },
      ];
      // The retired class workspace also multiplexed the student directory at
      // `?tab=students`. A cohort deep-link wins (matching the Legacy page),
      // otherwise preserve that semantic tab by entering its native owner.
      if (LEGACY_CLASS_WORKSPACE_PATHS.has(source)) {
        rules.push({
          source,
          destination: '/admin/students',
          permanent: true,
          has: [{ type: 'query', key: 'tab', value: 'students' }],
        });
      }
      rules.push({ source, destination: dynamic.fallback, permanent: true });
      return rules;
    }

    const destination = DESTINATION_OVERRIDES[source]
      || canonicalNextRouteForLegacy(source);
    if (!destination || destination.includes('[') || destination.endsWith('.html')) {
      throw new Error(`legacy-retirement-destination-invalid:${source}:${destination}`);
    }
    return [{ source, destination, permanent: true }];
  });
}
