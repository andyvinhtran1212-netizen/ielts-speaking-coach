'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { getBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetPath, ApiGetJson } from '@/lib/openapi-contract';
import type { components } from '@/types/api';

export type VocabSet = components['schemas']['SetOut'];
export type VocabSession = components['schemas']['SessionOut'];
export type StudyMode = components['schemas']['SessionStart']['mode'];
export const modeLabels: Record<StudyMode, string> = { flashcards: 'Thẻ ghi nhớ', learn: 'Luyện nhớ', cloze: 'Điền từ theo ngữ cảnh', test: 'Kiểm tra' };
export function messageOf(e: unknown) { return e instanceof Error ? e.message : 'Không tải/lưu được dữ liệu. Vui lòng thử lại.'; }

/** A changed account unmounts all private state before starting its next read. */
export function VocabularyAccount({ children }: { children: (key: string) => ReactNode }) {
  const { status, user } = useAuth();
  useEffect(() => { if (status === 'signed-out') window.location.replace('/login'); }, [status]);
  return status === 'signed-in' && user?.id ? <div key={user.id}>{children(user.id)}</div> : <p role="status">Đang xác minh phiên đăng nhập…</p>;
}

export function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

/**
 * U-13 / V-HUB — upper bound for one read, connection wait included. Aborting
 * the fetch alone is not enough: window.api awaits the Supabase token before it
 * calls fetch, so the deadline races the whole read and ends in Retry.
 */
export const VOCAB_READ_TIMEOUT_MS = 15000;
export const VOCAB_READ_TIMEOUT_MESSAGE = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';
export const VOCAB_READ_EMPTY_MESSAGE = 'Không nhận được dữ liệu từ máy chủ. Vui lòng thử lại.';

export function useVocabularyResource<P extends ApiGetPath>(path: P, endpoint: string) {
  const [data, setData] = useState<ApiGetJson<P> | null>(null);
  const [error, setError] = useState('');
  const [revision, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null); setError('');
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error(VOCAB_READ_TIMEOUT_MESSAGE)); controller.abort(); }, VOCAB_READ_TIMEOUT_MS);
    });
    const read = async () => {
      if (!await whenGlobalReady(() => !!window.api?.getWith, 'Vocabulary API')) throw new Error('Không khởi tạo được kết nối. Tải lại trang để thử lại.');
      return dead ? null : getBrowserJsonAt(path, endpoint, controller.signal);
    };
    (async () => {
      try {
        const result = await Promise.race([read(), deadline]);
        if (dead) return;
        // window.api resolves null on a 401 (while it bounces to /login) and on
        // an empty body; neither is data, and null here meant "loading" forever.
        if (result == null) throw new Error(VOCAB_READ_EMPTY_MESSAGE);
        setData(result);
      } catch (e) { if (!dead) setError(messageOf(e)); } finally { clearTimeout(timer); }
    })();
    return () => { dead = true; clearTimeout(timer); controller.abort(); };
  }, [path, endpoint, revision]);
  return { data, error, setData, retry: () => retry(v => v + 1) };
}

export function VocabularyNav({ active }: { active: 'today' | 'sets' | 'review' | 'lookup' }) {
  return <nav className="vs-nav" aria-label="Điều hướng từ vựng">{([
    ['today', 'Học hôm nay'], ['sets', 'Bộ từ'], ['review', 'Ôn tập'], ['lookup', 'Tra cứu'],
  ] as const).map(([id, label]) => <Link key={id} href={`/vocabulary/hub?view=${id}`} aria-current={active === id ? 'page' : undefined}>{label}</Link>)}</nav>;
}

export function VocabError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="vs-notice vs-error" role="alert"><p>{message}</p><button type="button" onClick={retry}>Thử lại</button></div>;
}

export function SetTile({ set, courseNames = [] }: { set: VocabSet; courseNames?: string[] }) {
  const familiar = set.progress?.filter(p => p.familiar).length || 0;
  const recalled = set.progress?.filter(p => p.recall_correct > 0).length || 0;
  return <article className="vs-tile"><p className="vs-eyebrow">{set.library ? 'Thư viện chung' : courseNames.join(' · ') || 'Bộ từ của lớp'}</p>
    <h3><Link href={`/vocabulary/sets/${set.id}`}>{set.title}</Link></h3><p>{set.description || 'Bộ từ do giáo viên chuẩn bị.'}</p>
    <p className="vs-meta">{set.card_ids.length} từ · {familiar} tự đánh giá nhớ · {recalled} đã trả lời đúng</p>
    <Link className="av-button" href={`/vocabulary/sets/${set.id}`}>Mở bộ từ <span aria-hidden="true">→</span></Link></article>;
}
