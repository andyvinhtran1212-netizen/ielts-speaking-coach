'use client';

// EXAMMOCK-0071 T002 (G08-T16): the exam-room branch of the mock runner. It only
// draws: every request, the clock, collection and submit stay in
// mock-exam-runner.tsx and arrive here as state and callbacks (FR-002).
import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react';

import { ExamRoomShell } from '@/components/exam-room/exam-room-shell';
import type { ExamRoomSaveStatus, ExamRoomSubmitOutcome } from '@/components/exam-room/types';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { clearLocalCopy } from '@/lib/exam-room/local-copy.mjs';
import { clockTime } from '@/lib/exam-room/submit-guard.mjs';
import { configuredMockSections, mockWordCount, submittedAtFor } from '@/lib/mock-exam-model.mjs';

import type { ConnectionState, MockState, Section } from './mock-exam-runner';

export interface MockSubmitTrack {
  section: Section;
  /** Automatic retries already made for this submit. */
  retries: number;
  error: { status: number | null } | null;
}

export type MockRoomOutcome = {
  section: Section;
  outcome: 'idle' | 'submitting' | 'confirmed' | 'unconfirmed' | 'unconfirmed_manual' | 'closed_unconfirmed' | 'denied';
  retry: boolean;
  closedAt: string | null;
  savedUpTo: string | null;
  sectionSubmitted: boolean;
};

export interface MockExamRoomProps {
  loading: boolean;
  fatal: string | null;
  /** The link has no code or sitting: the runner is already leaving for Full Test. */
  linkError: boolean;
  onReload(): void;
  state: MockState | null;
  view: string;
  code: string | null;
  ownerKey: string;
  connection: ConnectionState;
  /** Invigilator collection: waiting for the last save of this section (FR-009). */
  collecting: boolean;
  section: Section | null;
  remaining: number;
  timerLive: boolean;
  frameSrc: string | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** The Writing room; it reports its save state for the frame's status line (FR-006). */
  renderWriting(onSaveStatus: (status: ExamRoomSaveStatus) => void): ReactNode;
  capture: ReactNode;
  /** FR-012: `expired` after a 401 seen with `noRedirect`. */
  session: 'active' | 'expired';
  /** FR-010: writes the Writing boxes and reads them back; true when held. */
  saveLocalCopy(): boolean;
  /** FR-013: this tab holds the write right of the sitting. */
  canWrite: boolean;
  onWriteRightChange(canWrite: boolean): void;
  reloadFromServer(): Promise<unknown>;
  starting: Section | null;
  startError: string | null;
  onStart(section: Section): void;
  onSpeaking(): void;
  openingSpeaking: boolean;
  outcome: MockRoomOutcome | null;
  onRetrySubmit(): void;
  flushForExit(): Promise<{ unsaved: number }>;
}

/** Section names on the strip and in the subtitle: words only, no emoji (FR-005). */
export const MOCK_ROOM_SECTION_NAMES: Record<Section, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
};

