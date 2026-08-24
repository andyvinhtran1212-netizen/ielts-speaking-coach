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
import { parseCourseExplanation } from '../../../../public/js/course-explanation-format.js';

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

type ExplanationBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'lead'; text: string }
  | { kind: 'unordered-list'; items: string[]; legacy?: boolean }
  | { kind: 'ordered-list'; items: string[] };

// Explanation và prompt có contract khác nhau: prompt hỗ trợ chỗ trống,
// explanation hỗ trợ block/list nhưng không nhận HTML. React escape toàn bộ
// text; parser chung chỉ quyết định cấu trúc và giữ **nhãn** dưới dạng data.
function ExplanationInline({ value }: { value: string }) {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index): ReactNode => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong className="course-explain__emphasis" key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function ExplanationBlocks({ value }: { value: string }) {
  const blocks = parseCourseExplanation(value) as ExplanationBlock[];
  return (
    <div className="course-explain">
      {blocks.map((block, index) => {
        if (block.kind === 'ordered-list') {
          return (
            <ol className="course-explain__list" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}><ExplanationInline value={item} /></li>
              ))}
            </ol>
          );
        }
        if (block.kind === 'unordered-list') {
          const className = `course-explain__list${block.legacy ? ' course-explain__list--legacy' : ''}`;
          return (
            <ul className={className} key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}><ExplanationInline value={item} /></li>
              ))}
            </ul>
          );
        }
        const className = block.kind === 'lead'
          ? 'course-explain__lead' : 'course-explain__paragraph';
        return (
          <p className={className} key={index}><ExplanationInline value={block.text} /></p>
        );
      })}
    </div>
  );
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
        <div className="pg-mk__hint"><strong>Gợi ý</strong><span><FormattedText value={question.hint} /></span></div>
      ) : null}
      <div className="pg-mk__row">
        Bạn trả lời:{' '}
        <span className="pg-mk__ans is-wrong">
          <FormattedText value={question.your_answer} />
        </span>{' '}<span className="pg-mk__wrong-label">Chưa đúng</span>
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
        <div className="pg-mk__explain"><ExplanationBlocks value={question.explain} /></div>
      ) : null}
      {articleUrl ? (
        <div className="pg-mk__row">
          <a href={articleUrl} target="_blank" rel="noopener noreferrer">Ôn lại bài <span aria-hidden="true">→</span></a>
        </div>
      ) : null}
    </div>
  );
}

