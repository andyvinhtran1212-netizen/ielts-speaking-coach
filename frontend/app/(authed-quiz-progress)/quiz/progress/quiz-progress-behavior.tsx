'use client';

// React behavior cho `/quiz/progress`.
//
// Khác với compatibility shell trước đây, component này sở hữu state và vòng
// đời request. Không sửa DOM bằng innerHTML, không chờ DOMContentLoaded và mọi
// request đều bị abort khi logout, đổi tài khoản hoặc rời route.
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

interface ProgressTotals {
  sessions?: number;
  time_sec?: number;
  words_mastered?: number;
  avg_accuracy?: number | null;
}

interface ProgressBank {
  bank_id: string;
  code?: string | null;
  title?: string | null;
  words_count?: number | null;
  mastered: number;
  in_progress: number;
}

interface ProgressSession {
  code?: string | null;
  accuracy?: number | null;
  words_mastered?: number | null;
  duration_sec?: number | null;
  ended_at?: string | null;
  ended_by?: string | null;
}

interface QuizProgressPayload {
  totals?: ProgressTotals;
  banks?: ProgressBank[];
  recent_sessions?: ProgressSession[];
}

interface MistakeQuestion {
  qid: string;
  prompt?: string | null;
  hint?: string | null;
  your_answer?: string | null;
  correct_answer?: string | null;
  explain?: string | null;
  article_url?: string | null;
  wrong_times?: number | null;
}

interface MistakeItem {
  bank_id: string;
  item_key: string;
  code?: string | null;
  status?: string | null;
  questions: MistakeQuestion[];
}

interface MistakesPayload {
  items?: MistakeItem[];
  attempts_scanned?: number;
  capped?: boolean;
}

function queryFor(skill: string) {
  return skill ? `?skill_area=${encodeURIComponent(skill)}` : '';
}

