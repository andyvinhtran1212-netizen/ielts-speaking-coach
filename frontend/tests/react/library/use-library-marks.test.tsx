// LIBRARY-0061 T016 (FR-060, FR-061): useLibraryMarks reads the caller's marks,
// changes one only after the server took it (never optimistic), keeps the old
// state with words on failure, and never sends a public page to /login.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MARK_GONE_ERROR, MARK_WRITE_ERROR, useLibraryMarks, type LibraryMarkShelf,
} from '@/components/library/use-library-marks';

type Deferred = { resolve: (v?: unknown) => void; reject: (e: unknown) => void };
let api: { getWith: ReturnType<typeof vi.fn>; patchWith: ReturnType<typeof vi.fn>; deleteWith: ReturnType<typeof vi.fn> };
const originalApi = window.api;

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function deferred() {
  let d!: Deferred;
  const promise = new Promise((resolve, reject) => { d = { resolve, reject }; });
  return { promise, ...d };
}

// A fake server holding the marks; reads return what it holds now.
let server: Set<string>;
const key = (item: string, kind: string) => `${kind}:${item}`;
function serverMarks() {
  return { marks: [...server].map((k) => { const [kind, ...rest] = k.split(':'); return { item_key: rest.join(':'), kind }; }) };
}

beforeEach(() => {
  server = new Set([key('alpha-schools', 'read')]);
  api = {
    getWith: vi.fn(async () => serverMarks()),
    patchWith: vi.fn(async (path: string, body: { item_key: string }) => { server.add(key(body.item_key, path.split('/').pop()!)); return null; }),
    deleteWith: vi.fn(async (path: string, body: { item_key: string }) => { server.delete(key(body.item_key, path.split('/').pop()!)); return null; }),
  };
  window.api = api as unknown as typeof window.api;
});

afterEach(() => {
  cleanup();
  window.api = originalApi;
});

let hook: ReturnType<typeof useLibraryMarks>;
function Probe({ shelf = 'writing_sample', signedIn = true }: { shelf?: LibraryMarkShelf; signedIn?: boolean }) {
  hook = useLibraryMarks(shelf, { signedIn });
  return (
    <output data-testid="probe">
      {hook.status}|{hook.has('alpha-schools', 'read') ? 'read' : '-'}|{hook.has('alpha-schools', 'saved') ? 'saved' : '-'}|{hook.isPending('alpha-schools', 'saved') ? 'pending' : '-'}|{hook.errorFor('alpha-schools', 'saved')}
    </output>
  );
}
const probe = () => screen.getByTestId('probe').textContent;
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

