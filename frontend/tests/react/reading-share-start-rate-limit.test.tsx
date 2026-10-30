import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'reading-start-fixture' } }),
}));

const rateLimitMessage = 'Bạn đã mở bài đọc quá nhiều lần. Vui lòng thử lại sau 1 phút.';
const genericMessage = 'Unable to start the test. Check your connection and try again.';
let postWith: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, '', '/reading/exam/session?share=reading-start-fixture');
  localStorage.clear();
  sessionStorage.clear();
  postWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: {
    getWith: vi.fn().mockResolvedValue({
      test: {
        test_id: 'reading-start-fixture', title: 'Reading start fixture', time_limit_minutes: 60,
        total_questions: 1, passages: [], questions: [],
      },
      in_progress: null,
    }),
    postWith,
  } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});

it.each([
  { label: 'server message', message: 'Thông báo giới hạn từ máy chủ.', expected: 'Thông báo giới hạn từ máy chủ.' },
  { label: 'missing message', message: undefined, expected: rateLimitMessage },
  { label: 'empty message', message: '', expected: rateLimitMessage },
  { label: 'blank message', message: '   ', expected: rateLimitMessage },
  { label: 'malformed message', message: { text: 'invalid' }, expected: rateLimitMessage },
])('shows $label for the share start throttle without retrying', async ({ message, expected }) => {
  // Match public/js/api.js: Error with status and parsed FastAPI detail.
  postWith.mockRejectedValue(Object.assign(new Error('HTTP 429'), {
    status: 429, detail: { error: 'rate_limit_exceeded', message, limit: 60, retry_after: 56 },
  }));
  render(<ReadingExamSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start test' }));

  expect((await screen.findByRole('alert')).textContent).toBe(expected);
  expect(postWith).toHaveBeenCalledTimes(1);
  expect(postWith).toHaveBeenCalledWith(
    '/api/reading/test/share/reading-start-fixture/attempts',
    { renderer_affinity_protocol: 'claim-v1' }, {}, { noRedirect: true },
  );
});

it.each([
  { label: 'HTTP 500', error: Object.assign(new Error('server failure'), { status: 500, detail: { error: 'rate_limit_exceeded', message: rateLimitMessage } }) },
  { label: 'network failure', error: new TypeError('Failed to fetch') },
  { label: 'another HTTP 429', error: Object.assign(new Error('other limit'), { status: 429, detail: { error: 'other_limit', message: rateLimitMessage } }) },
  { label: 'HTTP 429 without detail', error: Object.assign(new Error('HTTP 429'), { status: 429 }) },
])('keeps the existing message for $label', async ({ error }) => {
  postWith.mockRejectedValue(error);
  render(<ReadingExamSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start test' }));

  expect((await screen.findByRole('alert')).textContent).toBe(genericMessage);
  expect(postWith).toHaveBeenCalledTimes(1);
});

it('keeps the existing message on the authenticated start route', async () => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=reading-start-fixture');
  postWith.mockRejectedValue(Object.assign(new Error('HTTP 429'), {
    status: 429, detail: { error: 'rate_limit_exceeded', message: rateLimitMessage },
  }));
  render(<ReadingExamSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start test' }));

  expect((await screen.findByRole('alert')).textContent).toBe(genericMessage);
  expect(postWith).toHaveBeenCalledTimes(1);
  expect(postWith.mock.calls[0][0]).toBe('/api/reading/test/reading-start-fixture/attempts');
});
