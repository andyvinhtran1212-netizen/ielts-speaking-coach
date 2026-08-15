'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  firstUnansweredIndex,
  normalizeD1AttemptAck,
  normalizeD1Resume,
  normalizeD1Start,
  normalizeD1Summary,
} from '@/lib/d1-exercise-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'start' | 'active' | 'completing' | 'summary' | 'empty' | 'rate_limited' | 'disabled' | 'error';
type Session = any;
type Summary = any;
const LEGACY_STORAGE_KEY = 'aver:d1:active-session';

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function storageKey(userId: string) {
  return `${LEGACY_STORAGE_KEY}:${userId}`;
}

function readSessionIdsFromKey(key: string) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && !!id))];
    }
  } catch {
    // Backward compatibility with the former singleton value.
  }
  return [raw];
}

function readSessionIds(userId: string) {
  return readSessionIdsFromKey(storageKey(userId));
}

function writeSessionIds(userId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length) localStorage.setItem(storageKey(userId), JSON.stringify(unique));
  else localStorage.removeItem(storageKey(userId));
}

function retainSession(userId: string, sessionId: string) {
  writeSessionIds(userId, [...readSessionIds(userId).filter((id) => id !== sessionId), sessionId]);
}

async function requestForAccount(expectedAccount: string, path: string, init?: RequestInit) {
  const sb = window.getSupabase() as any;
  const { data, error } = await sb.auth.getSession();
  const authSession = data?.session;
  if (error || !authSession?.access_token || authSession.user?.id !== expectedAccount) {
    throw new Error('Tài khoản đã thay đổi trước khi gửi yêu cầu.');
  }
  const response = await fetch(`${window.api.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${authSession.access_token}`,
      'X-Request-ID': window.crypto?.randomUUID?.() || `d1-start-${Date.now()}`,
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = payload?.detail || null;
    const thrown: any = new Error(
      typeof detail === 'string' ? detail : detail?.message || `HTTP ${response.status}`,
    );
    thrown.status = response.status;
    thrown.detail = detail;
    throw thrown;
  }
  return payload;
}

async function startSessionForAccount(expectedAccount: string) {
  return requestForAccount(expectedAccount, '/api/exercises/d1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: 10 }),
  });
}

async function resumeSessionForAccount(expectedAccount: string, sessionId: string) {
  return requestForAccount(
    expectedAccount,
    `/api/exercises/d1/sessions/${encodeURIComponent(sessionId)}`,
  );
}

function quotaMessage(detail: any) {
  const remaining = Number.isFinite(Number(detail?.remaining))
    ? ` Bạn còn ${Number(detail.remaining)} lượt.` : '';
  const parsed = detail?.reset_at ? new Date(detail.reset_at) : null;
  const reset = parsed && !Number.isNaN(parsed.getTime())
    ? ` Có thể thử lại sau ${parsed.toLocaleString('vi-VN')}.` : '';
  return `Không đủ lượt hôm nay để hoàn thành phiên.${remaining}${reset}`;
}

function newAttemptId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) return '';
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function Sentence({ value }: { value: string }) {
  const [before, ...after] = value.split('___');
  return <>{before}<span className="d1x-blank">{after.length ? '_____' : ''}</span>{after.join('___')}</>;
}

