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

async function renderForm() {
  render(<ExamCreateForm cohorts={[]} disabled={false} onCreate={vi.fn(async () => true)} onError={vi.fn()} />);
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
