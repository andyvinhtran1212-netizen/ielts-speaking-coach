'use client';

// EXAMLISTENP-0069 FR-009: the account-bound draft store of the Listening
// practice room. Kept apart from `programme-form-room.tsx` so the runner can
// use it without loading the room (and the av2 tokens it brings) while the
// flag is off (UIBASE-0056 FR-003).
import {
  clearLocalCopy, localCopyExpiry, localCopyKey, readLocalCopy, removeAckedFromCopy, writeLocalCopy,
} from '@/lib/exam-room/local-copy.mjs';
import { LISTENING_PRACTICE_SURFACE } from '@/lib/listening-programme-answer-queue.mjs';

/** Same shape as `createProgrammeAnswerDraftStore`, so the runner's calls stay as they are. */
export interface ProgrammeDraftStore {
  key: string;
  load(): Record<number, string>;
  remember(qNum: number, value: string): void;
  clearIfCurrent(qNum: number, value: string): void;
  clear(): void;
}

export interface ProgrammeLocalCopyStore extends ProgrammeDraftStore {
  /** Writes every given answer with its base and reads it back (FR-009 "on leave"). */
  secure(answers: Record<number, string>): boolean;
}

/** `localStorage`, or null where the browser refuses it. */
export function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/**
 * FR-009: the runner's draft store backed by the EXAMROOM-0066 FR-035 local
 * copy. Every answer is written with `baseValue`, the value the server last
 * acked for that question (or read when the attempt opened; `null` when it had
 * none), so a replay re-sends it only while the server still holds that value.
 */
export function createProgrammeLocalCopyStore(
  storage: Storage | null,
  { ownerKey, attemptId, baseFor, now = () => Date.now() }: { ownerKey: string; attemptId: string; baseFor(qNum: number): string | null; now?: () => number },
): ProgrammeLocalCopyStore {
  const scope = { surface: LISTENING_PRACTICE_SURFACE, ownerKey, attemptKey: attemptId };
  const write = (answers: Record<number, string>) => {
    const at = now();
    const existing = readLocalCopy(storage, { ...scope, now: at });
    return writeLocalCopy(storage, {
      ...scope,
      answers: Object.fromEntries(Object.entries(answers).map(([q, value]) => [q, { value, baseValue: baseFor(Number(q)) }])),
      expiresAt: existing?.expiresAt ?? localCopyExpiry({ now: at }),
      now: at,
    });
  };
  return {
    key: localCopyKey(scope),
    load() {
      const copy = readLocalCopy(storage, { ...scope, now: now() });
      // Programme answers are strings; anything else in the copy is not this runner's.
      return copy ? Object.fromEntries(Object.entries(copy.answers).flatMap(([q, a]) => (typeof a.value === 'string' ? [[Number(q), a.value]] : []))) : {};
    },
    remember(qNum, value) { write({ [qNum]: value }); },
    clearIfCurrent(qNum, value) { removeAckedFromCopy(storage, { ...scope, entries: [{ q: qNum, value }], now: now() }); },
    clear() { clearLocalCopy(storage, scope); },
    secure(answers) { return Object.keys(answers).length === 0 || write(answers); },
  };
}
