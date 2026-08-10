const DEFAULT_STATES = Object.freeze([
  'loading',
  'error',
  'mode-choice',
  'prep',
  'p2a',
  'p2b',
  'p2c',
  'processing',
  'feedback',
  'test-results',
  'completion',
  'sheet',
]);

function requiredKey(value) {
  const key = String(value == null ? '' : value).trim();
  if (!key) throw new TypeError('speaking-player-effect-key-required');
  return key;
}

export class SpeakingPlayerController {
  constructor(environment = {}) {
    this.document = environment.document || globalThis.document || null;
    this.urlApi = environment.urlApi || globalThis.URL || null;
    this.speechSynthesis = environment.speechSynthesis
      || globalThis.speechSynthesis
      || null;
    this.setIntervalFn = environment.setIntervalFn || globalThis.setInterval;
    this.clearIntervalFn = environment.clearIntervalFn || globalThis.clearInterval;
    this.setTimeoutFn = environment.setTimeoutFn || globalThis.setTimeout;
    this.clearTimeoutFn = environment.clearTimeoutFn || globalThis.clearTimeout;
    this.states = Array.isArray(environment.states) && environment.states.length
      ? Array.from(new Set(environment.states.map(String)))
      : DEFAULT_STATES.slice();
    this.effects = new Map();
    this.objectUrls = new Map();
    this.countdowns = new Map();
    this.countdownRuns = new Map();
    this.currentState = null;
    this.disposed = false;
  }

  showState(name) {
    if (this.disposed) return false;
    const state = String(name || '');
    if (!this.states.includes(state)) {
      throw new RangeError(`unknown-speaking-player-state:${state}`);
    }
    for (const candidate of this.states) {
      const element = this.document?.getElementById?.(`state-${candidate}`);
      if (!element) continue;
      element.classList.toggle('active', candidate === state);
    }
    this.currentState = state;
    return true;
  }

  listen(key, target, type, listener, options) {
    const effectKey = requiredKey(key);
    if (
      this.disposed
      || !target?.addEventListener
      || !target?.removeEventListener
      || typeof listener !== 'function'
    ) return false;
    this.clearEffect(effectKey);
    target.addEventListener(type, listener, options);
    this.effects.set(effectKey, () => {
      target.removeEventListener(type, listener, options);
    });
    return true;
  }

  startInterval(key, callback, milliseconds) {
    const effectKey = requiredKey(key);
    if (this.disposed || typeof callback !== 'function') return null;
    this.clearEffect(effectKey);
    const handle = this.setIntervalFn(() => {
      if (!this.disposed) callback();
    }, milliseconds);
    this.effects.set(effectKey, () => this.clearIntervalFn(handle));
    return effectKey;
  }

  startTimeout(key, callback, milliseconds) {
    const effectKey = requiredKey(key);
    if (this.disposed || typeof callback !== 'function') return null;
    this.clearEffect(effectKey);
    const handle = this.setTimeoutFn(() => {
      this.effects.delete(effectKey);
      if (!this.disposed) callback();
    }, milliseconds);
    this.effects.set(effectKey, () => this.clearTimeoutFn(handle));
    return effectKey;
  }

  startCountdown(key, options = {}) {
    const effectKey = requiredKey(key);
    const seconds = Math.max(0, Math.floor(Number(options.seconds) || 0));
    const intervalMs = Math.max(1, Math.floor(Number(options.intervalMs) || 1000));
    const onTick = typeof options.onTick === 'function' ? options.onTick : () => {};
    const onDone = typeof options.onDone === 'function' ? options.onDone : () => {};
    this.clearEffect(effectKey);
    if (this.disposed) return null;

    const run = Symbol(effectKey);
    let remaining = seconds;
    this.countdownRuns.set(effectKey, run);
    this.countdowns.set(effectKey, remaining);
    onTick(remaining);
    if (this.disposed || this.countdownRuns.get(effectKey) !== run) {
      return null;
    }
    if (remaining === 0) {
      this.countdowns.delete(effectKey);
      this.countdownRuns.delete(effectKey);
      onDone();
      return null;
    }

    const handle = this.setIntervalFn(() => {
      if (this.disposed || this.countdownRuns.get(effectKey) !== run) return;
      remaining = Math.max(0, remaining - 1);
      this.countdowns.set(effectKey, remaining);
      onTick(remaining);
      if (this.disposed || this.countdownRuns.get(effectKey) !== run) return;
      if (remaining === 0) {
        this.clearEffect(effectKey);
        onDone();
      }
    }, intervalMs);
    this.effects.set(effectKey, () => this.clearIntervalFn(handle));
    return effectKey;
  }

  clearEffect(key) {
    const effectKey = String(key == null ? '' : key).trim();
    if (!effectKey) return false;
    const cleanup = this.effects.get(effectKey);
    this.effects.delete(effectKey);
    this.countdowns.delete(effectKey);
    this.countdownRuns.delete(effectKey);
    if (!cleanup) return false;
    try { cleanup(); } catch { /* cleanup is best-effort */ }
    return true;
  }

  createObjectUrl(key, blob) {
    const objectKey = requiredKey(key);
    if (this.disposed || !blob || typeof this.urlApi?.createObjectURL !== 'function') {
      return null;
    }
    this.revokeObjectUrl(objectKey);
    const url = this.urlApi.createObjectURL(blob);
    this.objectUrls.set(objectKey, url);
    return url;
  }

  revokeObjectUrl(key, expectedUrl = null) {
    const objectKey = String(key == null ? '' : key).trim();
    const url = this.objectUrls.get(objectKey);
    if (expectedUrl && url !== expectedUrl) return false;
    this.objectUrls.delete(objectKey);
    if (!url || typeof this.urlApi?.revokeObjectURL !== 'function') return false;
    try { this.urlApi.revokeObjectURL(url); } catch { /* already revoked */ }
    return true;
  }

  cancelSpeech() {
    try { this.speechSynthesis?.cancel?.(); } catch { /* optional browser API */ }
  }

  getSnapshot() {
    return {
      currentState: this.currentState,
      effectKeys: Array.from(this.effects.keys()),
      objectUrlKeys: Array.from(this.objectUrls.keys()),
      countdowns: Object.fromEntries(this.countdowns),
      disposed: this.disposed,
    };
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of Array.from(this.effects.keys())) this.clearEffect(key);
    for (const key of Array.from(this.objectUrls.keys())) this.revokeObjectUrl(key);
    this.cancelSpeech();
    this.countdowns.clear();
    this.countdownRuns.clear();
  }
}
