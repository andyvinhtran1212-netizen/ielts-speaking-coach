'use client';

import { useEffect, useRef, useState } from 'react';

import { useDialogFocus } from '@/lib/use-dialog-focus';

import { cx } from '../cx';
import { Icon } from '../icon/icon';
import { groupCount, hasCurrent, isCurrent, type StaffNavGroup, type StaffRole } from './staff-nav';
import styles from './staff-shell.module.css';

const NAV_LABEL: Record<StaffRole, string> = { admin: 'Điều hướng quản trị', instructor: 'Điều hướng giáo viên' };
const MENU_LABEL: Record<StaffRole, string> = { admin: 'Menu quản trị', instructor: 'Menu giáo viên' };

/** Open groups: the one holding the current page starts open; the others follow the user. */
function useOpenGroups(nav: readonly StaffNavGroup[], current: string | null) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const currentGroup = nav.find((g) => g.label && hasCurrent(g, current))?.id ?? null;
  // A new current page opens its group again (FR-010: the current group is open).
  useEffect(() => {
    if (currentGroup) setOpen((prev) => (prev[currentGroup] ? prev : { ...prev, [currentGroup]: true }));
  }, [currentGroup]);
  const isOpen = (id: string) => open[id] ?? id === currentGroup;
  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? id === currentGroup) }));
  return { isOpen, toggle };
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className={styles.count}>{value}</span> : null;
}

type ListProps = {
  nav: readonly StaffNavGroup[];
  current: string | null;
  /** 'phone' rows are 44px (drawer); 'desktop' 36px. */
  size: 'desktop' | 'phone';
};

/** The full list: folding groups, sub-entries on a thin rule, counts after labels. */
function NavList({ nav, current, size }: ListProps) {
  const { isOpen, toggle } = useOpenGroups(nav, current);
  return (
    <div className={cx(styles.navList, size === 'phone' && styles.navListPhone)}>
      {nav.map((group) => {
        const items = group.items.map((item) => {
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

/** One icon per group (or per flat entry): name in `aria-label` and tooltip, summed count. */
function NavRail({ nav, current }: { nav: readonly StaffNavGroup[]; current: string | null }) {
  const cells = nav.flatMap((group) => (group.label
    ? [{
        key: group.id,
        label: group.label,
        icon: group.icon,
        href: group.items.find((i) => isCurrent(i, current))?.href ?? group.items[0]?.href,
        count: groupCount(group),
        current: hasCurrent(group, current),
      }]
    : group.items.map((item) => ({
        key: item.href,
        label: item.label,
        icon: item.icon ?? group.icon,
        href: item.href,
        count: item.count && item.count > 0 ? item.count : 0,
        current: isCurrent(item, current),
      }))));
  return (
    <div className={styles.rail}>
      {cells.filter((c) => c.href).map((c) => (
        <a
          key={c.key}
          href={c.href}
          aria-label={c.count > 0 ? `${c.label}, ${c.count} việc chờ` : c.label}
          title={c.label}
          aria-current={c.current ? 'page' : undefined}
          className={cx(styles.railItem, c.current && styles.railItemCurrent)}
        >
          <Icon name={c.icon} />
          {c.count > 0 ? <span className={styles.railCount} aria-hidden="true">{c.count}</span> : null}
        </a>
      ))}
    </div>
  );
}

export type StaffSidebarProps = {
  role: StaffRole;
  nav: readonly StaffNavGroup[];
  current: string | null;
  /** User-collapsed (persisted). Below 1200px the rail shows regardless (FR-018). */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * Desktop sidebar (KhungTrang2 §7–8): 248px with labels from 1200px; an icon
 * rail below 1200px (1024px included, FR-018) or when the user collapses it.
 * Hidden below 768px, where StaffDrawer takes over.
 */
export function StaffSidebar({ role, nav, current, collapsed, onCollapsedChange }: StaffSidebarProps) {
  return (
    <nav aria-label={NAV_LABEL[role]} className={styles.sidebar} data-collapsed={collapsed ? 'true' : undefined}>
      <div className={styles.sidebarFull}>
        <NavList nav={nav} current={current} size="desktop" />
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
};

/** Phone drawer (<768px): the same groups, 44px rows, only the current group open. Modal. */
export function StaffDrawer({ role, nav, current, open, onClose }: StaffDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, onClose, dialogRef: panel });
  if (!open) return null;
  return (
    <>
      <div className={styles.drawerBackdrop} aria-hidden="true" onClick={onClose} />
      <div ref={panel} className={styles.drawer} role="dialog" aria-modal="true" aria-label={MENU_LABEL[role]}>
        <div className={styles.drawerHead}>
          <span className={styles.drawerTitle}>{MENU_LABEL[role]}</span>
          <button type="button" className={styles.squareButton} aria-label={`Đóng ${MENU_LABEL[role].toLowerCase()}`} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label={NAV_LABEL[role]}>
          <NavList nav={nav} current={current} size="phone" />
        </nav>
      </div>
    </>
  );
}
