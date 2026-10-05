import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingDetail } from '@/app/(authed-reading)/reading/reading-detail';
import { clearLearnerTabDraftAccount, LEARNER_DRAFT_KEY } from '@/lib/learner-tab-drafts.mjs';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'reading-draft-owner' } as { id: string } | null }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
// Exercise the actual consumer/helper after synthetic admission. This does
// not qualify native cloned-history or new-document Back persistence.
vi.mock('@/lib/learner-tab-draft-support.mjs', () => ({ isLearnerTabPersistenceSupported: () => true }));

let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let revision = 'original';
const fixture = (slug: string) => ({
  id: `article-${slug}`, slug, title: `Article ${slug}`, body_markdown: `Public passage ${revision}`,
  glossary: [], questions: [
    { q_num: 1, question_type: 'gap_text', prompt: `First ${revision}`, payload: {} },
    { q_num: 2, question_type: 'gap_text', prompt: 'Second', payload: {} },
    { q_num: 3, question_type: 'mcq_single', prompt: 'Third', payload: { options: [{ label: 'A', text: 'Alpha' }, { label: 'B', text: 'Beta' }] } },
  ],
});
const input = (number: number) => screen.getByRole('textbox', { name: `Câu ${number}` }) as HTMLInputElement;
const card = (number: number) => input(number).closest('.rq-card') as HTMLElement;
const mount = (slug = 'article-a', library: 'vocab' | 'skill' = 'vocab') => render(<ReadingDetail library={library} slug={slug} />);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const ack = (number: number) => ({ results: [{ q_num: number, correct: false, expected: 'Canonical', explanation: 'Checked server result' }] });

beforeEach(() => {
  auth.status = 'signed-in'; auth.user = { id: 'reading-draft-owner' }; revision = 'original';
  window.sessionStorage.clear(); window.name = '';
  getWith = vi.fn(async (path: string) => fixture(decodeURIComponent(path.split('/').at(-1)!)));
  post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post } });
  Object.defineProperty(window, 'getSupabase', { configurable: true, value: () => ({ auth: { getSession: async () => ({ data: { session: { user: auth.user } } }) } }) });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); window.name = ''; });

it('restores latest raw text, empty edits and selections in StrictMode without checking or restoring a verdict', async () => {
  let view = render(<StrictMode><ReadingDetail library="vocab" slug="article-a" /></StrictMode>);
  await screen.findByRole('textbox', { name: 'Câu 1' });
  fireEvent.change(input(1), { target: { value: '  raw answer  ' } });
  fireEvent.change(input(2), { target: { value: 'older' } });
  fireEvent.change(input(2), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('B. Beta'));
  expect(JSON.parse(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)!).drafts[0].value.answers).toEqual({ 1: '  raw answer  ', 2: '', 3: 'B' });
  view.unmount(); view = mount();
  await screen.findByText('Đã khôi phục nháp trong tab này.');
  expect(input(1).value).toBe('  raw answer  '); expect(input(2).value).toBe('');
  expect((screen.getByLabelText('B. Beta') as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText('Checked server result')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('retains malformed/failed checks, then clears only the acknowledged question and never persists feedback or locks', async () => {
  let view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  fireEvent.change(input(1), { target: { value: '  first  ' } }); fireEvent.change(input(2), { target: { value: 'keep second' } });
  post.mockResolvedValueOnce({ results: [] }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ack(1));
  fireEvent.click(within(card(1)).getByRole('button', { name: 'Kiểm tra' }));
  await screen.findByRole('alert');
  expect(JSON.parse(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)!).drafts[0].value.answers[1]).toBe('  first  ');
  fireEvent.click(within(card(1)).getByRole('button', { name: 'Kiểm tra' })); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(card(1)).getByRole('button', { name: 'Kiểm tra' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(within(card(1)).getByRole('button', { name: 'Kiểm tra' }));
  await screen.findByText(/Checked server result/);
  expect(JSON.parse(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)!).drafts[0].value).toEqual({ answers: { 2: 'keep second' } });
  expect(post.mock.calls[0][1]).toEqual({ answers: [{ q_num: 1, user_answer: 'first' }] });
  view.unmount(); view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  expect(input(1).value).toBe(''); expect(input(1).disabled).toBe(false); expect(input(2).value).toBe('keep second');
  expect(screen.queryByText(/Checked server result/)).toBeNull(); expect(post).toHaveBeenCalledTimes(3);
});

it('does not clear a newer edit or another article when an old check ACK arrives', async () => {
  const held = deferred<unknown>(); post.mockReturnValue(held.promise);
  const view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  fireEvent.change(input(1), { target: { value: 'submitted' } });
  fireEvent.click(within(card(1)).getByRole('button', { name: 'Kiểm tra' })); await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  fireEvent.change(input(1), { target: { value: 'newer raw' } });
  await act(async () => held.resolve(ack(1)));
  expect(input(1).value).toBe('newer raw'); expect(input(1).disabled).toBe(false);
  const old = deferred<unknown>(); post.mockReturnValue(old.promise);
  fireEvent.click(within(card(1)).getByRole('button', { name: 'Kiểm tra' })); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  view.rerender(<ReadingDetail library="vocab" slug="article-b" />); await screen.findByText('Article article-b');
  fireEvent.change(input(1), { target: { value: 'B draft' } }); await act(async () => old.resolve(ack(1)));
  expect(input(1).value).toBe('B draft'); expect(screen.queryByText(/Checked server result/)).toBeNull();
  view.rerender(<ReadingDetail library="vocab" slug="article-a" />); await screen.findByText('Article article-a');
  expect(input(1).value).toBe('newer raw');
});

it('discards just the current article and refuses restored content after a hydrated question revision changes', async () => {
  const view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'A draft' } });
  view.rerender(<ReadingDetail library="vocab" slug="article-b" />); await screen.findByText('Article article-b'); fireEvent.change(input(1), { target: { value: 'B draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ nháp bài này' })); expect(input(1).value).toBe('');
  view.rerender(<ReadingDetail library="vocab" slug="article-a" />); await screen.findByText('Article article-a'); expect(input(1).value).toBe('A draft');
  view.unmount(); revision = 'corrected'; mount(); await screen.findByText('1. First corrected'); expect(input(1).value).toBe('');
  expect(post).not.toHaveBeenCalled();
});

