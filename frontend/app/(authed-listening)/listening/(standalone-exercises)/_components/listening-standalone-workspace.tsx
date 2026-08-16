'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  listeningStandaloneItemCount,
  listeningStandaloneParams,
  normalizeListeningStandaloneBoot,
  normalizeListeningStandaloneResult,
} from '@/lib/listening-standalone-exercise-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Mode = 'gist' | 'true_false' | 'mcq';
type Phase = 'loading' | 'ready' | 'missing-content' | 'empty' | 'error';
type AudioElement = HTMLElement;

const MODE_COPY = {
  gist: {
    eyebrow: 'LUYỆN NGHE CHỦ ĐÍCH', title: 'Nghe ý chính',
    subtitle: 'Nghe đoạn audio rồi viết tóm tắt ý chính bằng tiếng Anh. AI chấm dựa trên nội dung và từ khóa cần có.',
    empty: 'Bài này chưa có dạng Nghe ý chính.',
  },
  true_false: {
    eyebrow: 'LUYỆN NGHE CHI TIẾT', title: 'Đúng / Sai',
    subtitle: 'Đánh dấu mỗi nhận định là Đúng (T), Sai (F) hoặc Không có thông tin (NG). Chỉ chọn NG khi bài nghe không đề cập nội dung đó.',
    empty: 'Bài này chưa có dạng Đúng / Sai.',
  },
  mcq: {
    eyebrow: 'LUYỆN NGHE CHỌN ĐÁP ÁN', title: 'Trắc nghiệm',
    subtitle: 'Nghe đoạn audio rồi chọn một đáp án đúng trong bốn lựa chọn cho mỗi câu hỏi.',
    empty: 'Bài này chưa có dạng Trắc nghiệm.',
  },
} as const;

const LETTERS = ['A', 'B', 'C', 'D'];
const TF_LABELS = { T: 'Đúng (T)', F: 'Sai (F)', NG: 'Không có (NG)' } as const;

function statusOf(error: unknown): number | null {
  const status = Number((error as { status?: unknown } | null)?.status);
  return Number.isInteger(status) ? status : null;
}

function FeedbackBridge({ hostRef, contentId }: {
  hostRef: React.RefObject<HTMLElement | null>;
  contentId: string;
}) {
  useEffect(() => {
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.attachCardFlag === 'function',
      'AverFeedback (Listening standalone exercise)',
    ).then((ready) => {
      if (!disposed && ready && hostRef.current) {
        (window as any).AverFeedback.attachCardFlag({
          card: hostRef.current, top: hostRef.current, skill: 'listening',
          contentId, label: 'Báo lỗi bài này',
        });
      }
    });
    return () => { disposed = true; };
  }, [contentId, hostRef]);
  return null;
}

export function ListeningStandaloneWorkspace({ mode }: { mode: Mode }) {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const contentId = listeningStandaloneParams(searchParams?.toString() || '').contentId;
  return <AccountWorkspace
    accountKey={accountKey}
    contentId={contentId}
    key={`${accountKey || status}:${mode}:${contentId || 'picker'}`}
    mode={mode}
  />;
}

