// @ts-check
// EXAMROOM-0066 FR-017: one writing tab per attempt in a browser.
//
// Web Locks (preferred): the exclusive lock `exam-room:{surface}:{attemptKey}`
// is the write right. A tab that cannot take it is read-only. "Use this tab"
// asks the writer over BroadcastChannel `aver-exam-room`; the writer flushes its
// save queue, turns read-only, then releases. The new tab writes only after it
// holds the lock AND has reloaded the attempt from the server. No lock within
// 5 s → the new tab stays read-only ("stuck") and cancels its request, so a
// late release never makes it write by itself.
//
// Fallback without Web Locks: a writer token in localStorage
// (`exam-room:writer:{surface}:{attemptKey}`) refreshed by a heartbeat and
// checked before every save. This only warns; it is not exclusive.
// Without BroadcastChannel either: the guard is off and every tab may write.
//
// Every browser API is injected so the module runs under node --test.

export const CHANNEL_NAME = 'aver-exam-room';
export const TAKEOVER_TIMEOUT_MS = 5000;
export const HEARTBEAT_MS = 2000;
export const HEARTBEAT_STALE_MS = 6000;

/** @param {string} surface @param {string} attemptKey */
export const lockName = (surface, attemptKey) => `exam-room:${surface}:${attemptKey}`;
/** @param {string} surface @param {string} attemptKey */
export const writerTokenKey = (surface, attemptKey) => `exam-room:writer:${surface}:${attemptKey}`;

/**
 * @typedef {'pending' | 'writer' | 'read-only' | 'releasing' | 'acquiring' | 'stuck' | 'unsupported'} TabGuardState
 *   pending: checking; writer: may save/submit; read-only: another tab writes;
 *   releasing: handing over (flushing); acquiring: holds the right, reloading
 *   from the server; stuck: takeover timed out; unsupported: no guard, may write.
 */

