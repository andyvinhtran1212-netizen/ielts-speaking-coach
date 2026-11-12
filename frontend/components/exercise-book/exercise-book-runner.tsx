'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { useExerciseBookApi } from '@/lib/exercise-book/api-context';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import type { Answer, AttemptState, ErrorCode, ExerciseBookApi, Player, PublicItem } from '@/lib/exercise-book/contract';
import {
  codeText,
  encodeKeepChange,
  errorCode,
  errorText,
  isBlank,
  itemLabel,
  learnerBinding,
  parseKeepChange,
  readinessText,
} from '@/lib/exercise-book/model';

export const LEARNER_LIST_HREF = '/listening/exercise-book';
export const reviewHref = (attemptId: string) => `/listening/exercise-book/attempts/${encodeURIComponent(attemptId)}/review`;

/** Typing is coalesced per cell before one PATCH (QA G17). Choices save at once. */
const TEXT_SAVE_DELAY_MS = 500;
/** Codes after which the attempt can no longer change here (SA F13, contract §4). */
const TERMINAL: ErrorCode[] = ['past_due', 'activity_locked', 'attempt_changed', 'stale_revision'];

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; text: string }
  | { kind: 'locked'; reasons: string[] }
  | { kind: 'start'; player: Player; text?: string }
  | { kind: 'working'; player: Player; attempt: AttemptState };

/**
 * Save ledger for one attempt (CR F01). Every edit gets a new client_seq; a
 * cell is clean only when the ACK echoes the seq of its LATEST edit, so an
 * older ACK can never clear a newer edit, and a retry always sends the latest
 * value. Submit refuses while any cell is unsent, in flight or failed.
 */
class SaveLedger {
  latest = new Map<number, { value: string; seq: number }>();
  dirty = new Set<number>();
  failed = new Map<number, ErrorCode>();
  private seq: number;
  constructor(seedSeq: number) { this.seq = seedSeq; }
  edit(q: number, value: string) {
    const entry = { value, seq: ++this.seq };
    this.latest.set(q, entry);
    this.dirty.add(q);
    this.failed.delete(q);
    return entry;
  }
  ack(q: number, seq: number) {
    if (this.latest.get(q)?.seq !== seq) return;
    this.dirty.delete(q);
    this.failed.delete(q);
  }
  fail(q: number, seq: number, code: ErrorCode) {
    if (this.latest.get(q)?.seq !== seq) return;
    this.dirty.delete(q);
    this.failed.set(q, code);
  }
  get state(): 'saved' | 'saving' | 'error' {
    if (this.failed.size) return 'error';
    return this.dirty.size ? 'saving' : 'saved';
  }
}

export function ExerciseBookRunner({ testId, classItem, navigate }: {
  testId: string;
  classItem: string | null;
  navigate?: (href: string) => void;
}) {
  const { status, user } = useAuth();
  if (status === 'signed-out') return <main className="programme-runner"><a href="/login">Đăng nhập để làm bài</a></main>;
  if (status !== 'signed-in') return <main className="programme-runner"><p role="status">Đang kiểm tra đăng nhập…</p></main>;
  if (!classItem) {
    return (
      <main className="programme-runner">
        <p role="alert">Thiếu thông tin bài được giao. Hãy mở bài từ danh sách sách bài tập.</p>
        <a href={LEARNER_LIST_HREF}>Về danh sách bài</a>
      </main>
    );
  }
  return <RunnerSession key={`${user?.id || ''}:${testId}:${classItem}`} testId={testId} classItem={classItem} navigate={navigate} />;
}

