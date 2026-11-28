// ENROLL-0060 G05-T20 (FR-053): "Đăng xuất khỏi mọi thiết bị", screens 5a–5c.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignOutEverywhere } from '@/components/learner/sign-out-everywhere';
import { registerDraftSaver, resetDraftSavers } from '@/lib/auth/draft-savers.mjs';

const state = vi.hoisted(() => ({
  status: { enabled: true, state: 'current', other_session: null, timed_activity: null } as unknown,
  statusError: null as unknown,
  revoke: { revoked: 2, deferred_timed: null, at: '2026-11-23T02:05:00Z' } as unknown,
  revokeError: null as unknown,
}));
const calls: string[] = [];
const replace = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));

beforeEach(() => {
  state.status = { enabled: true, state: 'current', other_session: null, timed_activity: null };
  state.statusError = null;
  state.revoke = { revoked: 2, deferred_timed: null, at: '2026-11-23T02:05:00Z' };
  state.revokeError = null;
  calls.length = 0;
  replace.mockClear();
  signOut.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  (window as any).api = {
    getWith: vi.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      if (state.statusError) throw state.statusError;
      return state.status;
    }),
    postWith: vi.fn(async (path: string) => {
      calls.push(`POST ${path}`);
      if (state.revokeError) throw state.revokeError;
      return state.revoke;
    }),
    clearAuthCache: vi.fn(),
  };
  (window as any).getSupabase = () => ({ auth: { signOut } });
  const realWindow = window;
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? { replace } : Reflect.get(target, key, target)),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).api; delete (window as any).getSupabase; });

const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
async function mount() {
  render(<SignOutEverywhere email="minhanh@example.com" />);
  await flush();
}
const openButton = () => screen.getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' });