function defaultTabId() {
  return `t-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * @param {{
 *   surface: string, attemptKey: string,
 *   flush: () => Promise<unknown>,
 *   reloadFromServer: () => Promise<unknown>,
 *   onChange?: (state: TabGuardState) => void,
 *   locks?: { request: Function } | null,
 *   channelFactory?: ((name: string) => { postMessage(m: any): void, close(): void, onmessage: ((e: { data: any }) => void) | null }) | null,
 *   storage?: Storage | null,
 *   timers?: { setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function },
 *   now?: () => number,
 *   tabId?: string,
 * }} options
 */
export function createTabGuard(options) {
  const {
    surface, attemptKey, flush, reloadFromServer, onChange = () => {},
    locks = null, channelFactory = null, storage = null,
    timers = globalThis, now = () => Date.now(), tabId = defaultTabId(),
  } = options;
  const key = `${surface}:${attemptKey}`;
  const name = lockName(surface, attemptKey);
  const tokenKey = writerTokenKey(surface, attemptKey);

  /** @type {TabGuardState} */
  let state = 'pending';
  let stopped = false;
  /** @type {null | (() => void)} */
  let releaseHeld = null;
  /** @type {AbortController | null} */
  let pendingAbort = null;
  /** @type {any} */
  let pendingTimer = null;
  /** @type {any} */
  let heartbeat = null;
  let attempt = 0;
  /** @type {{ postMessage(m: any): void, close(): void, onmessage: ((e: { data: any }) => void) | null } | null} */
  let channel = null;
  try { channel = channelFactory ? channelFactory(CHANNEL_NAME) : null; } catch { channel = null; }
  const mode = locks && typeof locks.request === 'function' ? 'locks' : (channel && storage ? 'token' : 'off');

  /** @param {TabGuardState} next */
  function set(next) {
    if (stopped || state === next) return;
    state = next;
    try { onChange(next); } catch { /* listener errors never break the guard */ }
  }

  /** @param {Record<string, unknown>} message */
  function post(message) {
    try { channel?.postMessage({ ...message, key, from: tabId }); } catch { /* channel closed */ }
  }

  function clearPending() {
    if (pendingTimer != null) timers.clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingAbort = null;
  }

  // ---- token fallback --------------------------------------------------
  function readToken() {
    try {
      const raw = storage?.getItem(tokenKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeToken() {
    try { storage?.setItem(tokenKey, JSON.stringify({ tabId, at: now() })); return true; } catch { return false; }
  }
  function ownsToken() {
    const t = readToken();
    return Boolean(t && t.tabId === tabId);
  }
  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = timers.setInterval(() => { if (state === 'writer' && ownsToken()) writeToken(); }, HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (heartbeat != null) timers.clearInterval(heartbeat);
    heartbeat = null;
  }

  // ---- after taking the right ------------------------------------------
  /** @param {number} myAttempt */
  async function becomeWriter(myAttempt) {
    set('acquiring');
    try {
      await reloadFromServer();
    } catch {
      if (myAttempt !== attempt) return;
      if (mode === 'locks') { releaseHeld?.(); releaseHeld = null; }
      if (mode === 'token' && ownsToken()) { try { storage?.removeItem(tokenKey); } catch { /* ignore */ } }
      set('stuck');
      return;
    }
    if (myAttempt !== attempt || stopped) return;
    set('writer');
    if (mode === 'token') startHeartbeat();
  }

  // ---- Web Locks -------------------------------------------------------
  /** @param {boolean} wait */
  function requestLock(wait) {
    const myAttempt = ++attempt;
    const abort = wait && typeof AbortController === 'function' ? new AbortController() : null;
    let cancelled = false;
    if (wait) {
      pendingAbort = abort;
      pendingTimer = timers.setTimeout(() => {
        if (myAttempt !== attempt) return;
        cancelled = true;
        try { abort?.abort(); } catch { /* ignore */ }
        clearPending();
        set('stuck');
      }, TAKEOVER_TIMEOUT_MS);
    }
    const opts = wait ? { mode: 'exclusive', ...(abort ? { signal: abort.signal } : {}) } : { mode: 'exclusive', ifAvailable: true };
    let request;
    try {
      request = /** @type {{ request: Function }} */ (locks).request(name, opts, (/** @type {unknown} */ lock) => {
        if (!lock) {
          if (myAttempt === attempt) set('read-only');
          return undefined;
        }
        if (cancelled || myAttempt !== attempt || stopped) return undefined; // late grant: release at once
        clearPending();
        return new Promise((resolve) => {
          releaseHeld = () => resolve(undefined);
          void becomeWriter(myAttempt);
        });
      });
    } catch {
      set('unsupported');
      return;
    }
    Promise.resolve(request).catch(() => { /* AbortError after the timeout */ });
  }

  async function handOver() {
    if (state !== 'writer') return;
    set('releasing');
    try { await flush(); } catch { /* unsaved answers go to the local copy inside flush (FR-035) */ }
    set('read-only');
    stopHeartbeat();
    if (mode === 'locks') { releaseHeld?.(); releaseHeld = null; }
    if (mode === 'token' && ownsToken()) { try { storage?.removeItem(tokenKey); } catch { /* ignore */ } }
    post({ type: 'released' });
  }

  if (channel) {
    channel.onmessage = (event) => {
      const msg = event?.data;
      if (!msg || msg.key !== key || msg.from === tabId || stopped) return;
      if (msg.type === 'takeover') void handOver();
    };
  }

  // ---- token mode acquire ---------------------------------------------
  /** @param {boolean} wait */
  function tryToken(wait) {
    const myAttempt = ++attempt;
    const free = () => {
      const t = readToken();
      return !t || t.tabId === tabId || now() - (Number(t.at) || 0) > HEARTBEAT_STALE_MS;
    };
    if (free()) {
      if (!writeToken() || !ownsToken()) { set('unsupported'); return; }
      void becomeWriter(myAttempt);
      return;
    }
    if (!wait) { set('read-only'); return; }
    const started = now();
    const poll = () => {
      if (myAttempt !== attempt || stopped) return;
      if (free()) {
        clearPending();
        if (!writeToken()) { set('stuck'); return; }
        void becomeWriter(myAttempt);
        return;
      }
      if (now() - started >= TAKEOVER_TIMEOUT_MS) { clearPending(); set('stuck'); return; }
      pendingTimer = timers.setTimeout(poll, 100);
    };
    pendingTimer = timers.setTimeout(poll, 100);
  }

  return {
    /** Current state. */
    get state() { return state; },
    get mode() { return mode; },
    /** Check the first time the room opens. */
    start() {
      if (mode === 'off') { set('unsupported'); return; }
      if (mode === 'locks') requestLock(false); else tryToken(false);
    },
    /** True only when this tab may save or submit. Token mode re-checks storage each time. */
    canWrite() {
      if (state === 'unsupported') return true;
      if (state !== 'writer') return false;
      if (mode === 'token' && !ownsToken()) { stopHeartbeat(); set('read-only'); return false; }
      return true;
    },
    /** "Use this tab". */
    requestTakeover() {
      if (state !== 'read-only' && state !== 'stuck') return;
      clearPending();
      set('pending');
      post({ type: 'takeover' });
      if (mode === 'locks') requestLock(true); else tryToken(true);
    },
    /** "Reload" from the stuck notice: start over without asking the other tab. */
    reload() {
      if (state !== 'stuck' && state !== 'read-only') return;
      clearPending();
      set('pending');
      if (mode === 'locks') requestLock(false); else tryToken(false);
    },
    /** Leave the room: release everything. */
    stop() {
      attempt += 1;
      try { pendingAbort?.abort(); } catch { /* ignore */ }
      clearPending();
      stopHeartbeat();
      releaseHeld?.();
      releaseHeld = null;
      if (mode === 'token' && ownsToken()) { try { storage?.removeItem(tokenKey); } catch { /* ignore */ } }
      stopped = true;
      try { channel?.close(); } catch { /* ignore */ }
    },
  };
}
