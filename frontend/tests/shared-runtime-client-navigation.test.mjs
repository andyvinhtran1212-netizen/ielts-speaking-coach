import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');

const ROUTE_CHAIN = read('components', 'route-script-chain.tsx');
const RUNTIME_BOUNDARY = read('components', 'supabase-runtime-boundary.tsx');
const BODY_BRIDGE = read('components', 'body-class-bridge.tsx');
const FOUNDATIONAL_LAYOUTS = [
  ['components', 'authed-shell.tsx'],
  ['app', '(public-auth)', 'layout.tsx'],
  ['app', '(public-content)', 'layout.tsx'],
  ['app', '(marketing)', 'layout.tsx'],
];

function tsxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('shared runtime survives App Router client navigation', () => {
  test('foundational layouts never rely on raw external script nodes', () => {
    for (const parts of FOUNDATIONAL_LAYOUTS) {
      const source = read(...parts);
      assert.doesNotMatch(
        source,
        /<script\s+(?:type="module"\s+)?src=/,
        `${parts.join('/')} must use next/script or RouteScriptChain`,
      );
    }
  });

  test('App Router tree has no raw external script nodes hidden below layouts', () => {
    for (const path of tsxFiles(join(FRONTEND, 'app'))) {
      assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        /<script\s+(?:type="module"\s+)?src=/,
        `${path} must use next/script or RouteScriptChain`,
      );
    }
  });

  test('Supabase shells load fallback/config/reporter/api in order', () => {
    for (const parts of FOUNDATIONAL_LAYOUTS.slice(0, 3)) {
      const source = read(...parts);
      const ordered = [
        '@supabase/supabase-js@2.107.0',
        '/js/supabase-sdk-fallback.js',
        '/js/runtime-config.js',
        '/js/error-reporter.js',
        '/js/api.js',
      ];
      let previous = -1;
      for (const marker of ordered) {
        const current = source.indexOf(marker);
        assert.ok(current > previous, `${parts.join('/')} runtime order: ${marker}`);
        previous = current;
      }
      assert.match(source, /<SupabaseRuntimeBoundary/);
    }
  });

  test('optional primary/reporter failures do not strand required fallback and API', () => {
    assert.match(ROUTE_CHAIN, /continueOnError\?: boolean/);
    assert.match(ROUTE_CHAIN, /if \(script\.continueOnError\) setReady\(true\)/);
    for (const parts of FOUNDATIONAL_LAYOUTS.slice(0, 3)) {
      const source = read(...parts);
      assert.match(source, /supabase\.min\.js'[\s\S]{0,80}continueOnError: true/);
      assert.match(source, /error-reporter\.js', continueOnError: true/);
    }
  });

  test('dependent scripts wait for the one shared Supabase client', () => {
    assert.match(RUNTIME_BOUNDARY, /^['"]use client['"];?/);
    assert.match(RUNTIME_BOUNDARY, /<RouteScriptChain scripts=\{scripts\} onComplete=\{markScriptsReady\} \/>/);
    assert.match(RUNTIME_BOUNDARY, /init\(supabaseUrl, supabaseAnonKey\)/);
    assert.match(RUNTIME_BOUNDARY, /typeof getClient === 'function' \? getClient\(\) : null/);
    assert.match(RUNTIME_BOUNDARY, /runtimeReady \? children : null/);
    assert.match(RUNTIME_BOUNDARY, /CLIENT_READY_TIMEOUT_MS = 10_000/);
  });

  test('body classes have a client-navigation owner and stale cleanup guard', () => {
    assert.match(BODY_BRIDGE, /useLayoutEffect/);
    assert.match(BODY_BRIDGE, /previous\.forEach\(\(token\) => body\.classList\.remove\(token\)\)/);
    assert.match(BODY_BRIDGE, /tokens\.forEach\(\(token\) => body\.classList\.add\(token\)\)/);
    assert.match(BODY_BRIDGE, /body\.getAttribute\(OWNER_ATTRIBUTE\) !== ownershipKey/);
    assert.match(read('components', 'authed-shell.tsx'), /<BodyClassBridge className=\{bodyClass\} \/>/);
    assert.match(read('app', '(public-content)', 'layout.tsx'), /<BodyClassBridge className=/);
  });
});
