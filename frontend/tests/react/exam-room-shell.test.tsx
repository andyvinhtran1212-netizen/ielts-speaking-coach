// EXAMROOM-0066 T002 (G08-T03): ExamRoomShell and its parts on G03 components.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExamRoomShell, formatClock, unsavedCount } from '@/components/exam-room/exam-room-shell';
import { loginHref } from '@/components/exam-room/session-expired-dialog';
import type { ExamRoomQuestion, ExamRoomSection, ExamRoomShellProps } from '@/components/exam-room/types';
import { localCopyKey, writeLocalCopy } from '@/lib/exam-room/local-copy.mjs';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const VIETNAMESE = /[À-ÿĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

const SECTIONS: ExamRoomSection[] = [
  { id: 'p1', kind: 'passage', index: 1, firstQ: 1, lastQ: 3 },
  { id: 'p2', kind: 'passage', index: 2, firstQ: 4, lastQ: 6 },
];
function qs(overrides: Partial<Record<number, Partial<ExamRoomQuestion>>> = {}): ExamRoomQuestion[] {
  return [1, 2, 3, 4, 5, 6].map((q) => ({ q, sectionId: q <= 3 ? 'p1' : 'p2', answered: q <= 2, flagged: false, ...overrides[q] }));
}

function base(overrides: Partial<ExamRoomShellProps> = {}): ExamRoomShellProps {
  return {
    mode: 'test',
    surface: 'reading',
    attemptKey: 'att-1',
    title: 'Reading · Academic Test 1',
    subtitle: 'Passage 1 of 3',
    timer: { kind: 'countdown', remainingSeconds: 1200, onExpire: vi.fn() },
    saveStatus: { state: 'saved', lastSavedAt: new Date(2026, 10, 23, 10, 42) },
    sections: SECTIONS,
    questions: qs(),
    currentQ: 2,
    onJump: vi.fn(),
    layout: { kind: 'split', left: <p>Passage text</p>, right: <input aria-label="Answer 1" />, leftLabel: 'Passage', rightLabel: 'Questions' },
    submit: { label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()) },
    exit: { href: '/tests', flush: vi.fn(() => Promise.resolve({ unsaved: 0 })), losesWork: () => false },
    ownerKey: 'user-1',
    track: vi.fn(),
    viewportWidth: 1280,
    ...overrides,
  };
}

function stubAssign() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

