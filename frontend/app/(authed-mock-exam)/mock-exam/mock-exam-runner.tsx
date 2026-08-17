'use client';

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  MOCK_LIVE_STATUSES,
  MOCK_SECTION_LABELS,
  canDiscardWritingDrafts,
  chooseWritingDraft,
  configuredMockSections,
  formatMockTime,
  isMockSubmitSettled,
  mockExamParams,
  mockExamView,
  mockPlayerHref,
  mockSpeakingHref,
  mockSpeakingTopic,
  mockWordCount,
  normalizeIntegrity,
  normalizeMockExamState,
  parseLocalWritingDraft,
  submittedAtFor,
} from '@/lib/mock-exam-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Section = 'listening' | 'reading' | 'writing';
type ConnectionState = null | 'offline' | 'submitting' | 'submit_failed';
type SaveCue = 'idle' | 'saving' | 'saved' | 'failed';
type Layout = 'left' | 'right' | 'top' | 'bottom';

interface MockState {
  sitting: {
    id: string;
    userId: string | null;
    status: string;
    listeningAttemptId: string | null;
    readingAttemptId: string | null;
    listeningSubmittedAt: string | null;
    readingSubmittedAt: string | null;
    writingSubmittedAt: string | null;
    writingSubmission: Record<'task1' | 'task2', { text: string; submittedAt: string | null }>;
  };
  exam: {
    listeningTestId: string | null;
    readingTestCode: string | null;
    readingTitle: string;
    writingTask1: Prompt | null;
    writingTask2: Prompt | null;
    speakingTopicSet: Record<string, unknown>;
    reviewSlaDays: number;
  };
  examMode: 'sequential' | 'retake';
  assignedSkills: Section[] | null;
  activeSection: Section | 'not_started' | 'done';
  collectedSection: Section | null;
  sectionTimeLeftSeconds: number | null;
  sectionDurationSeconds: number | null;
}

interface Prompt {
  title: string;
  promptText: string;
  promptImageUrl: string | null;
}

interface WritingBridge {
  flush(): Promise<void>;
  finalize(): Promise<{ task1_text: string; task2_text: string }>;
}

const POLL_MS = 8_000;
const WARN_SECONDS = 120;
const SUBMIT_RETRY_DELAYS = [2_000, 5_000, 10_000, 20_000] as const;
const CONNECTION_MESSAGES: Record<Exclude<ConnectionState, null>, string> = {
  offline: '⚠ Đang mất kết nối với máy chủ — bài của bạn vẫn được giữ, hệ thống sẽ tự thử lại.',
  submitting: '⏳ Đang nộp bài — kết nối chập chờn, hệ thống đang thử lại…',
  submit_failed: '⚠ Chưa nộp được lên máy chủ. Giữ nguyên tab này; giám thị vẫn thu được bài của bạn khi hết giờ.',
};

