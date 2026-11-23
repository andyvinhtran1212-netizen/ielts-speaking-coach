// EXAMMOCK-0071 T002 (G08-T16): the exam-room branch of the mock runner draws
// the runner's own state; it never calls an API, a clock of its own or a browser dialog.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockExamRoom, type MockExamRoomProps } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-room';
import type { MockState } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-runner';

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
    writing: null, capture: null, starting: null, startError: null, onStart: vi.fn(), onSpeaking: vi.fn(), openingSpeaking: false,
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
    render(<MockExamRoom {...props({ state, section: 'writing', writing: <textarea aria-label="Task 1" /> })} />);
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
