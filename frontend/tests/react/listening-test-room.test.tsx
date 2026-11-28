// EXAMLISTENT-0070 T002 (G08-T14): the Listening test drawn in the exam room.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ListeningTestRoom, listeningAudioStatus, listeningRoomSaveStatus, type ListeningTestRoomProps,
} from '@/app/(authed-listening-player)/listening/test/session/listening-test-room';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function props(overrides: Partial<ListeningTestRoomProps> = {}): ListeningTestRoomProps {
  return {
    phase: 'inprogress',
    error: '',
    title: 'Cambridge 18 Test 1',
    practice: false,
    isFullTest: true,
    adminPreview: false,
    embedded: false,
    attemptId: 'att-1',
    ownerKey: 'user-1',
    backHref: '/listening',
    sectionNums: [1, 2, 3, 4],
    activeSection: 2,
    questionsBySection: new Map([[1, [1, 2]], [2, [3, 4]], [3, [5]], [4, [6]]]),
    answers: new Map([[1, 'library']]),
    saveStates: new Map(),
    lastSavedAt: null,
    currentQuestion: 3,
    reviewQuestions: new Set(),
    flagsReady: true,
    resumeAvailable: false,
    admissionRequired: false,
    savedAnswerCount: 0,
    submitBlocked: '',
    session: 'active',
    audio: {
      policy: 'test', playing: true, started: true, ended: false, current: 750, duration: 1800,
      error: '', retrying: false, needsGesture: false, element: <audio data-testid="surface-audio" />,
      onPlay: vi.fn(), onPause: vi.fn(), onSeek: vi.fn(), onRetry: vi.fn(),
    },
    submit: { outcome: 'idle', message: null, onSubmit: vi.fn(() => Promise.resolve()), onRetry: vi.fn() },
    renderSection: (n) => <p>Paper for part {n}</p>,
    onStartFresh: vi.fn(),
    onResume: vi.fn(),
    onReload: vi.fn(),
    onJump: vi.fn(),
    onToggleFlag: vi.fn(),
    onRetrySaves: vi.fn(),
    flush: vi.fn(() => Promise.resolve({ unsaved: 0 })),
    saveLocalCopy: vi.fn(() => true),
    reloadFromServer: vi.fn(() => Promise.resolve()),
    onWriteRightChange: vi.fn(),
    ...overrides,
  };
}

describe('helpers', () => {
  it('FR-009: save status from the coordinator snapshot', () => {
    const at = new Date(2026, 10, 23, 10, 42);
    const retry = vi.fn();
    expect(listeningRoomSaveStatus(new Map(), null, retry)).toEqual({ state: 'idle' });
    expect(listeningRoomSaveStatus(new Map(), at, retry)).toEqual({ state: 'saved', lastSavedAt: at });
    expect(listeningRoomSaveStatus(new Map([[3, 'pending']]), at, retry)).toEqual({ state: 'saving', lastSavedAt: at });
    expect(listeningRoomSaveStatus(new Map([[3, 'retrying'], [4, 'pending']]), at, retry)).toEqual({ state: 'retrying', lastSavedAt: at, unsaved: 2 });
    expect(listeningRoomSaveStatus(new Map([[3, 'failed']]), at, retry)).toEqual({ state: 'failed', lastSavedAt: at, unsaved: 1, onRetry: retry });
  });

  it('FR-004: audio progress in words, no countdown', () => {
    const audio = { policy: 'test' as const, playing: true, started: true, ended: false, current: 750, duration: 1800 };
    expect(listeningAudioStatus(audio)).toBe('Audio 12:30 / 30:00');
    expect(listeningAudioStatus({ ...audio, playing: false, started: false })).toBe('Audio ready');
    expect(listeningAudioStatus({ ...audio, ended: true, playing: false })).toBe('Audio has ended');
    expect(listeningAudioStatus({ ...audio, policy: 'practice' })).toBe('Practice audio playing');
  });
});

