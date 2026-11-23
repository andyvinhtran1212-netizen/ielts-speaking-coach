// EXAMDRILL-0073 T001 (G08-T20): Quick Check in the practice room behind the
// 'drill' flag. Real QuizPlayer, engine and outbox; only transport, auth and
// navigation are synthetic.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuizPlayer } from '@/app/(authed-quiz-player)/quiz/quiz-player';

const scope = vi.hoisted(() => ({ params: new URLSearchParams(), user: { id: 'learner-a' } as { id: string } | null, status: 'signed-in' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => scope.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: scope.status, user: scope.user }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const BANK_ID = 'vocab-bank-1';
const SESSION_ID = 'session-1';
function bankPayload() {
  const q = (qid: string, key: string, skill: string, answer: number) => ({ qid, item_key: key, input: 'choice', skill, prompt: `Meaning of ${key} (${skill})?`, options: ['first', 'second', 'third'], answer });
  return {
    bank: { id: BANK_ID, title: 'Từ vựng chủ đề Môi trường', skill_area: 'vocab', meta: { require_production_to_master: false } },
    questions: [q('q1', 'alpha', 'meaning', 0), q('q2', 'alpha', 'form', 0), q('q3', 'beta', 'meaning', 0), q('q4', 'beta', 'form', 0)],
    word_cards: {},
  };
}
const MASTERED = [
  { item_key: 'alpha', skills_passed: ['meaning', 'form'], credit_count: 2 },
  { item_key: 'beta', skills_passed: ['meaning', 'form'], credit_count: 2 },
];

let resume: unknown[];
let progress: ReturnType<typeof vi.fn>;
let reset: ReturnType<typeof vi.fn>;
let bankRead: ReturnType<typeof vi.fn>;
let location: { href: string; assign: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn>; pathname: string; search: string };

function setFlag(on: boolean) {
  (window as any).__AVER_RUNTIME_CONFIG__ = { environment: 'staging', examRoomSurfaces: on ? ['drill'] : [] };
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  scope.params = new URLSearchParams(`bank=${BANK_ID}`); scope.user = { id: 'learner-a' }; scope.status = 'signed-in';
  resume = [];
  setFlag(true);
  progress = vi.fn(async () => ({ ok: true }));
  reset = vi.fn(async () => ({ ok: true }));
  bankRead = vi.fn(async () => bankPayload());
  location = { href: 'https://app.invalid/quiz?bank=vocab-bank-1', assign: vi.fn(), replace: vi.fn(), pathname: '/quiz', search: `?bank=${BANK_ID}` };
  vi.stubGlobal('location', location);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  Object.assign(window, {
    getSupabase: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'synthetic-token', user: { id: scope.user?.id } } } }) } }),
    api: {
      base: 'https://synthetic.invalid',
      getWith: vi.fn(async (url: string) => (url.endsWith('/resume') ? resume : bankRead(url))),
      postWith: vi.fn(async (url: string, body: unknown) => {
        if (url === '/api/quiz/sessions') return { session_id: SESSION_ID, resume };
        if (url.endsWith('/progress')) return progress(url, body);
        if (url.endsWith('/reset')) return reset(url);
        return {};
      }),
      patchWith: vi.fn(async () => ({})),
    },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).__AVER_RUNTIME_CONFIG__; });

async function answerShown() {
  const room = await screen.findByRole('button', { name: 'first' });
  fireEvent.click(room);
  await screen.findByRole('button', { name: 'Câu tiếp theo' });
}

