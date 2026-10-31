// PC-J352 (CR P3 on #2044) — timers and callbacks INSIDE the course-*.js
// modules after an account switch.
//
// PC-J340 guards every DOM write of `course-behavior.tsx` with `disposed`. The
// modules themselves never write the DOM, but some of their work can still run
// after the behavior of account A was torn down. This file pins, module by
// module, what such late work may still do:
//
// - course-writing.js: a `load()` that answers after the switch used to push
//   A's local draft to `/writing/draft` with a NEW request — and that request
//   takes the token of whoever is signed in by then (account B). `dispose()`
//   stops it, and stops the 1.5 s autosave timer.
// - course-pronunciation.js: `destroy()` (already called by the behavior)
//   stops the microphone request and the recorder `stop` handler.
// - course-reading.js / course-listening.js: a submit that answers late only
//   updates module state and A's own local draft key; no DOM, no request.
// - course-report.js: the click handler is bound once per report root and only
//   reads that root's DOM, so it is reused, not doubled, after the switch.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({ userId: 'student-A' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: wire.userId } }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({
  whenGlobalReady: vi.fn(async () => true),
}));

import { CourseBehavior } from '@/app/(authed)/course-exercises/course-behavior';
import { CourseShell } from '@/app/(authed)/course-exercises/page-shell';
import { createWriting, draftKey, PUSH_DELAY_MS } from '@/public/js/course-writing.js';
import { createPronunciation } from '@/public/js/course-pronunciation.js';
import { createReading, readingDraftKey } from '@/public/js/course-reading.js';
import { createListening, listeningDraftKey } from '@/public/js/course-listening.js';
import { bindReport } from '@/public/js/course-report.js';

type Mock = ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let every queued callback of a released request run. */
const settle = () => new Promise((r) => setTimeout(r, 20));

function memStore() {
  const m = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { writes.push(k); m.set(k, String(v)); },
    removeItem: (k: string) => { writes.push(k); m.delete(k); },
  };
}

const drafts = (post: Mock) => post.mock.calls
  .filter(([path]) => String(path).includes('/writing/draft'));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('course-writing.js after the behavior is disposed (PC-J352)', () => {
  const WQ = [{ qid: 'E1', prompt: 'Viết lại câu 1', subtype: 'E1' }];

  it('a load that answers after dispose does not push the local draft', async () => {
    const storage = memStore();
    storage.setItem(draftKey('b1', 'student-A', 'item-A'), JSON.stringify({ E1: 'bài của A' }));
    const read = deferred<unknown>();
    const api = { get: vi.fn(() => read.promise), post: vi.fn(async () => ({})) };
    const writing = createWriting({ api, storage, userId: 'student-A' });

    const loading = writing.load('b1');
    writing.dispose();
    read.resolve({ questions: WQ, submitted: false, item_id: 'item-A', draft: null });
    await loading;
    await settle();

    expect(drafts(api.post)).toHaveLength(0);
  });

  it('dispose cancels the autosave timer of a draft typed just before', async () => {
    vi.useFakeTimers();
    const api = {
      get: vi.fn(async () => ({ questions: WQ, submitted: false, item_id: 'item-A', draft: null })),
      post: vi.fn(async () => ({})),
    };
    const writing = createWriting({ api, storage: memStore(), userId: 'student-A' });
    await writing.load('b1');

    writing.write('E1', 'A gõ dở');
    writing.dispose();
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS * 2);

    expect(drafts(api.post)).toHaveLength(0);
  });

  it('without dispose the same load and typing still push (negative control)', async () => {
    vi.useFakeTimers();
    const storage = memStore();
    storage.setItem(draftKey('b1', 'student-A', 'item-A'), JSON.stringify({ E1: 'bài của A' }));
    const api = {
      get: vi.fn(async () => ({ questions: WQ, submitted: false, item_id: 'item-A', draft: null })),
      post: vi.fn(async () => ({})),
    };
    const writing = createWriting({ api, storage, userId: 'student-A' });
    await writing.load('b1');
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts(api.post)).toHaveLength(1);

    writing.write('E1', 'bài của A, sửa lại');
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS);
    expect(drafts(api.post)).toHaveLength(2);
    expect(drafts(api.post)[1][1]).toMatchObject({ class_item: 'item-A', answers: { E1: 'bài của A, sửa lại' } });
  });
});

