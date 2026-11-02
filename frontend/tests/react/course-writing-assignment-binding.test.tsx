import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'student-1' } }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

import { CourseBehavior } from '@/app/(authed)/course-exercises/course-behavior';
import { CourseShell } from '@/app/(authed)/course-exercises/page-shell';
import { draftKey, PUSH_DELAY_MS } from '@/public/js/course-writing.js';

const BANK = 'shared-bank';
const OLD = 'item-old';
const NEW = 'item-new';
const answer = 'She goes to school.';
const mcq = { qid: 'Q1', type: 'mcq', subtype: 'A1', skill: 'X', item_key: 'k1',
  prompt: 'Choose the answer', options: ['a', 'b', 'c', 'd'], answer: 0, points: 1 };
const writingQuestion = { qid: 'E1', type: 'writing', subtype: 'E1', prompt: 'Correct: She go to school.' };

/** Two still-open assignments of one bank. Bank-only Writing selects the newer one. */
function transport() {
  let quizCompleted = false;
  const items = {
    [OLD]: { draft: {} as Record<string, string>, submission: null as unknown },
    [NEW]: { draft: { E1: 'New assignment draft.' }, submission: null as unknown },
  };
  const api = {
    get: vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname === `/api/quiz/banks/${BANK}`) {
        return { bank: { id: BANK, title: 'Buổi 1' }, questions: [mcq, writingQuestion],
          mastery: { item_id: OLD } };
      }
      if (url.pathname.endsWith('/course-resume')) {
        return { session_id: null, answered: [], completed: quizCompleted ? ['quiz-old'] : [],
          item_id: OLD, stage: quizCompleted ? 1 : 0, last_stage: { graded: 1, right: 1 } };
      }
      if (url.pathname === '/api/quiz/course/pronunciation') return {};
      if (url.pathname === '/api/quiz/course/writing') {
        const item = url.searchParams.get('class_item') || NEW;
        const state = items[item];
        if (!state) throw new Error(`Unexpected assignment: ${item}`);
        return { questions: [writingQuestion], submitted: Boolean(state.submission),
          item_id: item, draft: { answers: state.draft }, submission: state.submission };
      }
      throw new Error(`Unexpected GET: ${path}`);
    }),
    post: vi.fn(async (path: string, body: any) => {
      if (path === '/api/quiz/sessions') return { session_id: 'quiz-old', resume: null };
      if (path === '/api/quiz/sessions/quiz-old/progress') return { ok: true, attempts: body.attempts.length };
      if (path === '/api/quiz/course/verdict') return {
        phase: 'run', verdict: 'pending', sections: [
          { key: 'quiz', completed: true }, { key: 'writing', completed: false },
        ],
      };
      if (path === '/api/quiz/course/writing/draft') {
        items[body.class_item].draft = { ...body.answers };
        return { saved: 1 };
      }
      if (path === '/api/quiz/course/writing') {
        const result = { items: [], total: 1, clean: 1 };
        items[body.class_item].submission = { ...result, answers: { ...body.answers } };
        return result;
      }
      throw new Error(`Unexpected POST: ${path}`);
    }),
    patch: vi.fn(async () => { quizCompleted = true; return {}; }),
  };
  return { api, items };
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
});

describe.each([
  ['explicit older assignment', `&class_item=${OLD}`],
  ['canonical assignment returned by the quiz load', ''],
])('Writing binds to the opened %s', (_label, query) => {
  async function openWriting() {
    const wire = transport();
    (window as unknown as { api: unknown }).api = wire.api;
    window.history.replaceState({}, '', `/course-exercises?bank=${BANK}${query}`);
    const page = () => <><CourseShell /><CourseBehavior /></>;
    const view = render(page());
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    expect(wire.api.post).toHaveBeenCalledWith('/api/quiz/sessions', expect.objectContaining({ class_item: OLD }));
    fireEvent.click(document.querySelector('.cx-opt')!);
    await waitFor(() => expect(document.querySelector('#cx-go')).not.toBeNull());
    fireEvent.click(document.querySelector('#cx-go')!);
    await waitFor(() => expect(document.querySelector('#cx-writing')).not.toBeNull());
    expect(wire.api.post).toHaveBeenCalledWith('/api/quiz/sessions/quiz-old/progress', expect.objectContaining({
      attempts: [expect.objectContaining({ qid: 'Q1' })],
    }));
    expect(wire.api.patch).toHaveBeenCalledWith('/api/quiz/sessions/quiz-old', expect.any(Object));
    expect(wire.api.post).toHaveBeenCalledWith('/api/quiz/course/verdict', expect.objectContaining({ class_item: OLD }));
    fireEvent.click(document.querySelector('#cx-writing')!);
    fireEvent.input(document.querySelector('#cw-E1 textarea')!, { target: { value: answer } });
    return { ...wire, view, page };
  }

  it('autosaves the old assignment and restores its draft after reopening', async () => {
    const { api, items, view, page } = await openWriting();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/quiz/course/writing/draft',
      expect.objectContaining({ class_item: OLD, answers: { E1: answer } })), { timeout: PUSH_DELAY_MS + 1000 });
    expect(items[OLD].draft).toEqual({ E1: answer });
    expect(items[NEW].draft).toEqual({ E1: 'New assignment draft.' });
    expect(window.localStorage.getItem(draftKey(BANK, 'student-1', OLD))).toBe(JSON.stringify({ E1: answer }));
    view.unmount();
    // Restore from the server backup, as on another device, rather than localStorage.
    window.localStorage.clear();
    render(page());
    await waitFor(() => expect(document.querySelector('#cx-writing')).not.toBeNull());
    fireEvent.click(document.querySelector('#cx-writing')!);
    expect((document.querySelector('#cw-E1 textarea') as HTMLTextAreaElement).value).toBe(answer);
  });

  it('submits Writing on the same old assignment as the quiz progress', async () => {
    const { api, items } = await openWriting();
    fireEvent.click(document.querySelector('#cw-submit')!);
    fireEvent.click(document.querySelector('#cw-confirm')!);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/quiz/course/writing',
      expect.objectContaining({ class_item: OLD, answers: { E1: answer } })));
    expect(items[OLD].submission).toMatchObject({ answers: { E1: answer } });
    expect(items[NEW].submission).toBeNull();
    expect(items[NEW].draft).toEqual({ E1: 'New assignment draft.' });
  });
});
