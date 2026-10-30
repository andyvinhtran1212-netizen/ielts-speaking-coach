// UIA-1030-01 / PC-J302 — /course-exercises error screens.
//
// Opening the page without `?bank=` showed a red "Không thể kết nối để lưu"
// badge, an empty progress frame and the raw `?bank=…` parameter. A missing
// link parameter (or a server refusal, 4xx) is not a connection error: the
// save badge must go, the learner gets a way back to Lớp học. A missing
// `window.api` or an unanswered load keeps the connection badge.
//
// PC-J315: `course-runner.js` tags its non-network failures with `err.code`.
// An empty bank (`bank_empty`) is a neutral notice with the way back; a broken
// browser storage (`storage_unavailable`) says so on the badge. Untagged
// errors stay connection errors.
//
// PC-J323: a throwing `window.localStorage` getter (blocked site data, some
// private modes) used to leave the page stuck on "Đang mở bài tập…"; 408/429
// are transient and keep the connection badge; the "Về Lớp học" link sits
// after `#cx-error`, not inside the error text; a storage failure while
// answering shows the storage sentence instead of the runner's raw text.
//
// PC-J328: the "Thử tải lại tiến độ" button sits right after `#cx-error` too,
// so the error region reads only the error sentence; a second failure (a new
// run of the effect) leaves exactly one button.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({ apiReady: true, userId: 'student-1' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: wire.userId } }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({
  whenGlobalReady: vi.fn(async () => wire.apiReady),
}));

import { CourseBehavior } from '@/app/(authed)/course-exercises/course-behavior';
import { CourseShell } from '@/app/(authed)/course-exercises/page-shell';

const CSS = readFileSync(resolve(process.cwd(), 'public/css/course-exercises.css'), 'utf8');
const CONNECTION_BADGE = 'Không thể kết nối để lưu';

