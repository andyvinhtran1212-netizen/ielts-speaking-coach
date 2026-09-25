/**
 * Keep writes for one question strictly ordered while allowing independent
 * questions to save in parallel. A rejected autosave does not poison the
 * queue: the final submit flush can still retry the latest visible value.
 *
 * @param {(qNum: number, value: string) => Promise<unknown>} write
 */
export function createProgrammeAnswerWriteQueue(write) {
  /** @type {Map<number, Promise<void>>} */
  const tails = new Map();

  function enqueue(qNum, value) {
    const previous = tails.get(qNum) || Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => write(qNum, value))
      .then(() => undefined);
    const tail = operation.catch(() => undefined);
    tails.set(qNum, tail);
    void tail.finally(() => {
      if (tails.get(qNum) === tail) tails.delete(qNum);
    });
    return operation;
  }

  async function flush(entries) {
    await Promise.all(entries.map(({ qNum, value }) => enqueue(qNum, value)));
    // Enqueues are blocked by the submit lock in the UI, but drain to empty as
    // a defensive contract for any caller that races a final write.
    while (tails.size) await Promise.all([...tails.values()]);
  }

  return { enqueue, flush };
}

/**
 * Submit only questions the learner actually touched. A present empty value
 * must still be sent so clearing an earlier answer stays cleared on the same
 * attempt; untouched questions need no redundant PATCH.
 *
 * @param {Array<{q_num: number}>} questions
 * @param {Record<number, string>} answers
 */
export function programmeAnswerFlushEntries(questions, answers) {
  return questions
    .filter(({ q_num }) => Object.prototype.hasOwnProperty.call(answers, q_num))
    .map(({ q_num }) => ({ qNum: q_num, value: answers[q_num] }));
}

/**
 * Keep the latest visible answer in synchronous browser storage until the
 * server confirms that exact value. This is the page-exit safety net for the
 * programme runner: a debounce timer or an in-flight PATCH may be interrupted
 * by navigation, but the next load can still restore and retry the answer.
 *
 * `clearIfCurrent` deliberately compares values before deleting. An older
 * PATCH finishing after a newer edit must never erase the newer local draft.
 * Storage failures are fail-soft because private browsing or a full quota
 * must not make the exercise unusable.
 *
 * @param {{getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void}} storage
 * @param {string} attemptId
 */
export function createProgrammeAnswerDraftStore(storage, attemptId) {
  const key = `listening-programme-draft:${attemptId}`;

  function load() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed)
        .filter(([qNum, value]) => Number(qNum) > 0 && typeof value === 'string')
        .map(([qNum, value]) => [Number(qNum), value]));
    } catch {
      return {};
    }
  }

  function write(values) {
    try {
      if (Object.keys(values).length) storage.setItem(key, JSON.stringify(values));
      else storage.removeItem(key);
    } catch {
      // Fail-soft: the network autosave remains available.
    }
  }

  function remember(qNum, value) {
    write({ ...load(), [qNum]: value });
  }

  function clearIfCurrent(qNum, value) {
    const values = load();
    if (values[qNum] !== value) return;
    delete values[qNum];
    write(values);
  }

  function clear() {
    try { storage.removeItem(key); } catch { /* fail-soft */ }
  }

  return { key, load, remember, clearIfCurrent, clear };
}

/**
 * Track every in-flight answer write instead of treating the newest write
 * anywhere in the form as authoritative. This keeps a failed write for one
 * question visible even when another question finishes successfully.
 */
export function createProgrammeSaveStatusTracker() {
  let nextToken = 0;
  /** @type {Map<number, number | 'flush'>} */
  const pending = new Map();
  /** @type {Set<number | 'flush'>} */
  const failures = new Set();

  /** @returns {'error' | 'saving' | 'saved'} */
  function status() {
    if (failures.size) return 'error';
    if (pending.size) return 'saving';
    return 'saved';
  }

  function begin(qNum) {
    const token = ++nextToken;
    failures.delete(qNum);
    pending.set(token, qNum);
    return { token, status: status() };
  }

  function beginFlush() {
    const token = ++nextToken;
    failures.clear();
    pending.set(token, 'flush');
    return { token, status: status() };
  }

  function succeed(token) {
    const key = pending.get(token);
    if (key === undefined) return status();
    pending.delete(token);
    failures.delete(key);
    return status();
  }

  function fail(token) {
    const key = pending.get(token);
    if (key === undefined) return status();
    pending.delete(token);
    failures.add(key);
    return status();
  }

  function finishFlush(token) {
    pending.delete(token);
    failures.clear();
    return status();
  }

  function reset() {
    pending.clear();
    failures.clear();
  }

  return { begin, beginFlush, succeed, fail, finishFlush, reset, status };
}
