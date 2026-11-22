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

import { applyTheme, getStoredTheme, getSystemTheme, setStoredTheme } from '@/lib/theme-toggle.mjs';

import { syncThemeColor } from './theme-color';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'av-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

// Set only when localStorage refused the last choice (private mode, blocked
// site data): the pick then lasts for this page instead of doing nothing.
let memoryChoice: ThemeChoice | null = null;

function currentChoice(): ThemeChoice {
  return memoryChoice ?? (getStoredTheme() as ThemeMode | null) ?? 'system';
}

function applyCurrent(): void {
  const choice = currentChoice();
  applyTheme(choice === 'system' ? getSystemTheme() : choice);
  syncThemeColor(choice);
}

function notify(): void {
  for (const listener of listeners) listener();
}

// Window listeners shared by every instance in the tab: attached by the first
// subscriber, removed when the last one leaves, whichever instance that is.
let detachShared: (() => void) | null = null;

function attachShared(): () => void {
  syncThemeColor(currentChoice());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    applyCurrent();
    notify();
  };
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  const onDevice = () => {
    if (currentChoice() === 'system') applyCurrent();
    notify();
  };
  window.addEventListener('storage', onStorage);
  mq?.addEventListener?.('change', onDevice);
  return () => {
    window.removeEventListener('storage', onStorage);
    mq?.removeEventListener?.('change', onDevice);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!detachShared) detachShared = attachShared();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachShared) {
      detachShared();
      detachShared = null;
    }
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
    const stored = next === 'system' ? null : next;
    setStoredTheme(stored);
    // setStoredTheme swallows storage errors; a read-back tells whether it held.
    memoryChoice = getStoredTheme() === stored ? null : next;
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
