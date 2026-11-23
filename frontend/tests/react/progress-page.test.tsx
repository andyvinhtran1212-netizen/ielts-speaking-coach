// LEARNERCORE-0063 FR-061 / FR-077 / FR-087: /progress (Tiến độ).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => state.auth }));

const state = vi.hoisted(() => ({
  auth: { status: 'signed-in', user: { id: 'A', email: 'a@x.test' } } as { status: string; user: { id: string; email: string } | null },
  profile: {} as Record<string, unknown>,
  profileFails: false,
  me: { status: 'ready', me: { id: 'A', target_band: 6.5, exam_date: '2027-03-20' } } as any,
  failing: new Set<string>(),
  expired: new Set<string>(),
  patchError: null as unknown,
  courses: null as unknown,
}));
vi.mock('@/components/learner/learner-frame', () => ({ useLearnerMe: () => state.me }));

const urls: string[] = [];
const patches: unknown[] = [];
const DATA: Record<string, unknown> = {
  '/sessions': { sessions: [{ id: 's1', status: 'completed', overall_band: 6 }, { id: 's2', status: 'completed', overall_band: 5.5 }], total: 12, page: 1, page_size: 5, total_pages: 3 },
  '/api/writing/my-essays': { essays: [
    { id: 'e2', status: 'grading', overall_band_score: null },
    { id: 'e1', status: 'delivered', overall_band_score: 6.5 },
  ] },
  '/api/listening/overview': { programmes: [{ completed_form_count: 3 }, { completed_form_count: 2 }], recent: [{ checked_count: 10, correct_count: 7 }] },
  '/api/quiz/progress': { banks: [], recent_sessions: [{ total_questions: 20, total_correct: 18 }], totals: { sessions: 9 } },
};

const PROFILE = (over: object = {}) => ({
  id: 'A', email: 'a@x.test', display_name: 'Minh Anh', avatar_url: null, role: 'student', is_active: true,
  target_band: 6.5, exam_date: '2027-03-20', self_level: null, preferred_topics: [], onboarding_completed: true,
  timezone: 'Asia/Ho_Chi_Minh', weekly_goal: 4, notification_email: false, joined_at: '2026-01-01T00:00:00Z',
  stats: { total_sessions: 3, avg_band: null, joined_at: '2026-01-01T00:00:00Z' }, ...over,
});
const getWithImpl = async (path: string) => {
  urls.push(path);
  const key = path.split('?')[0];
  if (key === '/auth/profile') {
    if (state.profileFails) throw Object.assign(new Error('HTTP 500'), { status: 500 });
    return state.profile;
  }
  if (key === '/api/me/courses') {
    if (state.courses === null) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    return state.courses;
  }
  if (state.expired.has(key)) throw Object.assign(new Error('HTTP 410'), { status: 410, detail: { error_code: 'content_expired' } });
  if (state.failing.has(key)) throw Object.assign(new Error('HTTP 500'), { status: 500 });
  if (key in DATA) return DATA[key];
  throw new Error(`unexpected ${path}`);
};
const getWith = vi.fn(getWithImpl);
const patch = vi.fn(async (path: string, body: unknown) => {
  urls.push(path);
  patches.push(body);
  if (state.patchError) throw state.patchError;
  // Like update_profile(): null fields are ignored.
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (v !== null) state.profile[k] = v;
  return {};
});

import { ProgressPage } from '@/app/(authed-v2-progress)/progress/progress-page';

async function mount() {
  render(<ProgressPage />);
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  getWith.mockImplementation(getWithImpl);
  state.auth = { status: 'signed-in', user: { id: 'A', email: 'a@x.test' } };
  state.profile = PROFILE();
  state.profileFails = false;
  state.me = { status: 'ready', me: { id: 'A', target_band: 6.5, exam_date: '2027-03-20' } };
  state.failing = new Set();
  state.expired = new Set();
  state.patchError = null;
  state.courses = null;
  urls.length = 0;
  patches.length = 0;
  (window as any).api = { getWith, patch, get: getWith };
});
afterEach(() => { cleanup(); delete (window as any).api; });

