'use client';

// EXAMROOM-0066 T002 (G08-T03): the exam room frame. It wraps FocusShell and
// never calls an API: every save, submit and reload comes from the surface
// through props (plan.md "Data and contracts").
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { blocksManualSubmit, connectionReducer, initialConnectionState } from '@/lib/exam-room/connection-state.mjs';
import { clockTime, submitButtonState } from '@/lib/exam-room/submit-guard.mjs';
import { createTabGuard } from '@/lib/exam-room/tab-guard.mjs';

import { Button } from '../ui/button';
import { Notice } from '../ui/notice';
import { FOCUS_WORDS } from '../ui/shell/focus-copy';
import { FocusShell, FocusStatus, FocusTimer, type FocusLeaveCopy } from '../ui/shell/focus-shell';
import { AbandonDialog } from './abandon-dialog';
import { ConnectionBanner } from './connection-banner';
import styles from './exam-room.module.css';
import { OtherTabNotice, type TabGuardState } from './other-tab-notice';
import { QuestionNavigator } from './question-navigator';
import { SaveStatus } from './save-status';
import { SessionExpiredDialog } from './session-expired-dialog';
import { SplitPane } from './split-pane';
import { examRoomStrings } from './strings';
import { SubmitDialog } from './submit-dialog';
import { OutcomePanel, TimeUpChoice } from './time-up-panel';
import { trackExamRoomEvent } from './track';
import type { ExamRoomSaveStatus, ExamRoomShellProps } from './types';

type ConnectionState = ReturnType<typeof initialConnectionState>;

const FIVE_MINUTES = 5 * 60;
const DEFAULT_WIDTH = 1280;

/** "mm:ss", or "h:mm:ss" past an hour; never negative. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

/** Answers not yet acked by the server, from the save status and the cells. */
export function unsavedCount(status: ExamRoomSaveStatus, questions: ExamRoomShellProps['questions'] = []): number {
  const fromStatus = status.state === 'retrying' || status.state === 'failed' ? status.unsaved : 0;
  const fromCells = questions.filter((q) => q.saveState).length;
  return Math.max(fromStatus, fromCells);
}

