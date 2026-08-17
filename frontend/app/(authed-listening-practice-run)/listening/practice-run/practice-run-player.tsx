'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  firstPracticeUnsettledIndex,
  isChoicePracticeQuestion,
  normalizePracticeAttempt,
  normalizePracticeCheck,
  normalizePracticeResume,
  normalizePracticeRunTest,
  normalizePracticeStart,
  normalizePracticeSubmit,
  normalizePracticeWindows,
  practiceRunParams,
} from '@/lib/listening-practice-run-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'ready' | 'summary' | 'error' | 'start-uncertain' | 'submit-retry' | 'submit-uncertain';
type AudioPlayerElement = HTMLElement & {
  reset?: () => void;
  play?: () => Promise<void> | void;
  pause?: () => void;
};
type PendingCheck = { qNum: number; answer: string; reveal: boolean };
type SubmitOutcome = { summary: any | null; retrySafe: boolean; uncertain: boolean };

function statusOf(error: unknown) {
  const value = Number((error as { status?: unknown })?.status);
  return Number.isInteger(value) ? value : null;
}

function loadCopy(error: unknown) {
  const status = statusOf(error);
  if (status === 404) return 'Bài luyện không tồn tại hoặc chưa được xuất bản.';
  if (status === 422) return 'Bài luyện chưa có audio sẵn sàng.';
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  return 'Không tải được bài luyện. Vui lòng thử lại.';
}

function questionNumbers(test: any) {
  return test.questions.map((question: any) => question.qNum);
}

export function ListeningPracticeRun() {
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  const params = useMemo(() => {
    try { return practiceRunParams(`?${searchParams?.toString() || ''}`); }
    catch { return null; }
  }, [searchParams]);

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <main className="lpr-next-shell"><p className="lpr-next-state">Đang xác thực…</p></main>;
  }
  if (!params) {
    return <main className="lpr-next-shell"><div className="lpr-next-state is-error" role="alert">Thiếu mã bài luyện.</div></main>;
  }
  return <PracticeWorkspace accountId={user.id} testId={params.testId} key={`${user.id}:${params.testId}`} />;
}

