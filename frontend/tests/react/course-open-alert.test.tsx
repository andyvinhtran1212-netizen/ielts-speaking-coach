// ENROLL-0060 FR-060 / PUBLICSITE-0059 FR-022 (G05-T22) — "Báo cho tôi khi mở"
// toggle states and the mail-link unsubscribe (#bo-nhan=<token>).
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OpenAlertToggle } from '@/components/courses/open-alert-toggle';
import { OpenAlertUnsubscribeNotice } from '@/components/courses/open-alert-unsubscribe-notice';

const auth = vi.hoisted(() => ({ status: 'signed-out' as 'signed-in' | 'signed-out' | 'initial-loading', id: 'learner-a' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: auth.status === 'signed-in' ? { id: auth.id, email: `${auth.id}@example.test` } : null }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

type Call = [method: string, path: string, body?: unknown];
let calls: Call[];
let mine: string[];
let lists: Record<string, string[]>;
let failNext: unknown;
let failGet: unknown;
let holdGet: Promise<void> | null;

function apiError(status: number, detail: Record<string, unknown>) {
  return Object.assign(new Error(String(detail.message ?? status)), { status, detail });
}

beforeEach(() => {
  calls = [];
  mine = [];
  lists = {};
  failNext = null;
  failGet = null;
  holdGet = null;
  auth.status = 'signed-out';
  auth.id = 'learner-a';
  const step = async (method: string, path: string, body?: unknown) => {
    calls.push(body === undefined ? [method, path] : [method, path, body]);
    if (failNext) { const e = failNext; failNext = null; throw e; }
  };
  Object.assign(window, { api: {
    getWith: async (path: string) => {
      const who = auth.id;
      const hold = holdGet;
      await step('GET', path);
      if (hold) await hold;
      if (failGet) { const e = failGet; failGet = null; throw e; }
      return { slugs: [...(lists[who] ?? mine)] };
    },
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

it('StrictMode, signed in: subscribing finishes (no stuck "Đang gửi…")', async () => {
  auth.status = 'signed-in';
  render(<StrictMode><OpenAlertToggle slug="ielts-7" /></StrictMode>);
  fireEvent.click(await screen.findByRole('button', SUBSCRIBE));
  expect(await screen.findByText('Đã đăng ký nhận báo')).toBeTruthy();
  expect(screen.queryByText('Đang gửi…')).toBeNull();
  expect(calls.filter(([m]) => m === 'POST')).toHaveLength(1);
});

it('StrictMode, guest: a refused request recovers the button and shows the message', async () => {
  failNext = apiError(503, { error_code: 'open_alerts_unavailable', message: 'x' });
  render(<StrictMode><OpenAlertToggle slug="ielts-7" /></StrictMode>);
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  fireEvent.change(screen.getByLabelText('Email nhận báo'), { target: { value: 'hoc.vien@example.test' } });
  fireEvent.click(screen.getByRole('button', SUBSCRIBE));
  expect(await screen.findByText('Chưa đăng ký nhận báo được lúc này. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
  // Not busy any more (the hidden "Đang gửi…" label only reserves width).
  expect(screen.getByRole('button', SUBSCRIBE).getAttribute('aria-disabled')).not.toBe('true');
});

it('signed in: a failed list read says so and retries; no state is guessed', async () => {
  auth.status = 'signed-in';
  mine = ['ielts-7'];
  failGet = new TypeError('Failed to fetch');
  render(<OpenAlertToggle slug="ielts-7" />);
  expect(await screen.findByText('Chưa đọc được trạng thái nhận báo của bạn. Bạn thử lại nhé.')).toBeTruthy();
  expect(screen.queryByText('Đã đăng ký nhận báo')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Đã đăng ký nhận báo')).toBeTruthy();
  expect(screen.queryByText(/Chưa đọc được/)).toBeNull();
});

it('signed in: a failed re-read after "Bỏ nhận" shows the warning, not an assumed state', async () => {
  auth.status = 'signed-in';
  mine = ['ielts-7'];
  render(<OpenAlertToggle slug="ielts-7" />);
  const unsub = await screen.findByRole('button', { name: 'Bỏ nhận' });
  failGet = new TypeError('Failed to fetch');
  fireEvent.click(unsub);
  expect(await screen.findByText('Chưa đọc được trạng thái nhận báo của bạn. Bạn thử lại nhé.')).toBeTruthy();
  expect(calls.map(([m]) => m)).toEqual(['GET', 'DELETE', 'GET']);
});

it('account A → B: the view follows B, and A\'s late answer is dropped', async () => {
  auth.status = 'signed-in';
  lists = { 'learner-a': ['ielts-7'], 'learner-b': [] };
  let release!: () => void;
  holdGet = new Promise<void>((resolve) => { release = resolve; });
  const view = render(<OpenAlertToggle slug="ielts-7" />);
  await waitFor(() => expect(calls).toHaveLength(1)); // A's read is in flight
  holdGet = null;
  auth.id = 'learner-b';
  view.rerender(<OpenAlertToggle slug="ielts-7" />);
  expect(await screen.findByRole('button', SUBSCRIBE)).toBeTruthy();
  release(); // A's answer ("subscribed") arrives after B took over
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText('Đã đăng ký nhận báo')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Bỏ nhận' })).toBeNull();
  expect(calls).toEqual([['GET', '/api/me/open-alerts'], ['GET', '/api/me/open-alerts']]);
});

it('sign-out resets to the guest view with no "Bỏ nhận"', async () => {
  auth.status = 'signed-in';
  mine = ['ielts-7'];
  const view = render(<OpenAlertToggle slug="ielts-7" />);
  expect(await screen.findByRole('button', { name: 'Bỏ nhận' })).toBeTruthy();
  auth.status = 'signed-out';
  view.rerender(<OpenAlertToggle slug="ielts-7" />);
  expect(await screen.findByRole('button', SUBSCRIBE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bỏ nhận' })).toBeNull();
  expect(screen.queryByText('Đã đăng ký nhận báo')).toBeNull();
});
