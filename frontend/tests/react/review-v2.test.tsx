// LEARNERCORE-0063 amendment 4 (G07-T31): the review pages' new tree.
// FR-104 tree pick, FR-105 "Chỉ câu sai", FR-106 note box, FR-109 flagged state.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';
import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';
import { REVIEW_V2_ON, ReviewV2Context, useReviewV2 } from '@/components/review-v2/review-v2-context';
import { ReviewV2Shell } from '@/components/review-v2/review-v2-shell';
import fixture from '../fixtures/listening-review-group-and-editorial.json';

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', user: { id: 'review-owner', email: 'hv@example.test' } } as any }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth.value }));
// next/dynamic → React.lazy, so the lazy frame resolves inside the test.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>, options?: { loading?: () => ReactNode }) => {
    const Lazy = lazy(async () => {
      const mod = await loader();
      return { default: mod.default ?? mod };
    });
    return (props: any) => <Suspense fallback={options?.loading?.() ?? null}><Lazy {...props} /></Suspense>;
  },
}));
vi.mock('@/components/ui/shell/learner-shell', () => ({
  LearnerShell: ({ children, user }: { children: ReactNode; user: { name: string; initials: string } }) =>
    <div data-testid="learner-shell" data-initials={user.initials}><main>{children}</main></div>,
}));

let getWith: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
let attachCardFlag: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.value = { status: 'signed-in', user: { id: 'review-owner', email: 'hv@example.test' } };
  getWith = vi.fn(); patch = vi.fn(); attachCardFlag = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, patch, post: vi.fn() } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag, mountSurvey: vi.fn() } });
  Object.defineProperty(window, 'aver', { configurable: true, value: { reportError: vi.fn() } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const V2 = ({ children }: { children: ReactNode }) =>
  <ReviewV2Context.Provider value={REVIEW_V2_ON}>{children}</ReviewV2Context.Provider>;

function readingReview(overrides: Record<string, unknown> = {}) {
  return {
    attempt_id: 'att-r1', status: 'submitted', test_id: 'reading-t31', title: 'Reading T31',
    score: 1, max_score: 3, band_estimate: 3, skill_breakdown: {},
    passages: [{ passage_order: 1, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      { q_num: 1, passage_order: 1, correct: false, user_answer: '', expected: 'A', prompt: 'Blank one' },
      { q_num: 2, passage_order: 1, correct: false, user_answer: 'B', expected: 'C', prompt: 'Wrong one' },
      { q_num: 3, passage_order: 1, correct: true, user_answer: 'D', expected: 'D', prompt: 'Right one' },
    ],
    my_flagged_q_nums: [2],
    ...overrides,
  };
}

/** Routes window.api.getWith by path: the review, the notes, /auth/me. */
function serve(routes: { review?: unknown; notes?: unknown | Error; me?: unknown | Error }) {
  getWith.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/review-notes')) {
      if (routes.notes instanceof Error) throw routes.notes;
      return routes.notes ?? { notes: [] };
    }
    if (path.startsWith('/auth/me')) {
      if (routes.me instanceof Error) throw routes.me;
      return routes.me;
    }
    return structuredClone(routes.review);
  });
}

/** A /auth/me body that passes normalizeAuthMe. */
function me(extra: Record<string, unknown>) {
  return { id: 'review-owner', email: 'hv@example.test', display_name: null, avatar_url: null, role: 'user',
    is_active: true, onboarding_completed: true, target_band: null, exam_date: null, self_level: null,
    preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false, d3_enabled: false,
    flashcard_enabled: false, vocab_curated_enabled: false, ...extra };
}

const notesCalls = () => getWith.mock.calls.filter(([path]) => String(path).startsWith('/api/review-notes'));
const card = (container: HTMLElement, q: number) => container.querySelector(`#reading-review-q-${q}`) as HTMLElement | null;

// ── FR-105 ────────────────────────────────────────────────────────────────

it('"Chỉ câu sai" keeps incorrect and blank, writes ?only=wrong, and the four filters still work', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview() });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  // New tree without ?only=wrong opens on "Tất cả".
  expect(card(view.container, 3)).not.toBeNull();
  const toggle = screen.getByRole('button', { name: 'Chỉ câu sai' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(card(view.container, 1)).not.toBeNull();
  expect(card(view.container, 2)).not.toBeNull();
  expect(card(view.container, 3)).toBeNull();
  expect(window.location.search).toBe('?attempt_id=att-r1&only=wrong');
  fireEvent.click(toggle);
  expect(window.location.search).toBe('?attempt_id=att-r1');
  fireEvent.click(screen.getByRole('button', { name: 'Đúng', exact: true }));
  expect(card(view.container, 2)).toBeNull();
  expect(card(view.container, 3)).not.toBeNull();
});

