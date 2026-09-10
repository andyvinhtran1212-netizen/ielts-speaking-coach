import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOverviewPages, inspectOverview } from '../tooling/site-overview-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);
const pageMap = (rows) => '## 4. Per sub-page map\n\n| Page | Audience | Purpose · operation |\n|---|---|---|\n' + rows;
const row = (route) => '| `' + route + '` | learner | Practice |\n';
function put(root, file, source = '') {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
async function isolated(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'aver-overview-native-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('native denominator discovers groups/dynamic pages without HTML aliases, excluding non-product inputs', async () => {
  await isolated((root) => {
    for (const file of ['app/(marketing)/page.tsx', 'app/(auth)/reading/[slug]/page.tsx',
      'app/(auth)/@parallel/reading/[slug]/page.tsx', 'app/_private/page.tsx',
      'app/next-probe/page.tsx', 'app/recorder-spike/page.tsx', 'app/api/route.ts',
      'public/unused.html', '.next/fake/page.tsx', 'tests/fixture/page.tsx']) put(root, file);
    const inventory = collectOverviewPages(root);
    assert.deepEqual(inventory.routes, ['/', '/reading/[slug]']);
    assert.deepEqual(inventory.sources.find(({ file }) => file.includes('@parallel')),
      { file: '(auth)/@parallel/reading/[slug]/page.tsx', route: '/reading/[slug]' });
    put(root, 'app/new-feature/page.tsx');
    assert.ok(collectOverviewPages(root).routes.includes('/new-feature'));
  });
});

test('empty app tree and unsupported page conventions fail closed instead of shrinking coverage', async () => {
  await isolated((root) => {
    assert.throws(() => collectOverviewPages(root), /App Router directory missing/);
    mkdirSync(path.join(root, 'app'));
    assert.throws(() => collectOverviewPages(root), /No product/);
    put(root, 'app/page.js');
    assert.throws(() => collectOverviewPages(root), /Extend the shared route inventory/);
  });
  for (const segment of ['(.)modal', '(..)modal', '(...)modal', '%5Fpublic']) {
    await isolated((root) => {
      put(root, `app/${segment}/page.tsx`);
      assert.throws(() => collectOverviewPages(root), /Unsupported App Router segment/);
    });
  }
  assert.throws(() => inspectOverview(pageMap(row('/')), []), /empty route inventory/);
});

test('App Router symlinks fail closed instead of vanishing from the denominator', async () => {
  await isolated((root) => {
    put(root, 'app/page.tsx');
    put(root, 'target/page.tsx');
    symlinkSync(path.join(root, 'target'), path.join(root, 'app/linked'),
      process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => collectOverviewPages(root), /Unsupported App Router symlink: linked/);
  });
});

test('only canonical first-column page patterns count; API prose, query identity and duplicates do not inflate coverage', () => {
  const markdown = pageMap(row('/login?return_to=/home') + row('/login') +
    '| `/reading/[slug]` | learner | Calls `/api/reading/test` and links `/not-a-page` |\n');
  const report = inspectOverview(markdown, ['/login', '/reading/[slug]', '/missing']);
  assert.deepEqual(report.documented, ['/login', '/reading/[slug]']);
  assert.deepEqual(report.invalidReferences, []);
  assert.deepEqual(report.missing, ['/missing']);
  assert.equal(report.coverage, 2 / 3);
});

test('unknown native citations, missing purpose and malformed page cells are visible errors', () => {
  const markdown = pageMap(row('/typo') + row('pages/pricing.html') +
    '| /login | learner | No code-formatted route |\n| `/login` | learner | |\n');
  const report = inspectOverview(markdown, ['/login', '/pricing']);
  assert.deepEqual(report.invalidReferences,
    ['/login', '/typo', 'Missing audience/purpose: `/login`', 'pages/pricing.html'].sort());
});

