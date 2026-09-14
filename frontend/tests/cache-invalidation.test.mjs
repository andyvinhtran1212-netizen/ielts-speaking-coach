import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_INVALIDATION_BODY_BYTES,
  verifyCacheInvalidation,
} from '../lib/cache-invalidation.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = 'test-cache-secret';
const NOW = 1_800_000_000;

function signed(payload, secret = SECRET) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signature: `sha256=${digest}`, secret, nowSeconds: NOW };
}

test('accepts a fresh signed vocabulary invalidation', () => {
  assert.deepEqual(
    verifyCacheInvalidation(signed({ tags: ['public:vocabulary'], timestamp: NOW })),
    { ok: true, tags: ['public:vocabulary'] },
  );
});

test('fails closed for missing config, forged signatures and replayed envelopes', () => {
  const request = signed({ tags: ['public:vocabulary'], timestamp: NOW });
  assert.equal(verifyCacheInvalidation({ ...request, secret: '' }).status, 503);
  assert.equal(verifyCacheInvalidation({ ...request, signature: `sha256=${'0'.repeat(64)}` }).status, 401);
  assert.equal(verifyCacheInvalidation({ ...request, nowSeconds: NOW + 301 }).status, 400);
});

test('rejects arbitrary tags, duplicates and oversized bodies', () => {
  for (const tags of [['public:grammar'], ['public:vocabulary', 'public:vocabulary'], []]) {
    assert.equal(verifyCacheInvalidation(signed({ tags, timestamp: NOW })).status, 400);
  }
  const tooLarge = new Uint8Array(MAX_INVALIDATION_BODY_BYTES + 1);
  assert.equal(verifyCacheInvalidation({
    rawBody: tooLarge,
    signature: `sha256=${'0'.repeat(64)}`,
    secret: SECRET,
    nowSeconds: NOW,
  }).status, 400);
});

test('Next route stays bounded and tags vocabulary reads at the shared cache layer', () => {
  const route = readFileSync(path.join(FRONTEND, 'app/api/cache/revalidate/route.ts'), 'utf8');
  const backend = readFileSync(path.join(FRONTEND, 'lib/backend.ts'), 'utf8');
  assert.match(route, /readBoundedBody\(request\)/);
  assert.match(route, /revalidateTag\(tag, 'max'\)/);
  assert.match(route, /AVER_CACHE_REVALIDATION_SECRET/);
  assert.match(backend, /cacheTag\(tag\)/);
  assert.match(backend, /public:vocabulary/);
});

