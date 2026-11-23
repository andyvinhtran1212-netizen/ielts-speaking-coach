// @ts-check
// EXAMROOM-0066 FR-035 (and FR-015, FR-032): the on-device copy of answers
// written before "Sign in again", bound to one account (or share-link guest
// scope) and one attempt. It never overwrites the server: on return the
// surface reads the attempt first and only re-sends answers the server has not
// changed since the copy's `baseSavedAt`. No email or name is stored.
//
// Key: exam-room:local-copy:{surface}:{ownerKey}:{attemptKey}, each segment
// URI-encoded so the owner can be read from the key alone (clean-up of other
// accounts deletes without reading their content).

const PREFIX = 'exam-room:local-copy:';
export const UNTIMED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AFTER_DEADLINE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ value: string, baseSavedAt: string | null }} LocalCopyAnswer
 * @typedef {{ v: 1, surface: string, ownerKey: string, attemptKey: string, savedAt: number, expiresAt: number, answers: Record<string, LocalCopyAnswer> }} LocalCopy
 * @typedef {{ surface: string, ownerKey: string, attemptKey: string }} LocalCopyScope
 */

/** @param {LocalCopyScope} scope */
export function localCopyKey({ surface, ownerKey, attemptKey }) {
  return PREFIX + [surface, ownerKey, attemptKey].map((part) => encodeURIComponent(String(part))).join(':');
}

/** @param {string} key @returns {LocalCopyScope | null} */
export function parseLocalCopyKey(key) {
  if (!key.startsWith(PREFIX)) return null;
  const parts = key.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [surface, ownerKey, attemptKey] = parts.map(decodeURIComponent);
    return { surface, ownerKey, attemptKey };
  } catch {
    return null;
  }
}

/**
 * Deadline of the attempt plus 24 hours; 7 days for untimed work.
 * @param {{ deadline?: number | Date | null, now?: number }} input
 */
export function localCopyExpiry({ deadline = null, now = Date.now() }) {
  const d = deadline instanceof Date ? deadline.getTime() : deadline;
  return typeof d === 'number' && Number.isFinite(d) ? d + AFTER_DEADLINE_MS : now + UNTIMED_TTL_MS;
}

/** @param {LocalCopyScope} scope */
function validScope(scope) {
  return Boolean(scope && scope.surface && scope.ownerKey && scope.attemptKey);
}

/**
 * Write (merge into) the copy and read it back. True only when the stored
 * copy holds every answer just written: the "Sign in again" button of the
 * fallback flow is enabled only then (FR-015).
 * @param {Storage | null | undefined} storage
 * @param {LocalCopyScope & { answers: Record<string | number, LocalCopyAnswer>, expiresAt: number, now?: number }} input
 * @returns {boolean}
 */
export function writeLocalCopy(storage, { surface, ownerKey, attemptKey, answers, expiresAt, now = Date.now() }) {
  const scope = { surface, ownerKey, attemptKey };
  if (!storage || !validScope(scope)) return false;
  try {
    const existing = readLocalCopy(storage, { ...scope, now });
    /** @type {Record<string, LocalCopyAnswer>} */
    const merged = { ...(existing?.answers ?? {}) };
    for (const [q, a] of Object.entries(answers)) {
      if (!a || typeof a.value !== 'string') continue;
      merged[String(q)] = { value: a.value, baseSavedAt: a.baseSavedAt ?? null };
    }
    /** @type {LocalCopy} */
    const record = { v: 1, ...scope, savedAt: now, expiresAt, answers: merged };
    const key = localCopyKey(scope);
    storage.setItem(key, JSON.stringify(record));
    const back = JSON.parse(storage.getItem(key) || 'null');
    return Boolean(back) && Object.entries(answers).every(([q, a]) => !a || typeof a.value !== 'string' || back.answers?.[String(q)]?.value === a.value);
  } catch {
    return false;
  }
}

/**
 * The copy for exactly this owner and attempt, or null. A record whose own
 * fields disagree with the scope, or that has expired, is removed.
 * @param {Storage | null | undefined} storage
 * @param {LocalCopyScope & { now?: number }} input
 * @returns {LocalCopy | null}
 */
