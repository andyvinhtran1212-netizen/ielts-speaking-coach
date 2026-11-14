import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AdminClassHomework } from '@/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework';
import { ResultView } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/components/exercise-book/exercise-book-entry', () => ({ ExerciseBookAdminEntry: () => null }));
afterEach(cleanup);

beforeEach(() => {
  Object.assign(window, { api: {
    get: vi.fn(async (path: string) => {
      if (path.endsWith('/assignments')) return { assignments: [] };
      if (path.includes('speaking-topics')) return { items: [] };
      if (path === '/admin/exam-content?kind=listening') return { items: [{
        id: 'exam', title: 'Synthetic hidden paper', status: 'published', is_public: false,
        cohort_ids: ['cohort'], ready: true,
      }] };
      throw new Error(`Unexpected GET ${path}`);
    }),
    post: vi.fn(async () => ({ student_count: 1, unactivated_count: 0 })),
  } });
});

it.each(['none', 'optional', 'required'] as const)('submits %s from the served exam assignment radios', async (mode) => {
  render(<AdminClassHomework cohortId="cohort" members={[]} refreshKey={0} onMutation={vi.fn()} />);
  await screen.findByText('Chưa giao bài nào');
  fireEvent.click(screen.getByRole('button', { name: 'Giao bài lớp' }));
  fireEvent.change(screen.getByLabelText('Kỹ năng'), { target: { value: 'listening' } });
  await screen.findByRole('option', { name: /Synthetic hidden paper/ });
  expect(screen.queryByRole('radio', { name: 'Không giao', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: /Chỉ học viên được giao/ }));
  expect((screen.getByRole('radio', { name: 'Không giao', exact: true }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('Đề'), { target: { value: 'exam' } });
  fireEvent.change(screen.getByLabelText('Tên bài giao'), { target: { value: 'Synthetic assignment' } });
  fireEvent.click(screen.getByRole('radio', { name: { none: 'Không giao', optional: 'Tùy chọn', required: 'Bắt buộc' }[mode], exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Giao cho cả lớp' }));
  await waitFor(() => expect(window.api.post).toHaveBeenCalledTimes(1));
  const [path, body] = vi.mocked(window.api.post).mock.calls[0] as [string, any];
  expect(path).toBe('/admin/cohorts/cohort/assignments');
  expect(body.dictation_mode).toBe(mode);
  expect(body.delivery_mode).toBe('assigned_practice');
  expect(body.listening_skill_drill).toBeUndefined();
  expect(body.dictation_required).toBeUndefined();
});

it.each(['optional', 'required'] as const)('result link keeps class_item for %s exam dictation', (mode) => {
  render(<ResultView result={{ score: 1, max_score: 1 }} attempt={null} from={null} sittingId={null}
    test={{ id: 'exam', title: 'Synthetic exam', test_type: 'full', skill_drill_homework: {
      dictation_required: mode === 'required', sections: [1],
    } }} classItem="item & one" />);
  const link = screen.getByRole('link', { name: mode === 'required' ? 'Làm phần chép chính tả bắt buộc' : 'Chép chính tả (tùy chọn)' });
  const url = new URL(link.getAttribute('href')!, 'https://example.test');
  expect(url.pathname).toBe('/core-player/launch');
  expect(url.searchParams.get('class_item')).toBe('item & one');
  expect(url.searchParams.get('test_id')).toBe('exam');
  expect(url.searchParams.get('surface')).toBe('listening_dictation');
});

it('hides dictation for an assigned exam in none mode and preserves public practice', () => {
  const props = { result: {}, attempt: null, test: { id: 'exam', title: 'Synthetic exam' }, from: null, sittingId: null };
  const view = render(<ResultView {...props} classItem="item" />);
  expect(screen.queryByRole('link', { name: /dictation|chép chính tả/i })).toBeNull();
  view.rerender(<ResultView {...props} />);
  expect(screen.getByRole('link', { name: 'Dictation practice' }).getAttribute('href')).toBe('/core-player/launch?surface=listening_dictation&test_id=exam');
});

it.each(['optional', 'required'] as const)('keeps self-check results neutral alongside the %s assigned dictation link', (mode) => {
  const props = { attempt: null, from: null, sittingId: null, classItem: 'item', test: {
    id: 'exam', title: 'Synthetic mixed paper', skill_drill_homework: {
      dictation_required: mode === 'required', sections: [1],
    },
  } };
  const selfCheck = { q_num: 1, self_check: true, correct: null, user_answer: 'my response' };
  const view = render(<ResultView {...props} result={{ score: 1, per_question: [selfCheck,
    { q_num: 2, correct: true, user_answer: 'correct response' }] }} />);
  const overview = screen.getByRole('region', { name: 'Results overview' });
  expect(overview.textContent).toContain('Correct1/1');
  expect(overview.textContent).toContain('Accuracy100%');
  expect(screen.getByLabelText('Question 1: Tự đối chiếu').className).toBe('');
  const linkName = mode === 'required' ? 'Làm phần chép chính tả bắt buộc' : 'Chép chính tả (tùy chọn)';
  expect(new URL(screen.getByRole('link', { name: linkName }).getAttribute('href')!, 'https://example.test')
    .searchParams.get('class_item')).toBe('item');

  view.rerender(<ResultView {...props} result={{ score: 0, max_score: 0, band_estimate: null, per_question: [selfCheck] }} />);
  expect(overview.textContent).toContain('Correct0/0');
  expect(within(overview).getAllByText('—')).toHaveLength(2);
  expect(overview.textContent).toContain('Incorrect0Unanswered0');
  expect(screen.getByRole('link', { name: linkName })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Dictation practice' })).toBeNull();
});