function statusOf(caught: unknown) {
  if (!caught || typeof caught !== 'object' || !('status' in caught)) return null;
  const status = Number((caught as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function isAbort(caught: unknown) {
  return caught instanceof DOMException && caught.name === 'AbortError';
}

function userMessage(caught: unknown, fallback: string) {
  const status = statusOf(caught);
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Bạn không còn quyền truy cập lượt thi này. Liên hệ giám thị.';
  if (status === 404) return 'Không tìm thấy lượt thi. Liên hệ giám thị.';
  if (status === 409) return 'Trạng thái kỳ thi vừa thay đổi. Hệ thống đang đồng bộ lại.';
  return fallback;
}

function isTransient(caught: unknown) {
  const status = statusOf(caught);
  return status == null || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function retryIdempotent<T>(operation: () => Promise<T>) {
  const delays = [400, 1_200, 3_000];
  let last: unknown;
  for (let index = 0; index <= delays.length; index += 1) {
    try { return await operation(); } catch (caught) {
      last = caught;
      if (!isTransient(caught) || index === delays.length) throw caught;
      await new Promise((resolve) => window.setTimeout(resolve, delays[index]));
    }
  }
  throw last;
}

function localDraftKey(sittingId: string, task: 'task1' | 'task2') {
  return `mock-writing:${sittingId}:${task}`;
}

function readLocalDraft(sittingId: string, task: 'task1' | 'task2') {
  try { return parseLocalWritingDraft(localStorage.getItem(localDraftKey(sittingId, task))); }
  catch { return null; }
}

function writeLocalDraft(sittingId: string, task: 'task1' | 'task2', text: string, synced: boolean) {
  try {
    localStorage.setItem(localDraftKey(sittingId, task), JSON.stringify({ text, ts: Date.now(), synced }));
  } catch {}
}

function clearLocalDrafts(sittingId: string) {
  try {
    localStorage.removeItem(localDraftKey(sittingId, 'task1'));
    localStorage.removeItem(localDraftKey(sittingId, 'task2'));
  } catch {}
}

function LoadingCard({ children }: { children: string }) {
  return <div className="me-center me-muted me-loading" role="status">{children}</div>;
}

export function MockExamRunnerLoading() {
  return <LoadingCard>Đang tải kỳ thi…</LoadingCard>;
}

function ErrorCard({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <main className="me-center">
      <section className="me-card me-status-card" role="alert">
        <div className="me-status-icon" aria-hidden="true">!</div>
        <h1 className="me-h1">Không mở được kỳ thi</h1>
        <p className="me-muted">{message}</p>
        {retry ? <button className="av-button av-button-primary" type="button" onClick={retry}>Thử lại</button> : null}
      </section>
    </main>
  );
}

function Checklist({ state, retake, onStart, starting }: {
  state: MockState;
  retake: boolean;
  onStart(section: Section): void;
  starting: Section | null;
}) {
  return (
    <div className="me-checklist">
      {configuredMockSections(state).map((section: Section) => {
        const done = Boolean(submittedAtFor(state, section));
        if (retake && !done) {
          return (
            <button
              className="av-button av-button-primary"
              disabled={Boolean(starting)}
              key={section}
              type="button"
              onClick={() => onStart(section)}
            >
              {starting === section ? 'Đang mở…' : `Bắt đầu ${MOCK_SECTION_LABELS[section]}`}
            </button>
          );
        }
        return <span className={`me-check-pill${done ? ' done' : ''}`} key={section}>{MOCK_SECTION_LABELS[section]}{done ? ' ✓' : ''}</span>;
      })}
    </div>
  );
}

function WaitingRoom({ state, code, onStart, starting, startError }: {
  state: MockState;
  code: string | null;
  onStart(section: Section): void;
  starting: Section | null;
  startError: string | null;
}) {
  const retake = state.examMode === 'retake';
  const title = `${retake ? 'Bài test lại' : 'Thi thử'}: ${state.exam.readingTitle || code || 'IELTS'}`;
  const message = retake
    ? 'Chọn phần để bắt đầu. Mỗi phần có thời gian riêng — web tự thu bài khi hết giờ.'
    : state.activeSection === 'not_started'
      ? 'Đang chờ giám thị bắt đầu bài thi…'
      : 'Đã nộp phần trước — đang chờ giám thị mở phần tiếp theo…';
  return (
    <main className="me-center">
      <section className="me-card me-status-card">
        <div className="me-waiting-icon" aria-hidden="true">⏳</div>
        <h1 className="me-h1">{title}</h1>
        <p className="me-muted">{startError || message}</p>
        <Checklist state={state} retake={retake} onStart={onStart} starting={starting} />
      </section>
    </main>
  );
}

function SubmittedCard({ state, onSpeaking, openingSpeaking }: {
  state: MockState;
  onSpeaking(): void;
  openingSpeaking: boolean;
}) {
  const speakingPending = state.sitting.status === 'speaking_pending';
  return (
    <main className="me-center">
      <section className="me-card me-status-card">
        <div className="me-status-icon me-status-icon--success" aria-hidden="true">✓</div>
        <h1 className="me-h1">Đã thu bài</h1>
        <p className="me-muted">
          Bài của bạn đã được ghi nhận. Giám khảo sẽ trả kết quả trong khoảng <strong>{state.exam.reviewSlaDays ?? 3} ngày</strong>. Bạn sẽ thấy điểm tại trang chủ khi có kết quả.
        </p>
        {speakingPending ? (
          <div className="me-submitted-extra">
            <p className="me-muted">Còn phần <strong>Speaking</strong> (vấn đáp 3 phần) để hoàn tất bài thi.</p>
            <button className="av-button av-button-primary" disabled={openingSpeaking} type="button" onClick={onSpeaking}>
              {openingSpeaking ? 'Đang mở…' : 'Vào thi Speaking →'}
            </button>
          </div>
        ) : <p className="me-muted me-submitted-extra">Kết quả đang chờ giám khảo duyệt.</p>}
        <a className="av-button av-button-secondary" href="/home">Về trang chủ</a>
      </section>
    </main>
  );
}

function WritingWorkspace({ state, register, locked = false }: {
  state: MockState;
  register(bridge: WritingBridge | null): void;
  locked?: boolean;
}) {
  const sittingId = state.sitting.id;
  const initial = useMemo(() => {
    const task1 = chooseWritingDraft(state.sitting.writingSubmission.task1, readLocalDraft(sittingId, 'task1'));
    const task2 = chooseWritingDraft(state.sitting.writingSubmission.task2, readLocalDraft(sittingId, 'task2'));
    return { task1, task2 };
  }, [sittingId]);
  const [task, setTask] = useState<'task1' | 'task2'>('task1');
  const [task1, setTask1] = useState(initial.task1.text);
  const [task2, setTask2] = useState(initial.task2.text);
  const [saveCue, setSaveCue] = useState<SaveCue>('idle');
  const [savedAt, setSavedAt] = useState<string>('');
  const [narrow, setNarrow] = useState(false);
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = localStorage.getItem('mock-writing-layout');
      return ['left', 'right', 'top', 'bottom'].includes(String(saved)) ? saved as Layout : 'left';
    } catch { return 'left'; }
  });
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('mock-writing-split'));
      return Number.isFinite(saved) ? Math.max(25, Math.min(75, saved)) : 45;
    } catch { return 45; }
  });
  const task1Ref = useRef(task1);
  const task2Ref = useRef(task2);
  const dirtyRef = useRef(initial.task1.localWon || initial.task2.localWon);
  const finalizedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef({
    task1: initial.task1.localWon ? '' : initial.task1.text,
    task2: initial.task2.localWon ? '' : initial.task2.text,
  });
  const draggingRef = useRef(false);
  const splitRef = useRef<HTMLDivElement | null>(null);

  task1Ref.current = task1;
  task2Ref.current = task2;

  const cancelTimer = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
    cancelTimer();
    if (finalizedRef.current || !dirtyRef.current) return inFlightRef.current || Promise.resolve();
    if (inFlightRef.current && !keepalive) return inFlightRef.current;
    if (keepalive) abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const body = { task1_text: task1Ref.current, task2_text: task2Ref.current };
    setSaveCue('saving');
    const request = window.api.postWith(
      `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/writing`,
      body,
      undefined,
      { keepalive, signal: controller.signal },
    ).then(() => {
      if (generation !== generationRef.current) return;
      lastSavedRef.current = { task1: body.task1_text, task2: body.task2_text };
      retryRef.current = 0;
      if (task1Ref.current === body.task1_text && task2Ref.current === body.task2_text) {
        dirtyRef.current = false;
        writeLocalDraft(sittingId, 'task1', body.task1_text, true);
        writeLocalDraft(sittingId, 'task2', body.task2_text, true);
        setSavedAt(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
        setSaveCue('saved');
      }
    }).catch((caught: unknown) => {
      if (isAbort(caught) || generation !== generationRef.current) return;
      setSaveCue('failed');
      if (retryRef.current < 6 && !finalizedRef.current) {
        retryRef.current += 1;
        timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, 5_000);
      }
    }).finally(() => {
      if (generation === generationRef.current) {
        inFlightRef.current = null;
        abortRef.current = null;
        if (dirtyRef.current && !timerRef.current && !finalizedRef.current) {
          timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, 15_000);
        }
      }
    });
    inFlightRef.current = request;
    return request;
  }, [cancelTimer, sittingId]);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
    retryRef.current = 0;
    const delta = Math.abs(task1Ref.current.length - lastSavedRef.current.task1.length)
      + Math.abs(task2Ref.current.length - lastSavedRef.current.task2.length);
    if (delta >= 400 && !inFlightRef.current) { void flush(); return; }
    if (timerRef.current == null) {
      timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, 15_000);
    }
  }, [flush]);

  const edit = useCallback((which: 'task1' | 'task2', value: string) => {
    if (locked) return;
    if (which === 'task1') { task1Ref.current = value; setTask1(value); }
    else { task2Ref.current = value; setTask2(value); }
    writeLocalDraft(sittingId, which, value, false);
    schedule();
  }, [locked, schedule, sittingId]);

  useEffect(() => {
    if (initial.task1.localWon || initial.task2.localWon) void flush();
  }, [flush, initial.task1.localWon, initial.task2.localWon]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 860px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const pagehide = () => { void flush({ keepalive: true }); };
    const hidden = () => { if (document.visibilityState === 'hidden') void flush({ keepalive: true }); };
    const online = () => { void flush(); };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [flush]);

  useEffect(() => {
    const bridge: WritingBridge = {
      async flush() {
        await flush();
        if (dirtyRef.current) throw new Error('mock-writing-flush-failed');
      },
      async finalize() {
        finalizedRef.current = true;
        cancelTimer();
        const active = inFlightRef.current;
        if (active) { try { await active; } catch {} }
        abortRef.current?.abort();
        return { task1_text: task1Ref.current, task2_text: task2Ref.current };
      },
    };
    register(bridge);
    return () => register(null);
  }, [cancelTimer, register]);

  useEffect(() => () => {
    cancelTimer();
    if (!finalizedRef.current) void flush({ keepalive: true });
  }, [cancelTimer, flush]);

  const setPreferredLayout = (next: Layout) => {
    setLayout(next);
    try { localStorage.setItem('mock-writing-layout', next); } catch {}
  };
  const setPreferredSplit = (next: number) => {
    const clamped = Math.max(25, Math.min(75, next));
    setSplit(clamped);
    try { localStorage.setItem('mock-writing-split', String(clamped)); } catch {}
  };
  const effectiveLayout = () => window.matchMedia('(max-width: 860px)').matches ? 'top' : layout;
  const moveDivider = (clientX: number, clientY: number) => {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    const effective = effectiveLayout();
    const raw = effective === 'left' ? (clientX - box.left) / box.width
      : effective === 'right' ? (box.right - clientX) / box.width
        : effective === 'top' ? (clientY - box.top) / box.height
          : (box.bottom - clientY) / box.height;
    setPreferredSplit(raw * 100);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    moveDivider(event.clientX, event.clientY);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyDivider = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const base = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!base) return;
    const effective = effectiveLayout();
    const direction = effective === 'right' || effective === 'bottom' ? -base : base;
    setPreferredSplit(split + direction * 2);
    event.preventDefault();
  };
  const prompt = task === 'task1' ? state.exam.writingTask1 : state.exam.writingTask2;
  const value = task === 'task1' ? task1 : task2;
  const splitStyle = { '--mw-split': `${split}%` } as CSSProperties;

  return (
    <div className="me-writing">
      <div className="mw-toolbar">
        <div className="me-wtabs" role="tablist" aria-label="Chọn task">
          {(['task1', 'task2'] as const).map((name, index) => (
            <button
              aria-selected={task === name}
              className={`me-tab${task === name ? ' active' : ''}`}
              key={name}
              role="tab"
              type="button"
              onClick={() => setTask(name)}
            >Task {index + 1}</button>
          ))}
        </div>
        <span className={`mw-savecue${saveCue === 'failed' ? ' is-failed' : ''}`} role="status" aria-live="polite">
          {saveCue === 'saving' ? 'Đang lưu…' : saveCue === 'saved' ? `Đã lưu lúc ${savedAt}`
            : saveCue === 'failed' ? 'Chưa lưu được lên máy chủ — bài vẫn giữ trên máy này, sẽ tự thử lại.' : ''}
        </span>
        <div className="mw-layout" role="group" aria-label="Bố cục đề và khung viết">
          <span className="mw-layout__label">Bố cục đề:</span>
          {(['left', 'right', 'top', 'bottom'] as const).map((name) => (
            <button
              aria-pressed={layout === name}
              className="mw-layout__btn"
              key={name}
              type="button"
              onClick={() => setPreferredLayout(name)}
            >
              <span className={`mw-glyph mw-glyph--${name}`} aria-hidden="true" />
              {{ left: 'Trái', right: 'Phải', top: 'Trên', bottom: 'Dưới' }[name]}
            </button>
          ))}
        </div>
      </div>
      <div className="mw-split" data-layout={layout} ref={splitRef} style={splitStyle}>
        <section className="mw-pane mw-pane--prompt" aria-label="Đề bài">
          <div className="me-muted me-prompt-text">
            {prompt ? <>{prompt.title ? <strong>{prompt.title} — </strong> : null}{prompt.promptText}</> : `(Không có đề ${task === 'task1' ? 'Task 1' : 'Task 2'})`}
          </div>
          {task === 'task1' && prompt?.promptImageUrl ? <img className="me-prompt-image" src={prompt.promptImageUrl} alt="Biểu đồ hoặc hình minh hoạ của đề Task 1" /> : null}
        </section>
        <div
          aria-label="Kéo để đổi tỉ lệ đề / khung viết"
          aria-orientation={narrow || layout === 'top' || layout === 'bottom' ? 'horizontal' : 'vertical'}
          aria-valuemax={75}
          aria-valuemin={25}
          aria-valuenow={Math.round(split)}
          className={`mw-divider${draggingRef.current ? ' is-dragging' : ''}`}
          role="separator"
          tabIndex={0}
          onKeyDown={keyDivider}
          onPointerCancel={pointerUp}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
        />
        <section className="mw-pane mw-pane--editor" aria-label="Khung viết bài">
          <textarea
            aria-label={`Bài viết ${task === 'task1' ? 'Task 1' : 'Task 2'}`}
            className="me-essay"
            placeholder={`Viết ${task === 'task1' ? 'Task 1' : 'Task 2'}…`}
            readOnly={locked}
            value={value}
            onChange={(event) => edit(task, event.target.value)}
          />
          <div className="me-count">{mockWordCount(value)} từ</div>
        </section>
      </div>
    </div>
  );
}

