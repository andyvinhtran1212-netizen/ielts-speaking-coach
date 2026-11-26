'use client';

// EXAMMOCK-0071 T002 part B (G08-T16): the Writing section of a mock test in
// the exam room (FR-006) with the account-bound copy on this device (FR-010).
// The save request belongs to the runner (`saveWriting`); this file keeps the
// boxes, the save rhythm of the old workspace (15 s after typing, at once
// after 400 characters, 5 s retries up to 6) and the copy.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ExamRoomSaveStatus } from '@/components/exam-room/types';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import {
  type LocalCopy, type LocalCopyAnswer, readLocalCopy, removeAckedFromCopy, writeLocalCopy, localCopyExpiry,
} from '@/lib/exam-room/local-copy.mjs';
import {
  MOCK_LIVE_STATUSES, MOCK_WRITING_GUIDANCE, legacyMockWritingKey, legacyRemovable, mockWordCount,
  parseLocalWritingDraft, reconcileMockWritingCopy,
} from '@/lib/mock-exam-model.mjs';

import type { MockState } from './mock-exam-runner';

export type WritingTask = 'task1' | 'task2';
type Texts = Record<WritingTask, string>;
export interface MockWritingBridge {
  flush(): Promise<void>;
  finalize(): Promise<{ task1_text: string; task2_text: string }>;
  /** FR-010 on leave / re-sign-in: write both boxes now and read them back. */
  saveLocalCopy(): boolean;
  /** Typed text the server has not acked yet, debounce included (shell loss guard). */
  hasUnsavedText(): boolean;
}

export interface MockWritingRoomProps {
  state: MockState;
  ownerKey: string;
  /** Time is up or the invigilator collects: boxes are read-only. */
  locked: boolean;
  /** Another tab holds the write right (FR-013): no save, no copy writes. */
  readOnly: boolean;
  register(bridge: MockWritingBridge | null): void;
  saveWriting(body: { task1_text: string; task2_text: string }, opts: { keepalive?: boolean; signal?: AbortSignal }): Promise<unknown>;
  onSaveStatus(status: ExamRoomSaveStatus): void;
  /** Tests only. */
  storage?: Storage | null;
}

const TASKS: readonly WritingTask[] = ['task1', 'task2'];
const SAVE_DELAY_MS = 15_000;
const RETRY_MS = 5_000;
const MAX_RETRIES = 6;
const SAVE_AT_CHARS = 400;

export const MOCK_WRITING_COPY = {
  task: (t: WritingTask) => (t === 'task1' ? 'Task 1' : 'Task 2'),
  words: (n: number, min: number) => `Words: ${n} · minimum ${min}`,
  ask: (t: WritingTask) => `This device has a different version of your ${t === 'task1' ? 'Task 1' : 'Task 2'} answer.`,
  askVi: 'Máy này có một bản khác của bài viết. Bạn chọn bản muốn giữ.',
  useDevice: 'Use the text on this device',
  keepSaved: 'Keep the saved text',
  answer: (t: WritingTask) => `Answer for ${t === 'task1' ? 'Task 1' : 'Task 2'}`,
  noPrompt: (t: WritingTask) => `(No question available for ${t === 'task1' ? 'Task 1' : 'Task 2'})`,
  imageFailed: 'The Task 1 chart could not be loaded. Retrying automatically — tell your invigilator if it does not appear.',
} as const;

function safeStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function readLegacy(storage: Storage | null, sittingId: string, task: WritingTask) {
  if (!storage) return null;
  try { return parseLocalWritingDraft(storage.getItem(legacyMockWritingKey(sittingId, task))); } catch { return null; }
}

function removeLegacy(storage: Storage | null, sittingId: string, task: WritingTask) {
  try { storage?.removeItem(legacyMockWritingKey(sittingId, task)); } catch { /* storage unavailable */ }
}

type Ask = { task: WritingTask; local: string; server: string; source: 'copy' | 'legacy' };

/**
 * FR-010 on open: compare the copies with the server text (never by time) and
 * decide the starting text of each box. Runs once per sitting, before typing.
 */