export const MOCK_ROOM_COPY = {
  titlePrefix: 'Mock test',
  autoSubmit: 'This section will be submitted automatically.',
  collecting: 'Saving your final answers…',
  submitted: '✓ Submitted',
  current: 'In progress',
  upcoming: 'Not started',
  strip: 'Test sections',
  exitHref: '/home',
  /** FR-007: HH:MM only from the server's own marks, never this device's clock. */
  closed: (closedAt: string | null, savedUpTo: string | null) =>
    (closedAt ? `This section was closed by our server at ${closedAt}.` : 'This section was closed by our server.')
    + (savedUpTo ? ` Your answers were saved up to ${savedUpTo}.` : ''),
  connection: {
    offline: 'Connection lost. Keep this tab open without reloading; saving and submitting will retry automatically.',
    submitting: 'Submitting your answers. The connection is unstable; retrying…',
    submit_failed: 'Your answers have not been submitted yet. Keep this tab open. The invigilator can collect your saved answers.',
  } as Record<Exclude<ConnectionState, null>, string>,
  waitingStart: { en: 'Waiting for the invigilator to start the test…', vi: 'Đang chờ giám thị bắt đầu bài thi…' },
  waitingNext: { en: 'Section submitted. Waiting for the invigilator to open the next section…', vi: 'Đã nộp phần thi. Đang chờ giám thị mở phần tiếp theo…' },
  retake: { en: 'Select a section to start. Each section has its own timer and is submitted automatically when time runs out.', vi: 'Chọn một phần để bắt đầu. Mỗi phần có đồng hồ riêng và tự nộp khi hết giờ.' },
  collected: { en: 'Test collected', vi: 'Bài thi đã được thu' },
  collectedBody: (days: number) => ({
    en: `Your answers have been received. Results are expected in ${days} days and will appear on the home page.`,
    vi: `Bài của bạn đã tới máy chủ. Kết quả dự kiến có sau ${days} ngày và sẽ hiện ở trang chủ.`,
  }),
  speaking: { en: 'Complete the three-part Speaking section to finish the test.', vi: 'Hãy làm phần Speaking ba phần để hoàn thành bài thi.' },
  awaitingReview: { en: 'Your results are awaiting examiner review.', vi: 'Kết quả đang chờ giám khảo chấm.' },
  cancelled: { en: 'This test has been cancelled. Contact your examiner for a new attempt.', vi: 'Lượt thi này đã bị huỷ. Hãy liên hệ giám khảo để được cấp lượt mới.' },
  error: { en: 'Unable to open the test', vi: 'Không mở được bài thi.' },
  unavailable: { en: 'Content for this section is unavailable. Contact your invigilator.', vi: 'Chưa mở được nội dung phần này. Hãy báo giám thị.' },
  otherTab: { en: 'This test is open in another tab. Continue there, or take over from the notice above.', vi: 'Bài thi đang mở ở một tab khác. Bạn làm tiếp ở tab đó, hoặc giành quyền ở dòng thông báo phía trên.' },
  signIn: { en: 'Your session has expired. Sign in again to continue the test.', vi: 'Phiên đăng nhập đã hết. Bạn đăng nhập lại để làm tiếp.' },
  writingDone: 'Time is up. Your test has been submitted.',
  writingCounts: (t1: number, t2: number) => `Task 1: ${t1} words · Task 2: ${t2} words`,
} as const;

function Vi({ children }: { children: string }) {
  return <span lang="vi" className="me-muted" style={{ display: 'block' }}>{children}</span>;
}

