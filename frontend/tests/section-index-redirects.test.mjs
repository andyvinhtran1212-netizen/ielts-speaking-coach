// U-14 / BL-03: bare section prefixes redirect instead of falling through to
// the root not-found page, and that not-found page carries its design tokens.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { appPageRoute } from '../tooling/app-route-inventory.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');

function appRoutes(root, prefix = '') {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return appRoutes(path.join(root, entry.name), relative);
    const route = appPageRoute(relative);
    return route ? [route] : [];
  });
}

async function configRedirects() {
  const compiled = ts.transpileModule(read('next.config.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require: createRequire(path.join(FRONTEND, 'next.config.ts')),
    __dirname: path.join(FRONTEND, 'nonexistent-config-fixture'),
    process: { env: { NODE_ENV: 'production', VERCEL: '1' } },
  });
  return mod.exports.default.redirects();
}

const SECTION_REDIRECTS = [
  { source: '/writing', destination: '/writing/dashboard' },
  { source: '/grammar-checkup/review', destination: '/grammar-checkup' },
];

test('bare section prefixes redirect to a real app route before rendering', async () => {
  const redirects = await configRedirects();
  const routes = new Set(appRoutes(path.join(FRONTEND, 'app')));
  for (const { source, destination } of SECTION_REDIRECTS) {
    const matches = redirects.filter((entry) => entry.source === source);
    assert.equal(matches.length, 1, `${source} has exactly one redirect`);
    assert.equal(matches[0].destination, destination);
    // Temporary: a later native index page must not be shadowed by cached 308s.
    assert.equal(matches[0].permanent, false);
    assert.ok(routes.has(destination), `${destination} is an app route`);
    assert.ok(!routes.has(source), `${source} is not itself an app route`);
  }
});

test('root not-found loads the design tokens its module CSS reads', () => {
  const notFound = read('app', 'not-found.tsx');
  const layout = read('app', 'layout.tsx');
  const css = read('app', 'error-screen.module.css');
  // The premise: the root layout does not provide tokens, the module needs them.
  assert.doesNotMatch(layout, /aver-design\/tokens\.css/);
  assert.match(css, /var\(--av-surface-page\)/);
  assert.match(notFound, /<link rel="stylesheet" href="\/css\/aver-design\/tokens\.css" \/>/);
  assert.match(notFound, /className=\{styles\.page\}/);
  // No reset in the root layout: the UA body margin is dropped, scoped to error screens.
  assert.match(css, /:global\(body\):has\(\.page\) \{\n  margin: 0;/);
});
