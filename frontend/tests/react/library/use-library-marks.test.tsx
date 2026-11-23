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

beforeEach(() => {
  api = {
    getWith: vi.fn().mockResolvedValue({ marks: [{ item_key: 'alpha-schools', kind: 'read' }] }),
    patchWith: vi.fn().mockResolvedValue(null),
    deleteWith: vi.fn().mockResolvedValue(null),
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
const flush = () => act(async () => { await Promise.resolve(); });

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

  it('a mark shows only after the server answered; the body carries the key', async () => {
    const write = deferred();
    api.patchWith.mockReturnValueOnce(write.promise);
    render(<Probe />);
    await flush();
    let done!: Promise<boolean>;
    act(() => { done = hook.setMark('alpha-schools', 'saved', true); });
    expect(probe()).toBe('ready|read|-|pending|');
    expect(api.patchWith).toHaveBeenCalledWith('/api/library/me/marks/writing_sample/saved', { item_key: 'alpha-schools' }, undefined, { noRedirect: true });
    await act(async () => { write.resolve(null); await done; });
    expect(probe()).toBe('ready|read|saved|-|');
    await act(async () => { expect(await hook.setMark('alpha-schools', 'saved', false)).toBe(true); });
    expect(api.deleteWith).toHaveBeenCalledWith('/api/library/me/marks/writing_sample/saved', { item_key: 'alpha-schools' }, undefined, { noRedirect: true });
    expect(probe()).toBe('ready|read|-|-|');
  });

  it('a Grammar key keeps its slash in the body, never in the path', async () => {
    api.getWith.mockResolvedValueOnce({ marks: [] });
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
