// EXAMMOCK-0071 T002 (G08-T16): the exam-room branch of the mock runner draws
// the runner's own state; it never calls an API, a clock of its own or a browser dialog.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockExamRoom, type MockExamRoomProps } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-room';
import { MockWritingRoom, type MockWritingBridge, type MockWritingRoomProps } from '@/app/(authed-mock-exam)/mock-exam/mock-writing-room';
import { localCopyKey, readLocalCopy, writeLocalCopy } from '@/lib/exam-room/local-copy.mjs';
import type { MockState } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-runner';
import { mockSubmitOutcome } from '@/lib/mock-exam-model.mjs';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const VIETNAMESE = /[À-ÿĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;
const T = '2026-11-23T03:45:00Z';
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function mockState(overrides: Partial<MockState['sitting']> = {}, root: Partial<MockState> = {}): MockState {
  return {
    sitting: {
      id: 'sit-1', userId: 'user-1', status: 'lrw_in_progress', listeningAttemptId: 'la', readingAttemptId: 'ra',
      listeningSubmittedAt: T, readingSubmittedAt: null, writingSubmittedAt: null,
      writingSubmission: { task1: { text: '', submittedAt: null }, task2: { text: '', submittedAt: null } },
      ...overrides,
    },
    exam: {
      listeningTestId: 'lt', readingTestCode: 'rt', readingTitle: 'November Mock', writingTask1: null, writingTask2: null,
      speakingTopicSet: {}, writingMinutes: 60, reviewSlaDays: 3,
    },
    examMode: 'sequential', assignedSkills: null, activeSection: 'reading', collectedSection: null,
    sectionTimeLeftSeconds: 1800, sectionDurationSeconds: 3600,
    ...root,
  };
}

function props(overrides: Partial<MockExamRoomProps> = {}): MockExamRoomProps {
  return {
    loading: false, fatal: null, linkError: false, onReload: vi.fn(),
    state: mockState(), view: 'section', code: 'NOV', ownerKey: 'user-1', connection: null, collecting: false,
    section: 'reading', remaining: 1800, timerLive: true, frameSrc: '/reading/exam?mock_embed=1', frameRef: createRef<HTMLIFrameElement>(),
    renderWriting: () => null, capture: null, session: 'active', saveLocalCopy: () => true, canWrite: true,
    onWriteRightChange: vi.fn(), reloadFromServer: vi.fn(() => Promise.resolve()), starting: null, startError: null, onStart: vi.fn(), onSpeaking: vi.fn(), openingSpeaking: false,
    outcome: null, onRetrySubmit: vi.fn(), flushForExit: vi.fn(() => Promise.resolve({ unsaved: 0 })),
    ...overrides,
  };
}

function noDialogs() {
  const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => true);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
  return () => { expect(confirm).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled(); };
}

