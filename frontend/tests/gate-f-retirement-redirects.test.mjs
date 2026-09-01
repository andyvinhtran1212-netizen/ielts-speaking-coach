import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertFrozenLegacyArtifactSet,
  buildLegacyRetirementRedirects,
  discoverLegacyHtmlPaths,
  RETIREMENT_ARTIFACT_SET,
} from '../tooling/gate-f-retirement-redirects.mjs';
import { appPageRoute } from '../tooling/next-migration-status.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const paths = discoverLegacyHtmlPaths(path.join(FRONTEND, 'public'));
const redirects = buildLegacyRetirementRedirects(paths);
const soakRedirects = buildLegacyRetirementRedirects(paths, { permanent: false });

function appRoutes(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return appRoutes(path.join(root, entry.name), relative);
    const route = appPageRoute(relative);
    return route ? [route] : [];
  });
}

test('retirement plan is pinned to the exact frozen Legacy artifact set', () => {
  assert.equal(paths.length, RETIREMENT_ARTIFACT_SET.count);
  assert.deepEqual(assertFrozenLegacyArtifactSet(paths), paths);
  assert.throws(
    () => assertFrozenLegacyArtifactSet(paths.slice(1)),
    /legacy-retirement-artifact-count-drift/,
  );
  assert.throws(
    () => assertFrozenLegacyArtifactSet([...paths.slice(1), '/swapped.html']),
    /legacy-retirement-artifact-set-drift/,
  );
});

test('every Legacy HTML source is permanently intercepted before public serving', () => {
  const sources = new Set(redirects.map((entry) => entry.source));
  assert.equal(sources.size, paths.length);
  assert.deepEqual([...sources].sort(), paths);
  assert.ok(redirects.every((entry) => entry.permanent === true));
  assert.ok(redirects.every((entry) => !entry.destination.endsWith('.html')));
  assert.ok(redirects.every((entry) => !entry.destination.includes('[')));
});

test('redirect soak can intercept the same frozen manifest without browser-cached permanence', () => {
  assert.equal(soakRedirects.length, redirects.length);
  assert.deepEqual(
    soakRedirects.map(({ source, destination, has }) => ({ source, destination, has })),
    redirects.map(({ source, destination, has }) => ({ source, destination, has })),
  );
  assert.ok(soakRedirects.every((entry) => entry.permanent === false));
});

test('G1 changes phase explicitly: runtime redirects replace unreachable Legacy parity', () => {
  const workflow = readFileSync(
    path.join(FRONTEND, '..', '.github', 'workflows', 'parity-gate.yml'),
    'utf8',
  );
  assert.match(workflow, /id: gate_f/);
  assert.match(workflow, /LEGACY_RETIREMENT_REDIRECTS_PERMANENT = true/);
  assert.match(workflow, /name: Kiểm Gate F redirect manifest ở runtime/);
  const phaseGuard = String.raw`\n\s+if: steps\.gate_f\.outputs\.redirect_installed != 'true'`;
  assert.match(workflow, new RegExp(`name: Kiểm vế legacy phục vụ được VÀ gọi được backend${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Chọn phạm vi theo tệp đã sửa${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Chạy cổng parity \\(desktop \\+ điện thoại\\)${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Cổng đường-ghi \\(vế legacy — cùng bản khai\\)${phaseGuard}`));
});

test('every redirect destination resolves to a real App Router owner', () => {
  const owners = new Set(appRoutes(path.join(FRONTEND, 'app')));
  for (const redirect of redirects) {
    const pathname = redirect.destination.split('?')[0]
      .replace(/:([^/]+)/g, '[$1]');
    assert.ok(owners.has(pathname), `${redirect.source} redirects to missing ${pathname}`);
  }
  assert.ok(redirects.some((entry) => (
    entry.source === '/pages/admin/access-codes/index.html'
      && entry.destination === '/admin/users?tab=codes'
  )));
});

test('eight dynamic detail routes translate query identity and fail safe to an index', () => {
  const dynamic = redirects.filter((entry) => (
    Array.isArray(entry.has)
      && entry.has.some(({ value }) => String(value).includes('?<'))
  ));
  assert.equal(dynamic.length, 8);
  for (const rule of dynamic) {
    assert.ok(rule.has.length >= 1);
    assert.ok(rule.has.every(({ type, key, value }) => (
      type === 'query' && key && /^\(\?<[^>]+>\[\^\/\]\+\)$/.test(value)
    )));
    assert.ok(redirects.some((fallback) => (
      fallback.source === rule.source && !fallback.has && fallback.destination !== rule.destination
    )));
  }
  const grammar = dynamic.find((entry) => entry.source === '/pages/grammar-article.html');
  assert.equal(grammar.destination, '/grammar/:category/:slug');
  assert.deepEqual(grammar.has.map(({ key }) => key), ['category', 'slug']);

  for (const source of [
    '/pages/admin/classes/index.html',
    '/pages/admin/cohorts/index.html',
  ]) {
    const cohort = dynamic.find((entry) => entry.source === source);
    assert.equal(cohort.destination, '/admin/classes/:cohortId');
    assert.deepEqual(cohort.has.map(({ key }) => key), ['cohort_id']);
    assert.ok(redirects.some((entry) => (
      entry.source === source
        && entry.destination === '/admin/students'
        && entry.has?.[0]?.key === 'tab'
        && entry.has[0].value === 'students'
    )));
  }
});
