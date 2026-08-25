// Safari 26 claims MediaRecorder webm/opus support but emits WebM with
// broken packet timestamps (20ms Opus frames at ~2.5ms PTS — Gate E
// real-device journey 2026-08-19: a 90s take decoded to 2.6s of container
// holding ~21s of frames; backend measured 45s). Real WebKit must record on
// its long-proven audio/mp4 lane; Chromium engines keep webm first. iOS is
// WebKit regardless of browser shell (CriOS/FxiOS), so the device check
// comes first. Mirrors _mimeCandidates() in public/js/practice.js.
const CHROMIUM_MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]);

const WEBKIT_MIME_CANDIDATES = Object.freeze([
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]);

export function isRealWebKitUserAgent(userAgent) {
  const ua = String(userAgent || '');
  return /iP(hone|ad|od)/.test(ua)
    || (/AppleWebKit\//.test(ua) && /Version\/\d/.test(ua) && !/Chrom/.test(ua));
}

export class SpeakingRecorderError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SpeakingRecorderError';
    this.code = code;
  }
}

function recorderError(error) {
  if (error instanceof SpeakingRecorderError) return error;
  const name = error && error.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new SpeakingRecorderError(
      'permission_denied',
      'Bạn đã từ chối quyền microphone. Hãy cho phép trong thanh địa chỉ trình duyệt rồi thử lại.',
      error,
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new SpeakingRecorderError(
      'device_missing',
      'Không tìm thấy microphone. Hãy cắm thiết bị và thử lại.',
      error,
    );
  }
  if (name === 'NotReadableError') {
    return new SpeakingRecorderError(
      'device_busy',
      'Microphone đang được dùng bởi ứng dụng khác. Hãy đóng ứng dụng đó và thử lại.',
      error,
    );
  }
  return new SpeakingRecorderError(
    'start_failed',
    'Không thể mở microphone: ' + ((error && error.message) || String(error)),
    error,
  );
}

function stopTracks(stream) {
  if (!stream || typeof stream.getTracks !== 'function') return;
  stream.getTracks().forEach((track) => {
    try { track.stop(); } catch { /* cleanup is best-effort */ }
  });
}

export function pickSpeakingRecorderMime(MediaRecorderCtor, userAgent) {
  if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== 'function') return '';
  const candidates = isRealWebKitUserAgent(userAgent)
    ? WEBKIT_MIME_CANDIDATES
    : CHROMIUM_MIME_CANDIDATES;
  for (const candidate of candidates) {
    try {
      if (MediaRecorderCtor.isTypeSupported(candidate)) return candidate;
    } catch { /* old engines may throw for a candidate */ }
  }
  return '';
}

export class SpeakingRecorderController {
  constructor(environment = {}) {
    const browser = environment.window || globalThis.window || globalThis;
    this.mediaDevices = environment.mediaDevices || browser.navigator?.mediaDevices || null;
    this.MediaRecorderCtor = environment.MediaRecorderCtor || browser.MediaRecorder || null;
    this.userAgent = environment.userAgent || browser.navigator?.userAgent || '';
    this.AudioContextCtor = environment.AudioContextCtor
      || browser.AudioContext
      || browser.webkitAudioContext
      || null;
    this.BlobCtor = environment.BlobCtor || browser.Blob || globalThis.Blob;
    this.setIntervalFn = environment.setIntervalFn || browser.setInterval?.bind(browser) || setInterval;
    this.clearIntervalFn = environment.clearIntervalFn || browser.clearInterval?.bind(browser) || clearInterval;

    this.stream = null;
    this.recorder = null;
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.chunks = [];
    this.blob = null;
    this.elapsed = 0;
    this.timer = null;
    this.generation = 0;
    this.startingGeneration = null;
    this.disposed = false;
    this.onRecorded = null;
    this.onTick = null;
  }

  isRecording() {
    return !!this.recorder && this.recorder.state !== 'inactive';
  }

  isStarting() {
    return this.startingGeneration !== null;
  }

  getAnalyser() {
    return this.analyser;
  }

  getElapsed() {
    return this.elapsed;
  }

  getBlob() {
    return this.blob;
  }

  async start({ maxSeconds = 0, onTick, onRecorded } = {}) {
    if (this.disposed) {
      throw new SpeakingRecorderError('disposed', 'Bộ ghi âm đã được đóng. Hãy tải lại trang.');
    }
    if (this.isStarting() || this.isRecording()) return false;
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
      throw new SpeakingRecorderError(
        'unsupported_media',
        'Trình duyệt không hỗ trợ ghi âm. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.',
      );
    }
    if (!this.MediaRecorderCtor) {
      throw new SpeakingRecorderError(
        'unsupported_recorder',
        'Trình duyệt không hỗ trợ MediaRecorder. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.',
      );
    }

