'use client';

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

import { useDialogFocus } from '@/lib/use-dialog-focus';

import styles from './dialog.module.css';
import { cx } from './cx';
import { IconButton } from './icon-button';

export type DialogVariant = 'modal' | 'drawer';

type FrameProps = {
  /** Heading of the overlay; a question when it asks for a decision. */
  title: string;
  titleId: string;
  variant?: DialogVariant;
  /** Modal width: 400px (one question) or 520px (short form). Ignored for drawers. */
  size?: 'sm' | 'md';
  /** Small word line above the title, e.g. the warning label of `ConfirmDialog`. */
  eyebrow?: ReactNode;
  tone?: 'default' | 'warning';
  /** Accessible name of the close button. Without `onClose` there is no close button. */
  closeLabel?: string;
  onClose?: () => void;
  busy?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * The visual panel of an overlay (ThanhPhanDuLieu §6), without any behaviour.
 * `Dialog` puts it in a native `<dialog>`; `/ui-library` also draws it in the
 * page flow so a screenshot can show it without covering the other sections.
 */
export function DialogFrame({
  title,
  titleId,
  variant = 'modal',
  size = 'sm',
  eyebrow,
  tone = 'default',
  closeLabel = 'Đóng',
  onClose,
  busy = false,
  children,
  actions,
  className,
}: FrameProps) {
  const sectioned = variant === 'drawer' || size === 'md';
  return (
    <div
      className={cx(
        styles.frame,
        variant === 'drawer' ? styles.drawer : size === 'md' ? styles.md : styles.sm,
        sectioned && styles.sectioned,
        tone === 'warning' && styles.warning,
        className,
      )}
    >
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h2 id={titleId} className={styles.title}>{title}</h2>
        </div>
        {onClose ? (
          <IconButton icon="close" label={closeLabel} onClick={busy ? undefined : onClose} disabled={busy} className={styles.close} />
        ) : null}
      </div>
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export type DialogProps = Omit<FrameProps, 'titleId' | 'onClose'> & {
  open: boolean;
  /** Called on Esc, the close button and a click on the backdrop (not while `busy`). */
  onClose: () => void;
  /** Element to focus on open; default is the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `alertdialog` for a question that interrupts work (ConfirmDialog). */
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
};

/**
 * Modal or drawer overlay of the "Bản in" UI (UIBASE-0056 FR-005, plan 5.4 #11).
 * Native `<dialog>` + `showModal()`, so the rest of the page is inert; focus,
 * Tab trap, Esc, scroll lock and focus return come from `useDialogFocus`.
 */
export function Dialog({ open, onClose, initialFocusRef, role = 'dialog', describedBy, busy = false, ...frame }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Order matters: the hook records the opener before showModal() moves focus,
  // and the layout effect closes the dialog before the hook's cleanup returns
  // focus to the opener (an element outside an open modal cannot take focus).
  useDialogFocus({ open, busy, onClose, dialogRef: ref, initialFocusRef });
  useEffect(() => {
    const node = ref.current;
    if (open && node && !node.open) node.showModal();
  }, [open]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!open && node?.open) node.close();
    return () => {
      if (node?.open) node.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      className={cx(styles.dialog, frame.variant === 'drawer' && styles.dialogDrawer)}
      // Esc is handled by useDialogFocus (it respects `busy`); stop the native close.
      onCancel={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.target === ref.current && !busy) onClose();
      }}
    >
      {open ? <DialogFrame {...frame} titleId={titleId} busy={busy} onClose={onClose} /> : null}
    </dialog>
  );
}