function RunnerSession({ testId, classItem, navigate }: { testId: string; classItem: string; navigate?: (href: string) => void }) {
  const api = useExerciseBookApi();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setPhase({ kind: 'loading' });
    void (async () => {
      const player = await api.getPlayer(testId, classItem);
      if (!active) return;
      if (!player.activity.selectable) { setPhase({ kind: 'locked', reasons: player.activity.readiness_reasons }); return; }
      // CR F11: resume the in-progress attempt; never start one on mount.
      const { attempt } = await api.getInProgress(testId, classItem);
      if (!active) return;
      setPhase(attempt ? { kind: 'working', player, attempt } : { kind: 'start', player });
    })().catch((caught) => {
      if (!active) return;
      if (errorCode(caught) === 'activity_locked') setPhase({ kind: 'locked', reasons: [] });
      else setPhase({ kind: 'error', text: errorText(caught) });
    });
    return () => { active = false; };
  }, [api, testId, classItem, reload]);

  const start = useCallback(async (player: Player) => {
    setPhase({ kind: 'start', player, text: 'Đang mở bài…' });
    try {
      const attempt = await api.startAttempt(testId, classItem, learnerBinding(player.activity.binding));
      setPhase({ kind: 'working', player, attempt });
    } catch (caught) {
      setPhase({ kind: 'start', player, text: errorText(caught) });
    }
  }, [api, testId, classItem]);

  if (phase.kind === 'loading') return <main className="programme-runner"><p role="status">Đang mở activity…</p></main>;
  if (phase.kind === 'error') {
    return (
      <main className="programme-runner">
        <p role="alert">{phase.text}</p>
        <button type="button" className="programme-submit" onClick={() => setReload((value) => value + 1)}>Thử lại</button>
        <a href={LEARNER_LIST_HREF}>Về danh sách bài</a>
      </main>
    );
  }
  if (phase.kind === 'locked') {
    return (
      <main className="programme-runner">
        <h1>Activity chưa mở</h1>
        <p role="status">{readinessText(phase.reasons)}</p>
        <a href={LEARNER_LIST_HREF}>Về danh sách bài</a>
      </main>
    );
  }
  if (phase.kind === 'start') {
    const busy = phase.text === 'Đang mở bài…';
    return (
      <main className="programme-runner">
        <header className="programme-runner__header"><h1>{phase.player.activity.title}</h1></header>
        <p>{phase.player.activity.items.length} ô cần điền. Tự đối chiếu sau khi nộp, không chấm điểm tự động.</p>
        {phase.text && <p role={busy ? 'status' : 'alert'}>{phase.text}</p>}
        <button type="button" className="programme-submit" disabled={busy} onClick={() => void start(phase.player)}>Bắt đầu làm bài</button>
        <a href={LEARNER_LIST_HREF}>Về danh sách bài</a>
      </main>
    );
  }
  return <AttemptForm key={phase.attempt.attempt_id} api={api} player={phase.player} attempt={phase.attempt} testId={testId} classItem={classItem}
    navigate={navigate || ((href) => window.location.assign(href))} />;
}