export function readLocalCopy(storage, { surface, ownerKey, attemptKey, now = Date.now() }) {
  const scope = { surface, ownerKey, attemptKey };
  if (!storage || !validScope(scope)) return null;
  const key = localCopyKey(scope);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    const matches = record && record.v === 1 && record.surface === surface && record.ownerKey === ownerKey
      && record.attemptKey === attemptKey && record.answers && typeof record.answers === 'object';
    if (!matches || !(typeof record.expiresAt === 'number' && now < record.expiresAt)) {
      storage.removeItem(key);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * What to do with a copy after reading the attempt from the server.
 * - Attempt not open (submitted, closed, abandoned): send nothing, clear.
 * - Per answer: re-send only when the server's save time is not newer than
 *   the copy's `baseSavedAt` (both unknown counts as unchanged); otherwise
 *   keep the server's value and drop that answer from the copy.
 * Answers equal to the server value need no re-send. `drop` lists the
 * answers to remove from the copy now (server kept or already equal); the
 * re-sent ones are removed by `removeAckedFromCopy` once the server acks them.
 * @param {LocalCopy | null} copy
 * @param {{ open: boolean, answers: Record<string | number, { value: string | null, savedAt: string | null }> }} server
 * @returns {{ resend: { q: string, value: string }[], keepServer: string[], drop: string[], clear: boolean }}
 */
export function planLocalCopyReplay(copy, server) {
  if (!copy) return { resend: [], keepServer: [], drop: [], clear: false };
  if (!server.open) return { resend: [], keepServer: [], drop: Object.keys(copy.answers), clear: true };
  const resend = [];
  const keepServer = [];
  const same = [];
  for (const [q, local] of Object.entries(copy.answers)) {
    const remote = server.answers[q] ?? null;
    const remoteAt = remote?.savedAt ? Date.parse(remote.savedAt) : null;
    const baseAt = local.baseSavedAt ? Date.parse(local.baseSavedAt) : null;
    const unchanged = remoteAt == null
      ? true
      : baseAt != null && Number.isFinite(baseAt) && Number.isFinite(remoteAt) && remoteAt <= baseAt;
    if (!unchanged) { keepServer.push(q); continue; }
    if (remote && remote.value === local.value) { same.push(q); continue; }
    resend.push({ q, value: local.value });
  }
  return { resend, keepServer, drop: [...keepServer, ...same], clear: resend.length === 0 };
}

/**
 * Drop answers the server has acknowledged (or that the server version
 * replaced); remove the record when nothing is left.
 * @param {Storage | null | undefined} storage
 * @param {LocalCopyScope & { questions: (string | number)[], now?: number }} input
 */
export function removeAckedFromCopy(storage, { surface, ownerKey, attemptKey, questions, now = Date.now() }) {
  const scope = { surface, ownerKey, attemptKey };
  const copy = readLocalCopy(storage, { ...scope, now });
  if (!copy || !storage) return;
  try {
    for (const q of questions) delete copy.answers[String(q)];
    if (!Object.keys(copy.answers).length) storage.removeItem(localCopyKey(scope));
    else storage.setItem(localCopyKey(scope), JSON.stringify(copy));
  } catch { /* storage unavailable */ }
}

/** Submitted, abandoned or closed. @param {Storage | null | undefined} storage @param {LocalCopyScope} scope */
export function clearLocalCopy(storage, scope) {
  if (!storage || !validScope(scope)) return;
  try { storage.removeItem(localCopyKey(scope)); } catch { /* storage unavailable */ }
}

/** @param {Storage} storage @param {(scope: LocalCopyScope) => boolean} match */
function removeWhere(storage, match) {
  const doomed = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const scope = key ? parseLocalCopyKey(key) : null;
      if (key && (scope ? match(scope) : key.startsWith(PREFIX))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    return 0;
  }
  return doomed.length;
}

/**
 * Sign-out: remove every copy of that account.
 * @param {Storage | null | undefined} storage
 * @param {string} ownerKey
 */
export function clearOwnerLocalCopies(storage, ownerKey) {
  if (!storage || !ownerKey) return 0;
  return removeWhere(storage, (scope) => scope.ownerKey === ownerKey);
}

/**
 * Another account signed in: remove every copy whose owner differs, decided
 * from the key alone, without reading the content. Unparseable keys go too.
 * @param {Storage | null | undefined} storage
 * @param {string} currentOwnerKey
 */
export function clearForeignLocalCopies(storage, currentOwnerKey) {
  if (!storage || !currentOwnerKey) return 0;
  return removeWhere(storage, (scope) => scope.ownerKey !== currentOwnerKey);
}
