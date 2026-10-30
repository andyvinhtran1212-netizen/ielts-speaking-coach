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
//
// PC-J330 (Codex on #2039): switching accounts reruns the effect on the same
// shell. A 4xx / empty bank of the previous account hid the save badge and left
// its error sentence and actions; the new run starts from the shell's initial
// screen and hides the badge again only for its own 4xx / empty bank.
//
// PC-J339 (CR round 2 on #2039): the reset at the start of a run also puts the
// title, the stage frame and every content block (question, next, done,
// reading, listening, pronunciation, report) back to the shell's initial
// state, so account A's exercise is never shown next to account B's error.
// The idle badge sentence has one source (`course-copy.ts`).
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
import {
  COURSE_TITLE, COURSE_TITLE_META, SAVE_NOTE_IDLE,
} from '@/app/(authed)/course-exercises/course-copy';

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
function bankApi(questions: unknown[], title = 'Buổi 1') {
  const api = window.api as unknown as {
    get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>;
  };
  api.get.mockImplementation(async (path: string) => {
    if (path.includes('/course-resume')) return { session_id: null, answered: [], completed: [], item_id: null };
    return { bank: { id: 'b1', title }, questions };
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

describe('course-exercises account switch on the same shell (PC-J330)', () => {
  const getMock = () => (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get;
  const refuse = (status: number) => () => getMock()
    .mockRejectedValue(Object.assign(new Error('HTTP ' + status), { status }));

  function switchAccount(view: ReturnType<typeof render>, userId: string) {
    wire.userId = userId;
    view.rerender(<><CourseShell /><CourseBehavior /></>);
  }

  /** Nothing of a previous error screen is left; the badge shows. */
  function noErrorLeft() {
    expect(el('cx-error').hidden).toBe(true);
    expect(el('cx-error').textContent).toBe('');
    expect(document.querySelector('[data-cx-error-action]')).toBeNull();
    expect(retryButtons()).toHaveLength(0);
    expect(Array.from(document.querySelectorAll('a'))
      .filter((a) => a.textContent === 'Về Lớp học')).toHaveLength(0);
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').hasAttribute('hidden')).toBe(false);
  }

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
  });

  it.each([
    ['403', refuse(403)],
    ['404', refuse(404)],
    ['an empty bank', () => { bankApi([]); }],
  ])('account A gets %s, account B loads: badge back, no error or actions left', async (_case, failA) => {
    failA();
    const view = renderPage('?bank=b1');
    await errorShown();
    expect(el('cx-save-note').hidden).toBe(true);

    bankApi([mcq]);
    switchAccount(view, 'student-2');
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    noErrorLeft();
    expect(el('cx-save-note').dataset.state).toBe('idle');
    expect(el('cx-save-note-text').textContent).toBe(SAVE_NOTE_IDLE);
    expect(el('cx-loading').hidden).toBe(true);
  });

  it('account A gets 403, account B gets 503: the connection badge is visible', async () => {
    refuse(403)();
    const view = renderPage('?bank=b1');
    await errorShown();
    expect(el('cx-save-note').hidden).toBe(true);

    refuse(503)();
    switchAccount(view, 'student-2');
    await waitFor(() => expect(el('cx-error').textContent).toBe('Không mở được bài tập: HTTP 503'));
    expect(el('cx-save-note').hidden).toBe(false);
    expect(el('cx-save-note').dataset.state).toBe('error');
    expect(el('cx-save-note-text').textContent).toBe(CONNECTION_BADGE);
    retryAfter(el('cx-error'));
  });

  it('the new run starts from the initial screen before its load answers', async () => {
    refuse(404)();
    const view = renderPage('?bank=b1');
    await errorShown();

    // Account B's bank read never answers: only the reset is visible.
    getMock().mockImplementation(() => new Promise(() => {}));
    switchAccount(view, 'student-2');
    noErrorLeft();
    expect(el('cx-loading').hidden).toBe(false);
    expect(el('cx-stage').hidden).toBe(true);
    expect(el('cx-save-note').dataset.state).toBe('idle');
  });

  it('account A loads, account B gets 403: the badge is hidden for B', async () => {
    bankApi([mcq]);
    const view = renderPage('?bank=b1');
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    expect(el('cx-save-note').hidden).toBe(false);

    refuse(403)();
    switchAccount(view, 'student-2');
    await waitFor(() => expect(el('cx-error').textContent).toBe('Không mở được bài tập: HTTP 403'));
    expect(el('cx-error').hidden).toBe(false);
    expect(el('cx-save-note').hidden).toBe(true);
    expect(document.body.textContent).not.toContain(CONNECTION_BADGE);
  });
});

describe('course-exercises account switch clears the previous exercise (PC-J339)', () => {
  const getMock = () => (window.api as unknown as { get: ReturnType<typeof vi.fn> }).get;
  const refuse = (status: number) => () => getMock()
    .mockRejectedValue(Object.assign(new Error('HTTP ' + status), { status }));

  /** Content blocks a run draws into; all empty and hidden in CourseShell. */
  const BLOCKS = ['cx-q', 'cx-next', 'cx-done', 'cx-reading', 'cx-listening', 'cx-pronunciation', 'cx-report'];

  /** A bank whose title and question name the account that owns it. */
  const bankOf = (who: string) => bankApi(
    [{ ...mcq, qid: 'Q-' + who, prompt: `Câu của ${who}?` }], `Buổi của ${who}`);

  /** Account A opens its exercise and gets further into the session. */
  async function accountALoaded() {
    bankOf('A');
    const view = renderPage('?bank=b1');
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    expect(el('cx-title').textContent).toBe('Buổi của A');
    expect(el('cx-title-meta').textContent).not.toBe(COURSE_TITLE_META);
    expect(el('cx-q').hidden).toBe(false);
    expect(el('cx-q').textContent).toContain('Câu của A?');
    expect(el('cx-stage').hidden).toBe(false);
    expect(el('cx-stage-ticks').innerHTML).not.toBe('');
    // The other blocks are reached later in a session (stage end, reading,
    // listening, shadowing, report). The same run draws into them; stand in
    // for that so the reset is checked on every block, not only `#cx-q`.
    for (const id of BLOCKS.slice(1)) {
      el(id).hidden = false;
      el(id).innerHTML = `<p>Nội dung của A (${id})</p>`;
    }
    el('cx-report').dataset.crReady = '1';
    // A timed bank would also have shown the countdown.
    el('cx-timer').hidden = false;
    el('cx-timer').textContent = '⏱ 12:00';
    el('cx-timer').dataset.urgent = 'false';
    return view;
  }

  function switchAccount(view: ReturnType<typeof render>, userId: string) {
    wire.userId = userId;
    view.rerender(<><CourseShell /><CourseBehavior /></>);
  }

  /** Nothing of account A is left on the screen or in the shell. */
  function nothingOfA(except: string[] = []) {
    expect(document.body.textContent).not.toContain('của A');
    expect(el('cx-title').textContent).not.toBe('Buổi của A');
    for (const id of BLOCKS.filter((b) => !except.includes(b))) {
      expect(el(id).hidden, id).toBe(true);
      expect(el(id).innerHTML, id).toBe('');
    }
    expect(el('cx-report').dataset.crReady).toBeUndefined();
  }

  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
  });

  it.each([
    ['403', refuse(403), 'Không mở được bài tập: HTTP 403'],
    ['404', refuse(404), 'Không mở được bài tập: HTTP 404'],
    ['an empty bank', () => { bankApi([]); }, 'Bài tập này chưa có câu hỏi.'],
  ])('account A loads, account B gets %s: only B\'s error is shown', async (_case, failB, message) => {
    const view = await accountALoaded();

    failB();
    switchAccount(view, 'student-2');
    const box = await errorShown();
    await waitFor(() => expect(box.textContent).toContain(message));
    nothingOfA();
    expect(el('cx-title').textContent).toBe(COURSE_TITLE);
    expect(el('cx-title-meta').textContent).toBe(COURSE_TITLE_META);
    expect(el('cx-stage').hidden).toBe(true);
    expect(el('cx-stage-label').textContent).toBe('');
    expect(el('cx-stage-ticks').innerHTML).toBe('');
    expect(el('cx-timer').hidden).toBe(true);
    expect(el('cx-timer').textContent).toBe('');
    expect(el('cx-timer').dataset.urgent).toBeUndefined();
    expect(el('cx-loading').hidden).toBe(true);
    expect(el('cx-save-note').hidden).toBe(true);
  });

  it('account A loads, account B loads another exercise: only B\'s exercise is shown', async () => {
    const view = await accountALoaded();

    bankOf('B');
    switchAccount(view, 'student-2');
    await waitFor(() => expect(el('cx-title').textContent).toBe('Buổi của B'));
    await waitFor(() => expect(el('cx-q').textContent).toContain('Câu của B?'));
    // B's own question draws `#cx-q` and an (empty, for MCQ) `#cx-next`.
    nothingOfA(['cx-q', 'cx-next']);
    expect(el('cx-q').hidden).toBe(false);
    expect(el('cx-next').textContent).toBe('');
    expect(el('cx-error').hidden).toBe(true);
    expect(el('cx-save-note').dataset.state).toBe('idle');
    expect(el('cx-save-note-text').textContent).toBe(SAVE_NOTE_IDLE);
  });
});