describe('flag on: the practice room', () => {
  it('renders in the room with Thoát, the bank title and "Câu N" with the mastery count, no site bar', async () => {
    const view = render(<QuizPlayer />);
    await screen.findByText(/Meaning of/);
    const root = view.container.querySelector('[data-exam-room]')!;
    expect(root.getAttribute('data-surface')).toBe('drill');
    expect(root.getAttribute('data-mode')).toBe('practice');
    expect(screen.getByRole('button', { name: /Thoát/ })).toBeTruthy();
    expect(screen.getByText('Từ vựng chủ đề Môi trường')).toBeTruthy();
    expect(screen.getByText(/Câu 1 · Đã thuộc 0\/2/)).toBeTruthy();
    expect(view.container.querySelector('aver-chrome')).toBeNull();
    expect(screen.queryByText(/trên \d/)).toBeNull();
  });

  it('answers with "Đúng." or "Sai.", locks the options, and "Câu tiếp theo" counts the next question', async () => {
    render(<QuizPlayer />);
    await answerShown();
    expect(screen.getByText(/^(Đúng|Sai)\.$/)).toBeTruthy();
    for (const option of ['first', 'second', 'third']) expect((screen.getByRole('button', { name: option }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /quay lại|câu trước/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    await screen.findByText(/Câu 2 · Đã thuộc/);
  });

  it('asks before a reset in the page, Giữ tiến độ first, and only "Xoá và làm lại" calls reset', async () => {
    resume = MASTERED;
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(<QuizPlayer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Làm lại từ đầu' }));
    const box = await screen.findByRole('alertdialog');
    expect(within(box).getByText('Xoá tiến độ của bài này?')).toBeTruthy();
    expect(within(box).getByText('Toàn bộ tiến độ đã thuộc của bài này sẽ bị xoá và bạn làm lại từ đầu.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(box).getByRole('button', { name: 'Giữ tiến độ' })));
    fireEvent.click(within(box).getByRole('button', { name: 'Giữ tiến độ' }));
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Làm lại từ đầu' }));
    resume = [];
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá và làm lại' }));
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await screen.findByText(/Câu 1 · Đã thuộc 0\/2/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves at once when everything is saved: Thoát flushes the outbox first', async () => {
    render(<QuizPlayer />);
    await answerShown();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/vocabulary/practice'));
    expect(progress).toHaveBeenCalledTimes(1);
    expect((progress.mock.calls[0][1] as { attempts: unknown[] }).attempts).toHaveLength(1);
    // FR-016: the room's events carry kind=quiz and no question, answer or word.
    const events = (window.api.postWith as any).mock.calls.filter(([url]: [string]) => url === '/api/analytics/events').map(([, body]: [string, any]) => body);
    expect(events).toContainEqual({ event_name: 'exam_room_exit_confirmed', event_data: { unsaved: 0, kind: 'quiz' } });
    expect(JSON.stringify(events)).not.toMatch(/Meaning of|alpha|beta|first|second/);
  });

  it('keeps the learner on the page with the unsaved count when the outbox cannot send', async () => {
    progress.mockImplementation(async () => { throw Object.assign(new Error('offline'), { status: 0 }); });
    render(<QuizPlayer />);
    await answerShown();
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    await answerShown();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    expect(await screen.findByText(/Còn 2 câu chưa lưu/)).toBeTruthy();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('a 401 during the run shows the sign-in box instead of going to /login, and sends again once signed in', async () => {
    progress.mockImplementation(async () => { throw Object.assign(new Error('expired'), { status: 401 }); });
    render(<QuizPlayer />);
    await answerShown();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    const box = (await screen.findByText('Phiên đăng nhập đã hết hạn')).closest('dialog')!;
    expect(location.href).not.toBe('/login');
    expect(location.replace).not.toHaveBeenCalled();
    // Answers are unsaved and there is no device copy: only "stay" (0066 amendment 2).
    expect(within(box).queryByRole('link', { name: 'Đăng nhập lại' })).toBeNull();
    const events = (window.api.postWith as any).mock.calls.filter(([url]: [string]) => url === '/api/analytics/events').map(([, body]: [string, any]) => body);
    expect(events).toContainEqual({ event_name: 'exam_room_session_expired', event_data: { surface: 'drill', kind: 'quiz' } });
    const failed = progress.mock.calls.length;
    progress.mockImplementation(async () => ({ ok: true }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByText('Phiên đăng nhập đã hết hạn')).toBeNull());
    expect(progress).toHaveBeenCalledTimes(failed + 1);
    expect((progress.mock.calls[failed][1] as { attempts: unknown[] }).attempts).toHaveLength(1);
  });

  it('signed out mid-run keeps the run; the same account back resumes, nothing is reloaded', async () => {
    const view = render(<QuizPlayer />);
    await answerShown();
    scope.status = 'signed-out'; scope.user = null;
    view.rerender(<QuizPlayer />);
    await screen.findByText('Phiên đăng nhập đã hết hạn');
    expect(location.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Meaning of/)).toBeTruthy();
    scope.status = 'signed-in'; scope.user = { id: 'learner-a' };
    view.rerender(<QuizPlayer />);
    await waitFor(() => expect(screen.queryByText('Phiên đăng nhập đã hết hạn')).toBeNull());
    expect(bankRead).toHaveBeenCalledTimes(1);
  });

  it('a 401 before the run starts still goes to /login', async () => {
    bankRead.mockImplementation(async () => { throw Object.assign(new Error('expired'), { status: 401 }); });
    render(<QuizPlayer />);
    await waitFor(() => expect(location.href).toBe('/login'));
  });
});

describe('flag off: the page as today', () => {
  it('renders the old player, no room', async () => {
    setFlag(false);
    const view = render(<QuizPlayer />);
    await screen.findByRole('heading', { name: 'Từ vựng chủ đề Môi trường' });
    expect(view.container.querySelector('[data-exam-room]')).toBeNull();
    expect(view.container.querySelector('aver-chrome')).not.toBeNull();
    expect(screen.getByText('Đã thuộc 0/2')).toBeTruthy();
  });

  it('keeps window.confirm for the reset', async () => {
    setFlag(false);
    resume = MASTERED;
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<QuizPlayer />);
    fireEvent.click(await screen.findByRole('button', { name: /Làm lại từ đầu/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