describe('/progress', () => {
  it('one row per skill from the existing APIs, results under FR-077', async () => {
    await mount();
    expect(screen.getByText('12 buổi đã chấm')).toBeTruthy();
    expect(screen.getByText('Gần nhất: Band 6.0')).toBeTruthy();
    expect(screen.getByText('2 bài đã nộp')).toBeTruthy();
    expect(screen.getByText('Gần nhất: Band 6.5 · 1 bài đang chấm')).toBeTruthy();
    expect(screen.getByText('5 bài trong lộ trình nghe')).toBeTruthy();
    expect(screen.getByText('Gần nhất: Đúng 7 trên 10 câu')).toBeTruthy();
    expect(screen.getByText('9 lượt luyện')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reading' })).toBeTruthy();
    expect(urls).toContain('/sessions?status=completed&page=1&page_size=5');
    expect(urls).toContain('/api/quiz/progress?skill_area=vocab');
    expect(document.body.textContent).not.toMatch(/0\/0|—/);
  });

  it('one failing source marks only its own row', async () => {
    state.failing = new Set(['/api/writing/my-essays']);
    await mount();
    expect(screen.getByText('Chưa tải được số liệu Writing. Tải lại trang để thử lại.')).toBeTruthy();
    expect(screen.getByText('12 buổi đã chấm')).toBeTruthy();
    expect(screen.getByText('5 bài trong lộ trình nghe')).toBeTruthy();
  });

  it('Listening partial read with no programme marks the row as failed, not "nothing done"', async () => {
    const saved = DATA['/api/listening/overview'];
    DATA['/api/listening/overview'] = { programmes: [], recent: [], partial_data: true };
    try {
      await mount();
      expect(screen.getByText('Chưa tải được số liệu Listening. Tải lại trang để thử lại.')).toBeTruthy();
      expect(screen.queryByText(/Chưa làm bài nào/)).toBeNull();
    } finally {
      DATA['/api/listening/overview'] = saved;
    }
  });

  it('Listening partial read with programmes still shows the numbers plus a warning', async () => {
    const saved = DATA['/api/listening/overview'];
    DATA['/api/listening/overview'] = { programmes: [{ completed_form_count: 2 }], recent: [], partial_data: true };
    try {
      await mount();
      expect(screen.getByText('2 bài trong lộ trình nghe')).toBeTruthy();
      expect(screen.getByText('Một phần số liệu Listening chưa tải được, số trên có thể thiếu.')).toBeTruthy();
    } finally {
      DATA['/api/listening/overview'] = saved;
    }
  });

  it('410 content_expired on a row says the view period is over, no error code', async () => {
    state.expired = new Set(['/sessions']);
    await mount();
    expect(screen.getByText('Bài này đã hết thời hạn xem.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('content_expired');
  });

  it('goal band and exam date are prefilled and saved through PATCH /auth/profile', async () => {
    await mount();
    expect((screen.getByLabelText('Ngày thi dự kiến') as HTMLInputElement).value).toBe('2027-03-20');
    fireEvent.change(screen.getByLabelText('Ngày thi dự kiến'), { target: { value: '2027-05-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mục tiêu' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(patches).toEqual([{ target_band: 6.5, exam_date: '2027-05-02' }]);
    expect(urls.filter((u) => u === '/auth/profile')).toHaveLength(2); // PATCH, then the canonical read
    expect(screen.getByText('Đã lưu mục tiêu.')).toBeTruthy();
  });

  it('emptying a saved date sends no null, shows the date the server kept, and says so', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Ngày thi dự kiến'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mục tiêu' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(patches).toEqual([{ target_band: 6.5 }]);
    expect((screen.getByLabelText('Ngày thi dự kiến') as HTMLInputElement).value).toBe('2027-03-20');
    expect(screen.getByText('Mục tiêu đã lưu không bỏ trống được. Bạn có thể đổi sang band hoặc ngày khác.')).toBeTruthy();
    expect(screen.queryByText('Đã lưu mục tiêu.')).toBeNull();
  });

  it('saved but the reload failed: says it saved, never "Chưa lưu được"', async () => {
    state.profileFails = true;
    await mount();
    fireEvent.change(screen.getByLabelText('Ngày thi dự kiến'), { target: { value: '2027-05-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mục tiêu' }));
    await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Đã lưu, nhưng chưa tải lại được mục tiêu. Tải lại trang để xem.')).toBeTruthy();
    expect(screen.queryByText('Chưa lưu được mục tiêu. Thử lại.')).toBeNull();
  });

  it('a session change drops the previous account\'s rows in the same render; signed out → /login', async () => {
    const view = render(<ProgressPage />);
    await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('12 buổi đã chấm')).toBeTruthy();
    expect(screen.getByLabelText('Ngày thi dự kiến')).toBeTruthy();
    const replace = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
    getWith.mockImplementation(async (path: string) => { urls.push(path); return new Promise(() => {}); });
    state.auth = { status: 'signed-in', user: { id: 'B', email: 'b@x.test' } };
    view.rerender(<ProgressPage />);
    // Same render, before B's requests return: nothing of A is left.
    expect(screen.queryByText('12 buổi đã chấm')).toBeNull();
    expect(screen.queryByLabelText('Ngày thi dự kiến')).toBeNull();
    state.auth = { status: 'signed-out', user: null };
    view.rerender(<ProgressPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('12 buổi đã chấm')).toBeNull();
  });


  it('profile_update off (503 feature_disabled) → the two fields turn read-only with a sentence', async () => {
    state.patchError = Object.assign(new Error('HTTP 503'), { status: 503, detail: { error_code: 'feature_disabled', flag: 'profile_update' } });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mục tiêu' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Tạm khoá sửa mục tiêu để bảo trì. Bạn vẫn xem được mục tiêu đã lưu.')).toBeTruthy();
    expect(screen.queryByLabelText('Ngày thi dự kiến')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu mục tiêu' })).toBeNull();
    expect(screen.getByText('6.5')).toBeTruthy();
    expect(screen.getByText('20/03/2027')).toBeTruthy();
  });

  it('another save failure keeps the form with a retry message', async () => {
    state.patchError = Object.assign(new Error('HTTP 500'), { status: 500 });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu mục tiêu' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Chưa lưu được mục tiêu. Thử lại.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu mục tiêu' })).toBeTruthy();
  });

  it('content_visible_until from G04 → the cut-off line; G04 missing → none', async () => {
    state.courses = { items: [], credits: { total: 0, by_kind: {} }, content_visible_until: '2027-01-14T16:59:59Z', content_days_after_expiry: 45 };
    await mount();
    expect(screen.getByText('Bài đã nộp và nhận xét xem được đến hết 14/01/2027.')).toBeTruthy();
    cleanup();
    state.courses = null;
    await mount();
    expect(screen.queryByText(/xem được đến hết/)).toBeNull();
  });
});
