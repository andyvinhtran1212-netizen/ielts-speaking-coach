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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

test('no App Router handler owns /api/library or an /api catch-all', () => {
  const api = path.join(FRONTEND, 'app', 'api');
  assert.equal(existsSync(path.join(api, 'library')), false);
  // A dynamic segment directly under app/api ([x], [...x], [[...x]]) would
  // swallow /api/library/media too.
  const dynamic = existsSync(api) ? readdirSync(api).filter((name) => name.startsWith('[')) : [];
  assert.deepEqual(dynamic, [], `app/api has a dynamic segment: ${dynamic.join(', ')}`);
});

test('proxy.ts matcher does not cover /api', () => {
  const src = stripComments(read('proxy.ts'));
  const matcher = src.slice(src.indexOf('matcher:'));
  const sources = [...matcher.matchAll(/['"`](\/[^'"`]*)['"`]/g)].map((m) => m[1]);
  assert.ok(sources.length > 0, 'no matcher sources found in proxy.ts');
  for (const source of sources) {
    assert.ok(!source.startsWith('/api'), `proxy.ts matches ${source}`);
    // A first segment that is a regex group or an unconstrained param
    // ('/(.*)', '/((?!_next).*)', '/:path*', '/:slug/...') also covers /api.
    assert.doesNotMatch(source, /^\/(\(|:\w+(?![\w(]))/, `proxy.ts catch-all matcher ${source}`);
    // A constrained param must not list api among its alternatives.
    const alt = source.match(/^\/:\w+\(([^)]*)\)/);
    if (alt) assert.ok(!alt[1].split('|').includes('api'), `proxy.ts matcher ${source} lists api`);
  }
});
