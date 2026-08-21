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

interface VocabBankProgress {
  bank_id: string;
  words_count?: number | null;
  mastered?: number | null;
  in_progress?: number | null;
}

interface VocabProgressPayload {
  banks?: VocabBankProgress[];
}

interface KeyedState<T> {
  key: string;
  value: T;
}

function nonNegativeNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function VocabPracticeBehavior() {
  const { status, user } = useAuth();
  const requestKey = status === 'signed-in' && user?.id ? user.id : null;
  const [banksState, setBanksState] = useState<KeyedState<VocabBank[]> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);
  const [progressState, setProgressState] = useState<KeyedState<Map<string, VocabBankProgress>> | null>(null);
  const [progressErrorState, setProgressErrorState] = useState<KeyedState<boolean> | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  // Không render dữ liệu cũ trong frame giữa lúc account đã đổi và effect kế
  // tiếp chưa chạy.
  const banks = banksState?.key === requestKey ? banksState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;
  const progress = progressState?.key === requestKey ? progressState.value : null;
  const progressError = progressErrorState?.key === requestKey
    ? progressErrorState.value : false;

  useEffect(() => {
    if (status === 'signed-out') {
      setBanksState(null);
      setErrorState(null);
      setProgressState(null);
      setProgressErrorState(null);
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setBanksState(null);
    setErrorState(null);
    setProgressState(null);
    setProgressErrorState(null);

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

      const [banksResult, progressResult] = await Promise.allSettled([
        window.api.getWith<VocabBank[]>(
          '/api/quiz/banks?skill_area=vocab', undefined, { signal: controller.signal },
        ),
        window.api.getWith<VocabProgressPayload>(
          '/api/quiz/progress?skill_area=vocab', undefined, { signal: controller.signal },
        ),
      ]);
      if (disposed) return;

      if (banksResult.status === 'rejected') {
        const caught = banksResult.reason;
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setErrorState({
            key: requestKey,
            value: 'Không tải được danh sách bài luyện. Vui lòng thử lại.',
          });
        }
        return;
      }

      setBanksState({
        key: requestKey,
        value: Array.isArray(banksResult.value) ? banksResult.value : [],
      });
      if (progressResult.status === 'fulfilled') {
        const rows = Array.isArray(progressResult.value?.banks)
          ? progressResult.value.banks : [];
        setProgressState({
          key: requestKey,
          value: new Map(rows.filter((row) => row?.bank_id).map((row) => [row.bank_id, row])),
        });
        setProgressErrorState({ key: requestKey, value: false });
      } else if (!(progressResult.reason instanceof DOMException
          && progressResult.reason.name === 'AbortError')) {
        // Tiến độ là enrichment: lỗi ở đây không được biến cả kho bài thành lỗi.
        setProgressErrorState({ key: requestKey, value: true });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, reloadVersion]);

  if (error) return (
    <div className="vp-state is-error" role="alert">
      <span className="vp-state__mark" aria-hidden="true">!</span>
      <div><strong>Chưa tải được kho bài</strong><p>{error}</p></div>
      <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>
        Thử lại
      </button>
    </div>
  );
  if (!banks) return (
    <div className="vp-state" role="status">
      <span className="vp-loader" aria-hidden="true" />
      <div><strong>Đang chuẩn bị bài luyện</strong><p>Đang đồng bộ danh sách và tiến độ của bạn…</p></div>
    </div>
  );

  const aggregate = banks.reduce((result, bank) => {
    const bankProgress = progress?.get(bank.id);
    result.mastered += nonNegativeNumber(bankProgress?.mastered);
    result.inProgress += nonNegativeNumber(bankProgress?.in_progress);
    return result;
  }, { mastered: 0, inProgress: 0 });

  return (
    <>
      <section className="vp-summary" aria-label="Tổng quan tiến độ">
        <div><span>Bộ bài đang mở</span><strong>{banks.length}</strong></div>
        <div><span>Từ đã thuộc</span><strong>{progress ? aggregate.mastered : '—'}</strong></div>
        <div><span>Đang ghi nhớ</span><strong>{progress ? aggregate.inProgress : '—'}</strong></div>
      </section>

      <div className="vp-library-head">
        <div>
          <p className="vp-eyebrow">Kho bài của bạn</p>
          <h2>Chọn bộ từ để luyện tiếp</h2>
        </div>
        <span>{banks.length} bộ bài</span>
      </div>

      {banks.length ? (
        <div className="vp-bank-grid">
          {banks.map((bank) => {
            const wordsCount = typeof bank.words_count === 'number' && Number.isFinite(bank.words_count)
              ? Math.max(0, bank.words_count)
              : 0;
            const bankProgress = progress?.get(bank.id);
            const mastered = nonNegativeNumber(bankProgress?.mastered);
            const tracked = nonNegativeNumber(bankProgress?.in_progress);
            const total = Math.max(
              wordsCount,
              nonNegativeNumber(bankProgress?.words_count),
              mastered + tracked,
            );
            const percent = total ? Math.min(100, Math.round(mastered / total * 100)) : 0;
            const state = total > 0 && mastered >= total
              ? 'Đã thuộc'
              : mastered + tracked > 0 ? 'Đang học' : 'Chưa bắt đầu';
            return (
              <a
                className="vp-bank"
                href={`/quiz?bank=${encodeURIComponent(bank.id)}`}
                key={bank.id}
              >
                <div className="vp-bank__head">
                  <span className={`vp-bank__state${state === 'Đã thuộc' ? ' is-done' : state === 'Đang học' ? ' is-active' : ''}`}>
                    {state}
                  </span>
                  <span className="vp-bank__arrow" aria-hidden="true">→</span>
                </div>
                <h3>{bank.title || bank.code || 'Bài luyện'}</h3>
                <p className="vp-meta">
                  {bank.code ? <span className="vp-code">{bank.code}</span> : null}
                  <span>{wordsCount} từ</span>
                </p>
                {progressError ? (
                  <p className="vp-bank-progress is-unavailable">Chưa đọc được tiến độ</p>
                ) : progress ? (
                  <div className="vp-bank-progress">
                    <div className="vp-bank-progress__row">
                      <span>Đã thuộc {mastered}/{total}</span><strong>{percent}%</strong>
                    </div>
                    <span
                      className="vp-bank-progress__track"
                      role="progressbar"
                      aria-label={`Tiến độ ${bank.title || bank.code || 'bài luyện'}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  </div>
                ) : null}
                <span className="vp-bank__cta">{state === 'Chưa bắt đầu' ? 'Bắt đầu luyện' : 'Luyện tiếp'}</span>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="vp-state">
          <span className="vp-state__mark" aria-hidden="true">0</span>
          <div><strong>Chưa có bài luyện được mở</strong><p>Quay lại sau khi giáo viên xuất bản bộ từ mới.</p></div>
        </div>
      )}

      {progressError && banks.length > 0 ? (
        <p className="vp-progress-warning" role="status">
          Danh sách bài vẫn dùng được, nhưng tiến độ từng bài chưa đồng bộ.
        </p>
      ) : null}

      <a className="vp-progress-link" href="/quiz/progress?skill_area=vocab">
        <span>Xem câu cần ôn và lịch sử luyện tập</span><span aria-hidden="true">→</span>
      </a>
    </>
  );
}