function AttemptForm({ api, player: initialPlayer, attempt, testId, classItem, navigate }: {
  api: ExerciseBookApi;
  player: Player;
  attempt: AttemptState;
  testId: string;
  classItem: string;
  navigate: (href: string) => void;
}) {
  const items = initialPlayer.activity.items;
  const [answers, setAnswers] = useState<Record<number, string>>(() => Object.fromEntries(attempt.answers.map((answer) => [answer.q_num, answer.user_answer])));
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [frozen, setFrozen] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmBlanks, setConfirmBlanks] = useState(false);
  const [audio, setAudio] = useState(initialPlayer.audio);
  const [audioNote, setAudioNote] = useState('');
  const ledger = useRef(new SaveLedger(Date.now()));
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const leave = useRef<() => void>(() => {});
  const playbackClaimed = useRef(false);
  const audioRefreshes = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);

  // CR P2-1: leaving (pagehide, reload, unmount) must not drop an edit still in
  // its debounce or a failed save. A hidden tab is still alive, so it drains the
  // normal queue; a real exit sends at once with keepalive.
  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => leave.current();
    const onHidden = () => { if (document.visibilityState === 'hidden') void flushRef.current(); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHidden);
      leave.current();
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (confirmBlanks) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [confirmBlanks]);

  const syncSaveState = useCallback(() => {
    if (!mounted.current) return;
    const state = ledger.current.state;
    setSaveState(state);
    const code = ledger.current.failed.values().next().value;
    setSaveError(code ? codeText(code) : '');
  }, []);

  const send = useCallback((q: number) => {
    timers.current.delete(q);
    queue.current = queue.current.then(async () => {
      const entry = ledger.current.latest.get(q);
      if (!entry || !ledger.current.dirty.has(q)) return;
      try {
        const ack = await api.saveAnswer(attempt.attempt_id, { q_num: q, user_answer: entry.value, client_seq: entry.seq });
        if (ack.client_seq === entry.seq) ledger.current.ack(q, entry.seq);
        else ledger.current.fail(q, entry.seq, 'network');
      } catch (caught) {
        const code = errorCode(caught);
        ledger.current.fail(q, entry.seq, code);
        if (TERMINAL.includes(code) && mounted.current) setFrozen(errorText(caught));
      }
      syncSaveState();
    });
    return queue.current;
  }, [api, attempt.attempt_id, syncSaveState]);

  const change = useCallback((item: PublicItem, value: string, immediate: boolean) => {
    if (frozen || submitting) return;
    setAnswers((current) => ({ ...current, [item.q_num]: value }));
    ledger.current.edit(item.q_num, value);
    syncSaveState();
    const timer = timers.current.get(item.q_num);
    if (timer) clearTimeout(timer);
    if (immediate) void send(item.q_num);
    else timers.current.set(item.q_num, setTimeout(() => void send(item.q_num), TEXT_SAVE_DELAY_MS));
  }, [frozen, submitting, send, syncSaveState]);

  /** Send every pending or failed cell now, with its latest value and a new seq. */
  const flush = useCallback(async () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    for (const q of [...ledger.current.failed.keys()]) {
      const latest = ledger.current.latest.get(q);
      if (latest) ledger.current.edit(q, latest.value);
    }
    syncSaveState();
    const sends = [...ledger.current.dirty].map((q) => send(q));
    await Promise.all(sends);
    await queue.current;
  }, [send, syncSaveState]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  /**
   * Send every pending or failed cell now, OUTSIDE the save queue: the page may
   * be gone before an in-flight save settles. Each gets a new client_seq, so it
   * wins over any older save still on the wire (§4, 8.6: an older seq is not
   * applied). A frozen attempt can no longer be saved, so nothing is sent.
   */
  leave.current = () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    if (frozen) return;
    for (const q of new Set([...ledger.current.dirty, ...ledger.current.failed.keys()])) {
      const latest = ledger.current.latest.get(q);
      if (!latest) continue;
      const entry = ledger.current.edit(q, latest.value);
      void api.saveAnswer(attempt.attempt_id, { q_num: q, user_answer: entry.value, client_seq: entry.seq }, { keepalive: true })
        .then(
          (ack) => { if (ack.client_seq === entry.seq) ledger.current.ack(q, entry.seq); else ledger.current.fail(q, entry.seq, 'network'); },
          (caught) => { ledger.current.fail(q, entry.seq, errorCode(caught)); },
        )
        .finally(syncSaveState);
    }
    syncSaveState();
  };

  // Warn before leaving while an answer is unsent, in flight or failed.
  const unsaved = saveState !== 'saved' && !frozen;
  useEffect(() => {
    if (!unsaved) return undefined;
    return registerNavigationGuard((event) => { event.preventDefault(); event.returnValue = ''; });
  }, [unsaved]);

  const expectedAnswers = useCallback((): Answer[] => items.map((item) => ({
    q_num: item.q_num,
    source_item_id: item.source_item_id,
    user_answer: ledger.current.latest.get(item.q_num)?.value ?? answers[item.q_num] ?? '',
  })), [items, answers]);

  async function submit(confirmBlank: boolean) {
    if (submitting || frozen) return;
    setConfirmBlanks(false);
    setSubmitting(true);
    setSubmitError('');
    try {
      await flush();
      if (ledger.current.state !== 'saved') {
        setSubmitError('Còn câu trả lời chưa lưu được nên chưa nộp. Hãy bấm “Thử lưu lại”.');
        return;
      }
      let submitted: AttemptState | null = null;
      try {
        submitted = await api.submitAttempt(attempt.attempt_id, { expected_answers: expectedAnswers(), confirm_blank: confirmBlank });
      } catch (caught) {
        // A lost ACK may still have submitted: the canonical attempt decides.
        const canonical = await api.getAttempt(attempt.attempt_id).catch(() => null);
        if (canonical?.status === 'submitted') submitted = canonical;
        else {
          const code = errorCode(caught);
          if (TERMINAL.includes(code)) setFrozen(errorText(caught));
          setSubmitError(code === 'network' ? 'Chưa xác nhận được việc nộp bài. Câu trả lời vẫn được giữ; hãy thử lại.' : errorText(caught));
          return;
        }
      }
      if (submitted?.status === 'submitted') navigate(reviewHref(attempt.attempt_id));
      else setSubmitError('Chưa xác nhận được việc nộp bài. Câu trả lời vẫn được giữ; hãy thử lại.');
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  async function refreshAudio() {
    audioRefreshes.current += 1;
    try {
      const fresh = await api.getPlayer(testId, classItem);
      if (mounted.current) { setAudio(fresh.audio); setAudioNote(''); }
    } catch (caught) {
      if (mounted.current) setAudioNote(`Không tải lại được audio. ${errorText(caught)}`);
    }
  }

  function onAudioError() {
    // CR F12: the signed URL outlives neither its TTL nor a 24 h attempt; fetch a fresh one once, then ask.
    if (audioRefreshes.current < 1) void refreshAudio();
    else setAudioNote('Không phát được audio. Bấm “Tải lại audio” để thử lại.');
  }

  function onPlay() {
    if (playbackClaimed.current) return;
    playbackClaimed.current = true;
    void api.playbackStarted(attempt.attempt_id).catch(() => {
      playbackClaimed.current = false;
      if (mounted.current) setAudioNote('Chưa ghi nhận được lượt phát audio; bài làm vẫn được lưu bình thường.');
    });
  }

  const blanks = items.filter((item) => isBlank(item, answers[item.q_num]));
  const locked = !!frozen || submitting;
  return (
    <main className="programme-runner">
      <header className="programme-runner__header">
        <h1>{initialPlayer.activity.title}</h1>
        <p>Tự đối chiếu sau khi nộp · không chấm điểm tự động</p>
      </header>
      <section className="programme-audio" aria-label="Audio">
        {audio.url
          ? <audio controls preload="none" src={audio.url} aria-label="Audio của activity" onError={onAudioError} onPlay={onPlay} />
          : <p>Chưa có audio cho activity này.</p>}
        {audioNote && <p role="status">{audioNote}</p>}
        {audioNote && <button type="button" onClick={() => { audioRefreshes.current = 0; void refreshAudio(); }}>Tải lại audio</button>}
      </section>
      <p role="status" aria-live="polite">{saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : `Chưa lưu. ${saveError}`}</p>
      {saveState === 'error' && !frozen && <button type="button" onClick={() => void flush()}>Thử lưu lại</button>}
      {frozen && <p role="alert">{frozen}</p>}
      <div className="programme-questions">
        {items.map((item) => (
          <ItemField key={item.source_item_id} item={item} value={answers[item.q_num] || ''} disabled={locked} onChange={change} />
        ))}
      </div>
      {submitError && <p role="alert">{submitError}</p>}
      <button ref={submitButton} type="button" className="programme-submit" disabled={locked}
        onClick={() => (blanks.length ? setConfirmBlanks(true) : void submit(false))}>
        {submitting ? 'Đang nộp…' : 'Nộp bài'}
      </button>
      <dialog ref={dialog} aria-labelledby="exercise-book-confirm-title" onCancel={() => setConfirmBlanks(false)}>
        <h2 id="exercise-book-confirm-title">Còn ô chưa hoàn tất</h2>
        <p>Các câu còn trống: {blanks.map((item) => item.source_display_number).join(', ')}</p>
        <button type="button" autoFocus onClick={() => { setConfirmBlanks(false); submitButton.current?.focus(); }}>Tiếp tục làm</button>
        <button type="button" onClick={() => void submit(true)}>Nộp với ô trống</button>
      </dialog>
    </main>
  );
}

function ItemField({ item, value, disabled, onChange }: {
  item: PublicItem;
  value: string;
  disabled: boolean;
  onChange: (item: PublicItem, value: string, immediate: boolean) => void;
}) {
  const label = itemLabel(item);
  const id = `exercise-book-q${item.q_num}`;
  return (
    <fieldset className="programme-question" disabled={disabled} style={{ minWidth: 0 }}>
      <legend>{label}</legend>
      {item.instruction && <p>{item.instruction}</p>}
      {item.prompt && <p>{item.prompt}</p>}
      {item.givens.map((given, index) => <p key={index}>{given}</p>)}
      {item.interaction === 'text'
        ? (
          <label htmlFor={id}>{label} · Câu trả lời
            <textarea id={id} value={value} maxLength={2000} style={{ width: '100%', boxSizing: 'border-box', minHeight: 44 }}
              onChange={(event) => onChange(item, event.target.value, false)} />
          </label>
        )
        : <KeepChangeField id={id} label={label} item={item} value={value} onChange={onChange} />}
    </fieldset>
  );
}

function KeepChangeField({ id, label, item, value, onChange }: {
  id: string;
  label: string;
  item: PublicItem;
  value: string;
  onChange: (item: PublicItem, value: string, immediate: boolean) => void;
}) {
  const pair = parseKeepChange(value);
  return (
    <>
      <label htmlFor={`${id}-action`}>{label} · Giữ hay sửa
        <select id={`${id}-action`} value={pair.action || ''} style={{ minHeight: 44 }}
          onChange={(event) => onChange(item, encodeKeepChange({ ...pair, action: (event.target.value || null) as typeof pair.action }), true)}>
          <option value="">Chưa chọn</option>
          <option value="KEEP">Giữ nguyên (KEEP)</option>
          <option value="CHANGE">Sửa (CHANGE)</option>
        </select>
      </label>
      <label htmlFor={`${id}-text`}>{label} · Chữ sửa
        <textarea id={`${id}-text`} value={pair.correction_text} maxLength={1800} style={{ width: '100%', boxSizing: 'border-box', minHeight: 44 }}
          onChange={(event) => onChange(item, encodeKeepChange({ ...pair, correction_text: event.target.value }), false)} />
      </label>
    </>
  );
}