function renderPage(search: string) {
  window.history.replaceState({}, '', '/course-exercises' + search);
  return render(<><CourseShell /><CourseBehavior /></>);
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

async function errorShown() {
  await waitFor(() => expect(el('cx-error').hidden).toBe(false));
  return el('cx-error');
}

/** The "Về Lớp học" link: right after `#cx-error`, never inside it. */
function backLinkAfter(box: HTMLElement) {
  expect(box.querySelector('a')).toBeNull();
  const back = box.nextElementSibling as HTMLAnchorElement | null;
  expect(back?.tagName).toBe('A');
  return back;
}

const RETRY = 'Thử tải lại tiến độ';
const retryButtons = () => Array.from(document.querySelectorAll('button'))
  .filter((b) => b.textContent === RETRY);

/** The retry button: right after `#cx-error`, never inside it, only one. */
function retryAfter(box: HTMLElement) {
  expect(box.querySelector('button')).toBeNull();
  expect(box.textContent).not.toContain(RETRY);
  const retry = box.nextElementSibling as HTMLButtonElement | null;
  expect(retry?.tagName).toBe('BUTTON');
  expect(retry?.textContent).toBe(RETRY);
  expect(retryButtons()).toHaveLength(1);
  return retry;
}

beforeEach(() => {
  wire.apiReady = true;
  wire.userId = 'student-1';
  (window as unknown as { api: unknown }).api = { get: vi.fn(), post: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const STORAGE_BADGE = 'Không lưu được trên trình duyệt này';
const mcq = { qid: 'Q1', type: 'mcq', subtype: 'A1', skill: 'X', item_key: 'k1',
  prompt: 'Câu 1?', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', points: 1 };

/** Bank read + the requests `runner.load()` makes for a fresh attempt. */
function bankApi(questions: unknown[]) {
  const api = window.api as unknown as {
    get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>;
  };
  api.get.mockImplementation(async (path: string) => {
    if (path.includes('/course-resume')) return { session_id: null, answered: [], completed: [], item_id: null };
    return { bank: { id: 'b1', title: 'Buổi 1' }, questions };
  });
  api.post.mockImplementation(async (path: string) => (
    path === '/api/quiz/sessions' ? { id: 'sess-1' } : { ok: true }));
  return api;
}

describe('course-exercises error states', () => {
  it('missing ?bank= shows a friendly link back to Lớp học, no connection badge, no progress frame', async () => {
    renderPage('');
    const box = await errorShown();
    expect(box.textContent).toContain('Liên kết bài tập chưa đầy đủ. Hãy mở bài từ Lớp học.');
    expect(document.body.textContent).not.toContain('?bank=');
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
    const back = backLinkAfter(box);
    expect(back?.getAttribute('href')).toBe('/my-class');
    expect(back?.textContent).toBe('Về Lớp học');
    expect(box.textContent).not.toContain('Về Lớp học');
    expect(el('cx-save-note').hidden).toBe(true);
    expect(el('cx-stage').hidden).toBe(true);
    expect(el('cx-loading').hidden).toBe(true);
    // Nothing was fetched for a link that names no bank.
    expect((window.api as unknown as { get: ReturnType<typeof vi.fn> }).get).not.toHaveBeenCalled();
  });

  it('missing window.api keeps the connection badge (negative control)', async () => {
    wire.apiReady = false;
    renderPage('');
    const box = await errorShown();
    expect(box.textContent).toContain('Không tải được thành phần kết nối');
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
    expect(box.querySelector('a[href="/my-class"]')).toBeNull();
    expect(document.querySelector('.cx-error-action')).toBeNull();
  });

  it('a 4xx refusal from the bank read is not shown as a connection error', async () => {
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('Không tìm thấy bài tập'), { status: 404 }));
    renderPage('?bank=bank-404');
    const box = await errorShown();
    expect(box.textContent).toContain('Không mở được bài tập: Không tìm thấy bài tập');
    expect(el('cx-save-note').hidden).toBe(true);
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
  });

  it('a load that never got an answer (no status) or a 5xx keeps the connection badge', async () => {
    const get = (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get;
    get.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage('?bank=bank-offline');
    await errorShown();
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
    cleanup();

    get.mockReset();
    get.mockRejectedValue(Object.assign(new Error('HTTP 503'), { status: 503 }));
    renderPage('?bank=bank-503');
    await errorShown();
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
  });

  it('the stage frame and save badge honour [hidden] despite their display rules', () => {
    // jsdom does not apply the stylesheet; `.cx-stage { display: grid }` made the
    // empty frame render while `hidden` (UIA-1030-01 screenshot).
    expect(CSS).toMatch(/\.cx-stage\[hidden\],\s*\.cx-save-note\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it('an empty bank is a neutral notice with a way back to Lớp học, not a connection error', async () => {
    const api = bankApi([]);
    renderPage('?bank=b1');
    const box = await errorShown();
    expect(box.textContent).toContain('Bài tập này chưa có câu hỏi.');
    expect(box.textContent).not.toContain('Không mở được bài tập');
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
    expect(el('cx-save-note').hidden).toBe(true);
    expect(el('cx-stage').hidden).toBe(true);
    expect(el('cx-loading').hidden).toBe(true);
    const back = backLinkAfter(box);
    expect(back?.getAttribute('href')).toBe('/my-class');
    expect(back?.textContent).toBe('Về Lớp học');
    // Reloading cannot produce questions: no retry button.
    expect(retryButtons()).toHaveLength(0);
    // The bank was read once; no quiz session was opened for it.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a browser storage failure says so on the badge instead of blaming the connection', async () => {
    bankApi([mcq]);
    // Blocked/corrupt storage: reading the saved-answer outbox throws.
    window.localStorage.setItem('unrelated', '1');
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderPage('?bank=b1');
    const box = await errorShown();
    expect(box.textContent).toContain('Không mở được bài tập: Chưa đọc được đáp án lưu trên máy.');
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(STORAGE_BADGE);
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
    // Storage may recover (permission granted, space freed): retry stays.
    retryAfter(box);
  });

  it('an untagged runner failure (course-resume read lost) keeps the connection badge (negative control)', async () => {
    const api = bankApi([mcq]);
    api.get.mockImplementation(async (path: string) => {
      if (path.includes('/course-resume')) throw new TypeError('Failed to fetch');
      return { bank: { id: 'b1', title: 'Buổi 1' }, questions: [mcq] };
    });
    renderPage('?bank=b1');
    const box = await errorShown();
    expect(box.textContent).toContain('Chưa tải được tiến độ đã lưu');
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
  });

  it('a throwing localStorage getter shows the storage sentence instead of hanging on "Đang mở bài tập…"', async () => {
    const api = bankApi([mcq]);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    renderPage('?bank=b1');
    const box = await errorShown();
    expect(el('cx-loading').hidden).toBe(true);
    expect(box.textContent).toContain(
      'Không lưu được trên trình duyệt này. Hãy tắt chế độ ẩn danh hoặc thử trình duyệt khác.');
    expect(box.textContent).not.toContain('insecure');
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(STORAGE_BADGE);
    expect(box.textContent).toBe(
      'Không lưu được trên trình duyệt này. Hãy tắt chế độ ẩn danh hoặc thử trình duyệt khác.');
    retryAfter(box);
    // No runner was built: nothing was read or opened.
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([408, 429])('a transient %i keeps the connection badge and the retry button', async (status) => {
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('HTTP ' + status), { status }));
    renderPage('?bank=b-' + status);
    const box = await errorShown();
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
    expect(box.textContent).toBe('Không mở được bài tập: HTTP ' + status);
    retryAfter(box);
  });

  it('a second failure (new run for another account) still leaves exactly one retry button', async () => {
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('HTTP 503'), { status: 503 }));
    const view = renderPage('?bank=b-twice');
    const box = await errorShown();
    retryAfter(box);
    // Account switch between tabs: the effect runs again on the same shell
    // and fails again with a different sentence.
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('HTTP 502'), { status: 502 }));
    wire.userId = 'student-2';
    view.rerender(<><CourseShell /><CourseBehavior /></>);
    await waitFor(() => expect(box.textContent).toBe('Không mở được bài tập: HTTP 502'));
    retryAfter(box);
  });

  it('a run that is torn down takes its retry button with it', async () => {
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('HTTP 503'), { status: 503 }));
    const view = renderPage('?bank=b-teardown');
    retryAfter(await errorShown());
    // Unmount only the behaviour island; the shell (and `#cx-error`) stays.
    view.rerender(<><CourseShell /></>);
    expect(retryButtons()).toHaveLength(0);
  });

  it.each([400, 403, 404])('a %i refusal still hides the connection badge', async (status) => {
    (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mockRejectedValue(Object.assign(new Error('HTTP ' + status), { status }));
    renderPage('?bank=b-' + status);
    await errorShown();
    expect(el('cx-save-note').hidden).toBe(true);
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
  });

  it('a storage failure while answering shows the storage sentence, not the runner text', async () => {
    bankApi([mcq]);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
    renderPage('?bank=b1');
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    (document.querySelector('.cx-opt') as HTMLButtonElement).click();
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(
      'Không lưu được trên trình duyệt này. Hãy tắt chế độ ẩn danh hoặc thử trình duyệt khác.');
    expect(document.body.textContent).not.toContain('Chưa lưu được đáp án trên máy');
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
    // The choice was not acknowledged: the options stay open to pick again.
    expect((document.querySelector('.cx-opt') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an answer error without a storage code still shows the runner text (negative control)', async () => {
    bankApi([mcq]);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
    renderPage('?bank=b1');
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    // Not via the storage path: the runner refuses with its own, uncoded message.
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Lỗi khác'); });
    (document.querySelector('.cx-opt') as HTMLButtonElement).click();
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe('Lỗi khác');
  });
});
