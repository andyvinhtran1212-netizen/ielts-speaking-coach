// LEARNERCORE-0063 FR-061 / FR-077 / FR-087: /progress (Tiến độ).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'A', email: 'a@x.test' } }) }));

const state = vi.hoisted(() => ({
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

const getWith = vi.fn(async (path: string) => {
  urls.push(path);
  const key = path.split('?')[0];
  if (key === '/api/me/courses') {
    if (state.courses === null) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    return state.courses;
  }
  if (state.expired.has(key)) throw Object.assign(new Error('HTTP 410'), { status: 410, detail: { error_code: 'content_expired' } });
  if (state.failing.has(key)) throw Object.assign(new Error('HTTP 500'), { status: 500 });
  if (key in DATA) return DATA[key];
  throw new Error(`unexpected ${path}`);
});
const patch = vi.fn(async (path: string, body: unknown) => {
  urls.push(path);
  patches.push(body);
  if (state.patchError) throw state.patchError;
  return {};
});

import { ProgressPage } from '@/app/(authed-v2-progress)/progress/progress-page';

async function mount() {
  render(<ProgressPage />);
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(patches).toEqual([{ target_band: 6.5, exam_date: '2027-05-02' }]);
    expect(screen.getByText('Đã lưu mục tiêu.')).toBeTruthy();
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
