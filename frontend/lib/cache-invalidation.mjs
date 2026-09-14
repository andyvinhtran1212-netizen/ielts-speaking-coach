import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_INVALIDATION_BODY_BYTES = 4096;
export const MAX_INVALIDATION_AGE_SECONDS = 300;
export const ALLOWED_PUBLIC_CACHE_TAGS = Object.freeze(['public:vocabulary']);

const ALLOWED_TAG_SET = new Set(ALLOWED_PUBLIC_CACHE_TAGS);

function reject(status, error) {
  return { ok: false, status, error };
}

/**
 * Verify the backend-to-Next cache invalidation envelope. The signature covers
 * the exact request bytes; the timestamp bounds replay; the allow-list prevents
 * this endpoint from becoming an arbitrary cache purge primitive.
 */
export function verifyCacheInvalidation({ rawBody, signature, secret, nowSeconds = Date.now() / 1000 }) {
  if (!secret) return reject(503, 'cache invalidation is not configured');
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > MAX_INVALIDATION_BODY_BYTES) {
    return reject(400, 'invalid request body');
  }

  const suppliedHex = typeof signature === 'string' && signature.startsWith('sha256=')
    ? signature.slice('sha256='.length)
    : '';
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return reject(401, 'invalid signature');

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reject(401, 'invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return reject(400, 'invalid request body');
  }

  if (!Number.isInteger(payload?.timestamp)
      || Math.abs(nowSeconds - payload.timestamp) > MAX_INVALIDATION_AGE_SECONDS) {
    return reject(400, 'stale request');
  }
  if (!Array.isArray(payload.tags) || payload.tags.length < 1
      || payload.tags.length > ALLOWED_PUBLIC_CACHE_TAGS.length
      || new Set(payload.tags).size !== payload.tags.length
      || payload.tags.some((tag) => !ALLOWED_TAG_SET.has(tag))) {
    return reject(400, 'invalid cache tags');
  }

  return { ok: true, tags: payload.tags };
}

