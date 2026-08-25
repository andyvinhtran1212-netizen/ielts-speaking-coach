'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { PERMISSIONS } from './admin-user-types';

export function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

export function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
}

export function codeTypeLabel(value: string) {
  return ({ mass: 'Đại trà', direct: 'Trực tiếp', staff: 'Nhân viên' } as Record<string, string>)[value] || value;
}

export function StatusBanner({ banner }: { banner: { kind: 'success' | 'error'; text: string } | null }) {
  if (!banner) return null;
  return <div className={`au-banner is-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>{banner.text}</div>;
}

export function LoadingState({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return <div className="au-state" role="status"><span className="au-spinner" aria-hidden="true" />{label}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="au-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

export function SortButton({ field, sort, onSort, children }: {
  field: string;
  sort: { field: string; order: 'asc' | 'desc' };
  onSort: (field: string) => void;
  children: ReactNode;
}) {
  const active = sort.field === field;
  return (
    <button
      className={`au-sort${active ? ' is-active' : ''}`}
      type="button"
      aria-label={`Sắp xếp theo ${String(children)}`}
      onClick={() => onSort(field)}
    >
      {children}<span aria-hidden="true">{active ? (sort.order === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

export function Dialog({ open, title, description, children, actions, onClose, busy = false, wide = false }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
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
    <div className="au-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div
        ref={panelRef}
        className={`au-dialog${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="au-dialog__head">
          <div><h2 id={titleId}>{title}</h2>{description && <div className="au-dialog__description">{description}</div>}</div>
          <button className="au-icon-button" type="button" aria-label="Đóng" onClick={onClose} disabled={busy}>×</button>
        </div>
        {children && <div className="au-dialog__body">{children}</div>}
        <div className="au-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="au-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function PermissionsPicker({ value, onChange, disabled = false }: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (permission: string, checked: boolean) => {
    const next = checked ? [...new Set([...value, permission])] : value.filter((item) => item !== permission);
    onChange(next);
  };
  return (
    <fieldset className="au-permissions" disabled={disabled}>
      <legend>Quyền truy cập</legend>
      <div className="au-check-grid">
        {PERMISSIONS.map(([permission, label]) => (
          <label key={permission}>
            <input type="checkbox" checked={value.includes(permission)} onChange={(event) => toggle(permission, event.target.checked)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ConfirmDialog({ state, busy, onClose, onConfirm }: {
  state: null | { title: string; body: ReactNode; confirmLabel: string; danger?: boolean };
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={Boolean(state)}
      title={state?.title || ''}
      description={state?.body}
      busy={busy}
      onClose={onClose}
      actions={<>
        <button className="adm-btn-secondary" type="button" onClick={onClose} disabled={busy}>Hủy</button>
        <button className={state?.danger ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Đang lưu…' : state?.confirmLabel}
        </button>
      </>}
    />
  );
}