export function openWritingCopies({ state, ownerKey, storage, now = Date.now() }: {
  state: MockState; ownerKey: string; storage: Storage | null; now?: number;
}) {
  const sittingId = state.sitting.id;
  const scope = { surface: 'mock', ownerKey, attemptKey: sittingId };
  const server: Texts = { task1: state.sitting.writingSubmission.task1.text || '', task2: state.sitting.writingSubmission.task2.text || '' };
  const open = !state.sitting.writingSubmittedAt && MOCK_LIVE_STATUSES.includes(state.sitting.status);
  const copy: LocalCopy | null = ownerKey ? readLocalCopy(storage, { ...scope, now }) : null;
  const ownerMatches = Boolean(ownerKey) && state.sitting.userId === ownerKey;
  const legacy = ownerMatches
    ? { task1: readLegacy(storage, sittingId, 'task1'), task2: readLegacy(storage, sittingId, 'task2') }
    : {};
  const plan = reconcileMockWritingCopy({ copy, legacy, server: { open, ...server }, ownerMatches });
  const texts: Texts = { ...server };
  for (const r of plan.resend) texts[r.task as WritingTask] = String(r.value);
  if (plan.dropFromCopy.length) removeAckedFromCopy(storage, { ...scope, entries: plan.dropFromCopy, now });
  for (const task of plan.dropLegacy) removeLegacy(storage, sittingId, task as WritingTask);
  if (plan.migrate.length && ownerKey) {
    // Legacy text has no base: written without one, so it stays "ask" next time too.
    const answers = Object.fromEntries(plan.migrate.map((m) => [m.q, { value: m.value } as LocalCopyAnswer]));
    writeLocalCopy(storage, { ...scope, answers, expiresAt: localCopyExpiry({ now }), now });
    const back = readLocalCopy(storage, { ...scope, now });
    for (const m of plan.migrate) {
      const readBack = back?.answers?.[m.q]?.value;
      if (legacyRemovable({ legacyText: m.value, readBack: typeof readBack === 'string' ? readBack : null })) {
        removeLegacy(storage, sittingId, m.q as WritingTask);
      }
    }
  }
  return { texts, server, resend: plan.resend.map((r) => r.task as WritingTask), ask: plan.ask as Ask[] };
}

/**
 * FR-010/FR-013 when this tab gains the write right: the runner has just
 * reloaded the server text (`reloadFromServer` runs before the guard says
 * `writer`), so the boxes are compared with it before they unlock or submit.
 * Per task: same text → nothing; this tab had nothing unsaved → take the server
 * text; unsaved here and the server still at our last ack → keep ours and
 * re-send; unsaved here and the server moved on → show the server text and ask,
 * never overwriting either side.
 */
export function reconcileOnWriteRight({ texts, acked, server }: { texts: Texts; acked: Texts; server: Texts }) {
  const next: Texts = { ...texts };
  const nextAcked: Texts = { ...acked };
  const resend: WritingTask[] = [];
  const ask: Ask[] = [];
  for (const t of TASKS) {
    nextAcked[t] = server[t];
    if (texts[t] === server[t]) continue;
    if (texts[t] === acked[t]) { next[t] = server[t]; continue; }
    if (server[t] === acked[t]) { nextAcked[t] = acked[t]; resend.push(t); continue; }
    next[t] = server[t];
    ask.push({ task: t, local: texts[t], server: server[t], source: 'copy' });
  }
  return { texts: next, acked: nextAcked, resend, ask };
}

function serverTexts(state: MockState): Texts {
  return { task1: state.sitting.writingSubmission.task1.text || '', task2: state.sitting.writingSubmission.task2.text || '' };
}

