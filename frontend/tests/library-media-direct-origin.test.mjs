// CR #2451 carry-over: the Library media route throttles per client address
// (backend/services/library_media.py, 120/min, keyed on X-Real-IP). Railway's
// edge sets X-Real-IP to the TCP caller, so the browser must fetch
// `/api/library/media/...` from the API origin directly. If Vercel proxied
// `/api/*` (Next rewrite, vercel.json rewrite, App Router handler or a
// proxy.ts matcher), Railway would see Vercel's egress address and every
// visitor would share one key and get 429 together. This guard fails if any
// such proxy path appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(FRONTEND, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no Next rewrite sends /api traffic through Vercel', () => {
  const cfg = stripComments(read('next.config.ts'));
  const block = cfg.slice(cfg.indexOf('async rewrites()'), cfg.indexOf('async redirects()'));
  assert.ok(block.length > 0, 'rewrites() block not found in next.config.ts');
  assert.doesNotMatch(block, /source:\s*['"`]\/api(\/|['"`])/);
  assert.doesNotMatch(block, /destination:\s*['"`]https?:\/\/[^'"`]*railway/);
});

test('vercel.json has no /api rewrite', () => {
  const vercel = JSON.parse(read('vercel.json'));
  for (const rule of [...(vercel.rewrites || []), ...(vercel.routes || [])]) {
    assert.ok(!String(rule.source || rule.src || '').startsWith('/api'),
      `vercel.json proxies ${rule.source || rule.src}`);
  }
});

test('no App Router handler owns /api/library', () => {
  assert.equal(existsSync(path.join(FRONTEND, 'app', 'api', 'library')), false);
});

test('proxy.ts matcher does not cover /api', () => {
  const src = stripComments(read('proxy.ts'));
  const matcher = src.slice(src.indexOf('matcher:'));
  assert.doesNotMatch(matcher, /['"`]\/api/);
  assert.doesNotMatch(matcher, /['"`]\/:path\*['"`]/);
});
