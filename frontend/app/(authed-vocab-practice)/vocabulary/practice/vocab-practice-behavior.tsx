'use client';

// Native React behavior cho `/vocabulary/practice`.
// API giữ canonical truth về auth + published scope; component chỉ render danh
// sách trả về và không giữ lại state của tài khoản trước khi auth đổi.
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface VocabBank {
  id: string;
  code?: string | null;
  title?: string | null;
  words_count?: number | null;
}

interface KeyedState<T> {
  key: string;
  value: T;
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

export function VocabPracticeBehavior() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [banksState, setBanksState] = useState<KeyedState<VocabBank[]> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);

  // Không render dữ liệu cũ trong frame giữa lúc account đã đổi và effect kế
  // tiếp chưa chạy.
  const banks = banksState?.key === requestKey ? banksState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setBanksState(null);
      setErrorState(null);
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setBanksState(null);
    setErrorState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (vocabulary practice)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
        });
        return;
      }

      try {
        const payload = await window.api.getWith<VocabBank[]>(
          '/api/quiz/banks?skill_area=vocab',
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) {
          setBanksState({ key: requestKey, value: Array.isArray(payload) ? payload : [] });
        }
      } catch (caught: unknown) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setErrorState({
            key: requestKey,
            value: `Không tải được danh sách bài luyện: ${errorMessage(caught)}`,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey]);

  if (error) return <p className="vp-status is-error">{error}</p>;
  if (!banks) return <p className="vp-status">Đang tải…</p>;

  return (
    <>
      {banks.length ? (
        <div className="modes-grid">
          {banks.map((bank) => {
            const wordsCount = typeof bank.words_count === 'number' && Number.isFinite(bank.words_count)
              ? Math.max(0, bank.words_count)
              : 0;
            return (
              <a
                className="mode-card"
                href={`/quiz?bank=${encodeURIComponent(bank.id)}`}
                key={bank.id}
              >
                <div className="head">
                  <div className="icon" aria-hidden="true">📚</div>
                  <span className="arrow" aria-hidden="true">→</span>
                </div>
                <h3>{bank.title || bank.code || 'Bài luyện'}</h3>
                <p className="lede vp-meta">
                  {bank.code ? <><span className="vp-code">{bank.code}</span> · </> : null}
                  {wordsCount} từ · học tới khi thuộc
                </p>
              </a>
            );
          })}
        </div>
      ) : (
        <p className="vp-status">Chưa có bài luyện nào được mở. Vui lòng quay lại sau.</p>
      )}

      <a className="vp-progress-link" href="/quiz/progress?skill_area=vocab">
        📊 Xem tiến độ của tôi →
      </a>
    </>
  );
}
