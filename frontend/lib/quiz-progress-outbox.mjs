const DEFAULT_BATCH_SIZE = 100;

export class QuizProgressOutbox {
  #api;
  #engine;
  #sessionId;
  #review;
  #batchSize;
  #attempts = [];
  #wordStats = new Map();
  #chain = Promise.resolve();

  constructor({ api, engine, sessionId, review = false, batchSize = DEFAULT_BATCH_SIZE }) {
    if (!api?.post || !engine?.drainBatch || !sessionId) throw new Error('quiz-outbox-config-invalid');
    this.#api = api;
    this.#engine = engine;
    this.#sessionId = sessionId;
    this.#review = review === true;
    this.#batchSize = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
  }

  #drain() {
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
    this.#drain();
    const attempts = this.#attempts.slice(0, this.#batchSize);
    const keys = [...this.#wordStats.keys()].slice(0, this.#batchSize);
    if (!attempts.length && !keys.length) return true;
    if (!force && attempts.length < 5) return true;
    const rows = keys.map((key) => this.#wordStats.get(key));
    try {
      await this.#api.post(`/api/quiz/sessions/${encodeURIComponent(this.#sessionId)}/progress`, {
        attempts,
        word_stats: rows,
      });
    } catch {
      return false;
    }
    this.#attempts.splice(0, attempts.length);
    keys.forEach((key, index) => {
      if (this.#wordStats.get(key) === rows[index]) this.#wordStats.delete(key);
    });
    return true;
  }

  flush(force = false) {
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
    this.#drain();
    if (this.#review) return null;
    const attempts = this.#attempts.slice(0, this.#batchSize);
    const wordStats = [...this.#wordStats.values()].slice(0, this.#batchSize);
    return attempts.length || wordStats.length ? { attempts, word_stats: wordStats } : null;
  }

  get sessionId() { return this.#sessionId; }
}
