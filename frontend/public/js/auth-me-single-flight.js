// PC-J147 — one /auth/me per page load, shared by <aver-chrome> and the page.
//
// The chrome (role lookup) and a page that needs the profile used to send their
// own /auth/me. Since PC-J06 the chrome connects before the runtime, so its
// request now overlaps the page's opening reads; staging serves requests one
// at a time (PC-J05), so the duplicate sat in front of the reads that paint
// /d1-exercise and /vocabulary/hub.
//
// Callers with the SAME access token share one request:
//   • in flight → every caller awaits the same request;
//   • settled OK → reused for AUTH_ME_REUSE_MS (the rest of the page boot),
//     never longer, so a later read is canonical again;
//   • non-OK status, empty body, network error or timeout → every waiting
//     caller gets the same outcome and the entry is dropped, so the next call
//     sends again;
//   • another token (refresh, sign-out, account switch in another tab) never
//     matches → a new request.
// Nothing is persisted: the entry lives on `window` for this document only.
//
// The entry is kept on `window`, not in module scope: the chrome loads this file
// by its deployed URL (/js/auth-me-single-flight.js) while Next bundles its own
// copy through lib/auth/auth-me-single-flight.mjs, so the two module instances
// must meet on a shared global.

export const AUTH_ME_REUSE_MS = 10000;
export const AUTH_ME_TIMEOUT_MS = 15000;
export const AUTH_ME_TIMEOUT_MESSAGE = 'Hết thời gian chờ /auth/me.';
const REGISTRY_KEY = '__averAuthMeSingleFlight';

function registryOf(scope) {
  if (!scope[REGISTRY_KEY]) {
    Object.defineProperty(scope, REGISTRY_KEY, { value: { entry: null }, configurable: true });
  }
  return scope[REGISTRY_KEY];
}

/** Read a /auth/me Response once into a record every caller can share. */
async function recordOf(response) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* null payload */ }
  return Object.freeze({ ok: response.ok, status: response.status, payload });
}

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/** This caller stops waiting on abort; the shared request keeps running for the others. */
function forCaller(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * @param {string} token  Supabase access token the request is sent with.
 * @param {(signal: AbortSignal) => Promise<Response>} send  Sends GET /auth/me
 *        with `token`; only the first caller's `send` runs.
 * @param {{ signal?: AbortSignal, timeoutMs?: number, now?: () => number, scope?: object }} [options]
 * @returns {Promise<Readonly<{ ok: boolean, status: number, payload: any }>>}
 */
export function sharedAuthMe(token, send, options = {}) {
  const {
    signal,
    timeoutMs = AUTH_ME_TIMEOUT_MS,
    now = () => Date.now(),
    scope = globalThis,
  } = options;
  if (!token) return forCaller(Promise.resolve().then(() => send(new AbortController().signal)).then(recordOf), signal);
  const registry = registryOf(scope);
  const current = registry.entry;
  if (current && current.token === token
    && (current.settledAt === null || now() - current.settledAt < AUTH_ME_REUSE_MS)) {
    return forCaller(current.promise, signal);
  }
  const controller = new AbortController();
  let timer;
  const entry = { token, settledAt: null, promise: null };
  const drop = () => { if (registry.entry === entry) registry.entry = null; };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new Error(AUTH_ME_TIMEOUT_MESSAGE)); controller.abort(); }, timeoutMs);
  });
  entry.promise = Promise.race([
    Promise.resolve().then(() => send(controller.signal)).then(recordOf),
    deadline,
  ]).then(
    (record) => {
      clearTimeout(timer);
      // Only a real profile is reused; an empty or non-OK reply is re-read.
      if (record.ok && record.payload && typeof record.payload === 'object') entry.settledAt = now();
      else drop();
      return record;
    },
    (error) => { clearTimeout(timer); drop(); throw error; },
  );
  registry.entry = entry;
  return forCaller(entry.promise, signal);
}
