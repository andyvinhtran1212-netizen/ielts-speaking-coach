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