describe('SignOutEverywhere', () => {
  it('no button when the rule is off (enabled=false, admin/teacher) or the route is not there (404)', async () => {
    state.status = { enabled: false };
    await mount();
    expect(screen.queryByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' })).toBeNull();
    cleanup();
    state.statusError = Object.assign(new Error('HTTP 404'), { status: 404 });
    await mount();
    expect(screen.queryByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' })).toBeNull();
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('5a: the sentences, two buttons, "Huỷ" closes without calling the API', async () => {
    await mount();
    fireEvent.click(openButton());
    await flush();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Đăng xuất khỏi mọi thiết bị?');
    expect(dialog.textContent).toContain('Mọi thiết bị đang mở tài khoản minhanh@example.com, kể cả thiết bị này, phải đăng nhập lại.');
    expect(dialog.textContent).toContain('Mã đăng nhập đã gửi mà chưa dùng bị huỷ.');
    // No promise that drafts are kept (nothing saves them yet): a warning instead.
    expect(dialog.textContent).not.toContain('được lưu nháp');
    expect(dialog.textContent).toContain('Phần bài đang viết dở chưa kịp tự lưu ở các thiết bị đó có thể mất. Lưu bài ở đó trước nếu được.');
    expect(dialog.textContent).not.toContain('Bài có giờ không bị cắt ngang');
    expect(within(dialog).getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Huỷ' })).toBeTruthy();
    expect(within(dialog).getAllByRole('button').filter((b) => !b.getAttribute('aria-label')).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('5b: timed work on another device puts the warning inside 5a with the server minutes', async () => {
    state.status = {
      enabled: true, state: 'other_device_timed', other_session: null,
      timed_activity: { title: 'Thi thử tháng 11', device_label: 'Chrome trên Windows', minutes_left: 38 },
    };
    await mount();
    fireEvent.click(openButton());
    await flush();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Thi thử tháng 11 đang làm ở Chrome trên Windows, còn khoảng 38 phút.');
    expect(dialog.textContent).toContain('Bài có giờ không bị cắt ngang: việc đăng xuất ngay trên thiết bị đó được hoãn lại để giữ bài đang làm. Các thiết bị khác đăng xuất bây giờ.');
    expect(dialog.textContent).not.toContain('đăng xuất ngay khi bài kết thúc');
  });

  it('confirm → this page\'s draft savers, then revoke-all → 5c; "Đăng nhập lại" signs out locally and goes to /login', async () => {
    resetDraftSavers();
    registerDraftSaver(() => { calls.push('draft'); });
    await mount();
    fireEvent.click(openButton());
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }).at(-1)!);
    await flush();
    expect(calls.filter((c) => c === 'draft' || c.startsWith('POST'))).toEqual(['draft', 'POST /api/account/sessions/revoke-all']);
    resetDraftSavers();
    expect(screen.getByText('Đã đăng xuất khỏi mọi thiết bị lúc 09:05, 23/11/2026.')).toBeTruthy();
    expect(screen.getByText('Đăng nhập lại bằng Google hoặc bằng mã gửi tới minhanh@example.com.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đăng nhập lại' }).at(-1)!);
    await flush();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('a late status response cannot reopen confirmation after a successful revoke-all', async () => {
    await mount();
    let finishStatus!: (status: unknown) => void;
    state.status = new Promise((resolve) => { finishStatus = resolve; });
    fireEvent.click(openButton());
    await flush();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }));
    await flush();
    const success = () => screen.getByRole('dialog', { name: 'Đã đăng xuất khỏi mọi thiết bị' });
    expect(success()).toBeTruthy();

    await act(async () => finishStatus({
      enabled: true, state: 'other_device_timed',
      timed_activity: { title: 'Old timed activity', minutes_left: 9 },
    }));

    expect(within(success()).getAllByRole('button', { name: 'Đăng nhập lại' })).toHaveLength(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual(['POST /api/account/sessions/revoke-all']);
  });

  it('shows timed work reported by revoke-all even when no timed work was in the preflight', async () => {
    await mount();
    fireEvent.click(openButton());
    await flush();
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).not.toContain('Bài có giờ không bị cắt ngang');
    state.revoke = {
      revoked: 0, at: '2026-11-23T02:05:00Z',
      deferred_timed: { title: 'Thi thử tháng 11', device_label: 'Chrome trên Windows', minutes_left: 38 },
    };
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }));
    await flush();

    const result = screen.getByRole('dialog', { name: 'Đang chờ bài có giờ kết thúc' });
    expect(result.textContent).toContain('Đã tiếp nhận yêu cầu đăng xuất lúc 09:05, 23/11/2026.');
    expect(result.textContent).toContain('Thi thử tháng 11 đang làm ở Chrome trên Windows, còn khoảng 38 phút.');
    expect(result.textContent).toContain('việc đăng xuất ngay trên thiết bị đó được hoãn lại để giữ bài đang làm');
    expect(result.textContent).not.toContain('đăng xuất ngay khi bài kết thúc');
    expect(result.textContent).not.toContain('Đã đăng xuất khỏi mọi thiết bị');
    expect(result.textContent).not.toContain('Các thiết bị khác đăng xuất bây giờ');
    expect(within(result).getAllByRole('button', { name: 'Đăng nhập lại' })).toHaveLength(2);
  });

  it('an empty revoke response cannot be displayed as successful', async () => {
    state.revoke = null;
    await mount();
    fireEvent.click(openButton());
    await flush();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }));
    await flush();
    expect(screen.getByText('Chưa đăng xuất được khỏi mọi thiết bị. Thử lại sau ít phút.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('503 says so and keeps 5a; 404 single_session_disabled closes and hides the button', async () => {
    state.revokeError = Object.assign(new Error('HTTP 503'), { status: 503, detail: { error_code: 'session_revoke_unavailable' } });
    await mount();
    fireEvent.click(openButton());
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }).at(-1)!);
    await flush();
    expect(screen.getByText('Chưa đăng xuất được khỏi mọi thiết bị. Thử lại sau ít phút.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    state.revokeError = Object.assign(new Error('HTTP 404'), { status: 404, detail: { error_code: 'single_session_disabled' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' }).at(-1)!);
    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị' })).toBeNull();
  });
});
