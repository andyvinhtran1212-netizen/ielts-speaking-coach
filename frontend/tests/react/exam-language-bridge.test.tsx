import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExamLanguageBridge } from '@/components/exam-language-bridge';

const route = vi.hoisted(() => ({ pathname: '/' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

beforeEach(() => { document.documentElement.lang = 'vi'; route.pathname = '/'; });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('lang'); });

it.each(['/reading/exam/session', '/listening/test/session', '/mock-exam', '/mock-exam/'])(
  'sets English on %s and restores Vietnamese on client navigation', (pathname) => {
    route.pathname = pathname;
    const view = render(<StrictMode><ExamLanguageBridge /></StrictMode>);
    expect(document.documentElement.lang).toBe('en');
    route.pathname = '/admin/mock-exams';
    view.rerender(<StrictMode><ExamLanguageBridge /></StrictMode>);
    expect(document.documentElement.lang).toBe('vi');
  },
);

it('keeps English across exam routes and restores the original language on unmount', () => {
  route.pathname = '/reading/exam/session';
  const view = render(<ExamLanguageBridge />);
  route.pathname = '/listening/test/session';
  view.rerender(<ExamLanguageBridge />);
  expect(document.documentElement.lang).toBe('en');
  route.pathname = '/mock-exam';
  view.rerender(<ExamLanguageBridge />);
  expect(document.documentElement.lang).toBe('en');
  view.unmount();
  expect(document.documentElement.lang).toBe('vi');
});

it.each([null, '/reading/review', '/listening/programmes/form/test', '/mock-exam/report'])('does not change language on %s', (pathname) => {
  route.pathname = pathname;
  render(<ExamLanguageBridge />);
  expect(document.documentElement.lang).toBe('vi');
});

it('preserves a missing language attribute on cleanup', () => {
  document.documentElement.removeAttribute('lang');
  route.pathname = '/mock-exam';
  const view = render(<ExamLanguageBridge />);
  expect(document.documentElement.lang).toBe('en');
  view.unmount();
  expect(document.documentElement.hasAttribute('lang')).toBe(false);
});
