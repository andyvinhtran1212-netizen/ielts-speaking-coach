'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { joinDialogStack } from '@/components/admin-directory-ui';

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
    // Shared stack: the step-up code prompt opens over this (busy) dialog and
    // must own Tab/Escape until it closes; this trap would otherwise pull
    // every Tab back to this disabled panel.
    const layer = joinDialogStack();
    const onKey = (event: KeyboardEvent) => {
      if (!layer.isTopmost()) return;
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
      layer.leave();
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

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabledReason?: string;
};

// ADMINIA-0074 FR-055: the row "⋯" menu. The list renders in a fixed-position
// portal because the table scroller has `contain: layout paint`, which would
// clip an in-flow popup; it follows the trigger while the page scrolls.
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [anchor, setAnchor] = useState<null | { top: number; right: number }>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = Boolean(anchor);

  const close = (restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setAnchor(null);
    };
    // Follow the trigger on scroll/resize instead of closing: a scroll can
    // arrive right after the click that opened the menu.
    const onMove = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) { setAnchor(null); return; }
      setAnchor({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  // Open upwards when the row sits near the bottom of the window.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!anchor || !menu || !rect) return;
    const height = menu.offsetHeight;
    menu.style.top = `${rect.bottom + 4 + height > window.innerHeight - 8
      ? Math.max(8, rect.top - 4 - height)
      : anchor.top}px`;
  }, [anchor]);

  const toggle = () => {
    if (open) { close(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close(event.key === 'Escape');
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? nodes.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % nodes.length
          : (current - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="adm-btn-secondary adm-btn-sm au-row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={toggle}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {anchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="au-row-menu"
          style={{ top: anchor.top, right: anchor.right }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`au-row-menu__item${item.danger ? ' is-danger' : ''}`}
              aria-disabled={item.disabledReason ? true : undefined}
              onClick={() => {
                if (item.disabledReason) return;
                close(true);
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.disabledReason && <small>{item.disabledReason}</small>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
