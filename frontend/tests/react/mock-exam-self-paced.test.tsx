// EXAMMOCK-0071 T005 (G08-T22 PR 2): a self-paced assigned mock in the exam
// room. Sections run back to back on the server's clock (MOCKORG-0086 plan
// 5.5): one entry screen, no section menu, no "Start next section" or
// "Continue later", "Submit section" through the frame's box, "Test submitted".
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MockExamRoom, type MockExamRoomProps } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-room';
import type { MockSelfPaced, MockState } from '@/app/(authed-mock-exam)/mock-exam/mock-exam-runner';
import {
  mockExamView, mockFrameQuestions, normalizeMockExamState, normalizeSelfPaced, selfPacedEntry, selfPacedView,
} from '@/lib/mock-exam-model.mjs';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const VIETNAMESE = /[À-ÿĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;
const T0 = '2026-11-23T03:00:00Z';
const T1 = '2026-11-23T03:20:00Z';
const FORBIDDEN = /Continue later|Start next section|Start Reading|Start Writing|Select a section/;

function selfPaced(overrides: Partial<MockSelfPaced> = {}): MockSelfPaced {
  return {
    state: 'in_progress', startedAt: T0, expectedEndAt: '2026-11-23T04:20:00Z', currentSection: 'writing',
    startsInSeconds: 0, gapSeconds: 0, openUntil: null, totalSeconds: 7200,
    sections: [
      { section: 'reading', status: 'submitted', startedAt: T0, endsAt: T1 },
      { section: 'writing', status: 'in_progress', startedAt: T1, endsAt: '2026-11-23T04:20:00Z' },
    ],
    ...overrides,
  };
}

function state(sitting: Partial<MockState['sitting']> = {}, root: Partial<MockState> = {}): MockState {
  return {
    sitting: {
      id: 'sit-1', userId: 'user-1', status: 'lrw_in_progress', listeningAttemptId: null, readingAttemptId: 'ra',
      listeningSubmittedAt: null, readingSubmittedAt: T1, writingSubmittedAt: null,
      writingSubmission: { task1: { text: '', submittedAt: null }, task2: { text: '', submittedAt: null } },
      ...sitting,
    },
    exam: {
      listeningTestId: null, readingTestCode: 'rt', readingTitle: 'November Mock', writingTask1: null, writingTask2: null,
      speakingTopicSet: {}, writingMinutes: 60, reviewSlaDays: 3,
    },
    examMode: 'retake', assignedSkills: ['reading', 'writing'], activeSection: 'writing', collectedSection: null,
    sectionTimeLeftSeconds: 3300, sectionDurationSeconds: 3600, selfPaced: selfPaced(),
    ...root,
  };
}

function props(overrides: Partial<MockExamRoomProps> = {}): MockExamRoomProps {
  return {
    loading: false, fatal: null, linkError: false, onReload: vi.fn(),
    state: state(), view: 'section', code: 'NOV', ownerKey: 'user-1', connection: null, collecting: false,
    section: 'writing', remaining: 3300, timerLive: true, frameSrc: null, frameRef: createRef<HTMLIFrameElement>(),
    renderWriting: () => <textarea aria-label="Answer for Task 1" />, capture: null, session: 'active', saveLocalCopy: () => true,
    canWrite: true, onWriteRightChange: vi.fn(), reloadFromServer: vi.fn(() => Promise.resolve()),
    starting: null, startError: null, onStart: vi.fn(), onSpeaking: vi.fn(), openingSpeaking: false,
    outcome: null, onRetrySubmit: vi.fn(), flushForExit: vi.fn(() => Promise.resolve({ unsaved: 0 })),
    onSubmitSection: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function entryState(extra: Partial<MockSelfPaced> = {}) {
  return state({ readingSubmittedAt: null, status: 'registered' }, {
    activeSection: 'not_started', sectionTimeLeftSeconds: null,
    selfPaced: selfPaced({ state: 'not_started', startedAt: null, expectedEndAt: null, currentSection: null, sections: [], ...extra }),
  });
}

describe('model (FR-014)', () => {
  it('reads the server block and leaves every other sitting null', () => {
    const payload = {
      sitting: { id: 's1', status: 'lrw_in_progress' }, exam: {}, exam_mode: 'retake', assigned_skills: ['reading', 'writing'],
      active_section: 'writing', section_time_left_seconds: 100,
      self_paced: {
        state: 'in_progress', started_at: T0, expected_end_at: T1, current_section: 'writing', gap_seconds: 0,
        open_until: null, total_seconds: 7200,
        sections: [{ section: 'reading', status: 'submitted', started_at: T0, ends_at: T1 }],
      },
    };
    const parsed = normalizeMockExamState(payload, 's1');
    expect(parsed.selfPaced).toMatchObject({ state: 'in_progress', currentSection: 'writing', totalSeconds: 7200 });
    expect(normalizeMockExamState({ ...payload, self_paced: null }, 's1').selfPaced).toBeNull();
    expect(() => normalizeSelfPaced({ state: 'paused' })).toThrow('invalid-mock-self-paced');
  });

  it('never a menu: entry, section, between, missed, submitted', () => {
    expect(selfPacedView(entryState())).toBe('entry');
    expect(selfPacedView(state())).toBe('section');
    // Started, no open section on this read (the server is stamping the next one).
    expect(selfPacedView(state({ writingSubmittedAt: null }, { activeSection: 'not_started', sectionTimeLeftSeconds: null }))).toBe('between');
    expect(selfPacedView(entryState({ state: 'missed' }))).toBe('missed');
    expect(selfPacedView(state({ status: 'all_submitted', writingSubmittedAt: T1 }))).toBe('submitted');
    expect(selfPacedView(state({}, { selfPaced: null }))).toBeNull();
    // The old branch is untouched: the same sitting still reads through mockExamView.
    expect(mockExamView(entryState())).toBe('retake-menu');
  });

  it('gap > 0: a countdown before the named section opens; all ended but still live: closing', () => {
    const gap = state({}, { selfPaced: selfPaced({ startsInSeconds: 90, gapSeconds: 120 }) });
    expect(selfPacedView(gap)).toBe('gap');
    expect(selfPacedView(state())).toBe('section');
    expect(normalizeSelfPaced({ state: 'in_progress', starts_in_seconds: 90 })?.startsInSeconds).toBe(90);
    expect(normalizeSelfPaced({ state: 'in_progress' })?.startsInSeconds).toBe(0);
    const closing = state({}, { activeSection: 'not_started', sectionTimeLeftSeconds: null, selfPaced: selfPaced({ state: 'submitted', currentSection: null }) });
    expect(selfPacedView(closing)).toBe('closing');
  });

  it('reads only a well-formed answers report for the open section', () => {
    const report = { type: 'mock-answers', section: 'reading', questions: [{ q: 1, answered: true }, { q: 2, answered: false }] };
    expect(mockFrameQuestions(report, 'reading')).toEqual([{ q: 1, answered: true }, { q: 2, answered: false }]);
    expect(mockFrameQuestions(report, 'listening')).toBeNull();
    expect(mockFrameQuestions({ ...report, type: 'mock-flushed' }, 'reading')).toBeNull();
    expect(mockFrameQuestions({ ...report, questions: [{ q: 0, answered: true }] }, 'reading')).toBeNull();
    expect(mockFrameQuestions({ ...report, questions: [{ q: 1, answered: 'yes' }] }, 'reading')).toBeNull();
  });

  it('warns only when the window closes before a full run', () => {
    const now = Date.parse('2026-11-23T03:00:00Z');
    expect(selfPacedEntry(entryState({ openUntil: '2026-11-23T04:00:00Z' }), now)).toMatchObject({ totalMinutes: 120, closesAt: '2026-11-23T04:00:00Z', firstSection: 'reading' });
    expect(selfPacedEntry(entryState({ openUntil: '2026-11-23T06:00:00Z' }), now)?.closesAt).toBeNull();
  });
});

describe('entry screen (FR-014, FR-016)', () => {
  it('total time, the back-to-back notice with a Vietnamese line, one Start button for the first section', () => {
    const onStart = vi.fn();
    render(<MockExamRoom {...props({ state: entryState(), view: 'retake-menu', section: null, onStart })} />);
    expect(screen.getByText(/This test takes 120 minutes\./)).toBeTruthy();
    const notice = screen.getByText(/Once you start, the sections run back to back\. You cannot pause between sections\./);
    expect(VIETNAMESE.test(notice.textContent || '')).toBe(true);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    expect(onStart).toHaveBeenCalledWith('reading');
  });

  it('a short window adds a warning with the close time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T03:00:00Z'));
    render(<MockExamRoom {...props({ state: entryState({ openUntil: '2026-11-23T04:00:00Z' }), view: 'retake-menu', section: null })} />);
    expect(screen.getByText(/This test closes at \d\d:\d\d\./)).toBeTruthy();
  });

  it('missed: the window closed before a start; no Start button', () => {
    render(<MockExamRoom {...props({ state: entryState({ state: 'missed' }), view: 'retake-menu', section: null })} />);
    expect(screen.getByText(/The window for this test has closed\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start test' })).toBeNull();
  });
});

describe('back to back (FR-014, Scenario 5)', () => {
  it('the next section opens with only "Section submitted. Next: <section>"', () => {
    render(<MockExamRoom {...props()} />);
    expect(screen.getByText('Section submitted. Next: Writing')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getByText('Reading · ✓ Submitted')).toBeTruthy();
  });

  it('the first section has no "Next" line', () => {
    const s = state({ readingSubmittedAt: null }, {
      activeSection: 'reading', selfPaced: selfPaced({ currentSection: 'reading', sections: [{ section: 'reading', status: 'in_progress', startedAt: T0, endsAt: T1 }] }),
    });
    render(<MockExamRoom {...props({ state: s, section: 'reading', frameSrc: '/reading/exam?mock_embed=1' })} />);
    expect(screen.queryByText(/Section submitted\. Next/)).toBeNull();
  });

  it('between two reads: a status line, never a button to start or postpone', () => {
    const s = state({}, { activeSection: 'not_started', sectionTimeLeftSeconds: null });
    render(<MockExamRoom {...props({ state: s, view: 'retake-menu', section: null })} />);
    expect(screen.getByText(/Opening the next section…/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it('gap > 0: a fixed countdown to the next section, no frame and no button', () => {
    const s = state({}, { selfPaced: selfPaced({ startsInSeconds: 90, gapSeconds: 120 }) });
    render(<MockExamRoom {...props({ state: s, section: null, timerLive: false, gapRemaining: 75 })} />);
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toMatch(/^Section submitted\. Next: Writing starts in 01:15\./);
    expect(VIETNAMESE.test(timer.textContent || '')).toBe(true);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByLabelText('Answer for Task 1')).toBeNull();
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });

  it('every section ended but the sitting is still live: "being submitted", not "Opening the next section"', () => {
    const s = state({}, { activeSection: 'not_started', sectionTimeLeftSeconds: null, selfPaced: selfPaced({ state: 'submitted', currentSection: null }) });
    render(<MockExamRoom {...props({ state: s, view: 'retake-menu', section: null })} />);
    expect(screen.getByText(/Your last section is being submitted/)).toBeTruthy();
    expect(screen.queryByText(/Opening the next section/)).toBeNull();
  });

  it('the Reading "Submit section" box lists the blank questions the page reported', async () => {
    const request = vi.fn((_name: string, _opts: unknown, cb: (lock: unknown) => unknown) => {
      cb({ name: 'exam-room:mock:sit-1' });
      return new Promise(() => {});
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const s = state({ readingSubmittedAt: null }, {
      activeSection: 'reading', selfPaced: selfPaced({ currentSection: 'reading', sections: [{ section: 'reading', status: 'in_progress', startedAt: T0, endsAt: T1 }] }),
    });
    const frameQuestions = [{ q: 1, answered: true }, { q: 2, answered: false }, { q: 7, answered: false }];
    render(<MockExamRoom {...props({ state: s, section: 'reading', frameSrc: '/reading/exam?mock_embed=1', frameQuestions })} />);
    const submitButton = screen.getByRole('button', { name: 'Submit section' });
    await vi.waitFor(() => expect(submitButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(submitButton);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/2 unanswered questions/);
    expect(dialog.textContent).toMatch(/2/);
    expect(dialog.textContent).toMatch(/7/);
  });

  it('the embedded pages report their questions to the same-origin parent and answer a request', () => {
    for (const [file, section] of [['public/js/reading-exam.js', 'reading'], ['public/js/listening-test-player.js', 'listening']]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain(`type: 'mock-answers', section: '${section}'`);
      expect(source).toMatch(/postMessage\(\{ type: 'mock-answers'[^\n]*window\.location\.origin\)/);
      expect(source).toMatch(/mock-answers-request' && ev\.source === window\.parent/);
    }
  });

  it('"Submit section" goes through the frame box to the runner submit', async () => {
    // This tab holds the write lock (the frame's guard, FR-013).
    const request = vi.fn((_name: string, _opts: unknown, cb: (lock: unknown) => unknown) => {
      cb({ name: 'exam-room:mock:sit-1' });
      return new Promise(() => {});
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: true, locks: { request } });
    const onSubmitSection = vi.fn(() => Promise.resolve());
    render(<MockExamRoom {...props({ onSubmitSection })} />);
    const submitButton = screen.getByRole('button', { name: 'Submit section' });
    await vi.waitFor(() => expect(submitButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(submitButton);
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getAllByRole('button').find((b) => /submit/i.test(b.textContent || ''))!;
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(onSubmitSection).toHaveBeenCalledWith('writing'));
  });

  it('a live or old retake sitting still has no manual submit (FR-004)', () => {
    render(<MockExamRoom {...props({ state: state({}, { selfPaced: null }) })} />);
    expect(screen.queryByRole('button', { name: 'Submit section' })).toBeNull();
  });
});

describe('after the last section (FR-014, FR-016)', () => {
  it('"Test submitted" with a Vietnamese line, not "Test collected"', () => {
    const s = state({ status: 'all_submitted', writingSubmittedAt: T1 }, { activeSection: 'done', sectionTimeLeftSeconds: null, selfPaced: selfPaced({ state: 'submitted', currentSection: null }) });
    render(<MockExamRoom {...props({ state: s, view: 'submitted', section: null })} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^Test submitted/);
    expect(VIETNAMESE.test(heading.textContent || '')).toBe(true);
    expect(screen.queryByText('Test collected')).toBeNull();
  });
});
