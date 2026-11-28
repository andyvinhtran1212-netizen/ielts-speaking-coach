// PUBLICSITE-0059 FR-004 / CR #2607, #2623, #2637 — getPublicJson picks the
// cache life by path: the course reads (`/api/courses`, `/api/courses/<slug>`)
// live 60 s (prices and "Đang mở đăng ký" change and the backend clears no
// cache for them yet); every other public read keeps ADR-008's 1 hour. Runs
// the real lib/backend.ts with next/cache and fetch replaced by recorders.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function load() {
  const compiled = ts.transpileModule(readFileSync(path.join(FRONTEND, 'lib', 'backend.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const lives = [];
  const tags = [];
  const nextCache = { cacheLife: (life) => lives.push(life), cacheTag: (tag) => tags.push(tag) };
  const fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  const exports = {};
  new Function('require', 'exports', 'fetch', 'process', compiled)(
    (name) => { if (name === 'next/cache') return nextCache; if (name === 'server-only') return {}; throw new Error(`unexpected import ${name}`); },
    exports, fetch, { env: {} },
  );
  return { ...exports, lives, tags };
}

test('the course reads use the 60 s life; other paths, and look-alikes, keep 1 hour', async () => {
  const cases = [
    ['/api/courses', 'COMMERCE_CONTENT_LIFE'],
    ['/api/courses/khoa-a', 'COMMERCE_CONTENT_LIFE'],
    ['/api/coursesX', 'PUBLIC_CONTENT_LIFE'],
    ['/api/course-bundles', 'PUBLIC_CONTENT_LIFE'],
    ['/api/vocabulary/units', 'PUBLIC_CONTENT_LIFE'],
    ['/api/grammar/articles', 'PUBLIC_CONTENT_LIFE'],
  ];
  for (const [p, expected] of cases) {
    const mod = load();
    assert.deepEqual(await mod.getPublicJson(p), {});
    assert.deepEqual(mod.lives, [mod[expected]], p);
  }
  const { COMMERCE_CONTENT_LIFE, PUBLIC_CONTENT_LIFE } = load();
  assert.deepEqual(COMMERCE_CONTENT_LIFE, { stale: 60, revalidate: 60, expire: 3600 });
  assert.deepEqual(PUBLIC_CONTENT_LIFE, { stale: 3600, revalidate: 3600, expire: 86400 });
});
