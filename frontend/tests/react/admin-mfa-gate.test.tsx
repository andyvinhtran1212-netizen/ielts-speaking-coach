// ADMINAAL2-0032 T010 / FR-013 — AdminAccessGate with the /admin/mfa/status probe.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
const wire = vi.hoisted(() => ({
  identity: null as unknown,
  status: null as unknown,
  statusError: null as unknown,
  // PC-J237: when set, the mocked client delegates to the real one.
  real: null as null | ((signal?: AbortSignal) => Promise<unknown>),
}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-1' } }) }));
vi.mock('@/components/admin-test-data-toggle', () => ({ AdminTestDataToggle: () => null }));
vi.mock('@/lib/auth-api', () => ({ getAuthorizationIdentity: vi.fn(async () => wire.identity) }));
vi.mock('@/lib/admin-mfa-api', () => ({
  getAdminMfaStatus: vi.fn(async (signal?: AbortSignal) => {
    if (wire.real) return wire.real(signal);
    if (wire.statusError) throw wire.statusError;
    return wire.status;
  }),
}));

import { AdminAccessGate } from '@/components/admin-access-gate';
import { getAdminMfaStatus } from '@/lib/admin-mfa-api';
import { ACCOUNT_INACTIVE_EVENT, bannerDismissKey } from '@/lib/admin-mfa-model.mjs';

const replace = vi.fn();
const admin = { id: 'admin-1', email: 'a@x.test', role: 'admin', is_active: true };

function renderGate() {
  return render(<AdminAccessGate><p>ADMIN DATA</p></AdminAccessGate>);
}

beforeEach(() => {
  window.sessionStorage.clear();
  (window as unknown as { api: unknown }).api = { get: vi.fn() };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/admin/users', search: '?tab=codes', replace, reload: vi.fn() },
  });
  wire.identity = admin;
  wire.status = { aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'none' };
  wire.statusError = null;
});
afterEach(() => { cleanup(); replace.mockReset(); vi.mocked(getAdminMfaStatus).mockClear(); });