describe('course-exercises account switch: the writing load of account A (PC-J352)', () => {
  const mcq = { qid: 'Q1', type: 'mcq', subtype: 'A1', skill: 'X', item_key: 'k1',
    prompt: 'Câu 1?', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', points: 1 };
  const api = () => window.api as unknown as { get: Mock; post: Mock; postWith: Mock };

  /** The bank answers at once; the writing read of account A hangs. */
  function bankWithHangingWriting() {
    const writingRead = deferred<unknown>();
    let writingReads = 0;
    api().get.mockImplementation(async (path: string) => {
      if (path.includes('/course-resume')) return { session_id: null, answered: [], completed: [], item_id: null };
      if (path.startsWith('/api/quiz/course/writing')) {
        writingReads += 1;
        // Only A's first read hangs; B's own read answers "no writing".
        if (writingReads === 1) return writingRead.promise;
        return { questions: [], submitted: false, item_id: 'item-B', draft: null };
      }
      return { bank: { id: 'b1', title: 'Buổi 1' }, questions: [mcq] };
    });
    api().post.mockImplementation(async (path: string) => (
      path === '/api/quiz/sessions' ? { id: 'sess-1' } : { ok: true }));
    return writingRead;
  }

  function renderPage() {
    window.history.replaceState({}, '', '/course-exercises?bank=b1');
    return render(<><CourseShell /><CourseBehavior /></>);
  }

  async function aLoadedWithHangingWriting() {
    window.localStorage.setItem(draftKey('b1', 'student-A', 'item-A'), JSON.stringify({ E1: 'bài của A' }));
    const writingRead = bankWithHangingWriting();
    const view = renderPage();
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    await waitFor(() => expect(api().get.mock.calls
      .some(([p]) => String(p).startsWith('/api/quiz/course/writing'))).toBe(true));
    return { view, writingRead };
  }

  const answerA = (writingRead: { resolve: (v: unknown) => void }) => writingRead.resolve({
    questions: [{ qid: 'E1', prompt: 'Viết lại câu 1', subtype: 'E1' }],
    submitted: false, item_id: 'item-A', draft: null,
  });

  beforeEach(() => {
    wire.userId = 'student-A';
    (window as unknown as { api: unknown }).api = {
      get: vi.fn(), post: vi.fn(), postWith: vi.fn(async () => ({})),
    };
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented
  });

  it('A\'s writing read answers after the switch: A\'s draft is not sent', async () => {
    const { view, writingRead } = await aLoadedWithHangingWriting();

    wire.userId = 'student-B';
    view.rerender(<><CourseShell /><CourseBehavior /></>);
    await waitFor(() => expect(api().get.mock.calls
      .filter(([p]) => String(p).startsWith('/api/quiz/course/writing'))).toHaveLength(2));

    answerA(writingRead);
    await settle();

    const sent = [...drafts(api().post), ...drafts(api().postWith)];
    expect(sent).toHaveLength(0);
  });

  it('without an account switch the same answer still sends A\'s draft (negative control)', async () => {
    const { writingRead } = await aLoadedWithHangingWriting();

    answerA(writingRead);
    await waitFor(() => expect(drafts(api().post)).toHaveLength(1));
    expect(drafts(api().post)[0][1]).toMatchObject({ class_item: 'item-A', answers: { E1: 'bài của A' } });
  });
});

describe('course-pronunciation.js destroy() (PC-J352)', () => {
  const exercise = { title: 'Phát âm', playback_rates: [0.85, 1],
    sentences: [{ id: 'S1', order: 1, text: 'Hello.', audio_url: '/a.mp3' }] };

  function memoryDraftStore() {
    const puts: string[] = [];
    const values = new Map<string, unknown>();
    return {
      puts,
      async get(key: string) { return values.has(key) ? values.get(key) : null; },
      async put(key: string, value: unknown) { puts.push(key); values.set(key, value); },
      async delete(keys: string[]) { keys.forEach((k) => values.delete(k)); },
    };
  }

  function microphone() {
    const permission = deferred<unknown>();
    const stopped: number[] = [];
    let recorder: FakeRecorder | null = null;
    class FakeRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      state = 'inactive';
      mimeType = 'audio/webm';
      constructor() { super(); recorder = this; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
      /** The browser delivers the data and `stop` events later, on its own. */
      deliver() {
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['x']) }));
        this.dispatchEvent(new Event('stop'));
      }
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true, value: { getUserMedia: () => permission.promise },
    });
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
    const stream = { getTracks: () => [{ stop: () => { stopped.push(1); } }] };
    return { permission, stream, stopped, recorder: () => recorder };
  }

  afterEach(() => {
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  });

  async function loaded(draftStore = memoryDraftStore()) {
    const pronunciation = createPronunciation({
      api: { get: async () => ({ exercise, latest_attempt: null }) },
      userId: 'student-A', draftStore,
    });
    await pronunciation.load('b1');
    draftStore.puts.length = 0;
    return { pronunciation, draftStore };
  }

  it('a microphone permission granted after destroy is stopped, no recorder starts', async () => {
    const mic = microphone();
    const { pronunciation } = await loaded();
    const starting = pronunciation.toggleRecording();
    pronunciation.destroy();
    mic.permission.resolve(mic.stream);

    expect(await starting).toBe(false);
    expect(mic.stopped).toHaveLength(1);
    expect(mic.recorder()).toBeNull();
    expect(pronunciation.isRecording).toBe(false);
  });

  it('a recording stopped by destroy does not keep or store the late recording', async () => {
    const mic = microphone();
    const createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    const { pronunciation, draftStore } = await loaded();
    const starting = pronunciation.toggleRecording();
    mic.permission.resolve(mic.stream);
    expect(await starting).toBe(true);

    pronunciation.destroy();
    mic.recorder()!.deliver();
    await settle();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(draftStore.puts).toHaveLength(0);
    expect(mic.stopped.length).toBeGreaterThanOrEqual(1);
    expect(pronunciation.isRecording).toBe(false);
  });

  it('without destroy the same stop keeps and stores the recording (negative control)', async () => {
    const mic = microphone();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    const { pronunciation, draftStore } = await loaded();
    const starting = pronunciation.toggleRecording();
    mic.permission.resolve(mic.stream);
    expect(await starting).toBe(true);

    mic.recorder()!.stop();
    mic.recorder()!.deliver();
    await settle();

    expect(draftStore.puts).toEqual(['student-A:b1:S1']);
  });
});

