// ACCOUNTDATA-0100 ui-states.md on /account: "Dữ liệu của tôi", the danger
// zone and the pending-deletion notice, against the routes of #2600.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => state.auth }));
vi.mock('@/components/learner/learner-frame', () => ({ useLearnerMe: () => state.me }));

const state = vi.hoisted(() => ({
  auth: { status: 'signed-in', user: { id: 'A', email: 'Minh.Anh@x.test' } },
  me: { status: 'ready', me: { role: 'user' } } as { status: string; me: { role: string } | null },
  deletion: { status: 'none', requested_at: null, erase_after: null } as unknown,
  deletionError: null as unknown,
  exportJob: { status: 'none' } as unknown,
  exportError: null as unknown,
  postError: {} as Record<string, unknown>,
  postReply: {} as Record<string, unknown>,
}));
const urls: string[] = [];
const posts: Array<{ path: string; body: unknown }> = [];
const replace = vi.fn();
const assign = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));

const getWithImpl = async (path: string, _headers?: unknown) => {
  urls.push(path);
  if (path === '/api/account/deletion-request') {
    if (state.deletionError) throw state.deletionError;
    return state.deletion;
  }
  if (path === '/api/account/data-export') {
    if (state.exportError) throw state.exportError;
    return state.exportJob;
  }
  if (path === '/api/me/courses') throw Object.assign(new Error('HTTP 404'), { status: 404 });
  if (path.startsWith('/api/class/me')) return { has_class: false };
  throw new Error(`unexpected ${path}`);
};
const getWith = vi.fn(getWithImpl);
const postWith = vi.fn(async (path: string, body: unknown) => {
  posts.push({ path, body });
  if (state.postError[path]) throw state.postError[path];
  return state.postReply[path] ?? {};
});

import { AccountPage } from '@/app/(authed-v2-account)/account/account-page';

const apiError = (status: number, detail: unknown) => Object.assign(new Error('HTTP'), { status, detail });

async function settle() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}
async function mount() {
  render(<AccountPage />);
  await settle();
}

beforeEach(() => {
  state.auth = { status: 'signed-in', user: { id: 'A', email: 'Minh.Anh@x.test' } };
  state.me = { status: 'ready', me: { role: 'user' } };
  state.deletion = { status: 'none', requested_at: null, erase_after: null };
  state.deletionError = null;
  state.exportJob = { status: 'none' };
  state.exportError = null;
  state.postError = {};
  state.postReply = {};
  urls.length = 0;
  posts.length = 0;
  getWith.mockImplementation(getWithImpl);
  replace.mockClear();
  assign.mockClear();
  signOut.mockClear();
  (window as any).api = { getWith, postWith, base: 'https://api.fixture', clearAuthCache: vi.fn() };
  (window as any).getSupabase = () => ({
    auth: { signOut, getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  });
  const realWindow = window;
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? { replace, assign } : Reflect.get(target, key, target)),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as any).api;
  delete (window as any).getSupabase;
});

const zone = () => screen.getByRole('region', { name: 'Yêu cầu xoá tài khoản và dữ liệu' });
const dataBlock = () => screen.getByRole('region', { name: 'Dữ liệu của tôi' });
const sendButton = () => within(zone()).getByRole('button', { name: 'Gửi yêu cầu xoá' });

