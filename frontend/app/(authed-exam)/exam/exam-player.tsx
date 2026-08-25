'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  answersForSubmit,
  examSourceLabel,
  grammarKnowledgeHref,
  normalizeAttemptAck,
  normalizeExam,
  normalizeExamList,
  normalizeExamReview,
} from '@/lib/exam-player-model.mjs';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'list' | 'exam' | 'result' | 'error';
type SubmitState = 'idle' | 'submitting' | 'reviewing';

const STEP_LABELS: Record<string, string> = {
  locate: 'Định vị thông tin',
  decode_vocab: 'Giải mã từ vựng',
  parse_syntax: 'Phân tích cấu trúc câu',
  eliminate: 'Loại đáp án nhiễu',
  infer: 'Suy luận',
  confirm: 'Chốt đáp án',
};
const KP_ICONS: Record<string, string> = { grammar: '📘', vocab: '📗', skill: '🎯' };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || '');
}

function requestQuery() {
  const params = new URL(window.location.href).searchParams;
  return { id: params.get('id')?.trim() || '', source: params.get('source')?.trim() || '' };
}

function examHref(id: string) {
  return `/exam?id=${encodeURIComponent(id)}`;
}

function Meta({ total, minutes }: { total: number; minutes: number | null }) {
  return <>{total} câu{minutes ? <> · {minutes} phút</> : null}</>;
}

