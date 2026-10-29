import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ExamCreateForm, PUBLIC_SOURCE_HIDE_WARNING } from '@/app/(authed-admin-mock-exams)/admin/mock-exams/exam-create-form';

// Picker rows: `pub-*` sources are public, `priv-*` sources are already hidden.
beforeEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, value: {
    get: vi.fn(async (url: string) => {
      const kind = new URL(url, 'http://localhost').searchParams.get('kind');
      return { items: [
        { id: `pub-${kind}`, title: `Public ${kind}`, is_public: true },
        { id: `priv-${kind}`, title: `Private ${kind}`, is_public: false },
      ], total: 2 };
    }),
  } });
});
afterEach(cleanup);

async function renderForm(onCreate: (payload: Record<string, unknown>) => Promise<boolean> = vi.fn(async () => true)) {
  render(<ExamCreateForm cohorts={[]} disabled={false} onCreate={onCreate} onError={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu đề nháp' }).hasAttribute('disabled')).toBe(false));
}

it('warns that saving will hide a public Reading or Listening source', async () => {
  await renderForm();
  expect(PUBLIC_SOURCE_HIDE_WARNING).toMatch(/ẨN đề nguồn/);
  expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull();
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'pub-reading' } });
  expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([PUBLIC_SOURCE_HIDE_WARNING]);
  fireEvent.change(screen.getByLabelText('Listening'), { target: { value: 'pub-listening' } });
  expect(screen.getAllByText(PUBLIC_SOURCE_HIDE_WARNING)).toHaveLength(2);
});

it('shows no hide warning for an already private source, a cleared picker or Writing', async () => {
  await renderForm();
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'priv-reading' } });
  fireEvent.change(screen.getByLabelText('Listening'), { target: { value: 'priv-listening' } });
  fireEvent.change(screen.getByLabelText('Writing Task 1'), { target: { value: 'pub-writing-task1' } });
  expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull();
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'pub-reading' } });
  expect(screen.getAllByText(PUBLIC_SOURCE_HIDE_WARNING)).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: '' } });
  expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull();
});

it('shows no hide warning for a public Writing Task 2 prompt, as for Task 1', async () => {
  await renderForm();
  fireEvent.change(screen.getByLabelText('Writing Task 2'), { target: { value: 'pub-writing-task2' } });
  expect((screen.getByLabelText('Writing Task 2') as HTMLSelectElement).value).toBe('pub-writing-task2');
  expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull();
  fireEvent.change(screen.getByLabelText('Writing Task 1'), { target: { value: 'pub-writing-task1' } });
  expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});

it('keeps the hide warning when the server rejects the save and clears it after a successful save', async () => {
  const onCreate = vi.fn(async (_payload: Record<string, unknown>) => false);
  await renderForm(onCreate);
  fireEvent.change(screen.getByLabelText('Mã đề *'), { target: { value: 'MOCK-J99' } });
  fireEvent.change(screen.getByLabelText('Tiêu đề *'), { target: { value: 'Mock J99' } });
  fireEvent.change(screen.getByLabelText('Hình thức giao'), { target: { value: 'retake' } });
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'pub-reading' } });
  expect(screen.getAllByText(PUBLIC_SOURCE_HIDE_WARNING)).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Lưu đề nháp' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  expect(onCreate.mock.calls[0][0]).toMatchObject({
    reading_test_id: 'pub-reading', private_content_copy: true, reading_is_public: false,
  });
  // A refused save leaves the form, the selection and the warning in place.
  expect((screen.getByLabelText('Reading') as HTMLSelectElement).value).toBe('pub-reading');
  expect(screen.getAllByText(PUBLIC_SOURCE_HIDE_WARNING)).toHaveLength(1);

  onCreate.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu đề nháp' }));
  await waitFor(() => expect(screen.queryByText(PUBLIC_SOURCE_HIDE_WARNING)).toBeNull());
  expect((screen.getByLabelText('Reading') as HTMLSelectElement).value).toBe('');
});

it('renders the hide warning inside its own picker, after that picker select', async () => {
  await renderForm();
  fireEvent.change(screen.getByLabelText('Listening'), { target: { value: 'pub-listening' } });
  fireEvent.change(screen.getByLabelText('Reading'), { target: { value: 'pub-reading' } });
  const warnings = screen.getAllByText(PUBLIC_SOURCE_HIDE_WARNING);
  expect(warnings).toHaveLength(2);
  const pickers = ['Listening', 'Reading', 'Writing Task 1'].map((label) => screen.getByLabelText(label) as HTMLSelectElement);
  const [listening, reading, writingTask1] = pickers;
  for (const [index, select] of [listening, reading].entries()) {
    const warning = warnings[index];
    const field = select.closest('.mex-picker-field');
    expect(field).not.toBeNull();
    expect(field!.contains(warning)).toBe(true);
    // Document order: own select → warning → next picker select.
    expect(select.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warning.compareDocumentPosition(pickers[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(writingTask1.closest('.mex-picker-field')!.contains(warnings[1])).toBe(false);
});
