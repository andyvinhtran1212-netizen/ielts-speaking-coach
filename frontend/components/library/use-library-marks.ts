'use client';

// LIBRARY-0061 T016 (G06-T16, FR-060, FR-061): the signed-in learner's
// "Đã đọc" / "Đã lưu" marks on one Library shelf, kept on the server.
//
// Not optimistic (spec "lỗi ghi → giao diện trả lại trạng thái cũ và báo bằng
// chữ"): a mark changes on screen only after the server answered 204; a failed
// write keeps the old state and says so in words. Reads and writes pass
// `noRedirect`, so an expired session on a public page never sends the visitor
// to /login (FR-001): the marks just disappear.
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

  const load = useCallback(() => {
    const mine = ++generation.current;
    setMarks(new Set());
    setErrors(new Map());
    if (!signedIn) { setStatus('idle'); return; }
    setStatus('loading');
    const path = `/api/library/me/marks?shelf=${encodeURIComponent(shelf)}`;
    window.api.getWith<MarksResponse>(path, undefined, { noRedirect: true }).then((body) => {
      if (mine !== generation.current) return;
      setMarks(new Set((body?.marks ?? []).map((m) => slot(m.item_key, m.kind))));
      setStatus('ready');
    }, (error: unknown) => {
      if (mine !== generation.current) return;
      setStatus(statusOf(error) === 401 ? 'signed-out' : 'error');
    });
  }, [shelf, signedIn]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const has = useCallback((itemKey: string, kind: LibraryMarkKind) => marks.has(slot(itemKey, kind)), [marks]);
  const isPending = useCallback((itemKey: string, kind: LibraryMarkKind) => pending.has(slot(itemKey, kind)), [pending]);
  const errorFor = useCallback((itemKey: string, kind: LibraryMarkKind) => errors.get(slot(itemKey, kind)) ?? '', [errors]);

  /** Set (`on`) or clear a mark; resolves true when the server took it. */
  const setMark = useCallback(async (itemKey: string, kind: LibraryMarkKind, on: boolean): Promise<boolean> => {
    if (status !== 'ready') return false;
    const key = slot(itemKey, kind);
    const mine = generation.current;
    setPending((p) => new Set(p).add(key));
    setErrors((e) => { const next = new Map(e); next.delete(key); return next; });
    const path = `/api/library/me/marks/${shelf}/${kind}`;
    const body = { item_key: itemKey };
    try {
      if (on) await window.api.patchWith(path, body, undefined, { noRedirect: true });
      else await window.api.deleteWith(path, body, undefined, { noRedirect: true });
      if (mine !== generation.current) return false;
      setMarks((m) => { const next = new Set(m); if (on) next.add(key); else next.delete(key); return next; });
      return true;
    } catch (error) {
      if (mine !== generation.current) return false;
      const code = statusOf(error);
      if (code === 401) { setStatus('signed-out'); setMarks(new Set()); return false; }
      setErrors((e) => new Map(e).set(key, code === 404 ? MARK_GONE_ERROR : MARK_WRITE_ERROR));
      return false;
    } finally {
      if (mine === generation.current) setPending((p) => { const next = new Set(p); next.delete(key); return next; });
    }
  }, [shelf, status]);

  return { status, has, isPending, errorFor, setMark, reload: load };
}
