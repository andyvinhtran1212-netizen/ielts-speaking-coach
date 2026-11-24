// EXAMSPEAK-0072 T001 (G08-T18) FR-001, FR-003, FR-004, FR-005, FR-011: the
// Speaking page with the exam room flag off (unchanged) and on (focus bar,
// microphone cases, recording state in words, too-short reason in the page).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MicStatus, type MicState } from '@/app/(authed-practice)/practice/session/mic-status';
import { PracticePageShell } from '@/app/(authed-practice)/practice/session/practice-page-shell';
import { RecordingStatus, SILENCE_MS } from '@/app/(authed-practice)/practice/session/recording-status';
import { SPEAKING_ROOM_STRINGS_EN as EN, SPEAKING_ROOM_STRINGS_VI as VI } from '@/lib/exam-room/strings-speaking.mjs';
import { SpeakingPlayerController } from '@/lib/speaking-player-controller.mjs';

// next/font does not run under jsdom; the room puts this class on its .av2-root.
vi.mock('@/styles/av2/fonts', () => ({ av2FontClass: 'av2-fonts' }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete (window as any).PracticeApp; });

function player(state = 'prep') {
  const controller = new SpeakingPlayerController({ document });
  controller.currentState = state;
  return controller;
}

function shell(p: SpeakingPlayerController) {
  return render(<PracticePageShell player={p as any} />);
}

