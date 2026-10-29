import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InstructorDashboard } from '@/app/(authed-instructor)/instructor/instructor-dashboard';
import { InstructorCompare } from '@/app/(authed-instructor-compare)/instructor/compare/instructor-compare';
import { InstructorGrade } from '@/app/(authed-instructor-grade)/instructor/grade/instructor-grade';
import { MIX_CRITERIA } from '@/lib/instructor-compare-model.mjs';

// ADMINAAL2-0032 FR-014 (T011): an instructor suspended while a page is open
// gets the activation gate's 403 on the next call. Each of the three clients
// must replace its content with the denied state (no instructor data left),
// keep what the instructor typed, and treat other 403s as before.
let search = '';
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'inst-1' } }) }));
vi.mock('@/lib/auth-api', () => ({ getAuthorizationIdentity: async () => ({ id: 'inst-1', role: 'instructor', email: 'teacher@example.com' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

const DENIED = 'Tài khoản chưa được kích hoạt — liên hệ admin';
const inactive403 = () => Object.assign(new Error('Tài khoản chưa được kích hoạt'), { status: 403, detail: 'Tài khoản chưa được kích hoạt' });

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  search = '';
  get = vi.fn();
  post = vi.fn();
  patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch } });
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: { SECTION_KEYS: {}, SECTION_RENDERERS: {} } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const expectDenied = async () => {
  const denied = await screen.findByTestId('instructor-inactive');
  expect(denied.getAttribute('role')).toBe('alert');
  expect(within(denied).getByRole('heading').textContent).toBe(DENIED);
  expect(within(denied).getByRole('link', { name: 'Về trang học' }).getAttribute('href')).toBe('/home');
  return denied;
};

const dashboardData: Record<string, unknown> = {
  '/instructor/cohorts': [{ id: 'c1', name: 'Lớp tối T2', created_at: null }],
  '/instructor/students': [{ id: 's1', full_name: 'Nguyễn An', student_code: 'HV01', cohort_id: 'c1', user_id: 'u1' }],
  '/instructor/prompts': [],
  '/instructor/codes': [],
  '/instructor/assignments': [],
  '/instructor/reviews/queue': [],
};

it('dashboard: a mutation refused as inactive replaces the workspace and keeps the typed text', async () => {
  get.mockImplementation(async (path: string) => dashboardData[path]);
  post.mockRejectedValue(inactive403());
  render(<InstructorDashboard />);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Lớp & Mã' }));
  fireEvent.change(screen.getByLabelText('Tên lớp mới'), { target: { value: 'Lớp IELTS sáng T7' } });
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Tạo lớp' }));

  const denied = await expectDenied();
  const kept = within(denied).getByLabelText('Tên lớp mới') as HTMLTextAreaElement;
  expect(kept.value).toBe('Lớp IELTS sáng T7');
  expect(kept.readOnly).toBe(true);
  expect(screen.queryByText('Nguyễn An')).toBeNull();
  expect(screen.queryByText('Lớp tối T2')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Làm mới' })).toBeNull();
  expect(get.mock.calls.length).toBe(reads); // no canonical reload after the denial
});

it('dashboard: a refresh refused as inactive replaces the workspace; a later answer does not restore it', async () => {
  let refuse = false;
  get.mockImplementation(async (path: string) => {
    if (refuse && path === '/instructor/students') throw inactive403();
    return dashboardData[path];
  });
  render(<InstructorDashboard />);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  refuse = true;
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  const denied = await expectDenied();
  expect(within(denied).queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Nguyễn An')).toBeNull();
  expect(screen.queryByText(/đang giữ snapshot trước đó/)).toBeNull();
});

it('dashboard: an ownership 403 keeps the existing error banner and the workspace', async () => {
  get.mockImplementation(async (path: string) => dashboardData[path]);
  post.mockRejectedValue(Object.assign(new Error('Lớp không thuộc giảng viên này'), { status: 403, detail: 'Lớp không thuộc giảng viên này' }));
  render(<InstructorDashboard />);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Lớp & Mã' }));
  fireEvent.change(screen.getByLabelText('Tên lớp mới'), { target: { value: 'Lớp mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo lớp' }));
  expect(await screen.findByText(/Lớp không thuộc giảng viên này/)).toBeTruthy();
  expect(screen.queryByTestId('instructor-inactive')).toBeNull();
});

const essay = {
  id: 'essay-1', status: 'graded', task_type: 'task2', essay_text: 'Technology changes how people learn.',
  instructor_note: '', delivered_at: null, is_flagged: false,
  student: { id: 'student-1', full_name: 'Trần Bình', student_code: 'HV02', target_band: 7 },
  feedback: { version: 1, overall_band_score: 6.5, feedback_json: { mistakeAnalysis: [], criteriaFeedback: {} } },
};
const queue = [{ essay_id: 'essay-1', review: { id: 'review-1', status: 'claimed' }, student_email: 'binh@example.com', task_type: 'task2' }];

it('grade: a save refused as inactive replaces the page and keeps the unsaved note', async () => {
  search = 'essay_id=essay-1&review_id=review-1';
  get.mockImplementation(async (path: string) => {
    if (path === '/instructor/essays/essay-1') return essay;
    if (path === '/instructor/reviews/queue') return queue;
    throw new Error('versions unavailable');
  });
  patch.mockRejectedValue(inactive403());
  render(<InstructorGrade />);
  expect(await screen.findByText('Technology changes how people learn.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Nhận xét cho học viên'), { target: { value: 'Ý rõ ràng, cần thêm ví dụ.' } });
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nhận xét' }));

  const denied = await expectDenied();
  expect((within(denied).getByLabelText('Nhận xét giảng viên') as HTMLTextAreaElement).value).toBe('Ý rõ ràng, cần thêm ví dụ.');
  expect(screen.queryByText('Technology changes how people learn.')).toBeNull();
  expect(screen.queryByText('Trần Bình')).toBeNull();
  expect(screen.queryByText('Band 6.5')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Trả bài cho học viên' })).toBeNull();
  expect(get.mock.calls.length).toBe(reads);
});

it('grade: a canonical reread refused as inactive after a save shows the denied state and keeps the note', async () => {
  search = 'essay_id=essay-1&review_id=review-1';
  let refuse = false;
  get.mockImplementation(async (path: string) => {
    if (refuse) throw inactive403();
    if (path === '/instructor/essays/essay-1') return essay;
    if (path === '/instructor/reviews/queue') return queue;
    throw new Error('versions unavailable');
  });
  patch.mockImplementation(async () => { refuse = true; return { ok: true }; });
  render(<InstructorGrade />);
  fireEvent.change(await screen.findByLabelText('Nhận xét cho học viên'), { target: { value: 'Đã xem' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nhận xét' }));
  const denied = await expectDenied();
  expect((within(denied).getByLabelText('Nhận xét giảng viên') as HTMLTextAreaElement).value).toBe('Đã xem');
  expect(screen.queryByText('Trần Bình')).toBeNull();
});

const criteria = (version: number, band: number) => Object.fromEntries(MIX_CRITERIA.map((key: string) => [key, { bandScore: band, feedback: `${key}-v${version}`, explanation: '' }]));
const versions = {
  versions: [2, 1].map((version) => ({
    version, source: 'ai_pro', overall_band_score: 5 + version, created_at: `2026-10-2${version}T00:00:00Z`,
    feedback_json: {
      overallBandScore: 5 + version, overallBandScoreSummary: `summary-v${version}`,
      keyTakeaways: { strengths: [], areasForImprovement: [] }, criteriaFeedback: criteria(version, 5 + version),
      mistakeAnalysis: [], improvedEssay: `essay-v${version}`,
    },
  })),
  budget: { live_count: 2, max: 3, can_compose: true },
};

it('compare: a compose refused as inactive replaces the page with the denied state', async () => {
  search = 'essay_id=essay-1';
  get.mockResolvedValue(versions);
  post.mockRejectedValue(inactive403());
  render(<InstructorCompare />);
  const commit = await screen.findByRole('button', { name: 'Tạo bản ghép và đặt hiện hành' });
  expect(screen.getAllByText(/-v2$/).length).toBeGreaterThan(0);
  fireEvent.click(commit);
  await expectDenied();
  expect(screen.queryByText(/-v2$/)).toBeNull();
  expect(screen.queryByText(/Band 7/)).toBeNull();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
});

it('compare: an inactive 403 on load shows the denied state, not the generic load error', async () => {
  search = 'essay_id=essay-1';
  get.mockRejectedValue(inactive403());
  render(<InstructorCompare />);
  await expectDenied();
  expect(screen.queryByText('Không tải được phiên bản')).toBeNull();
});
