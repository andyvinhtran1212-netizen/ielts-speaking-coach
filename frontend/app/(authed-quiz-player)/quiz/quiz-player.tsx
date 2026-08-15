'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  correctAnswerText,
  displayItemKey,
  givenAnswerText,
  normalizeQuizBank,
  normalizeQuizQuery,
  quizAreaModel,
  quizEndPayload,
  quizResultModel,
  resolveQuizBank,
  safeQuizLink,
  shuffledAnswerIndices,
  stripAudioToken,
} from '@/lib/quiz-player-model.mjs';
import { QuizProgressOutbox } from '@/lib/quiz-progress-outbox.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { createEngine } from '../../../public/js/quiz-engine.js';
import { buildReviewList } from '../../../public/js/quiz-review.js';

type Phase = 'loading' | 'error' | 'gate' | 'play' | 'finishing' | 'summary';
type AnyRow = Record<string, any>;

interface CurrentItem { question: AnyRow; item_key: string }
interface Feedback {
  correct: boolean;
  corrected?: string | null;
  provisional?: boolean;
  value: unknown;
  correctText: string;
  givenText: string;
  explain: string;
  articleUrl: string | null;
  cardKey: string | null;
}

function FormattedText({ value }: { value?: unknown }) {
  const parts = String(value ?? '').split(/(\*\*.+?\*\*|_{2,})/g);
  return parts.map((part, index): ReactNode => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^_{2,}$/.test(part)) return <u key={index} aria-label="chỗ trống">&nbsp;&nbsp;&nbsp;</u>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function instruction(question: AnyRow) {
  const prompt = String(question.prompt || '');
  if (question.input === 'boolean') return 'Chọn Đúng hoặc Sai.';
  if (question.input === 'choice') {
    return question.type === 'gap_mcq' || /_{2,}/.test(prompt)
      ? 'Chọn từ/cụm đúng cho chỗ trống.'
      : 'Chọn đáp án đúng.';
  }
  if (question.input === 'syllable') return 'Chọn một phương án.';
  if (question.input === 'text') {
    const counts = (Array.isArray(question.accept) ? question.accept : [])
      .map((answer: unknown) => String(answer).trim().split(/\s+/).length);
    const count = counts.length && counts.every((value: number) => value === counts[0]) ? counts[0] : 0;
    return count ? `Gõ đáp án vào ô trống (${count} từ).` : 'Gõ đáp án vào ô trống.';
  }
  return '';
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const row = item as AnyRow;
    const text = row.form || row.text || row.phrase || row.word || row.headword || row.en || row.value || '';
    return text && row.pos ? `${text} (${row.pos})` : text;
  }).map(String).map((item) => item.trim()).filter(Boolean);
}

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function QuizFrame({ active, children }: { active: string; children: ReactNode }) {
  return (
    <>
      {/* @ts-ignore custom element supplied by the shared chrome module */}
      <aver-chrome active={active} />
      {children}
    </>
  );
}

export function QuizPlayerLoading() {
  return (
    <QuizFrame active="vocabulary">
      <main className="qz-shell"><p className="qz-muted qz-loading">Đang tải bài kiểm tra…</p></main>
    </QuizFrame>
  );
}

