'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from './icon/icon';
import { IconButton } from './icon-button';
import styles from './theme-menu.module.css';
import { cx } from './cx';
import { DEVICE_WORD, THEME_CHOICES, useThemeChoice, type ThemeChoice, type ThemeMode } from './use-theme-choice';

const NAME: Record<ThemeChoice, string> = { light: 'Sáng', dark: 'Tối', system: 'Theo thiết bị' };
const ICON = { light: 'sun', dark: 'moon', system: 'theme-device' } as const;

export type ThemeMenuListProps = {
  choice: ThemeChoice | null;
  device: ThemeMode;
  onPick?: (choice: ThemeChoice) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  id?: string;
  className?: string;
};

/** The open menu: heading, three menuitemradio, and what the device is set to. */
export function ThemeMenuList({ choice, device, onPick, onKeyDown, id, className }: ThemeMenuListProps) {
  return (
    <div role="menu" aria-label="Giao diện" id={id} className={cx(styles.menu, className)} onKeyDown={onKeyDown}>
      <p className={styles.heading} aria-hidden="true">Giao diện</p>
      {THEME_CHOICES.map((option) => {
        const checked = choice === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            tabIndex={-1}
            data-choice={option.id}
            className={cx(styles.item, checked && styles.checked)}
            onClick={() => onPick?.(option.id)}
          >
            <Icon name={option.icon} size={20} />
            <span className={styles.itemLabel}>{option.label}</span>
            {checked ? <Icon name="check" size={16} /> : null}
          </button>
        );
      })}
      {choice === 'system' ? <p className={styles.device}>Theo thiết bị: máy đang {DEVICE_WORD[device]}.</p> : null}
    </div>
  );
}

export type ThemeMenuProps = { className?: string };

/**
 * Theme picker of the shells (UIBASE-0056 FR-021, CheDoToi.dc.html §3): a 44px
 * icon button showing the current choice, opening a menu of three
 * menuitemradio. Applies at once; no Save button, nothing sent to the server.
 */
export function ThemeMenu({ className }: ThemeMenuProps) {
  const { choice, device, setChoice } = useThemeChoice();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const shown = choice ?? 'system';

  const items = () => [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
  const trigger = () => wrap.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger()?.focus();
  };

  // Focus the checked item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const list = items();
    (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
  }, [open]);

  // A click or tap outside closes it without moving focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    close(true);
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => list[(to + list.length) % list.length]?.focus();
    switch (event.key) {
      case 'ArrowDown': move(at + 1); break;
      case 'ArrowUp': move(at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(list.length - 1); break;
      case 'Escape': close(true); break;
      case 'Tab': setOpen(false); return;
      default: return;
    }
    event.preventDefault();
  };

  return (
    <div ref={wrap} className={cx(styles.wrap, className)}>
      <IconButton
        icon={ICON[shown]}
        label={`Giao diện: ${NAME[shown]}. Đổi giao diện`}
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open ? (
        <ThemeMenuList id={menuId} className={styles.popover} choice={choice} device={device} onPick={pick} onKeyDown={onMenuKey} />
      ) : null}
    </div>
  );
}