function AccountWorkspace({ accountKey, contentId, mode }: {
  accountKey: string | null;
  contentId: string | null;
  mode: Mode;
}) {
  const copy = MODE_COPY[mode];
  const [phase, setPhase] = useState<Phase>('loading');
  const [bundle, setBundle] = useState<any>(null);
  const [loadMessage, setLoadMessage] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [gistAnswer, setGistAnswer] = useState('');
  const [answers, setAnswers] = useState<Array<string | number | null>>([]);
  const [listenCount, setListenCount] = useState(0);
  const audioRef = useRef<AudioElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!accountKey) return undefined;
    if (!contentId) {
      setBundle(null);
      setPhase('missing-content');
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    setPhase('loading');
    setLoadMessage('');
    setBundle(null);
    setResult(null);
    setSubmitError('');

    (async () => {
      const ready = await whenGlobalReady(
        () => typeof window.api?.getWith === 'function',
        `window.api (Listening ${mode})`,
      );
      if (!ready || disposed) {
        if (!disposed) setPhase('error');
        return;
      }
      try {
        const encoded = encodeURIComponent(contentId);
        const [rawContent, rawExercises] = await Promise.all([
          window.api.getWith<unknown>(`/api/listening/content/${encoded}`, {}, { noRedirect: true, signal: controller.signal }),
          window.api.getWith<unknown>(`/api/listening/exercises?content_id=${encoded}&exercise_type=${mode}`, {}, { noRedirect: true, signal: controller.signal }),
        ]);
        const normalized = normalizeListeningStandaloneBoot(mode, contentId, rawContent, rawExercises);
        if (disposed) return;
        if (!normalized) {
          setPhase('empty');
          return;
        }
        setBundle(normalized);
        setAnswers(new Array(listeningStandaloneItemCount(normalized)).fill(mode === 'true_false' ? '' : null));
        setListenCount(0);
        setPhase('ready');
      } catch (error: unknown) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
        const status = statusOf(error);
        if (status === 401) {
          window.location.replace('/login');
          return;
        }
        setLoadMessage(status === 404
          ? 'Bài nghe không tồn tại hoặc chưa được công khai.'
          : 'Không tải được bài nghe. Vui lòng thử lại.');
        setPhase('error');
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, contentId, mode]);

  useEffect(() => {
    const player = audioRef.current;
    if (!player || phase !== 'ready') return undefined;
    const onPlay = () => setListenCount((count) => count + 1);
    player.addEventListener('av-audio-play', onPlay);
    return () => player.removeEventListener('av-audio-play', onPlay);
  }, [bundle, phase]);

  const reset = useCallback(() => {
    if (!bundle) return;
    setResult(null);
    setSubmitError('');
    setBusy(false);
    setListenCount(0);
    if (mode !== 'gist') setAnswers(new Array(listeningStandaloneItemCount(bundle)).fill(mode === 'true_false' ? '' : null));
  }, [bundle, mode]);

  const submit = useCallback(async () => {
    if (!bundle || busy || result) return;
    if (mode === 'gist' && !gistAnswer.trim()) {
      setSubmitError('Hãy viết tóm tắt trước khi kiểm tra.');
      return;
    }
    if (mode !== 'gist' && answers.some((answer) => answer === null || answer === '')) {
      setSubmitError(mode === 'mcq'
        ? 'Bạn chưa chọn đáp án cho tất cả câu hỏi.'
        : 'Bạn chưa chọn đáp án cho tất cả nhận định.');
      return;
    }
    const owner = accountKey;
    setBusy(true);
    setSubmitError('');
    try {
      const body: Record<string, unknown> = {
        exercise_id: bundle.exercise.id,
        content_id: bundle.content.id,
        mode,
        listen_count: Math.max(1, listenCount),
      };
      if (mode === 'gist') body.user_transcript = gistAnswer;
      else if (mode === 'true_false') body.answers = answers;
      else body.mcq_answers = answers;
      const raw = await window.api.postWith<unknown>('/api/listening/attempts', body, {}, { noRedirect: true });
      if (!liveRef.current || owner !== accountKey) return;
      setResult(normalizeListeningStandaloneResult(
        mode, bundle.exercise.id, listeningStandaloneItemCount(bundle), raw,
      ));
    } catch (error: unknown) {
      if (!liveRef.current || owner !== accountKey) return;
      if (statusOf(error) === 401) {
        window.location.replace('/login');
        return;
      }
      setSubmitError('Không xác nhận được kết quả. Bài có thể đã được ghi; hệ thống sẽ không tự gửi lại.');
    } finally {
      if (liveRef.current && owner === accountKey) setBusy(false);
    }
  }, [accountKey, answers, bundle, busy, gistAnswer, listenCount, mode, result]);

  return <div className="shell"><main className={`lse-shell is-${mode}`}>
    <header className="lse-header" ref={headerRef}>
      <p className="lse-eyebrow"><a href="/listening/browse">← Kho bài nghe</a><span>{copy.eyebrow}</span></p>
      <h1>{copy.title}<span aria-hidden="true"> · </span><strong>{bundle?.content.title || '…'}</strong></h1>
      <p>{copy.subtitle}</p>
      {bundle ? <FeedbackBridge hostRef={headerRef} contentId={bundle.content.id} /> : null}
    </header>

    {phase === 'loading' ? <section className="lse-state" role="status">Đang tải bài luyện…</section> : null}
    {phase === 'missing-content' ? <section className="lse-state" role="status"><strong>Chưa chọn bài nghe.</strong><span>Hãy mở dạng luyện từ Kho bài nghe.</span><a href="/listening/browse">Mở Kho bài nghe</a></section> : null}
    {phase === 'empty' ? <section className="lse-state" role="status"><strong>{copy.empty}</strong><span>Quản trị viên cần xuất bản nội dung bài tập trước.</span><a href="/listening/browse">Chọn bài khác</a></section> : null}
    {phase === 'error' ? <section className="lse-state is-error" role="alert"><strong>{loadMessage || 'Không tải được bài nghe. Vui lòng thử lại.'}</strong><a href="/listening/browse">Quay lại Kho bài nghe</a></section> : null}

    {phase === 'ready' && bundle ? <>
      <section className="lse-player" aria-label="Audio bài luyện">
        <div><span>Audio</span><small>Số lượt nghe: {listenCount}</small></div>
        <audio-player
          ref={(node) => { audioRef.current = node as AudioElement | null; }}
          src={bundle.content.audioUrl}
          duration-hint={bundle.content.durationSeconds}
          refetch-url={`/api/listening/content/${encodeURIComponent(bundle.content.id)}`}
        />
      </section>

      {mode === 'gist' ? <GistExercise bundle={bundle} value={gistAnswer} result={result} disabled={busy || !!result} onChange={setGistAnswer} onSubmit={submit} /> : null}
      {mode === 'true_false' ? <TrueFalseExercise bundle={bundle} answers={answers} result={result} disabled={busy || !!result} onAnswer={(index: number, value: string) => setAnswers((current) => current.map((answer, itemIndex) => itemIndex === index ? value : answer))} /> : null}
      {mode === 'mcq' ? <McqExercise bundle={bundle} answers={answers} result={result} disabled={busy || !!result} onAnswer={(index: number, value: number) => setAnswers((current) => current.map((answer, itemIndex) => itemIndex === index ? value : answer))} /> : null}

      {submitError ? <div className="lse-submit-error" role="alert">{submitError}</div> : null}
      <div className="lse-actions">
        <button type="button" className="lse-primary" disabled={busy || !!result} onClick={submit}>{busy ? 'Đang chấm…' : 'Kiểm tra'}</button>
        {result ? <button type="button" className="lse-secondary" onClick={reset}>Thử lại</button> : null}
        {result && mode !== 'gist' ? <strong className={result.isCorrect ? 'is-perfect' : ''}>{Math.round(result.score * 100)}% · {result.correct}/{result.total}</strong> : null}
        {result && mode === 'gist' ? <strong className={result.isCorrect ? 'is-perfect' : ''}>{result.score} / 100{result.aiUsed ? '' : ' · keyword fallback'}</strong> : null}
      </div>

      {result && mode === 'gist' ? <section className="lse-feedback" aria-label="Phản hồi chấm ý chính">
        <span>{result.firstAttempt ? 'Phản hồi · lần đầu đã ghi điểm chính thức' : 'Phản hồi · điểm chính thức giữ ở lần đầu'}</span>
        <p>{result.feedback}</p>
        <div>{result.keywordMatches.length
          ? result.keywordMatches.map((keyword: string) => <em key={keyword}>{keyword}</em>)
          : <small>Không trúng từ khóa nào.</small>}</div>
      </section> : null}
    </> : null}
  </main></div>;
}