function KnowledgeChips({ refs }: { refs: any[] | undefined }) {
  if (!Array.isArray(refs) || !refs.length) return null;
  return <div className="nx-kp-chips">{refs.filter((ref) => ref?.slug).map((ref, index) => {
    const label = String(ref.title || ref.slug || '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const chip = <span className="nx-kp-chip">{KP_ICONS[ref.type] || '•'} {label}</span>;
    const href = grammarKnowledgeHref(ref);
    return href
      ? <a className="nx-kp-link" href={href} key={`${ref.type}-${ref.slug}-${index}`}>{chip}</a>
      : <span key={`${ref.type}-${ref.slug}-${index}`}>{chip}</span>;
  })}</div>;
}

function Microcheck({ value, refs }: { value: any; refs: any[] | undefined }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const options = Array.isArray(value?.options) ? value.options : [];
  const canonical = String(value?.answer || '');
  if (!value?.prompt || !options.length || !canonical) return null;

  const choose = async (letter: string) => {
    if (answer) return;
    setAnswer(letter);
    if (!Array.isArray(refs) || !refs.length) return;
    try {
      await window.api.post('/api/kp/microcheck-answers', {
        answers: refs.map((kp) => ({ kp, correct: letter === canonical })),
      });
    } catch {
      setSaveFailed(true);
    }
  };

  return <div className="nx-microcheck">
    <p className="nx-microcheck__prompt">🧩 {String(value.prompt)}</p>
    {options.map((option: any, index: number) => {
      const letter = String.fromCharCode(65 + index);
      const selected = answer === letter;
      return <button
        className={`nx-microcheck__option${selected ? (letter === canonical ? ' is-correct' : ' is-incorrect') : ''}`}
        type="button"
        disabled={Boolean(answer)}
        aria-disabled={Boolean(answer)}
        onClick={() => void choose(letter)}
        key={`${letter}-${String(option?.text || option)}`}
      ><b>{letter}.</b> {String(typeof option === 'string' ? option : option?.text || '')}</button>;
    })}
    {answer ? <p className={answer === canonical ? 'nx-microcheck__ok' : 'nx-microcheck__bad'} role="status">
      {answer === canonical ? '✓ Chính xác' : `✗ Chưa đúng — đáp án: ${canonical}`}
      {saveFailed ? ' · Chưa lưu được tiến độ.' : ''}
    </p> : null}
  </div>;
}

function Stepper({ value }: { value: any }) {
  const steps = Array.isArray(value?.steps) ? value.steps : [];
  if (!steps.length) return null;
  const distractors = Array.isArray(value?.distractors) ? value.distractors : [];
  return <>
    <ol className="nx-stepper">{steps.map((step: any, index: number) => <li key={`${index}-${step?.action || ''}`}>
      <span className="nx-stepper__number">{index + 1}</span>
      <div className="nx-stepper__body">
        <div className="nx-stepper__action">{STEP_LABELS[step?.action] || 'Bước'}</div>
        <p>{String(step?.instruction_vi || '')}</p>
        <KnowledgeChips refs={step?.kp_refs} />
        <Microcheck value={step?.microcheck} refs={step?.kp_refs} />
      </div>
    </li>)}</ol>
    {distractors.length ? <section className="nx-distractors" aria-label="Phân tích đáp án nhiễu">
      <p className="nx-distractors__heading">Phân tích đáp án nhiễu</p>
      <ul>{distractors.map((item: any, index: number) => <li key={`${index}-${item?.option || ''}`}>
        <b>{String(item?.option || '')}.</b> {String(item?.why_wrong_vi || '')}
        <KnowledgeChips refs={item?.kp_refs} />
      </li>)}</ul>
    </section> : null}
  </>;
}

function ReviewCard({ item }: { item: any }) {
  const hasDetail = Array.isArray(item.stepper?.steps) && item.stepper.steps.length > 0;
  const [expanded, setExpanded] = useState(false);
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (hasDetail && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setExpanded((value) => !value);
    }
  };
  return <article className={`card nx-review-card ${item.correct ? 'is-correct' : 'is-incorrect'}`}>
    <div
      className="nx-review-card__top"
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      aria-expanded={hasDetail ? expanded : undefined}
      onClick={hasDetail ? () => setExpanded((value) => !value) : undefined}
      onKeyDown={toggleFromKeyboard}
    >
      <span><span className="nx-muted">Câu {item.qNum}.</span> {item.prompt}</span>
      <span className="nx-review-card__verdict" aria-label={item.correct ? 'Đúng' : 'Sai'}>{item.correct ? '✓' : '✗'}</span>
      {hasDetail ? <span className="nx-review-card__toggle">{expanded ? 'Ẩn lời giải' : 'Xem lời giải'}</span> : null}
    </div>
    <div className="nx-review-card__answers">
      <span className="nx-muted">Bạn chọn:</span> <b>{item.userAnswer || '—'}</b>
      <span aria-hidden="true"> · </span><span className="nx-muted">Đáp án:</span> <b className="nx-correct-answer">{item.expected}</b>
    </div>
    {hasDetail ? <div className="nx-review-card__detail" hidden={!expanded}><Stepper value={item.stepper} /></div> : null}
  </article>;
}

function CenterState({ children }: { children: ReactNode }) {
  return <div className="nx-center-state" role="status">{children}</div>;
}