it('?only=wrong survives a reload, and an all-correct attempt says so with a way back to "Tất cả"', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1&only=wrong');
  const allRight = readingReview({
    score: 1, max_score: 1, my_flagged_q_nums: [],
    review: [{ q_num: 3, passage_order: 1, correct: true, user_answer: 'D', expected: 'D', prompt: 'Right one' }],
  });
  serve({ review: allRight });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  expect(screen.getByRole('button', { name: 'Chỉ câu sai' }).getAttribute('aria-pressed')).toBe('true');
  const empty = view.container.querySelector('.rv-all-correct') as HTMLElement;
  expect(empty.getAttribute('role')).toBe('status');
  expect(empty.textContent).toContain('Bạn đã trả lời đúng toàn bộ bài này.');
  fireEvent.click(within(view.container.querySelector('.rv-all-correct') as HTMLElement).getByRole('button', { name: 'Tất cả' }));
  expect(card(view.container, 3)).not.toBeNull();
  expect(window.location.search).toBe('?attempt_id=att-r1');
});

// ── FR-104: flag off is the workspace as today ───────────────────────────

it('flag off: no toggle, no note box, no notes request, the old "Cần xem lại" opening', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1&only=wrong');
  serve({ review: readingReview() });
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText('Reading T31');
  expect(screen.queryByRole('button', { name: 'Chỉ câu sai' })).toBeNull();
  expect(screen.queryByLabelText('Ghi chú của bạn')).toBeNull();
  expect(notesCalls()).toHaveLength(0);
  expect(card(view.container, 3)).toBeNull(); // opens on "Cần xem lại" as before
  expect(view.container.querySelector('main.exam-split')).not.toBeNull();
  expect(view.container.querySelector('header[role="banner"]')).not.toBeNull();
  expect(window.location.search).toBe('?attempt_id=att-r1&only=wrong'); // the old tree never rewrites the URL
});

it('the shell draws LearnerShell only for a flagged account, and the old tree otherwise', async () => {
  function Probe() { return <p>{useReviewV2().enabled ? 'tree:new' : 'tree:old'}</p>; }
  serve({ me: me({ display_name: 'Vũ Thu Trang', learner_v2_enabled: true }) });
  render(<ReviewV2Shell><Probe /></ReviewV2Shell>);
  expect(await screen.findByText('tree:new')).toBeTruthy();
  expect(screen.getByTestId('learner-shell').getAttribute('data-initials')).toBe('VT');
  cleanup();

  serve({ me: me({ learner_v2_enabled: false }) });
  render(<ReviewV2Shell><Probe /></ReviewV2Shell>);
  expect(await screen.findByText('tree:old')).toBeTruthy();
  expect(screen.queryByTestId('learner-shell')).toBeNull();
  cleanup();

  // /auth/me unreadable → the old tree (fail closed), reported.
  serve({ me: new Error('boom') });
  render(<ReviewV2Shell><Probe /></ReviewV2Shell>);
  expect(await screen.findByText('tree:old')).toBeTruthy();
  expect((window as any).aver.reportError).toHaveBeenCalled();
  cleanup();

  // A guest (anonymous share link) never asks /auth/me.
  getWith.mockClear();
  auth.value = { status: 'signed-out', user: null };
  render(<ReviewV2Shell><Probe /></ReviewV2Shell>);
  expect(screen.getByText('tree:old')).toBeTruthy();
  expect(getWith).not.toHaveBeenCalled();
});

it('the new tree leaves <main> and the banner to LearnerShell', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview() });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  expect(view.container.querySelector('main')).toBeNull();
  expect(view.container.querySelector('[role="banner"]')).toBeNull();
});

// ── FR-109 ────────────────────────────────────────────────────────────────

it('passes my_flagged_q_nums to each card flag, and a missing field means none', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview() });
  render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  await waitFor(() => expect(attachCardFlag).toHaveBeenCalledTimes(3));
  const flagged = Object.fromEntries(attachCardFlag.mock.calls.map(([opts]) => [opts.qNum, opts.flagged]));
  expect(flagged).toEqual({ 1: false, 2: true, 3: false });
  cleanup(); attachCardFlag.mockClear();

  const old = readingReview(); delete (old as any).my_flagged_q_nums;
  serve({ review: old });
  render(<ReadingReviewWorkspace />);
  await screen.findByText('Reading T31');
  await waitFor(() => expect(attachCardFlag).toHaveBeenCalled());
  expect(attachCardFlag.mock.calls.every(([opts]) => opts.flagged === false)).toBe(true);
});

