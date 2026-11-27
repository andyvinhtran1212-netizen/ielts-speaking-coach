'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { useDialogFocus } from '@/lib/use-dialog-focus';

import { cx } from '../cx';
import { Icon } from '../icon/icon';
import {
  groupCount, hasCurrent, isAvailable, isCurrent, readNavGroups, writeNavGroups,
  type StaffNavGroup, type StaffNavItem, type StaffRole,
} from './staff-nav';
import styles from './staff-shell.module.css';

const NAV_LABEL: Record<StaffRole, string> = { admin: 'Điều hướng quản trị', instructor: 'Điều hướng giáo viên' };
const MENU_LABEL: Record<StaffRole, string> = { admin: 'Menu quản trị', instructor: 'Menu giáo viên' };

/**
 * Open groups: the one holding the current page is always open on arrival;
 * the others follow the user, remembered in this browser (GOI-09 FR-006)
 * unless `persist` is false (/ui-library).
 */
function useOpenGroups(nav: readonly StaffNavGroup[], current: string | null, persist: boolean) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const currentGroup = nav.find((g) => g.label && hasCurrent(g, current))?.id ?? null;
  // After mount (no hydration mismatch): what the user chose before, with the
  // current page's group open whatever was stored (FR-010).
  useEffect(() => {
    if (!persist) return;
    const stored = readNavGroups();
    setOpen((prev) => ({ ...stored, ...prev }));
  }, [persist]);
  // A new current page opens its group again.
  useEffect(() => {
    if (currentGroup) setOpen((prev) => (prev[currentGroup] ? prev : { ...prev, [currentGroup]: true }));
  }, [currentGroup]);
  const isOpen = (id: string) => open[id] ?? id === currentGroup;
  const toggle = (id: string) => setOpen((prev) => {
    const next = { ...prev, [id]: !(prev[id] ?? id === currentGroup) };
    if (persist) writeNavGroups({ ...readNavGroups(), [id]: next[id] });
    return next;
  });
  return { isOpen, toggle };
}

/** An entry whose page is not open yet: dimmed, not a link, "Chưa mở", no count. */
function Unavailable({ item, className }: { item: StaffNavItem; className: string }) {
  return (
    <span className={cx(className, styles.navItemOff)} aria-disabled="true" title="Chưa mở">
      <span className={styles.navItemLabel}>{item.label}</span>
      <span className={styles.srOnly}> (chưa mở)</span>
    </span>
  );
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className={styles.count}>{value}</span> : null;
}

type ListProps = {
  nav: readonly StaffNavGroup[];
  current: string | null;
  /** 'phone' rows are 44px (drawer); 'desktop' 36px. */
  size: 'desktop' | 'phone';
  persist: boolean;
};

