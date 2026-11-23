// LEARNERCORE-0063 T25: the skill hub (`components/learner/skill-hub/*`).
// Cases from plan.md "T25": the order of the four blocks; a first visit (màn
// 3); out of credits (màn 5) with CreditsEmptyNotice only for metered + 0;
// no "Cần Khoá" while blocked is false; a broken block fails alone; flag off
// renders the old page; /reading with the flag off goes to /reading/vocab with
// its query.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SkillHub } from '@/components/learner/skill-hub/skill-hub';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'learner-1', email: null } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
const profile = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/auth-me-single-flight.mjs', () => ({
  getAuthMeProfile: (id: string | null) => (id && profile.current?.id === id ? profile.current : null),
  subscribeAuthMeProfile: () => () => {},
}));
vi.mock('next/dynamic', () => ({
  default: () => function LazyHub({ skill, accountId }: { skill: string; accountId: string }) {
    return <p>hub {skill} for {accountId}</p>;
  },
}));

type Body = Record<string, unknown>;

function payload(skill: string, over: Body = {}): Body {
  return {
    skill, credits: null, resume: [], starter: null, suggestions: [], catalog: [],
    catalog_href: '/listening/tests', history: [], history_href: '/listening/analytics',
    access: { blocked: false }, degraded: [], ...over,
  };
}

const FULL = {
  resume: [{ kind: 'writing', title: 'Cities', state: 'draft',
    href: '/writing/dashboard?view=all&assignment_id=A1', updated_at: '2026-11-22T03:00:00Z' }],
  suggestions: [{ kind: 'assigned', title: 'Task 2 lớp', why: 'Bài lớp giao, hạn 25/11',
    href: '/writing/dashboard?view=all&assignment_id=A2' }],
  catalog: [{ group: 'task1', label: 'Task 1', count: 12, done: 2, href: '/writing/dashboard?view=all&tab=prompt-bank' }],
  catalog_href: '/writing/dashboard?view=all&tab=prompt-bank',
  history: [{ submitted_at: '2026-11-20T03:00:00Z', title: 'Writing Task 2', kind: 'Task 2',
    source: 'teacher_review', result: { band: 6.5, correct: null, total: null, pending: false },
    href: '/writing/result?essay_id=e1' }],
  history_href: '/writing/dashboard?view=all',
};

let get: ReturnType<typeof vi.fn>;

function mount(skill: 'speaking' | 'writing' | 'listening' | 'reading', body: unknown) {
  get = vi.fn(async () => body);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn() } });
  return render(<SkillHub skill={skill} accountId="learner-1" />);
}

beforeEach(() => {
  profile.current = null;
});

afterEach(() => {
  cleanup();
  replace.mockReset();
  window.history.replaceState(null, '', '/');
});

it('reads the hub API once and draws the four blocks in order (FR-111..115)', async () => {
  mount('writing', payload('writing', { ...FULL, credits: { total: 18, metering: 'metered' } }));
  await screen.findByRole('region', { name: 'Làm tiếp' });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/api/student/skill-hub?skill=writing');
  const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual(['Làm tiếp', 'Gợi ý cho bạn', 'Kho bài luyện', 'Lịch sử và kết quả gần đây']);
  expect(screen.getByText('Lượt chấm AI còn lại:')).toBeTruthy();
  expect(screen.getByText('18')).toBeTruthy();
  const catalog = screen.getByRole('region', { name: 'Kho bài luyện' });
  expect(within(catalog).getByText('12 đề · đã làm 2')).toBeTruthy();
  expect(within(catalog).getByRole('link', { name: 'Tất cả đề Writing ›' }).getAttribute('href'))
    .toBe('/writing/dashboard?view=all&tab=prompt-bank');
  const history = screen.getByRole('region', { name: 'Lịch sử và kết quả gần đây' });
  expect(within(history).getByText('Band 6.5')).toBeTruthy();
  expect(within(history).getByText(/AI chấm, giáo viên duyệt rồi trả/)).toBeTruthy();
});