/** FR-005: text strip from the sitting's own sections; not a navigation control. */
export function MockSectionStrip({ state, current }: { state: MockState; current: Section | null }) {
  const sections = configuredMockSections(state) as Section[];
  return (
    <ol className="me-checklist" aria-label={MOCK_ROOM_COPY.strip} data-mock-section-strip="">
      {sections.map((s) => {
        const done = Boolean(submittedAtFor(state, s));
        const word = done ? MOCK_ROOM_COPY.submitted : s === current ? MOCK_ROOM_COPY.current : MOCK_ROOM_COPY.upcoming;
        return (
          <li
            className={`me-check-pill${done ? ' done' : ''}`}
            key={s}
            aria-current={!done && s === current ? 'step' : undefined}
            data-section={s}
          >
            {MOCK_ROOM_SECTION_NAMES[s]} · {word}
          </li>
        );
      })}
    </ol>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <main className="me-center" data-mock-exam-room="" lang="en">{children}</main>;
}

/** HH:MM of a server timestamp (ISO), or null. */
function serverClock(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? clockTime(ms) : null;
}

function ClosedNotice({ outcome }: { outcome: MockRoomOutcome | null }) {
  if (!outcome || outcome.outcome !== 'closed_unconfirmed') return null;
  return (
    <Notice kind="warning" lang="en">
      {MOCK_ROOM_COPY.closed(serverClock(outcome.closedAt), outcome.savedUpTo)}
    </Notice>
  );
}

function shellOutcome(outcome: MockRoomOutcome | null, section: Section | null): ExamRoomSubmitOutcome {
  if (!outcome || outcome.section !== section) return 'idle';
  if (outcome.outcome === 'denied') return 'idle'; // the runner shows its error screen (403/404)
  return outcome.outcome;
}

function returnHere() {
  return typeof window === 'undefined' ? '/mock-exam' : `${window.location.pathname}${window.location.search}`;
}

function SignInNotice() {
  return (
    <Notice kind="warning" lang="en" live="alert" action={<Button href={`/login?next=${encodeURIComponent(returnHere())}`}>Sign in again</Button>}>
      {MOCK_ROOM_COPY.signIn.en}<Vi>{MOCK_ROOM_COPY.signIn.vi}</Vi>
    </Notice>
  );
}

/** FR-006: only after the server confirmed the Writing submit, with each task's word count. */
function WritingConfirmed({ state, outcome }: { state: MockState; outcome: MockRoomOutcome | null }) {
  if (!outcome || outcome.section !== 'writing' || outcome.outcome !== 'confirmed') return null;
  const w = state.sitting.writingSubmission;
  return (
    <Notice kind="success" lang="en">
      {MOCK_ROOM_COPY.writingDone} {MOCK_ROOM_COPY.writingCounts(mockWordCount(w.task1.text || ''), mockWordCount(w.task2.text || ''))}
    </Notice>
  );
}

export function MockExamRoom(props: MockExamRoomProps) {
  const { state, view, outcome } = props;
  const [writingSave, setWritingSave] = useState<ExamRoomSaveStatus>({ state: 'idle' });
  const onWritingSave = useCallback((status: ExamRoomSaveStatus) => setWritingSave(status), []);
  // FR-010: the Writing copy goes once the server holds the Writing submit.
  const sittingId = state?.sitting.id;
  const writingSubmittedAt = state?.sitting.writingSubmittedAt;
  useEffect(() => {
    if (!sittingId || !writingSubmittedAt || !props.ownerKey) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    clearLocalCopy(storage, { surface: 'mock', ownerKey: props.ownerKey, attemptKey: sittingId });
  }, [props.ownerKey, sittingId, writingSubmittedAt]);

  if (props.loading) return <Screen><PageState kind="loading" title="Loading the test" /></Screen>;
  if (props.fatal) {
    return (
      <Screen>
        <PageState
          kind="error"
          label="Error"
          title={MOCK_ROOM_COPY.error.en}
          body={<>{props.fatal}<Vi>{MOCK_ROOM_COPY.error.vi}</Vi></>}
          action={props.linkError
            ? <Button href="/full-test">Back to Full Test</Button>
            : <Button onClick={props.onReload}>Retry</Button>}
        />
      </Screen>
    );
  }
  if (!state || view === 'released') return <Screen><PageState kind="loading" title="Loading the test" /></Screen>;
  if (view === 'void') {
    return (
      <Screen>
        <PageState kind="error" label="Cancelled" title={MOCK_ROOM_COPY.error.en} body={<>{MOCK_ROOM_COPY.cancelled.en}<Vi>{MOCK_ROOM_COPY.cancelled.vi}</Vi></>} />
      </Screen>
    );
  }
  const examName = state.exam.readingTitle || props.code || 'IELTS';

  if ((view === 'waiting' || view === 'retake-menu') && !props.collecting) {
    const retake = state.examMode === 'retake';
    const message = retake ? MOCK_ROOM_COPY.retake : state.activeSection === 'not_started' ? MOCK_ROOM_COPY.waitingStart : MOCK_ROOM_COPY.waitingNext;
    const sections = configuredMockSections(state) as Section[];
    return (
      <Screen>
        <section className="me-card me-status-card">
          <h1 className="me-h1">{`${retake ? 'Retake' : MOCK_ROOM_COPY.titlePrefix} · ${examName}`}</h1>
          {props.connection ? <Notice kind="warning" lang="en">{MOCK_ROOM_COPY.connection[props.connection]}</Notice> : null}
          {props.session === 'expired' ? <SignInNotice /> : null}
          <ClosedNotice outcome={outcome} />
          <WritingConfirmed state={state} outcome={outcome} />
          {props.startError ? <Notice kind="error" lang="en" live="alert">{props.startError}</Notice> : null}
          <p className="me-muted" role="status">{message.en}<Vi>{message.vi}</Vi></p>
          <MockSectionStrip state={state} current={null} />
          {retake ? (
            <div className="me-checklist">
              {sections.filter((s) => !submittedAtFor(state, s)).map((s) => (
                <Button
                  key={s}
                  disabled={Boolean(props.starting)}
                  loading={props.starting === s}
                  loadingLabel="Opening…"
                  onClick={() => props.onStart(s)}
                >
                  {`Start ${MOCK_ROOM_SECTION_NAMES[s]}`}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      </Screen>
    );
  }
  if (view === 'submitted') {
    const speakingPending = state.sitting.status === 'speaking_pending';
    const body = MOCK_ROOM_COPY.collectedBody(state.exam.reviewSlaDays ?? 3);
    return (
      <Screen>
        <section className="me-card me-status-card">
          <h1 className="me-h1">{MOCK_ROOM_COPY.collected.en}<Vi>{MOCK_ROOM_COPY.collected.vi}</Vi></h1>
          {props.session === 'expired' ? <SignInNotice /> : null}
          <ClosedNotice outcome={outcome} />
          <WritingConfirmed state={state} outcome={outcome} />
          <p className="me-muted">{body.en}<Vi>{body.vi}</Vi></p>
          {speakingPending ? (
            <div className="me-submitted-extra">
              <p className="me-muted">{MOCK_ROOM_COPY.speaking.en}<Vi>{MOCK_ROOM_COPY.speaking.vi}</Vi></p>
              <Button disabled={props.openingSpeaking} loading={props.openingSpeaking} loadingLabel="Opening…" onClick={props.onSpeaking}>
                Start Speaking →
              </Button>
            </div>
          ) : <p className="me-muted me-submitted-extra">{MOCK_ROOM_COPY.awaitingReview.en}<Vi>{MOCK_ROOM_COPY.awaitingReview.vi}</Vi></p>}
          <Button variant="secondary" href={MOCK_ROOM_COPY.exitHref}>Back to home</Button>
        </section>
      </Screen>
    );
  }
  if (props.capture) return <>{props.capture}</>;

  const section = props.section;
  const sections = configuredMockSections(state) as Section[];
  const index = section ? sections.indexOf(section) : -1;
  const shellResult = shellOutcome(outcome, section);
  const body = (
    <div data-mock-section={section || ''}>
      <MockSectionStrip state={state} current={section} />
      {props.collecting ? <Notice kind="info" lang="en" live="status">{MOCK_ROOM_COPY.collecting}</Notice> : null}
      {props.connection ? <Notice kind="warning" lang="en">{MOCK_ROOM_COPY.connection[props.connection]}</Notice> : null}
      {props.timerLive && props.remaining > 0 && props.remaining <= 5 * 60
        ? <p className="me-muted" role="note">{MOCK_ROOM_COPY.autoSubmit}</p>
        : null}
      <div inert={props.collecting || undefined} aria-busy={props.collecting || undefined}>
        {section === 'writing'
          ? props.renderWriting(onWritingSave)
          : !props.canWrite
            // FR-013: a read-only tab does not load the child (it keeps its own lock).
            ? <Notice kind="info" lang="en">{MOCK_ROOM_COPY.otherTab.en}<Vi>{MOCK_ROOM_COPY.otherTab.vi}</Vi></Notice>
            : props.frameSrc
            // Embedded child players run their own exam room in `embedded` mode (FR-003).
            ? <iframe inert={props.collecting} ref={props.frameRef} src={props.frameSrc} title={`${section} test`} style={{ width: '100%', minHeight: '70vh', border: 0 }} />
            : <Notice kind="error" lang="en">{MOCK_ROOM_COPY.unavailable.en}</Notice>}
      </div>
    </div>
  );
  return (
    <ExamRoomShell
      key={section || 'none'}
      mode="test"
      surface="mock"
      isFullTest
      attemptKey={state.sitting.id}
      title={`${MOCK_ROOM_COPY.titlePrefix} · ${examName}`}
      subtitle={section && index >= 0 ? `Section ${index + 1} of ${sections.length}: ${MOCK_ROOM_SECTION_NAMES[section]}` : undefined}
      // The runner owns the clock and the timed submit; the frame only shows it (FR-003).
      timer={props.timerLive ? { kind: 'countdown', remainingSeconds: props.remaining, onExpire: () => {} } : null}
      saveStatus={section === 'writing' ? writingSave : { state: 'idle' }}
      layout={{ kind: 'single', body }}
      // FR-004: no manual submit in sequential, live and retake; the shell gets
      // `submit` only to show the runner's outcome (FR-007).
      submit={shellResult !== 'idle' ? {
        label: 'Submit section',
        onSubmit: () => Promise.resolve(),
        outcome: shellResult,
        closedAt: serverClock(outcome?.closedAt) ?? undefined,
        savedUpTo: outcome?.savedUpTo ?? undefined,
        onRetry: props.onRetrySubmit,
      } : undefined}
      exit={{ href: MOCK_ROOM_COPY.exitHref, flush: props.flushForExit, losesWork: () => false }}
      ownerKey={props.ownerKey}
      session={props.session}
      onSessionExpired={{ saveLocalCopy: props.saveLocalCopy, returnUrl: returnHere() }}
      tabGuard={{ reloadFromServer: props.reloadFromServer, onWriteRightChange: props.onWriteRightChange }}
    />
  );
}
