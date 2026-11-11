import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminExerciseBook, draftProblem } from '@/components/exercise-book/admin-exercise-book';
import { AdminExerciseBookGrants } from '@/components/exercise-book/admin-exercise-book-grants';
import { ExerciseBookAdminEntry } from '@/components/exercise-book/exercise-book-entry';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';
import { ExerciseBookError, type ExerciseBookApi } from '@/lib/exercise-book/contract';
import { MOCK_IDS, createMockExerciseBookApi, type MockOptions } from '@/lib/exercise-book/mock-api';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: '00000000-0000-4000-8000-000000000070' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

const COHORT = MOCK_IDS.cohort;
const NOW = new Date('2026-11-12T09:00:00+07:00');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function spyApi(options: MockOptions = {}) {
  const base = createMockExerciseBookApi({ now: () => NOW, ...options });
  const api = Object.fromEntries(Object.entries(base).map(([key, fn]) => [key, vi.fn(fn as never)])) as unknown as ExerciseBookApi & Record<keyof ExerciseBookApi, ReturnType<typeof vi.fn>>;
  return { api, base };
}

function renderWith(api: ExerciseBookApi, ui: React.ReactElement) {
  return render(<ExerciseBookApiProvider api={api}>{ui}</ExerciseBookApiProvider>);
}

