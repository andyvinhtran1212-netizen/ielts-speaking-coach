'use client';

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

export function StatusBanner({ banner }: { banner: { kind: 'success' | 'error'; text: string } | null }) {
  if (!banner) return null;
  return <div className={`acd-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="acd-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

// Open dialogs, topmost last. Only the topmost one handles Escape and the Tab
// trap, so a dialog opened over another (the admin step-up code prompt over a
// confirm dialog) keeps the keyboard.
const openDialogs: object[] = [];

export function Dialog({ open, title, description, children, actions, onClose, busy = false, panelClassName = '', backdropClassName = '' }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  busy?: boolean;
  panelClassName?: string;
  backdropClassName?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
  }, [busy, onClose]);

  // Move focus before the open dialog paints; passive effects leave a frame
  // where keyboard focus still belongs to the background trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const layer = {};
    openDialogs.push(layer);
    const previous = openerRef.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== layer) return;
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // The panel itself holds focus on open; Shift+Tab from it would leave the dialog.
      const outsideControls = active === panel || !panel.contains(active);
      if (event.shiftKey && (active === first || outsideControls)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outsideControls)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.indexOf(layer), 1);
      openerRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={`acd-dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`} onFocusCapture={(event) => {
      // A child's autoFocus runs before the panel effect; its first focus-in still carries the opener.
      const previous = event.relatedTarget;
      if (!openerRef.current && previous instanceof HTMLElement && previous.isConnected && !event.currentTarget.contains(previous)) openerRef.current = previous;
    }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={panelRef} className={`acd-dialog${panelClassName ? ` ${panelClassName}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="acd-dialog__head">
          <div><h2 id={titleId}>{title}</h2>{description && <div className="acd-dialog__description">{description}</div>}</div>
          <button className="acd-icon-button" type="button" aria-label="Đóng" onClick={onClose} disabled={busy}>×</button>
        </div>
        {children && <div className="acd-dialog__body">{children}</div>}
        <div className="acd-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