it('conceals pending auth and clears the previous account before showing another account, with no cross-account restoration', async () => {
  const view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'private A' } });
  auth.status = 'initial-loading'; auth.user = null; view.rerender(<ReadingDetail library="vocab" slug="article-a" />);
  expect(screen.queryByRole('textbox')).toBeNull();
  auth.status = 'signed-in'; auth.user = { id: 'account-B' }; view.rerender(<ReadingDetail library="vocab" slug="article-a" />);
  await screen.findByRole('textbox', { name: 'Câu 1' }); expect(input(1).value).toBe('');
  auth.user = { id: 'reading-draft-owner' }; view.rerender(<ReadingDetail library="vocab" slug="article-a" />);
  await screen.findByRole('textbox', { name: 'Câu 1' }); expect(input(1).value).toBe(''); expect(post).not.toHaveBeenCalled();
});

it('keeps BFCache answers concealed until the existing real-account seam confirms the returning owner', async () => {
  const held = deferred<{ data: { session: { user: { id: string } } | null } }>();
  Object.defineProperty(window, 'getSupabase', { configurable: true, value: () => ({ auth: { getSession: () => held.promise } }) });
  mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'private before Back' } });
  act(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.getByText('Đang xác nhận tài khoản…')).toBeTruthy();
  await act(async () => held.resolve({ data: { session: { user: { id: 'reading-draft-owner' } } } }));
  await screen.findByRole('textbox', { name: 'Câu 1' }); expect(input(1).value).toBe('private before Back'); expect(post).not.toHaveBeenCalled();
});

it('preserves the draft while auth rechecks a returning page, then restores only the confirmed same account', async () => {
  const held = deferred<{ data: { session: { user: { id: string } } } }>();
  Object.defineProperty(window, 'getSupabase', { configurable: true, value: () => ({ auth: { getSession: () => held.promise } }) });
  const view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  fireEvent.change(input(1), { target: { value: 'keep through session recheck' } });
  const saved = window.sessionStorage.getItem(LEARNER_DRAFT_KEY);
  act(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  auth.status = 'initial-loading'; auth.user = null;
  view.rerender(<ReadingDetail library="vocab" slug="article-a" />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)).toBe(saved);
  auth.status = 'signed-in'; auth.user = { id: 'reading-draft-owner' };
  view.rerender(<ReadingDetail library="vocab" slug="article-a" />);
  await act(async () => held.resolve({ data: { session: { user: { id: 'reading-draft-owner' } } } }));
  await screen.findByText('Đã khôi phục nháp trong tab này.');
  expect(input(1).value).toBe('keep through session recheck'); expect(post).not.toHaveBeenCalled();
});

it('creates a fresh BFCache workspace after same-account logout invalidates the owner even when storage clearing fails', async () => {
  mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  fireEvent.change(input(1), { target: { value: 'must not revive after logout' } });
  const oldNamespace = window.sessionStorage.getItem(LEARNER_DRAFT_KEY);
  const oldOwner = window.name;
  const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  const removes = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  await act(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    clearLearnerTabDraftAccount('reading-draft-owner');
    expect(window.name).not.toBe(oldOwner);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await screen.findByRole('textbox', { name: 'Câu 1' });
  expect(input(1).value).toBe('');
  expect(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)).toBe(oldNamespace);
  expect(screen.getByText('Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.')).toBeTruthy();
  expect(getWith).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled();
  writes.mockRestore(); removes.mockRestore();
});

it('keeps inputs usable and announces an unsaved draft when storage is denied, quota-limited or malformed', async () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
  let view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'still editable' } });
  expect(input(1).value).toBe('still editable'); expect(screen.getByText('Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.')).toBeTruthy();
  view.unmount(); set.mockRestore(); window.sessionStorage.setItem(LEARNER_DRAFT_KEY, '{bad');
  view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); expect(input(1).value).toBe('');
  expect(screen.getByText('Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.')).toBeTruthy();
  view.unmount(); window.sessionStorage.clear(); vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'denied but usable' } });
  expect(input(1).value).toBe('denied but usable'); expect(post).not.toHaveBeenCalled();
});

it('does not persist Skill Practice controls or adopt browser-restored DOM text as an unchecked edit', async () => {
  let view = mount('article-a', 'skill'); await screen.findByRole('textbox', { name: 'Câu 1' }); fireEvent.change(input(1), { target: { value: 'skill response' } });
  expect(window.sessionStorage.getItem(LEARNER_DRAFT_KEY)).toBeNull(); expect(screen.queryByRole('button', { name: 'Bỏ nháp bài này' })).toBeNull();
  view.unmount(); view = mount(); await screen.findByRole('textbox', { name: 'Câu 1' });
  input(1).value = 'browser copied text'; // A restored DOM value is not an edit event.
  view.unmount(); mount(); await screen.findByRole('textbox', { name: 'Câu 1' }); expect(input(1).value).toBe(''); expect(post).not.toHaveBeenCalled();
});
