'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

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

export function Dialog({ open, title, description, children, actions, onClose, busy = false, panelClassName = '' }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  busy?: boolean;
  panelClassName?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="acd-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
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