    const generation = ++this.generation;
    this.startingGeneration = generation;
    let acquiredThisStart = false;
    try {
      if (!this.stream || !this.stream.active) {
        const acquired = await this.mediaDevices.getUserMedia({ audio: true, video: false });
        if (this.disposed || generation !== this.generation) {
          stopTracks(acquired);
          if (this.disposed) {
            throw new SpeakingRecorderError('disposed', 'Bộ ghi âm đã được đóng. Hãy tải lại trang.');
          }
          return false;
        }
        this.stream = acquired;
        acquiredThisStart = true;
      }

      await this.#prepareAnalyser();
      if (this.disposed || generation !== this.generation) {
        if (acquiredThisStart) this.#releaseMedia();
        else this.#disconnectAnalyser();
        if (this.disposed) {
          throw new SpeakingRecorderError('disposed', 'Bộ ghi âm đã được đóng. Hãy tải lại trang.');
        }
        return false;
      }

      this.#clearTimer();
      this.chunks = [];
      this.blob = null;
      this.elapsed = 0;
      this.onTick = typeof onTick === 'function' ? onTick : null;
      this.onRecorded = typeof onRecorded === 'function' ? onRecorded : null;

      const mimeType = pickSpeakingRecorderMime(this.MediaRecorderCtor, this.userAgent);
      let recorder;
      try {
        recorder = new this.MediaRecorderCtor(
          this.stream,
          mimeType ? { mimeType } : {},
        );
      } catch {
        recorder = new this.MediaRecorderCtor(this.stream);
      }
      this.recorder = recorder;

      recorder.ondataavailable = (event) => {
        if (this.recorder === recorder && event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (this.recorder !== recorder || this.disposed) return;
        this.#clearTimer();
        const type = recorder.mimeType || 'audio/webm';
        const blob = new this.BlobCtor(this.chunks, { type });
        this.blob = blob;
        const callback = this.onRecorded;
        this.onRecorded = null;
        if (callback) callback(blob, this.elapsed);
      };

      recorder.start(250);
      if (this.onTick) this.onTick(0);
      if (Number(maxSeconds) > 0) {
        const cap = Number(maxSeconds);
        this.timer = this.setIntervalFn(() => {
          this.elapsed += 1;
          try {
            if (this.onTick) this.onTick(this.elapsed);
          } finally {
            // A rendering callback must never defeat the recording hard cap.
            if (this.elapsed >= cap) this.stop();
          }
        }, 1000);
      }
      return true;
    } catch (error) {
      // A reset/release while permission or AudioContext setup was pending is
      // an intentional cancellation, not a microphone failure to show users.
      if (!this.disposed && generation !== this.generation) return false;
      // Fail closed even if an injected callback throws after recorder.start():
      // no error path may leave the microphone live without a UI owner.
      this.reset();
      this.#releaseMedia();
      throw recorderError(error);
    } finally {
      if (this.startingGeneration === generation) this.startingGeneration = null;
    }
  }

  stop() {
    if (this.isStarting()) {
      this.generation += 1;
      this.startingGeneration = null;
      return true;
    }
    this.#clearTimer();
    if (!this.recorder || this.recorder.state === 'inactive') return false;
    try {
      this.recorder.stop();
      return true;
    } catch {
      // A recorder that throws from stop() cannot be trusted or reused. Drop
      // every owned resource so the next start gets a clean device session.
      this.release();
      return false;
    }
  }

  reset() {
    this.generation += 1;
    this.startingGeneration = null;
    this.#clearTimer();
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try { recorder.stop(); } catch { /* already stopping */ }
    }
    this.recorder = null;
    this.chunks = [];
    this.blob = null;
    this.elapsed = 0;
    this.onRecorded = null;
    this.onTick = null;
  }

  release() {
    this.reset();
    this.#releaseMedia();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.#releaseMedia();
  }

  async #prepareAnalyser() {
    if (!this.AudioContextCtor || !this.stream) {
      this.analyser = null;
      return;
    }
    try {
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new this.AudioContextCtor();
      }
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      try { this.source?.disconnect?.(); } catch { /* optional graph cleanup */ }
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);
    } catch {
      this.analyser = null;
    }
  }

  #clearTimer() {
    if (this.timer != null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  #disconnectAnalyser() {
    try { this.source?.disconnect?.(); } catch { /* optional graph cleanup */ }
    this.source = null;
    this.analyser = null;
  }

  #releaseMedia() {
    this.#disconnectAnalyser();
    stopTracks(this.stream);
    this.stream = null;
    if (this.audioContext) {
      try { void this.audioContext.close(); } catch { /* cleanup is best-effort */ }
    }
    this.audioContext = null;
  }
}
