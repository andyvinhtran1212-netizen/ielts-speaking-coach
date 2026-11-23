'use client';

// EXAMROOM-0066 FR-010: one submit box for every surface. Warning tone while
// questions are blank (up to five numbers, then "and N more"); focus starts on
// "Return to test"; Esc closes unless a submit is running. A failed submit keeps
// the box open with the reason in words (ui-states.md).
import type { ReactNode } from 'react';

import { submitDialogModel } from '@/lib/exam-room/submit-guard.mjs';

import { ConfirmDialog } from '../ui/confirm-dialog';
import styles from './exam-room.module.css';
import type { ExamRoomQuestion } from './types';
import type { ExamRoomStrings } from './strings';

export type SubmitDialogProps = {
  open: boolean;
  busy: boolean;
  error: boolean;
  questions: ExamRoomQuestion[];
  strings: ExamRoomStrings;
  confirmLabel: string;
  title?: string;
  cancelLabel?: string;
  costNote?: string;
  extraWarning?: ReactNode;
  onConfirm(): void;
  onCancel(): void;
};

export function SubmitDialog({ open, busy, error, questions, strings, confirmLabel, title, cancelLabel, costNote, extraWarning, onConfirm, onCancel }: SubmitDialogProps) {
  const model = submitDialogModel({ questions, strings, costNote: costNote ?? null });
  const body = (
    <>
      {model.body}
      {model.costNote ? <><br />{model.costNote}</> : null}
      {extraWarning ? <><br />{extraWarning}</> : null}
      {error ? <span role="alert" className={styles.dialogError}><br />{strings.shell.submitFailed}</span> : null}
    </>
  );
  return (
    <ConfirmDialog
      open={open}
      tone={model.kind === 'warning' ? 'warning' : 'default'}
      lang={strings.lang === 'en' ? 'en' : 'vi'}
      title={model.kind === 'plain' && title ? title : model.title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel ?? model.cancel}
      busyLabel={strings.submitBusySubmitting}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
