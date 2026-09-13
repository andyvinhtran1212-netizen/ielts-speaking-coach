import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
const GLOBAL_ERROR = readFileSync(path.join(ROOT, 'app/global-error.tsx'), 'utf8');
const ERROR_STYLES = readFileSync(path.join(ROOT, 'app/error-screen.module.css'), 'utf8');
const NEXT_PROBE = readFileSync(path.join(ROOT, 'app/next-probe/page.tsx'), 'utf8');
const RECORDER_SPIKE = readFileSync(path.join(ROOT, 'app/(spike)/recorder-spike/page.tsx'), 'utf8');

test('all Next responses carry the permanent security header baseline', () => {
  assert.match(CONFIG, /source:\s*'\/:path\*'/);
  for (const header of [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
    'Permissions-Policy', 'Content-Security-Policy',
  ]) assert.match(CONFIG, new RegExp(`key: '${header}'`));
  assert.match(CONFIG, /frame-ancestors 'none'/);
  assert.match(CONFIG, /object-src 'none'/);
  assert.doesNotMatch(CONFIG, /cdn\.jsdelivr\.net|unpkg\.com/);
});

test('mutable stable-name css and js always revalidate after a deploy', () => {
  const stableAssetRules = [...CONFIG.matchAll(
    /source:\s*'\/(?:js|css)\/:path\*'[\s\S]*?Cache-Control'[\s\S]*?value:\s*'([^']+)'/g,
  )].map((match) => match[1]);
  assert.deepEqual(stableAssetRules, [
    'public, max-age=0, must-revalidate',
    'public, max-age=0, must-revalidate',
  ]);
});

test('the root error boundary bootstraps the shared design system', () => {
  assert.match(GLOBAL_ERROR, /href="\/css\/aver-design\/tokens\.css"/);
  assert.match(ERROR_STYLES, /var\(--av-surface-page\)/);
  assert.match(ERROR_STYLES, /var\(--av-text-primary\)/);
  assert.doesNotMatch(ERROR_STYLES, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test('diagnostic routes fail closed for every production deployment', () => {
  for (const source of [NEXT_PROBE, RECORDER_SPIKE]) {
    assert.match(source, /VERCEL_ENV === 'production'/);
    assert.match(source, /notFound\(\)/);
  }
});
