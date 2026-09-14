import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(FRONTEND, relative), 'utf8');
const sharedBootSurfaces = [
  'components/authed-shell.tsx',
  'app/(public-content)/layout.tsx',
  'app/(public-auth)/layout.tsx',
];

test('every shared Next shell removes the migration-era Supabase script runtime', () => {
  for (const relative of sharedBootSurfaces) {
    const source = read(relative);
    assert.match(source, /<SupabaseRuntimeBoundary/);
    assert.doesNotMatch(source, /\/vendor\/supabase\.js|supabase-sdk-fallback\.js/, relative);
  }
});

test('ESM singleton resolves runtime config once and rejects a second identity', () => {
  const source = read('lib/supabase-browser.ts');
  assert.match(source, /import \{ createClient, type SupabaseClient \} from '@supabase\/supabase-js'/);
  assert.match(source, /config\.supabaseUrl \|\| fallbackUrl/);
  assert.match(source, /config\.supabaseAnonKey \|\| fallbackAnonKey/);
  assert.match(source, /singletonIdentity !== identity/);
  assert.equal((source.match(/createClient\(/g) || []).length, 1);
});

test('api.js adopts the ESM client while retaining the legacy UMD fallback', () => {
  const source = read('public/js/api.js');
  const seed = source.indexOf('(window).__AVER_SUPABASE_CLIENT__ || null');
  const adoption = source.indexOf('var injected = /** @type {any} */ (window).__AVER_SUPABASE_CLIENT__');
  const umd = source.indexOf('window.supabase.createClient(');
  assert.ok(seed >= 0 && adoption > seed && umd > adoption);
  assert.match(source, /if \(injected\) \{[\s\S]{0,100}_sb = injected;[\s\S]{0,100}return _sb;/);
});

test('retired HTML recovery helper remains local-only for rollback fixtures', () => {
  const source = read('public/js/supabase-sdk-fallback.js');
  assert.match(source, /\/vendor\/supabase\.js\?fallback=1/);
  assert.doesNotMatch(source, /https?:\/\//);
});