describe('course-exercises account switch drops the previous run\'s late answers (PC-J340)', () => {
  type Mock = ReturnType<typeof vi.fn>;
  const api = () => window.api as unknown as { get: Mock; post: Mock };
  const refuse = (status: number) => () => api().get
    .mockRejectedValue(Object.assign(new Error('HTTP ' + status), { status }));

  const BLOCKS = ['cx-q', 'cx-next', 'cx-done', 'cx-reading', 'cx-listening', 'cx-pronunciation', 'cx-report'];

  /** A request the test answers by hand, after the account switch. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  /** `count` questions whose title and prompts name the account that owns them. */
  function bankOf(who: string, count = 1) {
    const questions = Array.from({ length: count }, (_v, i) => (
      { ...mcq, qid: `Q-${who}-${i}`, prompt: `Câu ${i + 1} của ${who}?` }));
    return bankApi(questions, `Buổi của ${who}`);
  }

  async function accountALoaded(count = 1) {
    bankOf('A', count);
    const view = renderPage('?bank=b1');
    await waitFor(() => expect(el('cx-title').textContent).toBe('Buổi của A'));
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    return view;
  }

  /** The delegated click handler reacts to ids; stand in for a drawn button. */
  function click(id: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    document.body.appendChild(button);
    button.click();
    button.remove();
  }

  function switchAccount(view: ReturnType<typeof render>, userId: string) {
    wire.userId = userId;
    view.rerender(<><CourseShell /><CourseBehavior /></>);
  }

  async function bLoaded() {
    await waitFor(() => expect(el('cx-title').textContent).toBe('Buổi của B'));
    await waitFor(() => expect(el('cx-q').textContent).toContain('Câu 1 của B?'));
  }

  async function bRefused() {
    await waitFor(() => expect(el('cx-error').textContent).toBe('Không mở được bài tập: HTTP 403'));
  }

  /** Let every queued callback of the released request run. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  function nothingOfA(except: string[] = []) {
    expect(document.body.textContent).not.toContain('của A');
    expect(el('cx-title').textContent).not.toBe('Buổi của A');
    for (const id of BLOCKS.filter((b) => !except.includes(b))) {
      expect(el(id).hidden, id).toBe(true);
      expect(el(id).innerHTML, id).toBe('');
    }
    expect(el('cx-report').dataset.crReady).toBeUndefined();
  }

  let scrollIntoView: Mock;
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
    scrollIntoView = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  /** Account A opens its report; the report read hangs until released. */
  async function reportPendingForA() {
    const view = await accountALoaded();
    const report = deferred<unknown>();
    const bankGet = api().get.getMockImplementation()!;
    api().get.mockImplementation((path: string) => (
      path.startsWith('/api/quiz/course/report') ? report.promise : bankGet(path)));
    click('cx-see-report');
    await waitFor(() => expect(el('cx-report').textContent).toContain('Đang dựng phần tự review…'));
    return { view, report };
  }

  /** A report that names account A wherever the renderer shows text. */
  const REPORT_OF_A = {
    questions: [],
    stale: false,
    summary: { latest_pct: 88, latest_action: 'passed', pass_pct: 70 },
    history: [{ phase: 'run', completed: true, next_action: 'passed', pct: 88, label: 'Lượt của A' }],
  };

  it.each([
    ['B loads its exercise', () => { bankOf('B'); }, bLoaded, ['cx-q', 'cx-next']],
    ['B gets 403', refuse(403), bRefused, []],
  ])('account A\'s report answers after the switch (%s): nothing of A is drawn', async (_case, setupB, waitB, except) => {
    const { view, report } = await reportPendingForA();

    setupB();
    switchAccount(view, 'student-2');
    await waitB();

    report.resolve(REPORT_OF_A);
    await settle();
    nothingOfA(except as string[]);
    expect(el('cx-report').querySelector('.cr')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('account A\'s report fails after the switch: its error sentence is not drawn', async () => {
    const { view, report } = await reportPendingForA();

    refuse(403)();
    switchAccount(view, 'student-2');
    await bRefused();

    report.reject(new Error('lỗi báo cáo của A'));
    await settle();
    nothingOfA();
    expect(el('cx-report').textContent).not.toContain('Chưa đọc được phần tự review');
  });

  it.each([
    ['B loads its exercise', () => { bankOf('B'); }, bLoaded, ['cx-q', 'cx-next']],
    ['B gets 403', refuse(403), bRefused, []],
  ])('account A\'s stage advance fails after the switch (%s): the badge keeps B\'s state', async (_case, setupB, waitB, except) => {
    // Eleven questions = two stages, so "Làm chặng 2" opens a new session.
    const view = await accountALoaded(11);
    const opened = deferred<unknown>();
    const post = api().post.getMockImplementation()!;
    api().post.mockImplementation((path: string, body: unknown) => (
      path === '/api/quiz/sessions' ? opened.promise : post(path, body)));
    click('cx-more');
    await waitFor(() => expect(api().post).toHaveBeenCalledWith('/api/quiz/sessions', expect.anything()));

    setupB();
    switchAccount(view, 'student-2');
    await waitB();
    const badgeState = el('cx-save-note').dataset.state;
    const badgeText = el('cx-save-note-text').textContent;
    const badgeHidden = el('cx-save-note').hidden;

    opened.reject(new Error('phiên của A đã bị thay'));
    await settle();
    nothingOfA(except as string[]);
    expect(el('cx-save-note-text').textContent).not.toContain('Chưa chuyển được chặng');
    expect(el('cx-save-note').dataset.state).toBe(badgeState);
    expect(el('cx-save-note-text').textContent).toBe(badgeText);
    expect(el('cx-save-note').hidden).toBe(badgeHidden);
  });

  it('without an account switch the report still draws (negative control)', async () => {
    const { report } = await reportPendingForA();
    report.resolve(REPORT_OF_A);
    await waitFor(() => expect(el('cx-report').querySelector('.cr')).not.toBeNull());
    expect(el('cx-report').hidden).toBe(false);
    expect(el('cx-report').dataset.crReady).toBe('1');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
