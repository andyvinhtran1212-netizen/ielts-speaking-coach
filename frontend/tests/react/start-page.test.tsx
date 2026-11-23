// LEARNERCORE-0063 FR-065 / FR-066: "Lần đầu vào" at /start.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'A', email: 'a@x.test' } }) }));

const state = vi.hoisted(() => ({
  me: null as any,
  courses: null as unknown,
  cls: { has_class: false } as unknown,
  patchFails: false,
}));
const urls: string[] = [];
const patches: unknown[] = [];
const assign = vi.fn();
const replace = vi.fn();

const getWith = vi.fn(async (path: string) => {
  urls.push(path);
  if (path === '/auth/me') return state.me;
  if (path === '/api/me/courses') {
    if (state.courses === null) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    return state.courses;
  }
  if (path.startsWith('/api/class/me')) return state.cls;
  throw new Error(`unexpected ${path}`);
});
const patch = vi.fn(async (path: string, body: unknown) => {
  urls.push(path);
  patches.push(body);
  if (state.patchFails) throw Object.assign(new Error('HTTP 503'), { status: 503 });
  return {};
});

import { StartFlow } from '@/app/(authed-v2-start)/start/start-flow';

const me = (over: object = {}) => ({
  id: 'A', email: 'a@x.test', display_name: 'Minh Anh', avatar_url: null, role: 'student',
  is_active: true, suspended: false, onboarding_completed: false, target_band: null, exam_date: null,
  self_level: null, preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false,
  d3_enabled: false, flashcard_enabled: false, vocab_curated_enabled: false, learner_v2_enabled: true, ...over,
});

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/start', search, hash: '', assign, replace },
  });
}

async function mount() {
  render(<StartFlow />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  state.me = me();
  state.courses = null;
  state.cls = { has_class: false };
  state.patchFails = false;
  urls.length = 0;
  patches.length = 0;
  assign.mockReset();
  replace.mockReset();
  (window as any).api = { getWith, patch, get: getWith };
  setSearch('');
});
afterEach(() => { cleanup(); delete (window as any).api; });

describe('/start', () => {
  it('step 1 greets by name; "Bỏ qua" writes onboarding_completed=true, then goes to /home', async () => {
    await mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'Chào Minh Anh.' })).toBeTruthy();
    expect(screen.getByText('Bước 1 trên 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua, vào trang chính' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/home'));
    expect(patches).toEqual([{ onboarding_completed: true }]);
    expect(urls.some((u) => /consent/i.test(u))).toBe(false);
  });

  it('step 2 saves only the goal that was set, then step 3', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.change(screen.getByLabelText('Band muốn đạt'), { target: { value: '6.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bạn bắt đầu từ đâu?' })).toBeTruthy();
    expect(patches).toEqual([{ target_band: 6.5 }]);
  });

  it('no course: "chưa có khoá nào" is pre-chosen and "Đọc Thư viện" finishes there', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect((screen.getByRole('radio', { name: 'Tôi chưa có khoá nào' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Đọc Thư viện' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/library'));
    expect(patches).toEqual([{ onboarding_completed: true }]);
  });

  it('active online course: "đã đăng ký khoá online" is pre-chosen', async () => {
    state.courses = { items: [{ kind: 'online', state: 'active' }] };
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect((screen.getByRole('radio', { name: 'Tôi đã đăng ký khoá online' }) as HTMLInputElement).checked).toBe(true);
  });

  it('in a class: two steps, step 3 hidden, the flow ends at the assigned work', async () => {
    state.cls = { has_class: true };
    await mount();
    expect(await screen.findByText('Bước 1 trên 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-class'));
    expect(screen.queryByRole('heading', { name: 'Bạn bắt đầu từ đâu?' })).toBeNull();
  });

  it('shown once: a finished onboarding goes to /home, a valid next goes there', async () => {
    state.me = me({ onboarding_completed: true });
    await mount();
    expect(replace).toHaveBeenCalledWith('/home');
    cleanup();
    replace.mockReset();
    state.me = me();
    setSearch('?next=%2Fenroll%2Fwriting-6');
    await mount();
    expect(replace).toHaveBeenCalledWith('/enroll/writing-6');
    expect(patches).toEqual([]);
  });

  it('a failed write keeps the learner here with an error, no navigation', async () => {
    state.patchFails = true;
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ qua, vào trang chính' }));
    expect(await screen.findByText('Chưa lưu được. Thử lại.')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
