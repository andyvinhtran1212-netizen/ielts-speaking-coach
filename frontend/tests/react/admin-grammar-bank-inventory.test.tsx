import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AdminVocabTopics } from '@/app/(authed-admin-vocab)/admin/vocab/topics/admin-vocab-topics';
import { AdminVocabQuizImport } from '@/app/(authed-admin-vocab)/admin/vocab/quiz/admin-vocab-quiz-import';

const params = vi.hoisted(() => new URLSearchParams({ skill_area: 'grammar' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));
vi.mock('@/app/(authed-admin-vocab)/admin/vocab/quiz/admin-grammar-revision', () => ({ AdminGrammarRevision: () => null }));
afterEach(cleanup);

const topicId = '00000000-0000-4000-8000-000000000301';
const topic = { id: topicId, slug: 'tenses', title: 'Tenses', skill_area: 'grammar', title_vi: null,
  description: null, order: 0, is_published: true };
const base = { topic_id: topicId, title: 'Present Simple', skill_area: 'grammar', words_count: 13,
  is_published: true, grammar_canonical_code: 'G-tenses-present-simple', grammar_revision: 'a'.repeat(64),
  grammar_is_current: true, grammar_new_starts_enabled: false };
const banks = [
  { ...base, id: '00000000-0000-4000-8000-000000000302', code: 'current' },
  { ...base, id: '00000000-0000-4000-8000-000000000303', code: 'legacy', grammar_is_current: false },
  { ...base, id: '00000000-0000-4000-8000-000000000304', code: 'unmanaged', grammar_canonical_code: null,
    grammar_revision: null, grammar_is_current: false },
  { id: '00000000-0000-4000-8000-000000000305', topic_id: topicId, title: 'Older response',
    code: 'unknown', skill_area: 'grammar', words_count: 13, is_published: true },
];

it.each(['topics', 'quiz'] as const)('shows canonical revision state and keeps protected actions disabled after reopening %s', async (inventory) => {
  const post = vi.fn(), patch = vi.fn(), remove = vi.fn();
  const get = vi.fn(async (path: string) => {
    if (path.endsWith('/bundle')) return structuredClone({ topic, quiz_banks: banks, vocab_cards: [], counts: { quiz_banks: 4, vocab_cards: 0 } });
    if (path.startsWith('/admin/content-topics?')) return structuredClone([topic]);
    if (path.startsWith('/admin/quiz/banks?')) return structuredClone(banks);
    throw new Error(`Unexpected read: ${path}`);
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch, delete: remove } });
  for (let opening = 0; opening < 2; opening += 1) {
    const view = render(<StrictMode>{inventory === 'topics' ? <AdminVocabTopics /> : <AdminVocabQuizImport />}</StrictMode>);
    await screen.findByText('Bản hiện hành · Tạm ngừng lượt mới');
    expect(screen.getByText('Bản gốc · Giữ lịch sử')).toBeTruthy();
    expect(screen.getByText('Chưa xác minh phiên bản')).toBeTruthy();
    for (const code of ['current', 'legacy', 'unknown', 'unmanaged']) {
      const row = screen.getByText(code, { exact: true }).closest(inventory === 'topics' ? 'article' : 'tr')!;
      const deletion = within(row as HTMLElement).getByRole('button', { name: 'Xoá', exact: true }) as HTMLButtonElement;
      expect(deletion.disabled).toBe(code !== 'unmanaged');
      if (code !== 'unmanaged') fireEvent.click(deletion);
      if (inventory === 'topics') {
        const hide = within(row as HTMLElement).getByRole('button', { name: 'Ẩn', exact: true }) as HTMLButtonElement;
        expect(hide.disabled).toBe(code !== 'unmanaged');
        if (code !== 'unmanaged') fireEvent.click(hide);
      }
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    view.unmount();
  }
});
