'use client';

// EXAMLISTENP-0069 T002: the exam-room branch of the Listening practice runner.
// `ProgrammeFormRunner` keeps every request, hook and handler; when
// `examRoomEnabled(LISTENING_PRACTICE_SURFACE)` is on it renders this frame
// instead of its own footer, chips and native <audio controls>:
//   FR-002–FR-004 submit box (shell), FR-005 save status with a time,
//   FR-006 navigator from the question groups, FR-007/FR-008 AudioPlayer over
//   the runner's own <audio>, FR-009 account-bound local copy and the legacy
//   draft choice, FR-010 offline and 401, FR-011 only the active runner holds
//   the box, banner and write lock, FR-012 one writing tab per attempt.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { ExamRoomAudioPlayer } from '@/components/exam-room/audio-player';
import { ExamRoomShell } from '@/components/exam-room/exam-room-shell';
import type { ExamRoomQuestion, ExamRoomSaveStatus, ExamRoomSection, ExamRoomSession } from '@/components/exam-room/types';
import type { AudioLoop, AudioPlayerState } from '@/components/ui/audio-player';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { pauseOtherListeningAudio } from '@/components/listening-question-audio';
import {
  clearLocalCopy, localCopyExpiry, localCopyKey, readLocalCopy, removeAckedFromCopy, writeLocalCopy,
} from '@/lib/exam-room/local-copy.mjs';
import { LISTENING_PRACTICE_SURFACE } from '@/lib/listening-programme-answer-queue.mjs';

/** Same shape as `createProgrammeAnswerDraftStore`, so the runner's calls stay as they are. */
export interface ProgrammeDraftStore {
  key: string;
  load(): Record<number, string>;
  remember(qNum: number, value: string): void;
  clearIfCurrent(qNum: number, value: string): void;
  clear(): void;
}

export interface ProgrammeLocalCopyStore extends ProgrammeDraftStore {
  /** Writes every given answer with its base and reads it back (FR-009 "on leave"). */
  secure(answers: Record<number, string>): boolean;
}

/** `localStorage`, or null where the browser refuses it. */
export function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/**
 * FR-009: the runner's draft store backed by the EXAMROOM-0066 FR-035 local
 * copy. Every answer is written with `baseValue`, the value the server last
 * acked for that question (or read when the attempt opened; `null` when it had
 * none), so a replay re-sends it only while the server still holds that value.
 */
export function createProgrammeLocalCopyStore(
  storage: Storage | null,
  { ownerKey, attemptId, baseFor, now = () => Date.now() }: { ownerKey: string; attemptId: string; baseFor(qNum: number): string | null; now?: () => number },
): ProgrammeLocalCopyStore {
  const scope = { surface: LISTENING_PRACTICE_SURFACE, ownerKey, attemptKey: attemptId };
  const write = (answers: Record<number, string>) => {
    const at = now();
    const existing = readLocalCopy(storage, { ...scope, now: at });
    return writeLocalCopy(storage, {
      ...scope,
      answers: Object.fromEntries(Object.entries(answers).map(([q, value]) => [q, { value, baseValue: baseFor(Number(q)) }])),
      expiresAt: existing?.expiresAt ?? localCopyExpiry({ now: at }),
      now: at,
    });
  };
  return {
    key: localCopyKey(scope),
    load() {
      const copy = readLocalCopy(storage, { ...scope, now: now() });
      // Programme answers are strings; anything else in the copy is not this runner's.
      return copy ? Object.fromEntries(Object.entries(copy.answers).flatMap(([q, a]) => (typeof a.value === 'string' ? [[Number(q), a.value]] : []))) : {};
    },
    remember(qNum, value) { write({ [qNum]: value }); },
    clearIfCurrent(qNum, value) { removeAckedFromCopy(storage, { ...scope, entries: [{ q: qNum, value }], now: now() }); },
    clear() { clearLocalCopy(storage, scope); },
    secure(answers) { return Object.keys(answers).length === 0 || write(answers); },
  };
}

/** A question whose on-device value differs from the saved one and was never sent on its own. */
export interface ProgrammeAskItem { qNum: number; label: string; local: string; saved: string }

/** Media element → AudioPlayer state; the runner keeps the element and its src. */
function useMediaState(audioRef: RefObject<HTMLAudioElement | null>, version: string) {
  const [snapshot, setSnapshot] = useState({ current: 0, duration: 0, playing: false, waiting: false, error: false, speed: 1 });
  const [loop, setLoop] = useState<AudioLoop>({});
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useEffect(() => {
    const element = audioRef.current;
    setSnapshot({ current: 0, duration: 0, playing: false, waiting: false, error: false, speed: 1 });
    setLoop({});
    if (!element) return undefined;
    const read = (patch: Partial<typeof snapshot> = {}) => setSnapshot((prev) => ({
      ...prev,
      current: element.currentTime || 0,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      playing: !element.paused,
      speed: element.playbackRate || 1,
      ...patch,
    }));
    const onTime = () => {
      const { a, b } = loopRef.current;
      if (a != null && b != null && element.currentTime >= b) element.currentTime = a;
      read();
    };
    const handlers: Array<[string, () => void]> = [
      ['timeupdate', onTime],
      ['durationchange', () => read()],
      ['loadedmetadata', () => read({ error: false })],
      ['play', () => read({ waiting: false })],
      ['playing', () => read({ waiting: false })],
      ['pause', () => read()],
      ['waiting', () => read({ waiting: true })],
      ['ratechange', () => read()],
      ['ended', () => read({ playing: false })],
      ['error', () => read({ error: true, playing: false })],
    ];
    for (const [name, fn] of handlers) element.addEventListener(name, fn);
    return () => { for (const [name, fn] of handlers) element.removeEventListener(name, fn); };
  }, [audioRef, version]);
  return { snapshot, loop, setLoop };
}

