'use client';

// LEARNERCORE-0063 amendment 4 (FR-106/FR-107): "Ghi chú của bạn" under each
// question's solution on the review pages' new tree.
//
// The notes of the attempt's test load once, separately from the review
// (a failed read hides the boxes; the review itself still shows). A save
// shows what the server returned, never the typed value (no optimistic
// state); a failed save keeps the typed text and says why at the box.
import { useCallback, useEffect, useId, useState } from 'react';

import { getBrowserJson, patchBrowserJsonAt } from '@/lib/browser-api';
import {
  NOTE_MAX_CHARS,
  normalizeReviewNotes,
  normalizeSavedNote,
  noteLength,
  noteSaveError,
} from '@/lib/review-v2-model.mjs';

type Skill = 'listening' | 'reading';
type StoredNote = { body: string; updatedAt: string | null };
type NotesValue =
  | { status: 'off' | 'loading' | 'failed'; notes: Map<number, StoredNote> }
  | { status: 'ready'; notes: Map<number, StoredNote> };
export type ReviewNotesState = NotesValue & {
  /** Keep what the server returned after a save (null after a delete), so a
   *  card that unmounts (filter, passage) shows it again when it comes back. */
  remember(qNum: number, note: StoredNote | null): void;
};

const EMPTY = new Map<number, StoredNote>();

/** One read per attempt; `enabled` false (old tree, preview, share link) → no request. */
export function useReviewNotes(skill: Skill, attemptId: string | null, enabled: boolean): ReviewNotesState {
  const key = enabled && attemptId ? `${skill}:${attemptId}` : null;
  const [state, setState] = useState<{ key: string; value: NotesValue } | null>(null);

  const remember = useCallback((qNum: number, note: StoredNote | null) => {
    setState((previous) => {
      if (!previous || previous.key !== key || previous.value.status !== 'ready') return previous;
      const notes = new Map(previous.value.notes);
      if (note) notes.set(qNum, note); else notes.delete(qNum);
      return { key: previous.key, value: { status: 'ready', notes } };
    });
  }, [key]);

  useEffect(() => {
    if (!key || !attemptId) return undefined;
    const abort = new AbortController();
    setState({ key, value: { status: 'loading', notes: EMPTY } });
    getBrowserJson('/api/review-notes', new URLSearchParams({ skill, attempt_id: attemptId }), abort.signal,
      { noRedirect: true }).then(
      (raw) => setState({ key, value: { status: 'ready', notes: normalizeReviewNotes(raw) } }),
      (error) => {
        if (abort.signal.aborted) return;
        (window as any).aver?.reportError?.('review notes: load failed', {
          type: 'review_notes_load_failed',
          detail: error instanceof Error ? error.message : String(error ?? ''),
        });
        setState({ key, value: { status: 'failed', notes: EMPTY } });
      },
    );
    return () => abort.abort();
  }, [attemptId, key, skill]);

  if (!key) return { status: 'off', notes: EMPTY, remember };
  return { ...(state && state.key === key ? state.value : { status: 'loading', notes: EMPTY }), remember };
}

/** Cut to the 500 characters the learner sees (code points), so typing stops there. */
function capped(text: string): string {
  const chars = [...text];
  return chars.length > NOTE_MAX_CHARS ? chars.slice(0, NOTE_MAX_CHARS).join('') : text;
}

export function ReviewNote({ skill, attemptId, qNum, stored, loading, onSaved }: {
  skill: Skill;
  attemptId: string;
  qNum: number;
  stored: StoredNote | null;
  loading: boolean;
  /** The server's result after a save or delete (null), for the shared notes. */
  onSaved?(note: StoredNote | null): void;
}) {
  const id = useId();
  const [saved, setSaved] = useState<string>(stored?.body ?? '');
  const [draft, setDraft] = useState<string>(stored?.body ?? '');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'deleted' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // The notes arrive after the review: take them in until the learner types.
  useEffect(() => {
    if (draft === saved) {
      setSaved(stored?.body ?? '');
      setDraft(stored?.body ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.body]);

  const changed = draft.trim() !== saved;
  const count = noteLength(draft);

  async function save() {
    setPhase('saving');
    setMessage('');
    try {
      const raw = await patchBrowserJsonAt('/api/review-notes', '/api/review-notes',
        { skill, attempt_id: attemptId, q_num: qNum, body: draft }, { noRedirect: true });
      const result = normalizeSavedNote(raw, qNum);
      const body = result.body ?? '';
      setSaved(body);
      setDraft(body);
      setPhase(result.body === null ? 'deleted' : 'saved');
      onSaved?.(result.body === null ? null : { body: result.body, updatedAt: result.updatedAt });
    } catch (error) {
      setPhase('error');
      setMessage(noteSaveError(error));
    }
  }

  return (
    <div className="rv-note" data-q={qNum}>
      <label className="rv-note__label" htmlFor={`${id}-body`}>Ghi chú của bạn</label>
      <textarea
        id={`${id}-body`}
        className="rv-note__input"
        value={draft}
        rows={3}
        disabled={loading}
        readOnly={phase === 'saving'}
        aria-busy={phase === 'saving' || undefined}
        placeholder={loading ? 'Đang tải ghi chú…' : 'Ghi lại điều cần nhớ ở câu này, ví dụ từ bạn nghe nhầm.'}
        aria-describedby={`${id}-count ${id}-status`}
        onChange={(event) => {
          setDraft(capped(event.target.value));
          if (phase !== 'saving') setPhase('idle');
        }}
      />
      <div className="rv-note__foot">
        <span id={`${id}-count`} className="rv-note__count">{count}/{NOTE_MAX_CHARS} ký tự</span>
        <button type="button" className="rv-note__save" onClick={save}
          disabled={loading || phase === 'saving' || !changed}>
          {phase === 'saving' ? 'Đang lưu…' : 'Lưu ghi chú'}
        </button>
      </div>
      <p id={`${id}-status`} className={`rv-note__status${phase === 'error' ? ' is-error' : ''}`}
        role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">
        {phase === 'error' ? message
          : phase === 'saved' ? 'Đã lưu ghi chú.'
          : phase === 'deleted' ? 'Đã xoá ghi chú.'
          : saved && !changed ? 'Lưu ô trống để xoá ghi chú.' : ''}
      </p>
    </div>
  );
}