export function MockWritingRoom(props: MockWritingRoomProps) {
  const { state, ownerKey, locked, readOnly, register, saveWriting, onSaveStatus } = props;
  const sittingId = state.sitting.id;
  const storage = useMemo(() => (props.storage !== undefined ? props.storage : safeStorage()), [props.storage]);
  const scope = useMemo(() => ({ surface: 'mock', ownerKey, attemptKey: sittingId }), [ownerKey, sittingId]);
  const opened = useMemo(() => openWritingCopies({ state, ownerKey, storage }), [sittingId, ownerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [task, setTask] = useState<WritingTask>('task1');
  const [texts, setTexts] = useState<Texts>(opened.texts);
  const [asks, setAsks] = useState<Ask[]>(opened.ask);
  /** FR-010: tasks whose device version waits for the learner's choice. */
  const unresolvedRef = useRef<Set<WritingTask>>(new Set(opened.ask.map((a) => a.task)));
  unresolvedRef.current = new Set(asks.map((a) => a.task));
  const textsRef = useRef<Texts>(opened.texts);
  textsRef.current = texts;
  /** Text the server acked last per task: the copy's `baseValue` (FR-010). */
  const ackedRef = useRef<Texts>({ ...opened.server });
  const dirtyRef = useRef(opened.resend.length > 0);
  const finalizedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastSavedAtRef = useRef<Date | undefined>(undefined);
  const lockedRef = useRef(locked || readOnly);
  lockedRef.current = locked || readOnly;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const statusRef = useRef(onSaveStatus);
  statusRef.current = onSaveStatus;

  const report = useCallback((status: ExamRoomSaveStatus) => statusRef.current(status), []);

  const writeCopy = useCallback((tasks: readonly WritingTask[] = TASKS): boolean => {
    if (!ownerKey || readOnlyRef.current) return false;
    // FR-010 (Codex P1 on #2715): an unresolved device version is never
    // replaced by an automatic snapshot (edit, pagehide, hidden, unmount);
    // it stays until the learner chooses.
    const writable = tasks.filter((t) => !unresolvedRef.current.has(t));
    if (!writable.length) return true;
    const answers = Object.fromEntries(writable.map((t) => [t, { value: textsRef.current[t], baseValue: ackedRef.current[t] }]));
    return writeLocalCopy(storage, { ...scope, answers, expiresAt: localCopyExpiry({}) });
  }, [ownerKey, scope, storage]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(async ({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> => {
    cancelTimer();
    if (finalizedRef.current || readOnlyRef.current || !dirtyRef.current) return inFlightRef.current || undefined;
    if (inFlightRef.current && !keepalive) return inFlightRef.current;
    if (keepalive) abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const body = { task1_text: textsRef.current.task1, task2_text: textsRef.current.task2 };
    report({ state: 'saving', lastSavedAt: lastSavedAtRef.current });
    const request = saveWriting(body, { keepalive, signal: controller.signal }).then(() => {
      if (generation !== generationRef.current) return;
      ackedRef.current = { task1: body.task1_text, task2: body.task2_text };
      retryRef.current = 0;
      // The copy keeps only what the server has not acked yet.
      removeAckedFromCopy(storage, { ...scope, entries: [{ q: 'task1', value: body.task1_text }, { q: 'task2', value: body.task2_text }] });
      if (textsRef.current.task1 === body.task1_text && textsRef.current.task2 === body.task2_text) {
        dirtyRef.current = false;
        lastSavedAtRef.current = new Date();
        report({ state: 'saved', lastSavedAt: lastSavedAtRef.current });
      } else {
        writeCopy();
      }
    }).catch((caught: unknown) => {
      if ((caught instanceof DOMException && caught.name === 'AbortError') || generation !== generationRef.current) return;
      if (retryRef.current < MAX_RETRIES && !finalizedRef.current) {
        retryRef.current += 1;
        report({ state: 'retrying', lastSavedAt: lastSavedAtRef.current, unsaved: 1 });
        timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, RETRY_MS);
      } else {
        report({ state: 'failed', lastSavedAt: lastSavedAtRef.current, unsaved: 1, onRetry: () => { retryRef.current = 0; void flush(); } });
      }
    }).finally(() => {
      if (generation === generationRef.current) {
        inFlightRef.current = null;
        abortRef.current = null;
        if (dirtyRef.current && !timerRef.current && !finalizedRef.current) {
          timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, SAVE_DELAY_MS);
        }
      }
    });
    inFlightRef.current = request;
    return request;
  }, [cancelTimer, report, saveWriting, scope, storage, writeCopy]);

  const edit = useCallback((which: WritingTask, value: string) => {
    if (lockedRef.current) return;
    const before = textsRef.current;
    const next = { ...before, [which]: value };
    textsRef.current = next;
    setTexts(next);
    dirtyRef.current = true;
    writeCopy([which]);
    report({ state: 'idle', lastSavedAt: lastSavedAtRef.current });
    const delta = Math.abs(next.task1.length - ackedRef.current.task1.length) + Math.abs(next.task2.length - ackedRef.current.task2.length);
    if (delta >= SAVE_AT_CHARS && !inFlightRef.current && retryRef.current === 0) { void flush(); return; }
    if (timerRef.current == null) timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, SAVE_DELAY_MS);
  }, [flush, report, writeCopy]);

  const choose = useCallback((row: Ask, useDevice: boolean) => {
    setAsks((rows) => rows.filter((r) => r.task !== row.task));
    unresolvedRef.current.delete(row.task);
    if (useDevice) {
      const next = { ...textsRef.current, [row.task]: row.local };
      textsRef.current = next;
      setTexts(next);
      dirtyRef.current = true;
      void flush();
    } else {
      // Keep the saved text: the device version goes (only if it is still that text).
      removeAckedFromCopy(storage, { ...scope, entries: [{ q: row.task, value: row.local }] });
      if (row.source === 'legacy') removeLegacy(storage, sittingId, row.task);
    }
  }, [flush, scope, sittingId, storage]);

  // Gaining the write right (FR-013): compare the boxes with the server text
  // the runner reloaded before the guard said `writer`. Layout effect: runs
  // before the learner can type into the unlocked boxes or a submit reads them.
  const wasReadOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    const gained = wasReadOnlyRef.current && !readOnly;
    wasReadOnlyRef.current = readOnly;
    if (!gained || finalizedRef.current) return;
    const plan = reconcileOnWriteRight({ texts: textsRef.current, acked: ackedRef.current, server: serverTexts(state) });
    cancelTimer();
    textsRef.current = plan.texts;
    ackedRef.current = plan.acked;
    setTexts(plan.texts);
    for (const row of plan.ask) {
      // Keep the device text without a base, so a later open asks again
      // instead of treating the moved server text as newer.
      removeAckedFromCopy(storage, { ...scope, entries: [{ q: row.task, value: row.local }] });
      if (ownerKey) writeLocalCopy(storage, { ...scope, answers: { [row.task]: { value: row.local } as LocalCopyAnswer }, expiresAt: localCopyExpiry({}) });
    }
    for (const row of plan.ask) unresolvedRef.current.add(row.task);
    if (plan.ask.length) setAsks((rows) => [...rows.filter((r) => !plan.ask.some((a) => a.task === r.task)), ...plan.ask]);
    dirtyRef.current = plan.resend.length > 0;
    if (dirtyRef.current) void flush();
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // A copy re-sent on open (server still held its base) goes out at once.
  useEffect(() => { if (opened.resend.length) void flush(); }, [flush, opened.resend.length]);

  useEffect(() => {
    const pagehide = () => { writeCopy(); void flush({ keepalive: true }); };
    const hidden = () => { if (document.visibilityState === 'hidden') { writeCopy(); void flush({ keepalive: true }); } };
    const online = () => { void flush(); };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [flush, writeCopy]);

  useEffect(() => {
    const bridge: MockWritingBridge = {
      async flush() {
        await flush();
        if (dirtyRef.current) throw new Error('mock-writing-flush-failed');
      },
      async finalize() {
        finalizedRef.current = true;
        cancelTimer();
        const active = inFlightRef.current;
        if (active) { try { await active; } catch { /* the submit body carries the text */ } }
        abortRef.current?.abort();
        return { task1_text: textsRef.current.task1, task2_text: textsRef.current.task2 };
      },
      saveLocalCopy() {
        if (!dirtyRef.current) return true;
        if (!writeCopy()) return false;
        const back = readLocalCopy(storage, scope);
        return TASKS.every((t) => (unresolvedRef.current.has(t) || back?.answers?.[t] === undefined
          // An unresolved task keeps the device version in the copy: the box is
          // safe only while it holds nothing the server has not acked.
          ? textsRef.current[t] === ackedRef.current[t]
          : back.answers[t].value === textsRef.current[t]));
      },
      hasUnsavedText() {
        return !finalizedRef.current && dirtyRef.current;
      },
    };
    register(bridge);
    return () => register(null);
  }, [cancelTimer, flush, register, scope, storage, writeCopy]);

  useEffect(() => () => {
    cancelTimer();
    if (!finalizedRef.current) { writeCopy(); void flush({ keepalive: true }); }
  }, [cancelTimer, flush, writeCopy]);

  const prompt = task === 'task1' ? state.exam.writingTask1 : state.exam.writingTask2;
  const disabled = locked || readOnly;
  return (
    // Not `.me-writing`: that old class is `position: absolute; inset: 0` and
    // would lay the tabs over the frame header (Leave test) inside the shell.
    <div className="mw-room" data-mock-writing-room="" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      {asks.map((row) => (
        <Notice
          key={row.task}
          kind="warning"
          lang="en"
          action={(
            <>
              <Button size="sm" onClick={() => choose(row, true)} disabled={disabled}>{MOCK_WRITING_COPY.useDevice}</Button>
              {' '}
              <Button size="sm" variant="secondary" onClick={() => choose(row, false)} disabled={disabled}>{MOCK_WRITING_COPY.keepSaved}</Button>
            </>
          )}
        >
          {MOCK_WRITING_COPY.ask(row.task)}
          <span lang="vi" style={{ display: 'block' }}>{MOCK_WRITING_COPY.askVi}</span>
        </Notice>
      ))}
      <div className="me-wtabs" role="tablist" aria-label="Select task">
        {TASKS.map((name) => (
          <button
            aria-selected={task === name}
            aria-controls={`mock-writing-panel-${name}`}
            className={`me-tab${task === name ? ' active' : ''}`}
            id={`mock-writing-tab-${name}`}
            key={name}
            role="tab"
            type="button"
            onClick={() => setTask(name)}
          >
            <span className="me-tab__label">{MOCK_WRITING_COPY.task(name)}</span>
            <span className="me-tab__status">{MOCK_WRITING_COPY.words(mockWordCount(texts[name]), MOCK_WRITING_GUIDANCE[name].minWords)}</span>
          </button>
        ))}
      </div>
      <div className="mw-split" role="tabpanel" id={`mock-writing-panel-${task}`} aria-labelledby={`mock-writing-tab-${task}`}>
        <section className="mw-pane mw-pane--prompt" aria-label="Question">
          <h2 className="me-h1">{prompt?.title || MOCK_WRITING_COPY.task(task)}</h2>
          <div className="me-prompt-text">{prompt?.promptText || MOCK_WRITING_COPY.noPrompt(task)}</div>
          {task === 'task1' && prompt?.promptImageUrl ? <img className="me-prompt-image" src={prompt.promptImageUrl} alt="Task 1 chart or illustration" /> : null}
          {task === 'task1' && prompt?.promptImageLookupFailed ? <p className="me-prompt-image-failed" role="alert">{MOCK_WRITING_COPY.imageFailed}</p> : null}
        </section>
        <section className="mw-pane mw-pane--editor" aria-label="Your answer">
          <textarea
            aria-label={MOCK_WRITING_COPY.answer(task)}
            aria-describedby={`mock-writing-count-${task}`}
            autoCorrect="off"
            className="me-essay"
            readOnly={disabled}
            spellCheck={false}
            value={texts[task]}
            onChange={(event) => edit(task, event.target.value)}
          />
          <p className="mw-count-row" id={`mock-writing-count-${task}`}>
            {MOCK_WRITING_COPY.words(mockWordCount(texts[task]), MOCK_WRITING_GUIDANCE[task].minWords)}
          </p>
        </section>
      </div>
    </div>
  );
}