describe('useLibraryMarks', () => {
  it('signed out: no request, no marks', async () => {
    render(<Probe signedIn={false} />);
    await flush();
    expect(api.getWith).not.toHaveBeenCalled();
    expect(probe()).toBe('idle|-|-|-|');
  });

  it('loads the shelf with noRedirect and answers has()', async () => {
    render(<Probe />);
    expect(probe()).toBe('loading|-|-|-|');
    await flush();
    expect(api.getWith).toHaveBeenCalledWith('/api/library/me/marks?shelf=writing_sample', undefined, { noRedirect: true });
    expect(probe()).toBe('ready|read|-|-|');
  });

  it('a mark shows only after the server answered and the shelf was read again', async () => {
    const write = deferred();
    api.patchWith.mockImplementationOnce(async (path: string, body: { item_key: string }) => {
      await write.promise;
      server.add(key(body.item_key, path.split('/').pop()!));
      return null;
    });
    render(<Probe />);
    await flush();
    let done!: Promise<boolean>;
    act(() => { done = hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('ready|read|-|pending|');
    expect(api.patchWith).toHaveBeenCalledWith('/api/library/me/marks/writing_sample/saved', { item_key: 'alpha-schools' }, undefined, { noRedirect: true });
    // A second click on the same mark while the first is in flight is refused.
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', true)).toBe(false); });
    expect(api.patchWith).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve(null); expect(await done).toBe(true); });
    expect(probe()).toBe('ready|read|saved|-|');
    expect(api.getWith).toHaveBeenCalledTimes(2);
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', false)).toBe(true); });
    expect(api.deleteWith).toHaveBeenCalledWith('/api/library/me/marks/writing_sample/saved', { item_key: 'alpha-schools' }, undefined, { noRedirect: true });
    expect(probe()).toBe('ready|read|-|-|');
  });

  it('after a write the screen shows the server, including a change made in another tab', async () => {
    render(<Probe />);
    await flush();
    server.delete(key('alpha-schools', 'read')); // another tab cleared "read"
    await act(async () => { await hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('ready|-|saved|-|');
  });

  it('rereads that answer out of order: only the newest is shown', async () => {
    render(<Probe />);
    await flush();
    const slow = deferred();
    const fast = deferred();
    api.getWith
      .mockImplementationOnce(async () => { await slow.promise; return { marks: [] }; })
      .mockImplementationOnce(async () => { await fast.promise; return serverMarks(); });
    let one!: Promise<boolean>;
    let two!: Promise<boolean>;
    await act(async () => { one = hook.setMark('alpha-schools', 'saved', true); await Promise.resolve(); });
    await act(async () => { two = hook.setMark('beta-uniforms', 'read', true); await Promise.resolve(); });
    await act(async () => { fast.resolve(); await two; });
    expect(hook.has('beta-uniforms', 'read')).toBe(true);
    await act(async () => { slow.resolve(); await one; });
    // The older, empty reread arrived last and changed nothing.
    expect(probe()).toBe('ready|read|saved|-|');
  });

  it('reload or a shelf change during a write: nothing stays pending and the old answer changes nothing', async () => {
    const write = deferred();
    api.patchWith.mockImplementationOnce(async () => { await write.promise; return null; });
    const { rerender } = render(<Probe />);
    await flush();
    let done!: Promise<boolean>;
    act(() => { done = hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('ready|read|-|pending|');
    act(() => { hook.reload(); });
    await flush();
    expect(probe()).toBe('ready|read|-|-|');
    rerender(<Probe shelf="speaking_sample" />);
    await flush();
    await act(async () => { write.resolve(null); expect(await done).toBe(false); });
    expect(probe()).toBe('ready|read|-|-|');
    // The same mark can be changed normally afterwards.
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', true)).toBe(true); });
    expect(probe()).toBe('ready|read|saved|-|');
  });

  it('a confirmed write whose reread fails still shows the write', async () => {
    render(<Probe />);
    await flush();
    api.getWith.mockRejectedValueOnce(httpError(503));
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', true)).toBe(true); });
    expect(probe()).toBe('ready|read|saved|-|');
  });

  it('a Grammar key keeps its slash in the body, never in the path', async () => {
    server = new Set();
    render(<Probe shelf="grammar_article" />);
    await flush();
    await act(async () => { await hook.setMark('tenses/past-perfect', 'read', true); });
    expect(api.patchWith).toHaveBeenCalledWith('/api/library/me/marks/grammar_article/read', { item_key: 'tenses/past-perfect' }, undefined, { noRedirect: true });
    expect(hook.has('tenses/past-perfect', 'read')).toBe(true);
  });

  it('a failed write keeps the old state and says why', async () => {
    api.patchWith.mockRejectedValueOnce(httpError(503));
    render(<Probe />);
    await flush();
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', true)).toBe(false); });
    expect(probe()).toBe(`ready|read|-|-|${MARK_WRITE_ERROR}`);
    api.patchWith.mockRejectedValueOnce(httpError(404));
    await act(async () => { await hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe(`ready|read|-|-|${MARK_GONE_ERROR}`);
    // The next attempt clears the message and succeeds.
    await act(async () => { await hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('ready|read|saved|-|');
  });

  it('an expired session hides the marks instead of redirecting', async () => {
    api.getWith.mockRejectedValueOnce(httpError(401));
    render(<Probe />);
    await flush();
    expect(probe()).toBe('signed-out|-|-|-|');
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', true)).toBe(false); });
    expect(api.patchWith).not.toHaveBeenCalled();
  });

  it('a write answered 401 signs the marks out', async () => {
    api.patchWith.mockRejectedValueOnce(httpError(401));
    render(<Probe />);
    await flush();
    await act(async () => { await hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('signed-out|-|-|-|');
  });

  it('a load failure is an error state; reload tries again', async () => {
    api.getWith.mockRejectedValueOnce(httpError(503));
    render(<Probe />);
    await flush();
    expect(probe()).toBe('error|-|-|-|');
    act(() => { hook.reload(); });
    await flush();
    expect(probe()).toBe('ready|read|-|-|');
  });
});
