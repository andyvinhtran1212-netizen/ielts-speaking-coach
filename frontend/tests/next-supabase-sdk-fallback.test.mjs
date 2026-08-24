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

test('every shared Next shell loads recovery before api.js initialization', () => {
  for (const relative of sharedBootSurfaces) {
    const source = read(relative);
    const primary = source.indexOf('@supabase/supabase-js@2.107.0');
    const fallback = source.indexOf('/js/supabase-sdk-fallback.js');
    const api = source.indexOf('/js/api.js');
    assert.ok(primary >= 0 && primary < fallback && fallback < api, relative);
  }
});

test('fallback uses a published npm release and never creates a client itself', () => {
  const source = read('public/js/supabase-sdk-fallback.js');
  assert.match(source, /@supabase\/supabase-js@2\.91\.0\/dist\/umd\/supabase\.min\.js/);
  assert.match(source, /__AVER_SUPABASE_SDK_READY__/);
  assert.ok(!source.includes('createClient('), 'api.js must remain the sole client owner');
});
