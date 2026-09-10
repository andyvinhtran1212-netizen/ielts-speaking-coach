import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertFrozenLegacyArtifactSet,
  buildLegacyRetirementRedirects,
  discoverLegacyHtmlPaths,
  LEGACY_RETIREMENT_PATHS,
  RETIREMENT_ARTIFACT_SET,
} from '../tooling/gate-f-retirement-redirects.mjs';
import { appPageRoute, collectNextMigrationStatus } from '../tooling/next-migration-status.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const paths = discoverLegacyHtmlPaths(path.join(FRONTEND, 'public'));
const redirects = buildLegacyRetirementRedirects(paths);
const soakRedirects = buildLegacyRetirementRedirects(paths, { permanent: false });
const nextConfig = readFileSync(path.join(FRONTEND, 'next.config.ts'), 'utf8');

function appRoutes(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return appRoutes(path.join(root, entry.name), relative);
    const route = appPageRoute(relative);
    return route ? [route] : [];
  });
}

test('retirement plan is pinned to the exact frozen Legacy artifact set', () => {
  assert.ok(Object.isFrozen(LEGACY_RETIREMENT_PATHS));
  assert.equal(new Set(LEGACY_RETIREMENT_PATHS).size, LEGACY_RETIREMENT_PATHS.length);
  // Wave 1 retains every physical artifact; no retirement is authorized here.
  assert.deepEqual(LEGACY_RETIREMENT_PATHS, paths);
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

test('explicit URL manifest preserves all 139 pre-refactor redirect rules byte for byte', () => {
  const independentRules = buildLegacyRetirementRedirects();
  assert.deepEqual(independentRules, redirects);
  assert.equal(independentRules.length, 139);
  // Captured from main 17159ba0 before this refactor: includes rule order,
  // destinations, permanence and all query conditions, not only URL count.
  assert.equal(createHash('sha256').update(JSON.stringify(independentRules)).digest('hex'),
    '75544da36a6d78745a719e5b6d81c5b1212657726b37be38daa844882a2f02c5');
  assert.match(nextConfig, /buildLegacyRetirementRedirects\([\s\S]*?LEGACY_RETIREMENT_PATHS,/);
  assert.doesNotMatch(nextConfig, /discoverLegacyHtmlPaths|readdirSync/);
});

test('manifest-only edits trigger both compiled-route and parity CI', () => {
  const workflowRoot = path.join(FRONTEND, '..', '.github', 'workflows');
  const affected = readdirSync(workflowRoot).filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, source: readFileSync(path.join(workflowRoot, name), 'utf8') }))
    .filter(({ source }) => /- 'frontend\/tooling\/gate-f-retirement-redirects\.mjs'/.test(source));
  assert.ok(affected.some(({ name }) => name === 'route-manifest.yml'));
  assert.ok(affected.some(({ name }) => name === 'parity-gate.yml'));
  for (const { name: workflowName, source } of affected) {
    assert.match(source, /- 'frontend\/tooling\/gate-f-legacy-paths\.mjs'/, workflowName);
  }
});

test('actual Next config produces all redirects without reading a public tree', async () => {
  const compiled = ts.transpileModule(nextConfig, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  async function evaluate(env) {
    const mod = { exports: {} };
    runInNewContext(compiled, {
      module: mod, exports: mod.exports,
      require: createRequire(path.join(FRONTEND, 'next.config.ts')),
      // Any accidental public-directory scan fails, even though fixtures
      // remain present in the real repository. No files are removed.
      __dirname: path.join(FRONTEND, 'nonexistent-config-fixture'),
      process: { env: { NODE_ENV: 'production', ...env } },
    });
    return mod.exports.default.redirects();
  }
  const deployed = await evaluate({ VERCEL: '1', GATE_E_LEGACY_FIXTURES: 'local-build-only' });
  assert.deepEqual(JSON.parse(JSON.stringify(deployed.slice(0, 139))), redirects);
  const local = await evaluate({ GATE_E_LEGACY_FIXTURES: 'local-build-only' });
  assert.equal(local.length, deployed.length - 139);
});

test('every Legacy HTML source is permanently intercepted before public serving', () => {
  const status = collectNextMigrationStatus();
  assert.equal(status.legacyRetirementRedirects.installed, true);
  assert.equal(status.legacyRetirementRedirects.permanent, true);
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

test('Gate E browser fixtures no longer enable the guarded server escape hatch', () => {
  assert.match(nextConfig,
    /process\.env\.GATE_E_LEGACY_FIXTURES === 'local-build-only'[\s\S]*?process\.env\.VERCEL !== '1'/);
  assert.match(nextConfig,
    /\.\.\.\(GATE_E_LOCAL_LEGACY_FIXTURES \? \[\] : LEGACY_RETIREMENT_REDIRECTS\)/);
  for (const configName of [
    'playwright.gate-e.config.js',
    'playwright.gate-e-reading.config.js',
    'playwright.gate-e-listening.config.js',
    'playwright.gate-e-writing.config.js',
  ]) {
    const config = readFileSync(path.join(FRONTEND, configName), 'utf8');
    assert.doesNotMatch(config, /GATE_E_LEGACY_FIXTURES: 'local-build-only'/, configName);
  }
});

test('G1 changes phase explicitly: runtime redirects replace unreachable Legacy parity', () => {
  const workflow = readFileSync(
    path.join(FRONTEND, '..', '.github', 'workflows', 'parity-gate.yml'),
    'utf8',
  );
  assert.match(workflow, /id: gate_f/);
  assert.match(workflow, /collectNextMigrationStatus\(\)\.legacyRetirementRedirects/);
  assert.match(workflow, /redirect_installed=' \+ String\(gate\.installed\)/);
  assert.match(workflow, /permanent=' \+ String\(gate\.permanent\)/);
  assert.match(workflow, /name: Kiểm Gate F redirect manifest ở runtime/);
  const phaseGuard = String.raw`\n\s+if: steps\.gate_f\.outputs\.redirect_installed != 'true'`;
  assert.match(workflow, new RegExp(`name: Kiểm vế legacy phục vụ được VÀ gọi được backend${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Chọn phạm vi theo tệp đã sửa${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Chạy cổng parity \\(desktop \\+ điện thoại\\)${phaseGuard}`));
  assert.match(workflow, new RegExp(`name: Cổng đường-ghi \\(vế legacy — cùng bản khai\\)${phaseGuard}`));
});

test('advisory E2E does not mutate or overclaim the frozen Gate E suite during redirect soak', () => {
  const workflow = readFileSync(
    path.join(FRONTEND, '..', '.github', 'workflows', 'e2e.yml'),
    'utf8',
  );
  assert.match(workflow, /name: Detect Gate F redirect phase\n\s+id: gate_f\n\s+if: always\(\)/);
  assert.match(workflow, /name: Run Speaking Gate E native fixtures\n\s+id: speaking_gate_e\n\s+if: \$\{\{ always\(\) && steps\.gate_f\.outputs\.redirect_installed != 'true' \}\}/);
  assert.match(workflow, /name: Preserve Gate E frozen-suite boundary during redirect soak/);
  assert.match(workflow, /name: Upload Speaking Gate E device-matrix evidence\n\s+if: \$\{\{ always\(\) && steps\.gate_f\.outputs\.redirect_installed != 'true' \}\}/);
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