/** The full list: folding groups, sub-entries on a thin rule, counts after labels. */
function NavList({ nav, current, size, persist }: ListProps) {
  const { isOpen, toggle } = useOpenGroups(nav, current, persist);
  return (
    <div className={cx(styles.navList, size === 'phone' && styles.navListPhone)}>
      {nav.map((group) => {
        const items = group.items.map((item) => {
          if (!isAvailable(item)) return <Unavailable key={`off-${item.label}`} item={item} className={styles.navItem} />;
          const cur = isCurrent(item, current);
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={cur ? 'page' : undefined}
              className={cx(styles.navItem, cur && styles.navItemCurrent)}
            >
              <span className={styles.navItemLabel}>{item.label}</span>
              <Count value={item.count && item.count > 0 ? item.count : 0} />
            </a>
          );
        });
        if (!group.label) return <div key={group.id} className={styles.flat}>{items}</div>;
        const expanded = isOpen(group.id);
        return (
          <div key={group.id}>
            <button
              type="button"
              className={cx(styles.groupHead, hasCurrent(group, current) && styles.groupHeadCurrent)}
              aria-expanded={expanded}
              onClick={() => toggle(group.id)}
            >
              <Icon name={expanded ? 'chev-down' : 'chev-right'} size={16} />
              <span className={styles.groupName}>{group.label}</span>
              {expanded ? null : <Count value={groupCount(group)} />}
            </button>
            {expanded ? <div role="group" aria-label={group.label} className={styles.groupItems}>{items}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The icon rail (FR-018, Admin1024.dc.html "Sidebar"): one icon per group, its
 * name in `aria-label` and tooltip, the summed count in the corner. A group
 * icon is a button that opens a temporary flyout over the content with every
 * entry of the group ("Mở tạm · Esc để đóng"), so no entry is out of reach at
 * 768–1199px; Esc or a click outside closes it and Esc returns focus to the
 * icon. A flat entry (instructor) is a plain link.
 */
function NavRail({ nav, current }: { nav: readonly StaffNavGroup[]; current: string | null }) {
  const [flyout, setFlyout] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    if (!flyout) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setFlyout(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const id = flyout;
      setFlyout(null);
      wrap.current?.querySelector<HTMLButtonElement>(`[data-rail-group="${id}"]`)?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [flyout]);

  const badge = (count: number) => (count > 0 ? <span className={styles.railCount} aria-hidden="true">{count}</span> : null);
  const name = (label: string, count: number) => (count > 0 ? `${label}, ${count} việc chờ` : label);

  return (
    <div ref={wrap} className={styles.rail}>
      {nav.map((group) => {
        if (!group.label) {
          return group.items.map((item) => {
            if (!isAvailable(item)) {
              return (
                <span key={`off-${item.label}`} className={cx(styles.railItem, styles.navItemOff)} aria-disabled="true" title={`${item.label} · Chưa mở`}>
                  <Icon name={item.icon ?? group.icon} />
                  <span className={styles.srOnly}>{item.label} (chưa mở)</span>
                </span>
              );
            }
            const count = item.count && item.count > 0 ? item.count : 0;
            const cur = isCurrent(item, current);
            return (
              <a
                key={item.href}
                href={item.href}
                aria-label={name(item.label, count)}
                title={item.label}
                aria-current={cur ? 'page' : undefined}
                className={cx(styles.railItem, cur && styles.railItemCurrent)}
              >
                <Icon name={item.icon ?? group.icon} />
                {badge(count)}
              </a>
            );
          });
        }
        if (group.items.length === 0) return null;
        const count = groupCount(group);
        const open = flyout === group.id;
        const panelId = `${baseId}-${group.id}`;
        return (
          <div key={group.id} className={styles.railCell}>
            <button
              type="button"
              data-rail-group={group.id}
              aria-label={name(group.label, count)}
              title={group.label}
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              className={cx(styles.railItem, hasCurrent(group, current) && styles.railItemCurrent)}
              onClick={() => setFlyout(open ? null : group.id)}
            >
              <Icon name={group.icon} />
              {badge(count)}
            </button>
            {open ? (
              <div id={panelId} role="group" aria-label={group.label} className={styles.flyout}>
                <p className={styles.flyoutHead}>{group.label}</p>
                {group.items.map((item) => {
                  if (!isAvailable(item)) return <Unavailable key={`off-${item.label}`} item={item} className={styles.flyoutItem} />;
                  const cur = isCurrent(item, current);
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      aria-current={cur ? 'page' : undefined}
                      className={cx(styles.flyoutItem, cur && styles.flyoutItemCurrent)}
                    >
                      <span>{item.label}</span>
                      {item.count && item.count > 0 ? <span className={styles.count}>{item.count}</span> : null}
                    </a>
                  );
                })}
                <p className={styles.flyoutNote}>Mở tạm · Esc để đóng</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const withRoot = (root: string | undefined, cls: string) => (root ? `${root} ${cls}` : cls);

export type StaffSidebarProps = {
  role: StaffRole;
  nav: readonly StaffNavGroup[];
  current: string | null;
  /** User-collapsed (persisted). Below 1200px the rail shows regardless (FR-018). */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Remember folded groups in localStorage (false on /ui-library). */
  persist?: boolean;
  /** 'av2-root' when StaffShell scope="shell". */
  rootClass?: string;
};

/**
 * Desktop sidebar (KhungTrang2 §7–8): 248px with labels from 1200px; an icon
 * rail below 1200px (1024px included, FR-018) or when the user collapses it.
 * Hidden below 768px, where StaffDrawer takes over.
 */
export function StaffSidebar({ role, nav, current, collapsed, onCollapsedChange, persist = true, rootClass }: StaffSidebarProps) {
  return (
    <nav aria-label={NAV_LABEL[role]} className={withRoot(rootClass, styles.sidebar)} data-collapsed={collapsed ? 'true' : undefined}>
      <div className={styles.sidebarFull}>
        <NavList nav={nav} current={current} size="desktop" persist={persist} />
      </div>
      <div className={styles.sidebarRail}>
        <NavRail nav={nav} current={current} />
      </div>
      <button
        type="button"
        className={styles.collapse}
        aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu hẹp thanh bên'}
        title={collapsed ? 'Mở rộng thanh bên' : 'Thu hẹp thanh bên'}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <Icon name={collapsed ? 'chev-right' : 'chev-left'} size={20} />
      </button>
    </nav>
  );
}

export type StaffDrawerProps = {
  role: StaffRole;
  nav: readonly StaffNavGroup[];
  current: string | null;
  open: boolean;
  onClose: () => void;
  persist?: boolean;
  /** 'av2-root' when StaffShell scope="shell". */
  rootClass?: string;
};

/** Phone drawer (<768px): the same groups, 44px rows, only the current group open. Modal. */
export function StaffDrawer({ role, nav, current, open, onClose, persist = true, rootClass }: StaffDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, onClose, dialogRef: panel });
  if (!open) return null;
  return (
    <>
      <div className={withRoot(rootClass, styles.drawerBackdrop)} aria-hidden="true" onClick={onClose} />
      <div ref={panel} className={withRoot(rootClass, styles.drawer)} role="dialog" aria-modal="true" aria-label={MENU_LABEL[role]}>
        <div className={styles.drawerHead}>
          <span className={styles.drawerTitle}>{MENU_LABEL[role]}</span>
          <button type="button" className={styles.squareButton} aria-label={`Đóng ${MENU_LABEL[role].toLowerCase()}`} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label={NAV_LABEL[role]}>
          <NavList nav={nav} current={current} size="phone" persist={persist} />
        </nav>
      </div>
    </>
  );
}