function useViewportWidth(override?: number): number {
  const [width, setWidth] = useState(override ?? DEFAULT_WIDTH);
  useEffect(() => {
    if (override != null) { setWidth(override); return undefined; }
    const read = () => setWidth(window.innerWidth || DEFAULT_WIDTH);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [override]);
  return width;
}

function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function ExamRoomShell(props: ExamRoomShellProps) {
  const {
    mode, surface, embedded = false, isFullTest = false, attemptKey, title, subtitle, timer = null, saveStatus,
    sections = [], questions = [], currentQ, onJump, onToggleFlag, flagsReady, layout, submit, exit,
    onSessionExpired, onSessionConflict, timeUpChoice, session = 'active', tabGuard, viewportWidth,
  } = props;
  const strings = useMemo(() => examRoomStrings(mode), [mode]);
  const track = props.track ?? trackExamRoomEvent;
  const trackRef = useRef(track);
  trackRef.current = track;
  const width = useViewportWidth(viewportWidth);
  const lang = strings.lang === 'en' ? 'en' : 'vi';

  const unsaved = unsavedCount(saveStatus, questions);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const savedUpTo = clockTime(saveStatus.lastSavedAt);

  // ---- connection (FR-014) -------------------------------------------
  const [connection, setConnection] = useState<ConnectionState>(() => initialConnectionState(
    typeof navigator === 'undefined' || navigator.onLine !== false,
  ));
  const dispatch = useCallback((event: Parameters<typeof connectionReducer>[1]) => {
    setConnection((prev) => {
      const { state, offlineDurationS } = connectionReducer(prev, event);
      if (offlineDurationS != null) trackRef.current('exam_room_offline', { duration_s: offlineDurationS });
      return state;
    });
  }, []);
  useEffect(() => {
    const off = () => dispatch({ type: 'offline', at: Date.now() });
    const on = () => dispatch({ type: 'online', at: Date.now(), unsaved: unsavedRef.current });
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, [dispatch]);
  useEffect(() => {
    if (connection.status === 'syncing' && unsaved === 0 && saveStatus.state !== 'saving') {
      dispatch({ type: 'queue-drained', at: Date.now() });
    }
  }, [connection.status, unsaved, saveStatus.state, dispatch]);
  useEffect(() => {
    if (connection.status !== 'back-online' || connection.backOnlineUntil == null) return undefined;
    const id = window.setTimeout(() => dispatch({ type: 'tick', at: Date.now() }), Math.max(0, connection.backOnlineUntil - Date.now()));
    return () => window.clearTimeout(id);
  }, [connection.status, connection.backOnlineUntil, dispatch]);

  // ---- one writing tab (FR-017) ----------------------------------------
  const [guardState, setGuardState] = useState<TabGuardState>(tabGuard ? 'pending' : 'unsupported');
  const [handoverRefused, setHandoverRefused] = useState(false);
  const guardRef = useRef<ReturnType<typeof createTabGuard> | null>(null);
  const tabGuardRef = useRef(tabGuard);
  tabGuardRef.current = tabGuard;
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const guardOn = Boolean(tabGuard) && !embedded;
  useEffect(() => {
    if (!guardOn) { setGuardState('unsupported'); return undefined; }
    let reported = false;
    const guard = createTabGuard({
      surface,
      attemptKey,
      flush: () => {
        const own = tabGuardRef.current?.flush;
        if (own) return own();
        return exitRef.current.flush().then((r) => ({ secured: r.unsaved === 0, unsaved: r.unsaved }));
      },
      reloadFromServer: () => tabGuardRef.current?.reloadFromServer() ?? Promise.resolve(),
      onChange: (next: TabGuardState) => {
        setGuardState(next);
        if (next !== 'writer') setHandoverRefused(false);
        if (next === 'read-only' && !reported) { reported = true; trackRef.current('exam_room_other_tab', { surface }); }
      },
      onHandoverRefused: () => setHandoverRefused(true),
      locks: typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null,
      channelFactory: typeof BroadcastChannel === 'undefined' ? null : (name: string) => new BroadcastChannel(name),
      storage: safeLocalStorage(),
    });
    guardRef.current = guard;
    guard.start();
    setGuardState(guard.state);
    return () => { guard.stop(); guardRef.current = null; };
  }, [guardOn, surface, attemptKey]);
  const canWrite = guardState === 'writer' || guardState === 'unsupported';
  // Token fallback (no Web Locks): only canWrite() notices that another tab took
  // the token, so ask it while this tab writes; a loss turns the tab read-only.
  useEffect(() => {
    const guard = guardRef.current;
    if (!guard || guard.mode !== 'token' || guardState !== 'writer') return undefined;
    const id = window.setInterval(() => { guard.canWrite(); }, 1000);
    return () => window.clearInterval(id);
  }, [guardState]);
  // `releasing` may still save (the hand-over flush does) but the learner may not type.
  useEffect(() => { tabGuardRef.current?.onWriteRightChange?.(canWrite || guardState === 'releasing'); }, [canWrite, guardState]);

  // ---- timer (FR-018, FR-019) ------------------------------------------
  const remaining = timer?.kind === 'countdown' ? timer.remainingSeconds : null;
  const timeUp = remaining != null && remaining <= 0;
  const expired = useRef(false);
  const onExpireRef = useRef(timer?.kind === 'countdown' ? timer.onExpire : undefined);
  onExpireRef.current = timer?.kind === 'countdown' ? timer.onExpire : undefined;
  useEffect(() => {
    if (!timeUp || expired.current) return;
    expired.current = true;
    onExpireRef.current?.();
  }, [timeUp]);
  const fiveLeft = remaining != null && remaining > 0 && remaining <= FIVE_MINUTES;
  const [announce, setAnnounce] = useState('');
  const announced = useRef(false);
  useEffect(() => {
    if (fiveLeft && !announced.current) { announced.current = true; setAnnounce(strings.fiveLeft); }
  }, [fiveLeft, strings.fiveLeft]);
  // A new attempt in the same room starts its timer marks over.
  useEffect(() => { expired.current = false; announced.current = false; setAnnounce(''); }, [attemptKey]);

  // ---- session (FR-015, FR-016) ----------------------------------------
  const [copySaved, setCopySaved] = useState<boolean | null>(null);
  const copySavedRef = useRef(copySaved);
  copySavedRef.current = copySaved;
  const sessionCallbacks = useRef({ onSessionExpired, onSessionConflict });
  sessionCallbacks.current = { onSessionExpired, onSessionConflict };
  const sessionRef = useRef<typeof session>('active');
  useEffect(() => {
    const prev = sessionRef.current;
    sessionRef.current = session;
    if (session === prev && session === 'active') return;
    if (session === 'expired' || session === 'displaced') {
      if (copySavedRef.current == null) {
        const saver = sessionCallbacks.current.onSessionExpired;
        let ok = false;
        try { ok = saver ? saver.saveLocalCopy() === true : false; } catch { ok = false; }
        copySavedRef.current = ok;
        setCopySaved(ok);
        trackRef.current('exam_room_session_expired', { surface });
      }
      if (session === 'displaced' && prev !== 'displaced') sessionCallbacks.current.onSessionConflict?.('displaced');
    } else if (session === 'not_current' && prev !== 'not_current') {
      sessionCallbacks.current.onSessionConflict?.('not_current');
    } else if (session === 'active') {
      setCopySaved(null);
    }
  }, [session, surface]);
  const sessionBlocked = session === 'expired' || session === 'displaced';
  const returnUrl = onSessionExpired?.returnUrl
    ?? (typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`);

  // ---- submit (FR-010, FR-034) -----------------------------------------
  const reasonId = useId();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const outcome = submit?.outcome ?? 'idle';
  const offline = blocksManualSubmit(connection);
  // A save in flight counts as unsaved even when the surface tracks no per-question state.
  const pendingSaves = Math.max(unsaved, saveStatus.state === 'saving' ? 1 : 0);
  const button = submit ? submitButtonState({
    online: !offline,
    submitting: submitting || outcome === 'submitting',
    unsaved: pendingSaves,
    readOnly: !canWrite,
    strings,
    disabledReason: submit.disabledReason ?? null,
  }) : null;
  const openSubmit = () => {
    if (!button || button.disabled) return;
    setSubmitError(false);
    setSubmitOpen(true);
    track('exam_room_submit_dialog_opened', { surface, unanswered: questions.filter((q) => !q.answered).length });
  };
  // FR-010/FR-014: everything that locks the manual submit is checked again at
  // the moment of confirming, and an open box closes as soon as one of them holds,
  // so the lock reason shows next to the button instead.
  const submitBlocked = !submit || timeUp || outcome !== 'idle' || sessionBlocked || !canWrite || offline || pendingSaves > 0 || Boolean(submit?.disabledReason);
  const submitBlockedRef = useRef(submitBlocked);
  submitBlockedRef.current = submitBlocked;
  useEffect(() => {
    if (submitOpen && !submitting && submitBlocked) setSubmitOpen(false);
  }, [submitOpen, submitting, submitBlocked]);
  const confirmSubmit = () => {
    if (!submit || submitting) return;
    const liveWriter = guardRef.current ? guardRef.current.canWrite() : true;
    if (submitBlocked || submitBlockedRef.current || !liveWriter || unsavedRef.current > 0 || sessionRef.current === 'expired' || sessionRef.current === 'displaced') {
      setSubmitOpen(false);
      return;
    }
    setSubmitting(true);
    setSubmitError(false);
    track('exam_room_submit_confirmed', { surface });
    submit.onSubmit().then(
      () => { setSubmitting(false); setSubmitOpen(false); },
      () => { setSubmitting(false); setSubmitError(true); },
    );
  };

  // ---- abandon (FR-012) ------------------------------------------------
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const abandon = mode === 'test' ? exit.abandon : undefined;
  const confirmAbandon = () => {
    if (!abandon || abandoning) return;
    setAbandoning(true);
    abandon.onAbandon().then(
      () => { setAbandoning(false); setAbandonOpen(false); },
      () => { setAbandoning(false); },
    );
  };

  // ---- leave (FR-011) --------------------------------------------------
  const [leaveUnsaved, setLeaveUnsaved] = useState<number | null>(null);
  const hasUnsavedWork = useCallback(() => unsavedRef.current > 0 || exitRef.current.losesWork(), []);
  const onLeaveOpen = useCallback(() => {
    setLeaveUnsaved(unsavedRef.current > 0 ? unsavedRef.current : null);
    exitRef.current.flush().then((r) => setLeaveUnsaved(r.unsaved), () => setLeaveUnsaved(Math.max(1, unsavedRef.current)));
  }, []);
  const shownUnsaved = useRef<number | null>(null);
  shownUnsaved.current = leaveUnsaved;
  const beforeLeave = useCallback(async () => {
    let r: { unsaved: number };
    try {
      r = await exitRef.current.flush();
    } catch (error) {
      // A failed last flush never leaves the box saying the answers are saved.
      setLeaveUnsaved(Math.max(1, unsavedRef.current));
      throw error;
    }
    // Never leave quietly with answers the box did not mention.
    if (r.unsaved > 0 && r.unsaved !== shownUnsaved.current) {
      setLeaveUnsaved(r.unsaved);
      throw new Error('unsaved');
    }
    trackRef.current('exam_room_exit_confirmed', { unsaved: r.unsaved });
  }, []);
  const leaveCopy = useMemo<Partial<FocusLeaveCopy>>(() => {
    const base: Partial<FocusLeaveCopy> = mode === 'practice'
      ? { title: strings.shell.leaveTitle, lead: undefined, stayLabel: strings.shell.leaveStay, leaveLabel: strings.shell.leaveGo, body: undefined }
      : {};
    if (leaveUnsaved != null && leaveUnsaved > 0) return { ...base, body: strings.shell.leaveUnsaved(leaveUnsaved) };
    if (leaveUnsaved === 0 && mode === 'test') return { ...base, body: FOCUS_WORDS.exam.leave.body };
    return base;
  }, [mode, leaveUnsaved, strings]);

  // ---- layout ----------------------------------------------------------
  const outcomeShown = outcome !== 'idle' || timeUp;
  const inputsLocked = timeUp || outcome !== 'idle' || !canWrite || sessionBlocked;
  const work = layout.kind === 'split'
    ? (
      <SplitPane
        attemptKey={attemptKey}
        width={width}
        left={layout.left}
        right={layout.right}
        leftLabel={layout.leftLabel}
        rightLabel={layout.rightLabel}
        separatorLabel={`${layout.leftLabel} / ${layout.rightLabel}`}
        locked={inputsLocked}
      />
    )
    : <div className={styles.single}><fieldset className={styles.work} disabled={inputsLocked}>{layout.body}</fieldset></div>;

  if (session === 'not_current') {
    const body = (
      <div className={styles.outcome} data-exam-room="" lang={strings.lang}>
        <Notice kind="warning" lang={lang} live="alert" action={<Button variant="secondary" href={exit.href}>{strings.back}</Button>}>
          {strings.notCurrentDevice}
        </Notice>
      </div>
    );
    if (embedded) return body;
    return (
      <FocusShell mode={mode === 'test' ? 'exam' : 'practice'} title={title} detail={subtitle} exitHref={exit.href} hasUnsavedWork={() => false} fullTestRoom={isFullTest}>
        {body}
      </FocusShell>
    );
  }

  const room = (
    <div className={styles.root} data-exam-room="" data-mode={mode} data-surface={surface} lang={strings.lang}>
      <div className={styles.banners}>
        <ConnectionBanner state={connection} strings={strings} savedUpTo={savedUpTo} />
        {guardOn ? (
          <OtherTabNotice
            state={guardState}
            strings={strings}
            onTakeover={() => guardRef.current?.requestTakeover()}
            onReload={() => guardRef.current?.reload()}
          />
        ) : null}
        {handoverRefused && guardState === 'writer' ? <Notice kind="info" lang={lang}>{strings.shell.handoverRefused}</Notice> : null}
      </div>
      {timeUp && timeUpChoice && outcome === 'idle'
        ? <TimeUpChoice choice={timeUpChoice} strings={strings} />
        : outcomeShown && !embedded
          ? (
            <OutcomePanel
              outcome={outcome}
              timeUp={timeUp}
              savedUpTo={submit?.savedUpTo}
              closedAt={submit?.closedAt}
              onRetry={submit?.onRetry}
              exitHref={exit.href}
              strings={strings}
            />
          )
          : null}
      <div className={styles.work} aria-busy={guardState === 'pending' || guardState === 'acquiring' || undefined}>
        {work}
      </div>
    </div>
  );

  // FR-023: embedded (mock_embed=1): no bars, timer, submit or leave box.
  if (embedded) return room;

  const timerNode = timer?.kind === 'countdown'
    ? (
      <span className={styles.barRight}>
        {timeUp
          ? <FocusStatus>{strings.timeUp}</FocusStatus>
          : <FocusTimer label={strings.timeRemaining} value={formatClock(timer.remainingSeconds)} />}
        {fiveLeft ? <span className={styles.fiveLeft}>{strings.fiveLeft}</span> : null}
      </span>
    )
    : timer?.kind === 'elapsed'
      ? <FocusTimer label={strings.shell.timeElapsed} value={formatClock(timer.elapsedSeconds)} />
      : null;
  const saveNode = <SaveStatus status={saveStatus} strings={strings} />;
  const phone = width < 768;

  const submitNode = submit && button && !outcomeShown ? (
    <span className={styles.submitGroup}>
      {button.reason ? <span className={styles.reason} id={reasonId}>{button.reason}</span> : null}
      <Button
        variant="primary"
        aria-describedby={button.reason ? reasonId : undefined}
        disabled={button.disabled}
        aria-haspopup="dialog"
        onClick={openSubmit}
      >
        {button.why === 'offline' ? button.label : submit.label}
      </Button>
    </span>
  ) : null;
  const hasNavigator = sections.length > 0 && questions.length > 0;
  const bottom = hasNavigator || submitNode ? (
    <div className={styles.bottomBar}>
      {hasNavigator ? (
        <QuestionNavigator
          sections={sections}
          questions={questions}
          currentQ={currentQ}
          width={width}
          strings={strings}
          onJump={onJump}
          onToggleFlag={inputsLocked ? undefined : onToggleFlag}
          flagsReady={flagsReady}
        />
      ) : null}
      {submitNode}
    </div>
  ) : undefined;

  return (
    <FocusShell
      mode={mode === 'test' ? 'exam' : 'practice'}
      title={title}
      detail={subtitle}
      exitHref={exit.href}
      hasUnsavedWork={hasUnsavedWork}
      right={<span className={styles.barRight}>{phone ? null : saveNode}{timerNode}</span>}
      subline={phone ? saveNode : undefined}
      bottom={bottom}
      onAbandon={abandon ? () => setAbandonOpen(true) : undefined}
      leaveCopy={leaveCopy}
      onLeaveOpen={onLeaveOpen}
      beforeLeave={beforeLeave}
      fullTestRoom={isFullTest}
    >
      {room}
      <span className={styles.srOnly} aria-live="assertive" aria-atomic="true">{announce}</span>
      {submit ? (
        <SubmitDialog
          open={submitOpen}
          busy={submitting}
          error={submitError}
          questions={questions}
          strings={strings}
          confirmLabel={submit.label}
          costNote={submit.costNote}
          extraWarning={submit.extraWarning}
          onConfirm={confirmSubmit}
          onCancel={() => { if (!submitting) setSubmitOpen(false); }}
        />
      ) : null}
      {abandon ? (
        <AbandonDialog open={abandonOpen} busy={abandoning} strings={strings} onConfirm={confirmAbandon} onCancel={() => setAbandonOpen(false)} />
      ) : null}
      <SessionExpiredDialog
        open={sessionBlocked && copySaved != null}
        copySaved={copySaved === true}
        savedUpTo={savedUpTo}
        returnUrl={returnUrl}
        strings={strings}
      />
    </FocusShell>
  );
}