describe('section in progress (FR-003, FR-004, FR-005)', () => {
  it('shows the runner clock, the section line and a text strip, with no manual submit', () => {
    const check = noDialogs();
    render(<MockExamRoom {...props()} />);
    expect(screen.getByText('Mock test · November Mock')).toBeTruthy();
    expect(screen.getByText(/Section 2 of 3: Reading/)).toBeTruthy();
    expect(screen.getByText('30:00')).toBeTruthy();
    const strip = screen.getByRole('list', { name: 'Test sections' });
    const items = within(strip).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Listening · ✓ Submitted', 'Reading · In progress', 'Writing · Not started']);
    expect(within(strip).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(screen.queryByText(/Abandon/)).toBeNull();
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/reading/exam?mock_embed=1');
    expect(document.querySelector('[data-exam-room]')?.getAttribute('data-surface')).toBe('mock');
    check();
  });

  it('names the automatic submit in the last five minutes', () => {
    render(<MockExamRoom {...props({ remaining: 240 })} />);
    expect(screen.getByText('This section will be submitted automatically.')).toBeTruthy();
  });

  it('builds the strip from the sitting sections, never four fixed ones', () => {
    const state = mockState({ listeningSubmittedAt: null }, { examMode: 'retake', assignedSkills: ['writing'], activeSection: 'writing' });
    render(<MockExamRoom {...props({ state, section: 'writing', renderWriting: () => <textarea aria-label="Task 1" /> })} />);
    const items = within(screen.getByRole('list', { name: 'Test sections' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Writing · In progress']);
    expect(screen.getByText(/Section 1 of 1: Writing/)).toBeTruthy();
    expect(screen.getByLabelText('Task 1')).toBeTruthy();
  });
});

describe('collection (FR-009)', () => {
  it('locks the body and says the final answers are being saved, with no blocking box', () => {
    render(<MockExamRoom {...props({ collecting: true })} />);
    expect(screen.getByText('Saving your final answers…')).toBeTruthy();
    expect(document.querySelector('iframe')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });
});

describe('submit outcome (FR-007)', () => {
  const base = { section: 'reading' as const, retry: false, closedAt: null, savedUpTo: null, sectionSubmitted: false };

  it('unconfirmed_manual offers Try again, which re-runs the runner submit', () => {
    const onRetrySubmit = vi.fn();
    render(<MockExamRoom {...props({ onRetrySubmit, outcome: { ...base, outcome: 'unconfirmed_manual' } })} />);
    const panel = document.querySelector('[data-outcome="unconfirmed_manual"]') as HTMLElement;
    expect(panel.textContent).not.toMatch(/submitted/i);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetrySubmit).toHaveBeenCalledTimes(1);
  });

  it('submitting never says submitted', () => {
    render(<MockExamRoom {...props({ outcome: { ...base, outcome: 'submitting' } })} />);
    expect(document.querySelector('[data-outcome="submitting"]')).toBeTruthy();
    expect(screen.queryByText(/has been submitted/i)).toBeNull();
  });

  it('an outcome of another section is not shown on this one', () => {
    render(<MockExamRoom {...props({ outcome: { ...base, section: 'listening', outcome: 'unconfirmed_manual' } })} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('closed by the server: the waiting screen gives the server time and no invented save time', () => {
    const state = mockState({ readingSubmittedAt: T }, { activeSection: 'writing' });
    render(<MockExamRoom {...props({ state, view: 'waiting', section: null, outcome: { ...base, outcome: 'closed_unconfirmed', closedAt: T, sectionSubmitted: true } })} />);
    expect(screen.getByText(`This section was closed by our server at ${hhmm(T)}.`)).toBeTruthy();
    expect(screen.queryByText(/saved up to/)).toBeNull();
    expect(screen.queryByText(/has been submitted/i)).toBeNull();
  });
});

describe('Writing final save only after the submit reached the server (FR-007 F1)', () => {
  const RUNNER = readFileSync('app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx', 'utf8');

  it('the runner marks Writing secured after the POST, never before doSubmit', () => {
    const submitSection = RUNNER.slice(RUNNER.indexOf('const submitSection = useCallback'), RUNNER.indexOf('await doSubmit(section);'));
    expect(submitSection).not.toMatch(/flushSecuredRef\.current\.add\('writing'\)/);
    const doSubmit = RUNNER.slice(RUNNER.indexOf('const doSubmit = useCallback'), RUNNER.indexOf('const submitSection = useCallback'));
    const post = doSubmit.indexOf('/sections/writing/submit');
    const mark = doSubmit.indexOf("flushSecuredRef.current.add('writing')");
    expect(post).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(post);
  });

  it('a Writing submit that failed offline, then closed by the server, reads closed_unconfirmed, not submitted', () => {
    const state = mockState({ readingSubmittedAt: T, writingSubmittedAt: T, status: 'lrw_submitted' }, { activeSection: 'done' });
    // The POST never succeeded, so the runner never set the secured flag.
    const outcome = mockSubmitOutcome({ state, section: 'writing', observed: true, finalFlushSecured: false, retries: 3, error: null });
    expect(outcome.outcome).toBe('closed_unconfirmed');
    render(<MockExamRoom {...props({ state, view: 'waiting', section: null, outcome })} />);
    expect(screen.queryByText(/has been submitted/i)).toBeNull();
    expect(screen.getByText(`This section was closed by our server at ${hhmm(T)}.`)).toBeTruthy();
  });
});

describe('leave (FR-008)', () => {
  it('flushes the open section before the leave box and never offers Abandon', async () => {
    const check = noDialogs();
    const flushForExit = vi.fn(() => Promise.resolve({ unsaved: 2 }));
    render(<MockExamRoom {...props({ flushForExit })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave test' }));
    await waitFor(() => expect(flushForExit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/2 answers have not been saved yet/)).toBeTruthy());
    expect(screen.queryByText(/Abandon/)).toBeNull();
    check();
  });
});

describe('screens outside the test (FR-016)', () => {
  it('waiting room: English with a Vietnamese line and the strip', () => {
    const state = mockState({ listeningSubmittedAt: null }, { activeSection: 'not_started' });
    render(<MockExamRoom {...props({ state, view: 'waiting', section: null })} />);
    expect(screen.getByText(/Waiting for the invigilator to start the test/)).toBeTruthy();
    expect(screen.getByText('Đang chờ giám thị bắt đầu bài thi…').getAttribute('lang')).toBe('vi');
    expect(screen.getByRole('list', { name: 'Test sections' })).toBeTruthy();
  });

  it('retake menu starts a section through the runner', () => {
    const onStart = vi.fn();
    const state = mockState({ listeningSubmittedAt: null }, { examMode: 'retake', assignedSkills: ['reading', 'writing'], activeSection: 'not_started' });
    render(<MockExamRoom {...props({ state, view: 'retake-menu', section: null, onStart })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Writing' }));
    expect(onStart).toHaveBeenCalledWith('writing');
  });

  it('Test collected opens Speaking as today', () => {
    const onSpeaking = vi.fn();
    const state = mockState({ status: 'speaking_pending', readingSubmittedAt: T, writingSubmittedAt: T });
    render(<MockExamRoom {...props({ state, view: 'submitted', section: null, onSpeaking })} />);
    expect(screen.getByRole('heading', { name: /Test collected/ })).toBeTruthy();
    expect(VIETNAMESE.test(document.body.textContent || '')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start Speaking →' }));
    expect(onSpeaking).toHaveBeenCalledTimes(1);
  });

  it('cancelled and error screens', () => {
    const { unmount } = render(<MockExamRoom {...props({ view: 'void' })} />);
    expect(screen.getByText(/This test has been cancelled/)).toBeTruthy();
    unmount();
    const onReload = vi.fn();
    render(<MockExamRoom {...props({ fatal: 'Unable to load the test status.', onReload })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

// ---- part B ---------------------------------------------------------------

class MemoryStorage implements Storage {
  private rows = new Map<string, string>();
  get length() { return this.rows.size; }
  clear() { this.rows.clear(); }
  getItem(key: string) { return this.rows.has(key) ? this.rows.get(key)! : null; }
  key(i: number) { return [...this.rows.keys()][i] ?? null; }
  removeItem(key: string) { this.rows.delete(key); }
  setItem(key: string, value: string) { this.rows.set(key, String(value)); }
}

const SCOPE = { surface: 'mock', ownerKey: 'user-1', attemptKey: 'sit-1' };
const FAR = Date.now() + 24 * 60 * 60 * 1000;
function writingState(task1 = 'server one', task2 = '') {
  return mockState({ readingSubmittedAt: T, writingSubmission: { task1: { text: task1, submittedAt: null }, task2: { text: task2, submittedAt: null } } }, { activeSection: 'writing' });
}
function writingProps(overrides: Partial<MockWritingRoomProps> = {}): MockWritingRoomProps & { bridge: { current: MockWritingBridge | null } } {
  const bridge = { current: null as MockWritingBridge | null };
  return {
    state: writingState(), ownerKey: 'user-1', locked: false, readOnly: false,
    register: (b) => { bridge.current = b; },
    saveWriting: vi.fn(() => Promise.resolve({})), onSaveStatus: vi.fn(), storage: new MemoryStorage(),
    bridge,
    ...overrides,
  };
}

describe('Writing room (FR-006)', () => {
  it('two Task tabs with "Words: n · minimum m" and no draft-save button', () => {
    render(<MockWritingRoom {...writingProps()} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Task 1Words: 2 · minimum 150', 'Task 2Words: 0 · minimum 250']);
    fireEvent.click(screen.getByRole('tab', { name: /Task 2/ }));
    expect(screen.getByLabelText('Answer for Task 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('typing writes the account copy with the acked base; the save reports Saving then Saved', async () => {
    vi.useFakeTimers();
    const p = writingProps();
    render(<MockWritingRoom {...p} />);
    fireEvent.change(screen.getByLabelText('Answer for Task 1'), { target: { value: 'server one more' } });
    const copy = readLocalCopy(p.storage, SCOPE)!;
    expect(copy.answers.task1).toMatchObject({ value: 'server one more', baseValue: 'server one' });
    expect(p.saveWriting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(p.saveWriting).toHaveBeenCalledWith({ task1_text: 'server one more', task2_text: '' }, expect.objectContaining({ keepalive: false }));
    expect(p.onSaveStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'saving' }));
    expect(p.onSaveStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'saved' }));
    // Acked: the copy no longer holds that text.
    expect(readLocalCopy(p.storage, SCOPE)).toBeNull();
    vi.useRealTimers();
  });

  it('locked (time up / collection) and read-only boxes cannot be typed in', () => {
    render(<MockWritingRoom {...writingProps({ locked: true })} />);
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).readOnly).toBe(true);
  });
});

describe('Writing copy on open (FR-010)', () => {
  it('re-sends the copy only while the server still holds its base', async () => {
    const storage = new MemoryStorage();
    writeLocalCopy(storage, { ...SCOPE, answers: { task1: { value: 'typed offline', baseValue: 'server one' } }, expiresAt: FAR });
    const p = writingProps({ storage });
    render(<MockWritingRoom {...p} />);
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).value).toBe('typed offline');
    await waitFor(() => expect(p.saveWriting).toHaveBeenCalledWith({ task1_text: 'typed offline', task2_text: '' }, expect.anything()));
  });

  it('server changed since the base: keeps the server text and drops the copy', () => {
    const storage = new MemoryStorage();
    writeLocalCopy(storage, { ...SCOPE, answers: { task1: { value: 'typed offline', baseValue: 'older' } }, expiresAt: FAR });
    const p = writingProps({ storage });
    render(<MockWritingRoom {...p} />);
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).value).toBe('server one');
    expect(p.saveWriting).not.toHaveBeenCalled();
    expect(readLocalCopy(storage, SCOPE)).toBeNull();
  });

  it('legacy key that differs: never written over the server; asks, migrates, and the choice decides', async () => {
    const storage = new MemoryStorage();
    storage.setItem('mock-writing:sit-1:task1', JSON.stringify({ text: 'legacy text', ts: 1, synced: false }));
    const p = writingProps({ storage });
    render(<MockWritingRoom {...p} />);
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).value).toBe('server one');
    expect(readLocalCopy(storage, SCOPE)?.answers.task1.value).toBe('legacy text');
    expect(storage.getItem('mock-writing:sit-1:task1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use the text on this device' }));
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).value).toBe('legacy text');
    await waitFor(() => expect(p.saveWriting).toHaveBeenCalledWith({ task1_text: 'legacy text', task2_text: '' }, expect.anything()));
  });

  it('legacy key of a sitting owned by someone else is never read', () => {
    const storage = new MemoryStorage();
    storage.setItem('mock-writing:sit-1:task1', JSON.stringify({ text: 'legacy text', ts: 1, synced: false }));
    render(<MockWritingRoom {...writingProps({ storage, ownerKey: 'user-2' })} />);
    expect(screen.queryByRole('button', { name: 'Use the text on this device' })).toBeNull();
    expect(storage.getItem('mock-writing:sit-1:task1')).not.toBeNull();
  });

  it('Keep the saved text drops only the device version', () => {
    const storage = new MemoryStorage();
    writeLocalCopy(storage, { ...SCOPE, answers: { task1: { value: 'mine' } as never }, expiresAt: FAR });
    render(<MockWritingRoom {...writingProps({ storage })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the saved text' }));
    expect((screen.getByLabelText('Answer for Task 1') as HTMLTextAreaElement).value).toBe('server one');
    expect(storage.getItem(localCopyKey(SCOPE))).toBeNull();
  });

  it('saveLocalCopy writes both boxes and is true only when they read back', () => {
    const p = writingProps();
    render(<MockWritingRoom {...p} />);
    fireEvent.change(screen.getByLabelText('Answer for Task 1'), { target: { value: 'unsaved words' } });
    expect(p.bridge.current!.saveLocalCopy()).toBe(true);
    expect(readLocalCopy(p.storage, SCOPE)?.answers.task1.value).toBe('unsaved words');
    cleanup();
    const broken = { ...new MemoryStorage(), getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {}, key: () => null, clear: () => {}, length: 0 } as Storage;
    const q = writingProps({ storage: broken });
    render(<MockWritingRoom {...q} />);
    fireEvent.change(screen.getByLabelText('Answer for Task 1'), { target: { value: 'unsaved words' } });
    expect(q.bridge.current!.saveLocalCopy()).toBe(false);
  });
});

describe('session, other tab, dialogs (FR-012, FR-013, FR-017)', () => {
  it('a 401 outside the test screen shows Sign in again back to this page', () => {
    const state = mockState({}, { activeSection: 'not_started' });
    render(<MockExamRoom {...props({ state, view: 'waiting', section: null, session: 'expired' })} />);
    const link = screen.getByRole('link', { name: 'Sign in again' });
    expect(link.getAttribute('href')).toMatch(/^\/login\?next=/);
  });

  it('a 401 in a section keeps the Writing copy first, then shows the frame sign-in box', async () => {
    const saveLocalCopy = vi.fn(() => true);
    const state = writingState();
    render(<MockExamRoom {...props({ state, section: 'writing', session: 'expired', saveLocalCopy, renderWriting: () => <p>editor</p> })} />);
    await waitFor(() => expect(saveLocalCopy).toHaveBeenCalledTimes(1));
    expect(document.querySelector('dialog[open]')).toBeTruthy();
  });

  it('a read-only tab does not load the child player', () => {
    render(<MockExamRoom {...props({ canWrite: false })} />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/This test is open in another tab/)).toBeTruthy();
  });

  it('the Writing confirmation with word counts shows only after a confirmed submit', () => {
    const state = mockState({ readingSubmittedAt: T, writingSubmittedAt: T, writingSubmission: { task1: { text: 'one two three', submittedAt: T }, task2: { text: 'four five', submittedAt: T } } }, { activeSection: 'done' });
    const outcome = { section: 'writing' as const, retry: false, closedAt: null, savedUpTo: null, sectionSubmitted: true };
    const { unmount } = render(<MockExamRoom {...props({ state, view: 'waiting', section: null, outcome: { ...outcome, outcome: 'submitting' } })} />);
    expect(screen.queryByText(/Your test has been submitted/)).toBeNull();
    unmount();
    render(<MockExamRoom {...props({ state, view: 'waiting', section: null, outcome: { ...outcome, outcome: 'confirmed' } })} />);
    expect(screen.getByText(/Time is up\. Your test has been submitted\. Task 1: 3 words · Task 2: 2 words/)).toBeTruthy();
  });

  it('no window.confirm, alert or prompt across the room and Writing', () => {
    const check = noDialogs();
    render(<MockWritingRoom {...writingProps()} />);
    fireEvent.change(screen.getByLabelText('Answer for Task 1'), { target: { value: 'x' } });
    cleanup();
    render(<MockExamRoom {...props({ outcome: { section: 'reading', outcome: 'unconfirmed_manual', retry: false, closedAt: null, savedUpTo: null, sectionSubmitted: false } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave test' }));
    check();
  });
});