describe('/account: danger zone (FR-001, FR-002)', () => {
  it('the button stays off until the login email is typed (trimmed, any case); sending posts it and shows the date', async () => {
    state.postReply['/api/account/deletion-request'] = {
      status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z',
      sessions_revoked: true, email_sent: true,
    };
    await mount();
    const field = within(zone()).getByLabelText(/Gõ email đăng nhập \(Minh\.Anh@x\.test\) để xác nhận/);
    expect(sendButton().hasAttribute('disabled') || sendButton().getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.change(field, { target: { value: 'minh.anh@x.tes' } });
    fireEvent.click(sendButton());
    expect(posts).toEqual([]);
    fireEvent.change(field, { target: { value: '  MINH.ANH@x.test ' } });
    await act(async () => { fireEvent.click(sendButton()); });
    await settle();
    expect(posts).toEqual([{ path: '/api/account/deletion-request', body: { confirm_email: 'MINH.ANH@x.test' } }]);
    expect(within(zone()).getByText('Đã gửi yêu cầu xoá.')).toBeTruthy();
    expect(zone().textContent).toContain('Tài khoản và dữ liệu sẽ bị xoá ngày 23/12/2026.');
    expect(zone().textContent).toContain('Bạn đã được đăng xuất khỏi mọi thiết bị.');

    await act(async () => { fireEvent.click(within(zone()).getByRole('button', { name: 'Đăng nhập lại' })); });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('a failed revoke or letter is said plainly; nothing claims more than the server did', async () => {
    state.postReply['/api/account/deletion-request'] = {
      status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z',
      sessions_revoked: false, email_sent: false,
    };
    await mount();
    fireEvent.change(within(zone()).getByLabelText(/Gõ email đăng nhập/), { target: { value: 'minh.anh@x.test' } });
    await act(async () => { fireEvent.click(sendButton()); });
    await settle();
    expect(zone().textContent).toContain('Các thiết bị khác sẽ bị đăng xuất trong ít phút.');
    expect(zone().textContent).not.toContain('Bạn đã được đăng xuất khỏi mọi thiết bị.');
    expect(zone().textContent).toContain('Chưa gửi được thư xác nhận.');
  });

  it('422 marks the field and focuses it; a network error says retry and signs nothing out', async () => {
    state.postError['/api/account/deletion-request'] = apiError(422, { error_code: 'confirm_email_mismatch' });
    await mount();
    const field = within(zone()).getByLabelText(/Gõ email đăng nhập/);
    fireEvent.change(field, { target: { value: 'minh.anh@x.test' } });
    await act(async () => { fireEvent.click(sendButton()); });
    await settle();
    expect(zone().textContent).toContain('Email bạn gõ không khớp email đăng nhập.');
    expect(document.activeElement).toBe(within(zone()).getByLabelText(/Gõ email đăng nhập/));

    state.postError['/api/account/deletion-request'] = new Error('Failed to fetch');
    await act(async () => { fireEvent.click(sendButton()); });
    await settle();
    expect(within(zone()).getByRole('alert').textContent).toContain('Chưa gửi được yêu cầu. Thử lại.');
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a staff account sees the contact line, from its role or from a 403', async () => {
    state.me = { status: 'ready', me: { role: 'instructor' } };
    await mount();
    expect(zone().textContent).toContain('Tài khoản nhân viên không tự xoá được. Bạn liên hệ admin nhé.');
    expect(within(zone()).queryByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeNull();
    cleanup();

    state.me = { status: 'loading', me: null };
    state.postError['/api/account/deletion-request'] = apiError(403, { error_code: 'staff_account_not_self_deletable' });
    await mount();
    fireEvent.change(within(zone()).getByLabelText(/Gõ email đăng nhập/), { target: { value: 'minh.anh@x.test' } });
    await act(async () => { fireEvent.click(sendButton()); });
    await settle();
    expect(zone().textContent).toContain('Tài khoản nhân viên không tự xoá được.');
  });

  it('routes not deployed (404) hide both blocks; another failure says so instead of hiding silently', async () => {
    state.deletionError = apiError(404, null);
    await mount();
    expect(screen.queryByRole('region', { name: 'Yêu cầu xoá tài khoản và dữ liệu' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Dữ liệu của tôi' })).toBeNull();
    cleanup();

    state.deletionError = apiError(503, { error_code: 'account_data_unavailable' });
    await mount();
    expect(screen.queryByRole('region', { name: 'Yêu cầu xoá tài khoản và dữ liệu' })).toBeNull();
    expect(screen.getByText('Chưa tải được phần dữ liệu và xoá tài khoản. Tải lại trang để thử lại.')).toBeTruthy();
  });
});

describe('/account: pending deletion (FR-003)', () => {
  it('shows only the notice and the data block, focused, and reads no other learner route', async () => {
    state.deletion = { status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z' };
    await mount();
    expect(screen.getByText('Tài khoản sẽ bị xoá ngày 23/12/2026.')).toBeTruthy();
    expect(dataBlock()).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Yêu cầu xoá tài khoản và dữ liệu' })).toBeNull();
    expect(urls.filter((u) => !u.startsWith('/api/account/'))).toEqual([]);
    expect(document.activeElement?.textContent).toContain('Tài khoản sẽ bị xoá ngày 23/12/2026.');
  });

  it('"Huỷ yêu cầu xoá" cancels, reads again and opens the page back', async () => {
    state.deletion = { status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z' };
    state.postReply['/api/account/deletion-request/cancel'] = { status: 'cancelled', cancelled_at: '2026-11-24T01:00:00Z' };
    await mount();
    state.deletion = { status: 'none', requested_at: null, erase_after: null };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Huỷ yêu cầu xoá' })); });
    await settle();
    expect(posts.map((p) => p.path)).toEqual(['/api/account/deletion-request/cancel']);
    expect(screen.getByText('Đã huỷ yêu cầu xoá. Bạn học tiếp bình thường.')).toBeTruthy();
    expect(urls).toContain('/api/me/courses');
    expect(zone()).toBeTruthy();
  });

  it('409 deletion_in_progress says it can no longer be cancelled; erasing shows no data block', async () => {
    state.deletion = { status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z' };
    state.postError['/api/account/deletion-request/cancel'] = apiError(409, { error_code: 'deletion_in_progress' });
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Huỷ yêu cầu xoá' })); });
    await settle();
    expect(screen.getByText('Tài khoản đang được xoá.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Huỷ yêu cầu xoá' })).toBeNull();
    cleanup();

    state.deletion = { status: 'erasing', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z' };
    await mount();
    expect(screen.getByText('Tài khoản đang được xoá.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Dữ liệu của tôi' })).toBeNull();
  });
});

describe('/account: Dữ liệu của tôi (FR-010…FR-012)', () => {
  it('pending, with the export route answering 404: the block goes away instead of loading forever', async () => {
    state.deletion = { status: 'pending', requested_at: '2026-11-23T05:00:00Z', erase_after: '2026-12-23T05:00:00Z' };
    state.exportError = apiError(404, null);
    await mount();
    expect(screen.getByText('Tài khoản sẽ bị xoá ngày 23/12/2026.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Dữ liệu của tôi' })).toBeNull();
    expect(screen.queryByText('Đang tải trạng thái…')).toBeNull();
  });


  it('none → request; the page reads the server state again after the POST', async () => {
    await mount();
    expect(dataBlock().textContent).toContain('Bạn có thể tải một bản dữ liệu của mình');
    state.exportJob = { status: 'queued', export_id: 'e1', requested_at: '2026-11-23T05:00:00Z', ready_at: null, expires_at: null, size_bytes: null };
    await act(async () => { fireEvent.click(within(dataBlock()).getByRole('button', { name: 'Yêu cầu tải dữ liệu' })); });
    await settle();
    expect(posts.map((p) => p.path)).toEqual(['/api/account/data-export']);
    expect(urls.filter((u) => u === '/api/account/data-export').length).toBe(2);
    expect(dataBlock().textContent).toContain('Đang chuẩn bị gói dữ liệu.');
    expect(within(dataBlock()).getByRole('button', { name: 'Kiểm tra lại' })).toBeTruthy();
  });

  it('429 shows when a new request is allowed', async () => {
    state.exportJob = { status: 'expired', export_id: 'e1', requested_at: null, ready_at: null, expires_at: '2026-11-20T00:00:00Z', size_bytes: 10 };
    state.postError['/api/account/data-export'] = apiError(429, { error_code: 'export_recently_requested', retry_after: 7200 });
    await mount();
    await act(async () => { fireEvent.click(within(dataBlock()).getByRole('button', { name: 'Yêu cầu tải dữ liệu' })); });
    await settle();
    expect(dataBlock().textContent).toMatch(/Bạn yêu cầu gói mới được từ \d{2}:\d{2}, \d{2}\/\d{2}\/\d{4}\./);
  });

  it('ready → "Tải xuống" asks for the JSON link and opens the signed URL; 410 asks for a new package', async () => {
    state.exportJob = { status: 'ready', export_id: 'e-9', requested_at: null, ready_at: '2026-11-23T05:00:00Z', expires_at: '2026-11-30T05:00:00Z', size_bytes: 12_900_000 };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const downloads: Array<{ path: string; headers: unknown }> = [];
    let downloadReply: () => Promise<unknown> = async () => ({ url: 'https://storage.fixture/sign/e-9.zip?token=t', expires_in_seconds: 60 });
    getWith.mockImplementation(async (path: string, headers?: unknown) => {
      if (path.endsWith('/download')) { downloads.push({ path, headers }); return downloadReply(); }
      urls.push(path);
      if (path === '/api/account/deletion-request') return state.deletion;
      if (path === '/api/account/data-export') return state.exportJob;
      if (path === '/api/me/courses') throw Object.assign(new Error('HTTP 404'), { status: 404 });
      if (path.startsWith('/api/class/me')) return { has_class: false };
      throw new Error(`unexpected ${path}`);
    });
    await mount();
    expect(dataBlock().textContent).toContain('Gói dữ liệu đã sẵn sàng (12,3 MB).');
    await act(async () => { fireEvent.click(within(dataBlock()).getByRole('button', { name: 'Tải xuống' })); });
    await settle();
    expect(downloads).toEqual([{ path: '/api/account/data-export/e-9/download', headers: { Accept: 'application/json' } }]);
    expect(assign).toHaveBeenCalledWith('https://storage.fixture/sign/e-9.zip?token=t');
    expect(fetchMock).not.toHaveBeenCalled();

    downloadReply = async () => { throw apiError(410, { error_code: 'export_expired' }); };
    state.exportJob = { status: 'expired', export_id: 'e-9', requested_at: null, ready_at: null, expires_at: '2026-11-22T05:00:00Z', size_bytes: null };
    await act(async () => { fireEvent.click(within(dataBlock()).getByRole('button', { name: 'Tải xuống' })); });
    await settle();
    expect(dataBlock().textContent).toContain('Gói dữ liệu này đã hết hạn hoặc không còn. Bạn yêu cầu gói mới nhé.');
    expect(within(dataBlock()).getByRole('button', { name: 'Yêu cầu tải dữ liệu' })).toBeTruthy();
  });

  it('a failed read offers retry; a failed package offers "Yêu cầu lại"', async () => {
    state.exportError = apiError(503, { error_code: 'account_data_unavailable' });
    await mount();
    expect(dataBlock().textContent).toContain('Chưa tải được trạng thái gói dữ liệu.');
    state.exportError = null;
    state.exportJob = { status: 'failed', export_id: 'e1', requested_at: null, ready_at: null, expires_at: null, size_bytes: null };
    await act(async () => { fireEvent.click(within(dataBlock()).getByRole('button', { name: 'Thử lại' })); });
    await settle();
    expect(dataBlock().textContent).toContain('Tạo gói dữ liệu bị lỗi.');
    expect(within(dataBlock()).getByRole('button', { name: 'Yêu cầu lại' })).toBeTruthy();
  });
});