export type ProgrammeOnceState = 'ready' | 'starting' | 'playing' | 'paused' | 'unconfirmed' | 'done';

export interface ProgrammeFormRoomProps {
  active: boolean;
  embedded: boolean;
  title: string;
  attemptId: string;
  ownerKey: string;
  exitHref: string;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: Date | null;
  onRetrySave(): void;
  sections: ExamRoomSection[];
  questions: ExamRoomQuestion[];
  currentQ?: number;
  onJump(q: number): void;
  /** FR-003: a check-answer request is running. */
  revealing: boolean;
  onSubmit(): Promise<void>;
  flush(): Promise<{ unsaved: number }>;
  losesWork(): boolean;
  /** Writes every current answer into the local copy and reads it back. */
  secureCopy(): boolean;
  session: ExamRoomSession;
  reloadFromServer(): Promise<unknown>;
  onWriteRightChange(canWrite: boolean): void;
  ask: ProgrammeAskItem[];
  onAskChoice(item: ProgrammeAskItem, choice: 'use-local' | 'keep-saved'): void;
  audio: {
    audioRef: RefObject<HTMLAudioElement | null>;
    version: string;
    policy: 'practice' | 'once';
    title: string;
    available: boolean;
    onceState: ProgrammeOnceState;
    onceMessage: string;
    /** `once`: start, resume after a drop, or confirm an unconfirmed start. */
    onOncePlay(): void;
    onRetry?(): void;
  };
  /** Variant select, retry button, alerts and the hidden <audio>, as the runner draws them. */
  audioExtras: ReactNode;
  progress: ReactNode;
  body: ReactNode;
}

function RoomAudio({ audio, active }: { audio: ProgrammeFormRoomProps['audio']; active: boolean }) {
  const { snapshot, loop, setLoop } = useMediaState(audio.audioRef, audio.version);
  const element = () => audio.audioRef.current;
  if (!audio.available) return null;
  if (audio.policy === 'once') {
    const state: AudioPlayerState = audio.onceState === 'done' ? 'locked'
      : snapshot.error ? 'error'
        : audio.onceState === 'starting' || (audio.onceState === 'playing' && snapshot.waiting) ? 'loading'
          : audio.onceState === 'playing' && snapshot.playing ? 'playing'
            : audio.onceState === 'ready' ? 'ready' : 'paused';
    return (
      <>
        <ExamRoomAudioPlayer
          key={audio.version}
          policy="once"
          lang="vi"
          title={audio.title}
          state={state}
          current={snapshot.current}
          duration={snapshot.duration}
          stoppedAt={snapshot.current}
          resumeAt={audio.onceState !== 'ready' && audio.onceState !== 'done' && snapshot.current > 0 ? snapshot.current : undefined}
          lockedNote="Đã nghe · đã khoá"
          onPlay={audio.onOncePlay}
          onRetry={() => { element()?.load(); audio.onRetry?.(); }}
        />
        {audio.onceState === 'unconfirmed' ? <Button variant="secondary" size="sm" onClick={audio.onOncePlay}>Xác nhận lượt nghe</Button> : null}
        {audio.onceMessage ? <p role="status">{audio.onceMessage}</p> : null}
      </>
    );
  }
  const state: AudioPlayerState = snapshot.error ? 'error' : snapshot.waiting ? 'loading' : snapshot.playing ? 'playing' : snapshot.duration ? 'paused' : 'ready';
  return (
    <ExamRoomAudioPlayer
      key={audio.version}
      policy="practice"
      lang="vi"
      ownsSpaceKey={active}
      title={audio.title}
      state={state}
      current={snapshot.current}
      duration={snapshot.duration}
      speed={snapshot.speed}
      loop={loop}
      stoppedAt={snapshot.current}
      onPlay={() => {
        const media = element();
        if (!media) return;
        pauseOtherListeningAudio(media);
        void media.play().catch(() => undefined);
      }}
      onPause={() => element()?.pause()}
      onSeek={(seconds) => { const media = element(); if (media) media.currentTime = Math.max(0, seconds); }}
      onSpeed={(speed) => { const media = element(); if (media) media.playbackRate = speed; }}
      onSetA={() => setLoop({ a: element()?.currentTime ?? 0 })}
      onSetB={() => setLoop((prev) => ({ ...prev, b: element()?.currentTime ?? undefined }))}
      onClearLoop={() => setLoop({})}
      onRetry={() => { element()?.load(); audio.onRetry?.(); }}
    />
  );
}

