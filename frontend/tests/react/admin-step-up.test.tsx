// ADMINAAL2-0032 Amendment 1 (FR-020, spec.md AC12) — AdminAccessGate claims
// the transport's `step_up_required` request, asks for a fresh TOTP with the
// /admin/mfa form, and answers true (resend once) or false (keep the refusal).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-1' } }) }));
vi.mock('@/components/admin-test-data-toggle', () => ({ AdminTestDataToggle: () => null }));
vi.mock('@/lib/auth-api', () => ({
  getAuthorizationIdentity: vi.fn(async () => ({ id: 'admin-1', email: 'a@x.test', role: 'admin', is_active: true })),
}));
vi.mock('@/lib/admin-mfa-api', () => ({
  getAdminMfaStatus: vi.fn(async () => ({ aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'none' })),
}));

import { ADMIN_STEP_UP_EVENT, AdminAccessGate } from '@/components/admin-access-gate';
import { STEP_UP_PROMPT } from '@/app/(authed-admin-mfa)/admin/mfa/admin-mfa';

const verified = (id: string, name: string) => ({ id, factor_type: 'totp', status: 'verified', friendly_name: name });
let factors: ReturnType<typeof verified>[];
const mfa = {
  listFactors: vi.fn(async () => ({ data: { all: factors }, error: null })),
  challenge: vi.fn(async () => ({ data: { id: 'ch-1' }, error: null })),
  verify: vi.fn(async () => ({ data: {}, error: null }) as { data: unknown; error: unknown }),
  enroll: vi.fn(),
  unenroll: vi.fn(),
};

/** What public/js/api.js dispatches; returns whether a page claimed it. */
function requestStepUp(resolve: (ok: boolean) => void) {
  const event = new CustomEvent(ADMIN_STEP_UP_EVENT, { cancelable: true, detail: { maxAgeSeconds: 900, resolve } });
  let claimed = false;
  act(() => { claimed = !window.dispatchEvent(event); });
  return claimed;
}

async function renderReady() {
  const view = render(<AdminAccessGate><button type="button">Đổi vai trò</button></AdminAccessGate>);
  await screen.findByText('Đổi vai trò');
  // Children commit before the gate's passive effect adds the listener.
  await act(async () => {});
  return view;
}

async function enterCode(code = '123456') {
  fireEvent.change(await screen.findByLabelText('Mã 6 số'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác thực' }));
}

beforeEach(() => {
  factors = [verified('f1', 'Ứng dụng xác thực')];
  const w = window as unknown as { api: unknown; getSupabase: unknown };
  w.api = { get: vi.fn() };
  w.getSupabase = () => ({ auth: { mfa } });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/admin/users', search: '', replace: vi.fn(), reload: vi.fn() },
  });
  for (const fn of Object.values(mfa)) fn.mockClear();
});
afterEach(() => { cleanup(); });

describe('AdminAccessGate step-up prompt', () => {
  it('opens the code dialog with the approved sentence and answers true once after challenge + verify', async () => {
    await renderReady();
    const resolve = vi.fn();
    expect(requestStepUp(resolve)).toBe(true);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Thao tác này cần nhập lại mã xác thực 2 bước.');
    expect(STEP_UP_PROMPT).toBe('Thao tác này cần nhập lại mã xác thực 2 bước.');
    const input = await screen.findByLabelText('Mã 6 số');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    await enterCode();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(true));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'ch-1', code: '123456' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a wrong code keeps the dialog open with the /admin/mfa error and does not answer', async () => {
    mfa.verify.mockImplementationOnce(async () => ({ data: null, error: { status: 422, code: 'mfa_verification_failed' } }));
    await renderReady();
    const resolve = vi.fn();
    requestStepUp(resolve);
    await enterCode('000000');
    expect(await screen.findByText('Mã không đúng hoặc đã hết hạn — thử lại')).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closing the dialog answers false and verifies nothing', async () => {
    await renderReady();
    const resolve = vi.fn();
    requestStepUp(resolve);
    await screen.findByLabelText('Mã 6 số');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(resolve).toHaveBeenCalledWith(false);
    expect(mfa.verify).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers a choice when several factors are verified', async () => {
    factors = [verified('f1', 'Ứng dụng xác thực'), verified('f2', 'Dự phòng')];
    await renderReady();
    const resolve = vi.fn();
    requestStepUp(resolve);
    fireEvent.change(await screen.findByLabelText('Yếu tố xác thực'), { target: { value: 'f2' } });
    await enterCode();
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(true));
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'f2' });
  });

  it('without a verified factor it points to setup and never verifies', async () => {
    factors = [];
    await renderReady();
    requestStepUp(vi.fn());
    expect(await screen.findByText('Chưa có yếu tố xác thực nào.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Thiết lập xác thực 2 bước' }).getAttribute('href'))
      .toBe('/admin/mfa?next=%2Fadmin%2Fusers');
    expect(screen.queryByLabelText('Mã 6 số')).toBeNull();
  });

  it('unmounting with a pending prompt answers false', async () => {
    const view = await renderReady();
    const resolve = vi.fn();
    requestStepUp(resolve);
    await screen.findByRole('dialog');
    view.unmount();
    expect(resolve).toHaveBeenCalledWith(false);
  });

  it('nothing claims the request before the admin surface is ready', () => {
    // No gate mounted at all: the transport rejects at once.
    expect(requestStepUp(vi.fn())).toBe(false);
  });
});
