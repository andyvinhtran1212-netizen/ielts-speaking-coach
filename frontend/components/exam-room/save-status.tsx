'use client';

// EXAMROOM-0066 FR-013: autosave state in words on the top bar.
import { saveStatusText } from '@/lib/exam-room/submit-guard.mjs';

import { FocusStatus } from '../ui/shell/focus-shell';
import styles from './exam-room.module.css';
import type { ExamRoomSaveStatus } from './types';
import type { ExamRoomStrings } from './strings';

export function SaveStatus({ status, strings }: { status: ExamRoomSaveStatus; strings: ExamRoomStrings }) {
  const view = saveStatusText(status, strings);
  return (
    <span className={styles.saveStatus} role="status" aria-live="polite" data-tone={view.tone}>
      {view.text ? <FocusStatus>{view.text}</FocusStatus> : null}
      {view.retry && status.state === 'failed' ? (
        <button type="button" className={styles.textButton} onClick={() => status.onRetry()}>{view.retry}</button>
      ) : null}
    </span>
  );
}