function PracticeWorkspace({ accountId, testId }: { accountId: string; testId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [test, setTest] = useState<any>(null);
  const [windows, setWindows] = useState<Map<number, any>>(new Map());
  const [windowsUnavailable, setWindowsUnavailable] = useState(false);
  const [attemptId, setAttemptId] = useState('');
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [verdicts, setVerdicts] = useState<Map<number, boolean>>(new Map());
  const [result, setResult] = useState<any>(null);
  const [wrongTries, setWrongTries] = useState(0);
  const [settled, setSettled] = useState(false);
  const [wholeClip, setWholeClip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [pendingCheck, setPendingCheck] = useState<PendingCheck | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [submitRetrySafe, setSubmitRetrySafe] = useState(false);
  const audioRef = useRef<AudioPlayerElement | null>(null);
  const generationRef = useRef(0);
  const accountRef = useRef(accountId);
  const startPromiseRef = useRef<Promise<any> | null>(null);
  const submitPromiseRef = useRef<Promise<SubmitOutcome> | null>(null);
  accountRef.current = accountId;

  const activeQuestion = test?.questions?.[index] || null;
  const activeWindow = activeQuestion
    ? ((result?.qNum === activeQuestion.qNum ? result.audioWindow : null)
      || windows.get(activeQuestion.qNum) || null)
    : null;
  const looping = Boolean(result && !result.correct && !result.revealed && !wholeClip && activeWindow);

  const get = useCallback((path: string, signal?: AbortSignal) => (
    window.api.getWith<unknown>(path, {}, { noRedirect: true, ...(signal ? { signal } : {}) })
  ), []);
  const post = useCallback((path: string, body: object) => (
    window.api.postWith<unknown>(path, body, {}, { noRedirect: true })
  ), []);

  const readOpenAttempt = useCallback(async (numbers: number[], signal?: AbortSignal) => (
    normalizePracticeResume(await get(
      `/api/listening/tests/${encodeURIComponent(testId)}/attempts/in-progress`, signal,
    ), numbers)
  ), [get, testId]);

  const ensureAttempt = useCallback(async (numbers: number[], signal: AbortSignal) => {
    const open = await readOpenAttempt(numbers, signal);
    if (open) return open;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!startPromiseRef.current) {
      startPromiseRef.current = (async () => {
        try {
          const ack = normalizePracticeStart(await post(
            `/api/listening/tests/${encodeURIComponent(testId)}/attempts`, {},
          ));
          return Object.freeze({ attemptId: ack.attemptId, startedAt: null, answers: Object.freeze([]) });
        } catch (startError) {
          try {
            const reconciled = await readOpenAttempt(numbers);
            if (reconciled) return reconciled;
          } catch {}
          const uncertain = new Error('practice-run-start-uncertain');
          (uncertain as any).cause = startError;
          throw uncertain;
        }
      })();
    }
    return startPromiseRef.current;
  }, [post, readOpenAttempt, testId]);

  const submitWithReconciliation = useCallback(async (id: string, numbers: number[]): Promise<SubmitOutcome> => {
    if (!submitPromiseRef.current) {
      submitPromiseRef.current = (async () => {
        try {
          return {
            summary: normalizePracticeSubmit(await post(
              `/api/listening/tests/attempts/${encodeURIComponent(id)}/submit`, {},
            ), id, numbers),
            retrySafe: false,
            uncertain: false,
          };
        } catch {
          try {
            const canonical = normalizePracticeAttempt(await get(
              `/api/listening/tests/attempts/${encodeURIComponent(id)}`,
            ), id, numbers);
            if (canonical.status === 'submitted') {
              return { summary: canonical.summary, retrySafe: false, uncertain: false };
            }
            return { summary: null, retrySafe: true, uncertain: false };
          } catch {
            return { summary: null, retrySafe: false, uncertain: true };
          }
        }
      })().finally(() => { submitPromiseRef.current = null; });
    }
    return submitPromiseRef.current;
  }, [get, post]);

  const applySubmitOutcome = useCallback((outcome: SubmitOutcome) => {
    if (outcome.summary) {
      audioRef.current?.pause?.();
      setSummary(outcome.summary); setPhase('summary'); setSubmitRetrySafe(false); setError('');
      return;
    }
    if (outcome.retrySafe) {
      setSubmitRetrySafe(true); setInlineError(''); setPhase('submit-retry');
      return;
    }
    setError('Chưa xác nhận được bài đã nộp hay chưa. Hệ thống sẽ không tự gửi lại để tránh nộp hai lần.');
    setPhase('submit-uncertain');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++generationRef.current;
    const current = () => generationRef.current === generation && accountRef.current === accountId;
    setPhase('loading'); setError('');

    void (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith && !!window.api?.postWith,
        'window.api (Listening practice run)',
      );
      if (!ready) throw new Error('practice-run-api-unavailable');
      const normalizedTest = normalizePracticeRunTest(await get(
        `/api/listening/tests/${encodeURIComponent(testId)}`, controller.signal,
      ), testId);
      if (!current() || controller.signal.aborted) return;
      setTest(normalizedTest);
      const numbers = questionNumbers(normalizedTest);
      let rawWindows: unknown = null;
      try {
        rawWindows = await get(
          `/api/listening/tests/${encodeURIComponent(testId)}/practice-windows`, controller.signal,
        );
      } catch (caught) {
        if (controller.signal.aborted || !current()) return;
        setWindows(new Map()); setWindowsUnavailable(true);
      }
      if (rawWindows) {
        const normalizedWindows = normalizePracticeWindows(rawWindows, testId, numbers);
        if (!current()) return;
        setWindows(normalizedWindows); setWindowsUnavailable(false);
      }
      const attempt = await ensureAttempt(numbers, controller.signal);
      if (!current()) return;
      setAttemptId(attempt.attemptId);
      const restored = new Map<number, boolean>();
      for (const stored of attempt.answers) {
        const checked = normalizePracticeCheck(await post(
          `/api/listening/tests/attempts/${encodeURIComponent(attempt.attemptId)}/check`,
          { q_num: stored.qNum, user_answer: stored.userAnswer },
        ), stored.qNum);
        if (!current()) return;
        restored.set(stored.qNum, checked.canonicalCorrect);
      }
      setVerdicts(restored);
      const resumeIndex = firstPracticeUnsettledIndex(normalizedTest.questions, restored);
      if (resumeIndex >= normalizedTest.questions.length) {
        const outcome = await submitWithReconciliation(attempt.attemptId, numbers);
        if (current()) applySubmitOutcome(outcome);
        return;
      }
      setIndex(resumeIndex); setPhase('ready');
    })().catch((caught: unknown) => {
      if (!current() || (caught instanceof DOMException && caught.name === 'AbortError')) return;
      if ((caught as Error)?.message === 'practice-run-start-uncertain') {
        setError('Chưa xác nhận được lượt làm bài đã được tạo hay chưa. Hệ thống sẽ không tự tạo lại để tránh xoá tiến độ.');
        setPhase('start-uncertain');
      } else {
        setError(loadCopy(caught)); setPhase('error');
      }
    });
    return () => { controller.abort(); generationRef.current += 1; };
  }, [accountId, applySubmitOutcome, ensureAttempt, get, post, submitWithReconciliation, testId]);

  useEffect(() => {
    setAnswer(''); setResult(null); setWrongTries(0); setSettled(false);
    setWholeClip(false); setInlineError(''); setPendingCheck(null); setSubmitRetrySafe(false);
  }, [index]);

  useEffect(() => {
    const player = audioRef.current;
    if (!player || phase !== 'ready') return;
    player.reset?.();
    if (looping) Promise.resolve(player.play?.()).catch(() => {});
  }, [activeWindow?.end, activeWindow?.start, index, looping, phase, wholeClip]);

  const applyCheck = useCallback((checked: any) => {
    if (!activeQuestion || checked.qNum !== activeQuestion.qNum) return;
    setVerdicts((current) => new Map(current).set(checked.qNum, checked.canonicalCorrect));
    setResult(checked); setPendingCheck(null); setInlineError('');
    if (checked.correct || checked.revealed) setSettled(true);
    else setWrongTries((count) => count + 1);
  }, [activeQuestion]);

  const sendCheck = useCallback(async (request: PendingCheck) => {
    if (!attemptId || busy || !activeQuestion || request.qNum !== activeQuestion.qNum) return;
    setBusy(true); setPendingCheck(request); setInlineError('');
    try {
      const checked = normalizePracticeCheck(await post(
        `/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/check`,
        request.reveal
          ? { q_num: request.qNum, reveal: true }
          : { q_num: request.qNum, user_answer: request.answer },
      ), request.qNum, { reveal: request.reveal });
      applyCheck(checked);
    } catch {
      setInlineError(request.reveal
        ? 'Chưa lấy được đáp án. Bạn có thể thử lại đúng yêu cầu này.'
        : 'Chưa nhận được kết quả chấm. Giữ nguyên câu trả lời và thử chấm lại để bảo toàn lần trả lời đầu.');
    } finally { setBusy(false); }
  }, [activeQuestion, applyCheck, attemptId, busy, post]);

  const checkAnswer = useCallback(() => {
    if (!activeQuestion || settled || pendingCheck) return;
    const value = answer.trim();
    if (!value) { setInlineError('Hãy chọn hoặc nhập câu trả lời trước.'); return; }
    void sendCheck({ qNum: activeQuestion.qNum, answer: value, reveal: false });
  }, [activeQuestion, answer, pendingCheck, sendCheck, settled]);

  const finish = useCallback(async () => {
    if (!test || !attemptId || busy) return;
    setBusy(true); setInlineError(''); setSubmitRetrySafe(false);
    const outcome = await submitWithReconciliation(attemptId, questionNumbers(test));
    if (accountRef.current === accountId) applySubmitOutcome(outcome);
    setBusy(false);
  }, [accountId, applySubmitOutcome, attemptId, busy, submitWithReconciliation, test]);

  const next = useCallback(() => {
    if (!test || !settled) return;
    if (index < test.questions.length - 1) setIndex((value) => value + 1);
    else void finish();
  }, [finish, index, settled, test]);

  const onAnswerKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault(); checkAnswer();
    }
  };

  if (phase === 'loading') return <main className="lpr-next-shell"><p className="lpr-next-state" role="status">Đang tải bài luyện…</p></main>;
  if (phase === 'error' || phase === 'start-uncertain' || phase === 'submit-uncertain') {
    return <main className="lpr-next-shell">
      <a className="lpr-next-back" href="/listening/practice">← Quay lại Luyện nhanh</a>
      <div className="lpr-next-state is-error" role="alert"><strong>Không thể tiếp tục</strong><span>{error}</span></div>
      <div className="lpr-next-actions">
        <button className="lpr-next-button is-secondary" type="button" onClick={() => window.location.reload()}>Kiểm tra lại trạng thái</button>
        <a className="lpr-next-button" href="/listening/practice">Về thư viện</a>
      </div>
    </main>;
  }
  if (phase === 'summary' && summary) {
    return <main className="lpr-next-shell">
      <a className="lpr-next-back" href="/listening/practice">← Quay lại Luyện nhanh</a>
      <header className="lpr-next-header"><p className="lpr-next-eyebrow">Hoàn thành · lần nghe đầu</p><h1>{test?.title}</h1></header>
      <section className="lpr-next-summary" aria-labelledby="lpr-summary-title">
        <div className="lpr-next-score"><strong id="lpr-summary-title">{summary.score} / {summary.maxScore}</strong><span>câu đúng ngay lần nghe đầu</span></div>
        <p>Điểm chỉ dùng câu trả lời đầu tiên. Những lần nghe lại giúp bạn sửa tai nghe, nhưng không viết lại kết quả ban đầu.</p>
        <ul>{summary.perQuestion.map((row: any) => <li className={row.correct ? 'is-correct' : 'is-wrong'} key={row.qNum}>
          <span aria-hidden="true">{row.correct ? '✓' : '✗'}</span><span><strong>Câu {row.qNum}</strong> — {row.expected}</span>
        </li>)}</ul>
        <a className="lpr-next-button" href="/listening/practice">Về thư viện Luyện nhanh</a>
      </section>
    </main>;
  }
  if (phase === 'submit-retry') {
    return <main className="lpr-next-shell">
      <a className="lpr-next-back" href="/listening/practice">← Quay lại Luyện nhanh</a>
      <header className="lpr-next-header"><p className="lpr-next-eyebrow">Đối chiếu lượt nộp</p><h1>{test?.title}</h1></header>
      <div className="lpr-next-state is-warning" role="status">
        <strong>Bài vẫn chưa được nộp</strong>
        <span>Máy chủ đã xác nhận lượt làm còn ở trạng thái đang làm. Bạn có thể nộp lại mà không tạo thêm lượt mới.</span>
      </div>
      <div className="lpr-next-actions">
        <button className="lpr-next-button" type="button" disabled={busy || !submitRetrySafe} onClick={() => void finish()}>Nộp lại sau khi đã đối chiếu</button>
        <a className="lpr-next-button is-secondary" href="/listening/practice">Về thư viện</a>
      </div>
    </main>;
  }

  const progress = test?.questions || [];
  const scopeStart = !wholeClip && activeWindow ? activeWindow.start : undefined;
  const scopeEnd = !wholeClip && activeWindow ? activeWindow.end : undefined;
  return <main className="lpr-next-shell">
    <a className="lpr-next-back" href="/listening/practice">← Quay lại Luyện nhanh</a>
    <header className="lpr-next-header">
      <p className="lpr-next-eyebrow">Luyện nhanh · chấm từng câu</p>
      <h1>{test?.title}</h1>
      <p>{progress.length} câu · nghe lại thoải mái · điểm tính lần đầu</p>
    </header>

    {windowsUnavailable ? <div className="lpr-next-notice" role="status">Không tải được đoạn nghe theo câu; bạn vẫn có thể luyện bằng toàn bộ audio.</div> : null}
    <section className="lpr-next-progress" aria-label="Tiến độ các câu">
      <span>Câu <strong>{index + 1} / {progress.length}</strong></span>
      <div className="lpr-next-dots" role="list">{progress.map((question: any, itemIndex: number) => {
        const canonical = verdicts.get(question.qNum);
        const state = canonical === true ? ' is-correct' : canonical === false ? ' is-wrong' : '';
        return <span className={`lpr-next-dot${itemIndex === index ? ' is-current' : ''}${state}`} role="listitem" key={question.qNum} />;
      })}</div>
    </section>

    <section className="lpr-next-audio" aria-label="Audio bài luyện">
      <audio-player
        ref={(node) => { audioRef.current = node as AudioPlayerElement | null; }}
        src={test?.audioUrl}
        duration-hint={test?.audioDuration ?? undefined}
        segment-start={scopeStart}
        segment-end={scopeEnd}
        auto-loop={looping ? 'true' : undefined}
        compact=""
      />
      {activeWindow ? <button className="lpr-next-link-button" type="button" disabled={busy || Boolean(pendingCheck)} onClick={() => setWholeClip((value) => !value)}>
        {wholeClip ? '↩ Nghe đoạn của câu này' : '▶ Nghe cả bài'}
      </button> : null}
    </section>

    {activeQuestion ? <section className="lpr-next-question" aria-labelledby="lpr-question-title">
      {activeQuestion.instruction ? <p className="lpr-next-instruction">{activeQuestion.instruction}</p> : null}
      <h2 id="lpr-question-title"><span>{activeQuestion.qNum}.</span> {activeQuestion.prompt || 'Chọn câu trả lời đúng.'}</h2>
      {isChoicePracticeQuestion(activeQuestion) ? <div className="lpr-next-options">{activeQuestion.options.map((option: any) => <label className={answer === option.letter ? 'is-selected' : ''} key={option.letter}>
        <input type="radio" name={`practice-q-${activeQuestion.qNum}`} value={option.letter} checked={answer === option.letter} disabled={busy || settled || Boolean(pendingCheck)} onChange={() => setAnswer(option.letter)} />
        <strong>{option.letter}</strong><span>{option.text}</span>
      </label>)}</div> : <input
        className="lpr-next-input" aria-label={`Câu trả lời câu ${activeQuestion.qNum}`}
        autoComplete="off" autoCapitalize="off" spellCheck={false}
        value={answer} disabled={busy || settled || Boolean(pendingCheck)}
        onChange={(event) => setAnswer(event.target.value)} onKeyDown={onAnswerKey}
      />}

      {result ? <div className={`lpr-next-verdict ${result.correct ? 'is-correct' : 'is-wrong'}`} role="status">
        {result.revealed ? <><strong>Đáp án: {result.expected}</strong>{result.alternatives.length ? <span>Cũng chấp nhận: {result.alternatives.join(' / ')}</span> : null}{result.explanation ? <span>{result.explanation}</span> : null}</>
          : result.correct && result.canonicalCorrect ? <strong>Chính xác.</strong>
            : result.correct ? <><strong>Đúng rồi.</strong><span>Câu này vẫn tính là chưa bắt được vì lần trả lời đầu chưa đúng — nhưng giờ tai bạn đã nghe ra.</span></>
              : <><strong>Chưa đúng.</strong><span>Đoạn chứa đáp án đang phát lặp lại. Nghe kỹ rồi sửa câu trả lời.</span></>}
      </div> : null}
      {inlineError ? <div className="lpr-next-inline-error" role="alert">{inlineError}</div> : null}

      <div className="lpr-next-actions">
        {!settled && !pendingCheck ? <button className="lpr-next-button" type="button" disabled={busy} onClick={checkAnswer}>Kiểm tra</button> : null}
        {pendingCheck ? <button className="lpr-next-button" type="button" disabled={busy} onClick={() => void sendCheck(pendingCheck)}>{pendingCheck.reveal ? 'Thử lấy đáp án lại' : 'Thử chấm lại đúng câu trả lời này'}</button> : null}
        {!settled && !pendingCheck && wrongTries >= 2 ? <button className="lpr-next-button is-secondary" type="button" disabled={busy} onClick={() => void sendCheck({ qNum: activeQuestion.qNum, answer: '', reveal: true })}>Xem đáp án</button> : null}
        {settled ? <button className="lpr-next-button" type="button" disabled={busy} onClick={next}>{index >= progress.length - 1 ? 'Xem tổng kết →' : 'Câu tiếp theo →'}</button> : null}
      </div>
    </section> : null}
  </main>;
}