export function D1ExercisePlayer() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const accountRef = useRef<string | null>(null);
  accountRef.current = accountKey;
  const mutationLock = useRef(false);
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState('');
  const [attemptAck, setAttemptAck] = useState<any>(null);
  const [saveError, setSaveError] = useState('');
  const [attemptRateLimited, setAttemptRateLimited] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reviewExercises, setReviewExercises] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const fresh = ownerKey === accountKey;
  const exercises = reviewExercises || session?.exercises || [];
  const exercise = exercises[index] || null;
  const reviewMode = !!reviewExercises;
  const localCorrect = !!exercise && !!choice
    && choice.trim().toLocaleLowerCase('en') === exercise.answer.trim().toLocaleLowerCase('en');

  const clearResume = useCallback((userId: string, sessionId: string, clearUrl = true) => {
    writeSessionIds(userId, readSessionIds(userId).filter((id) => id !== sessionId));
    if (!clearUrl) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('session') === sessionId) {
      url.searchParams.delete('session');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const rememberSession = useCallback((userId: string, sessionId: string) => {
    retainSession(userId, sessionId);
    const url = new URL(window.location.href);
    url.searchParams.set('session', sessionId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const complete = useCallback(async (current: Session, expectedAccount: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setMessage('');
    setPhase('completing');
    try {
      const payload = await requestForAccount(
        expectedAccount,
        `/api/exercises/d1/sessions/${encodeURIComponent(current.sessionId)}/complete`,
        { method: 'POST' },
      );
      const canonical = normalizeD1Summary(payload, current);
      if (!canonical) throw new Error('Máy chủ trả về tổng kết không đúng định dạng.');
      if (accountRef.current !== expectedAccount) return;
      clearResume(expectedAccount, current.sessionId);
      setSummary(canonical);
      setReviewExercises(null);
      setPhase('summary');
    } catch (caught: any) {
      if (accountRef.current === expectedAccount) {
        if (caught?.status === 401) window.location.href = '/login';
        else {
          setMessage(`Chưa xác nhận được tổng kết: ${messageOf(caught)}`);
          setPhase('completing');
        }
      }
    } finally {
      mutationLock.current = false;
      if (accountRef.current === expectedAccount) setBusy(false);
    }
  }, [clearResume]);

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!accountKey) return;
    const expectedAccount = accountKey;
    let disposed = false;
    // A previous account may still have a request settling. Its response is
    // guarded by accountRef; do not let its lock strand the new account.
    mutationLock.current = false;
    setBusy(false);
    setOwnerKey(expectedAccount);
    setPhase('loading');
    setMessage('');
    setSession(null);
    setSummary(null);
    setReviewExercises(null);
    setIndex(0);
    setChoice(null);
    setAttemptKey('');
    setAttemptAck(null);
    setSaveError('');
    setAttemptRateLimited(false);

    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.get, 'window.api (D1 exercise)');
      if (!ready || disposed) throw new Error('Không tải được thành phần kết nối.');
      const me = await requestForAccount(expectedAccount, '/auth/me');
      if (disposed || accountRef.current !== expectedAccount) return;
      if (me?.d1_enabled !== true) {
        setPhase('disabled');
        return;
      }
      const queryId = new URL(window.location.href).searchParams.get('session') || '';
      const storedIds = readSessionIds(expectedAccount);
      const legacyIds = storedIds.length ? [] : readSessionIdsFromKey(LEGACY_STORAGE_KEY);
      const candidates = [...new Set([
        queryId,
        storedIds[storedIds.length - 1] || '',
        legacyIds[legacyIds.length - 1] || '',
      ].filter(Boolean))];
      if (!candidates.length) {
        setPhase('start');
        return;
      }
      try {
        let resumed: Session | null = null;
        let resumedId = '';
        for (const candidate of candidates) {
          try {
            const payload = await resumeSessionForAccount(expectedAccount, candidate);
            resumed = normalizeD1Resume(payload);
            if (!resumed) throw new Error('Dữ liệu phiên đang làm không đúng định dạng.');
            resumedId = candidate;
            break;
          } catch (caught: any) {
            if (caught?.status !== 404) throw caught;
            clearResume(
              expectedAccount,
              candidate,
              !disposed && accountRef.current === expectedAccount,
            );
          }
        }
        if (disposed || accountRef.current !== expectedAccount) return;
        if (!resumed) {
          setPhase('start');
          return;
        }
        setSession(resumed);
        rememberSession(expectedAccount, resumed.sessionId);
        if (legacyIds.includes(resumedId)) localStorage.removeItem(LEGACY_STORAGE_KEY);
        const next = firstUnansweredIndex(resumed);
        if (resumed.status === 'completed' || next < 0) {
          void complete(resumed, expectedAccount);
          return;
        }
        setIndex(next);
        setPhase('active');
      } catch (caught: any) {
        if (disposed || accountRef.current !== expectedAccount) return;
        if (caught?.status === 401) {
          window.location.href = '/login';
          return;
        }
        setMessage(`Không khôi phục được phiên: ${messageOf(caught)}`);
        setPhase('error');
      }
    })().catch((caught) => {
      if (!disposed && accountRef.current === expectedAccount) {
        if (caught?.status === 401) window.location.href = '/login';
        else {
          setMessage(messageOf(caught));
          setPhase('error');
        }
      }
    });
    return () => { disposed = true; };
  }, [accountKey, clearResume, complete, rememberSession]);

  const start = async () => {
    if (!accountKey || mutationLock.current) return;
    const expectedAccount = accountKey;
    mutationLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const payload = await startSessionForAccount(expectedAccount);
      const started = normalizeD1Start(payload);
      if (!started) throw new Error('Máy chủ trả về phiên D1 không đúng định dạng.');
      // The backend may already have committed this session. Preserve its ID
      // under the request owner even if auth changed while the ACK travelled;
      // only the current owner is allowed to update visible state or the URL.
      retainSession(expectedAccount, started.sessionId);
      if (accountRef.current !== expectedAccount) return;
      setSession(started);
      setIndex(0);
      setChoice(null);
      setAttemptKey('');
      setAttemptAck(null);
      setReviewExercises(null);
      setAttemptRateLimited(false);
      rememberSession(expectedAccount, started.sessionId);
      setPhase('active');
    } catch (caught: any) {
      if (accountRef.current !== expectedAccount) return;
      if (caught?.status === 401) window.location.href = '/login';
      else if (caught?.status === 503) setPhase('empty');
      else if (caught?.status === 429) {
        setMessage(quotaMessage(caught.detail));
        setPhase('rate_limited');
      }
      else {
        setMessage(`Không bắt đầu được phiên: ${messageOf(caught)}`);
        setPhase('start');
      }
    } finally {
      mutationLock.current = false;
      if (accountRef.current === expectedAccount) setBusy(false);
    }
  };

  const persistAnswer = async (selected: string, key: string) => {
    if (!accountKey || !session || !exercise || reviewMode || mutationLock.current) return;
    const expectedAccount = accountKey;
    mutationLock.current = true;
    setBusy(true);
    setSaveError('');
    setAttemptRateLimited(false);
    let canonical = null;
    let lastError: unknown = null;
    try {
      for (let attempt = 0; attempt < 2 && !canonical; attempt += 1) {
        try {
          const payload = await requestForAccount(
            expectedAccount,
            `/api/exercises/d1/${encodeURIComponent(exercise.id)}/attempt`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_answer: selected,
                session_id: session.sessionId,
                client_attempt_id: key,
              }),
            },
          );
          canonical = normalizeD1AttemptAck(payload, exercise, selected);
          if (!canonical) throw new Error('Máy chủ chưa xác nhận đúng attempt đã lưu.');
        } catch (caught: any) {
          lastError = caught;
          if (caught?.status === 401 || caught?.status === 429) break;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!canonical) throw lastError || new Error('Không lưu được attempt.');
      if (accountRef.current !== expectedAccount) return;
      setAttemptAck(canonical);
    } catch (caught: any) {
      if (accountRef.current === expectedAccount) {
        if (caught?.status === 401) window.location.href = '/login';
        else {
          const rateLimited = caught?.status === 429;
          setAttemptRateLimited(rateLimited);
          setSaveError(rateLimited ? quotaMessage(caught.detail) : `Chưa lưu được bài: ${messageOf(caught)}`);
        }
      }
    } finally {
      mutationLock.current = false;
      if (accountRef.current === expectedAccount) setBusy(false);
    }
  };

  const select = (selected: string) => {
    if (choice || !exercise) return;
    setChoice(selected);
    if (reviewMode) return;
    const key = newAttemptId();
    if (!key) {
      setSaveError('Trình duyệt không hỗ trợ tạo mã lưu bài an toàn.');
      return;
    }
    setAttemptKey(key);
    void persistAnswer(selected, key);
  };

  const advance = () => {
    if (!choice || (!reviewMode && !attemptAck) || !session || !accountKey) return;
    if (reviewMode) {
      if (index + 1 >= exercises.length) {
        setReviewExercises(null);
        setPhase('summary');
      } else {
        setIndex(index + 1);
        setChoice(null);
        setAttemptAck(null);
        setAttemptKey('');
        setSaveError('');
        setAttemptRateLimited(false);
      }
      return;
    }
    session.attemptsByExercise.set(exercise.id, {
      exerciseId: exercise.id, userAnswer: choice, isCorrect: localCorrect,
    });
    setSession({ ...session, attemptsByExercise: new Map(session.attemptsByExercise) });
    const next = session.exercises.findIndex((item: any, candidate: number) => (
      candidate > index && !session.attemptsByExercise.has(item.id)
    ));
    setChoice(null);
    setAttemptAck(null);
    setAttemptKey('');
    setSaveError('');
    setAttemptRateLimited(false);
    if (next < 0) void complete(session, accountKey);
    else setIndex(next);
  };

  const reviewWrong = () => {
    if (!summary || !session) return;
    const wrongIds = new Set(summary.wrong.map((item: any) => item.exerciseId));
    const rows = session.exercises.filter((item: any) => wrongIds.has(item.id));
    if (!rows.length) return;
    setReviewExercises(rows);
    setIndex(0);
    setChoice(null);
    setAttemptAck(null);
    setSaveError('');
    setAttemptRateLimited(false);
    setPhase('active');
  };

  const percent = summary ? Math.round((summary.correctCount / summary.totalCount) * 100) : 0;
  const progress = exercises.length ? Math.round((index / exercises.length) * 100) : 0;
  const answered = !!choice;
  const canAdvance = answered && (reviewMode || !!attemptAck) && !busy;
  const sourceLabel = exercise?.source === 'personalized'
    ? 'Từ vốn từ của bạn'
    : exercise?.source === 'admin_fallback' ? 'Bài luyện tập chung' : null;

  if (!fresh || phase === 'loading') return <main className="d1x-width d1x-main"><div className="d1x-state"><span className="d1x-spinner" />Đang tải phiên luyện tập…</div></main>;
  if (phase === 'disabled') return <main className="d1x-width d1x-main"><div className="d1x-state"><h2>Tính năng chưa được bật</h2><p>D1 chưa được mở cho tài khoản này.</p><a className="btn-secondary" href="/exercises">Về Exercises</a></div></main>;
  if (phase === 'empty') return <main className="d1x-width d1x-main"><div className="d1x-state"><h2>Chưa có bài tập</h2><p>Kho D1 hiện chưa có câu đã phát hành.</p><button className="btn-secondary" onClick={() => void start()}>Thử lại</button></div></main>;
  if (phase === 'rate_limited') return <main className="d1x-width d1x-main"><div className="d1x-state"><h2>Đã đạt giới hạn hôm nay</h2><p>{message}</p><div className="d1x-actions"><button className="btn-secondary" disabled={busy} onClick={() => void start()}>Thử lại</button><a className="btn-ghost" href="/exercises">Về Exercises</a></div></div></main>;
  if (phase === 'error') return <main className="d1x-width d1x-main"><div className="d1x-state is-error" role="alert"><h2>Không tải được phiên</h2><p>{message}</p><button className="btn-secondary" onClick={() => window.location.reload()}>Tải lại</button></div></main>;
  if (phase === 'start') return <main className="d1x-width d1x-main"><section className="d1x-start"><span className="d1x-kicker">Productive recall · 10 câu</span><h2>Điền từ đúng vào ngữ cảnh</h2><p>Chọn đáp án, xem phản hồi ngay và chỉ chuyển câu sau khi bài đã được lưu an toàn.</p>{message ? <p className="d1x-alert is-error" role="alert">{message}</p> : null}<button className="btn-primary d1x-primary" disabled={busy} onClick={() => void start()}>{busy ? 'Đang tạo phiên…' : 'Bắt đầu phiên mới'}</button></section></main>;
  if (phase === 'completing') return <main className="d1x-width d1x-main"><div className="d1x-state"><span className={busy ? 'd1x-spinner' : ''} /><h2>Đang xác nhận tổng kết</h2><p>{message || 'Hệ thống đang đối chiếu đủ attempt đã lưu.'}</p>{message && session && accountKey ? <button className="btn-primary" disabled={busy} onClick={() => void complete(session, accountKey)}>Thử lại</button> : null}</div></main>;
  if (phase === 'summary' && summary) return <main className="d1x-width d1x-main"><section className="d1x-summary"><span className="d1x-kicker">Phiên đã lưu</span><h2>Kết quả luyện tập</h2><div className="d1x-score"><strong>{summary.correctCount}/{summary.totalCount}</strong><span>{percent}% chính xác</span></div><div className="d1x-results">{summary.wrong.length ? <section><h3>Cần ôn lại · {summary.wrong.length}</h3>{summary.wrong.map((item: any) => <article className="d1x-result is-wrong" key={item.exerciseId}><p>{item.sentence}</p><div><span>Bạn chọn <strong>{item.userAnswer}</strong></span><span>Đáp án <strong>{item.correctAnswer}</strong></span></div></article>)}</section> : <div className="d1x-perfect">✓ Hoàn thành chính xác toàn bộ phiên.</div>}{summary.correct.length ? <section><h3>Đã làm đúng · {summary.correct.length}</h3>{summary.correct.map((item: any) => <article className="d1x-result" key={item.exerciseId}><p>{item.sentence}</p><strong>{item.answer}</strong></article>)}</section> : null}</div><div className="d1x-actions">{summary.wrong.length ? <button className="btn-secondary" onClick={reviewWrong}>Ôn lại câu sai</button> : null}<button className="btn-primary" onClick={() => { setSummary(null); setSession(null); setPhase('start'); }}>Phiên mới</button><a className="btn-ghost" href="/exercises">Về Exercises</a></div></section></main>;

  if (!exercise) return null;
  return <main className="d1x-width d1x-main"><section className="d1x-player"><div className="d1x-progress-head"><div><span>{reviewMode ? 'Ôn tập' : 'Phiên D1'}</span><strong>Câu {index + 1} / {exercises.length}</strong></div>{sourceLabel ? <span className={`d1x-source ${exercise.source === 'personalized' ? 'is-personal' : ''}`}>{sourceLabel}</span> : null}</div><div className="d1x-progress" aria-label={`Tiến độ ${progress}%`}><span style={{ width: `${progress}%` }} /></div><p className="d1x-sentence"><Sentence value={exercise.sentence} /></p><div className="d1x-options">{exercise.options.map((option: string) => { const correct = answered && option.toLocaleLowerCase('en') === exercise.answer.toLocaleLowerCase('en'); const wrong = answered && option === choice && !correct; return <button type="button" className={`d1x-option ${correct ? 'is-correct' : ''} ${wrong ? 'is-wrong' : ''} ${answered && !correct && !wrong ? 'is-dimmed' : ''}`} disabled={answered} key={option} onClick={() => select(option)}>{option}{correct ? <span aria-label="đáp án đúng">✓</span> : wrong ? <span aria-label="đáp án sai">×</span> : null}</button>; })}</div>{answered ? <div className={`d1x-feedback ${localCorrect ? 'is-correct' : 'is-wrong'}`} role="status"><strong>{localCorrect ? 'Chính xác' : `Đáp án đúng: ${exercise.answer}`}</strong>{reviewMode ? <span>Đây là lượt ôn tập, không ghi thêm attempt.</span> : attemptAck ? <span>{attemptAck.srsUpdated ? (attemptAck.srsRating === 'good' ? 'Đã ghi nhận vào lịch ôn tập.' : 'Đã điều chỉnh cho lần ôn tới.') : '✓ Đã lưu bài.'}</span> : busy ? <span>Đang lưu bài…</span> : saveError ? <span className="is-error">{saveError}</span> : null}</div> : null}<div className="d1x-player-actions">{saveError && choice && attemptKey ? <button className="btn-secondary" disabled={busy} onClick={() => void persistAnswer(choice, attemptKey)}>Thử lưu lại</button> : null}{attemptRateLimited ? <a className="btn-ghost" href="/exercises">Rời phiên</a> : null}<button className="btn-primary" disabled={!canAdvance} onClick={advance}>{index + 1 >= exercises.length ? (reviewMode ? 'Kết thúc ôn tập' : 'Xem kết quả') : 'Câu tiếp theo →'}</button></div></section></main>;
}
