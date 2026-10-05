const DEFAULT_BATCH_SIZE = 100;

/** @typedef {import('../types/api').components['schemas']['ProgressBody']} ProgressPayload */
/**
 * @typedef {object} QuizProgressOutboxOptions
 * @property {{ post: (path: string, payload: ProgressPayload) => Promise<unknown> }} api
 * @property {{ drainBatch: () => Partial<ProgressPayload> | undefined }} engine
 * @property {string} sessionId
 * @property {boolean} [review]
 * @property {number} [batchSize]
 * @property {((acknowledged: unknown, payload: ProgressPayload) => boolean) | null} [validateAck]
 * @property {() => boolean} [isActive]
 * @property {(reason: 'grammar_reset_stale') => void} [onBlocked]
 * @property {(acknowledged: unknown) => void} [onAcknowledged]
 */

export class QuizProgressOutbox {
  #api;
  #engine;
  #sessionId;
  #review;
  #batchSize;
  #attempts = [];
  #wordStats = new Map();
  #chain = Promise.resolve();
  #validateAck;
  #isActive;
  #onBlocked;
  #onAcknowledged;
  #blockedReason = null;
  #disposed = false;

  /** @param {QuizProgressOutboxOptions} options */
  constructor({ api, engine, sessionId, review = false, batchSize = DEFAULT_BATCH_SIZE,
    validateAck = null, isActive = () => true, onBlocked = () => {}, onAcknowledged = () => {} }) {
    if (!api?.post || !engine?.drainBatch || !sessionId) throw new Error('quiz-outbox-config-invalid');
    this.#api = api;
    this.#engine = engine;
    this.#sessionId = sessionId;
    this.#review = review === true;
    this.#batchSize = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
    this.#validateAck = validateAck;
    this.#isActive = isActive;
    this.#onBlocked = onBlocked;
    this.#onAcknowledged = onAcknowledged;
  }

  #active() { return !this.#disposed && !this.#blockedReason && this.#isActive() === true; }

  observeFailure(error) {
    if (this.#validateAck && error?.status === 409 && error?.detail?.error_code === 'grammar_reset_stale') {
      if (!this.#blockedReason) {
        this.#blockedReason = 'grammar_reset_stale';
        if (!this.#disposed && this.#isActive() === true) this.#onBlocked(this.#blockedReason);
      }
    }
  }

  #drain() {
    if (!this.#active()) return;
    const batch = this.#engine.drainBatch() || {};
    if (this.#review) return;
    if (Array.isArray(batch.attempts)) this.#attempts.push(...batch.attempts);
    if (Array.isArray(batch.word_stats)) {
      for (const row of batch.word_stats) {
        if (row?.item_key) this.#wordStats.set(row.item_key, row);
      }
    }
  }

  async #sendOnce(force) {
    if (!this.#active()) return false;
    this.#drain();
    const attempts = this.#attempts.slice(0, this.#batchSize);
    const keys = [...this.#wordStats.keys()].slice(0, this.#batchSize);
    if (!attempts.length && !keys.length) return true;
    if (!force && attempts.length < 5) return true;
    const rows = keys.map((key) => this.#wordStats.get(key));
    try {
      const acknowledged = await this.#api.post(`/api/quiz/sessions/${encodeURIComponent(this.#sessionId)}/progress`, {
        attempts,
        word_stats: rows,
      });
      if (!this.#active() || this.#validateAck && this.#validateAck(acknowledged, { attempts, word_stats: rows }) !== true) return false;
      this.#onAcknowledged(acknowledged);
    } catch (error) {
      this.observeFailure(error);
      return false;
    }
    this.#attempts.splice(0, attempts.length);
    keys.forEach((key, index) => {
      if (this.#wordStats.get(key) === rows[index]) this.#wordStats.delete(key);
    });
    return true;
  }

  flush(force = false) {
    if (!this.#active()) return Promise.resolve(false);
    this.#drain();
    const run = this.#chain.then(async () => {
      let saved = await this.#sendOnce(force);
      while (force && saved && (this.#attempts.length || this.#wordStats.size)) {
        saved = await this.#sendOnce(true);
      }
      return saved;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  keepalivePayload() {
    if (!this.#active()) return null;
    this.#drain();
    if (this.#review) return null;
    const attempts = this.#attempts.slice(0, this.#batchSize);
    const wordStats = [...this.#wordStats.values()].slice(0, this.#batchSize);
    return attempts.length || wordStats.length ? { attempts, word_stats: wordStats } : null;
  }

  get sessionId() { return this.#sessionId; }
  get blockedReason() { return this.#blockedReason; }
  dispose() { this.#disposed = true; }
}
