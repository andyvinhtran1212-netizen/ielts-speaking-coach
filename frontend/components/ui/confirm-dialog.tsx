'use client';

import { useId, useRef, type ReactNode, type Ref } from 'react';

import { Button } from './button';
import styles from './confirm-dialog.module.css';
import { Dialog, DialogFrame } from './dialog';
import { Icon } from './icon/icon';

export type ConfirmDialogTone = 'default' | 'warning';

type ConfirmContentProps = {
  tone?: ConfirmDialogTone;
  /** `en` in the exam room: "Warning", "Cancel", "Close". */
  lang?: 'vi' | 'en';
  /** A question, e.g. "Nộp bài khi còn 3 câu chưa trả lời?". */
  title: string;
  body?: ReactNode;
  /** Repeats the verb of the question, e.g. "Nộp bài". */
  confirmLabel: string;
  /** The way back, e.g. "Quay lại làm tiếp". */
  cancelLabel?: string;
  /** Busy label of the confirm button, e.g. "Đang nộp…". */
  busyLabel?: string;
  busy?: boolean;
};

export type ConfirmDialogProps = ConfirmContentProps & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const WORDS = {
  vi: { warning: 'Cảnh báo', cancel: 'Huỷ', close: 'Đóng', busy: 'Đang xử lý…' },
  en: { warning: 'Warning', cancel: 'Cancel', close: 'Close', busy: 'Working…' },
} as const;

function useConfirmParts(props: ConfirmContentProps & { onConfirm?: () => void; onCancel?: () => void }, cancelRef?: Ref<HTMLButtonElement>) {
  const { tone = 'default', lang = 'vi', confirmLabel, cancelLabel, busyLabel, busy = false, onConfirm, onCancel } = props;
  const words = WORDS[lang];
  const eyebrow = tone === 'warning' ? <><Icon name="warning" />{words.warning}</> : undefined;
  const actions = (
    <>
      <Button
        variant={tone === 'warning' ? 'danger' : 'primary'}
        className={tone === 'warning' ? styles.markFill : undefined}
        loading={busy}
        loadingLabel={busyLabel ?? words.busy}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
        {cancelLabel ?? words.cancel}
      </Button>
    </>
  );
  return { eyebrow, actions, words };
}

/**
 * Asks again before an action that cannot be taken back (UIBASE-0056 FR-005,
 * ThanhPhan §4); replaces `window.confirm`. Warning tone: mark border, word
 * label and a `danger` confirm button. Focus starts on the way back.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onCancel, title, body, tone = 'default', lang = 'vi', busy = false } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const { eyebrow, actions, words } = useConfirmParts(props, cancelRef);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      describedBy={body ? bodyId : undefined}
      initialFocusRef={cancelRef}
      title={title}
      tone={tone}
      eyebrow={eyebrow}
      closeLabel={words.close}
      busy={busy}
      actions={actions}
    >
      {body ? <p id={bodyId} lang={lang === 'en' ? 'en' : undefined}>{body}</p> : null}
    </Dialog>
  );
}

/** Static drawing of the confirm box, for `/ui-library` only (no behaviour). */
export function ConfirmDialogFrame(props: ConfirmContentProps) {
  const titleId = useId();
  const { eyebrow, actions } = useConfirmParts(props);
  return (
    <div role="group" aria-labelledby={titleId}>
      <DialogFrame title={props.title} titleId={titleId} tone={props.tone} eyebrow={eyebrow} actions={actions}>
        {props.body ? <p>{props.body}</p> : null}
      </DialogFrame>
    </div>
  );
}
