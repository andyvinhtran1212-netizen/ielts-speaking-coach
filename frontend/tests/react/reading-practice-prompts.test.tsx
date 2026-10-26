import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingDetail } from '@/app/(authed-reading)/reading/reading-detail';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'reading-prompt-owner' } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

let prompt = '';
beforeEach(() => {
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string, options?: { breaks?: boolean }) => DOMPurify.sanitize(marked.parse(text, { breaks: options?.breaks ?? false }) as string) });
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn(async () => ({
    id: 'battery-prompt', slug: 'battery', title: 'Battery', body_markdown: 'A cell has two electrodes.',
    glossary: [], questions: [{ q_num: 1, question_type: 'table_completion', prompt, payload: {} }],
  })) } });
});
afterEach(() => cleanup());

it('renders the authored table and gap labels instead of showing Markdown delimiters', async () => {
  prompt = 'Complete the table. Choose NO MORE THAN TWO WORDS.\n\n| Part | Function |\n| --- | --- |\n| (1) __________ | Gives off electrons |\n| Cathode | Receives electrons |';
  render(<ReadingDetail library="skill" slug="battery" />);
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Part' })).toBeTruthy();
  expect(within(table).getByRole('cell', { name: '(1) __________' })).toBeTruthy();
  expect(within(table).getByRole('cell', { name: 'Receives electrons' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Câu 1' })).toBeTruthy();
  expect(screen.queryByText('| --- | --- |')).toBeNull();
});

it('preserves authored line breaks and sanitises prompt markup with the existing renderer', async () => {
  prompt = 'Complete the flow-chart.\nA chemical reaction\n↓\nReleases (1) __________\n<script>window.promptAttack = true</script><img src="x" onerror="window.promptAttack = true">';
  const view = render(<ReadingDetail library="skill" slug="battery" />);
  await waitFor(() => expect(view.container.querySelector('.rq-prompt .md-body br')).toBeTruthy());
  const body = view.container.querySelector('.rq-prompt .md-body');
  expect(body).toBeTruthy();
  expect(body!.querySelector('br')).toBeTruthy();
  expect(body!.querySelector('script,[onerror]')).toBeNull();
});