// ── FR-106 ────────────────────────────────────────────────────────────────

it('note box: loads once, stops at 500 characters, shows what the server stored, deletes on empty', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview(), notes: { notes: [{ q_num: 2, body: 'nhầm "rise" với "raise"', updated_at: '2026-11-23T10:00:00Z' }] } });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  await waitFor(() => expect(within(card(view.container, 2)!).getByLabelText('Ghi chú của bạn')).toHaveProperty('value', 'nhầm "rise" với "raise"'));
  expect(notesCalls()).toHaveLength(1);
  expect(notesCalls()[0][0]).toBe('/api/review-notes?skill=reading&attempt_id=att-r1');

  const box = within(card(view.container, 1)!).getByLabelText('Ghi chú của bạn') as HTMLTextAreaElement;
  const save = within(card(view.container, 1)!).getByRole('button', { name: 'Lưu ghi chú' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); // nothing changed yet
  fireEvent.change(box, { target: { value: 'ạ'.repeat(501) } });
  expect([...box.value]).toHaveLength(500);
  expect(within(card(view.container, 1)!).getByText('500/500 ký tự')).toBeTruthy();

  fireEvent.change(box, { target: { value: '  nghe lại đoạn 2  ' } });
  patch.mockResolvedValueOnce({ q_num: 1, body: 'nghe lại đoạn 2', updated_at: '2026-11-23T11:00:00Z' });
  await act(async () => { fireEvent.click(save); });
  expect(patch).toHaveBeenCalledWith('/api/review-notes',
    { skill: 'reading', attempt_id: 'att-r1', q_num: 1, body: '  nghe lại đoạn 2  ' });
  expect(box.value).toBe('nghe lại đoạn 2'); // the server's value, not the typed one
  expect(within(card(view.container, 1)!).getByText('Đã lưu ghi chú.')).toBeTruthy();

  fireEvent.change(box, { target: { value: '   ' } });
  patch.mockResolvedValueOnce({ q_num: 1, body: null, updated_at: null });
  await act(async () => { fireEvent.click(save); });
  expect(box.value).toBe('');
  expect(within(card(view.container, 1)!).getByText('Đã xoá ghi chú.')).toBeTruthy();
});

it('a failed save keeps the typed text and says why at the box', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview() });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  const box = await within(card(view.container, 2)!).findByLabelText('Ghi chú của bạn') as HTMLTextAreaElement;
  await waitFor(() => expect(box.disabled).toBe(false));
  fireEvent.change(box, { target: { value: 'ghi chú dài' } });
  patch.mockRejectedValueOnce(Object.assign(new Error('422'), {
    status: 422, detail: { error: 'note_too_long', message: 'Ghi chú tối đa 500 ký tự.' },
  }));
  await act(async () => { fireEvent.click(within(card(view.container, 2)!).getByRole('button', { name: 'Lưu ghi chú' })); });
  expect(within(card(view.container, 2)!).getByRole('alert').textContent).toBe('Ghi chú tối đa 500 ký tự.');
  expect(box.value).toBe('ghi chú dài');

  patch.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
  await act(async () => { fireEvent.click(within(card(view.container, 2)!).getByRole('button', { name: 'Lưu ghi chú' })); });
  expect(within(card(view.container, 2)!).getByRole('alert').textContent).toBe('Chưa lưu được ghi chú. Thử lại sau.');
  expect(box.value).toBe('ghi chú dài');
});

it('notes that fail to load hide the boxes and the review still shows', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1');
  serve({ review: readingReview(), notes: Object.assign(new Error('503'), { status: 503 }) });
  const view = render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  await waitFor(() => expect((window as any).aver.reportError).toHaveBeenCalledWith('review notes: load failed', expect.anything()));
  expect(screen.queryByLabelText('Ghi chú của bạn')).toBeNull();
  expect(card(view.container, 1)).not.toBeNull();
});

it('an anonymous Reading share link has no note box and never asks for notes', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=att-r1&anon=anon-1');
  auth.value = { status: 'signed-out', user: null };
  serve({ review: readingReview() });
  render(<V2><ReadingReviewWorkspace /></V2>);
  await screen.findByText('Reading T31');
  expect(screen.queryByLabelText('Ghi chú của bạn')).toBeNull();
  expect(notesCalls()).toHaveLength(0);
});

