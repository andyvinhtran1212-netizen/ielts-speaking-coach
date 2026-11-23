// EXAMSPEAK-0072 edge case "Hai tab cùng phiên" (R149, G08-T19c): one writing
// tab per Speaking session through the EXAMROOM-0066 FR-017 guard. The guard
// runs for real against the shared fake Web Locks and BroadcastChannel.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeakingTabNotice, speakingAttemptKey, useSpeakingTabGuard } from '@/app/(authed-practice)/practice/session/speaking-tab-guard';
import { SPEAKING_ROOM_STRINGS_EN as EN, SPEAKING_ROOM_STRINGS_VI as VI } from '@/lib/exam-room/strings-speaking.mjs';

import { fakeBrowser } from '../fixtures/exam-room-fakes.mjs';

const noop = () => {};

describe('SpeakingTabNotice', () => {
  afterEach(cleanup);

  it('read-only: says another tab records, with "Dùng tab này"', () => {
    const onTakeover = vi.fn();
    render(<SpeakingTabNotice state="read-only" refused={false} strings={VI} lang="vi" onTakeover={onTakeover} onReload={noop} />);
    expect(screen.getByText(VI.otherTab)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: VI.useThisTab }));
    expect(onTakeover).toHaveBeenCalledTimes(1);
  });

  it('stuck: the spec words about unsent takes in the other tab, with "Tải lại"', () => {
    const onReload = vi.fn();
    render(<SpeakingTabNotice state="stuck" refused={false} strings={VI} lang="vi" onTakeover={noop} onReload={onReload} />);
    expect(screen.getByText('Bài này đang mở ở tab khác và còn bản ghi chưa gửi. Hãy gửi hoặc bỏ bản ghi ở tab đó.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: VI.reload }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('writer that refused a hand-over says why; English in test mode', () => {
    render(<SpeakingTabNotice state="writer" refused strings={EN} lang="en" onTakeover={noop} onReload={noop} />);
    expect(screen.getByText(EN.handoverRefused)).toBeTruthy();
  });

  it('checking: says the tab is being checked, so the only tab does not look like a broken mic', () => {
    for (const state of ['pending', 'acquiring'] as const) {
      render(<SpeakingTabNotice state={state} refused={false} strings={VI} lang="vi" onTakeover={noop} onReload={noop} />);
      expect(screen.getByText('Đang kiểm tra tab…')).toBeTruthy();
      cleanup();
    }
  });

  it('nothing to say while writing, releasing or with no guard', () => {
    for (const state of ['writer', 'releasing', 'unsupported'] as const) {
      const { container } = render(<SpeakingTabNotice state={state} refused={false} strings={VI} lang="vi" onTakeover={noop} onReload={noop} />);
      expect(container.querySelector('[data-room-tab-notice]')).toBeNull();
      cleanup();
    }
  });
});

describe('useSpeakingTabGuard', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  let writeRight: boolean[];
  let flushResult: { secured: boolean; unsaved: number };
  let reload: ReturnType<typeof vi.fn>;
  const realLocation = window.location;

  beforeEach(() => {
    browser = fakeBrowser();
    writeRight = [];
    flushResult = { secured: true, unsaved: 0 };
    reload = vi.fn();
    Object.defineProperty(navigator, 'locks', { value: browser.locks, configurable: true });
    vi.stubGlobal('BroadcastChannel', function FakeChannel(name: string) { return (browser.channelFactory as any)(name); });
    Object.defineProperty(window, 'location', { value: { ...realLocation, search: '?session_id=s-1', reload }, configurable: true });
    (window as any).PracticeApp = {
      setWriteRight: (allowed: boolean) => { writeRight.push(allowed); },
      roomFlush: () => Promise.resolve(flushResult),
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (navigator as any).locks;
    Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
    delete (window as any).PracticeApp;
  });

  it('the attempt key is the session_id of the page', () => {
    expect(speakingAttemptKey()).toBe('s-1');
  });

  it('the only tab writes, and the first lock does not reload the page', async () => {
    const a = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(a.result.current.state).toBe('writer'));
    expect(writeRight.at(-1)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('until the lock answers, nothing records or sends; the right opens only for writer (CR #2649)', async () => {
    let grant: ((lock: unknown) => void) | null = null;
    const slow = { request: (_name: string, _opts: unknown, cb: (lock: unknown) => unknown) => new Promise((resolve) => { grant = (lock) => { resolve(cb(lock)); }; }) };
    Object.defineProperty(navigator, 'locks', { value: slow, configurable: true });
    const a = renderHook(() => useSpeakingTabGuard('s-1'));
    expect(a.result.current.state).toBe('pending');
    expect(writeRight).toEqual([false]);
    expect(writeRight).not.toContain(true);
    act(() => { grant!({ name: 'exam-room:speaking:s-1' }); });
    await waitFor(() => expect(a.result.current.state).toBe('writer'));
    expect(writeRight.at(-1)).toBe(true);
  });

  it('a second tab is read-only: no microphone, no upload', async () => {
    const a = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(a.result.current.state).toBe('writer'));
    const before = writeRight.length;
    const b = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(b.result.current.state).toBe('read-only'));
    expect(writeRight.slice(before)).not.toContain(true);
    expect(writeRight.at(-1)).toBe(false);
  });

  it('"Dùng tab này" with nothing unsent: the old tab turns read-only, the new one reloads to show what was sent', async () => {
    const a = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(a.result.current.state).toBe('writer'));
    const b = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(b.result.current.state).toBe('read-only'));
    act(() => { b.result.current.takeover(); });
    // A takeover waiting for the other tab must not write yet.
    expect(writeRight.at(-1)).toBe(false);
    await waitFor(() => expect(a.result.current.state).toBe('read-only'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(b.result.current.state).toBe('acquiring');
  });

  it('a take still recording, unsent or uploading: the old tab keeps writing and says so; the new tab is stuck', async () => {
    flushResult = { secured: false, unsaved: 1 };
    const a = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(a.result.current.state).toBe('writer'));
    const b = renderHook(() => useSpeakingTabGuard('s-1'));
    await waitFor(() => expect(b.result.current.state).toBe('read-only'));
    act(() => { b.result.current.takeover(); });
    await waitFor(() => expect(b.result.current.state).toBe('stuck'));
    expect(a.result.current.state).toBe('writer');
    expect(a.result.current.refused).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('no session_id: no guard, the tab writes as before', () => {
    const a = renderHook(() => useSpeakingTabGuard(''));
    expect(a.result.current.state).toBe('unsupported');
    expect(writeRight.at(-1)).toBe(true);
  });
});
