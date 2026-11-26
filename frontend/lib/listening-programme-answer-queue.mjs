import { localCopyExpiry, readLocalCopy, removeAckedFromCopy, writeLocalCopy } from './exam-room/local-copy.mjs';

/**
 * EXAMLISTENP-0069 FR-015: the one place that names the exam-room surface of
 * Listening practice. EXAMROOM-0066 amendment 1 (b) adds `'listening-practice'`
 * to `EXAM_ROOM_SURFACES` (#2507, which this lands after). Flag, events and the
 * local-copy key all read it; if it ever has to fall back to `'listening'`,
 * only this line changes.
 */
export const LISTENING_PRACTICE_SURFACE = 'listening-practice';

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

/** @param {unknown} value */
function answerText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * EXAMLISTENP-0069 FR-009: compare the legacy draft (`{q_num: value}`, no
 * timestamps) with what the server holds now. Equal answers are dropped:
 * there is nothing to restore. A different answer is never sent on its own:
 * it goes to `ask`, and the learner picks between the two. A missing or null
 * server answer counts as empty.
 *
 * @param {Record<number | string, string>} legacy
 * @param {Record<number | string, string | null | undefined>} serverAnswers
 * @returns {{ drop: number[], ask: { qNum: number, local: string, saved: string }[] }}
 */
export function planLegacyDraftMigration(legacy, serverAnswers) {
  /** @type {number[]} */
  const drop = [];
  /** @type {{ qNum: number, local: string, saved: string }[]} */
  const ask = [];
  const entries = Object.entries(legacy || {})
    .map(([q, value]) => /** @type {[number, unknown]} */ ([Number(q), value]))
    .filter(([qNum, value]) => Number.isInteger(qNum) && qNum > 0 && typeof value === 'string')
    .sort(([a], [b]) => a - b);
  for (const [qNum, value] of entries) {
    const local = /** @type {string} */ (value);
    const saved = answerText(serverAnswers?.[qNum]);
    if (local === saved) drop.push(qNum);
    else ask.push({ qNum, local, saved });
  }
  return { drop, ask };
}

/**
 * EXAMLISTENP-0069 FR-009: move the legacy `listening-programme-draft:{id}`
 * into the account-bound local copy of EXAMROOM-0066 FR-035, once the server
 * has returned the attempt.
 *
 * - `ownedByCurrentUser` false: the legacy key is neither read nor changed.
 * - The answers to ask about go into the new key with no `baseValue` (an
 *   unknown base, EXAMROOM-0066 FR-035 amendment 1 (c)). The current server
 *   value is never recorded as their base, so `planLocalCopyReplay` lists
 *   them under `ask` and never re-sends them without the learner's choice.
 * - A question the new copy already holds is skipped: that entry was written
 *   by the new path, after the legacy draft, and replay already handles it.
 * - The legacy key is removed only once the new key reads back with every
 *   answer to ask about, or when nothing differs. If the new write fails,
 *   the legacy key stays exactly as it was.
 *
 * @param {Storage | null | undefined} storage
 * @param {{ attemptId: string, ownerKey: string, ownedByCurrentUser: boolean, serverAnswers: Record<number | string, string | null | undefined>, surface?: string, now?: number }} input
 * @returns {{ ask: { qNum: number, local: string, saved: string }[], legacyCleared: boolean }}
 */
export function migrateLegacyProgrammeDraft(storage, {
  attemptId, ownerKey, ownedByCurrentUser, serverAnswers, surface = LISTENING_PRACTICE_SURFACE, now = Date.now(),
}) {
  if (!storage || !ownedByCurrentUser || !attemptId || !ownerKey) return { ask: [], legacyCleared: false };
  const legacy = createProgrammeAnswerDraftStore(storage, attemptId);
  const values = legacy.load();
  if (!Object.keys(values).length) return { ask: [], legacyCleared: false };
  const scope = { surface, ownerKey, attemptKey: attemptId };
  const existing = readLocalCopy(storage, { ...scope, now });
  const ask = planLegacyDraftMigration(values, serverAnswers).ask
    .filter(({ qNum }) => !existing || !Object.prototype.hasOwnProperty.call(existing.answers, String(qNum)));
  if (ask.length) {
    const written = writeLocalCopy(storage, {
      ...scope,
      answers: Object.fromEntries(ask.map(({ qNum, local }) => [qNum, { value: local }])),
      expiresAt: existing?.expiresAt ?? localCopyExpiry({ now }),
      now,
    });
    if (!written) return { ask, legacyCleared: false };
  }
  legacy.clear();
  return { ask, legacyCleared: true };
}

/**
 * The learner's answer to one question of `ask`. "Keep saved" removes the
 * on-device value from both keys now (only if it is still the value asked
 * about). "Use this device" changes nothing here: the surface sends the
 * value on the normal save path, and the copy is cleared when the server
 * acks it, as for any other answer. Returns the value to send, or null.
 *
 * @param {Storage | null | undefined} storage
 * @param {{ attemptId: string, ownerKey: string, qNum: number, local: string, choice: 'use-local' | 'keep-saved', surface?: string, now?: number }} input
 * @returns {string | null}
 */
export function resolveLegacyDraftChoice(storage, {
  attemptId, ownerKey, qNum, local, choice, surface = LISTENING_PRACTICE_SURFACE, now = Date.now(),
}) {
  if (choice === 'use-local') return local;
  if (storage && attemptId) createProgrammeAnswerDraftStore(storage, attemptId).clearIfCurrent(qNum, local);
  removeAckedFromCopy(storage, { surface, ownerKey, attemptKey: attemptId, entries: [{ q: qNum, value: local }], now });
  return null;
}
