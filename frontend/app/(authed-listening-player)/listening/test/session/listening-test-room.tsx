'use client';

// EXAMLISTENT-0070 T002 (G08-T14): the Listening test drawn inside the shared
// exam room (EXAMROOM-0066). Drawing only: boot, saving, review flags, submit,
// renderer affinity, MockHook and `mock-flush` stay in listening-test-session.tsx
// (FR-002), which passes its state and functions here. Mounted only when
// `examRoomEnabled('listening')` is true (FR-001).
import { useMemo, useState, type ReactNode } from 'react';

import { ExamRoomAudioPlayer } from '@/components/exam-room/audio-player';
import { ExamRoomShell } from '@/components/exam-room/exam-room-shell';
import type {
  ExamRoomQuestion, ExamRoomSaveStatus, ExamRoomSection, ExamRoomSession, ExamRoomSubmitOutcome,
} from '@/components/exam-room/types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AudioPlayerState } from '@/components/ui/audio-player';

type SaveState = 'pending' | 'retrying' | 'failed';

export type ListeningRoomAudio = {
  policy: 'practice' | 'test';
  playing: boolean;
  started: boolean;
  ended: boolean;
  current: number;
  duration: number;
  error: string;
  retrying: boolean;
  /** First play of a full test: the player waits for a click ("Play"). */
  needsGesture: boolean;
  /** The surface's <audio> element; this file never creates one. */
  element: ReactNode;
  onPlay(): void;
  onPause(): void;
  onSeek(seconds: number): void;
  onRetry(): void;
};

export type ListeningRoomSubmit = {
  outcome: ExamRoomSubmitOutcome | 'abandoned' | 'expired';
  message?: string | null;
  onSubmit(): Promise<void>;
  onRetry(): void;
};

export type ListeningTestRoomProps = {
  phase: string;
  error: string;
  title: string;
  practice: boolean;
  isFullTest: boolean;
  adminPreview: boolean;
  embedded: boolean;
  attemptId: string | null;
  ownerKey: string;
  backHref: string;
  resultsHref?: string | null;
  sectionNums: number[];
  activeSection: number;
  questionsBySection: Map<number, number[]>;
  answers: Map<number, string>;
  saveStates: Map<number, SaveState>;
  lastSavedAt: Date | null;
  currentQuestion: number | null;
  reviewQuestions: Set<number>;
  flagsReady: boolean;
  resumeAvailable: boolean;
  admissionRequired: boolean;
  savedAnswerCount: number;
  submitBlocked: string;
  session: ExamRoomSession;
  audio: ListeningRoomAudio;
  submit: ListeningRoomSubmit;
  renderSection(sectionNum: number): ReactNode;
  onStartFresh(): void;
  onResume(): void;
  onReload(): void;
  onJump(q: number): void;
  onToggleFlag(q: number): void;
  onRetrySaves(): void;
  flush(): Promise<{ unsaved: number }>;
  abandon?: () => Promise<void>;
  saveLocalCopy(): boolean;
  reloadFromServer(): Promise<unknown>;
  onWriteRightChange(canWrite: boolean): void;
};

const RULES_FULL = 'The recording plays once. You cannot rewind or restart it.';
const RULES_PRACTICE = 'You can pause, seek and replay the practice audio.';
const AWAY_NOTE = 'The recording keeps playing on our side while you are away; when you return, it continues from the current point.';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** FR-009: the frame's save status from the coordinator snapshot; the ack time comes from the surface. */
export function listeningRoomSaveStatus(saveStates: Map<number, SaveState>, lastSavedAt: Date | null, onRetry: () => void): ExamRoomSaveStatus {
  const values = [...saveStates.values()];
  const failed = values.filter((s) => s === 'failed').length;
  const retrying = values.filter((s) => s === 'retrying').length;
  const at = lastSavedAt ?? undefined;
  if (failed) return { state: 'failed', lastSavedAt: at, unsaved: values.length, onRetry };
  if (retrying) return { state: 'retrying', lastSavedAt: at, unsaved: values.length };
  if (values.length) return { state: 'saving', lastSavedAt: at };
  return at ? { state: 'saved', lastSavedAt: at } : { state: 'idle' };
}