beforeEach(() => {
  auth.user.id = MOCK_IDS.owner_actor;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openAssignForm() {
  return screen.findByRole('heading', { name: 'Giao sách bài tập · U1' });
}

function pick(labels: (string | RegExp)[]) {
  for (const label of labels) fireEvent.click(screen.getByLabelText(label));
}

describe('admin catalog and assignment', () => {
  it('shows A08/A14/A19 disabled with screen-reader reasons (QA G10)', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    await openAssignForm();
    for (const [id, reason] of [['A08', 'Audio tải chưa hoàn tất'], ['A14', 'Chưa có audio'], ['A19', 'Chờ kiểm tra lựa chọn gốc']]) {
      const box = screen.getByLabelText(new RegExp(`^${id} ·`)) as HTMLInputElement;
      expect(box.disabled).toBe(true);
      expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toContain(reason);
    }
    expect((screen.getByLabelText(/^A01 ·/) as HTMLInputElement).disabled).toBe(false);
  });

  it('lists recipients by name with select-all, and never renders ids or answer_set_revision (QA G07)', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    await openAssignForm();
    expect(screen.getByLabelText('Học viên Giả An')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn cả lớp' }));
    expect(screen.getByText('Học viên nhận bài (3/3)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(screen.getByText('Học viên nhận bài (0/3)')).toBeTruthy();
    const text = document.body.textContent || '';
    expect(text).not.toMatch(UUID);
    expect(document.body.innerHTML).not.toContain('answer_set_revision');
    expect(document.body.innerHTML).not.toContain('00000000-0000-4000-8000-000000000201');
  });

  it('confirms names, sends catalog order with a VN deadline, then refetches the canonical list', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    await openAssignForm();
    pick([/^A03 ·/, /^A01 ·/, 'Học viên Giả An', 'Học viên Giả Chi']);
    fireEvent.change(screen.getByLabelText(/Hạn nộp \(giờ Việt Nam\)/), { target: { value: '2026-11-20T21:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại và giao bài' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 học viên: Học viên Giả An, Học viên Giả Chi')).toBeTruthy();
    expect(within(dialog).getByText('Hạn nộp: 21:30 20/11/2026 (giờ VN)')).toBeTruthy();
    expect(api.createAssignment).not.toHaveBeenCalled();
    const listCalls = api.listAssignments.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giao bài' }));
    expect(await screen.findByText('Đã giao bài. Biên nhận và tiến độ ở bên dưới.')).toBeTruthy();
    const body = api.createAssignment.mock.calls[0][1];
    expect(body.activities.map((entry: { activity_id: string }) => entry.activity_id)).toEqual(['U1-A01', 'U1-A03']);
    expect(body.recipient_ids).toEqual([MOCK_IDS.learner, '00000000-0000-4000-8000-000000000013']);
    expect(body.due_at).toBe('2026-11-20T21:30:00+07:00');
    expect(body.deadline_timezone).toBe('Asia/Ho_Chi_Minh');
    expect(api.listAssignments.mock.calls.length).toBeGreaterThan(listCalls);
    expect(await screen.findByText('Black Eye · Unit 1 · A01, A03')).toBeTruthy();
    expect(await screen.findByText('Mẫu số hoàn thành')).toBeTruthy();
  });

  it('keeps the request_id across a lost ACK and renews it when the draft changes (contract §2)', async () => {
    const { api, base } = spyApi();
    let lose = true;
    api.createAssignment.mockImplementation(async (cohortId: string, body: never) => {
      const receipt = await base.createAssignment(cohortId, body);
      if (lose) { lose = false; throw new ExerciseBookError(0, 'network'); }
      return receipt;
    });
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    await openAssignForm();
    pick([/^A01 ·/, 'Học viên Giả An']);
    fireEvent.change(screen.getByLabelText(/Hạn nộp \(giờ Việt Nam\)/), { target: { value: '2026-11-20T21:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại và giao bài' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giao bài' }));
    expect(await within(dialog).findByText(/gửi lại cùng mã yêu cầu/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giao bài' }));
    expect(await screen.findByText('Đã giao bài. Biên nhận và tiến độ ở bên dưới.')).toBeTruthy();
    const [first, second] = api.createAssignment.mock.calls.map(([, body]) => body.request_id);
    expect(second).toBe(first);
    // The replay returned the stored receipt: exactly one new row in the list.
    expect(screen.getAllByText('Black Eye · Unit 1 · A01')).toHaveLength(1);
  });

  it('client checks block an empty, past or too-far deadline before any POST', () => {
    const now = NOW.getTime();
    expect(draftProblem({ activityIds: [], recipientIds: ['a'], dueLocal: '2026-11-20T21:30' }, now)).toMatch(/activity/);
    expect(draftProblem({ activityIds: ['a'], recipientIds: [], dueLocal: '2026-11-20T21:30' }, now)).toMatch(/học viên/);
    expect(draftProblem({ activityIds: ['a'], recipientIds: ['b'], dueLocal: '' }, now)).toBe('Chọn hạn nộp.');
    expect(draftProblem({ activityIds: ['a'], recipientIds: ['b'], dueLocal: '2026-11-11T08:00' }, now)).toBe('Hạn nộp phải ở tương lai.');
    expect(draftProblem({ activityIds: ['a'], recipientIds: ['b'], dueLocal: '2027-06-01T08:00' }, now)).toMatch(/180 ngày/);
    expect(draftProblem({ activityIds: Array.from({ length: 17 }, (_, i) => `${i}`), recipientIds: Array.from({ length: 501 }, (_, i) => `${i}`), dueLocal: '2026-11-20T21:30' }, now)).toMatch(/500/);
  });

  it('a recipient lookup error is visible and blocks assignment', async () => {
    const { api, base } = spyApi();
    api.getCatalog.mockImplementation(async (id: string) => ({ ...(await base.getCatalog(id)), lookup_errors: ['recipient_lookup_failed'] }));
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không tra cứu được danh sách học viên');
    expect((screen.getByRole('button', { name: 'Xem lại và giao bài' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['forbidden', 'Bạn chưa được cấp quyền giao sách bài tập cho lớp này.'],
    ['not_found', 'Lớp này chưa có sách bài tập, hoặc bạn không có quyền xem.'],
    ['unavailable', 'Tính năng sách bài tập chưa sẵn sàng trên hệ thống.'],
  ] as const)('catalog %s shows a fixed gate message and no form', async (code, text) => {
    const { api } = spyApi({ fail: (method) => (method === 'getCatalog' ? code : undefined) });
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(screen.queryByRole('button', { name: 'Xem lại và giao bài' })).toBeNull();
  });
});

describe('admin progress, review and archive', () => {
  async function openProgress(api: ExerciseBookApi) {
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    const row = (await screen.findByText('Black Eye · Unit 1 · A01–A07')).closest('tr')!;
    expect(within(row).getByText('Đang mở')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Xem tiến độ' }));
    return screen.findByRole('region', { name: 'Ma trận tiến độ học viên × activity' });
  }

  it('survives reload: the list comes from the server, not component state (QA G06)', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBook cohortId={COHORT} />);
    expect(await screen.findByText('Black Eye · Unit 1 · A01–A07')).toBeTruthy();
    expect(screen.getByText('Black Eye · Unit 1 · thử A01–A02')).toBeTruthy();
    expect(screen.getByText('Đã đóng')).toBeTruthy();
  });

  it('renders the student × activity matrix with names, all five statuses, completion and dictation', async () => {
    const { api } = spyApi();
    const matrix = await openProgress(api);
    const rows = within(matrix).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(
      ['Học viên', 'Hoàn thành', 'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'Chính tả']);
    expect(within(rows[1]).getByRole('rowheader').textContent).toBe('Học viên Giả An');
    expect(within(rows[1]).getByText('3/7')).toBeTruthy();
    for (const label of ['Chưa bắt đầu', 'Đang làm', 'Đã nộp', 'Quá hạn', 'Không khả dụng']) expect(within(matrix).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(matrix).getAllByText('Chưa mở (phát hành riêng)')).toHaveLength(3);
    expect(within(rows[1]).getByText('08:15 12/11/2026 (giờ VN)')).toBeTruthy();
    expect(matrix.textContent).not.toMatch(UUID);
    expect(screen.getByText(/7 activity \(không tính activity khóa\)/)).toBeTruthy();
  });

  it('opens the teacher review of one activity with the runner labels', async () => {
    const { api } = spyApi();
    await openProgress(api);
    fireEvent.click(screen.getByRole('button', { name: 'Xem chữa bài U1-A01 của Học viên Giả An' }));
    expect(await screen.findByText('Câu 01 · table · r1 · c2 · Tự đối chiếu')).toBeTruthy();
    expect(api.getTeacherReview).toHaveBeenCalledWith(COHORT, MOCK_IDS.assignment, MOCK_IDS.learner_item, 'U1-A01');
    expect(screen.getByRole('heading', { name: 'Chữa bài · U1-A01' })).toBeTruthy();
  });

  it('archives only with a reason and refetches the receipt (QA G08)', async () => {
    const { api } = spyApi();
    await openProgress(api);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng bài giao' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng bài giao' }));
    expect(within(dialog).getByText('Nhập lý do đóng bài (1–500 ký tự).')).toBeTruthy();
    expect(api.archiveAssignment).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Kết thúc đợt thử.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng bài giao' }));
    expect(await screen.findByText('Đã đóng bài giao. Bài đã nộp vẫn được giữ.')).toBeTruthy();
    expect(api.archiveAssignment.mock.calls[0][2]).toEqual({ status: 'archived', reason: 'Kết thúc đợt thử.' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đóng bài giao' })).toBeNull());
    expect(api.getAssignment.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('course-2 grant page (UI gate only)', () => {
  it('empty state', async () => {
    const { api } = spyApi({ grants: 'empty' });
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    expect(await screen.findByText('Chưa cấp quyền cho ai trong lớp này.')).toBeTruthy();
    expect(await screen.findByText('Nhật ký chưa có sự kiện nào.')).toBeTruthy();
  });

  it('lists granted and revoked staff and the 377 log in Vietnam time', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    const granted = (await screen.findByText('Giáo viên Giả Dung')).closest('tr')!;
    expect(within(granted).getByText('Đang có quyền')).toBeTruthy();
    expect(within(granted).getByText('#3 · 15:20 11/11/2026 (giờ VN)')).toBeTruthy();
    const revoked = screen.getByText('Giáo viên Giả Giang').closest('tr')!;
    expect(within(revoked).getByText('Đã thu quyền')).toBeTruthy();
    expect(await screen.findByText(/#1 · Cấp quyền “Xem và chữa bài”/)).toBeTruthy();
    expect(screen.getAllByText(/bởi bạn/)).toHaveLength(3);
  });

  it('revokes with a reason, keeps request_id on a lost ACK and refetches grants and log', async () => {
    const { api, base } = spyApi();
    let lose = true;
    api.recordGrant.mockImplementation(async (cohortId: string, body: never) => {
      const ack = await base.recordGrant(cohortId, body);
      if (lose) { lose = false; throw new ExerciseBookError(0, 'network'); }
      return ack;
    });
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    const row = (await screen.findByText('Giáo viên Giả Dung')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Thu quyền' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(within(dialog).getByText('Nhập lý do (1–1000 ký tự).')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Hết đợt giao bài.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await within(dialog).findByText(/gửi lại cùng mã yêu cầu/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Thu quyền “Giao bài” đã được ghi vào nhật ký.')).toBeTruthy();
    const [first, second] = api.recordGrant.mock.calls.map(([, body]) => body);
    expect(second.request_id).toBe(first.request_id);
    expect(first).toMatchObject({ grantee_id: '00000000-0000-4000-8000-000000000071', role: 'assigner', action: 'revoke', reason: 'Hết đợt giao bài.' });
    await waitFor(() => expect(within(screen.getByText('Giáo viên Giả Dung').closest('tr')!).getByText('Đã thu quyền')).toBeTruthy());
    expect(await screen.findByText(/#4 · Thu quyền “Giao bài”/)).toBeTruthy();
  });

  it('a new grant needs a staff UUID and refuses self-grant before any POST', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    const form = await screen.findByRole('form', { name: 'Cấp quyền mới' });
    fireEvent.change(within(form).getByLabelText(/Mã tài khoản nhân sự/), { target: { value: 'not-a-uuid' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tiếp tục' }));
    expect(within(form).getByText('Nhập đúng mã tài khoản (UUID) của nhân sự.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Mã tài khoản nhân sự/), { target: { value: MOCK_IDS.owner_actor } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tiếp tục' }));
    expect(within(form).getByText('Không tự cấp quyền cho chính mình.')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Mã tài khoản nhân sự/), { target: { value: '00000000-0000-4000-8000-000000000073' } });
    fireEvent.change(within(form).getByLabelText('Quyền'), { target: { value: 'teacher' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tiếp tục' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Chấm bài lớp giả.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Cấp quyền “Xem và chữa bài” đã được ghi vào nhật ký.')).toBeTruthy();
    expect(api.recordGrant).toHaveBeenCalledTimes(1);
  });

  it('a repeat of the current state (409) refetches and says so', async () => {
    const { api } = spyApi({ fail: (method) => (method === 'recordGrant' ? 'conflict' : undefined) });
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    const row = (await screen.findByText('Giáo viên Giả Dung')).closest('tr')!;
    const before = api.getGrants.mock.calls.length;
    fireEvent.click(within(row).getByRole('button', { name: 'Thu quyền' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Lý do' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect((await screen.findByRole('alert')).textContent).toContain('đã ở đúng trạng thái');
    expect(api.getGrants.mock.calls.length).toBeGreaterThan(before);
  });

  it('step_up_required on write keeps the dialog with the MFA message', async () => {
    const { api } = spyApi({ fail: (method) => (method === 'recordGrant' ? 'step_up_required' : undefined) });
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    const row = (await screen.findByText('Giáo viên Giả Dung')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Thu quyền' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Lý do' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await within(dialog).findByText(/Cần xác thực lại bằng mã MFA/)).toBeTruthy();
  });

  it('any other account gets the gate message and no controls (403 not_owner)', async () => {
    auth.user.id = '00000000-0000-4000-8000-000000000071';
    const { api } = spyApi({ actorId: '00000000-0000-4000-8000-000000000071' });
    renderWith(api, <AdminExerciseBookGrants cohortId={COHORT} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Chỉ tài khoản được ủy quyền cho course 2');
    expect(screen.queryByRole('form', { name: 'Cấp quyền mới' })).toBeNull();
    expect(api.getGrantLog).not.toHaveBeenCalled();
  });

  it('a class outside course 2 (404) gets its own message', async () => {
    const { api } = spyApi();
    renderWith(api, <AdminExerciseBookGrants cohortId="00000000-0000-4000-8000-000000000099" />);
    expect((await screen.findByRole('alert')).textContent).toContain('chỉ dùng cho lớp thuộc course 2');
  });
});

describe('admin entry links', () => {
  it('shows each link only when its read route answered 200 (CR F16, contract §6)', async () => {
    const owner = spyApi();
    render(<ExerciseBookAdminEntry cohortId={COHORT} api={owner.api} />);
    expect(await screen.findByRole('link', { name: 'Sách bài tập Listening' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Quyền sách bài tập' }).getAttribute('href')).toBe(`/admin/classes/${COHORT}/exercise-book/grants`);
    cleanup();
    const assigner = spyApi({ actorId: '00000000-0000-4000-8000-000000000071' });
    render(<ExerciseBookAdminEntry cohortId={COHORT} api={assigner.api} />);
    expect(await screen.findByRole('link', { name: 'Sách bài tập Listening' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Quyền sách bài tập' })).toBeNull();
    cleanup();
    const none = spyApi({ fail: () => 'unavailable' });
    const { container } = render(<ExerciseBookAdminEntry cohortId={COHORT} api={none.api} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});