function GistExercise({ bundle, value, result, disabled, onChange, onSubmit }: any) {
  return <section className="lse-gist">
    <div className="lse-prompt">{bundle.exercise.prompt}</div>
    <label htmlFor="lse-gist-answer">Câu trả lời của bạn</label>
    <textarea id="lse-gist-answer" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); onSubmit(); } }} placeholder="Tóm tắt ý chính bằng 2–4 câu tiếng Anh…" autoComplete="off" spellCheck={false} />
    {result ? <p className="lse-lock-note">Đã chấm lượt này. Chọn “Thử lại” để gửi một lượt làm thêm.</p> : null}
  </section>;
}

function TrueFalseExercise({ bundle, answers, result, disabled, onAnswer }: any) {
  const details = new Map((result?.details || []).map((detail: any) => [detail.idx, detail]));
  return <ol className="lse-items">{bundle.exercise.statements.map((statement: any, index: number) => {
    const detail: any = details.get(statement.idx);
    return <li className={detail ? (detail.isCorrect ? 'is-correct' : 'is-incorrect') : ''} key={statement.idx}>
      <div className="lse-item-title"><span>{index + 1}</span><p>{statement.text}</p></div>
      <fieldset disabled={disabled}><legend className="sr-only">Đáp án câu {index + 1}</legend>{Object.entries(TF_LABELS).map(([value, label]) => <label className={answers[index] === value ? 'is-selected' : ''} key={value}><input type="radio" name={`tf-${statement.idx}`} value={value} checked={answers[index] === value} onChange={() => onAnswer(index, value)} /><span>{label}</span></label>)}</fieldset>
      {detail ? <p className="lse-result-note">{detail.isCorrect ? `✓ Đúng — đáp án ${detail.expected}` : `✗ Sai — bạn chọn ${detail.actual || '(trống)'} · đáp án ${detail.expected}`}</p> : null}
    </li>;
  })}</ol>;
}

function McqExercise({ bundle, answers, result, disabled, onAnswer }: any) {
  const details = new Map((result?.details || []).map((detail: any) => [detail.idx, detail]));
  return <ol className="lse-items">{bundle.exercise.questions.map((question: any, index: number) => {
    const detail: any = details.get(question.idx);
    return <li className={detail ? (detail.isCorrect ? 'is-correct' : 'is-incorrect') : ''} key={question.idx}>
      <div className="lse-item-title"><span>{index + 1}</span><p>{question.stem}</p></div>
      <fieldset className="is-stacked" disabled={disabled}><legend className="sr-only">Đáp án câu {index + 1}</legend>{question.options.map((option: string, optionIndex: number) => <label className={answers[index] === optionIndex ? 'is-selected' : ''} key={`${question.idx}-${optionIndex}`}><input type="radio" name={`mcq-${question.idx}`} value={optionIndex} checked={answers[index] === optionIndex} onChange={() => onAnswer(index, optionIndex)} /><span><b>{LETTERS[optionIndex]}.</b> {option}</span></label>)}</fieldset>
      {detail ? <p className="lse-result-note">{detail.isCorrect ? '✓ Đúng' : `✗ Sai — bạn chọn ${detail.actualIdx === null ? '(trống)' : LETTERS[detail.actualIdx]}`}</p> : null}
    </li>;
  })}</ol>;
}
