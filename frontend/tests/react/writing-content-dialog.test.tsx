import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWritingContentDialog } from '@/lib/writing-content-dialog';
import { WRITING_CONTENT_MARKER, WRITING_LIBRARY_MARKER, readWritingContentQuery, createWritingContentMarker } from '@/lib/writing-content-navigation.mjs';

let dispose: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState({ nextOwned: 'preserve' }, '', '/writing/dashboard?tab=tips');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { dispose?.(); dispose = undefined; cleanup(); document.body.style.overflow = ''; });
function setup(read = vi.fn(async () => ({ enabled: true, items: [{ id: 't1', title: 'Canonical tip' }] }))) {
  render(<><main><button id="tab-assignments">Assignments</button><button id="tab-tips">Tips</button>
    <button data-tip-id="t1">Read tip</button></main><div id="submit-modal" className="hidden"><button id="modal-close">Submit close</button></div>
    <div id="tip-modal" className="hidden" role="dialog" aria-modal="true" aria-labelledby="tip-modal-title">
      <h2 id="tip-modal-title" /><p id="tip-modal-meta" /><button id="tip-modal-close">Close</button><div id="tip-modal-body" />
    </div></>);
  const selectTab = vi.fn();
  const controller = createWritingContentDialog({ account: 'a', current: () => true, read,
    render: (_kind, item) => { document.getElementById('tip-modal-title')!.textContent = item.title; },
    selectTab, filters: () => ({ tipFilter: 'all', tipTypeFilter: 'all', pbFilter: 'all' }), restoreFilters: vi.fn() });
  dispose = controller.dispose;
  return { controller, card: screen.getByRole('button', { name: 'Read tip' }), read, selectTab };
}
it('FR002/005: one explicit entry, immediate focus, trap and inert background', async () => {
  const { controller, card } = setup();
  const push = vi.spyOn(window.history, 'pushState');
  expect(controller.activate('tip', 't1', card)).toBe(true);
  expect(controller.activate('tip', 't1', card)).toBe(false);
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.history.state.nextOwned).toBe('preserve');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  expect(document.querySelector('main')!.getAttribute('aria-hidden')).toBe('true');
  const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
  controller.keydown(tab);
  expect(tab.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('ready'));
});
it('FR003/005: direct-link Escape replaces and returns stable tab focus', async () => {
  window.history.replaceState({ nextOwned: 'preserve' }, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller } = setup();
  const back = vi.spyOn(window.history, 'back');
  await controller.reconcile();
  controller.keydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(back).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?tab=tips');
  expect(document.activeElement).toBe(document.getElementById('tab-tips'));
  expect(document.querySelector('main')!.hasAttribute('aria-hidden')).toBe(false);
});
it('FR003: surviving reload ownership uses Back; damaged marker replaces', async () => {
  const query = readWritingContentQuery('tab=tips&tip=t1');
  window.history.replaceState({ [WRITING_CONTENT_MARKER]: createWritingContentMarker('a', query.item, 'entry-1'),
    [WRITING_LIBRARY_MARKER]: { version: 1, account: 'a', tab: 'tips', id: 'entry-1', scroll: 0, tipFilter: 'all', tipTypeFilter: 'all', pbFilter: 'all' } }, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller } = setup();
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  await controller.reconcile(); controller.close();
  expect(back).toHaveBeenCalledTimes(1);
});
it.each(['missing', 'mismatched'])('FR003: surviving content marker with %s library owner replaces', async damage => {
  const query = readWritingContentQuery('tab=tips&tip=t1');
  const state: any = { [WRITING_CONTENT_MARKER]: createWritingContentMarker('a', query.item, 'entry-1') };
  if (damage === 'mismatched') state[WRITING_LIBRARY_MARKER] = { version: 1, account: 'a', tab: 'tips', id: 'other', scroll: 0, tipFilter: 'all', tipTypeFilter: 'all', pbFilter: 'all' };
  window.history.replaceState(state, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller } = setup();
  const back = vi.spyOn(window.history, 'back');
  await controller.reconcile(); controller.close();
  expect(back).not.toHaveBeenCalled(); expect(location.search).toBe('?tab=tips');
});
it('FR004: closing a pending read prevents late reopening and clears body', async () => {
  let release!: (result: any) => void;
  const read = vi.fn(() => new Promise<any>(resolve => { release = resolve; }));
  window.history.replaceState({}, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller } = setup(read);
  const pending = controller.reconcile();
  expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('loading');
  controller.close(); release({ enabled: true, items: [{ id: 't1', title: 'Late old body' }] }); await pending;
  expect(document.getElementById('tip-modal')!.classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tip-modal-body')!.textContent).toBe('');
});
it('FR001/004/005: late submit visibility yields inert/focus without touching owner state', async () => {
  let release!: (result: any) => void;
  const read = vi.fn(() => new Promise<any>(resolve => { release = resolve; }));
  window.history.replaceState({ submitOwner: 'preserve' }, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller } = setup(read);
  const pending = controller.reconcile(), oldState = window.history.state, oldURL = location.href;
  document.getElementById('submit-modal')!.classList.remove('hidden');
  await waitFor(() => expect(document.getElementById('tip-modal')!.classList.contains('hidden')).toBe(true));
  expect(document.activeElement).toBe(document.getElementById('modal-close'));
  expect(document.querySelector('main')!.hasAttribute('aria-hidden')).toBe(false);
  expect(document.getElementById('submit-modal')!.inert).toBeFalsy();
  expect(window.history.state).toEqual(oldState); expect(location.href).toBe(oldURL);
  release({ enabled: true, items: [{ id: 't1', title: 'Late old body' }] }); await pending;
  expect(document.getElementById('tip-modal-title')!.textContent).toBe('');
  expect(document.getElementById('tip-modal-body')!.textContent).toBe('');
});
it('FR004: disposing disconnects a queued submit observer and cannot steal later focus', async () => {
  const { controller, card } = setup();
  controller.activate('tip', 't1', card);
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('ready'));
  document.getElementById('submit-modal')!.classList.remove('hidden');
  controller.dispose(); dispose = undefined;
  card.focus();
  await Promise.resolve();
  expect(document.activeElement).toBe(card);
  expect(document.getElementById('tip-modal')!.classList.contains('hidden')).toBe(true);
});
it('FR004: missing, disabled and failed reads stay closable without old body', async () => {
  window.history.replaceState({}, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller, read } = setup();
  read.mockResolvedValueOnce({ enabled: true, items: [] }); await controller.reconcile();
  expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('missing');
  read.mockRejectedValueOnce({ status: 403 }); await controller.reconcile();
  expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('error');
  expect(screen.getByText(/không có quyền/)).toBeTruthy();
  read.mockResolvedValueOnce({ enabled: false, items: [] }); await controller.reconcile();
  expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('unavailable');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
});
it('FR001: assignment presence cannot open content or alter assignment values', async () => {
  window.history.replaceState({}, '', '/writing/dashboard?tab=tips&tip=t1&assignment_id=');
  const { controller, card, selectTab } = setup();
  await controller.reconcile();
  expect(controller.activate('tip', 't1', card)).toBe(false);
  expect(selectTab).toHaveBeenCalledWith('tips'); expect(window.location.search).toContain('assignment_id=');
});
it('FR004: pagehide clears cached body, pageshow reads instead of restoring HTML', async () => {
  window.history.replaceState({}, '', '/writing/dashboard?tab=tips&tip=t1');
  const { controller, read } = setup();
  await controller.reconcile();
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  expect(document.getElementById('tip-modal')!.classList.contains('hidden')).toBe(true);
  expect(document.getElementById('tip-modal-title')!.textContent).toBe('');
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});
it('FR005: explicit close returns focus after canonical library replaces the trigger', async () => {
  let reads = 0;
  let replacement: HTMLElement | null = null;
  const read = vi.fn(async () => {
    if (++reads > 1) {
      const old = document.querySelector<HTMLElement>('[data-tip-id="t1"]')!;
      replacement = old.cloneNode(true) as HTMLElement; old.replaceWith(replacement);
    }
    return { enabled: true, items: [{ id: 't1', title: 'Canonical tip' }] };
  });
  const { controller, card } = setup(read);
  controller.activate('tip', 't1', card);
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-content-state')).toBe('ready'));
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    const state = { ...window.history.state }; delete state[WRITING_CONTENT_MARKER];
    window.history.replaceState(state, '', '/writing/dashboard?tab=tips');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  controller.close();
  await waitFor(() => { expect(replacement).not.toBeNull(); expect(document.activeElement).toBe(replacement); });
});
