import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningLessonDetail } from '@/app/(authed-listening)/listening/lessons/[lessonId]/lesson-detail';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import { ProgrammeResult } from '@/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result';

const route = vi.hoisted(() => ({ params: new URLSearchParams('from=general&filter=in_progress') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
let programmeId = 'general-listening-practice';
const question = { q_num: 1, source_item_id: 'source-1', prompt: 'Which place?', response_type: 'single_choice', options: { A: 'Library', B: 'Museum' } };
beforeEach(() => {
  localStorage.clear(); programmeId = 'general-listening-practice'; route.params = new URLSearchParams('from=general&filter=in_progress');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Object.assign(window, { api: {
    getWith: vi.fn(async (url: string) => {
      if (url.includes('/lessons/')) return { programme_id: programmeId, title: 'Canonical lesson', forms: [
        { id: 'new-1', title: 'New form', status: 'new' },
        { id: 'resume-1', title: 'Resume form', status: 'in_progress' },
        { id: 'done-1', title: 'Done form', status: 'completed', attempt_id: 'review-1' },
      ] };
      if (url.endsWith('/guided-state')) return { attempt_id: 'attempt-1', assisted: false, items: [] };
      if (url.endsWith('/review')) return { programme_id: programmeId, scoring_policy: 'report_only', title: 'Canonical result', listening_lesson_id: 'canonical-lesson', result_summary: {}, review: [] };
      return { programme_id: programmeId, scoring_policy: 'report_only', title: 'Canonical form', listening_lesson_id: 'canonical-lesson', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [question] } }] }] };
    }),
    postWith: vi.fn(async () => ({ attempt_id: 'attempt-1', answers: [] })),
    patchWith: vi.fn(async () => ({})),
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([['general-listening-practice', 'general'], ['ielts-listening-practice', 'ielts']])('lesson start/resume/review links carry only canonical %s context without writes', async (id, path) => {
  programmeId = id; route.params = new URLSearchParams(`from=${path}&filter=completed&return_to=https://evil.test`);
  render(<ListeningLessonDetail lessonId="canonical-lesson" />);
  await screen.findByRole('heading', { name: 'Canonical lesson' });
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe(`/listening/${path}?filter=completed`);
  expect(screen.getByRole('link', { name: /Bắt đầu/ }).getAttribute('href')).toBe(`/listening/programmes/form/new-1?from=${path}&filter=completed`);
  expect(screen.getByRole('link', { name: /Tiếp tục/ }).getAttribute('href')).toBe(`/listening/programmes/form/resume-1?from=${path}&filter=completed`);
  expect(screen.getByRole('link', { name: /Xem lại/ }).getAttribute('href')).toBe(`/listening/programmes/result/review-1?from=${path}&filter=completed`);
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('query changes update form→lesson context without re-admitting, saving or revealing an answer', async () => {
  const view = render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByRole('heading', { name: 'Canonical form' });
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/general/canonical-lesson?from=general&filter=in_progress');
  route.params = new URLSearchParams('from=general&filter=new'); view.rerender(<ProgrammeFormRunner testId="test-1" />);
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/general/canonical-lesson?from=general&filter=new');
  expect(window.api.postWith).toHaveBeenCalledExactlyOnceWith('/api/listening/tests/test-1/attempts?standalone=true', {});
  expect(window.api.patchWith).not.toHaveBeenCalled(); expect(screen.queryByText(/Đáp án đối chiếu|Transcript tham khảo/)).toBeNull();
});

it.each(['from=ielts&filter=completed', 'from=general&from=general&filter=new'])('form and result reject unowned context %s and use canonical API identity', async (query) => {
  route.params = new URLSearchParams(query);
  const form = render(<ProgrammeFormRunner testId="test-1" />); await screen.findByRole('heading', { name: 'Canonical form' });
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/general/canonical-lesson');
  form.unmount(); render(<ProgrammeResult attemptId="attempt-1" />); await screen.findByRole('heading', { name: 'Canonical result' });
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe('/listening/general');
  expect(window.api.postWith).toHaveBeenCalledTimes(1); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('result preserves the filter on read-only rerenders and does not create a link to a historical lesson', async () => {
  const view = render(<ProgrammeResult attemptId="attempt-1" />); await screen.findByRole('heading', { name: 'Canonical result' });
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe('/listening/general?filter=in_progress');
  route.params = new URLSearchParams('from=general&filter=completed'); view.rerender(<ProgrammeResult attemptId="attempt-1" />);
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe('/listening/general?filter=completed');
  expect(window.api.getWith).toHaveBeenCalledTimes(1); expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /Bài học/ })).toBeNull();
});

it('source form keeps its canonical day despite foreign generic context and strips that context from the result URL', async () => {
  programmeId = 'ielts-80-days-listening';
  route.params = new URLSearchParams('from=general&filter=completed&return_to=https://evil.test');
  const getWith = window.api.getWith;
  Object.assign(window.api, { getWith: vi.fn(async (url: string) => {
    const payload = await getWith<Record<string, unknown>>(url);
    return url.endsWith('/guided-state') ? payload : { ...payload, source_day: 76 };
  }) });
  const view = render(<ProgrammeFormRunner testId="source-test-76" />);
  await screen.findByRole('heading', { name: 'Canonical form' });
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/ielts/80-days/76');
  route.params = new URLSearchParams('from=ielts&filter=new');
  view.rerender(<ProgrammeFormRunner testId="source-test-76" />);
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/ielts/80-days/76');
  expect(window.api.postWith).toHaveBeenCalledExactlyOnceWith('/api/listening/tests/source-test-76/attempts?standalone=true', {});
  expect(window.api.patchWith).not.toHaveBeenCalled();
  expect(screen.queryByText(/Đáp án đối chiếu|Transcript tham khảo/)).toBeNull();
  const { listeningProgrammeResultHref } = await import('@/lib/listening-library-context.mjs');
  expect(listeningProgrammeResultHref(programmeId, 'source-attempt/76', route.params)).toBe('/listening/programmes/result/source-attempt%2F76');
});

it('source result returns to its canonical collection without inheriting foreign filters or reloading on query changes', async () => {
  programmeId = 'ielts-80-days-listening';
  route.params = new URLSearchParams('from=general&filter=completed&return_to=https://evil.test');
  const view = render(<ProgrammeResult attemptId="source-attempt-76" />);
  await screen.findByRole('heading', { name: 'Canonical result' });
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe('/listening/ielts/80-days');
  route.params = new URLSearchParams('from=ielts&filter=new');
  view.rerender(<ProgrammeResult attemptId="source-attempt-76" />);
  expect(screen.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href')).toBe('/listening/ielts/80-days');
  expect(screen.queryByRole('link', { name: /Bài học/ })).toBeNull();
  expect(window.api.getWith).toHaveBeenCalledExactlyOnceWith('/api/listening/tests/attempts/source-attempt-76/review', undefined, { signal: expect.any(AbortSignal) });
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});