function formatPercent(value?: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function formatDuration(value?: number | null) {
  const seconds = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

// Chỉ hỗ trợ đúng hai quy ước mà player dùng: **đậm** và _____. React tự
// escape mọi chuỗi còn lại nên prompt từ kho nội dung không thể chèn HTML.
function FormattedText({ value }: { value?: string | null }) {
  const parts = String(value ?? '').split(/(\*\*.+?\*\*|_{2,})/g);
  return parts.map((part, index): ReactNode => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^_{2,}$/.test(part)) {
      return <u key={index} aria-label="chỗ trống">&nbsp;&nbsp;&nbsp;</u>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="av-card pg-stat">
      <div className="pg-stat__label">{label}</div>
      <div className="pg-stat__val">{children}</div>
    </div>
  );
}

function safeArticleUrl(value?: string | null) {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function MistakeQuestionView({ question }: { question: MistakeQuestion }) {
  const articleUrl = safeArticleUrl(question.article_url);
  return (
    <div className="pg-mk__q">
      <div className="pg-mk__prompt"><FormattedText value={question.prompt} /></div>
      {question.hint ? (
        <div className="pg-mk__hint">💡 <FormattedText value={question.hint} /></div>
      ) : null}
      <div className="pg-mk__row">
        Bạn trả lời:{' '}
        <span className="pg-mk__ans is-wrong">
          <FormattedText value={question.your_answer} />
        </span>{' '}✗
        {(question.wrong_times || 0) > 1 ? (
          <span className="pg-mk__meta"> (sai {question.wrong_times} lần)</span>
        ) : null}
      </div>
      {question.correct_answer ? (
        <div className="pg-mk__row">
          Đáp án đúng:{' '}
          <span className="pg-mk__ans is-right">
            <FormattedText value={question.correct_answer} />
          </span>
        </div>
      ) : null}
      {question.explain ? (
        <div className="pg-mk__explain"><FormattedText value={question.explain} /></div>
      ) : null}
      {articleUrl ? (
        <div className="pg-mk__row">
          <a href={articleUrl} target="_blank" rel="noopener noreferrer">📖 Ôn lại bài</a>
        </div>
      ) : null}
    </div>
  );
}

function MistakesSection({ data, error }: { data: MistakesPayload | null; error: string | null }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  if (error) return <p className="pg-empty">Không tải được danh sách câu sai: {error}</p>;
  if (!data) return <p className="pg-empty">Đang tải câu trả lời sai…</p>;

  const items = data.items || [];
  if (!items.length) {
    return <p className="pg-empty">🎉 Chưa có câu nào bị sai — hoặc bạn chưa làm bài nào.</p>;
  }

  return (
    <>
      {items.map((item, index) => {
        const isOpen = expanded.has(index);
        const fixed = item.status === 'mastered';
        const bodyId = `pg-mistake-${index}`;
        return (
          <div className="av-card pg-mk" key={`${item.bank_id}:${item.item_key}`}>
            <button
              type="button"
              className="pg-mk__head"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onClick={() => {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                });
              }}
            >
              <span className="pg-mk__word">
                {item.item_key}{' '}
                <span className="pg-mk__meta" style={{ fontWeight: 400 }}>{item.code || ''}</span>
              </span>
              <span className="pg-mk__meta">
                {fixed ? '✓ đã thuộc · ' : ''}{item.questions.length} câu sai {isOpen ? '▴' : '▾'}
              </span>
            </button>
            <div id={bodyId} className={`pg-mk__body${isOpen ? '' : ' hidden'}`}>
              {item.questions.map((question) => (
                <MistakeQuestionView key={question.qid} question={question} />
              ))}
            </div>
          </div>
        );
      })}
      {data.capped ? (
        <p className="pg-cap">Chỉ hiển thị {data.attempts_scanned || 0} câu sai gần nhất.</p>
      ) : null}
    </>
  );
}

function ProgressContent({ progress, children }: {
  progress: QuizProgressPayload;
  children: ReactNode;
}) {
  const totals = progress.totals || {};
  const banks = progress.banks || [];
  const sessions = progress.recent_sessions || [];

  return (
    <>
      <div className="pg-stats">
        <StatCard label="Tổng thời gian">{formatDuration(totals.time_sec)}</StatCard>
        <StatCard label="Số phiên">{totals.sessions || 0}</StatCard>
        <StatCard label="Từ đã thuộc">{totals.words_mastered || 0}<small>từ</small></StatCard>
        <StatCard label="Độ chính xác TB">{formatPercent(totals.avg_accuracy)}</StatCard>
      </div>

      <h2 className="pg-h2">Theo bộ</h2>
      <div>
        {banks.length ? banks.map((bank) => {
          const total = bank.words_count || bank.mastered + bank.in_progress || 0;
          const width = total ? Math.round(bank.mastered / total * 100) : 0;
          return (
            <div className="av-card pg-bank" key={bank.bank_id}>
              <div className="pg-bank__row">
                <span className="pg-bank__name">
                  {bank.code || ''}{' '}
                  <span className="pg-bank__meta" style={{ fontWeight: 400 }}>{bank.title || ''}</span>
                </span>
                <span className="pg-bank__meta">Đã thuộc {bank.mastered}/{total}</span>
              </div>
              <div className="pg-track" role="progressbar" aria-label={`Tiến độ ${bank.code || bank.title || 'bộ bài'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width}>
                <div className="pg-bar" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        }) : <p className="pg-empty">Chưa có dữ liệu. Hãy làm một bài Quick-Check để bắt đầu.</p>}
      </div>

      {children}

      <h2 className="pg-h2">Phiên gần đây</h2>
      <div>
        {sessions.length ? (
          <table className="pg-sess">
            <thead><tr><th>Bộ</th><th>Chính xác</th><th>Đã thuộc</th><th>Thời gian</th><th>Kết thúc</th></tr></thead>
            <tbody>
              {sessions.map((session, index) => (
                <tr key={`${session.ended_at || 'session'}:${index}`}>
                  <td>{session.code || ''}</td>
                  <td>{formatPercent(session.accuracy)}</td>
                  <td>{session.words_mastered || 0}</td>
                  <td>{session.duration_sec ? formatDuration(session.duration_sec) : '—'}</td>
                  <td>
                    {(session.ended_at || '').slice(0, 10)}
                    {session.ended_by === 'paused' ? <>{' '}<span className="av-badge av-badge-warning">tạm dừng</span></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pg-empty">Chưa có phiên nào.</p>}
      </div>
    </>
  );
}

function PageFrame({ children, skill }: { children: ReactNode; skill: string }) {
  const grammar = skill === 'grammar';
  return (
    <main className="av-w-read pg-shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href={grammar ? '/grammar' : '/vocabulary/practice'}>
            <span aria-hidden="true">←</span><span>{grammar ? 'Grammar' : 'Luyện tập'}</span>
          </a>
        </div>
      </header>
      <h1 className="pg-title">📊 Thống kê luyện tập</h1>
      <p className="pg-sub">Tổng hợp kết quả Quick-Check của bạn.</p>
      {children}
    </main>
  );
}

export function QuizProgressLoading() {
  return <PageFrame skill=""><p className="pg-empty">Đang tải…</p></PageFrame>;
}

export function QuizProgressBehavior() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const skill = searchParams?.get('skill_area') || '';
  const requestKey = status === 'signed-in' && user?.id ? `${user.id}:${skill}` : null;
  const [progressState, setProgressState] = useState<{
    key: string; value: QuizProgressPayload;
  } | null>(null);
  const [progressErrorState, setProgressErrorState] = useState<{
    key: string; value: string;
  } | null>(null);
  const [mistakesState, setMistakesState] = useState<{
    key: string; value: MistakesPayload;
  } | null>(null);
  const [mistakesErrorState, setMistakesErrorState] = useState<{
    key: string; value: string;
  } | null>(null);

  // State cũ không được render trong frame giữa lúc account/search param đã
  // đổi nhưng effect mới chưa kịp chạy.
  const progress = progressState?.key === requestKey ? progressState.value : null;
  const progressError = progressErrorState?.key === requestKey
    ? progressErrorState.value : null;
  const mistakes = mistakesState?.key === requestKey ? mistakesState.value : null;
  const mistakesError = mistakesErrorState?.key === requestKey
    ? mistakesErrorState.value : null;

  useEffect(() => {
    if (status === 'signed-out') {
      setProgressState(null);
      setProgressErrorState(null);
      setMistakesState(null);
      setMistakesErrorState(null);
      window.location.replace('/login.html');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setProgressState(null);
    setProgressErrorState(null);
    setMistakesState(null);
    setMistakesErrorState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (quiz progress)',
      );
      if (!ready || disposed) {
        if (!disposed) setProgressErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
        });
        return;
      }

      const query = queryFor(skill);
      try {
        const payload = await window.api.getWith<QuizProgressPayload>(
          `/api/quiz/progress${query}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed || payload == null) return;
        setProgressState({ key: requestKey, value: payload });
      } catch (error: any) {
        if (error?.name !== 'AbortError' && !disposed) {
          setProgressErrorState({ key: requestKey, value: error?.message || String(error) });
        }
        return;
      }

      // Mistakes là enrichment độc lập: lỗi ở endpoint này không được xoá phần
      // tổng hợp đã tải thành công.
      try {
        const payload = await window.api.getWith<MistakesPayload>(
          `/api/quiz/mistakes${query}`,
          undefined,
          { signal: controller.signal },
        );
        if (!disposed && payload != null) setMistakesState({ key: requestKey, value: payload });
      } catch (error: any) {
        if (error?.name !== 'AbortError' && !disposed) {
          setMistakesErrorState({ key: requestKey, value: error?.message || String(error) });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, skill]);

  return (
    <PageFrame skill={skill}>
      {status === 'initial-loading' || (status === 'signed-in' && !progress && !progressError) ? (
        <p className="pg-empty">Đang tải…</p>
      ) : null}
      {progressError ? <p className="pg-err">Không tải được thống kê: {progressError}</p> : null}
      {progress ? (
        <ProgressContent progress={progress}>
          <h2 className="pg-h2">Câu tôi đã trả lời sai</h2>
          <p className="pg-sub">Bấm vào một từ để xem lại câu hỏi, đáp án bạn đã chọn và đáp án đúng.</p>
          <MistakesSection key={requestKey} data={mistakes} error={mistakesError} />
        </ProgressContent>
      ) : null}
    </PageFrame>
  );
}
