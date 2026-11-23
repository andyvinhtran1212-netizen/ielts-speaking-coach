// LEARNERCORE-0063 FR-063 / FR-064 / FR-088 / FR-090: the new Hồ sơ tree behind learner_v2.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/styles/av2/fonts', () => ({ av2FontClass: 'av2-fonts' }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'A', email: 'a@x.test' } }) }));
vi.mock('@/components/learner/learner-frame', () => ({ LearnerFrame: ({ children }: { children: unknown }) => children }));
vi.mock('next/dynamic', () => ({
  default: () => function ProfileV2Stub() { return <p>Cây Hồ sơ mới</p>; },
}));

const state = vi.hoisted(() => ({
  events: null as unknown,
  eventsStatus: 0,
  patchError: null as unknown,
  providers: ['google', 'email'] as string[] | null,
  me: null as unknown,
  profileReads: 0,
  profileFailFrom: 0,
}));
vi.mock('@/lib/auth/auth-me-single-flight.mjs', () => ({
  getAuthMeProfile: () => state.me,
  subscribeAuthMeProfile: () => () => {},
}));

const urls: string[] = [];
const patches: unknown[] = [];
const profile = {
  id: 'A', email: 'minhanh@example.com', display_name: 'Minh Anh', avatar_url: null, role: 'student', is_active: true,
  target_band: 6.5, exam_date: null, self_level: null, preferred_topics: [], onboarding_completed: true,
  timezone: 'Asia/Ho_Chi_Minh', weekly_goal: 4, notification_email: false, joined_at: '2026-01-01T00:00:00Z',
  stats: { total_sessions: 3, avg_band: null, joined_at: '2026-01-01T00:00:00Z' },
};
const getWith = vi.fn(async (path: string) => {
  urls.push(path);
  if (path === '/auth/profile') {
    state.profileReads += 1;
    if (state.profileFailFrom && state.profileReads >= state.profileFailFrom) throw Object.assign(new Error('HTTP 500'), { status: 500 });
    return profile;
  }
  if (path.startsWith('/api/account/login-events')) {
    if (state.eventsStatus) throw Object.assign(new Error('HTTP'), { status: state.eventsStatus });
    return state.events;
  }
  throw new Error(`unexpected ${path}`);
});
const patch = vi.fn(async (path: string, body: unknown) => {
  urls.push(path);
  patches.push(body);
  if (state.patchError) throw state.patchError;
  return {};
});

import ProfileV2 from '@/app/(authed)/profile/profile-v2';
import { ProfileTreeSwitch } from '@/app/(authed)/profile/profile-tree-switch';

async function mount() {
  render(<ProfileV2 accountId="A" />);
  await act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}

const event = (over: object) => ({
  at: '2026-11-23T02:05:00Z', device_kind: 'desktop', device_label: null, method: 'google', outcome: 'signed_in',
  is_current: false, approx_location: null, ...over,
});

beforeEach(() => {
  state.events = null;
  state.eventsStatus = 404;
  state.patchError = null;
  state.profileReads = 0;
  state.profileFailFrom = 0;
  state.providers = ['google', 'email'];
  state.me = null;
  urls.length = 0;
  patches.length = 0;
  (window as any).api = { getWith, get: getWith, patch, patchWith: patch };
  (window as any).getSupabase = () => ({
    auth: { getSession: async () => ({ data: { session: { user: { app_metadata: state.providers ? { providers: state.providers } : {} } } } }) },
  });
});
afterEach(() => { cleanup(); delete (window as any).api; delete (window as any).getSupabase; });

