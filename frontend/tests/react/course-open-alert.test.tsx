// ENROLL-0060 FR-060 / PUBLICSITE-0059 FR-022 (G05-T22) — "Báo cho tôi khi mở"
// toggle states and the mail-link unsubscribe (#bo-nhan=<token>).
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OpenAlertToggle } from '@/components/courses/open-alert-toggle';
import { OpenAlertUnsubscribeNotice } from '@/components/courses/open-alert-unsubscribe-notice';

const auth = vi.hoisted(() => ({ status: 'signed-out' as 'signed-in' | 'signed-out' | 'initial-loading' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: auth.status === 'signed-in' ? { id: 'learner-a', email: 'learner@example.test' } : null }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

type Call = [method: string, path: string, body?: unknown];
let calls: Call[];
let mine: string[];
let failNext: unknown;

function apiError(status: number, detail: Record<string, unknown>) {
  return Object.assign(new Error(String(detail.message ?? status)), { status, detail });
}

beforeEach(() => {
  calls = [];
  mine = [];
  failNext = null;
  auth.status = 'signed-out';
  const step = async (method: string, path: string, body?: unknown) => {
    calls.push(body === undefined ? [method, path] : [method, path, body]);
    if (failNext) { const e = failNext; failNext = null; throw e; }
  };
  Object.assign(window, { api: {
    getWith: async (path: string) => { await step('GET', path); return { slugs: [...mine] }; },
    postWith: async (path: string, body: unknown) => { await step('POST', path, body); mine = ['ielts-7']; return { ok: true }; },
    deleteWith: async (path: string, body: unknown) => { await step('DELETE', path, body); mine = []; return { ok: true }; },
  } });
  window.history.replaceState(null, '', '/courses/ielts-7');
});
afterEach(cleanup);

const SUBSCRIBE = { name: 'Báo cho tôi khi mở' };
const NOTE = 'Chỉ gửi một thư khi khoá mở đăng ký. Bạn bỏ nhận được bất cứ lúc nào.';

it('guest: the button opens an email field under the row, no popup', async () => {
  render(<OpenAlertToggle slug="ielts-7" />);
  expect(screen.getByText(NOTE)).toBeTruthy();
  expect(screen.queryByLabelText('Email nhận báo')).toBeNull();
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(screen.getByLabelText('Email nhận báo')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls).toEqual([]);
});

it('guest: a malformed email is reported under the field and nothing is sent', async () => {
  render(<OpenAlertToggle slug="ielts-7" />);
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  fireEvent.change(screen.getByLabelText('Email nhận báo'), { target: { value: 'not-an-email' } });
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(screen.getByText('Email chưa đúng.')).toBeTruthy();
  expect((screen.getByLabelText('Email nhận báo') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  expect(calls).toEqual([]);
});

it('guest: subscribing shows "Đã đăng ký nhận báo" with the mail-link note and stores no token', async () => {
  render(<OpenAlertToggle slug="ielts-7" />);
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  fireEvent.change(screen.getByLabelText('Email nhận báo'), { target: { value: '  hoc.vien@example.test ' } });
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(await screen.findByText('Đã đăng ký nhận báo')).toBeTruthy();
  expect(screen.getByText('Thư sẽ có liên kết bỏ nhận.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bỏ nhận' })).toBeNull();
  expect(calls).toEqual([['POST', '/api/courses/ielts-7/open-alerts', { email: 'hoc.vien@example.test' }]]);
  expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
});

it('guest: a server refusal keeps the typed email and shows the message', async () => {
  failNext = apiError(429, { error_code: 'open_alert_rate_limited', message: 'Bạn đã gửi nhiều lần quá. Bạn thử lại sau nhé.' });
  render(<OpenAlertToggle slug="ielts-7" />);
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  fireEvent.change(screen.getByLabelText('Email nhận báo'), { target: { value: 'hoc.vien@example.test' } });
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(await screen.findByText('Bạn đã gửi nhiều lần quá. Bạn thử lại sau nhé.')).toBeTruthy();
  expect((screen.getByLabelText('Email nhận báo') as HTMLInputElement).value).toBe('hoc.vien@example.test');
});

it('signed in, not subscribed: only the button; one click subscribes through the session', async () => {
  auth.status = 'signed-in';
  render(<OpenAlertToggle slug="ielts-7" />);
  await waitFor(() => expect(calls).toEqual([['GET', '/api/me/open-alerts']]));
  expect(screen.queryByLabelText('Email nhận báo')).toBeNull();
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(await screen.findByText('Đã đăng ký nhận báo')).toBeTruthy();
  expect(calls.slice(1)).toEqual([['POST', '/api/courses/ielts-7/open-alerts', {}], ['GET', '/api/me/open-alerts']]);
});

it('signed in, already subscribed: "Bỏ nhận" calls DELETE with the session and re-reads the list', async () => {
  auth.status = 'signed-in';
  mine = ['ielts-7'];
  render(<OpenAlertToggle slug="ielts-7" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bỏ nhận' }));
  expect(await screen.findByRole('button', SUBSCRIBE)).toBeTruthy();
  expect(calls).toEqual([
    ['GET', '/api/me/open-alerts'],
    ['DELETE', '/api/courses/ielts-7/open-alerts', {}],
    ['GET', '/api/me/open-alerts'],
  ]);
});

it('#bo-nhan=<token>: exactly one DELETE with the token, hash cleared, strip shown', async () => {
  window.history.replaceState(null, '', '/courses/ielts-7#bo-nhan=abc');
  render(<StrictMode><OpenAlertUnsubscribeNotice slug="ielts-7" /></StrictMode>);
  expect(await screen.findByText('Bạn đã bỏ nhận thông báo về khoá này.')).toBeTruthy();
  expect(calls).toEqual([['DELETE', '/api/courses/ielts-7/open-alerts', { unsubscribe_token: 'abc' }]]);
  expect(window.location.hash).toBe('');
  expect(window.location.pathname).toBe('/courses/ielts-7');
});

it('#bo-nhan=<token>: a network failure shows the retry strip, and retry sends again', async () => {
  failNext = new TypeError('Failed to fetch');
  window.history.replaceState(null, '', '/courses/ielts-7#bo-nhan=abc');
  render(<OpenAlertUnsubscribeNotice slug="ielts-7" />);
  expect(await screen.findByText('Chưa bỏ nhận được, thử lại')).toBeTruthy();
  expect(window.location.hash).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Bạn đã bỏ nhận thông báo về khoá này.')).toBeTruthy();
  expect(calls).toHaveLength(2);
});

it('no #bo-nhan hash: nothing is sent and nothing is shown', () => {
  window.history.replaceState(null, '', '/courses/ielts-7#gioi-thieu');
  const { container } = render(<OpenAlertUnsubscribeNotice slug="ielts-7" />);
  expect(container.textContent).toBe('');
  expect(calls).toEqual([]);
  expect(window.location.hash).toBe('#gioi-thieu');
});

it('a broken #bo-nhan= link tells the user, sends nothing and clears the hash', async () => {
  window.history.replaceState(null, '', '/courses/ielts-7#bo-nhan=');
  render(<OpenAlertUnsubscribeNotice slug="ielts-7" />);
  expect(await screen.findByText(/Liên kết bỏ nhận không đúng/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  expect(calls).toEqual([]);
  expect(window.location.hash).toBe('');
});