describe('helpers', () => {
  it('formats the clock and never shows a negative time', () => {
    expect(formatClock(1200)).toBe('20:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-3)).toBe('00:00');
  });
  it('counts unsaved answers from the status and the cells', () => {
    expect(unsavedCount({ state: 'saved', lastSavedAt: new Date() }, qs())).toBe(0);
    expect(unsavedCount({ state: 'retrying', unsaved: 2 }, qs())).toBe(2);
    expect(unsavedCount({ state: 'saving' }, qs({ 3: { saveState: 'pending' }, 4: { saveState: 'failed' } }))).toBe(2);
  });
  it('sends the learner to /login with the room URL', () => {
    expect(loginHref('/reading/test?attempt=1&x=2')).toBe('/login?next=%2Freading%2Ftest%3Fattempt%3D1%26x%3D2');
  });
});

describe('top bar (FR-002, FR-013, FR-018)', () => {
  it('test mode is English only, with the timer and save status', () => {
    const { container } = render(<ExamRoomShell {...base()} />);
    expect((screen.getByRole('timer', { name: 'Time remaining' }))?.textContent).toContain('20:00');
    expect(screen.getAllByText('Saved at 10:42').length).toBeGreaterThan(0);
    expect((container.querySelector('[data-exam-room]')).getAttribute('lang')).toBe('en');
    expect(container.textContent).not.toMatch(VIETNAMESE);
  });

  it('practice mode is Vietnamese', () => {
    render(<ExamRoomShell {...base({ mode: 'practice', submit: { label: 'Nộp bài', onSubmit: vi.fn(() => Promise.resolve()) } })} />);
    expect(screen.getByRole('timer', { name: 'Còn lại' })).toBeTruthy();
    expect(screen.getAllByText('Đã lưu lúc 10:42').length).toBeGreaterThan(0);
  });

  it('shows "5 minutes left" in words and announces it once', () => {
    const { rerender } = render(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 301, onExpire: vi.fn() } })} />);
    expect(screen.queryByText('5 minutes left')).toBeNull();
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 300, onExpire: vi.fn() } })} />);
    const live = document.querySelector('[aria-live="assertive"]');
    expect((live)?.textContent).toContain('5 minutes left');
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 299, onExpire: vi.fn() } })} />);
    expect(screen.getAllByText('5 minutes left')).toHaveLength(2);
  });

  it('calls onExpire once at zero and locks the inputs', () => {
    const onExpire = vi.fn();
    const { rerender } = render(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 1, onExpire } })} />);
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(false);
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 0, onExpire } })} />);
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: -1, onExpire } })} />);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(true);
    expect(screen.getAllByText('Time is up').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit test' })).toBeNull();
  });

  it('save failure shows Retry', () => {
    const onRetry = vi.fn();
    render(<ExamRoomShell {...base({ saveStatus: { state: 'failed', unsaved: 1, onRetry } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('Not saved. Retrying…')).toBeTruthy();
  });
});

describe('submit (FR-010, FR-014, FR-034)', () => {
  it('warns about blank questions, focuses the safe button and submits', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const track = vi.fn();
    render(<ExamRoomShell {...base({ submit: { label: 'Submit test', onSubmit }, track })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Submit with 4 unanswered questions?')).toBeTruthy();
    expect(within(dialog).getByText(/Questions Q3, Q4, Q5 and Q6 are blank/)).toBeTruthy();
    expect(within(dialog).getByText('Warning')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('exam_room_submit_dialog_opened', { surface: 'reading', unanswered: 4 });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Return to test' })));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit test' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('exam_room_submit_confirmed', { surface: 'reading' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('plain box when every question is answered', async () => {
    render(<ExamRoomShell {...base({ questions: qs({ 3: { answered: true }, 4: { answered: true }, 5: { answered: true }, 6: { answered: true } }) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Submit test?')).toBeTruthy();
    expect(within(dialog).queryByText('Warning')).toBeNull();
  });

  it('a failed submit keeps the box open with the reason in words', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('net')));
    render(<ExamRoomShell {...base({ submit: { label: 'Submit test', onSubmit } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit test' }));
    expect(await within(dialog).findByText(/We could not submit your answers/)).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('shows the cost note only when the surface passes one', async () => {
    const { unmount } = render(<ExamRoomShell {...base({ submit: { label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), costNote: 'This uses 1 marking credit.' } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(await screen.findByText(/This uses 1 marking credit\./)).toBeTruthy();
    unmount();
    render(<ExamRoomShell {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/credit/)).toBeNull();
  });

  it('offline: the manual submit waits for the connection; back online after the queue drains', async () => {
    const track = vi.fn();
    const props = base({ track });
    const { rerender } = render(<ExamRoomShell {...props} />);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(/Connection lost\. Your work was saved up to 10:42/)).toBeTruthy();
    const wait = screen.getByRole('button', { name: 'Waiting for connection' });
    expect((wait) as HTMLButtonElement).toHaveProperty('disabled', true);
    // Still offline in a sense: a save is pending when the network returns.
    rerender(<ExamRoomShell {...props} saveStatus={{ state: 'retrying', unsaved: 1 }} />);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByText(/Connection lost/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('exam_room_offline', expect.objectContaining({ duration_s: expect.any(Number) }));
    rerender(<ExamRoomShell {...props} saveStatus={{ state: 'saved', lastSavedAt: new Date(2026, 10, 23, 10, 50) }} />);
    expect(await screen.findByText('Back online. Your work has been saved.')).toBeTruthy();
  });

  it('unsaved answers lock the manual submit with a reason', () => {
    render(<ExamRoomShell {...base({ saveStatus: { state: 'retrying', unsaved: 2 } })} />);
    expect((screen.getByRole('button', { name: 'Submit test' })) as HTMLButtonElement).toHaveProperty('disabled', true);
    expect(screen.getByText('Saving your answers…')).toBeTruthy();
  });

  it('says "saved and submitted" only when the surface reports confirmed', () => {
    const { rerender } = render(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() }, submit: { label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'submitting' } })} />);
    expect(screen.getByText('Submitting your answers…')).toBeTruthy();
    expect(screen.queryByText(/saved and submitted/)).toBeNull();
    const onRetry = vi.fn();
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() }, submit: { label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'unconfirmed_manual', savedUpTo: '10:58', onRetry } })} />);
    expect(screen.getByText('We could not confirm your submission. Your answers were saved on our server up to 10:58.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<ExamRoomShell {...base({ timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() }, submit: { label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'confirmed' } })} />);
    expect(screen.getByText('Your answers have been saved and submitted.')).toBeTruthy();
  });

  it('expired_unsubmitted: no retry, never "submitted", back to exit, and the device copy goes (amendment 1 (a))', () => {
    const scope = { surface: 'listening-practice', ownerKey: 'user-1', attemptKey: 'att-1' };
    const other = { ...scope, attemptKey: 'att-2' };
    const expiresAt = Date.now() + 60_000;
    writeLocalCopy(window.localStorage, { ...scope, answers: { 1: { value: 'A', baseValue: null } }, expiresAt });
    writeLocalCopy(window.localStorage, { ...other, answers: { 1: { value: 'B', baseValue: null } }, expiresAt });
    const props = base({ surface: 'listening-practice', timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() } });
    const { rerender } = render(<ExamRoomShell {...props} submit={{ label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'submitting' }} />);
    expect(window.localStorage.getItem(localCopyKey(scope))).not.toBeNull();
    rerender(<ExamRoomShell {...props} submit={{ label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'expired_unsubmitted', savedUpTo: '10:58' }} />);
    expect(screen.getByText('Time ran out before your answers reached our server. This attempt was not submitted and has no score. Your answers were saved on our server up to 10:58.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/tests');
    expect(screen.getByRole('textbox', { name: 'Answer 1' }).matches(':disabled')).toBe(true);
    expect(window.localStorage.getItem(localCopyKey(scope))).toBeNull();
    expect(window.localStorage.getItem(localCopyKey(other))).not.toBeNull();
    window.localStorage.clear();
  });

  it('closed_unconfirmed also drops the device copy; unconfirmed_manual keeps it', () => {
    const scope = { surface: 'reading', ownerKey: 'user-1', attemptKey: 'att-1' };
    writeLocalCopy(window.localStorage, { ...scope, answers: { 1: { value: 'A', baseValue: null } }, expiresAt: Date.now() + 60_000 });
    const props = base({ timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() } });
    const { rerender } = render(<ExamRoomShell {...props} submit={{ label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'unconfirmed_manual', savedUpTo: '10:58', onRetry: vi.fn() }} />);
    expect(window.localStorage.getItem(localCopyKey(scope))).not.toBeNull();
    rerender(<ExamRoomShell {...props} submit={{ label: 'Submit test', onSubmit: vi.fn(() => Promise.resolve()), outcome: 'closed_unconfirmed', closedAt: '11:00', savedUpTo: '10:58' }} />);
    expect(window.localStorage.getItem(localCopyKey(scope))).toBeNull();
  });

  it('time-up choice: two buttons, no "saved and submitted" line', async () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<ExamRoomShell {...base({ surface: 'writing', timer: { kind: 'countdown', remainingSeconds: 0, onExpire: vi.fn() }, timeUpChoice: { onSend, onDiscard: vi.fn(() => Promise.resolve()) } })} />);
    expect(screen.getByRole('button', { name: 'Discard this attempt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send for marking' }));
    expect(onSend).toHaveBeenCalled();
    expect(screen.queryByText(/saved and submitted/)).toBeNull();
  });

  it('closes an open box when an answer stops saving, and never submits then (CR P2-2)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const props = base({ submit: { label: 'Submit test', onSubmit } });
    const { rerender } = render(<ExamRoomShell {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByRole('alertdialog');
    rerender(<ExamRoomShell {...props} saveStatus={{ state: 'retrying', unsaved: 1 }} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Saving your answers…')).toBeTruthy();
  });

  it('closes an open box when the session expires', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const props = base({ submit: { label: 'Submit test', onSubmit }, onSessionExpired: { saveLocalCopy: () => true, returnUrl: '/r' } });
    const { rerender } = render(<ExamRoomShell {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByText('Submit with 4 unanswered questions?');
    rerender(<ExamRoomShell {...props} session="expired" />);
    await waitFor(() => expect(screen.queryByText('Submit with 4 unanswered questions?')).toBeNull());
    expect(screen.getByText('Your session has expired')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('time running out with the box open closes it; only the auto-submit runs (Codex)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const onExpire = vi.fn();
    const props = base({ submit: { label: 'Submit test', onSubmit } });
    const { rerender } = render(<ExamRoomShell {...props} timer={{ kind: 'countdown', remainingSeconds: 2, onExpire }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByRole('alertdialog');
    rerender(<ExamRoomShell {...props} timer={{ kind: 'countdown', remainingSeconds: 0, onExpire }} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a save in flight without per-question state locks the submit (Codex)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const props = base({ submit: { label: 'Submit test', onSubmit } });
    const { rerender } = render(<ExamRoomShell {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByRole('alertdialog');
    rerender(<ExamRoomShell {...props} saveStatus={{ state: 'saving', lastSavedAt: new Date(2026, 10, 23, 10, 42) }} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByRole('button', { name: 'Submit test' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a surface reason that appears while the box is open closes it (Codex)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const { rerender } = render(<ExamRoomShell {...base({ submit: { label: 'Submit test', onSubmit } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Submit test' });
    rerender(<ExamRoomShell {...base({ submit: { label: 'Submit test', onSubmit, disabledReason: 'Write at least 150 words first.' } })} />);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Write at least 150 words first.')).toBeTruthy();
  });

  it('no submit prop: no submit button', () => {
    render(<ExamRoomShell {...base({ submit: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Submit test' })).toBeNull();
  });
});

describe('leave and abandon (FR-011, FR-012)', () => {
  it('test mode always asks; flushes on open and leaves after the flush', async () => {
    const assign = stubAssign();
    const flush = vi.fn(() => Promise.resolve({ unsaved: 0 }));
    const track = vi.fn();
    render(<ExamRoomShell {...base({ exit: { href: '/tests', flush, losesWork: () => false }, track })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText('Your answers so far are saved.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave test' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/tests'));
    expect(track).toHaveBeenCalledWith('exam_room_exit_confirmed', { unsaved: 0 });
  });

  it('exit.note adds one line to the leave box (Listening test FR-011)', async () => {
    stubAssign();
    const flush = vi.fn(() => Promise.resolve({ unsaved: 0 }));
    render(<ExamRoomShell {...base({ exit: { href: '/tests', flush, losesWork: () => false, note: 'Your attempt stays open until the deadline.' } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Your attempt stays open until the deadline.')).toBeTruthy();
    expect(await within(dialog).findByText('Your answers so far are saved.')).toBeTruthy();
  });

  it('exit.locked closes an open leave box and keeps it closed (proctor collecting, 0071)', async () => {
    const assign = stubAssign();
    const flush = vi.fn(() => Promise.resolve({ unsaved: 0 }));
    const exit = { href: '/tests', flush, losesWork: () => false };
    const { rerender } = render(<ExamRoomShell {...base({ exit })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    await screen.findByRole('alertdialog');
    rerender(<ExamRoomShell {...base({ exit: { ...exit, locked: true } })} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    rerender(<ExamRoomShell {...base({ exit })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('exit.locked set while the leave flush is still running does not navigate (HOLD #2518)', async () => {
    const assign = stubAssign();
    let finish: (v: { unsaved: number }) => void = () => {};
    const flush = vi.fn(() => new Promise<{ unsaved: number }>((resolve) => { finish = resolve; }));
    const exit = { href: '/tests', flush, losesWork: () => false };
    const { rerender } = render(<ExamRoomShell {...base({ exit })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave test' }));
    await waitFor(() => expect(flush).toHaveBeenCalled());
    rerender(<ExamRoomShell {...base({ exit: { ...exit, locked: true } })} />);
    await act(async () => { finish({ unsaved: 0 }); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('names the unsaved count and never says the answers are saved', async () => {
    stubAssign();
    const flush = vi.fn(() => Promise.resolve({ unsaved: 2 }));
    render(<ExamRoomShell {...base({ saveStatus: { state: 'retrying', unsaved: 2 }, exit: { href: '/tests', flush, losesWork: () => false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText(/2 answers have not been saved yet/)).toBeTruthy();
    expect(within(dialog).queryByText('Your answers so far are saved.')).toBeNull();
  });

  it('does not leave quietly when the last flush finds answers the box did not mention', async () => {
    const assign = stubAssign();
    const flush = vi.fn()
      .mockResolvedValueOnce({ unsaved: 0 })
      .mockResolvedValueOnce({ unsaved: 1 });
    render(<ExamRoomShell {...base({ exit: { href: '/tests', flush, losesWork: () => false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByText('Your answers so far are saved.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave test' }));
    expect(await within(dialog).findByText(/1 answer has not been saved yet/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('practice: a refused leave opens the box with the unsaved count (CR P2-1)', async () => {
    const assign = stubAssign();
    const flush = vi.fn(() => Promise.resolve({ unsaved: 1 }));
    render(<ExamRoomShell {...base({ mode: 'practice', submit: undefined, exit: { href: '/tests', flush, losesWork: () => false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Còn 1 câu chưa lưu. Nếu thoát bây giờ, các câu này có thể mất.')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a failed last flush drops the "saved" line', async () => {
    const assign = stubAssign();
    const flush = vi.fn()
      .mockResolvedValueOnce({ unsaved: 0 })
      .mockRejectedValueOnce(new Error('net'));
    render(<ExamRoomShell {...base({ exit: { href: '/tests', flush, losesWork: () => false } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Leave test/ }));
    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByText('Your answers so far are saved.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave test' }));
    expect(await within(dialog).findByText(/1 answer has not been saved yet/)).toBeTruthy();
    expect(within(dialog).queryByText('Your answers so far are saved.')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('practice mode leaves at once when everything is saved', async () => {
    const assign = stubAssign();
    render(<ExamRoomShell {...base({ mode: 'practice', submit: undefined })} />);
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/tests'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('abandon only when the surface passes it, and asks again', async () => {
    const onAbandon = vi.fn(() => Promise.resolve());
    const { unmount } = render(<ExamRoomShell {...base({ exit: { href: '/tests', flush: vi.fn(() => Promise.resolve({ unsaved: 0 })), losesWork: () => false, abandon: { onAbandon } } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon test' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Abandon this test?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abandon test' }));
    expect(onAbandon).toHaveBeenCalled();
    unmount();
    render(<ExamRoomShell {...base()} />);
    expect(screen.queryByRole('button', { name: 'Abandon test' })).toBeNull();
  });
});

describe('navigator (FR-006–FR-009)', () => {
  it('opens the current section, shows the others as chips, jumps to the first blank', () => {
    const onJump = vi.fn();
    render(<ExamRoomShell {...base({ onJump, questions: qs({ 5: { flagged: true } }) })} />);
    const cell = screen.getByRole('button', { name: 'Question 2, answered, current question' });
    expect((cell).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Answered 2 of 6')).toBeTruthy();
    const chip = screen.getByRole('button', { name: /Passage 2: 0 of 3 answered, 1 flagged/ });
    expect((chip).hasAttribute('data-flag-rule')).toBe(true);
    fireEvent.click(chip);
    expect(onJump).toHaveBeenCalledWith(4);
  });

  it('compact bar below 1024px with previous, position, next and Review', async () => {
    const onJump = vi.fn();
    render(<ExamRoomShell {...base({ viewportWidth: 800, onJump })} />);
    expect(screen.getByText('Q2 of 6 · Passage 1 · 2/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(onJump).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Question 6, not answered' }));
    expect(onJump).toHaveBeenCalledWith(6);
  });

  it('one flag control for the current question', () => {
    const onToggleFlag = vi.fn();
    render(<ExamRoomShell {...base({ onToggleFlag })} />);
    const flag = screen.getByRole('button', { name: 'Flag for review' });
    expect((flag).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(flag);
    expect(onToggleFlag).toHaveBeenCalledWith(2);
  });
});

describe('split (FR-003–FR-005)', () => {
  it('separator moves 5% with the arrow keys and remembers the ratio for the attempt', () => {
    const { unmount } = render(<ExamRoomShell {...base()} />);
    const sep = screen.getByRole('separator');
    expect((sep).getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect((sep).getAttribute('aria-valuenow')).toBe('55');
    fireEvent.keyDown(sep, { key: 'End' });
    expect((sep).getAttribute('aria-valuenow')).toBe('70');
    unmount();
    render(<ExamRoomShell {...base()} />);
    expect((screen.getByRole('separator')).getAttribute('aria-valuenow')).toBe('70');
    cleanup();
    render(<ExamRoomShell {...base({ attemptKey: 'att-2' })} />);
    expect((screen.getByRole('separator')).getAttribute('aria-valuenow')).toBe('50');
  });

  it('two tabs below 900px; both panels stay mounted', () => {
    render(<ExamRoomShell {...base({ viewportWidth: 800 })} />);
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect((screen.getByRole('tab', { name: 'Questions' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Passage text')).toBeTruthy();
  });
});

describe('session (FR-015, FR-016)', () => {
  it('expired: saves the local copy first, then a blocking box with Sign in again', async () => {
    const saveLocalCopy = vi.fn(() => true);
    const track = vi.fn();
    render(<ExamRoomShell {...base({ session: 'expired', onSessionExpired: { saveLocalCopy, returnUrl: '/reading/test?a=1' }, track })} />);
    expect(saveLocalCopy).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Your work was saved up to 10:42/)).toBeTruthy();
    expect((within(dialog).getByRole('link', { name: 'Sign in again' })).getAttribute('href')).toBe('/login?next=%2Freading%2Ftest%3Fa%3D1');
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('exam_room_session_expired', { surface: 'reading' });
  });

  it('says answers may be lost when the browser could not keep a copy', async () => {
    render(<ExamRoomShell {...base({ session: 'expired', onSessionExpired: { saveLocalCopy: () => false, returnUrl: '/r' } })} />);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/could not keep a copy of your answers/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Sign in again' })).toBeTruthy();
  });

  it('not current: in-page notice with Back, no work area', () => {
    const onSessionConflict = vi.fn();
    render(<ExamRoomShell {...base({ session: 'not_current', onSessionConflict })} />);
    expect(screen.getByText('This test is open on another device.')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Back' })).getAttribute('href')).toBe('/tests');
    expect(screen.queryByLabelText('Answer 1')).toBeNull();
    expect(onSessionConflict).toHaveBeenCalledWith('not_current');
  });
});

describe('other tab (FR-017)', () => {
  it('read-only with "Use this tab" when another tab holds the lock', async () => {
    const request = vi.fn((_name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => unknown) => {
      if (opts?.ifAvailable) return Promise.resolve(cb(null));
      return new Promise(() => {});
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const onWriteRightChange = vi.fn();
    const track = vi.fn();
    render(<ExamRoomShell {...base({ track, tabGuard: { reloadFromServer: () => Promise.resolve(), onWriteRightChange } })} />);
    expect(await screen.findByText('This test is open in another tab.')).toBeTruthy();
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(true);
    expect((screen.getByRole('button', { name: 'Submit test' })) as HTMLButtonElement).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Use this tab' })).toBeTruthy();
    expect(track).toHaveBeenCalledWith('exam_room_other_tab', { surface: 'reading' });
    expect(onWriteRightChange).toHaveBeenLastCalledWith(false);
  });

  it('writer when the lock is free', async () => {
    const request = vi.fn((_name: string, _opts: unknown, cb: (lock: unknown) => unknown) => {
      cb({ name: 'x' });
      return new Promise(() => {});
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const onWriteRightChange = vi.fn();
    render(<ExamRoomShell {...base({ tabGuard: { reloadFromServer: () => Promise.resolve(), onWriteRightChange } })} />);
    await waitFor(() => expect(onWriteRightChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(false);
    expect(screen.queryByText('This test is open in another tab.')).toBeNull();
  });
  it('read-only below 900px: pane tabs still switch, answers stay disabled (Codex)', async () => {
    const request = vi.fn((_name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => unknown) => {
      if (opts?.ifAvailable) return Promise.resolve(cb(null));
      return new Promise(() => {});
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    render(<ExamRoomShell {...base({ viewportWidth: 800, tabGuard: { reloadFromServer: () => Promise.resolve() } })} />);
    await screen.findByText('This test is open in another tab.');
    const tab = screen.getByRole('tab', { name: 'Questions' });
    expect(tab.matches(':disabled')).toBe(false);
    fireEvent.click(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(true);
  });

  it('token fallback: losing the token to another tab turns this tab read-only (Codex)', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: undefined });
    class FakeChannel { onmessage = null; postMessage() {} close() {} }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const onWriteRightChange = vi.fn();
    render(<ExamRoomShell {...base({ tabGuard: { reloadFromServer: () => Promise.resolve(), onWriteRightChange } })} />);
    await waitFor(() => expect(onWriteRightChange).toHaveBeenLastCalledWith(true));
    window.localStorage.setItem('exam-room:writer:reading:att-1', JSON.stringify({ tabId: 'other', at: Date.now() }));
    await waitFor(() => expect(onWriteRightChange).toHaveBeenLastCalledWith(false), { timeout: 3000 });
    expect(screen.getByLabelText('Answer 1').matches(':disabled')).toBe(true);
    expect((screen.getByRole('button', { name: 'Submit test' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('embedded (FR-023)', () => {
  it('no bars, timer, submit or leave box', () => {
    render(<ExamRoomShell {...base({ embedded: true })} />);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit test' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Leave test/ })).toBeNull();
    expect(screen.getByLabelText('Answer 1')).toBeTruthy();
  });
});
