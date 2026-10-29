// ADMINAAL2-0032 T010 — /admin/mfa against a GoTrue-like Supabase MFA fake.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
const wire = vi.hoisted(() => ({ status: null as unknown }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-1' } }) }));
vi.mock('@/lib/auth-api', () => ({
  getAuthorizationIdentity: vi.fn(async () => ({ id: 'admin-1', email: 'a@x.test', role: 'admin', is_active: true })),
}));
vi.mock('@/lib/admin-mfa-api', () => ({ getAdminMfaStatus: vi.fn(async () => wire.status) }));

import { AdminMfa } from '@/app/(authed-admin-mfa)/admin/mfa/admin-mfa';

type Factor = { id: string; factor_type: string; status: string; friendly_name: string; created_at: string };

/** GoTrue keeps unverified factors and refuses a duplicate friendly name. */
function gotrue(initial: Factor[]) {
  const factors = [...initial];
  let seq = 0;
  const mfa = {
    listFactors: vi.fn(async () => ({ data: { all: factors.map((f) => ({ ...f })) }, error: null })),
    enroll: vi.fn(async ({ friendlyName }: { friendlyName: string }) => {
      if (factors.some((f) => f.friendly_name === friendlyName)) {
        return { data: null, error: { status: 422, code: 'mfa_factor_name_conflict', message: 'A factor with the friendly name already exists' } };
      }
      seq += 1;
      const id = `new-${seq}`;
      factors.push({ id, factor_type: 'totp', status: 'unverified', friendly_name: friendlyName, created_at: '2026-10-29T00:00:00Z' });
      return { data: { id, totp: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+', secret: `SECRET${seq}` } }, error: null };
    }),
    challenge: vi.fn(async () => ({ data: { id: 'ch-1' }, error: null })),
    verify: vi.fn(async () => ({ data: {}, error: null })),
    unenroll: vi.fn(async ({ factorId }: { factorId: string }) => {
      const at = factors.findIndex((f) => f.id === factorId);
      if (at >= 0) factors.splice(at, 1);
      return { data: {}, error: null };
    }),
  };
  return { mfa, factors };
}

const primary: Factor = { id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Ứng dụng xác thực', created_at: '2026-10-01T00:00:00Z' };
const replace = vi.fn();
let fake: ReturnType<typeof gotrue>;

beforeEach(() => {
  fake = gotrue([primary]);
  const w = window as unknown as { api: unknown; getSupabase: unknown };
  w.api = { get: vi.fn() };
  w.getSupabase = () => ({ auth: { mfa: fake.mfa } });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/admin/mfa', search: '?next=%2Fadmin%2Fusers', replace, reload: vi.fn() },
  });
  wire.status = { aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'none' };
});
afterEach(() => { cleanup(); replace.mockReset(); });

describe('/admin/mfa stale AAL2 (backend next_step: challenge)', () => {
  it('offers the challenge, not factor management, and returns to next after verifying', async () => {
    wire.status = { aal: 'aal2', enforce: true, verified_factor_count: 1, next_step: 'challenge' };
    render(<AdminMfa />);
    expect(await screen.findByRole('heading', { name: 'Nhập mã xác thực' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Yếu tố xác thực' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Mã 6 số'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác thực' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/users'));
    expect(fake.mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'ch-1', code: '123456' });
  });
});

describe('/admin/mfa cancel while adding a factor', () => {
  async function startBackup() {
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm yếu tố dự phòng' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu thiết lập' }));
    await screen.findByRole('heading', { name: 'Quét mã QR' });
  }

  it('start → QR → cancel removes the unverified factor and a second start succeeds without reload', async () => {
    render(<AdminMfa />);
    await startBackup();
    expect(fake.factors.map((f) => f.status)).toEqual(['verified', 'unverified']);

    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(fake.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'new-1' }));
    await screen.findByRole('heading', { name: 'Yếu tố xác thực' });
    await waitFor(() => expect(screen.queryByText(/Chưa hoàn tất/)).toBeNull());
    expect(fake.factors.map((f) => f.id)).toEqual(['f1']);

    await startBackup();
    expect(screen.getByText('SECRET2')).toBeTruthy();
    expect(fake.factors.map((f) => f.friendly_name)).toEqual(['Ứng dụng xác thực', 'Dự phòng']);
  });

  it('a failed cleanup on cancel is recovered by the next start reading the canonical list', async () => {
    render(<AdminMfa />);
    await startBackup();
    fake.mfa.unenroll.mockImplementationOnce(async () => ({ data: null, error: { status: 0, name: 'AuthRetryableFetchError', message: 'offline' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(fake.mfa.unenroll).toHaveBeenCalledTimes(1));
    expect(fake.factors.map((f) => f.id)).toEqual(['f1', 'new-1']);

    await startBackup();
    expect(screen.getByText('SECRET2')).toBeTruthy();
    expect(screen.queryByText(/friendly name already exists/)).toBeNull();
    expect(fake.factors.map((f) => f.id)).toEqual(['f1', 'new-2']);
  });
});
