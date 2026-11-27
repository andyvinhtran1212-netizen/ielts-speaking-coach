'use client';

import { useId, useRef, type Ref } from 'react';

import { Button } from '../button';
import { Dialog, DialogFrame } from '../dialog';
import type { FocusLeaveCopy, FocusMode } from './focus-copy';
import { FOCUS_WORDS } from './focus-copy';
import styles from './focus-shell.module.css';

export type LeaveConfirmProps = {
  open: boolean;
  mode: FocusMode;
  copy: FocusLeaveCopy;
  onStay: () => void;
  onLeave: () => void;
  /** Leaving is in progress (EXAMROOM-0066 FR-011 saves first): both buttons wait. */
  busy?: boolean;
};

function LeaveBody({ copy, id }: { copy: FocusLeaveCopy; id?: string }) {
  return (
    <div id={id}>
      <p className={styles.leaveText}>
        {copy.lead ? <><strong>{copy.lead}</strong> </> : null}
        {copy.body}
      </p>
      {copy.note ? <p className={styles.leaveNote}>{copy.note}</p> : null}
    </div>
  );
}

function actions(mode: FocusMode, copy: FocusLeaveCopy, onStay?: () => void, onLeave?: () => void, stayRef?: Ref<HTMLButtonElement>, busy?: boolean) {
  // `busy` is undefined unless the page saves before leaving, so other pages keep their buttons as drawn.
  const busyProps = busy === undefined ? {} : { loading: busy, loadingLabel: FOCUS_WORDS[mode].leaving };
  return (
    <>
      <Button ref={stayRef} variant="primary" disabled={busy === true} onClick={onStay}>{copy.stayLabel}</Button>
      <Button variant={mode === 'practice' ? 'danger' : 'secondary'} {...busyProps} onClick={onLeave}>{copy.leaveLabel}</Button>
    </>
  );
}

/**
 * Asks before leaving a focus page (FR-009). Practice: stay is the primary
 * button and the losing way out is the danger button. Exam: says the server
 * timer keeps running; there is no "save and exit". Esc and the close button
 * mean stay.
 */
export function LeaveConfirm({ open, mode, copy, onStay, onLeave, busy }: LeaveConfirmProps) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      onClose={onStay}
      role="alertdialog"
      describedBy={bodyId}
      initialFocusRef={stayRef}
      title={copy.title}
      closeLabel={FOCUS_WORDS[mode].close}
      busy={busy === true}
      actions={actions(mode, copy, onStay, onLeave, stayRef, busy)}
    >
      <LeaveBody copy={copy} id={bodyId} />
    </Dialog>
  );
}

/** Static drawing of the leave box, for `/ui-library` only (no behaviour). */
export function LeaveConfirmFrame({ mode, copy }: { mode: FocusMode; copy: FocusLeaveCopy }) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} lang={mode === 'exam' ? 'en' : undefined}>
      <DialogFrame title={copy.title} titleId={titleId} actions={actions(mode, copy)}>
        <LeaveBody copy={copy} />
      </DialogFrame>
    </div>
  );
}
