'use client';

/**
 * Shared state of ThemeMenu / ThemeChoice (UIBASE-0056 FR-020, FR-021).
 * The choice lives only in localStorage `av-theme` through the existing
 * theme-toggle module: "Sáng"/"Tối" store 'light'/'dark', "Theo thiết bị"
 * removes the key, so the anti-flash script needs no change. Nothing is sent
 * to the server.
 *
 * Kept in step with: other instances in this tab (module listeners), other
 * tabs (`storage` event), and the device while on "Theo thiết bị"
 * (`prefers-color-scheme` change).
 */
import { useCallback, useSyncExternalStore } from 'react';

import { applyTheme, getEffectiveTheme, getStoredTheme, getSystemTheme, setStoredTheme } from '@/lib/theme-toggle.mjs';

import { syncThemeColor } from './theme-color';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'av-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function currentChoice(): ThemeChoice {
  return (getStoredTheme() as ThemeMode | null) ?? 'system';
}

function applyCurrent(): void {
  applyTheme(getEffectiveTheme());
  syncThemeColor(currentChoice());
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (!first) return () => { listeners.delete(listener); };

  // One set of window listeners for every instance in the tab.
  syncThemeColor(currentChoice());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    applyCurrent();
    notify();
  };
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  const onDevice = () => {
    if (!getStoredTheme()) applyCurrent();
    notify();
  };
  window.addEventListener('storage', onStorage);
  mq?.addEventListener?.('change', onDevice);
  const detach = () => {
    window.removeEventListener('storage', onStorage);
    mq?.removeEventListener?.('change', onDevice);
  };
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

// A string snapshot keeps useSyncExternalStore's identity check cheap.
const snapshot = () => `${currentChoice()}|${getSystemTheme()}`;
const serverSnapshot = () => '';

export type ThemeChoiceState = {
  /** null until hydrated: the server cannot know the stored choice. */
  choice: ThemeChoice | null;
  /** What the device asks for (shown as "máy đang tối"). */
  device: ThemeMode;
  setChoice: (next: ThemeChoice) => void;
};

export function useThemeChoice(): ThemeChoiceState {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [choice, device] = value ? (value.split('|') as [ThemeChoice, ThemeMode]) : [null, 'light' as const];
  const setChoice = useCallback((next: ThemeChoice) => {
    setStoredTheme(next === 'system' ? null : next);
    applyCurrent();
    notify();
  }, []);
  return { choice, device, setChoice };
}

export const THEME_CHOICES = Object.freeze([
  Object.freeze({ id: 'light', label: 'Sáng', icon: 'sun' }),
  Object.freeze({ id: 'dark', label: 'Tối', icon: 'moon' }),
  Object.freeze({ id: 'system', label: 'Theo thiết bị', icon: 'theme-device' }),
] as const);

export const DEVICE_WORD: Record<ThemeMode, string> = { light: 'sáng', dark: 'tối' };