describe('flag off (FR-001)', () => {
  it('renders the page exactly as before: legacy header, <main>, no room slot', () => {
    const p = player();
    const { container } = shell(p);
    expect(container.querySelector('header.practice-header')).not.toBeNull();
    expect(container.querySelector('main.flex-1')).not.toBeNull();
    expect(container.querySelector('[data-exam-room-speaking]')).toBeNull();
    expect(container.querySelector('[data-room-slot]')).toBeNull();
    expect(container.querySelector('.av2-root')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('ignores room-only view fields while the flag is off', () => {
    const p = player();
    p.updateView('mic', { state: 'denied' });
    p.updateView('recording', { tooShort: { part: 1, durationSeconds: 3, minSeconds: 15 }, level: 0 });
    const { container } = shell(p);
    expect(container.querySelector('[data-mic-state]')).toBeNull();
    expect(container.querySelector('[data-room-too-short]')).toBeNull();
  });
});

describe('flag on', () => {
  // The room is a lazy chunk: resolve it once so the tests below render it synchronously.
  beforeAll(async () => {
    const p = player();
    p.updateView('frame', { examRoomMode: true, examRoomSessionMode: 'practice' });
    shell(p);
    await screen.findByRole('timer');
    cleanup();
  });

  beforeEach(() => { vi.spyOn(window, 'alert').mockImplementation(() => {}); });

  function roomPlayer(state = 'prep') {
    const p = player(state);
    p.updateView('frame', { examRoomMode: true, examRoomSessionMode: 'practice' });
    p.updateView('prep', { inlineRecordingVisible: true });
    return p;
  }

  it('wraps the page in the practice focus bar with "‹ Thoát" and a running clock', () => {
    vi.useFakeTimers();
    const p = roomPlayer();
    const { container } = shell(p);
    expect(container.querySelector('header.practice-header')).toBeNull();
    expect(screen.getByRole('button', { name: /Thoát/ })).toBeTruthy();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('[data-exam-room-speaking] #state-prep')).not.toBeNull();
    // The room root carries the fonts; .av2-root (base.css) sits only on the
    // room's slots, never around the legacy body, its h2 or its links.
    expect(container.querySelector('.av2-fonts[data-speaking-room-root] [data-exam-room-speaking]')).not.toBeNull();
    expect(container.querySelector('.av2-root [data-exam-room-speaking]')).toBeNull();
    expect(container.querySelector('.av2-root h2, .av2-root .practice-completion-cta')).toBeNull();
    expect(container.querySelector('#state-prep [data-room-slot="recorder"].av2-root')).not.toBeNull();
    expect(screen.getByRole('timer').textContent).toBe('0:00');
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByRole('timer').textContent).toBe('1:05');
  });

  it('keeps every legacy id of the page body inside the room (the bar replaces the header)', () => {
    const off = shell(player());
    const ids = [...off.container.querySelectorAll('main [id]')].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(50);
    cleanup();
    const on = shell(roomPlayer());
    for (const id of ids) expect(on.container.querySelector(`[id="${id}"]`), id).not.toBeNull();
  });

  it('"Cho phép micro" asks practice.js for the microphone', () => {
    const requestMicrophone = vi.fn();
    (window as any).PracticeApp = { requestMicrophone, hasUnsavedWork: () => false };
    const p = roomPlayer();
    p.updateView('mic', { state: 'prompt' });
    shell(p);
    expect(screen.getByText(VI.micPrompt)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: VI.micAllow }));
    expect(requestMicrophone).toHaveBeenCalledTimes(1);
  });

  it('pending shows before the browser answers, with the button locked', () => {
    const p = roomPlayer();
    p.updateView('mic', { state: 'pending' });
    shell(p);
    expect(screen.getByText(VI.micPending)).toBeTruthy();
    expect((screen.getByRole('button', { name: VI.micPendingButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Part 1 too short: the reason with the numbers practice.js sent, never an alert', () => {
    const p = roomPlayer();
    p.updateView('recording', { substate: 'recorded', tooShort: { part: 1, durationSeconds: 12, minSeconds: 15 } });
    shell(p);
    expect(screen.getByRole('alert').textContent).toBe('Bản ghi 12 giây, Part 1 cần ít nhất 15 giây. Hãy ghi lại với câu trả lời dài hơn.');
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('Part 2 too short: the reason on the cue card screen (server detail.min_seconds)', () => {
    const p = roomPlayer('p2a');
    p.updateView('part2', { tooShort: { part: 2, durationSeconds: 61.7, minSeconds: 80 } });
    const { container } = shell(p);
    const slot = container.querySelector('#state-p2a [data-room-slot="part2-cue"]') as HTMLElement;
    expect(within(slot).getByRole('alert').textContent).toMatch(/^Bản ghi 61 giây, Part 2 cần ít nhất 80 giây\./);
  });

  it('Part 2 speaking shows the recording state in words', () => {
    const p = roomPlayer('p2c');
    p.updateView('part2', { speakTimer: '1:40' });
    p.updateView('recording', { level: 0.3 });
    const { container } = shell(p);
    const status = container.querySelector('#state-p2c [data-rec-phase]') as HTMLElement;
    expect(status.dataset.recPhase).toBe('recording');
    expect(status.textContent).toContain('1:40');
  });

  it('hides the site navigation while shown and gives it back (UIBASE-0056 FR-009)', () => {
    const chrome = document.createElement('aver-chrome');
    document.body.prepend(chrome);
    const view = shell(roomPlayer());
    expect(chrome.style.display).toBe('none');
    view.unmount();
    expect(chrome.style.display).toBe('');
    chrome.remove();
  });

  it('flag off keeps the site navigation', () => {
    const chrome = document.createElement('aver-chrome');
    document.body.prepend(chrome);
    shell(player());
    expect(chrome.style.display).toBe('');
    chrome.remove();
  });

  it('slots take the legacy card background and do not repeat the recorded duration', () => {
    const p = roomPlayer();
    p.updateView('recording', { substate: 'recorded', duration: 'Thời lượng ghi âm: 0:20' });
    const { container } = shell(p);
    const slot = container.querySelector('[data-room-slot="recorder"]') as HTMLElement;
    expect(slot.style.background).toBe('transparent');
    expect(slot.textContent).not.toContain('0:20');
    expect(container.querySelector('#rec-duration-display')?.textContent).toBe('Thời lượng ghi âm: 0:20');
  });

  it('no topic: the bar title has no trailing "·"', () => {
    const p = roomPlayer();
    p.updateView('header', { visible: true, info: 'Part 1 · ', progress: '1 / 1' });
    const { container } = shell(p);
    const bar = container.querySelector('[data-speaking-room-root]') as HTMLElement;
    expect(bar.textContent).toContain('Part 1');
    expect(bar.textContent).not.toMatch(/Part 1\s*·\s*(1 \/ 1|$)/);
  });

  it('a full test uses the English room words (FR-011)', () => {
    const p = roomPlayer();
    p.updateView('frame', { examRoomSessionMode: 'test_full' });
    p.updateView('mic', { state: 'not_found' });
    shell(p);
    expect(screen.getByText(EN.micNotFound)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Leave test/ })).toBeTruthy();
  });
});

describe('flag on: boxes in the page (FR-006–FR-008, FR-010, FR-012)', () => {
  beforeAll(() => {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
    proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  });
  beforeEach(() => { vi.spyOn(window, 'confirm').mockImplementation(() => true); });

  function app(extra: Record<string, unknown> = {}) {
    const calls: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return false; };
    (window as any).PracticeApp = {
      hasUnsavedWork: () => true,
      requestLeave: record('requestLeave'),
      confirmLeave: record('confirmLeave'),
      confirmRerecord: record('confirmRerecord'),
      confirmSubmitWithUnsent: record('confirmSubmitWithUnsent'),
      ...extra,
    };
    return calls;
  }

  function roomWith(dialog: Record<string, unknown> | null, sessionMode = 'practice') {
    const p = player('prep');
    p.updateView('frame', { examRoomMode: true, examRoomSessionMode: sessionMode });
    if (dialog) p.updateView('dialog', dialog);
    return { p, ...shell(p) };
  }

  it('re-record: "Giữ bản ghi" is the primary, focused way; each answer goes to practice.js', async () => {
    const calls = app();
    roomWith({ kind: 'rerecord', unsent: 1 });
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByText(VI.rerecordTitle)).toBeTruthy();
    const keep = within(box).getByRole('button', { name: VI.rerecordKeep });
    await waitFor(() => expect(document.activeElement).toBe(keep));
    fireEvent.click(keep);
    fireEvent.click(within(box).getByRole('button', { name: VI.rerecordDiscard }));
    expect(calls).toEqual([['confirmRerecord', false], ['confirmRerecord', true]]);
  });

  it('leave box from a link: "Ở lại" first, "Bỏ bản ghi và thoát" leaves', async () => {
    const calls = app();
    roomWith({ kind: 'leave', unsent: 2 });
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByText(VI.leaveTitle)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole('button', { name: VI.leaveStay })));
    fireEvent.click(within(box).getByRole('button', { name: VI.leaveGo }));
    expect(calls).toEqual([['confirmLeave', true]]);
  });

  it('a link in the page with unsent work asks practice.js first, and Next never sees the click', () => {
    const calls = app();
    const { container } = roomWith(null);
    const link = container.querySelector('#state-error a') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual([['requestLeave', '/speaking']]);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('a link with nothing unsent goes through untouched', () => {
    const calls = app({ hasUnsavedWork: () => false });
    const { container } = roomWith(null);
    const link = container.querySelector('#state-error a') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault()); // keep jsdom on the page
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    expect(calls).toEqual([]);
  });

  it('"‹ Thoát" with unsent work: the bar\'s box says so in the room\'s words', () => {
    app();
    roomWith(null);
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByText(VI.leaveTitle)).toBeTruthy();
    expect(within(box).getByRole('button', { name: VI.leaveStay })).toBeTruthy();
    expect(within(box).getByRole('button', { name: VI.leaveGo })).toBeTruthy();
  });

  it('submit with failed re-records: the count, "Gửi lại bản ghi" first, "Vẫn nộp" second', async () => {
    const calls = app();
    roomWith({ kind: 'submit', unsent: 1 });
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByText('Còn 1 bản ghi mới chưa gửi được')).toBeTruthy();
    expect(within(box).getByText(VI.submitBody)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole('button', { name: VI.submitRetry })));
    fireEvent.click(within(box).getByRole('button', { name: VI.submitAnyway }));
    expect(calls).toEqual([['confirmSubmitWithUnsent', 'submit']]);
  });

  it('401 with an unsent take: only "Ở lại làm tiếp", no sign-in and no way to drop the take (FR-010)', () => {
    const calls = app();
    const href = window.location.href;
    roomWith({ kind: 'expired', unsent: 1 });
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByText(VI.expiredUnsent)).toBeTruthy();
    const buttons = within(box).getAllByRole('button').filter((b) => b.textContent !== VI.close && b.getAttribute('aria-label') !== VI.close);
    expect(buttons.map((b) => b.textContent)).toEqual([VI.expiredStay]);
    expect(within(box).queryByRole('button', { name: VI.expiredSignIn })).toBeNull();
    expect(within(box).queryByRole('link')).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: VI.expiredStay }));
    expect(calls).toEqual([['confirmLeave', false]]);
    expect(window.location.href).toBe(href);
  });

  it('401 with an unsent take in a full test: only "Stay"', () => {
    app();
    roomWith({ kind: 'expired', unsent: 2 }, 'test_full');
    const box = screen.getByRole('alertdialog');
    expect(within(box).getByRole('button', { name: EN.expiredStay })).toBeTruthy();
    expect(within(box).queryByRole('button', { name: EN.expiredSignIn })).toBeNull();
  });

  it('401 with nothing unsent: only "Đăng nhập lại"', () => {
    app();
    roomWith({ kind: 'expired', unsent: 0 });
    const box = screen.getByRole('alertdialog');
    expect(within(box).getAllByRole('button').filter((b) => b.textContent === VI.expiredSignIn)).toHaveLength(1);
    expect(within(box).queryByText(VI.expiredUnsent)).toBeNull();
  });

  it('a full test asks in English', () => {
    app();
    roomWith({ kind: 'rerecord', unsent: 1 }, 'test_full');
    expect(screen.getByText(EN.rerecordTitle)).toBeTruthy();
  });

  it('no box, no dialog; and the old confirm/alert are never used', () => {
    app();
    roomWith(null);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe('MicStatus (FR-003)', () => {
  const strings = VI;
  function mic(state: MicState, onRequest = vi.fn(), track = vi.fn()) {
    return { ...render(<MicStatus state={state} strings={strings} onRequest={onRequest} track={track} />), onRequest, track };
  }

  it('granted and unknown draw nothing but keep the live region', () => {
    for (const s of ['granted', 'unknown'] as MicState[]) {
      const { container } = mic(s);
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
      cleanup();
    }
  });

  it('denied: three steps, "Thử lại", one alert, reported once by name only', () => {
    const { onRequest, track, rerender } = mic('denied');
    const alert = screen.getByRole('alert');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(3);
    expect(alert.textContent).toContain(VI.micDeniedKept);
    fireEvent.click(within(alert).getByRole('button', { name: VI.micRetry }));
    expect(onRequest).toHaveBeenCalledTimes(1);
    rerender(<MicStatus state="denied" strings={strings} onRequest={onRequest} track={track} />);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('exam_room_mic', { surface: 'speaking', state: 'denied' });
  });

  it('not found and busy: the reason and "Thử lại"', () => {
    mic('not_found');
    expect(screen.getByText(VI.micNotFound)).toBeTruthy();
    expect(screen.getByRole('button', { name: VI.micRetry })).toBeTruthy();
    cleanup();
    mic('busy');
    expect(screen.getByText(VI.micBusy)).toBeTruthy();
  });

  it('unsupported: the reason, no button', () => {
    mic('unsupported');
    expect(screen.getByText(VI.micUnsupported)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RecordingStatus (FR-004)', () => {
  const base = { timer: '0:07', duration: 'Thời lượng ghi âm: 0:20', strings: VI };
  const phase = (c: HTMLElement) => (c.querySelector('[data-rec-phase]') as HTMLElement).dataset.recPhase;

  it('ready, recording with the clock, recorded with the duration, in words', () => {
    const { container, rerender } = render(<RecordingStatus substate="idle" {...base} />);
    expect(screen.getByRole('status').textContent).toBe(VI.recReady);
    rerender(<RecordingStatus substate="recording" level={0.4} {...base} />);
    expect(screen.getByRole('status').textContent).toBe(`${VI.recRecording}0:07`);
    rerender(<RecordingStatus substate="recorded" {...base} />);
    expect(phase(container)).toBe('recorded');
    expect(screen.getByRole('status').textContent).toContain('0:20');
  });

  it('"Không nghe thấy tiếng" only after 3 s below the threshold, even if the level never changes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<RecordingStatus substate="recording" level={0} {...base} />);
    act(() => { vi.advanceTimersByTime(SILENCE_MS - 100); });
    expect(phase(container)).toBe('recording');
    act(() => { vi.advanceTimersByTime(200); });
    expect(phase(container)).toBe('silent');
    expect(screen.getByRole('status').textContent).toContain(VI.recSilent);
    rerender(<RecordingStatus substate="recording" level={0.5} {...base} />);
    expect(phase(container)).toBe('recording');
  });

  it('no level (no analyser) never reports silence', () => {
    vi.useFakeTimers();
    const { container } = render(<RecordingStatus substate="recording" level={null} {...base} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(phase(container)).toBe('recording');
  });

  it('paused by the browser (muted mic)', () => {
    const { container } = render(<RecordingStatus substate="recording" level={0} paused {...base} />);
    expect(phase(container)).toBe('paused');
    expect(screen.getByRole('status').textContent).toContain(VI.recPaused);
  });
});
