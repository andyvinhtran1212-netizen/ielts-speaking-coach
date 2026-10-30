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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({ apiReady: true }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'student-1' } }),
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

beforeEach(() => {
  wire.apiReady = true;
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
    const back = box.querySelector('a');
    expect(back?.getAttribute('href')).toBe('/my-class');
    expect(back?.textContent).toBe('Về Lớp học');
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
    const back = box.querySelector('a');
    expect(back?.getAttribute('href')).toBe('/my-class');
    expect(back?.textContent).toBe('Về Lớp học');
    // Reloading cannot produce questions: no retry button.
    expect(box.querySelector('button')).toBeNull();
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
    expect(box.querySelector('button')?.textContent).toBe('Thử tải lại tiến độ');
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
});