/** FR-004: audio progress in words; Listening has no server clock, so no "Time remaining". */
export function listeningAudioStatus(audio: Pick<ListeningRoomAudio, 'policy' | 'playing' | 'started' | 'ended' | 'current' | 'duration'>) {
  if (audio.policy === 'practice') return audio.playing ? 'Practice audio playing' : 'Practice audio ready';
  if (audio.ended) return 'Audio has ended';
  if (audio.playing) return `Audio ${formatTime(audio.current)} / ${formatTime(audio.duration)}`;
  return audio.started ? 'Audio paused by the browser' : 'Audio ready';
}

function playerState(audio: ListeningRoomAudio): AudioPlayerState {
  if (audio.error) return 'error';
  if (audio.ended && audio.policy === 'test') return 'locked';
  if (audio.playing) return 'playing';
  return audio.started ? 'paused' : 'ready';
}

export function ListeningTestRoom(props: ListeningTestRoomProps) {
  const {
    phase, error, title, practice, isFullTest, adminPreview, embedded, attemptId, ownerKey, backHref,
    sectionNums, activeSection, questionsBySection, answers, saveStates, lastSavedAt, currentQuestion,
    reviewQuestions, flagsReady, resumeAvailable, admissionRequired, savedAnswerCount, submitBlocked,
    session, audio, submit, renderSection, onStartFresh, onResume, onReload, onJump, onToggleFlag,
    onRetrySaves, flush, abandon, saveLocalCopy, reloadFromServer, onWriteRightChange,
  } = props;
  const [confirmNewOpen, setConfirmNewOpen] = useState(false);

  const sections: ExamRoomSection[] = useMemo(() => sectionNums.map((num, index) => {
    const qs = questionsBySection.get(num) ?? [];
    return { id: `part-${num}`, kind: 'part', index: index + 1, firstQ: qs[0] ?? 0, lastQ: qs.at(-1) ?? 0 };
  }), [questionsBySection, sectionNums]);
  const questions: ExamRoomQuestion[] = useMemo(() => sectionNums.flatMap((num) => (questionsBySection.get(num) ?? []).map((q) => ({
    q, sectionId: `part-${num}`, answered: answers.has(q), flagged: reviewQuestions.has(q), saveState: saveStates.get(q),
  }))), [answers, questionsBySection, reviewQuestions, saveStates, sectionNums]);
  const total = questions.length;

  if (phase === 'loading') return <main className="listening-next-shell" data-exam-room-pending><div className="empty-state">Loading the Listening test…</div></main>;
  if (phase === 'error') {
    return <main className="listening-next-shell"><section className="error-banner" role="alert"><p>{error}</p>
      <div className="listening-next-actions"><button className="ft-control-btn" type="button" onClick={onReload}>Retry</button><a className="ft-control-btn ghost" href={backHref}>← Back</a></div>
    </section></main>;
  }
  if (phase === 'sealed') return <main className="listening-next-shell"><section className="ft-prestart"><p>Listening answers collected. Waiting for the next section…</p></section></main>;

  if (phase === 'prestart') {
    // FR-005: English pre-start screen; "Start a new attempt" asks in the page.
    return <main className="listening-next-shell" data-exam-room-prestart>
      {admissionRequired ? <section className="ft-prestart"><h1>Listening test</h1><p>Start the test to continue to Listening.</p>
        <div className="listening-next-actions"><button className="ft-control-btn" type="button" onClick={onStartFresh}>Start test</button><a className="ft-control-btn ghost" href={backHref}>← Back</a></div>
      </section> : <section className="ft-prestart">
        <p className="eyebrow">{practice ? 'LISTENING PRACTICE' : 'FULL LISTENING TEST'}</p>
        <h1>{title}</h1><p>{sectionNums.length} parts · {total} questions</p>
        <div className="ft-rules"><ul><li>Your answers are saved automatically.</li><li>Reloading the page resumes your current attempt.</li><li>{practice ? RULES_PRACTICE : RULES_FULL}</li></ul></div>
        {resumeAvailable ? <p className="ft-resume-note">You have an unfinished attempt with {savedAnswerCount} saved answers. Resume to keep your answers and audio position.</p> : null}
        <div className="listening-next-actions"><a className="ft-control-btn ghost" href={backHref}>← Back</a>
          {resumeAvailable ? <button className="ft-control-btn" type="button" onClick={onResume}>Resume test</button> : null}
          <button className="ft-control-btn ghost" type="button" onClick={() => { if (resumeAvailable) setConfirmNewOpen(true); else onStartFresh(); }}>{resumeAvailable ? 'Start a new attempt' : 'Start test'}</button>
        </div>
      </section>}
      <ConfirmDialog
        open={confirmNewOpen}
        lang="en"
        tone="warning"
        title="Start a new attempt?"
        body="Your current attempt will be discarded."
        confirmLabel="Start new attempt"
        cancelLabel="Keep current attempt"
        onCancel={() => setConfirmNewOpen(false)}
        onConfirm={() => { setConfirmNewOpen(false); onStartFresh(); }}
      />
    </main>;
  }

  const outcome = submit.outcome === 'abandoned' || submit.outcome === 'expired' ? 'idle' : submit.outcome;
  const terminal = submit.outcome === 'abandoned' || submit.outcome === 'expired';
  const unsavedList = [...saveStates.keys()].sort((a, b) => a - b);
  const disabledReason = adminPreview ? 'Preview only: answers are not submitted.'
    : unsavedList.length && submitBlocked ? `Questions ${unsavedList.join(', ')} are not saved yet. Select “Retry”, then submit again.`
      : undefined;

  const body = <div className="listening-next-room" data-exam-room-listening>
    {adminPreview ? <aside className="listening-admin-preview" role="status"><strong>Admin preview</strong><span>Preview only. Answers stay in this tab and no test attempt or result is saved.</span></aside> : null}
    {terminal ? <section className="error-banner" role="alert"><p>{submit.message}</p><div className="listening-next-actions"><a className="ft-control-btn" href={backHref}>Back</a></div></section> : null}
    <section className={`listening-next-player${practice ? ' is-practice' : ' is-full-test'}`} aria-label="Audio controls">
      <ExamRoomAudioPlayer
        policy={audio.policy}
        title={title}
        state={playerState(audio)}
        current={audio.current}
        duration={audio.duration}
        lockedNote={audio.ended && audio.policy === 'test' ? 'Continue answering before you submit.' : undefined}
        onPlay={audio.onPlay}
        onPause={audio.onPause}
        onSeek={audio.onSeek}
        onRetry={audio.onRetry}
      />
      {audio.needsGesture ? <p className="listening-next-audio-hint">When you press Play, the recording starts immediately. You cannot pause, rewind or play it again.</p> : null}
      {audio.error ? <div className="ft-audio-error" role="alert"><span>{audio.error}</span><button className="ft-control-btn ghost" type="button" onClick={audio.onRetry} disabled={audio.retrying}>{audio.retrying ? 'Reloading…' : 'Reload audio'}</button></div> : null}
      {isFullTest ? <p className="listening-next-audio-hint" data-listening-away-note>{AWAY_NOTE}</p> : null}
      {audio.element}
    </section>
    <div className="ielts-test-paper" id="listening-paper">{renderSection(activeSection)}</div>
    {submitBlocked ? <p className="ft-nothing-saved" role="alert">{submitBlocked}{unsavedList.length ? <button className="ft-unsaved-retry" type="button" onClick={onRetrySaves}>Retry</button> : null}</p> : null}
  </div>;

  const partIndex = Math.max(0, sectionNums.indexOf(activeSection)) + 1;
  return <ExamRoomShell
    mode="test"
    surface="listening"
    embedded={embedded}
    isFullTest={isFullTest}
    attemptKey={attemptId || 'admin-preview'}
    title={`Listening · ${title}`}
    subtitle={`${adminPreview ? 'Admin preview · ' : ''}Part ${partIndex} of ${sectionNums.length || 1} · ${listeningAudioStatus(audio)}`}
    timer={null}
    saveStatus={adminPreview ? { state: 'idle' } : listeningRoomSaveStatus(saveStates, lastSavedAt, onRetrySaves)}
    sections={sections}
    questions={questions}
    currentQ={currentQuestion ?? undefined}
    onJump={onJump}
    onToggleFlag={onToggleFlag}
    flagsReady={flagsReady}
    layout={{ kind: 'single', body }}
    submit={embedded || terminal ? undefined : {
      label: 'Submit answers',
      onSubmit: submit.onSubmit,
      disabledReason,
      outcome,
      onRetry: submit.onRetry,
    }}
    exit={{
      href: backHref,
      flush,
      losesWork: () => saveStates.size > 0,
      abandon: abandon ? { onAbandon: abandon } : undefined,
    }}
    ownerKey={ownerKey}
    session={session}
    onSessionExpired={adminPreview ? undefined : { saveLocalCopy, returnUrl: typeof window === 'undefined' ? '' : window.location.pathname + window.location.search }}
    tabGuard={adminPreview || !attemptId ? undefined : { reloadFromServer, onWriteRightChange }}
  />;
}
