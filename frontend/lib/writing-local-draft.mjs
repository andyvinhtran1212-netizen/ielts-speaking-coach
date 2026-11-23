// ENROLL-0060 FR-052 follow-up (R119): a tab-local copy of the Writing text
// that the server has not acknowledged yet.
//
// The assignment editor autosaves to the server 3 s after the last keystroke.
// When another device takes the session, the server refuses this device's
// token, so the last few seconds of typing cannot reach it. This copy keeps
// them in this tab and offers them back when the same account opens the same
// assignment again after signing in.
//
// Rules:
// - Keyed by account and assignment, in sessionStorage (tab-scoped, gone when
//   the tab closes, never read for another account), like the submit receipt.
// - Each copy remembers `base`: the server draft's `updated_at` it was typed
//   on. It is restored only when the server draft is still that version. If
//   the server moved on (the learner kept writing on the other device), the
//   server text stays and the copy is only offered, never applied silently.
// - The copy is dropped once the server acknowledges the same text.
// - Storage failures never throw: the copy is a convenience, not the save.

const PREFIX = 'aver:writing-local-draft:v1:';
export const LOCAL_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LOCAL_DRAFT_MAX_CHARS = 60000;

function key(accountId, assignmentId) {
  return PREFIX + encodeURIComponent(accountId) + ':' + encodeURIComponent(assignmentId);
}

function ids(accountId, assignmentId) {
  return typeof accountId === 'string' && accountId !== ''
    && typeof assignmentId === 'string' && assignmentId !== '';
}

function baseOf(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Keeps `text` as the unsaved copy. Returns false when there is nothing to
 * keep (no ids, blank text, too long, or storage refused).
 */
export function keepLocalDraft(storage, { accountId, assignmentId, text, base, now = Date.now() }) {
  if (!storage || !ids(accountId, assignmentId)) return false;
  if (typeof text !== 'string' || text.trim() === '' || text.length > LOCAL_DRAFT_MAX_CHARS) return false;
  try {
    storage.setItem(key(accountId, assignmentId), JSON.stringify({
      text, base: baseOf(base), savedAt: now,
    }));
    return true;
  } catch {
    return false;
  }
}

/** The unsaved copy, or null when none, malformed or older than a day. */
export function readLocalDraft(storage, accountId, assignmentId, now = Date.now()) {
  if (!storage || !ids(accountId, assignmentId)) return null;
  let raw;
  try { raw = storage.getItem(key(accountId, assignmentId)); } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const valid = parsed && typeof parsed === 'object'
    && typeof parsed.text === 'string' && parsed.text.trim() !== ''
    && typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)
    && now - parsed.savedAt <= LOCAL_DRAFT_MAX_AGE_MS && parsed.savedAt <= now + 60000;
  if (!valid) {
    clearLocalDraft(storage, accountId, assignmentId);
    return null;
  }
  return { text: parsed.text, base: baseOf(parsed.base), savedAt: parsed.savedAt };
}

export function clearLocalDraft(storage, accountId, assignmentId) {
  if (!storage || !ids(accountId, assignmentId)) return;
  try { storage.removeItem(key(accountId, assignmentId)); } catch { /* optional */ }
}

/**
 * Drops the copy only if the server acknowledged exactly its text, so a
 * keystroke typed while the save was in flight is not lost.
 */
export function settleLocalDraft(storage, accountId, assignmentId, savedText) {
  const local = readLocalDraft(storage, accountId, assignmentId);
  if (local && local.text === savedText) clearLocalDraft(storage, accountId, assignmentId);
}

/**
 * What to do with the copy when the editor opens with the server draft.
 *   'none'    → no copy, or it equals the server text (dropped)
 *   'restore' → the server draft is still the version the copy was typed on
 *   'offer'   → the server draft changed since; keep the server text and let
 *               the learner choose the copy
 */
export function localDraftDecision(local, serverText, serverUpdatedAt) {
  if (!local) return 'none';
  const server = typeof serverText === 'string' ? serverText : '';
  if (local.text === server) return 'none';
  return local.base === baseOf(serverUpdatedAt) ? 'restore' : 'offer';
}