it('the skill row links the four hubs, current one marked', async () => {
  mount('listening', payload('listening'));
  const nav = await screen.findByRole('navigation', { name: 'Kỹ năng' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((a) => a.textContent)).toEqual(['Speaking', 'Writing', 'Listening', 'Reading']);
  expect(links[2].getAttribute('aria-current')).toBe('page');
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/speaking', '/writing/dashboard', '/listening', '/reading']);
});

it('first visit (màn 3): no resume, no suggestion block, a sentence instead of an empty table, no band', async () => {
  mount('listening', payload('listening', {
    catalog: [{ group: 'full', label: 'Full test', count: 8, done: null, href: '/listening/tests' }],
  }));
  const history = await screen.findByRole('region', { name: 'Lịch sử và kết quả gần đây' });
  expect(within(history).getByText(/Bạn chưa nộp bài Listening nào/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Làm tiếp' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Gợi ý cho bạn' })).toBeNull();
  expect(screen.getByText('8 đề')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/đã làm|Band|0\/0/);
});

it('a starter shows only when the server sends one, with the credit sentence', async () => {
  mount('speaking', payload('speaking', {
    starter: { title: 'Part 1 · Hometown', meta: '4 câu', uses_credit: true, href: '/speaking?view=all' },
  }));
  const block = await screen.findByRole('region', { name: 'Bắt đầu với một bài' });
  expect(within(block).getByText('Nộp bài để AI chấm sẽ dùng 1 lượt.')).toBeTruthy();
});

it('out of credits (màn 5): only metered + 0 shows CreditsEmptyNotice', async () => {
  const view = mount('speaking', payload('speaking', { ...FULL, credits: { total: 0, metering: 'metered' } }));
  expect(await screen.findByText('Bạn đã hết lượt chấm AI.')).toBeTruthy();
  expect(screen.queryByText('Lượt chấm AI còn lại:')).toBeNull();
  // the other blocks stay
  expect(screen.getByRole('region', { name: 'Kho bài luyện' })).toBeTruthy();
  view.unmount();

  for (const metering of ['not_metered', 'unknown']) {
    const again = mount('speaking', payload('speaking', { credits: { total: 0, metering } }));
    await screen.findByRole('region', { name: 'Kho bài luyện' });
    expect(screen.queryByText('Bạn đã hết lượt chấm AI.')).toBeNull();
    again.unmount();
  }
});

it('Listening and Reading never show a credit line', async () => {
  mount('reading', payload('reading', { credits: { total: 0, metering: 'metered' } }));
  await screen.findByRole('region', { name: 'Kho bài luyện' });
  expect(screen.queryByText(/lượt chấm AI/i)).toBeNull();
});

it('no "cần khoá" screen while access.blocked is false; the locked screen only when true', async () => {
  const view = mount('writing', payload('writing', FULL));
  await screen.findByRole('region', { name: 'Kho bài luyện' });
  expect(document.body.textContent).not.toMatch(/khoá|Khoá/);
  view.unmount();
  mount('writing', payload('writing', { access: { blocked: true } }));
  expect(await screen.findByText('Kỹ năng chưa có trong khoá của bạn')).toBeTruthy();
});

