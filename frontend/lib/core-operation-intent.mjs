// Optional observation hints only: never auth, idempotency, or proof of coverage.
// No browser access at module/render time. send() runs before any await, even
// during pagehide; adding an async WebCrypto step here would break keepalive.
import { speakingStartId } from './speaking-start-intent.mjs';

const PREFIX = 'aver:core-operation:v1:';
const ANON_PREFIX = 'aver:core-operation-anon:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
export const CORE_OPERATION_HEADER = 'X-Core-Operation-ID';
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));

// SHA-256 for bounded JSON comparison, NOT signing, encryption or anonymizing.
// Tested against node:crypto across padding boundaries, Unicode and random data.
export function coreInputDigest(text) {
  if (typeof text !== 'string' || text.length > 262144) throw new Error('unsupported observation input');
  const bytes = new TextEncoder().encode(text);
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 4, bytes.length * 8);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3))
        + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      z = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a,b,c,d,e,f,g,z].entries()) h[i] += value;
  }
  return [...h].map(word => word.toString(16).padStart(8, '0')).join('');
}

function jsonInput(value, depth = 0) {
  if (depth > 32) throw new Error('unsupported observation input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => jsonInput(item, depth + 1)).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jsonInput(value[key], depth + 1)).join(',') + '}';
  }
  throw new Error('unsupported observation input'); // no FormData, streams or arbitrary toJSON
}

export function clearCoreOperationIntents(storage, keepAccountId = null) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX) && !(keepAccountId && key.startsWith(PREFIX + keepAccountId + ':'))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Optional metadata must never block auth transitions. */ }
}

// Share attempts remain owned by their capability even when Supabase auth
// changes. Do not persist that capability or alias it to a signed-in user.
// The first start has no capability yet: its tab-local hint uses the share
// scope, but the server must still partition each newly minted canonical ID.
export function anonymousReadingScope({ shareToken, capability, starting = false }) {
  try {
    if (globalThis.window?.__AVER_RUNTIME_CONFIG__?.coreOperationCorrelationEnabled !== true
        || typeof shareToken !== 'string' || !shareToken) return null;
    if (capability == null || capability === '') {
      return starting ? coreInputDigest(jsonInput(['reading-share-start', shareToken])) : null;
    }
    if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(capability)) return null;
    return coreInputDigest(jsonInput(['reading-share-capability', shareToken, capability]));
  } catch { return null; }
}

/** @returns {Record<string, string>} */
export function coreOperationHeaders(requestId) {
  try {
    return globalThis.window?.__AVER_RUNTIME_CONFIG__?.coreOperationCorrelationEnabled === true && UUID.test(requestId || '')
      ? { [CORE_OPERATION_HEADER]: requestId } : {};
  } catch { return {}; }
}

/** No transport retries/coalescing; preserve response/exception and options.
 * Same pending input reuses a hint, including reload. Changed input, explicit
 * fresh intent or acknowledged response rotates it. One slot per question.
 * Storage failure omits the hint, not the learner write. A browser-cloned tab
 * can clone pending hints: the server must still partition canonical scope.
 */
export function createCoreOperationTransport({ getStorage, enabled, mintId = speakingStartId }) {
  return function sendOperation({ accountId, anonymousScope = /** @type {string | null} */ (null), method, path, input, slot = '', fresh = false, acknowledged }, send) {
    let receipt = null;
    try {
      const ownerPrefix = anonymousScope != null
        ? (!accountId && DIGEST.test(anonymousScope) ? ANON_PREFIX + anonymousScope : null)
        : (UUID.test(accountId || '') ? PREFIX + accountId : null);
      if (enabled() && ownerPrefix && ['POST', 'PATCH'].includes(method) && typeof path === 'string') {
        const storage = getStorage();
        const key = ownerPrefix + ':' + coreInputDigest(jsonInput([method, path, slot]));
        const fingerprint = coreInputDigest(jsonInput(input));
        const raw = storage.getItem(key);
        let saved;
        try { saved = JSON.parse(raw); } catch { /* malformed optional metadata gets replaced */ }
        const reusable = !fresh && saved?.v === 1 && UUID.test(saved.id || '')
          && DIGEST.test(saved.fingerprint || '') && saved.fingerprint === fingerprint && saved.pending === true;
        const id = reusable ? saved.id : mintId();
        if (!UUID.test(id)) throw new Error('invalid observation id');
        const serialized = JSON.stringify({ v: 1, id, fingerprint, pending: true });
        storage.setItem(key, serialized);
        if (storage.getItem(key) === serialized) receipt = { storage, key, id, fingerprint, serialized };
      }
    } catch { /* Missing storage/crypto/unsupported input: explicitly uncorrelated. */ }
    // MUST remain outside the best-effort catch and before any asynchronous work.
    const result = send(receipt ? { [CORE_OPERATION_HEADER]: receipt.id } : {});
    if (!receipt) return result;
    return Promise.resolve(result).then(value => {
      try {
        if (typeof acknowledged === 'function' && acknowledged(value)
            && receipt.storage.getItem(receipt.key) === receipt.serialized) {
          // CAS prevents a late acknowledgement from clearing newer input.
          receipt.storage.setItem(receipt.key, JSON.stringify({ v: 1, id: receipt.id, fingerprint: receipt.fingerprint, pending: false }));
          // If removal fails, the acknowledged tombstone still prevents reuse.
          receipt.storage.removeItem(receipt.key);
        }
      } catch { /* Acknowledged business writes stay successful if cleanup fails. */ }
      return value;
    });
  };
}

export const coreOperationRequest = createCoreOperationTransport({
  getStorage: () => window.sessionStorage,
  enabled: () => globalThis.window?.__AVER_RUNTIME_CONFIG__?.coreOperationCorrelationEnabled === true,
});