export function QuizPlayer() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const querySource = searchParams?.toString() || '';
  const requestKey = status === 'signed-in' && user?.id ? `${user.id}:${querySource}` : null;
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [bank, setBank] = useState<AnyRow | null>(null);
  const [current, setCurrent] = useState<CurrentItem | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [progress, setProgress] = useState({ mastered: 0, total: 0, remaining: 0 });
  const [result, setResult] = useState<AnyRow | null>(null);
  const [reviewRows, setReviewRows] = useState<AnyRow[]>([]);
  const [wrongOnly, setWrongOnly] = useState(true);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);

  const requestKeyRef = useRef<string | null>(null);
  requestKeyRef.current = requestKey;
  const bankRef = useRef<AnyRow | null>(null);
  const engineRef = useRef<any>(null);
  const outboxRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const logRef = useRef<AnyRow[]>([]);
  const answerLockRef = useRef(false);
  const advanceLockRef = useRef(false);
  const enterSubmitRef = useRef(false);
  const startLockRef = useRef(false);
  const resetLockRef = useRef(false);
  const finishLockRef = useRef(false);
  const audioCacheRef = useRef(new Map<string, HTMLAudioElement>());
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLParagraphElement | null>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const cardCloseRef = useRef<HTMLButtonElement | null>(null);
  const cardReturnFocusRef = useRef<HTMLElement | null>(null);

  const area = useMemo(() => quizAreaModel(bank), [bank]);
  const fresh = ownerKey === requestKey;

  const stopAudio = useCallback(() => {
    for (const audio of audioCacheRef.current.values()) {
      try { audio.pause(); audio.src = ''; } catch { /* best effort */ }
    }
    audioCacheRef.current.clear();
    try { window.speechSynthesis?.cancel(); } catch { /* best effort */ }
  }, []);

  const playAudio = useCallback((url?: unknown, fallback?: unknown) => {
    const safe = safeQuizLink(typeof url === 'string' ? url : null);
    if (safe) {
      let audio = audioCacheRef.current.get(safe);
      if (!audio) {
        audio = new Audio(safe);
        audio.preload = 'auto';
        audioCacheRef.current.set(safe, audio);
      }
      try { audio.currentTime = 0; void audio.play().catch(() => undefined); } catch { /* user agent guard */ }
      return;
    }
    const text = String(fallback || '').trim();
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } catch { /* best effort */ }
  }, []);

  const sendKeepalive = useCallback(() => {
    const outbox = outboxRef.current;
    const sessionId = sessionIdRef.current;
    const token = authTokenRef.current;
    const payload = outbox?.keepalivePayload?.();
    if (!payload || !sessionId || !token || !window.api?.base) return;
    try {
      void fetch(`${window.api.base}/api/quiz/sessions/${encodeURIComponent(sessionId)}/progress`, {
        method: 'POST',
        keepalive: true,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* best effort; canonical resume remains fail closed */ }
  }, []);

  useEffect(() => {
    const onPageHide = () => sendKeepalive();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      sendKeepalive();
      stopAudio();
    };
  }, [sendKeepalive, stopAudio]);

  useEffect(() => {
    if (status === 'signed-out') {
      sendKeepalive();
      window.location.replace('/login');
    }
  }, [sendKeepalive, status]);

  const finish = useCallback(async (expectedKey: string) => {
    if (finishLockRef.current || requestKeyRef.current !== expectedKey) return;
    const engine = engineRef.current;
    const outbox = outboxRef.current;
    const sessionId = sessionIdRef.current;
    if (!engine || !outbox || !sessionId) return;
    finishLockRef.current = true;
    try {
      let progressSaved = await outbox.flush(true);
      if (!progressSaved) progressSaved = await outbox.flush(true);
      const summary = engine.summary();
      const duration = Math.round((Date.now() - startedAtRef.current) / 1000);
      let finalized = false;
      try {
        await window.api.patch(`/api/quiz/sessions/${encodeURIComponent(sessionId)}`, quizEndPayload(summary, duration, progressSaved));
        finalized = true;
      } catch { /* summary stays visible but explicitly warns */ }
      if (requestKeyRef.current !== expectedKey) return;
      setResult(quizResultModel(summary, duration, progressSaved && finalized));
      setReviewRows(buildReviewList(logRef.current));
      setWrongOnly(true);
      setPhase('summary');
      setCurrent(null);
      setFeedback(null);
    } finally {
      finishLockRef.current = false;
    }
  }, []);

  const showNext = useCallback((expectedKey: string) => {
    if (advanceLockRef.current || requestKeyRef.current !== expectedKey) return;
    advanceLockRef.current = true;
    enterSubmitRef.current = false;
    const item = engineRef.current?.next?.();
    answerLockRef.current = false;
    setFeedback(null);
    setTextAnswer('');
    if (!item) {
      setCurrent(null);
      setPhase('finishing');
      void finish(expectedKey);
      return;
    }
    setCurrent(item);
    setProgress(engineRef.current.progress());
  }, [finish]);

  const startPlay = useCallback(async (selectedBank: AnyRow, review: boolean, expectedKey: string) => {
    if (startLockRef.current || requestKeyRef.current !== expectedKey) return;
    startLockRef.current = true;
    setStartBusy(true);
    setMessage('');
    try {
      let started: AnyRow;
      try {
        started = await window.api.post('/api/quiz/sessions', { bank_id: selectedBank.bank.id });
      } catch (error: any) {
        if (requestKeyRef.current === expectedKey) {
          setMessage(`Không xác nhận được phiên mới: ${error?.message || String(error)}. Hãy tải lại trước khi thử lại.`);
          setPhase('error');
        }
        return;
      }
      if (requestKeyRef.current !== expectedKey) return;
      const sessionId = typeof started?.session_id === 'string' ? started.session_id : '';
      if (!sessionId) {
        setMessage('Máy chủ không trả về mã phiên hợp lệ.');
        setPhase('error');
        return;
      }
      const engine = createEngine(selectedBank, { resume: review ? [] : (Array.isArray(started.resume) ? started.resume : []), seed: sessionId });
      engineRef.current = engine;
      sessionIdRef.current = sessionId;
      outboxRef.current = new QuizProgressOutbox({ api: window.api, engine, sessionId, review });
      startedAtRef.current = Date.now();
      logRef.current = [];
      finishLockRef.current = false;
      answerLockRef.current = false;
      advanceLockRef.current = false;
      enterSubmitRef.current = false;
      try {
        const sb = window.getSupabase() as any;
        const session = await sb?.auth?.getSession?.();
        authTokenRef.current = session?.data?.session?.access_token || null;
      } catch { authTokenRef.current = null; }
      if (requestKeyRef.current !== expectedKey) return;
      setPhase('play');
      setFeedback(null);
      setTextAnswer('');
      setProgress(engine.progress());
      const item = engine.next();
      if (!item) {
        setPhase('finishing');
        await finish(expectedKey);
      }
      else setCurrent(item);
    } finally {
      startLockRef.current = false;
      setStartBusy(false);
    }
  }, [finish]);

  useEffect(() => {
    if (!requestKey) return;
    const expectedKey = requestKey;
    const controller = new AbortController();
    let disposed = false;
    setOwnerKey(expectedKey);
    setPhase('loading');
    setMessage('');
    setBank(null);
    bankRef.current = null;
    engineRef.current = null;
    outboxRef.current = null;
    sessionIdRef.current = null;
    authTokenRef.current = null;
    startLockRef.current = false;
    answerLockRef.current = false;
    advanceLockRef.current = false;
    enterSubmitRef.current = false;
    resetLockRef.current = false;
    finishLockRef.current = false;

    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith && typeof window.getSupabase === 'function', 'Quiz player runtime');
      if (!ready || disposed) {
        if (!disposed) { setMessage('Không tải được thành phần kết nối. Hãy tải lại trang.'); setPhase('error'); }
        return;
      }
      let query;
      try { query = normalizeQuizQuery(querySource); }
      catch { setMessage('Đường dẫn bài kiểm tra không hợp lệ.'); setPhase('error'); return; }
      let resolution;
      if (query.bank) resolution = resolveQuizBank(query, null);
      else {
        const suffix = `?skill_area=${encodeURIComponent(query.skillArea || '')}${query.topicId ? `&topic_id=${encodeURIComponent(query.topicId)}` : ''}`;
        try {
          const rows = await window.api.getWith(`/api/quiz/banks${suffix}`, undefined, { signal: controller.signal });
          if (disposed) return;
          resolution = resolveQuizBank(query, rows);
        } catch (error: any) {
          if (error?.name === 'AbortError' || disposed) return;
          setMessage(`Không tải được danh sách bài: ${error?.message || String(error)}`);
          setPhase('error');
          return;
        }
      }
      if (resolution.kind === 'redirect') {
        window.location.replace(resolution.href || '/vocabulary/practice');
        return;
      }
      if (resolution.kind === 'error') {
        setMessage(resolution.message || 'Không thể xác định bài kiểm tra.');
        setPhase('error');
        return;
      }
      if (!resolution.bankId) {
        setMessage('Máy chủ không trả về mã bài kiểm tra hợp lệ.');
        setPhase('error');
        return;
      }
      let loaded;
      try {
        loaded = await window.api.getWith(`/api/quiz/banks/${encodeURIComponent(resolution.bankId)}`, undefined, { signal: controller.signal });
      } catch (error: any) {
        if (error?.name === 'AbortError' || disposed) return;
        setMessage(`Không tải được bài: ${error?.message || String(error)}`);
        setPhase('error');
        return;
      }
      if (disposed) return;
      const normalized = normalizeQuizBank(loaded);
      if (!normalized) { setMessage('Bài chưa có câu hỏi hợp lệ.'); setPhase('error'); return; }
      normalized.bank.id = normalized.bank.id || resolution.bankId;
      bankRef.current = normalized;
      setBank(normalized);
      let resume;
      try {
        resume = await window.api.getWith(`/api/quiz/banks/${encodeURIComponent(resolution.bankId)}/resume`, undefined, { signal: controller.signal });
      } catch (error: any) {
        if (error?.name === 'AbortError' || disposed) return;
        setMessage(`Không tải được tiến độ: ${error?.message || String(error)}`);
        setPhase('error');
        return;
      }
      if (disposed) return;
      const check = createEngine(normalized, { resume: Array.isArray(resume) ? resume : [] });
      const snapshot = check.progress();
      if (snapshot.total > 0 && snapshot.remaining === 0) { setProgress(snapshot); setPhase('gate'); return; }
      await startPlay(normalized, false, expectedKey);
    })();

    return () => {
      disposed = true;
      controller.abort();
      sendKeepalive();
    };
  }, [querySource, requestKey, sendKeepalive, startPlay]);

  useEffect(() => {
    if (feedback && !enterSubmitRef.current) nextButtonRef.current?.focus();
    else if (current?.question?.input === 'text') textInputRef.current?.focus();
    else if (current) promptRef.current?.focus();
  }, [current, feedback]);

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !enterSubmitRef.current) return;
      enterSubmitRef.current = false;
      nextButtonRef.current?.focus();
    };
    document.addEventListener('keyup', onKeyUp);
    return () => document.removeEventListener('keyup', onKeyUp);
  }, []);

  useEffect(() => {
    if (phase === 'summary') summaryHeadingRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!cardKey) return;
    cardCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCardKey(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = cardCloseRef.current?.closest('[role="dialog"]');
      const focusable = modal ? Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cardKey]);

  useEffect(() => {
    if (!cardKey && cardReturnFocusRef.current) {
      cardReturnFocusRef.current.focus();
      cardReturnFocusRef.current = null;
    }
  }, [cardKey]);

  const submitAnswer = (value: unknown) => {
    if (answerLockRef.current || !current || !engineRef.current || !requestKey) return;
    answerLockRef.current = true;
    const response = engineRef.current.submit(value);
    if (!response) { answerLockRef.current = false; return; }
    advanceLockRef.current = false;
    const question = current.question;
    const correctText = correctAnswerText(question);
    const articleUrl = safeQuizLink(question.article_url);
    const normalizedCardKey = String(current.item_key || '').toLowerCase();
    const hasCard = Boolean(bank?.word_cards?.[normalizedCardKey]);
    logRef.current.push({
      qid: question.qid,
      item_key: current.item_key,
      prompt: stripAudioToken(question.prompt),
      hint: String(question.hint || '').trim() || null,
      given: givenAnswerText(question, value),
      correctText,
      correct: response.correct,
      explain: question.explain || '',
      article_url: articleUrl,
    });
    setFeedback({
      correct: response.correct,
      corrected: response.corrected,
      provisional: response.provisional,
      value,
      correctText,
      givenText: givenAnswerText(question, value),
      explain: response.explain || '',
      articleUrl,
      cardKey: hasCard ? normalizedCardKey : null,
    });
    setProgress(engineRef.current.progress());
    void outboxRef.current?.flush(false);
  };

  const resetProgress = async () => {
    const currentBank = bankRef.current;
    if (resetLockRef.current || !currentBank || !requestKey) return;
    if (!window.confirm('Xoá toàn bộ tiến độ “đã thuộc” của bài này và làm lại từ đầu?')) return;
    resetLockRef.current = true;
    setResetBusy(true);
    setMessage('');
    let confirmed = false;
    try {
      try {
        await window.api.post(`/api/quiz/banks/${encodeURIComponent(currentBank.bank.id)}/reset`, {});
        confirmed = true;
      } catch {
        try {
          const resume = await window.api.get(`/api/quiz/banks/${encodeURIComponent(currentBank.bank.id)}/resume`);
          confirmed = Array.isArray(resume) && resume.length === 0;
        } catch { confirmed = false; }
      }
      if (!confirmed) {
        setMessage('Không xác nhận được việc xoá tiến độ. Hãy tải lại để kiểm tra trước khi thử lại.');
        return;
      }
      await startPlay(currentBank, false, requestKey);
    } finally {
      resetLockRef.current = false;
      if (requestKeyRef.current === requestKey) setResetBusy(false);
    }
  };

  const openCard = (key: string, target: HTMLElement) => {
    cardReturnFocusRef.current = target;
    setCardKey(key);
  };

  const question = current?.question;
  const options = question?.input === 'choice' ? (question.options || []) : (question?.segments || []);
  const answerOrder = question?.input === 'choice'
    ? shuffledAnswerIndices(options.length, `${sessionIdRef.current || ''}:${question.qid || ''}`)
    : options.map((_: unknown, index: number) => index);
  const progressPercent = progress.total ? Math.round((progress.mastered / progress.total) * 100) : 0;
  const visibleReviews = wrongOnly ? reviewRows.filter((row) => row.wrongCount > 0) : reviewRows;
  const selectedCard = cardKey ? bank?.word_cards?.[cardKey] : null;

  if (!requestKey || !fresh || status === 'initial-loading') return <QuizPlayerLoading />;

  return (
    <QuizFrame active={area.active}>
      <main className="qz-shell">
        <header className="subpage-header">
          <div className="subpage-header__lhs">
            <a className="subpage-header__back" href={area.backHref}><span aria-hidden="true">←</span><span>{area.backLabel}</span></a>
          </div>
        </header>

        {phase === 'loading' ? <p className="qz-muted qz-loading">Đang tải bài kiểm tra…</p> : null}
        {phase === 'error' ? <div className="qz-error" role="alert"><strong>Không thể mở bài</strong><p>{message}</p><a className="av-button av-button-secondary" href={area.backHref}>Quay lại</a></div> : null}

        {phase === 'gate' ? (
          <section className="qz-gate" aria-labelledby="qz-gate-title">
            <p className="qz-eyebrow">Quick-Check · Mastery</p>
            <h1 id="qz-gate-title">{area.grammar ? '🎉 Bạn đã nắm trọn vẹn các điểm ngữ pháp của bài này!' : '🎉 Bạn đã thuộc trọn vẹn bộ từ này!'}</h1>
            <p>{area.grammar ? 'Ôn tập lại để củng cố, hoặc làm lại từ đầu nếu muốn kiểm tra nghiêm ngặt lại toàn bộ bài.' : 'Ôn tập lại để củng cố trí nhớ, hoặc làm lại từ đầu nếu muốn kiểm tra nghiêm ngặt lại toàn bộ danh sách.'}</p>
            <div className="qz-actions">
              <button type="button" className="av-button av-button-primary" disabled={startBusy || resetBusy} onClick={() => bankRef.current && requestKey && void startPlay(bankRef.current, true, requestKey)}>{startBusy ? 'Đang tạo phiên…' : '🔁 Ôn tập lại'}</button>
              <button type="button" className="av-button av-button-secondary" disabled={startBusy || resetBusy} onClick={() => void resetProgress()}>{resetBusy ? 'Đang xác nhận…' : '♻️ Làm lại từ đầu'}</button>
            </div>
            {message ? <p className="qz-inline-error" role="alert">{message}</p> : null}
          </section>
        ) : null}

        {phase === 'play' && question ? (
          <section aria-labelledby="qz-title">
            <div className="qz-head"><h1 id="qz-title">{bank?.bank?.title || bank?.bank?.code || 'Quick-Check'}</h1><span className="qz-count">{area.progressPrefix}{progress.mastered}/{progress.total}</span></div>
            <div className="qz-track" role="progressbar" aria-label="Tiến độ bài" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><div className="qz-bar" style={{ width: `${progressPercent}%` }} /></div>
            <p className="qz-sub">{area.grammar ? 'Trả lời đúng mỗi điểm ngữ pháp ở nhiều dạng câu (có ít nhất 1 câu tự gõ) để được tính là nắm — bài sẽ tự lặp lại điểm bạn còn sai.' : 'Trả lời đúng mỗi từ ở nhiều dạng câu (có ít nhất 1 câu tự gõ) để được tính là thuộc — bài sẽ tự lặp lại từ bạn còn sai.'}</p>
            <article className="av-card qz-card">
              {question.audio_url || String(question.prompt || '').includes('{{audio}}') ? <button type="button" className="av-button av-button-secondary av-button-sm qz-audio" onClick={() => playAudio(question.audio_url, current.item_key)}>🔊 Nghe</button> : null}
              <p ref={promptRef} tabIndex={-1} className="qz-prompt"><FormattedText value={stripAudioToken(question.prompt)} /></p>
              {question.hint ? <p className="qz-hint">💡 <FormattedText value={question.hint} /></p> : null}
              <p className="qz-instr">{instruction(question)}</p>

              {question.input === 'choice' || question.input === 'syllable' ? (
                <div className={question.input === 'choice' ? 'qz-options' : 'qz-chips'}>
                  {answerOrder.map((originalIndex: number) => {
                    const isCorrect = feedback && originalIndex === question.answer;
                    const isWrong = feedback && feedback.value === originalIndex && !feedback.correct;
                    return <button key={`${question.qid}:${originalIndex}`} type="button" className={`qz-opt${question.input === 'syllable' ? ' qz-chip' : ''}${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`} disabled={Boolean(feedback)} onClick={() => submitAnswer(originalIndex)}><span><FormattedText value={options[originalIndex]} /></span><span className="qz-opt__mark">{isCorrect ? '✓' : isWrong ? '✗' : ''}</span></button>;
                  })}
                </div>
              ) : null}
              {question.input === 'boolean' ? (
                <div className="qz-bool">
                  {([['Đúng', true], ['Sai', false]] as const).map(([label, value]) => {
                    const correctValue = question.answer === 1 || question.answer === true;
                    const isCorrect = feedback && value === correctValue;
                    const isWrong = feedback && feedback.value === value && !feedback.correct;
                    return <button key={label} type="button" className={`qz-opt${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`} disabled={Boolean(feedback)} onClick={() => submitAnswer(value)}><span>{label}</span><span className="qz-opt__mark">{isCorrect ? '✓' : isWrong ? '✗' : ''}</span></button>;
                  })}
                </div>
              ) : null}
              {question.input === 'text' ? (
                <div className="qz-text-answer"><input ref={textInputRef} className={`qz-input${feedback ? feedback.correct ? ' is-correct' : ' is-wrong' : ''}`} type="text" autoComplete="off" value={textAnswer} disabled={Boolean(feedback)} onChange={(event) => setTextAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && textAnswer.trim() && !feedback) { enterSubmitRef.current = true; submitAnswer(textAnswer); } }} /><button type="button" className="av-button av-button-primary" disabled={!textAnswer.trim() || Boolean(feedback)} onClick={() => submitAnswer(textAnswer)}>Kiểm tra</button></div>
              ) : null}

              {feedback ? (
                <div className={`qz-feedback ${feedback.correct ? 'ok' : 'no'}`} role="status">
                  <strong>{feedback.correct ? '✓ Chính xác' : '✗ Chưa đúng'}</strong>
                  {!feedback.correct && feedback.correctText ? <p>Đáp án đúng: <b><FormattedText value={feedback.correctText} /></b></p> : null}
                  {feedback.correct && feedback.corrected ? <p>Đáp án chuẩn: <b><FormattedText value={feedback.corrected} /></b></p> : null}
                  {feedback.explain ? <p><FormattedText value={feedback.explain} /></p> : null}
                  {feedback.correct && feedback.provisional ? <p>Đã ghi nhận ✓ — trả lời đúng thêm 1 câu dạng khác của {area.grammar ? 'điểm này' : 'từ này'} để được tính vào tiến độ.</p> : null}
                  {!feedback.correct && feedback.articleUrl ? <p><a href={feedback.articleUrl} target="_blank" rel="noopener noreferrer">📖 Ôn lại bài</a></p> : null}
                  {feedback.cardKey ? <button type="button" className="qz-cardlink" onClick={(event) => openCard(feedback.cardKey!, event.currentTarget)}>📇 Xem nhanh thẻ từ</button> : null}
                  <div className="qz-actions"><button ref={nextButtonRef} type="button" className="av-button av-button-primary" onClick={() => requestKey && showNext(requestKey)}>Tiếp →</button></div>
                </div>
              ) : null}
            </article>
          </section>
        ) : null}

        {phase === 'finishing' ? <div className="qz-finishing" role="status"><span className="spinner" aria-hidden="true" /><p>Đang lưu phần tiến độ cuối và tổng kết phiên…</p></div> : null}

        {phase === 'summary' && result ? (
          <section aria-labelledby="qz-summary-title">
            <p className="qz-eyebrow">Quick-Check · Kết quả phiên</p>
            <h1 ref={summaryHeadingRef} tabIndex={-1} id="qz-summary-title">🎉 Hoàn tất phiên!</h1>
            <div className="qz-result-tiles"><div><span>⏱ Thời gian</span><strong>{formatDuration(result.durationSeconds)}</strong></div><div><span>Số câu đã làm</span><strong>{result.totalQuestions}</strong></div><div><span>{area.masteredNoun}</span><strong>{result.mastered}<small>/{result.total}</small></strong></div></div>
            <article className="av-card qz-card"><h2>Hiệu suất</h2><div className="qz-result-row"><span>Độ chính xác</span><strong>{result.accuracy}%</strong></div><div className="qz-track"><div className="qz-bar" style={{ width: `${result.accuracy}%` }} /></div><div className="qz-result-row"><span>Đúng / Sai</span><span><b className="is-success">{result.totalCorrect}</b> · <b className="is-error">{result.totalWrong}</b></span></div>{result.hardest?.key && result.hardest.attempts > 1 ? <div className="qz-result-row"><span>{area.hardestNoun}</span><b>{displayItemKey(result.hardest.key, area.grammar)} · {result.hardest.attempts} lần</b></div> : null}</article>
            {result.carriedKeys.length ? <article className="av-card qz-card"><h2>Cần ôn lại ({result.carriedKeys.length})</h2><div className="qz-chips">{result.carriedKeys.map((key: string) => { const normalized = key.toLowerCase(); const hasCard = Boolean(bank?.word_cards?.[normalized]); return hasCard ? <button type="button" className="qz-chip qz-res-chip" key={key} onClick={(event) => openCard(normalized, event.currentTarget)}>{displayItemKey(key, area.grammar)}</button> : <span className="qz-chip" key={key}>{displayItemKey(key, area.grammar)}</span>; })}</div></article> : null}
            {reviewRows.length ? <article className="av-card qz-card"><div className="qz-review-head"><h2>Xem lại bài làm</h2><button type="button" className="av-button av-button-secondary av-button-sm" onClick={() => setWrongOnly((value) => !value)}>{wrongOnly ? `Hiện tất cả (${reviewRows.length})` : `Chỉ câu sai (${reviewRows.filter((row) => row.wrongCount > 0).length})`}</button></div>{visibleReviews.length ? visibleReviews.map((row) => <div className={`qz-review-item ${!row.correct ? 'is-wrong' : row.wrongCount ? 'is-fixed' : 'is-right'}`} key={row.qid}><strong><FormattedText value={row.prompt} /></strong>{row.hint ? <p>💡 <FormattedText value={row.hint} /></p> : null}{row.wrongCount > 0 && row.correct && row.wrongGiven != null ? <p>Từng trả lời sai: <b className="is-error"><FormattedText value={row.wrongGiven} /></b> ✗{row.wrongCount > 1 ? ` (sai ${row.wrongCount} lần)` : ''}</p> : null}<p>{row.wrongCount > 0 && row.correct ? 'Sau đó trả lời đúng' : 'Bạn trả lời'}: <b className={row.correct ? 'is-success' : 'is-error'}><FormattedText value={row.given} /></b> {row.correct ? '✓' : '✗'}</p>{!row.correct && row.correctText ? <p>Đáp án đúng: <b className="is-success"><FormattedText value={row.correctText} /></b></p> : null}{row.explain ? <p><FormattedText value={row.explain} /></p> : null}{safeQuizLink(row.article_url) ? <p><a href={safeQuizLink(row.article_url)!} target="_blank" rel="noopener noreferrer">📖 Ôn lại bài</a></p> : null}</div>) : <p className="qz-muted">🎉 Không sai câu nào trong phiên này.</p>}</article> : null}
            {!result.saved ? <div className="qz-save-warning" role="alert"><strong>⚠ Chưa xác nhận lưu hết tiến độ</strong><p>Một phần tiến độ hoặc trạng thái kết thúc chưa được máy chủ xác nhận. Hãy tải lại trang thống kê trước khi làm lại.</p></div> : null}
            <div className="qz-actions"><a className="av-button av-button-primary" href={area.backHref}>{area.summaryBackLabel}</a><a className="av-button av-button-secondary" href={area.statsHref}>📊 Thống kê của tôi</a></div>
          </section>
        ) : null}
      </main>

      {selectedCard ? (
        <div className="av-modal-backdrop qz-dialog" role="dialog" aria-modal="true" aria-labelledby="qz-card-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCardKey(null); }}>
          <div className="av-modal">
            <div className="av-modal-header"><div><p className="qz-eyebrow">Xem nhanh thẻ từ</p><h2 id="qz-card-title" className="av-modal-title">{selectedCard.headword || cardKey}</h2>{selectedCard.pronunciation || selectedCard.syllables ? <code className="qz-ipa">{selectedCard.pronunciation || selectedCard.syllables}</code> : null}</div><button ref={cardCloseRef} type="button" className="qz-dialog-close" aria-label="Đóng" onClick={() => setCardKey(null)}>×</button></div>
            <div className="av-modal-body"><p className="qz-card-meta">{[selectedCard.part_of_speech, selectedCard.level, selectedCard.register].filter(Boolean).join(' · ')}</p>{selectedCard.definition_vi || selectedCard.gloss_vi ? <p className="qz-card-definition"><FormattedText value={selectedCard.definition_vi || selectedCard.gloss_vi} /></p> : null}{selectedCard.definition_en ? <p className="qz-card-definition-en"><FormattedText value={selectedCard.definition_en} /></p> : null}<button type="button" className="av-button av-button-secondary av-button-sm" onClick={() => playAudio(selectedCard.audio_headword, selectedCard.headword || cardKey)}>🔊 Nghe phát âm</button>{selectedCard.example ? <div className="qz-example"><div><b>Ví dụ</b> <button type="button" className="qz-inline-audio" onClick={() => playAudio(selectedCard.audio_example, selectedCard.example)}>🔊 Nghe</button></div><p><FormattedText value={selectedCard.example} /></p></div> : null}{[['Cụm từ thường gặp', selectedCard.collocations], ['Đồng nghĩa', selectedCard.synonyms], ['Trái nghĩa', selectedCard.antonyms], ['Họ từ', selectedCard.word_family], ['Từ liên quan', selectedCard.related_words]].map(([label, value]) => { const rows = stringList(value); return rows.length ? <div className="qz-card-section" key={String(label)}><h3>{label}</h3><div className="qz-chips">{rows.map((row) => <span className="qz-chip" key={row}>{row}</span>)}</div></div> : null; })}{selectedCard.common_error ? <div className="qz-note is-warning"><b>⚠️ Lỗi thường gặp</b><p><FormattedText value={selectedCard.common_error} /></p></div> : null}{selectedCard.memory_hook ? <div className="qz-note is-tip"><b>💡 Mẹo ghi nhớ</b><p><FormattedText value={selectedCard.memory_hook} /></p></div> : null}</div>
            <div className="av-modal-footer"><button type="button" className="av-button av-button-secondary" onClick={() => setCardKey(null)}>Đóng</button></div>
          </div>
        </div>
      ) : null}
    </QuizFrame>
  );
}
