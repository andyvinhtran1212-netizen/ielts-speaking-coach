import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { WritingResultBehavior } from '@/app/(authed-writing-result)/writing/result/writing-result-behavior';

const params = vi.hoisted(() => new URLSearchParams({ id: 'essay-1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const FEEDBACK_JSON = {
  overallBandScore: 6.5,
  criteriaFeedback: {
    mainCriterion: { title: 'TR', explanation: '', feedback: '', bandScore: 7 },
    coherenceCohesion: { title: 'CC', explanation: '', feedback: '', bandScore: 6 },
    lexicalResource: { title: 'LR', explanation: '', feedback: '', bandScore: 6 },
    grammaticalRange: { title: 'GRA', explanation: '', feedback: '', bandScore: 5 },
  },
  mistakeAnalysis: [
    { original: 'I has been study', mistakeType: 'Subject-verb agreement', explanation: 'Sai trợ động từ', suggestion: 'I have been studying', criterion: 'Grammatical Range' },
    { original: 'He go', mistakeType: 'Subject-verb agreement', explanation: 'Sai chia động từ', suggestion: 'He goes', criterion: 'Grammatical Range' },
    { original: 'make a research', mistakeType: 'Collocation', explanation: 'Sai kết hợp từ', suggestion: 'do research', criterion: 'Lexical Resource' },
  ],
  keyTakeaways: { strengths: [], areasForImprovement: ['Phát triển ý rõ hơn'] },
};

function payload(feedbackJson: unknown, essay: Record<string, unknown> = {}) {
  return {
    essay: { id: 'essay-1', status: 'delivered', task_type: 'task2', prompt_text: 'Prompt', essay_text: 'Essay body.', created_at: '2026-10-30T00:00:00Z', ...essay },
    feedback: { overall_band_score: 6.5, feedback_json: feedbackJson },
    instructor_note: null,
  };
}

function mount(body: unknown) {
  const get = vi.fn((path: string) => (path === '/api/writing/my-essays/essay-1' ? Promise.resolve(body) : Promise.resolve({})));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn() } });
  render(<WritingResultBehavior />);
}

beforeEach(() => {
  const runtime = { window: {} as { WritingRenderers?: unknown } };
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/js/writing-renderers.js'), 'utf8'), runtime);
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: runtime.window.WritingRenderers });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders the ranked fixes as a labelled ordered list between the intro and the tabs', async () => {
  mount(payload(FEEDBACK_JSON));
  const block = await screen.findByRole('region', { name: '3 việc cần sửa trước' });
  expect(within(block).getByText('Ưu tiên sửa những điểm này ở bài tiếp theo. Xem chi tiết ở tab Lỗi cần sửa.')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Lỗi cần sửa/ })).toBeTruthy();
  const items = within(within(block).getByRole('list')).getAllByRole('listitem');
  expect(items.map((item) => item.querySelector('.top-fixes__title')?.textContent)).toEqual([
    'Subject-verb agreement (2 chỗ)', 'Collocation', 'Phát triển ý rõ hơn',
  ]);
  expect(items[0].querySelector('q')?.textContent).toBe('I has been study');
  expect(items[0].querySelector('.top-fixes__detail')?.textContent).toBe('I have been studying');
  const intro = document.querySelector('.review-intro')!;
  const workspace = document.querySelector('.review-workspace')!;
  expect(intro.nextElementSibling).toBe(block);
  expect(block.nextElementSibling).toBe(workspace);
});

it('counts the heading from the fixes actually shown and escapes AI text', async () => {
  mount(payload({ mistakeAnalysis: [{ original: '<img src=x>', mistakeType: '<b>Tense</b>', explanation: '', suggestion: 'fix', criterion: 'GRA' }] }));
  const block = await screen.findByRole('region', { name: '1 việc cần sửa trước' });
  expect(block.querySelector('img, b')).toBeNull();
  expect(within(block).getByText('<b>Tense</b>')).toBeTruthy();
});

it('renders no block when there is nothing to fix', async () => {
  mount(payload({ keyTakeaways: { strengths: ['Good'], areasForImprovement: [] }, mistakeAnalysis: [] }));
  await screen.findByRole('tablist');
  expect(document.querySelector('#top-fixes')).toBeNull();
  expect(screen.queryByRole('region', { name: /việc cần sửa trước/ })).toBeNull();
});

it('still renders the block when the instructor hides band scores, without any band in it', async () => {
  mount(payload(FEEDBACK_JSON, { hide_subbands: true }));
  const block = await screen.findByRole('region', { name: '3 việc cần sửa trước' });
  expect(document.querySelector('#band-display')).toBeNull();
  expect(block.textContent).not.toMatch(/band|\d\.\d/i);
});