// ── Listening: the same tree on the other review page ────────────────────

it('Listening new tree: toggle, note box under the solution and flagged state', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=att-l1&only=wrong');
  const raw = structuredClone(fixture.group_review) as any;
  raw.attempt_id = 'att-l1'; raw.preview = false; raw.score = 0;
  raw.my_flagged_q_nums = [12];
  serve({ review: raw, notes: { notes: [{ q_num: 11, body: 'đoạn 2 nói nhanh', updated_at: null }] } });
  const view = render(<V2><ListeningReviewWorkspace /></V2>);
  const toggle = await screen.findByRole('button', { name: 'Chỉ câu sai' });
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  const q11 = view.container.querySelector('#listening-review-q-11') as HTMLElement;
  await waitFor(() => expect(within(q11).getByLabelText('Ghi chú của bạn')).toHaveProperty('value', 'đoạn 2 nói nhanh'));
  expect(q11.querySelector('.lr-card__detail .rv-note')).not.toBeNull();
  expect(notesCalls()[0][0]).toBe('/api/review-notes?skill=listening&attempt_id=att-l1');
  await waitFor(() => expect(attachCardFlag).toHaveBeenCalledTimes(2));
  expect(Object.fromEntries(attachCardFlag.mock.calls.map(([opts]) => [opts.qNum, opts.flagged]))).toEqual({ 11: false, 12: true });
  expect(view.container.querySelector('main')).toBeNull();
});

// ── feedback-widgets.js: one flag per question (FR-108/FR-109) ───────────

function loadWidgets() {
  const src = readFileSync(join(process.cwd(), 'public', 'js', 'feedback-widgets.js'), 'utf8');
  delete (window as any).AverFeedback;
  // eslint-disable-next-line no-new-func
  new Function(src).call(window);
  return (window as any).AverFeedback;
}

function flagHost() {
  const cardEl = document.createElement('article');
  const top = document.createElement('div');
  cardEl.appendChild(top);
  document.body.appendChild(cardEl);
  return { card: cardEl, top };
}

it('a question already flagged opens as "Đã báo lỗi" and cannot reopen', () => {
  const widgets = loadWidgets();
  const host = flagHost();
  widgets.attachCardFlag({ ...host, skill: 'reading', attemptId: 'att-r1', qNum: 2, flagged: true });
  const btn = host.top.querySelector('.fb-flag-btn') as HTMLButtonElement;
  expect(btn.textContent).toContain('Đã báo lỗi');
  expect(btn.disabled).toBe(true);
  fireEvent.click(btn);
  expect(host.card.querySelector('.fb-pop')).toBeNull();
  host.card.remove();
});

it('a 409 already_flagged turns the button into "Đã báo lỗi"; another error lets the learner retry', async () => {
  const widgets = loadWidgets();
  const post = (window as any).api.post as ReturnType<typeof vi.fn>;
  const host = flagHost();
  widgets.attachCardFlag({ ...host, skill: 'reading', attemptId: 'att-r1', qNum: 2 });
  const btn = host.top.querySelector('.fb-flag-btn') as HTMLButtonElement;
  expect(btn.disabled).toBe(false);

  fireEvent.click(btn);
  post.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
  await act(async () => { fireEvent.click(host.card.querySelector('[data-act="send"]')!); });
  expect(host.card.querySelector('.fb-pop__msg')?.textContent).toBe('Không gửi được, thử lại.');
  expect((host.card.querySelector('[data-act="send"]') as HTMLButtonElement).disabled).toBe(false);
  expect(btn.disabled).toBe(false);

  post.mockRejectedValueOnce(Object.assign(new Error('409'), {
    status: 409, detail: { error: 'already_flagged', message: 'Bạn đã báo lỗi câu này.' },
  }));
  await act(async () => { fireEvent.click(host.card.querySelector('[data-act="send"]')!); });
  expect(host.card.querySelector('.fb-pop__msg')?.textContent).toBe('Bạn đã báo lỗi câu này.');
  expect(btn.textContent).toContain('Đã báo lỗi');
  expect(btn.disabled).toBe(true);
  expect(post).toHaveBeenCalledWith('/api/feedback', { skill: 'reading', attempt_id: 'att-r1', type: 'flag', q_num: 2 });
  host.card.remove();
});
