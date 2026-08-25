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

export const SPEAKING_PLAYER_INITIAL_VIEW = Object.freeze({
  frame: Object.freeze({
    loadingMessage: 'Đang tải...',
    errorMessage: '',
    testModeBannerVisible: false,
  }),
  header: Object.freeze({
    info: '',
    progress: '',
    visible: false,
    progressBarVisible: false,
    progressBarLabel: '',
    progressBarPercent: 0,
  }),
  prep: Object.freeze({
    fallbackWarningVisible: false,
    partBadge: '',
    topic: '',
    counter: '',
    listenOnly: false,
    listenAudioUrl: '',
    listenError: '',
    questionText: '',
    modeToggleVisible: true,
    listeningBarVisible: false,
    qCardOpacity: 1,
    instruction: 'Đọc câu hỏi kỹ, sau đó nhấn nút để bắt đầu ghi âm.',
    playLabel: 'Nghe câu hỏi',
    playIsReplay: false,
    revealTextVisible: true,
    revealButtonVisible: false,
    cueVisible: false,
    cueBullets: Object.freeze([]),
    cueReflection: '',
    inlineRecordingVisible: false,
    startButtonVisible: true,
  }),
  recording: Object.freeze({
    substate: 'idle',
    error: '',
    errorVisible: false,
    timer: '0:00',
    duration: '',
    playbackUrl: '',
    lengthHint: '',
    lengthHintVisible: false,
    submitDisabled: false,
  }),
  processing: Object.freeze({
    text: '',
  }),
  part2: Object.freeze({
    topic: '',
    question: '',
    bullets: Object.freeze([]),
    reflection: '',
    retryVisible: false,
    retryMessage: '',
    retryPlaybackUrl: '',
    startVisible: true,
    prepQuestion: '',
    prepTimer: '1:00',
    prepUrgent: false,
    notesRevision: 0,
    speakTimer: '2:00',
    speakUrgent: false,
  }),
  sheet: Object.freeze({
    slots: Object.freeze([]),
    meterVisible: false,
    done: 0,
    total: 0,
    ready: false,
    locked: false,
    submitNote: '',
    submitLabel: 'Nộp bài',
    submitting: false,
  }),
  completion: Object.freeze({
    title: 'Bạn đã hoàn thành Full Test!',
    description: 'Bài thi đang được phân tích chuyên sâu để tổng hợp band score và nhận xét chi tiết.',
    statusTone: 'pending',
    statusText: 'Đang kiểm tra và gửi nốt các câu trả lời…',
    retryVisible: false,
    retryDisabled: false,
    retryLabel: 'Gửi lại và chốt bài',
    infoVisible: false,
    ctasVisible: false,
  }),
  feedback: Object.freeze({
    partialVisible: false,
    overallBand: null,
    bands: Object.freeze([]),
    warnings: Object.freeze([]),
    reliability: null,
    kind: 'empty',
    stub: null,
    criteria: Object.freeze([]),
    strengths: Object.freeze([]),
    improvements: Object.freeze([]),
    grammarIssues: Object.freeze([]),
    grammarGroups: Object.freeze([]),
    grammarMoreCount: 0,
    vocabularyIssues: Object.freeze([]),
    corrections: Object.freeze([]),
    sample: null,
    transcriptVisible: false,
    transcriptSegments: Object.freeze([]),
    audioVisible: false,
    grammarResource: null,
    pronunciation: Object.freeze({ visible: false, status: 'hidden' }),
    backToSheetVisible: false,
    nextVisible: false,
    finishVisible: false,
    finishLabel: 'Hoàn thành phiên luyện',
  }),
  testResults: Object.freeze({
    overallBand: '—',
    cards: Object.freeze([]),
    fullPronunciation: Object.freeze({ visible: false, status: 'hidden' }),
  }),
});

function requiredKey(value) {
  const key = String(value == null ? '' : value).trim();
  if (!key) throw new TypeError('speaking-player-effect-key-required');
  return key;
}

function freezeViewValue(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeViewValue));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const snapshot = {};
    for (const [key, nested] of Object.entries(value)) {
      snapshot[key] = freezeViewValue(nested);
    }
    return Object.freeze(snapshot);
  }
  return value;
}

function freezeViewSection(section) {
  const snapshot = {};
  for (const [key, value] of Object.entries(section)) {
    snapshot[key] = freezeViewValue(value);
  }
  return Object.freeze(snapshot);
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
    this.domStateActivation = environment.domStateActivation !== false;
    this.stateListeners = new Set();
    this.viewListeners = new Set();
    this.viewSnapshot = SPEAKING_PLAYER_INITIAL_VIEW;
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
    if (this.domStateActivation) {
      for (const candidate of this.states) {
        const element = this.document?.getElementById?.(`state-${candidate}`);
        if (!element) continue;
        element.classList.toggle('active', candidate === state);
      }
    }
    this.currentState = state;
    for (const listener of this.stateListeners) listener();
    return true;
  }

  subscribeState(listener) {
    if (this.disposed || typeof listener !== 'function') return () => {};
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  getStateSnapshot() {
    return this.currentState;
  }

  subscribeView(listener) {
    if (this.disposed || typeof listener !== 'function') return () => {};
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  getViewSnapshot() {
    return this.viewSnapshot;
  }

  updateView(section, patch) {
    if (this.disposed || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return false;
    }
    const key = String(section || '');
    const previous = this.viewSnapshot[key];
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
      throw new RangeError(`unknown-speaking-player-view:${key}`);
    }
    this.viewSnapshot = Object.freeze({
      ...this.viewSnapshot,
      [key]: freezeViewSection({ ...previous, ...patch }),
    });
    for (const listener of this.viewListeners) listener();
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
    this.stateListeners.clear();
    this.viewListeners.clear();
  }
}
