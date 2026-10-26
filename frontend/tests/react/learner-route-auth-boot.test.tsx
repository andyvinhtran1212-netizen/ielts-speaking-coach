import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GrammarCheckup } from '@/app/(authed)/grammar-checkup/grammar-checkup';
import { ReviewRoute } from '@/app/(authed)/grammar-checkup/review/[routeId]/review-route';
import { AdvancedVocabularyLesson } from '@/app/(authed-advanced-vocab)/advanced-vocabulary/advanced-vocabulary-lesson';
import { VocabExamBehavior } from '@/app/(authed-vocab-exam)/vocabulary/exam/vocab-exam-behavior';

// G-01: a direct load of /grammar-checkup called window.api.get before api.js
// had created window.api ("Cannot read properties of undefined (reading
// 'get')"). Guarded learner routes must boot only once signed in, and render a
// neutral loading state — never content or an error box — before that.
const route = vi.hoisted(() => ({ search: '', params: {} as Record<string, string> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.search),
  useParams: () => route.params,
}));
const auth = vi.hoisted(() => ({
  status: 'initial-loading' as 'initial-loading' | 'signed-in' | 'signed-out',
  user: null as { id: string; email: string | null } | null,
}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

const redirect = vi.fn();
function signIn() { auth.status = 'signed-in'; auth.user = { id: 'learner-one', email: null }; }
function installApi(api: Record<string, unknown>) {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: api });
}

beforeEach(() => {
  auth.status = 'initial-loading'; auth.user = null; route.search = ''; route.params = {};
  redirect.mockReset();
  // window.api is absent until api.js runs — exactly the state of a direct load.
  Reflect.deleteProperty(window, 'api');
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, {
    get(target, key) {
      if (key === 'location') return { replace: redirect, search: route.search ? `?${route.search}` : '' };
      return Reflect.get(target, key, target);
    },
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'api'); });

it('/grammar-checkup direct load boots exactly once after sign-in, without the window.api error', async () => {
  const view = render(<GrammarCheckup />);
  expect(screen.getByText('Đang mở Grammar Check-up…')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();

  const get = vi.fn(async () => ({ assigned_only: false }));
  installApi({ get, post: vi.fn() });
  signIn();
  view.rerender(<GrammarCheckup />);
  expect(await screen.findByRole('heading', { name: 'Grammar Diagnostic & Adaptive Review' })).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/api/grammar/diagnostics/availability');

  view.rerender(<GrammarCheckup />);
  await act(async () => { await Promise.resolve(); });
  expect(get).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(redirect).not.toHaveBeenCalled();
});

it('/grammar-checkup signed-out shows no content or error and redirects to /login', async () => {
  auth.status = 'signed-out';
  render(<GrammarCheckup />);
  await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'));
  expect(screen.getByText('Đang mở Grammar Check-up…')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('heading')).toBeNull();
});

it('/grammar-checkup/review/[routeId] signed-out shows no error box and redirects', async () => {
  auth.status = 'signed-out'; route.params = { routeId: 'R1' }; // no ?session
  render(<ReviewRoute />);
  await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'));
  expect(screen.getByText('Đang mở tuyến ôn…')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('/advanced-vocabulary waits for sign-in before loading; signed-out shows no error and redirects', async () => {
  auth.status = 'signed-out';
  render(<AdvancedVocabularyLesson />); // no ?bank/&item would otherwise error at once
  await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'));
  expect(screen.getByText('Đang mở bài học…')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Chưa mở được bài học' })).toBeNull();
});

it('/advanced-vocabulary loads its lesson exactly once after sign-in', async () => {
  route.search = 'bank=bank-1&item=item-1';
  const view = render(<AdvancedVocabularyLesson />);
  const get = vi.fn(async () => { throw new Error('lesson unavailable'); });
  installApi({ get, post: vi.fn() });
  signIn();
  view.rerender(<AdvancedVocabularyLesson />);
  expect(await screen.findByRole('heading', { name: 'Chưa mở được bài học' })).toBeTruthy();
  view.rerender(<AdvancedVocabularyLesson />);
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/api/advanced-vocab/lessons/bank-1?item=item-1');
});

it('/vocabulary/exam renders no lists and fetches nothing until signed in', async () => {
  const getWith = vi.fn(async () => [{ family: 'ielts', lists: [{ slug: 'awl-1', title: 'AWL Sublist 1', count: 60 }] }]);
  installApi({ getWith });
  auth.status = 'signed-out';
  const view = render(<VocabExamBehavior />);
  await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'));
  expect(screen.getByText('Đang tải…')).toBeTruthy();
  expect(screen.queryByText('AWL Sublist 1')).toBeNull();
  expect(getWith).not.toHaveBeenCalled();

  signIn();
  view.rerender(<VocabExamBehavior />);
  expect(await screen.findByText('AWL Sublist 1')).toBeTruthy();
  expect(getWith).toHaveBeenCalledTimes(1);
});
