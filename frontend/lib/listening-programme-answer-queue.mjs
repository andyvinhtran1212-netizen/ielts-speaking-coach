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