describe('ListeningTestRoom', () => {
  it('FR-003/FR-004: title, "Part i of n", audio words, no email and no timer', () => {
    render(<ListeningTestRoom {...props()} />);
    expect(screen.getAllByText('Listening · Cambridge 18 Test 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Part 2 of 4 · Audio 12:30 \/ 30:00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByText('Paper for part 2')).toBeTruthy();
    expect(screen.getByTestId('surface-audio')).toBeTruthy();
  });

  it('FR-011: a full test says in the leave box that the recording keeps playing while away (CR #2557 F3)', async () => {
    render(<ListeningTestRoom {...props()} />);
    expect(screen.queryByText(/keeps playing on our side/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/keeps playing on our side while you are away/)).toBeTruthy();
    cleanup();
    render(<ListeningTestRoom {...props({ isFullTest: false })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const practiceDialog = await screen.findByRole('alertdialog');
    expect(within(practiceDialog).queryByText(/keeps playing on our side/)).toBeNull();
  });

  it('FR-010: signed out on submit, "Try again" stays on screen (CR #2557 F1)', () => {
    const onRetry = vi.fn();
    render(<ListeningTestRoom {...props({ submit: { outcome: 'unconfirmed_manual', message: null, onSubmit: vi.fn(() => Promise.resolve()), onRetry } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('FR-005: "Start a new attempt" asks in the page, never window.confirm', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onStartFresh = vi.fn();
    render(<ListeningTestRoom {...props({ phase: 'prestart', resumeAvailable: true, savedAnswerCount: 7, onStartFresh })} />);
    expect(screen.getByText(/unfinished attempt with 7 saved answers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new attempt' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Start a new attempt?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep current attempt' }));
    expect(onStartFresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new attempt' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start new attempt' }));
    expect(onStartFresh).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('FR-005: no attempt yet starts straight away', () => {
    const onStartFresh = vi.fn();
    render(<ListeningTestRoom {...props({ phase: 'prestart', onStartFresh })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    expect(onStartFresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The recording plays once. You cannot rewind or restart it.')).toBeTruthy();
  });

  it('FR-010: unsaved answers block submit, with Retry', () => {
    const onRetrySaves = vi.fn();
    render(<ListeningTestRoom {...props({ saveStates: new Map([[3, 'failed']]), submitBlocked: 'Some answers have not been saved.', onRetrySaves })} />);
    const alert = screen.getByText('Some answers have not been saved.').closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetrySaves).toHaveBeenCalled();
  });

  it('FR-010: an abandoned attempt shows the message with Back and no submit', () => {
    render(<ListeningTestRoom {...props({ submit: { outcome: 'abandoned', message: 'This attempt was abandoned and was not submitted.', onSubmit: vi.fn(), onRetry: vi.fn() } })} />);
    const alert = screen.getByText('This attempt was abandoned and was not submitted.').closest('[role="alert"]') as HTMLElement;
    expect(within(alert).getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/listening');
    expect(screen.queryByRole('button', { name: 'Submit answers' })).toBeNull();
  });

  it('FR-016: embedded has no submit button', () => {
    render(<ListeningTestRoom {...props({ embedded: true })} />);
    expect(screen.queryByRole('button', { name: 'Submit answers' })).toBeNull();
    expect(screen.getByText('Paper for part 2')).toBeTruthy();
  });

  it('FR-017: admin preview is labelled and cannot submit', () => {
    render(<ListeningTestRoom {...props({ adminPreview: true, attemptId: null })} />);
    expect(screen.getAllByText(/Admin preview/).length).toBeGreaterThan(0);
    expect(screen.getByText('Preview only. Answers stay in this tab and no test attempt or result is saved.')).toBeTruthy();
  });

  it('FR-006: practice audio shows its own words', () => {
    render(<ListeningTestRoom {...props({ practice: true, isFullTest: false, audio: { ...props().audio, policy: 'practice', playing: false } })} />);
    expect(screen.getAllByText(/Practice audio ready/).length).toBeGreaterThan(0);
  });

  it('shows the load error with Retry', () => {
    const onReload = vi.fn();
    render(<ListeningTestRoom {...props({ phase: 'error', error: 'Unable to load the Listening test.', onReload })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
