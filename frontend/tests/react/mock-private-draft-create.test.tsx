import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ExamCreateForm } from '@/app/(authed-admin-mock-exams)/admin/mock-exams/exam-create-form';

beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, value: {
    get: vi.fn(async (url: string) => {
      const kind = new URL(url, 'http://localhost').searchParams.get('kind');
      return { items: [{ id: kind, title: `Source ${kind}`, is_public: true }], total: 1 };
    }),
  } });
});
afterEach(cleanup);

it('creates private copies even when both selected source papers are public', async () => {
  const onCreate = vi.fn(async (_payload: Record<string, unknown>) => true);
  render(<ExamCreateForm cohorts={[{ id: 'class-1', name: 'Class' }]} disabled={false} onCreate={onCreate} onError={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu đề nháp' }).hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByLabelText('Mã đề *'), { target: { value: 'CLASS-MOCK' } });
  fireEvent.change(screen.getByLabelText('Tiêu đề *'), { target: { value: 'Class mock' } });
  fireEvent.change(screen.getByLabelText('Lớp *'), { target: { value: 'class-1' } });
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'reading' } });
  fireEvent.change(screen.getByLabelText('Listening'), { target: { value: 'listening' } });
  expect(screen.queryByLabelText('Hiện đề Reading công khai')).toBeNull();
  expect(screen.getAllByText('Đề nguồn đang công khai; học viên có thể đã xem đề trước khi ẩn.')).toHaveLength(2);
  expect(screen.getByRole('combobox', { name: /^Web explanation/ })).toHaveProperty('value', 'disabled');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu đề nháp' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  expect(onCreate.mock.calls[0][0]).toMatchObject({
    code: 'CLASS-MOCK', reading_test_id: 'reading', listening_test_id: 'listening',
    private_content_copy: true, reading_is_public: false, listening_is_public: false,
    web_explanation_mode: 'disabled', cohort_id: 'class-1',
  });
  await waitFor(() => expect(screen.getByLabelText('Mã đề *')).toHaveProperty('value', ''));
});

it('retains the draft fields on a rejected save', async () => {
  const onCreate = vi.fn(async (_payload: Record<string, unknown>) => false);
  render(<ExamCreateForm cohorts={[]} disabled={false} onCreate={onCreate} onError={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu đề nháp' }).hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByLabelText('Mã đề *'), { target: { value: 'RETRY' } });
  fireEvent.change(screen.getByLabelText('Tiêu đề *'), { target: { value: 'Retry mock' } });
  fireEvent.change(screen.getByLabelText('Hình thức giao'), { target: { value: 'retake' } });
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'reading' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu đề nháp' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Mã đề *')).toHaveProperty('value', 'RETRY');
  expect(screen.getByLabelText('Reading')).toHaveProperty('value', 'reading');
});