describe('AdminAccessGate assurance', () => {
  it('sends an enforced AAL1 admin to /admin/mfa and never mounts children', async () => {
    wire.status = { aal: 'aal1', enforce: true, verified_factor_count: 0, next_step: 'enroll' };
    renderGate();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes'));
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Đang chuyển tới xác thực 2 bước');
  });

  it('sends an enforced AAL2 admin whose TOTP is stale (next_step challenge) to /admin/mfa', async () => {
    wire.status = { aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'challenge' };
    renderGate();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes'));
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('lets an AAL2 admin in without a banner', async () => {
    renderGate();
    expect(await screen.findByText('ADMIN DATA')).toBeTruthy();
    expect(document.getElementById('admin-mfa-report-only')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('report-only AAL1: children render under a dismissible banner that lasts for the tab', async () => {
    wire.status = { aal: 'aal1', enforce: false, verified_factor_count: 0, next_step: 'enroll' };
    renderGate();
    expect(await screen.findByText('ADMIN DATA')).toBeTruthy();
    const banner = document.getElementById('admin-mfa-report-only')!;
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain('Hãy bật xác thực 2 bước — sắp bắt buộc');
    expect(banner.querySelector('a')!.getAttribute('href')).toBe('/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes');
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn' }));
    expect(document.getElementById('admin-mfa-report-only')).toBeNull();
    expect(window.sessionStorage.getItem(bannerDismissKey('admin-1'))).toBe('1');
    cleanup();
    renderGate();
    expect(await screen.findByText('ADMIN DATA')).toBeTruthy();
    expect(document.getElementById('admin-mfa-report-only')).toBeNull();
  });

  it('refuses an inactive admin with the denied state and asks no assurance', async () => {
    wire.identity = { ...admin, is_active: false };
    renderGate();
    expect(await screen.findByText('Tài khoản chưa được kích hoạt — liên hệ admin')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Admin Access Required');
    expect(getAdminMfaStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('maps an inactive 403 from the status probe to the same denied state', async () => {
    wire.identity = { ...admin, is_active: null };
    wire.statusError = Object.assign(new Error('Tài khoản chưa được kích hoạt'), { status: 403, detail: 'Tài khoản chưa được kích hoạt' });
    renderGate();
    expect(await screen.findByText('Tài khoản chưa được kích hoạt — liên hệ admin')).toBeTruthy();
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('fails closed on a malformed status payload', async () => {
    wire.statusError = new Error('Backend trả trạng thái xác thực 2 bước không đúng định dạng.');
    renderGate();
    expect(await screen.findByText('Không xác minh được quyền')).toBeTruthy();
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('non-admins keep the unchanged denied state', async () => {
    wire.identity = { ...admin, role: 'instructor' };
    renderGate();
    expect(await screen.findByText('🔒 Admin Access Required')).toBeTruthy();
    expect(screen.queryByText('Tài khoản chưa được kích hoạt — liên hệ admin')).toBeNull();
    expect(getAdminMfaStatus).not.toHaveBeenCalled();
  });

  it('an inactive 403 announced after load replaces the admin page', async () => {
    renderGate();
    expect(await screen.findByText('ADMIN DATA')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent(ACCOUNT_INACTIVE_EVENT)); });
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
    expect(screen.getByText('Tài khoản chưa được kích hoạt — liên hệ admin')).toBeTruthy();
  });
});

describe('getAdminMfaStatus 429 safety net (PC-J237)', () => {
  const rateLimited = () => Object.assign(new Error('HTTP 429'), { status: 429, detail: { code: 'mfa_status_rate_limited' } });
  let real: typeof import('@/lib/admin-mfa-api');
  let getWith: ReturnType<typeof vi.fn>;

  function answers(...replies: unknown[]) {
    getWith = vi.fn();
    for (const reply of replies) {
      if (reply instanceof Error) getWith.mockRejectedValueOnce(reply);
      else getWith.mockResolvedValueOnce(reply);
    }
    (window as unknown as { api: unknown }).api = { get: vi.fn(), getWith };
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  beforeEach(async () => {
    real = await vi.importActual<typeof import('@/lib/admin-mfa-api')>('@/lib/admin-mfa-api');
    wire.real = real.getAdminMfaStatus;
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); wire.real = null; });

  it('429 then 200: retries once after 2 s and the gate opens', async () => {
    answers(rateLimited(), wire.status);
    renderGate();
    await advance(0);
    expect(getWith).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS - 1);
    expect(getWith).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getWith).toHaveBeenCalledTimes(2);
    expect(getWith.mock.calls.map((call) => call[0])).toEqual(['/admin/mfa/status', '/admin/mfa/status']);
    expect(screen.getByText('ADMIN DATA')).toBeTruthy();
  });

  it('429 twice: error state with the rate-limit message, never denied or ready', async () => {
    answers(rateLimited(), rateLimited());
    renderGate();
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS);
    await advance(0);
    expect(getWith).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Không xác minh được quyền')).toBeTruthy();
    expect(screen.getByText(real.ADMIN_MFA_STATUS_RATE_LIMITED)).toBeTruthy();
    expect(screen.queryByText('🔒 Admin Access Required')).toBeNull();
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
    await advance(60_000);
    expect(getWith).toHaveBeenCalledTimes(2);
  });

  it('the second 429 is thrown with status 429 and its detail', async () => {
    answers(rateLimited(), rateLimited());
    const pending = real.getAdminMfaStatus().catch((caught) => caught);
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS);
    const caught = await pending;
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ status: 429, message: real.ADMIN_MFA_STATUS_RATE_LIMITED, detail: { code: 'mfa_status_rate_limited' } });
  });

  it('an enforced AAL1 admin answered after a 429 is still sent to /admin/mfa', async () => {
    answers(rateLimited(), { aal: 'aal1', enforce: true, verified_factor_count: 0, next_step: 'enroll' });
    renderGate();
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS);
    await advance(0);
    expect(replace).toHaveBeenCalledWith('/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes');
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('a malformed payload after the retry still fails closed', async () => {
    answers(rateLimited(), { aal: 'aal3', enforce: true, verified_factor_count: 1, next_step: 'none' });
    renderGate();
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS);
    await advance(0);
    expect(screen.getByText('Backend trả trạng thái xác thực 2 bước không đúng định dạng.')).toBeTruthy();
    expect(screen.queryByText('ADMIN DATA')).toBeNull();
  });

  it('a 403 is not retried and keeps the denied state', async () => {
    answers(Object.assign(new Error('Admin only'), { status: 403, detail: 'Admin only' }));
    renderGate();
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS * 2);
    expect(getWith).toHaveBeenCalledTimes(1);
    expect(screen.getByText('🔒 Admin Access Required')).toBeTruthy();
  });

  it('an abort during the wait sends no second request', async () => {
    answers(rateLimited(), wire.status);
    const controller = new AbortController();
    const pending = real.getAdminMfaStatus(controller.signal).catch((caught) => caught);
    await advance(0);
    expect(getWith).toHaveBeenCalledTimes(1);
    controller.abort();
    const caught = await pending;
    expect((caught as Error).name).toBe('AbortError');
    await advance(real.ADMIN_MFA_STATUS_RETRY_MS * 2);
    expect(getWith).toHaveBeenCalledTimes(1);
    expect(getWith.mock.calls[0][2]).toEqual({ signal: controller.signal });
  });
});