export function ExamPlayer() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const accountRef = useRef<string | null>(null);
  accountRef.current = accountKey;
  const generationRef = useRef(0);
  const submitLock = useRef(false);

  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [exams, setExams] = useState<any[]>([]);
  const [exam, setExam] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [review, setReview] = useState<any>(null);
  const [attemptId, setAttemptId] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitBlocked, setSubmitBlocked] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!accountKey) return;
    const expectedAccount = accountKey;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    let disposed = false;
    const ownsRequest = () => !disposed
      && accountRef.current === expectedAccount
      && generationRef.current === generation;

    submitLock.current = false;
    setOwnerKey(expectedAccount);
    setPhase('loading');
    setError('');
    setExams([]);
    setExam(null);
    setAnswers({});
    setReview(null);
    setAttemptId('');
    setSubmitState('idle');
    setSubmitBlocked(false);
    setSubmitError('');

    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (exam player)');
      if (!ready || !ownsRequest()) throw new Error('Không tải được thành phần kết nối.');
      const query = requestQuery();
      if (query.id) {
        const payload = await window.api.getWith<unknown>(
          `/api/exams/${encodeURIComponent(query.id)}`,
          undefined,
          { signal: controller.signal },
        );
        if (!ownsRequest()) return;
        const normalized = normalizeExam(payload, query.id);
        if (!normalized) throw new Error('Máy chủ trả về đề thi không đúng định dạng.');
        setExam(normalized);
        setPhase('exam');
      } else {
        const path = `/api/exams${query.source ? `?source=${encodeURIComponent(query.source)}` : ''}`;
        const payload = await window.api.getWith<unknown>(path, undefined, { signal: controller.signal });
        if (!ownsRequest()) return;
        const normalized = normalizeExamList(payload);
        if (!normalized) throw new Error('Máy chủ trả về danh sách đề không đúng định dạng.');
        setExams(normalized);
        setPhase('list');
      }
    })().catch((caught: unknown) => {
      if (!ownsRequest() || (caught instanceof DOMException && caught.name === 'AbortError')) return;
      setError(`Không tải được ${requestQuery().id ? 'đề' : 'danh sách đề'}: ${messageOf(caught)}`);
      setPhase('error');
    });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  const loadReview = useCallback(async (id: string, currentExam: any, expectedAccount: string, generation: number) => {
    setSubmitState('reviewing');
    setSubmitError('');
    try {
      const payload = await window.api.get<unknown>(`/api/exams/attempts/${encodeURIComponent(id)}/review`);
      if (accountRef.current !== expectedAccount || generationRef.current !== generation) return;
      const normalized = normalizeExamReview(payload, {
        attemptId: id,
        testId: currentExam.id,
        qNums: currentExam.questions.map((question: any) => question.qNum),
      });
      if (!normalized) throw new Error('Máy chủ trả về phần chữa bài không đúng định dạng.');
      setReview(normalized);
      setPhase('result');
      window.scrollTo(0, 0);
    } catch (caught: unknown) {
      if (accountRef.current !== expectedAccount || generationRef.current !== generation) return;
      setSubmitError(`Bài đã được ghi nhận nhưng chưa tải được phần chữa bài: ${messageOf(caught)}`);
    } finally {
      if (accountRef.current === expectedAccount && generationRef.current === generation) setSubmitState('idle');
    }
  }, []);

  const submit = useCallback(async () => {
    if (!accountKey || ownerKey !== accountKey || !exam || submitLock.current || submitBlocked || attemptId) return;
    const expectedAccount = accountKey;
    const generation = generationRef.current;
    submitLock.current = true;
    setSubmitState('submitting');
    setSubmitError('');
    try {
      const payload = await window.api.post<unknown>(`/api/exams/${encodeURIComponent(exam.id)}/attempts`, {
        answers: answersForSubmit(exam, answers),
      });
      if (accountRef.current !== expectedAccount || generationRef.current !== generation) return;
      const ack = normalizeAttemptAck(payload, exam.questions.length);
      if (!ack) throw new Error('Máy chủ trả về biên nhận chấm bài không đúng định dạng.');
      setAttemptId(ack.attemptId);
      await loadReview(ack.attemptId, exam, expectedAccount, generation);
    } catch (caught: unknown) {
      if (accountRef.current !== expectedAccount || generationRef.current !== generation) return;
      // The POST has no idempotency key. A transport/shape failure can happen
      // after the database commit, so even a user-triggered second click could
      // create a duplicate attempt. Lock this page instance fail-closed; reload
      // is an explicit new decision rather than a hidden replay.
      setSubmitBlocked(true);
      setSubmitError(`Chưa xác nhận được lần nộp bài: ${messageOf(caught)} Hệ thống khóa gửi lại trên trang này để tránh tạo hai lượt làm bài. Hãy tải lại trang trước khi quyết định nộp lại.`);
    } finally {
      if (accountRef.current === expectedAccount && generationRef.current === generation) {
        submitLock.current = false;
        setSubmitState('idle');
      }
    }
  }, [accountKey, answers, attemptId, exam, loadReview, ownerKey, submitBlocked]);

  const fresh = accountKey && ownerKey === accountKey;
  if (!fresh || phase === 'loading') {
    return <main className="av-w-read nx-main"><CenterState>Đang tải…</CenterState></main>;
  }
  if (phase === 'error') {
    return <main className="av-w-read nx-main"><CenterState><p className="nx-error">{error}</p><a className="btn-primary" href="/home">Về trang chủ</a></CenterState></main>;
  }
  if (phase === 'list') {
    return <main className="av-w-read nx-main">
      <header className="nx-heading"><p className="eyebrow">Luyện đề</p><h1>Đề luyện tập</h1><p>Chọn một đề để bắt đầu.</p></header>
      <section className="nx-exam-list" aria-label="Danh sách đề luyện tập">
        {exams.length ? exams.map((item) => <a className="card nx-exam-card" href={examHref(item.id)} key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.sourceLabel} · <Meta total={item.totalQuestions} minutes={item.timeLimitMinutes} /></span>
        </a>) : <p className="nx-empty">Chưa có đề nào.</p>}
      </section>
    </main>;
  }
  if (phase === 'result' && review) {
    return <main className="av-w-read nx-main">
      <section className="card nx-result-summary" aria-labelledby="result-heading">
        <p className="eyebrow" id="result-heading">Kết quả</p>
        <p className="nx-result-score">{review.score} / {review.maxScore}</p>
        <p>Đúng {review.correctCount} câu</p>
      </section>
      <section className="nx-review-list" aria-label="Chữa bài">{review.review.map((item: any) => <ReviewCard item={item} key={item.qNum} />)}</section>
      <nav className="nx-result-actions" aria-label="Bước tiếp theo">
        <a className="btn-primary" href="/grammar/roadmap">Xem lộ trình của bạn</a>
        <a className="btn-secondary" href={examHref(exam.id)}>Làm lại</a>
      </nav>
    </main>;
  }

  const busy = submitState !== 'idle';
  return <main className="av-w-read nx-main">
    <header className="nx-heading">
      <p className="eyebrow">{examSourceLabel(exam.source)}</p>
      <h1>{exam.title}</h1>
      <p><Meta total={exam.totalQuestions} minutes={exam.timeLimitMinutes} /></p>
    </header>
    <section className="nx-question-list" aria-label="Câu hỏi">
      {exam.questions.map((question: any) => <fieldset className="card nx-question" key={question.qNum}>
        <legend><span>Câu {question.qNum}.</span> {question.prompt}</legend>
        <div className="nx-options">{question.options.map((option: any) => {
          const selected = answers[question.qNum] === option.label;
          return <label className={`nx-option${selected ? ' is-selected' : ''}`} key={option.label}>
            <input
              type="radio"
              name={`q${question.qNum}`}
              value={option.label}
              checked={selected}
              disabled={busy || submitBlocked || Boolean(attemptId)}
              onChange={() => setAnswers((old) => ({ ...old, [question.qNum]: option.label }))}
            />
            <span><b>{option.label}.</b> {option.text}</span>
          </label>;
        })}</div>
      </fieldset>)}
    </section>
    {submitError ? <div className="nx-submit-error" role="alert">
      <p>{submitError}</p>
      {attemptId ? <button className="btn-secondary" type="button" disabled={busy} onClick={() => void loadReview(attemptId, exam, accountKey, generationRef.current)}>Tải lại phần chữa bài</button> : null}
    </div> : null}
    <div className="nx-submit-row">
      <button className="btn-primary" type="button" disabled={busy || submitBlocked || Boolean(attemptId)} onClick={() => void submit()}>
        {submitState === 'submitting' ? 'Đang chấm…' : submitState === 'reviewing' ? 'Đang tải chữa bài…' : attemptId ? 'Đã nộp bài' : submitBlocked ? 'Chưa xác nhận được' : 'Nộp bài'}
      </button>
    </div>
  </main>;
}
