'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type BandValue = number | string | null;

interface WritingTask {
  task?: string | null;
  state?: string | null;
  essay_id?: string | null;
  word_count?: number | null;
  min_words?: number | null;
}

interface LrSkill {
  skill?: string | null;
  state?: string | null;
  score?: number | null;
  max?: number | null;
}

interface MockResultPayload {
  final_bands?: Record<string, BandValue>;
  examiner_comment_vi?: string | null;
  per_skill_notes?: Record<string, unknown>;
  released_at?: string | null;
  listening_attempt_id?: string | null;
  reading_attempt_id?: string | null;
  writing_tasks?: WritingTask[];
  lr_skills?: LrSkill[];
  retest_flags?: Record<string, boolean>;
}

interface KeyedState<T> {
  key: string;
  value: T;
}

interface ReviewCard {
  icon: string;
  title: string;
  hint: string;
  href: string;
}

const SKILLS = [
  { key: 'listening', label: 'Listening' },
  { key: 'reading', label: 'Reading' },
  { key: 'writing', label: 'Writing' },
  { key: 'speaking', label: 'Speaking' },
] as const;

const SKILL_LABELS: Record<string, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

const TASK_LABELS: Record<string, string> = {
  task1: 'Task 1',
  task2: 'Task 2',
};

function textOf(value: unknown) {
  return String(value == null ? '' : value);
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function statusOf(caught: unknown) {
  if (!caught || typeof caught !== 'object' || !('status' in caught)) return null;
  return Number((caught as { status?: unknown }).status);
}

function isAbort(caught: unknown) {
  return caught instanceof DOMException && caught.name === 'AbortError';
}

function isPending(caught: unknown) {
  return statusOf(caught) === 403 || /chờ giám khảo|403/.test(messageOf(caught));
}

function fmtBand(value: BandValue | undefined) {
  return value == null || value === '' ? '—' : Number(value).toFixed(1);
}

function bandPercent(value: BandValue | undefined) {
  if (value == null || value === '') return 0;
  return Math.round(Math.min(9, Math.max(0, Number(value))) / 9 * 100);
}

function taskLabel(task: WritingTask) {
  const key = textOf(task.task);
  return TASK_LABELS[key] || key;
}

function RetestNotice({ flags }: { flags: Record<string, boolean> }) {
  const skills = Object.keys(SKILL_LABELS).filter((skill) => flags[skill]);
  if (!skills.length) return null;

  return (
    <section className="trf-section">
      <div className="trf-retest">
        <span className="trf-retest__icon" aria-hidden="true">↻</span>
        <span className="trf-retest__body">
          <span className="trf-retest__title">
            Giám khảo yêu cầu thi lại: {skills.map((skill) => SKILL_LABELS[skill]).join(', ')}
          </span>
          <span className="trf-retest__detail">
            Kết quả dưới đây vẫn là kết quả của lần thi này. Liên hệ lớp/trung tâm để sắp lịch thi lại phần được yêu cầu.
          </span>
        </span>
      </div>
    </section>
  );
}

function Notes({ notes }: { notes: Record<string, unknown> }) {
  const speaking = notes.speaking && typeof notes.speaking === 'object';
  const keys = Object.keys(notes).filter((key) => (
    Boolean(notes[key]) && !(key === 'speaking' && speaking)
  ));
  if (!keys.length) return null;

  return (
    <section className="trf-section">
      <h2 className="trf-h2">Ghi chú từng kỹ năng</h2>
      {keys.map((key) => (
        <div className="trf-note" key={key}>
          <div className="trf-note__skill">{key}</div>
          <div className="trf-note__body">{textOf(notes[key])}</div>
        </div>
      ))}
    </section>
  );
}

function ReviewLinks({ data, sittingId }: {
  data: MockResultPayload;
  sittingId: string;
}) {
  const notes = data.per_skill_notes || {};
  const speaking = Boolean(notes.speaking && typeof notes.speaking === 'object');
  const mockOrigin = `&from=mock&sitting=${encodeURIComponent(sittingId)}`;
  const cards: ReviewCard[] = [];

  if (data.listening_attempt_id) {
    cards.push({
      icon: '🎧',
      title: 'Chữa bài Listening',
      hint: 'Xem lại từng câu + transcript',
      href: `/listening/review?attempt_id=${encodeURIComponent(data.listening_attempt_id)}${mockOrigin}`,
    });
  }
  if (data.reading_attempt_id) {
    cards.push({
      icon: '📖',
      title: 'Chữa bài Reading',
      hint: 'Xem lại từng câu + bài đọc',
      href: `/reading/review?attempt_id=${encodeURIComponent(data.reading_attempt_id)}${mockOrigin}`,
    });
  }
  (data.writing_tasks || []).forEach((task) => {
    if (task.state === 'delivered' && task.essay_id) {
      cards.push({
        icon: '✍️',
        title: `Nhận xét Writing ${taskLabel(task)}`,
        hint: 'Chữa bài chi tiết',
        href: `/pages/writing-result.html?id=${encodeURIComponent(task.essay_id)}`,
      });
    }
  });
  if (speaking) {
    cards.push({
      icon: '🎙',
      title: 'Nhận xét Speaking',
      hint: 'Thi trực tiếp — band 4 tiêu chí + cách luyện',
      href: `/speaking/result?sitting=${encodeURIComponent(sittingId)}`,
    });
  }
  if (!cards.length) return null;

  return (
    <section className="trf-section">
      <h2 className="trf-h2">Xem chữa bài chi tiết</h2>
      <div className="trf-review-grid">
        {cards.map((card) => (
          <a
            className="trf-review"
            href={card.href}
            key={`${card.title}:${card.href}`}
            rel="noopener"
            target="_blank"
          >
            <span className="trf-review__icon" aria-hidden="true">{card.icon}</span>
            <span className="trf-review__body">
              <span className="trf-review__title">{card.title}</span>
              <span className="trf-review__hint">{card.hint}</span>
            </span>
            <span className="trf-review__arrow" aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function LrGaps({ skills, finalBands }: {
  skills: LrSkill[];
  finalBands: Record<string, BandValue>;
}) {
  const gaps = skills.filter((skill) => (
    skill.state !== 'scored' && finalBands[textOf(skill.skill)] == null
  ));
  if (!gaps.length) return null;

  return (
    <section className="trf-section">
      <h2 className="trf-h2">Kỹ năng chưa có band</h2>
      {gaps.map((skill, index) => {
        const key = textOf(skill.skill);
        const label = SKILL_LABELS[key] || key;
        let why: string;
        let detail: string;
        if (skill.state === 'no_attempt') {
          why = 'Không nhận được bài làm';
          detail = `Hệ thống không nhận được bài ${label} của bạn.`;
        } else if (skill.state === 'no_answers') {
          why = 'Không có đáp án';
          detail = `Bài ${label} đã nộp nhưng không có câu trả lời nào, nên không chấm được.`;
        } else {
          why = 'Không có band';
          detail = `Bạn đúng ${skill.score == null ? 0 : skill.score}/${skill.max || 40} câu — dưới mức thấp nhất của bảng quy đổi band IELTS, nên không có band cho phần này.`;
        }
        return (
          <div className="trf-gap" key={`${key}:${skill.state || 'gap'}:${index}`}>
            <span className="trf-gap__icon" aria-hidden="true">⚠</span>
            <span className="trf-gap__body">
              <span className="trf-gap__title">{label} — {why}</span>
              <span className="trf-gap__detail">{detail}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function WritingGaps({ tasks }: { tasks: WritingTask[] }) {
  const gaps = tasks.filter((task) => task.state !== 'delivered');
  if (!gaps.length) return null;

  return (
    <section className="trf-section">
      <h2 className="trf-h2">Phần Writing chưa có nhận xét</h2>
      {gaps.map((task, index) => {
        const label = taskLabel(task);
        let why: string;
        let detail: string;
        if (task.state === 'too_short') {
          why = 'Bài không đạt yêu cầu';
          detail = `Bài viết chỉ có ${task.word_count == null ? 0 : task.word_count} từ, dưới mức tối thiểu ${textOf(task.min_words)} từ của IELTS ${label} — nên không chấm được.`;
        } else if (task.state === 'missing') {
          why = 'Không có bài nộp';
          detail = `Bạn chưa nộp bài cho ${label}.`;
        } else {
          why = 'Chưa có nhận xét';
          detail = `Bài ${label} chưa được chấm xong nên chưa có phần chữa bài.`;
        }
        return (
          <div className="trf-gap" key={`${textOf(task.task)}:${task.state || 'gap'}:${index}`}>
            <span className="trf-gap__icon" aria-hidden="true">⚠</span>
            <span className="trf-gap__body">
              <span className="trf-gap__title">{label} — {why}</span>
              <span className="trf-gap__detail">{detail}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function ResultContent({ data, sittingId }: {
  data: MockResultPayload;
  sittingId: string;
}) {
  const finalBands = data.final_bands || {};
  const scored = SKILLS.filter((skill) => finalBands[skill.key] != null);
  const displayed = scored.length ? scored : SKILLS;
  const overall = finalBands.overall;
  const overallDegrees = overall == null || overall === ''
    ? 0
    : Math.min(9, Math.max(0, Number(overall))) / 9 * 360;
  const ringStyle = overall == null ? undefined : {
    background: `conic-gradient(var(--av-primary) ${overallDegrees}deg, var(--av-border-subtle) 0)`,
  };
  const releasedAt = data.released_at
    ? `Công bố lúc ${new Date(data.released_at).toLocaleString('vi-VN')}`
    : '';

  return (
    <div className="trf-wrap">
      <a className="trf-back" href="/home"><span aria-hidden="true">←</span> Trang chủ</a>

      <section className="trf-card" id="overall">
        <div className="trf-card__head">
          <div>
            <div className="trf-eyebrow">Phiếu kết quả thi thử · TRF</div>
            <h1 className="trf-h1">Kết quả bài thi thử của em</h1>
          </div>
          <p className="trf-stamp">{releasedAt}</p>
        </div>
        <div className="trf-card__body">
          <div className="trf-ring" role="img" aria-label={`Overall ${fmtBand(overall)}`} style={ringStyle}>
            <div><div><b>{fmtBand(overall)}</b><span>Overall</span></div></div>
          </div>
          <div className="trf-skills">
            {displayed.map((skill) => {
              const value = finalBands[skill.key];
              return (
                <div className={`trf-sk${value == null ? ' trf-sk--empty' : ''}`} key={skill.key}>
                  <span className="trf-sk__name">{skill.label}</span>
                  <span className="trf-sk__bar" aria-hidden="true">
                    <i style={{ width: `${bandPercent(value)}%` }} />
                  </span>
                  <span className="trf-sk__val">{fmtBand(value)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="trf-card__foot">
          <span>{scored.length ? `${scored.length} kỹ năng đã chấm` : ''}</span> · thang IELTS 0–9, giám khảo xác nhận từng kỹ năng
        </div>
      </section>

      <RetestNotice flags={data.retest_flags || {}} />

      {data.examiner_comment_vi ? (
        <section className="trf-section">
          <h2 className="trf-h2">Nhận xét của giám khảo</h2>
          <div className="trf-box">{data.examiner_comment_vi}</div>
        </section>
      ) : null}

      <Notes notes={data.per_skill_notes || {}} />
      <ReviewLinks data={data} sittingId={sittingId} />
      <LrGaps skills={data.lr_skills || []} finalBands={finalBands} />
      <WritingGaps tasks={data.writing_tasks || []} />

      <p className="trf-foot">Kết quả do giám khảo duyệt, có tham khảo phân tích AI.</p>
    </div>
  );
}

export function MockResultLoading() {
  return (
    <div className="trf-wrap">
      <div className="trf-state" style={{ color: 'var(--av-text-secondary)' }}>Đang tải kết quả…</div>
    </div>
  );
}

export function MockResultBehavior() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const sittingId = searchParams?.get('sitting')?.trim() || '';
  const requestKey = status === 'signed-in' && user?.id
    ? `${user.id}:${sittingId}`
    : null;
  const [resultState, setResultState] = useState<KeyedState<MockResultPayload> | null>(null);
  const [errorState, setErrorState] = useState<KeyedState<string> | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const result = resultState?.key === requestKey ? resultState.value : null;
  const error = errorState?.key === requestKey ? errorState.value : null;
  const pending = pendingKey === requestKey;

  useEffect(() => {
    if (status === 'signed-out') {
      setResultState(null);
      setErrorState(null);
      setPendingKey(null);
      window.location.replace('/login');
    }
  }, [status]);

  useEffect(() => {
    if (!requestKey) return;

    const controller = new AbortController();
    let disposed = false;
    setResultState(null);
    setErrorState(null);
    setPendingKey(null);

    if (!sittingId) {
      setErrorState({ key: requestKey, value: 'Thiếu mã sitting.' });
      return () => controller.abort();
    }

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (mock result)',
      );
      if (!ready || disposed) {
        if (!disposed) setErrorState({
          key: requestKey,
          value: 'Không tải được thành phần kết nối. Hãy tải lại trang.',
        });
        return;
      }

      try {
        const payload = await window.api.getWith<MockResultPayload>(
          `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/result`,
          undefined,
          { signal: controller.signal },
        );
        if (!disposed) setResultState({ key: requestKey, value: payload });
      } catch (caught: unknown) {
        if (disposed || isAbort(caught)) return;
        if (isPending(caught)) {
          setPendingKey(requestKey);
        } else {
          setErrorState({
            key: requestKey,
            value: `Không tải được kết quả: ${messageOf(caught)}`,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [requestKey, sittingId]);

  if (pending) {
    return (
      <div className="trf-wrap">
        <div className="trf-state">
          <h1>Đang chờ giám khảo duyệt</h1>
          <p>
            Bài của em đã được ghi nhận. Giám khảo sẽ chấm và công bố kết quả trong thời gian cam kết — em sẽ thấy điểm và phần chữa bài tại đây ngay khi có.
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="trf-wrap"><div className="trf-state trf-state--error">{error}</div></div>;
  }
  if (result) return <ResultContent data={result} sittingId={sittingId} />;
  return <MockResultLoading />;
}
