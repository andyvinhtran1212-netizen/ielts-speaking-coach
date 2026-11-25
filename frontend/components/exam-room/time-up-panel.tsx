'use client';

// EXAMROOM-0066 FR-018–FR-020, FR-034: what the room says once time is up or a
// submit is in flight. The shell only says "saved and submitted" when the
// surface reports `confirmed` after a canonical server ack.
import { useState } from 'react';

import { submitOutcomeModel } from '@/lib/exam-room/submit-guard.mjs';

import { Button } from '../ui/button';
import styles from './exam-room.module.css';
import type { ExamRoomShellProps, ExamRoomSubmitOutcome } from './types';
import type { ExamRoomStrings } from './strings';

export function OutcomePanel({ outcome, savedUpTo, closedAt, strings, onRetry, exitHref, timeUp }: {
  outcome: ExamRoomSubmitOutcome; savedUpTo?: string; closedAt?: string; strings: ExamRoomStrings;
  onRetry?: () => void; exitHref: string; timeUp: boolean;
}) {
  const model = submitOutcomeModel({ outcome, savedUpTo: savedUpTo ?? null, closedAt: closedAt ?? null, strings });
  // FR-034: "Time is up" belongs to the time-up path only; a lost submit on an
  // untimed surface (Listening, 0070 FR-010) or before the end says it plainly.
  const text = outcome === 'unconfirmed' && !timeUp ? strings.shell.unconfirmedPending : model.text;
  if (!text && !timeUp) return null;
  return (
    <div className={styles.outcome} role="status" aria-live="polite" data-outcome={outcome}>
      {timeUp ? <p className={styles.outcomeTitle}>{strings.timeUp}</p> : null}
      {text ? <p className={styles.outcomeText}>{text}</p> : null}
      {model.action === 'retry' && onRetry ? (
        <div className={styles.actions}><Button onClick={onRetry}>{strings.tryAgain}</Button></div>
      ) : null}
      {model.action === 'exit' ? (
        <div className={styles.actions}><Button variant="secondary" href={exitHref}>{strings.back}</Button></div>
      ) : null}
    </div>
  );
}

type Choice = NonNullable<ExamRoomShellProps['timeUpChoice']>;

/** FR-020: Writing and Speaking self-chosen tests; no "saved and submitted" line. */
export function TimeUpChoice({ choice, strings }: { choice: Choice; strings: ExamRoomStrings }) {
  const [busy, setBusy] = useState<null | 'send' | 'discard'>(null);
  const [failed, setFailed] = useState(false);
  const run = (which: 'send' | 'discard') => {
    if (busy) return;
    setBusy(which);
    setFailed(false);
    (which === 'send' ? choice.onSend() : choice.onDiscard()).then(
      () => setBusy(null),
      () => { setBusy(null); setFailed(true); },
    );
  };
  return (
    <div className={styles.outcome} role="status" aria-live="polite">
      <p className={styles.outcomeTitle}>{strings.timeUpChoiceTitle}</p>
      {choice.costNote ? <p className={styles.outcomeText}>{choice.costNote}</p> : null}
      <div className={styles.actions}>
        <Button autoFocus loading={busy === 'send'} loadingLabel={strings.submitBusySubmitting} disabled={busy === 'discard'} onClick={() => run('send')}>
          {strings.timeUpSend}
        </Button>
        <Button variant="secondary" loading={busy === 'discard'} loadingLabel={strings.submitBusySubmitting} disabled={busy === 'send'} onClick={() => run('discard')}>
          {strings.timeUpDiscard}
        </Button>
      </div>
      {failed ? <p role="alert" className={styles.dialogError}>{strings.shell.choiceFailed}</p> : null}
    </div>
  );
}
