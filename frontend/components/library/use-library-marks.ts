'use client';

// LIBRARY-0061 T016 (G06-T16, FR-060, FR-061): the signed-in learner's
// "Đã đọc" / "Đã lưu" marks on one Library shelf, kept on the server.
//
// Not optimistic (spec "lỗi ghi → giao diện trả lại trạng thái cũ và báo bằng
// chữ"): after the server answered 204 the shelf is read again and the screen
// shows what the server holds (canonical truth, AGENTS.md); a failed write
// keeps the old state and says so in words. One write per mark at a time.
// Every read and write belongs to a generation (shelf, sign-in, reload); an
// answer from an older generation changes nothing, and a new generation starts
// with nothing pending. Reads and writes pass `noRedirect`, so an expired
// session on a public page never sends the visitor to /login (FR-001): the
// marks just disappear.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { components } from '@/types/api';

export type LibraryMarkShelf = 'writing_sample' | 'speaking_sample' | 'writing_guide' | 'grammar_article';
export type LibraryMarkKind = components['schemas']['LibraryMark']['kind'];
type MarksResponse = components['schemas']['LibraryMarksResponse'];

/** `idle`: not signed in (no marks, no column). `signed-out`: the session ended while reading. */
export type LibraryMarksStatus = 'idle' | 'loading' | 'ready' | 'error' | 'signed-out';

export const MARKS_LOAD_ERROR = 'Chưa tải được dấu đã đọc, đã lưu của bạn.';
export const MARK_WRITE_ERROR = 'Chưa lưu được thay đổi. Bạn thử lại.';
export const MARK_GONE_ERROR = 'Bài này không còn trong Thư viện.';

const slot = (itemKey: string, kind: LibraryMarkKind) => `${kind}\u0000${itemKey}`;
const statusOf = (error: unknown) => (error && typeof error === 'object' && 'status' in error ? Number((error as { status: unknown }).status) : 0);

export function useLibraryMarks(shelf: LibraryMarkShelf, { signedIn }: { signedIn: boolean }) {
  const [status, setStatus] = useState<LibraryMarksStatus>(signedIn ? 'loading' : 'idle');
  const [marks, setMarks] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const generation = useRef(0);
  // Only the newest read of a generation may set the marks (reads after two
  // quick writes can answer out of order).
  const readSeq = useRef(0);
  const inFlight = useRef<Set<string>>(new Set());

  const fetchMarks = useCallback(async () => {
    const path = `/api/library/me/marks?shelf=${encodeURIComponent(shelf)}`;
    const body = await window.api.getWith<MarksResponse>(path, undefined, { noRedirect: true });
    return new Set((body?.marks ?? []).map((m) => slot(m.item_key, m.kind)));
  }, [shelf]);

  const load = useCallback(() => {
    const mine = ++generation.current;
    const seq = ++readSeq.current;
    inFlight.current = new Set();
    setMarks(new Set());
    setPending(new Set());
    setErrors(new Map());
    if (!signedIn) { setStatus('idle'); return; }
    setStatus('loading');
    fetchMarks().then((next) => {
      if (mine !== generation.current || seq !== readSeq.current) return;
      setMarks(next);
      setStatus('ready');
    }, (error: unknown) => {
      if (mine !== generation.current) return;
      setStatus(statusOf(error) === 401 ? 'signed-out' : 'error');
    });
  }, [fetchMarks, signedIn]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const has = useCallback((itemKey: string, kind: LibraryMarkKind) => marks.has(slot(itemKey, kind)), [marks]);
  const isPending = useCallback((itemKey: string, kind: LibraryMarkKind) => pending.has(slot(itemKey, kind)), [pending]);
  const errorFor = useCallback((itemKey: string, kind: LibraryMarkKind) => errors.get(slot(itemKey, kind)) ?? '', [errors]);

  /**
   * Set (`on`) or clear a mark; resolves true when the server took it. A mark
   * with a write still in flight refuses a second one (false).
   */
  const setMark = useCallback(async (itemKey: string, kind: LibraryMarkKind, on: boolean): Promise<boolean> => {
    const key = slot(itemKey, kind);
    if (status !== 'ready' || inFlight.current.has(key)) return false;
    const mine = generation.current;
    const flight = inFlight.current;
    flight.add(key);
    const current = () => mine === generation.current;
    const done = () => {
      flight.delete(key);
      if (current()) setPending((p) => { const next = new Set(p); next.delete(key); return next; });
    };
    setPending((p) => new Set(p).add(key));
    setErrors((e) => { const next = new Map(e); next.delete(key); return next; });
    const path = `/api/library/me/marks/${shelf}/${kind}`;
    const body = { item_key: itemKey };
    try {
      if (on) await window.api.patchWith(path, body, undefined, { noRedirect: true });
      else await window.api.deleteWith(path, body, undefined, { noRedirect: true });
    } catch (error) {
      if (current()) {
        const code = statusOf(error);
        if (code === 401) { setStatus('signed-out'); setMarks(new Set()); }
        else setErrors((e) => new Map(e).set(key, code === 404 ? MARK_GONE_ERROR : MARK_WRITE_ERROR));
      }
      done();
      return false;
    }
    // The server took it: read the shelf again and show what it holds.
    const seq = ++readSeq.current;
    try {
      const next = await fetchMarks();
      if (current() && seq === readSeq.current) setMarks(next);
    } catch (error) {
      if (current()) {
        if (statusOf(error) === 401) { setStatus('signed-out'); setMarks(new Set()); }
        // The write is confirmed (204) even though the reread failed.
        else if (seq === readSeq.current) setMarks((m) => { const next = new Set(m); if (on) next.add(key); else next.delete(key); return next; });
      }
    }
    done();
    return current();
  }, [fetchMarks, shelf, status]);

  return { status, has, isPending, errorFor, setMark, reload: load };
}