describe('/profile new tree', () => {
  it('login events: three outcomes in the exact words, "Thiết bị này" on the current row, no place column', async () => {
    state.eventsStatus = 0;
    state.events = { enabled: true, items: [
      event({ outcome: 'signed_in', is_current: true, device_label: 'Chrome trên Mac' }),
      event({ outcome: 'claim_refused_timed', device_kind: 'phone', method: 'email_code' }),
      event({ outcome: 'displaced', device_kind: 'tablet', method: 'unknown' }),
    ] };
    await mount();
    expect(screen.getByRole('heading', { name: 'Lần đăng nhập gần đây' })).toBeTruthy();
    expect(screen.getByText('Đã đăng nhập')).toBeTruthy();
    expect(screen.getByText('Bị từ chối: bạn đang làm bài có giờ')).toBeTruthy();
    expect(screen.getByText('Đã đăng xuất vì đăng nhập ở thiết bị khác')).toBeTruthy();
    expect(screen.getByText('Thiết bị này')).toBeTruthy();
    expect(screen.getByText('Chrome trên Mac')).toBeTruthy();
    expect(screen.getByText('Điện thoại')).toBeTruthy();
    expect(screen.getByText('Mã qua email')).toBeTruthy();
    expect(screen.getAllByText('09:05, 23/11/2026').length).toBe(3);
    expect(document.body.textContent).not.toMatch(/Nơi|vị trí|địa chỉ mạng/);
    expect(urls).toContain('/api/account/login-events?limit=3');
  });

  it('enabled=false or a 500 hides only the recent sign-ins; the rest of Hồ sơ stays', async () => {
    state.eventsStatus = 0;
    state.events = { enabled: false, items: [] };
    await mount();
    expect(screen.queryByRole('heading', { name: 'Lần đăng nhập gần đây' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Phiên đăng nhập' })).toBeTruthy();
    cleanup();
    state.eventsStatus = 500;
    await mount();
    expect(screen.queryByRole('heading', { name: 'Lần đăng nhập gần đây' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Thông tin cá nhân' })).toBeTruthy();
  });

  it('sign-in method: Google when the account has it, never a password', async () => {
    await mount();
    expect(screen.getByText('Google hoặc mã qua email. Không dùng mật khẩu.')).toBeTruthy();
    cleanup();
    state.providers = ['email'];
    await mount();
    expect(screen.getByText('Mã qua email. Không dùng mật khẩu.')).toBeTruthy();
  });

  it('"buổi mỗi tuần", not "SESSIONS/TUẦN"; saving PATCHes then reads the profile again', async () => {
    await mount();
    expect(screen.getByRole('option', { name: '4 buổi mỗi tuần', selected: true })).toBeTruthy();
    expect(document.body.textContent?.toLowerCase()).not.toContain('sessions/tuần');
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Minh Anh Trần' } });
    fireEvent.change(screen.getByLabelText('Mục tiêu luyện tập'), { target: { value: '6' } });
    urls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(patches).toEqual([{ weekly_goal: 6, display_name: 'Minh Anh Trần' }]);
    expect(urls).toEqual(['/auth/profile', '/auth/profile']);
    expect(screen.getByText('Đã lưu.')).toBeTruthy();
  });

  it('an emptied name is not sent; the field shows the name the server kept, and says so', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(patches).toEqual([{ weekly_goal: 4 }]);
    expect((screen.getByLabelText('Tên hiển thị') as HTMLInputElement).value).toBe('Minh Anh');
    expect(screen.getByText('Đã lưu. Tên hiển thị không bỏ trống được nên vẫn giữ tên cũ.')).toBeTruthy();
  });

  it('PATCH ok but the reload fails: says it saved, never "Chưa lưu được"', async () => {
    state.profileFailFrom = 2;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Đã lưu, nhưng chưa tải lại được hồ sơ. Tải lại trang để xem.')).toBeTruthy();
    expect(screen.queryByText('Chưa lưu được. Thử lại.')).toBeNull();
  });

  it('profile_update off (503 feature_disabled) → read-only values with a sentence', async () => {
    state.patchError = Object.assign(new Error('HTTP 503'), { status: 503, detail: { error_code: 'feature_disabled' } });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Tạm khoá sửa hồ sơ để bảo trì. Bạn vẫn xem được thông tin đã lưu.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
    expect(screen.getByText('4 buổi mỗi tuần')).toBeTruthy();
  });

  it('no consent switch and no consent request; the retention line names 60 days', async () => {
    await mount();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(urls.some((u) => /consent/i.test(u))).toBe(false);
    expect(screen.getByText('Bản ghi âm bài nói được giữ tối đa 60 ngày rồi xoá.')).toBeTruthy();
  });

  it('G05-T24 not merged: "Email đăng nhập" shows the current email and no change button', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'Email đăng nhập' })).toBeTruthy();
    expect(screen.getByText('minhanh@example.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Đổi email/ })).toBeNull();
  });
});

describe('/profile tree switch', () => {
  it('learner_v2 off or missing → the legacy tree as is; on → the new tree', () => {
    state.me = { id: 'A', learner_v2_enabled: false };
    const { rerender } = render(<ProfileTreeSwitch><p>Cây cũ</p></ProfileTreeSwitch>);
    expect(screen.getByText('Cây cũ')).toBeTruthy();
    expect(screen.queryByText('Cây Hồ sơ mới')).toBeNull();
    state.me = null;
    rerender(<ProfileTreeSwitch><p>Cây cũ</p></ProfileTreeSwitch>);
    expect(screen.getByText('Cây cũ')).toBeTruthy();
    cleanup();
    state.me = { id: 'A', learner_v2_enabled: true };
    render(<ProfileTreeSwitch><p>Cây cũ</p></ProfileTreeSwitch>);
    expect(screen.getByText('Cây Hồ sơ mới')).toBeTruthy();
    expect(screen.queryByText('Cây cũ')).toBeNull();
  });
});