test('fenced examples and other sections cannot make the page map appear complete', () => {
  const markdown = pageMap(row('/')) + '\n```md\n' + row('/fake') + '```\n' +
    '~~~md\n' + row('/also-fake') + '~~~\n## 5. Backend\n' + row('/backend');
  const report = inspectOverview(markdown, ['/', '/fake', '/also-fake', '/backend']);
  assert.deepEqual(report.documented, ['/']);
  assert.equal(report.coverage, 0.25);
  assert.equal(inspectOverview('No page map', ['/']).coverage, 0);
});

test('legacy prose references require manifest identity and a current owner, never physical HTML', () => {
  const prose = 'History: `pricing.html`, `pages/practice.html`, `pages/typo.html`.\n';
  const report = inspectOverview(prose + pageMap(row('/pricing')), ['/pricing']);
  assert.deepEqual(report.deadLegacyReferences.sort(), ['/pages/practice.html', '/pages/typo.html']);
  assert.equal(inspectOverview('History: `pricing.html`.\n' + pageMap(row('/pricing')),
    ['/pricing']).deadLegacyReferences.length, 0);
  assert.equal(inspectOverview('History: `pricing.html`.', ['/pricing']).coverage, 0);
  for (const reference of ['/pricing.html', 'frontend/pricing.html', 'frontend/public/pricing.html',
    'frontend/pages/practice.html', '/pages/practice.html']) {
    assert.deepEqual(inspectOverview('History: `' + reference + '`.',
      ['/pricing', '/practice/session']).deadLegacyReferences, []);
  }
  assert.deepEqual(inspectOverview('Source example: `docs/example.html`.', ['/']).deadLegacyReferences, []);
});

test('new undocumented native routes reduce the unchanged 85% coverage floor', () => {
  const routes = Array.from({ length: 20 }, (_, i) => '/page-' + i);
  assert.equal(inspectOverview(pageMap(routes.slice(0, 17).map(row).join('')), routes).coverage, 0.85);
  assert.ok(inspectOverview(pageMap(routes.slice(0, 16).map(row).join('')), routes).coverage < 0.85);
});

test('the actual nine-case sentinel passes with no public/legacy tree and rejects a dead route mutation', async () => {
  await isolated(async (root) => {
    const sources = [
      'frontend/tests/site-overview-coverage.test.mjs',
      'frontend/tooling/site-overview-coverage.mjs',
      'frontend/tooling/next-migration-status.mjs',
      'frontend/tooling/route-ownership-check.mjs',
      'frontend/tooling/gate-f-legacy-paths.mjs',
      'frontend/tooling/gate-f-route-replacement-inventory.mjs',
      'frontend/tooling/gate-f-retirement-redirects.mjs',
      'frontend/lib/core-player-affinity.mjs',
      'docs/SITE_OVERVIEW.md', 'README.md',
      ...collectOverviewPages(path.join(ROOT, 'frontend')).sources.map(({ file }) => `frontend/app/${file}`),
    ];
    for (const file of sources) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(ROOT, file), target);
    }
    for (const absent of ['public', 'pages', 'index.html', 'pricing.html', 'css', 'js', 'node_modules']) {
      assert.equal(existsSync(path.join(root, 'frontend', absent)), false);
    }
    const env = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT',
      'WINDIR', 'CI', 'LANG', 'LC_ALL', 'TZ'].filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]));
    const options = { cwd: root, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 };
    const args = ['--test', '--test-reporter=tap', 'frontend/tests/site-overview-coverage.test.mjs'];
    const { stdout } = await execFileAsync(process.execPath, args, options);
    assert.ok(Number(stdout.match(/^# pass (\d+)$/m)?.[1]) >= 9);
    for (const count of ['fail', 'cancelled', 'skipped', 'todo']) {
      assert.match(stdout, new RegExp('^# ' + count + ' 0$', 'm'));
    }
    const original = readFileSync(path.join(root, 'docs/SITE_OVERVIEW.md'), 'utf8');
    put(root, 'docs/SITE_OVERVIEW.md', original.replace('`/login`', '`/not-a-real-login`'));
    await assert.rejects(execFileAsync(process.execPath, args, options), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /Unknown or non-canonical page references/);
      assert.match(error.stdout, /not-a-real-login/);
      return true;
    });
  });
});