function AskPanel({ ask, onAskChoice }: Pick<ProgrammeFormRoomProps, 'ask' | 'onAskChoice'>) {
  if (!ask.length) return null;
  return (
    <Notice kind="warning" title="Có câu trả lời trên máy này khác bản đã lưu">
      <ul>
        {ask.map((item) => (
          <li key={item.qNum}>
            Câu {item.label}: trên máy này là “{item.local || '(trống)'}”, đã lưu là “{item.saved || '(trống)'}”.{' '}
            <Button size="sm" onClick={() => onAskChoice(item, 'use-local')}>Dùng câu trên máy này</Button>{' '}
            <Button size="sm" variant="secondary" onClick={() => onAskChoice(item, 'keep-saved')}>Giữ câu đã lưu</Button>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

export function ProgrammeFormRoom(props: ProgrammeFormRoomProps) {
  const {
    active, embedded, title, attemptId, ownerKey, exitHref, saveState, lastSavedAt, onRetrySave, sections, questions,
    currentQ, onJump, revealing, onSubmit, flush, losesWork, secureCopy, session, reloadFromServer, onWriteRightChange,
    ask, onAskChoice, audio, audioExtras, progress, body,
  } = props;

  // FR-011: a runner that stops being active saves its queue first, then lets go of the write lock.
  const [holdsLock, setHoldsLock] = useState(active);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (active) { setHoldsLock(true); return undefined; }
    let live = true;
    flushRef.current().catch(() => undefined).finally(() => { if (live) setHoldsLock(false); });
    return () => { live = false; };
  }, [active]);

  const saveStatus = useMemo<ExamRoomSaveStatus>(() => {
    if (saveState === 'saving') return { state: 'saving', lastSavedAt: lastSavedAt ?? undefined };
    if (saveState === 'error') return { state: 'failed', lastSavedAt: lastSavedAt ?? undefined, unsaved: 1, onRetry: onRetrySave };
    if (saveState === 'saved' && lastSavedAt) return { state: 'saved', lastSavedAt };
    return { state: 'idle', lastSavedAt: lastSavedAt ?? undefined };
  }, [saveState, lastSavedAt, onRetrySave]);

  // FR-011/FR-012: a runner without the lock may not write, even if nothing shows its inputs.
  const writeRightRef = useRef(onWriteRightChange);
  writeRightRef.current = onWriteRightChange;
  useEffect(() => { if (!holdsLock) writeRightRef.current(false); }, [holdsLock]);

  const tabGuard = useMemo(() => holdsLock ? {
    // FR-012: hand over only when every answer is acked or read back from the local copy.
    flush: async () => {
      let unsaved = 0;
      try { unsaved = (await flushRef.current()).unsaved; } catch { unsaved = 1; }
      return { secured: unsaved === 0 || secureCopy(), unsaved };
    },
    reloadFromServer,
    onWriteRightChange,
  } : undefined, [holdsLock, secureCopy, reloadFromServer, onWriteRightChange]);

  const room = (
    <>
      <AskPanel ask={ask} onAskChoice={onAskChoice} />
      <aside className="programme-audio" aria-label="Audio và tiến độ bài nghe">
        <h2>Nghe và khám phá</h2>
        {audioExtras}
        <RoomAudio audio={audio} active={active} />
        {progress}
      </aside>
      {body}
    </>
  );

  return (
    <div className="programme-runner programme-runner--exam-room" data-exam-room-surface={LISTENING_PRACTICE_SURFACE}>
      <ExamRoomShell
        mode="practice"
        surface={LISTENING_PRACTICE_SURFACE}
        // FR-011: the 80-day page keeps its own header; `bare` drops the shell's top bar and
        // leave box but keeps the bottom bar, submit box, session box and tab lock.
        bare={embedded}
        attemptKey={attemptId}
        title={title}
        saveStatus={saveStatus}
        sections={sections}
        questions={questions}
        currentQ={currentQ}
        onJump={onJump}
        layout={{ kind: 'single', body: room }}
        submit={active ? {
          // FR-002 (copy follows EXAMROOM-0066, approved 23/11 11:06Z): the shell's "Nộp bài?" /
          // "Nộp bài khi còn N câu chưa trả lời?" and "Quay lại làm tiếp"; only the confirm label
          // is this surface's. Esc or the stay button closes the box, focus back on the button.
          label: 'Hoàn thành và xem lại',
          onSubmit,
          // FR-003: the box stays usable; the confirm waits for the check to finish.
          extraWarning: revealing ? <span role="status">Đang đối chiếu, chờ một chút.</span> : undefined,
        } : undefined}
        exit={{ href: exitHref, flush, losesWork }}
        ownerKey={ownerKey}
        onSessionExpired={{ saveLocalCopy: secureCopy, returnUrl: typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}` }}
        session={active ? session : 'active'}
        tabGuard={tabGuard}
      />
    </div>
  );
}