export function MockExamRunner() {
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  const queryKey = searchParams?.toString() || '';
  const params = useMemo(() => {
    try { return { value: mockExamParams(queryKey), error: null }; }
    catch { return { value: null, error: 'Thiếu mã kỳ thi (?code=) hoặc mã lượt thi (?sitting=).' }; }
  }, [queryKey]);
  const [state, setState] = useState<MockState | null>(null);
  const [fatal, setFatal] = useState<string | null>(params.error);
  const [connection, setConnection] = useState<ConnectionState>(null);
  const [remaining, setRemaining] = useState(0);
  const [starting, setStarting] = useState<Section | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [openingSpeaking, setOpeningSpeaking] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [flushedCollectionKey, setFlushedCollectionKey] = useState<string | null>(null);
  const stateRef = useRef<MockState | null>(null);
  const stateReadGenerationRef = useRef(0);
  const bootRef = useRef(0);
  const ownerRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pollingRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const submittingRef = useRef(false);
  const owedSubmitRef = useRef<Section | null>(null);
  const submitTimersRef = useRef<Set<number>>(new Set());
  const activeSectionRef = useRef<Section | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const writingBridgeRef = useRef<WritingBridge | null>(null);
  const finalWritingBodyRef = useRef<{ task1_text: string; task2_text: string } | null>(null);
  const timerAnchorRef = useRef({ section: null as Section | null, seconds: 0, at: 0 });
  const timerSubmitTriggeredRef = useRef<Section | null>(null);
  const submitRef = useRef<(section: Section, attempt?: number) => Promise<void>>(async () => {});
  const integrityRef = useRef<Record<string, number> | null>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const currentSittingRef = useRef<string | null>(null);

  stateRef.current = state;
  const view = state ? mockExamView(state) : 'loading';
  const activeSection = view === 'section' ? state?.activeSection as Section : null;
  const pendingCollectionSection = state
    && (state.collectedSection === 'listening'
      || state.collectedSection === 'reading'
      || state.collectedSection === 'writing')
    && state.activeSection === state.collectedSection
    && !submittedAtFor(state, state.collectedSection)
    ? state.collectedSection
    : null;
  const collectionKey = pendingCollectionSection && state
    ? `${state.sitting.id}:${pendingCollectionSection}`
    : null;
  const awaitingCollectionFlush = Boolean(collectionKey && collectionKey !== flushedCollectionKey);
  const renderedSection = activeSection || (awaitingCollectionFlush ? pendingCollectionSection : null);
  activeSectionRef.current = activeSection;
  currentSittingRef.current = state?.sitting.id || null;

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!params.error) return;
    stateReadGenerationRef.current += 1;
    controllerRef.current?.abort();
    setState(null);
    setFatal(params.error);
  }, [params.error]);

  const commitState = useCallback((next: MockState) => {
    if (ownerRef.current && next.sitting.userId && ownerRef.current !== next.sitting.userId) {
      throw new Error('mock-sitting-owner-mismatch');
    }
    if (next.sitting.writingSubmittedAt) {
      const localDrafts = {
        task1: readLocalDraft(next.sitting.id, 'task1'),
        task2: readLocalDraft(next.sitting.id, 'task2'),
      };
      if (canDiscardWritingDrafts(next.sitting.writingSubmission, localDrafts)) {
        clearLocalDrafts(next.sitting.id);
        finalWritingBodyRef.current = null;
      }
    }
    stateRef.current = next;
    setState(next);
    if (next.sitting.status === 'released') {
      window.location.replace(`/mock/result?sitting=${encodeURIComponent(next.sitting.id)}`);
    }
    return next;
  }, []);

  const loadState = useCallback(async (sittingId?: string, signal?: AbortSignal) => {
    const id = sittingId || currentSittingRef.current;
    if (!id) throw new Error('missing-mock-sitting');
    const generation = ++stateReadGenerationRef.current;
    const payload = signal
      ? await window.api.getWith(`/api/mock-exams/sittings/${encodeURIComponent(id)}`, undefined, { signal })
      : await window.api.get(`/api/mock-exams/sittings/${encodeURIComponent(id)}`);
    const next = normalizeMockExamState(payload, id) as MockState;
    if (generation !== stateReadGenerationRef.current) return next;
    return commitState(next);
  }, [commitState]);

  const integrityKey = useCallback(() => currentSittingRef.current ? `mock-integrity:${currentSittingRef.current}` : null, []);
  const loadIntegrity = useCallback(() => {
    if (integrityRef.current) return integrityRef.current;
    const key = integrityKey();
    let parsed = null;
    try { parsed = key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch {}
    integrityRef.current = normalizeIntegrity(parsed);
    return integrityRef.current;
  }, [integrityKey]);
  const bumpIntegrity = useCallback((key: string, by = 1) => {
    const values = loadIntegrity();
    values[key] = (values[key] || 0) + by;
    const storageKey = integrityKey();
    try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(values)); } catch {}
  }, [integrityKey, loadIntegrity]);
  const reportIntegrity = useCallback((keepalive = false) => {
    const sittingId = currentSittingRef.current;
    if (!sittingId) return;
    const values = loadIntegrity();
    if (!(values.blur_count || values.resumes || values.offline_events)) return;
    void window.api.postWith(
      `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/integrity`,
      values,
      undefined,
      { keepalive },
    ).catch(() => {});
  }, [loadIntegrity]);

  useEffect(() => {
    if (status !== 'signed-in' || !user?.id || !params.value) return undefined;
    const boot = ++bootRef.current;
    stateReadGenerationRef.current += 1;
    ownerRef.current = user.id;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    integrityRef.current = null;
    setFatal(null);
    setConnection(null);
    setState(null);

    (async () => {
      const ready = await whenGlobalReady(
        () => typeof window.api?.getWith === 'function' && typeof window.api?.postWith === 'function',
        'window.api (mock exam)',
      );
      if (!ready || controller.signal.aborted || boot !== bootRef.current) return;
      try {
        let sittingId = params.value.sittingId;
        let createdNow = false;
        if (!sittingId) {
          const created = await retryIdempotent<any>(() => window.api.post(
            `/api/mock-exams/${encodeURIComponent(params.value!.code!)}/sittings`,
            {},
          ));
          sittingId = String(created?.id || '').trim();
          createdNow = created?.created === true;
          if (!sittingId) throw new Error('invalid-open-sitting-response');
        }
        currentSittingRef.current = sittingId;
        const next = await loadState(sittingId, controller.signal);
        if (controller.signal.aborted || boot !== bootRef.current) return;
        if (!createdNow && MOCK_LIVE_STATUSES.includes(next.sitting.status)) bumpIntegrity('resumes');
        reportIntegrity();
        const debt = (window as any).SpeakingDebt;
        if (debt && typeof debt.retryAll === 'function') debt.retryAll();
      } catch (caught) {
        if (controller.signal.aborted || boot !== bootRef.current || isAbort(caught)) return;
        setFatal(userMessage(caught, 'Không thể tải trạng thái kỳ thi. Hãy thử lại hoặc liên hệ giám thị.'));
      }
    })();
    return () => controller.abort();
  }, [bumpIntegrity, loadState, params.value, reloadNonce, reportIntegrity, status, user?.id]);

  useEffect(() => {
    if (!state || !MOCK_LIVE_STATUSES.includes(state.sitting.status) || fatal) return undefined;
    let disposed = false;
    const poll = async () => {
      if (pollingRef.current || disposed) return;
      pollingRef.current = true;
      try {
        await loadState();
        if (disposed) return;
        if (pollFailuresRef.current) { pollFailuresRef.current = 0; setConnection(null); }
        const owed = owedSubmitRef.current;
        if (owed && !submittingRef.current) {
          if (isMockSubmitSettled(stateRef.current, owed)) {
            owedSubmitRef.current = null;
            setConnection(null);
          } else {
            owedSubmitRef.current = null;
            void submitRef.current(owed);
          }
        }
      } catch (caught) {
        if (disposed || isAbort(caught)) return;
        const statusCode = statusOf(caught);
        if (statusCode === 403 || statusCode === 404) {
          setFatal(userMessage(caught, 'Lượt thi này không còn truy cập được.'));
          return;
        }
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= 2 && !submittingRef.current) setConnection('offline');
      } finally { pollingRef.current = false; }
    };
    const interval = window.setInterval(poll, POLL_MS);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [fatal, loadState, state?.sitting.id, state?.sitting.status]);

  const closeHiddenInterval = useCallback(() => {
    if (hiddenAtRef.current == null) return false;
    bumpIntegrity('blur_seconds', Math.round((Date.now() - hiddenAtRef.current) / 1000));
    hiddenAtRef.current = null;
    return true;
  }, [bumpIntegrity]);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!activeSectionRef.current) return;
        hiddenAtRef.current = Date.now();
        bumpIntegrity('blur_count');
      } else if (closeHiddenInterval()) reportIntegrity();
    };
    const offline = () => {
      if (!activeSectionRef.current) return;
      bumpIntegrity('offline_events');
      setConnection('offline');
    };
    const online = () => {
      pollFailuresRef.current = 0;
      void loadState().then(() => {
        setConnection(null);
        const owed = owedSubmitRef.current;
        if (owed && !submittingRef.current) {
          if (isMockSubmitSettled(stateRef.current, owed)) {
            owedSubmitRef.current = null;
            setConnection(null);
          } else {
            owedSubmitRef.current = null;
            void submitRef.current(owed);
          }
        }
      }).catch(() => {});
    };
    const pagehide = () => { closeHiddenInterval(); reportIntegrity(true); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', pagehide);
    };
  }, [bumpIntegrity, closeHiddenInterval, loadState, reportIntegrity]);

  const flushEmbed = useCallback((section: Section) => new Promise<void>((resolve, reject) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) { resolve(); return; }
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', message);
      if (error) reject(error); else resolve();
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'mock-flushed' || event.data?.section !== section) return;
      const unsaved = Number(event.data?.unsaved || 0);
      finish(unsaved > 0 ? new Error('mock-embed-unsaved-answers') : undefined);
    };
    window.addEventListener('message', message);
    frame.contentWindow.postMessage({ type: 'mock-flush' }, window.location.origin);
    window.setTimeout(() => finish(new Error('mock-embed-flush-timeout')), 3_000);
  }), []);

  const acknowledgeCollectionFlush = useCallback(async (section: Section) => {
    const sittingId = currentSittingRef.current;
    if (!sittingId) throw new Error('missing-mock-sitting');
    await window.api.post(
      `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/sections/${section}/flush-ack`,
      {},
    );
  }, []);

  useEffect(() => {
    if (!collectionKey || !pendingCollectionSection || !awaitingCollectionFlush) return undefined;
    let disposed = false;
    let retryTimer: number | null = null;
    const drain = async () => {
      try {
        if (pendingCollectionSection === 'writing') {
          const bridge = writingBridgeRef.current;
          if (!bridge) throw new Error('missing-writing-bridge');
          await bridge.flush();
        } else {
          await flushEmbed(pendingCollectionSection);
        }
        await acknowledgeCollectionFlush(pendingCollectionSection);
        if (!disposed) setFlushedCollectionKey(collectionKey);
      } catch {
        if (!disposed) retryTimer = window.setTimeout(() => { void drain(); }, 1_000);
      }
    };
    void drain();
    return () => {
      disposed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [acknowledgeCollectionFlush, awaitingCollectionFlush, collectionKey, flushEmbed, pendingCollectionSection]);

  useEffect(() => {
    if (!collectionKey && flushedCollectionKey) setFlushedCollectionKey(null);
  }, [collectionKey, flushedCollectionKey]);

  const doSubmit = useCallback(async (section: Section) => {
    const current = stateRef.current;
    if (!current) throw new Error('missing-mock-state');
    const sittingId = current.sitting.id;
    if (section === 'writing') {
      if (!finalWritingBodyRef.current) {
        finalWritingBodyRef.current = await writingBridgeRef.current?.finalize()
          || { task1_text: '', task2_text: '' };
      }
      await window.api.post(
        `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/sections/writing/submit`,
        finalWritingBodyRef.current,
      );
      clearLocalDrafts(sittingId);
      return;
    }

    await flushEmbed(section);
    const fresh = await loadState(sittingId);
    const attemptId = section === 'reading'
      ? fresh.sitting.readingAttemptId
      : fresh.sitting.listeningAttemptId;
    if (!attemptId) throw Object.assign(new Error('mock-attempt-not-attached'), { status: 409 });
    const domainPath = section === 'reading'
      ? `/api/reading/test/attempts/${encodeURIComponent(attemptId)}/submit`
      : `/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/submit`;
    await window.api.post(domainPath, section === 'reading' ? { answers: [] } : {});
    await window.api.post(
      `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/sections/${section}/submit`,
      {},
    );
  }, [flushEmbed, loadState]);

  const submitSection = useCallback(async (section: Section, attempt = 0) => {
    if (submittingRef.current && attempt === 0) return;
    if (attempt > 0 && isMockSubmitSettled(stateRef.current, section)) {
      submittingRef.current = false;
      owedSubmitRef.current = null;
      setConnection(null);
      return;
    }
    submittingRef.current = true;
    try {
      await doSubmit(section);
      owedSubmitRef.current = null;
      setConnection(null);
      finalWritingBodyRef.current = null;
      await loadState().catch(() => {});
      submittingRef.current = false;
    } catch (caught) {
      const statusCode = statusOf(caught);
      if (statusCode === 403 || statusCode === 404) {
        submittingRef.current = false;
        setFatal(userMessage(caught, 'Không nộp được bài. Liên hệ giám thị.'));
        return;
      }
      if (statusCode === 409 || statusCode === 422) {
        try { await loadState(); } catch {}
        if (isMockSubmitSettled(stateRef.current, section)) {
          submittingRef.current = false;
          owedSubmitRef.current = null;
          setConnection(null);
          finalWritingBodyRef.current = null;
          return;
        }
      }
      if (attempt < SUBMIT_RETRY_DELAYS.length) {
        setConnection('submitting');
        const handle = window.setTimeout(() => {
          submitTimersRef.current.delete(handle);
          void submitSection(section, attempt + 1);
        }, SUBMIT_RETRY_DELAYS[attempt]);
        submitTimersRef.current.add(handle);
        return;
      }
      submittingRef.current = false;
      owedSubmitRef.current = section;
      setConnection('submit_failed');
    }
  }, [doSubmit, loadState]);
  submitRef.current = submitSection;

  useEffect(() => () => {
    for (const timer of submitTimersRef.current) window.clearTimeout(timer);
    submitTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!activeSection || state?.sectionTimeLeftSeconds == null) return undefined;
    // A fresh clock for the same retake section opens a new one-shot window.
    // A zero-second poll refresh must not clear the latch and restart a retry
    // ladder that already exhausted itself.
    if (state.sectionTimeLeftSeconds > 0
        && timerSubmitTriggeredRef.current === activeSection) {
      timerSubmitTriggeredRef.current = null;
    }
    timerAnchorRef.current = { section: activeSection, seconds: state.sectionTimeLeftSeconds, at: Date.now() };
    const tick = () => {
      const anchor = timerAnchorRef.current;
      if (anchor.section !== activeSection) return;
      const next = Math.max(0, anchor.seconds - Math.floor((Date.now() - anchor.at) / 1_000));
      setRemaining(next);
      if (next === 0) {
        const alreadyTriggered = timerSubmitTriggeredRef.current === activeSection;
        timerSubmitTriggeredRef.current = activeSection;
        if (!alreadyTriggered && !submittingRef.current) void submitRef.current(activeSection);
      }
    };
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [activeSection, state?.sectionTimeLeftSeconds]);

  useEffect(() => {
    const settled = isMockSubmitSettled(state, 'writing');
    if (settled || (activeSection === 'writing' && !submittingRef.current)) {
      finalWritingBodyRef.current = null;
    }
  }, [activeSection, state?.activeSection, state?.sitting.status, state?.sitting.writingSubmittedAt]);

  const startRetake = useCallback(async (section: Section) => {
    const sittingId = stateRef.current?.sitting.id;
    if (!sittingId || starting) return;
    setStarting(section);
    setStartError(null);
    try {
      await window.api.post(
        `/api/mock-exams/sittings/${encodeURIComponent(sittingId)}/sections/${section}/start`,
        {},
      );
      await loadState(sittingId);
    } catch (caught) {
      setStartError(userMessage(caught, 'Không bắt đầu được phần thi. Hãy thử lại.'));
    } finally { setStarting(null); }
  }, [loadState, starting]);

  const startSpeaking = useCallback(async () => {
    const current = stateRef.current;
    if (!current || openingSpeaking) return;
    setOpeningSpeaking(true);
    try {
      const response = await window.api.post<any>('/sessions', {
        mode: 'test_full',
        part: 1,
        topic: mockSpeakingTopic(current),
        sitting_id: current.sitting.id,
      });
      const sessionId = String(response?.session_id || response?.id || '').trim();
      if (!sessionId) throw new Error('invalid-speaking-session');
      window.location.assign(mockSpeakingHref(sessionId));
    } catch (caught) {
      setFatal(userMessage(caught, 'Không mở được phần Speaking. Hãy thử lại hoặc liên hệ giám thị.'));
      setOpeningSpeaking(false);
    }
  }, [openingSpeaking]);

  const registerWriting = useCallback((bridge: WritingBridge | null) => {
    writingBridgeRef.current = bridge;
  }, []);
  const frameSrc = useMemo(() => {
    if (!state || !renderedSection || renderedSection === 'writing') return null;
    try { return mockPlayerHref(state, renderedSection); } catch { return null; }
  }, [renderedSection, state?.exam.listeningTestId, state?.exam.readingTestCode, state?.sitting.id]);

  if (status === 'initial-loading' || (!state && !fatal)) return <MockExamRunnerLoading />;
  if (fatal) return <ErrorCard message={fatal} retry={() => setReloadNonce((value) => value + 1)} />;
  if (!state) return <MockExamRunnerLoading />;
  if (view === 'void') return <ErrorCard message="Kỳ thi đã bị huỷ. Liên hệ giám khảo để được cấp lượt mới." />;
  if ((view === 'waiting' || view === 'retake-menu') && !awaitingCollectionFlush) {
    return (
      <>
        {connection ? <div className="me-conn-banner" role="status" aria-live="polite">{CONNECTION_MESSAGES[connection]}</div> : null}
        <WaitingRoom state={state} code={params.value?.code || null} onStart={startRetake} starting={starting} startError={startError} />
      </>
    );
  }
  if (view === 'submitted') return <SubmittedCard state={state} onSpeaking={startSpeaking} openingSpeaking={openingSpeaking} />;
  if (view === 'released') return <MockExamRunnerLoading />;

  return (
    <main className="me-test-shell">
      {connection ? <div className="me-conn-banner" role="status" aria-live="polite">{CONNECTION_MESSAGES[connection]}</div> : null}
      {awaitingCollectionFlush ? <div className="me-conn-banner" role="status" aria-live="polite">Đang lưu câu trả lời cuối cùng…</div> : null}
      <header className="me-bar">
        <span className={`me-timer${remaining <= WARN_SECONDS ? ' warn' : ''}`} role="timer">{formatMockTime(remaining)}</span>
        <div className="me-section-label">{renderedSection ? MOCK_SECTION_LABELS[renderedSection] : ''}</div>
        <span className="me-save-note">Tự động lưu bài</span>
      </header>
      {remaining <= WARN_SECONDS ? <div className="me-warn-banner" role="status">⚠ Sắp hết giờ phần này — bài sẽ tự nộp khi hết giờ.</div> : null}
      <section className="me-panels" aria-label={renderedSection ? `Phần thi ${renderedSection}` : 'Phần thi'}>
        {renderedSection === 'writing'
          ? <WritingWorkspace key={state.sitting.id} state={state} register={registerWriting} locked={awaitingCollectionFlush} />
          : frameSrc
            ? <iframe inert={awaitingCollectionFlush} ref={frameRef} src={frameSrc} title={`Bài thi ${renderedSection}`} />
            : <ErrorCard message="Kỳ thi thiếu nội dung cho phần đang mở. Liên hệ giám thị." />}
      </section>
    </main>
  );
}
