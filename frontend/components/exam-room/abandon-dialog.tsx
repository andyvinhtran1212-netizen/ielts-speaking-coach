'use client';

// EXAMROOM-0066 FR-012: "Abandon this test?" for self-chosen tests only. What
// abandoning does on the server belongs to the surface's spec.
import { ConfirmDialog } from '../ui/confirm-dialog';
import type { ExamRoomStrings } from './strings';

export function AbandonDialog({ open, busy, strings, onConfirm, onCancel }: {
  open: boolean; busy: boolean; strings: ExamRoomStrings; onConfirm(): void; onCancel(): void;
}) {
  return (
    <ConfirmDialog
      open={open}
      tone="warning"
      lang={strings.lang === 'en' ? 'en' : 'vi'}
      title={strings.abandonTitle}
      body={strings.abandonBody}
      confirmLabel={strings.abandon}
      cancelLabel={strings.abandonKeep}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
