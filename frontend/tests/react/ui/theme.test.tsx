// UIBASE-0056 G03-T18 part 2 (FR-020, FR-021, FR-026): ThemeMenu, ThemeChoiceGroup.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AV2_THEME_COLOR, ThemeChoiceGroup, ThemeMenu } from '@/components/ui';

type Listener = () => void;
let deviceDark = false;
const deviceListeners = new Set<Listener>();

function setDevice(dark: boolean) {
  deviceDark = dark;
  act(() => { for (const fn of deviceListeners) fn(); });
}

function otherTabSets(value: string | null) {
  if (value === null) localStorage.removeItem('av-theme');
  else localStorage.setItem('av-theme', value);
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'av-theme', newValue: value })); });
}

const theme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  deviceDark = false;
  deviceListeners.clear();
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = ((query: string) => ({
    get matches() { return /dark/.test(query) && deviceDark; },
    media: query,
    addEventListener: (_: string, fn: Listener) => deviceListeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => deviceListeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
  document.head.innerHTML =
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${AV2_THEME_COLOR.light}">` +
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${AV2_THEME_COLOR.dark}">`;
});
afterEach(cleanup);

const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Giao diện: / }));
  return screen.getByRole('menu', { name: 'Giao diện' });
}

describe('ThemeMenu', () => {
  it('names the current choice on the button; nothing stored = "Theo thiết bị"', () => {
    render(<ThemeMenu />);
    const button = screen.getByRole('button', { name: 'Giao diện: Theo thiết bị. Đổi giao diện' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a menu of three menuitemradio with the checked one focused', () => {
    localStorage.setItem('av-theme', 'dark');
    render(<ThemeMenu />);
    const menu = openMenu();
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Sáng', 'Tối', 'Theo thiết bị']);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(document.activeElement).toBe(items[1]);
  });

  it('"Tối" stores dark, applies it at once, re-points both theme-color metas and closes', () => {
    render(<ThemeMenu />);
    fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: 'Tối' }));
    expect(localStorage.getItem('av-theme')).toBe('dark');
    expect(theme()).toBe('dark');
    expect(metas()).toEqual([AV2_THEME_COLOR.dark, AV2_THEME_COLOR.dark]);
    expect(screen.queryByRole('menu')).toBeNull();
    const button = screen.getByRole('button', { name: 'Giao diện: Tối. Đổi giao diện' });
    expect(document.activeElement).toBe(button);
  });

  it('"Theo thiết bị" removes the key (no third value) and follows the device', () => {
    localStorage.setItem('av-theme', 'light');
    deviceDark = true;
    render(<ThemeMenu />);
    fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: 'Theo thiết bị' }));
    expect(localStorage.getItem('av-theme')).toBeNull();
    expect(theme()).toBe('dark');
    expect(metas()).toEqual([AV2_THEME_COLOR.light, AV2_THEME_COLOR.dark]);
    setDevice(false);
    expect(theme()).toBe('light');
    expect(openMenu().textContent).toContain('Theo thiết bị: máy đang sáng.');
  });

  it('a device change is ignored once Sáng or Tối is chosen', () => {
    localStorage.setItem('av-theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeMenu />);
    setDevice(true);
    expect(theme()).toBe('light');
  });

  it('follows another tab through the storage event', () => {
    render(<ThemeMenu />);
    otherTabSets('dark');
    expect(theme()).toBe('dark');
    expect(screen.getByRole('button', { name: 'Giao diện: Tối. Đổi giao diện' })).toBeTruthy();
    otherTabSets(null);
    expect(theme()).toBe('light');
    expect(screen.getByRole('button', { name: 'Giao diện: Theo thiết bị. Đổi giao diện' })).toBeTruthy();
  });

  it('keyboard: arrows wrap, Escape closes and returns focus', () => {
    render(<ThemeMenu />);
    const button = screen.getByRole('button', { name: /^Giao diện: / });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('Theo thiết bị');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Sáng');
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Tối');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(localStorage.getItem('av-theme')).toBeNull();
  });

  it('a pointer press outside closes it', () => {
    render(<div><ThemeMenu /><p>ngoài</p></div>);
    openMenu();
    fireEvent.pointerDown(screen.getByText('ngoài'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('shared listeners', () => {
  it('are attached once and removed when the last instance leaves, whichever unmounts first', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const storageCount = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'storage').length;

    const first = render(<ThemeMenu />);
    const second = render(<ThemeChoiceGroup />);
    expect(storageCount(added)).toBe(1);
    expect(deviceListeners.size).toBe(1);

    first.unmount();
    expect(storageCount(removed)).toBe(0);
    expect(deviceListeners.size).toBe(1);
    second.unmount();
    expect(storageCount(removed)).toBe(1);
    expect(deviceListeners.size).toBe(0);

    // Remount: exactly one pair again, and it still works.
    const again = render(<ThemeMenu />);
    expect(storageCount(added)).toBe(2);
    expect(deviceListeners.size).toBe(1);
    otherTabSets('dark');
    expect(theme()).toBe('dark');
    again.unmount();
    expect(storageCount(removed)).toBe(2);
    expect(deviceListeners.size).toBe(0);
  });
});

describe('ThemeChoiceGroup', () => {
  it('is a named radio group in step with ThemeMenu on the same page', () => {
    render(<><ThemeMenu /><ThemeChoiceGroup /></>);
    const group = screen.getByRole('group', { name: 'Giao diện' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, false, true]);
    expect(group.textContent).toContain('Máy đang đặt sáng.');
    fireEvent.click(within(group).getByRole('radio', { name: 'Tối' }));
    expect(localStorage.getItem('av-theme')).toBe('dark');
    expect(theme()).toBe('dark');
    expect(screen.getByRole('button', { name: 'Giao diện: Tối. Đổi giao diện' })).toBeTruthy();
  });
});

describe('blocked localStorage', () => {
  it('Sáng/Tối still take effect for this page when every storage call throws', () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
    const spies = (['getItem', 'setItem', 'removeItem'] as const).map((m) => vi.spyOn(Storage.prototype, m).mockImplementation(blocked));
    try {
      render(<ThemeMenu />);
      fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: 'Tối' }));
      expect(theme()).toBe('dark');
      expect(metas()).toEqual([AV2_THEME_COLOR.dark, AV2_THEME_COLOR.dark]);
      const items = within(openMenu()).getAllByRole('menuitemradio');
      expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
      setDevice(true);
      setDevice(false);
      expect(theme()).toBe('dark');
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Theo thiết bị' }));
      expect(theme()).toBe('light');
      expect(screen.getByRole('button', { name: 'Giao diện: Theo thiết bị. Đổi giao diện' })).toBeTruthy();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    // Storage works again: the next pick is stored and the page copy is dropped.
    fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: 'Sáng' }));
    expect(localStorage.getItem('av-theme')).toBe('light');
    expect(theme()).toBe('light');
  });
});