it('each broken block reports alone, with Thử lại that reloads', async () => {
  mount('writing', payload('writing', { ...FULL, degraded: ['suggestions', 'history'] }));
  const suggestions = await screen.findByRole('region', { name: 'Gợi ý cho bạn' });
  expect(within(suggestions).getByText('Chưa tải được phần này.')).toBeTruthy();
  const history = screen.getByRole('region', { name: 'Lịch sử và kết quả gần đây' });
  expect(within(history).getByText('Chưa tải được phần này.')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Làm tiếp' })).queryByText('Chưa tải được phần này.')).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Kho bài luyện' })).getByText('Task 1')).toBeTruthy();
  fireEvent.click(within(history).getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('a failed request or a payload for another skill is an error with Thử lại', async () => {
  mount('speaking', payload('writing'));
  expect(await screen.findByText('Chưa tải được trang Speaking.')).toBeTruthy();
});

it('mini test result reads "Đúng a trên b câu", never 0/0', async () => {
  mount('reading', payload('reading', {
    history: [
      { submitted_at: '2026-11-20T03:00:00Z', title: 'Mini 1', kind: 'Mini test', source: 'auto',
        result: { band: null, correct: 9, total: 13, pending: false }, href: '/reading/review?attempt_id=r1' },
      { submitted_at: '2026-11-19T03:00:00Z', title: 'Mini 2', kind: 'Mini test', source: 'auto',
        result: { band: null, correct: 0, total: 0, pending: false }, href: '/reading/review?attempt_id=r2' },
    ],
  }));
  expect(await screen.findByText('Đúng 9 trên 13 câu')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/0 trên 0|0\/0/);
  expect(screen.getAllByText(/Tự chấm/)).toHaveLength(2);
});

// ── page switches (FR-111) ─────────────────────────────────────────────────────

it('flag off or profile not loaded: the page as it is today', async () => {
  const { SkillHubSwitch } = await import('@/components/learner/skill-hub/skill-hub-switch');
  const view = render(<SkillHubSwitch skill="speaking"><p>old speaking</p></SkillHubSwitch>);
  expect(screen.getByText('old speaking')).toBeTruthy();
  view.unmount();
  profile.current = { id: 'learner-1', learner_v2_enabled: false };
  render(<SkillHubSwitch skill="speaking"><p>old speaking</p></SkillHubSwitch>);
  expect(screen.getByText('old speaking')).toBeTruthy();
  expect(screen.queryByText(/^hub /)).toBeNull();
});

it('flag on: the hub replaces the page, and ?view=all keeps the old page', async () => {
  const { SkillHubSwitch } = await import('@/components/learner/skill-hub/skill-hub-switch');
  profile.current = { id: 'learner-1', learner_v2_enabled: true };
  const view = render(<SkillHubSwitch skill="writing"><p>old writing</p></SkillHubSwitch>);
  expect(screen.getByText('hub writing for learner-1')).toBeTruthy();
  expect(screen.queryByText('old writing')).toBeNull();
  view.unmount();
  window.history.replaceState(null, '', '/writing/dashboard?view=all&tab=prompt-bank');
  render(<SkillHubSwitch skill="writing"><p>old writing</p></SkillHubSwitch>);
  expect(screen.getByText('old writing')).toBeTruthy();
});

it('/reading flag off: replaces to /reading/vocab keeping the query', async () => {
  const { ReadingHubEntry } = await import('@/components/learner/skill-hub/reading-hub-entry');
  profile.current = { id: 'learner-1', learner_v2_enabled: false };
  window.history.replaceState(null, '', '/reading?ref=nav&x=1');
  render(<ReadingHubEntry />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/reading/vocab?ref=nav&x=1'));
});

it('/reading flag on: the Reading hub, no redirect', async () => {
  const { ReadingHubEntry } = await import('@/components/learner/skill-hub/reading-hub-entry');
  profile.current = { id: 'learner-1', learner_v2_enabled: true };
  render(<ReadingHubEntry />);
  expect(screen.getByText('hub reading for learner-1')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

it('/reading with no profile falls back to the old redirect after the wait', async () => {
  vi.useFakeTimers();
  try {
    const { ReadingHubEntry, READING_FLAG_WAIT_MS } = await import('@/components/learner/skill-hub/reading-hub-entry');
    render(<ReadingHubEntry />);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(READING_FLAG_WAIT_MS + 10); });
    expect(replace).toHaveBeenCalledWith('/reading/vocab');
  } finally {
    vi.useRealTimers();
  }
});