function MistakesSection({ data, error, onRetry }: {
  data: MistakesPayload | null;
  error: string | null;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  if (error) return (
    <div className="pg-state is-error" role="alert">
      <div><strong>Chưa tải được câu cần ôn</strong><p>Phần tổng quan vẫn dùng được. Hãy thử tải riêng danh sách này.</p></div>
      <button type="button" onClick={onRetry}>Thử lại</button>
    </div>
  );
  if (!data) return <p className="pg-empty">Đang tải câu trả lời sai…</p>;

  const items = data.items || [];
  if (!items.length) {
    return <div className="pg-state"><div><strong>Chưa có câu nào cần ôn</strong><p>Làm một bài luyện để bắt đầu xây lịch sử học tập.</p></div></div>;
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
                {fixed ? 'Đã thuộc · ' : ''}{item.questions.length} câu sai · {isOpen ? 'Thu gọn' : 'Mở'}
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
      <nav className="pg-jump" aria-label="Nội dung thống kê">
        <a href="#tong-quan">Tổng quan</a>
        <a href="#can-on">Cần ôn</a>
        <a href="#lich-su">Lịch sử</a>
      </nav>

      <section className="pg-section" id="tong-quan">
        <div className="pg-section__head">
          <div><p>Tổng quan</p><h2>Nhịp học của bạn</h2></div>
          <span>Dữ liệu toàn thời gian</span>
        </div>
        <div className="pg-stats">
          <StatCard label="Tổng thời gian">{formatDuration(totals.time_sec)}</StatCard>
          <StatCard label="Số phiên">{totals.sessions || 0}</StatCard>
          <StatCard label="Từ đã thuộc">{totals.words_mastered || 0}<small>từ</small></StatCard>
          <StatCard label="Độ chính xác TB">{formatPercent(totals.avg_accuracy)}</StatCard>
        </div>

        <h3 className="pg-h3">Tiến độ theo bộ</h3>
        <div className="pg-bank-list">
          {banks.length ? banks.map((bank) => {
            const total = bank.words_count || bank.mastered + bank.in_progress || 0;
            const width = total ? Math.round(bank.mastered / total * 100) : 0;
            return (
              <div className="pg-bank" key={bank.bank_id}>
                <div className="pg-bank__row">
                  <span className="pg-bank__name">
                    {bank.code || ''}{' '}
                    <span className="pg-bank__meta">{bank.title || ''}</span>
                  </span>
                  <span className="pg-bank__meta">Đã thuộc {bank.mastered}/{total}</span>
                </div>
                <div className="pg-track" role="progressbar" aria-label={`Tiến độ ${bank.code || bank.title || 'bộ bài'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width}>
                  <div className="pg-bar" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          }) : <p className="pg-empty">Chưa có dữ liệu. Hãy làm một bài luyện nhanh để bắt đầu.</p>}
        </div>
      </section>

      {children}

      <section className="pg-section" id="lich-su">
        <div className="pg-section__head">
          <div><p>Lịch sử</p><h2>Phiên gần đây</h2></div>
          <span>{sessions.length} phiên hiển thị</span>
        </div>
        {sessions.length ? (
          <div className="pg-sess-wrap">
            <table className="pg-sess">
              <thead><tr><th>Bộ</th><th>Chính xác</th><th>Đã thuộc</th><th>Thời gian</th><th>Kết thúc</th></tr></thead>
              <tbody>
                {sessions.map((session, index) => (
                  <tr key={`${session.ended_at || 'session'}:${index}`}>
                    <td data-label="Bộ">{session.code || '—'}</td>
                    <td data-label="Chính xác">{formatPercent(session.accuracy)}</td>
                    <td data-label="Đã thuộc">{session.words_mastered || 0}</td>
                    <td data-label="Thời gian">{session.duration_sec ? formatDuration(session.duration_sec) : '—'}</td>
                    <td data-label="Kết thúc">
                      {(session.ended_at || '').slice(0, 10) || '—'}
                      {session.ended_by === 'paused' ? <>{' '}<span className="av-badge av-badge-warning">tạm dừng</span></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pg-empty">Chưa có phiên nào.</p>}
      </section>
    </>
  );
}

function PageFrame({ children, skill }: { children: ReactNode; skill: string }) {
  const grammar = skill === 'grammar';
  return (
    <main className="shell pg-shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href={grammar ? '/grammar' : '/vocabulary/practice'}>
            <span aria-hidden="true">←</span><span>{grammar ? 'Grammar' : 'Luyện tập'}</span>
          </a>
        </div>
      </header>
      <section className="pg-hero">
        <p className="pg-eyebrow">Tiến độ cá nhân</p>
        <h1 className="pg-title">Học đúng phần bạn còn thiếu</h1>
        <p className="pg-sub">Theo dõi nhịp luyện, quay lại câu còn sai và nhìn rõ những gì đã thực sự ghi nhớ.</p>
      </section>
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
  const [reloadVersion, setReloadVersion] = useState(0);
  const [mistakesReloadVersion, setMistakesReloadVersion] = useState(0);

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
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setProgressState(null);
    setProgressErrorState(null);

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

      try {
        const payload = await window.api.getWith<QuizProgressPayload>(
          `/api/quiz/progress${queryFor(skill)}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed || payload == null) return;
        setProgressState({ key: requestKey, value: payload });
      } catch (error: any) {
        if (error?.name !== 'AbortError' && !disposed) {
          setProgressErrorState({
            key: requestKey,
            value: 'Không tải được thống kê. Vui lòng thử lại.',
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, skill, reloadVersion]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setMistakesState(null);
    setMistakesErrorState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (quiz mistakes)',
      );
      if (!ready || disposed) {
        if (!disposed) setMistakesErrorState({ key: requestKey, value: 'load-failed' });
        return;
      }

      // Mistakes là enrichment độc lập: lỗi và retry ở endpoint này không được
      // xoá hoặc refetch phần tổng hợp đã tải thành công.
      try {
        const payload = await window.api.getWith<MistakesPayload>(
          `/api/quiz/mistakes${queryFor(skill)}`,
          undefined,
          { signal: controller.signal },
        );
        if (!disposed && payload != null) setMistakesState({ key: requestKey, value: payload });
      } catch (error: any) {
        if (error?.name !== 'AbortError' && !disposed) {
          setMistakesErrorState({ key: requestKey, value: 'load-failed' });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, skill, mistakesReloadVersion]);

  return (
    <PageFrame skill={skill}>
      {status === 'initial-loading' || (status === 'signed-in' && !progress && !progressError) ? (
        <p className="pg-empty">Đang tải…</p>
      ) : null}
      {progressError ? (
        <div className="pg-state is-error" role="alert">
          <div><strong>Chưa tải được thống kê</strong><p>{progressError}</p></div>
          <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>Thử lại</button>
        </div>
      ) : null}
      {progress ? (
        <ProgressContent progress={progress}>
          <section className="pg-section" id="can-on">
            <div className="pg-section__head">
              <div><p>Cần ôn</p><h2>Câu bạn từng trả lời sai</h2></div>
              <span>Mở từng từ để xem đáp án</span>
            </div>
            <MistakesSection
              key={`${requestKey}:${mistakesReloadVersion}`}
              data={mistakes}
              error={mistakesError}
              onRetry={() => setMistakesReloadVersion((value) => value + 1)}
            />
          </section>
        </ProgressContent>
      ) : null}
    </PageFrame>
  );
}