describe('course-reading.js / course-listening.js: a submit answering late (PC-J352)', () => {
  // These modules have no timer and no listener; their only late work is the
  // continuation of `reveal()`. It touches module state and the CALLER's own
  // draft key, never the DOM and never another request.
  const cases = [
    ['reading', () => {
      const storage = memStore();
      const solution = deferred<unknown>();
      const api = { post: vi.fn(() => solution.promise) };
      const mod = createReading({ api, storage, userId: 'student-A', assignmentItemId: 'item-A' });
      mod.load({ id: 'b1', meta: { short_reading: { title: 'Bài đọc của A',
        question_groups: [{ id: 'content', input_type: 'text', questions: [{ id: 'R1', number: 1 }] }] } } });
      mod.write('R1', 'đáp án của A');
      return { mod, storage, api, solution, key: readingDraftKey('b1', 'student-A', 'item-A') };
    }],
    ['listening', () => {
      const storage = memStore();
      const solution = deferred<unknown>();
      const api = { post: vi.fn(() => solution.promise) };
      const mod = createListening({ api, storage, userId: 'student-A', assignmentItemId: 'item-A' });
      mod.load({ id: 'b1', meta: { short_listening: { title: 'Bài nghe của A',
        sections: [{ id: 's1', questions: [{ id: 'L1', number: 1, options: ['x', 'y'] }] }] } } });
      mod.write('L1', 'A');
      return { mod, storage, api, solution, key: listeningDraftKey('b1', 'student-A', 'item-A') };
    }],
  ] as const;

  it.each(cases)('%s: only A\'s own draft key is written, nothing else happens', async (_name, make) => {
    const { mod, storage, api, solution, key } = make();
    document.body.innerHTML = '<main id="probe">màn của B</main>';
    storage.writes.length = 0;

    const revealing = mod.reveal();
    solution.resolve({ answers: [], result: { correct: 1, total: 1, pct: 100 } });
    expect(await revealing).toBe(true);
    await settle();

    expect(storage.writes).toEqual([key]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).toBe('<main id="probe">màn của B</main>');
  });
});

describe('course-report.js bindReport across runs (PC-J352)', () => {
  it('binding the same root again (the next account\'s run) does not double the click handler', () => {
    const root = document.createElement('section');
    root.innerHTML = '<div class="cr-axis"><button class="cr-axis__head" aria-expanded="false">Trục</button>'
      + '<ol class="cr-qs" hidden><li>câu</li></ol></div>';
    document.body.appendChild(root);
    bindReport(root);   // account A's run
    bindReport(root);   // account B's run, same shell node

    root.querySelector<HTMLElement>('.cr-axis__head')!.click();

    expect(root.querySelector<HTMLElement>('.cr-qs')!.hidden).toBe(false);
    expect(root.querySelector('.cr-axis__head')!.getAttribute('aria-expanded')).toBe('true');
    root.remove();
  });
});
