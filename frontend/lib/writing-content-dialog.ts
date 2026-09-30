import {
  WRITING_CONTENT_MARKER, WRITING_LIBRARY_MARKER, WRITING_CONTENT_ROUTE,
  readWritingContentQuery, writingContentLibraryHref, writingContentHref,
  createWritingContentMarker, validWritingContentMarker, validWritingLibraryMarker,
} from './writing-content-navigation.mjs';

type Kind = 'tip' | 'prompt';
type Filters = { tipFilter: string; tipTypeFilter: string; pbFilter: string };
type Options = {
  account: string;
  read: (kind: Kind) => Promise<{ items: any[]; enabled: boolean }>;
  render: (kind: Kind, item: any) => void;
  selectTab: (tab: string) => void;
  filters: () => Filters;
  restoreFilters: (filters: Filters) => void;
  current: () => boolean;
};

// One controller for both read-only kinds. It has no access to admission or submit.
export function createWritingContentDialog(options: Options) {
  const modal = document.getElementById('tip-modal')!;
  const closeButton = document.getElementById('tip-modal-close')!;
  const body = document.getElementById('tip-modal-body')!;
  const title = document.getElementById('tip-modal-title')!;
  const meta = document.getElementById('tip-modal-meta')!;
  const submitModal = document.getElementById('submit-modal');
  let generation = 0, disposed = false, open = false, closing = false;
  let pendingFocusReturn = false;
  let trigger: HTMLElement | null = null;
  let triggerIdentity: { kind: Kind; id: string } | null = null;
  let overflow = '';
  let background: Array<{ el: HTMLElement; inert: boolean; hidden: string | null }> = [];

  const current = () => !disposed && options.current();
  const submitVisible = () => Boolean(submitModal && !submitModal.classList.contains('hidden'));
  const selection = () => readWritingContentQuery(window.location.search);
  const merge = () => ({ ...(window.history.state || {}) });
  function clearMarker(state: any) {
    delete state[WRITING_CONTENT_MARKER];
    return state;
  }
  function fallback(tab: string) {
    const button = document.getElementById('tab-' + tab);
    return button && !button.hidden ? button : document.getElementById('tab-assignments');
  }
  function returnFocus(tab: string) {
    let target = trigger?.isConnected ? trigger : null;
    if (!target && triggerIdentity) {
      const attribute = triggerIdentity.kind === 'tip' ? 'data-tip-id' : 'data-pb-id';
      target = Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`))
        .find(el => el.getAttribute(attribute) === triggerIdentity?.id) || null;
    }
    // A card removed by filtering is not a valid focus destination.
    if (target?.closest('.hidden') || target?.hidden) target = null;
    (target || fallback(tab))?.focus({ preventScroll: true });
  }
  function hide(returnToLibrary: boolean) {
    const wasOpen = open;
    open = false;
    modal.classList.add('hidden');
    body.replaceChildren(); title.textContent = ''; meta.textContent = '';
    modal.removeAttribute('data-content-kind'); modal.removeAttribute('data-content-id');
    modal.removeAttribute('data-content-state'); modal.removeAttribute('aria-busy');
    if (background.length) {
      for (const old of background) {
        old.el.inert = old.inert;
        if (old.hidden === null) old.el.removeAttribute('aria-hidden');
        else old.el.setAttribute('aria-hidden', old.hidden);
      }
      background = [];
      document.body.style.overflow = overflow;
    }
    if (wasOpen && returnToLibrary && current()) returnFocus(selection().tab);
  }
  function yieldToSubmit() {
    if (disposed || !open || !submitVisible()) return;
    ++generation;
    pendingFocusReturn = false;
    hide(false);
    // The independent owner may have tried to focus while its sibling was inert.
    if (current() && !submitModal!.contains(document.activeElement)) {
      document.getElementById('modal-close')?.focus({ preventScroll: true });
    }
  }
  function show(kind: Kind, id: string, state: string, message: string) {
    title.textContent = kind === 'tip' ? 'Mẹo viết' : 'Kho đề';
    meta.textContent = '';
    body.textContent = message;
    if (!open) {
      overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      let node: HTMLElement = modal;
      while (node.parentElement && node !== document.body) {
        for (const sibling of Array.from(node.parentElement.children)) {
          if (sibling === node || !(sibling instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
          background.push({ el: sibling, inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
          sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
        }
        node = node.parentElement;
      }
      open = true;
      modal.classList.remove('hidden');
      closeButton.focus({ preventScroll: true });
    }
    modal.dataset.contentKind = kind; modal.dataset.contentId = id; modal.dataset.contentState = state;
    modal.setAttribute('aria-busy', String(state === 'loading'));
    body.setAttribute('role', state === 'error' ? 'alert' : 'status');
  }
  async function reconcile(refresh = true) {
    const ticket = ++generation;
    closing = false;
    if (!current()) { hide(false); return; }
    const query = selection();
    options.selectTab(query.tab);
    // Submission is the independent owner, even if its URL key is empty.
    if (submitVisible()) {
      hide(false); return;
    }
    const library = window.history.state?.[WRITING_LIBRARY_MARKER];
    if (!query.item && validWritingLibraryMarker(library, options.account, query.tab)) options.restoreFilters(library);
    if (!query.item) {
      const shouldReturnFocus = open || pendingFocusReturn;
      pendingFocusReturn = false;
      hide(!query.assignment);
      if (shouldReturnFocus && !query.assignment) returnFocus(query.tab);
      if (validWritingLibraryMarker(library, options.account, query.tab)) window.scrollTo(0, library.scroll);
      if (refresh && ['tips', 'prompt-bank'].includes(query.tab)) {
        try { await options.read(query.tab === 'tips' ? 'tip' : 'prompt'); }
        catch { /* The canonical list reader exposes its own library error. */ }
        if (current() && ticket === generation && !selection().item) {
          if (shouldReturnFocus && !query.assignment) returnFocus(query.tab);
          if (validWritingLibraryMarker(library, options.account, query.tab)) window.scrollTo(0, library.scroll);
        }
      }
      return;
    }
    const { kind, id } = query.item as { kind: Kind; id: string };
    show(kind, id, 'loading', 'Đang tải nội dung…');
    try {
      const result = await options.read(kind);
      if (!current() || ticket !== generation) return;
      const now = selection();
      if (now.item?.kind !== kind || now.item.id !== id || now.assignment) return;
      if (submitVisible()) { yieldToSubmit(); return; }
      if (!result.enabled) { show(kind, id, 'unavailable', 'Kho đề hiện chưa được bật.'); return; }
      const item = result.items.find(item => item.id === id);
      if (!item) { show(kind, id, 'missing', 'Nội dung này không còn được cung cấp.'); return; }
      body.removeAttribute('role');
      options.render(kind, item);
      modal.dataset.contentState = 'ready'; modal.setAttribute('aria-busy', 'false');
    } catch (error: any) {
      if (current() && ticket === generation) show(kind, id, 'error',
        error?.status === 403 ? 'Tài khoản hiện không có quyền đọc nội dung này.' : 'Không tải được nội dung. Em có thể đóng và thử mở lại.');
    }
  }
  function activate(kind: Kind, id: string, card: HTMLElement) {
    if (!current() || selection().assignment || submitVisible()) return false;
    const href = writingContentHref(kind, id);
    if (!href || (selection().item?.kind === kind && selection().item?.id === id)) return false;
    trigger = card; triggerIdentity = { kind, id };
    const tab = kind === 'tip' ? 'tips' : 'prompt-bank';
    const parentId = crypto.randomUUID();
    const parent = clearMarker(merge());
    parent[WRITING_LIBRARY_MARKER] = { version: 1, account: options.account, tab, id: parentId,
      scroll: window.scrollY, ...options.filters() };
    window.history.replaceState(parent, '', writingContentLibraryHref(tab));
    window.history.pushState({ ...parent, [WRITING_CONTENT_MARKER]: createWritingContentMarker(options.account, { kind, id }, parentId) }, '', href);
    void reconcile();
    return true;
  }
  function close() {
    if (!current() || !open || closing) return;
    closing = true;
    pendingFocusReturn = true;
    ++generation; // A pending canonical read can never reopen after close.
    const query = selection();
    const marker = window.history.state?.[WRITING_CONTENT_MARKER];
    hide(true);
    if (validWritingContentMarker(marker, options.account, window.location.pathname, query, window.history.state?.[WRITING_LIBRARY_MARKER])) {
      window.history.back();
    } else {
      window.history.replaceState(clearMarker(merge()), '', writingContentLibraryHref(query.tab));
      void reconcile(false);
    }
  }
  function tab(tab: string) {
    if (!current() || open) return;
    const query = new URLSearchParams(window.location.search);
    query.set('tab', tab); query.delete('tip'); query.delete('prompt');
    window.history.replaceState(clearMarker(merge()), '', `${WRITING_CONTENT_ROUTE}?${query}`);
    void reconcile();
  }
  function focusables() {
    return Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hidden && !el.closest('.hidden') && el.getAttribute('aria-hidden') !== 'true');
  }
  function keydown(event: KeyboardEvent) {
    if (!open) return false;
    if (event.key === 'Escape') { event.preventDefault(); close(); return true; }
    if (event.key === 'Tab') {
      const targets = focusables(), first = targets[0] || closeButton, last = targets.at(-1) || closeButton;
      if (!modal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
    return true;
  }
  const onPop = () => { void reconcile(); };
  // A cached document must contain no old account body before pageshow/auth runs.
  const onPageHide = () => { ++generation; hide(false); };
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void reconcile(); };
  const onFocus = (event: FocusEvent) => {
    if (submitVisible()) { yieldToSubmit(); return; }
    if (open && !modal.contains(event.target as Node)) closeButton.focus();
  };
  // Observe only this existing owner's visibility contract; never its URL/state.
  const submitObserver = new MutationObserver(yieldToSubmit);
  if (submitModal) submitObserver.observe(submitModal, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', onPop);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('focusin', onFocus);
  return { activate, close, tab, keydown, reconcile, dispose() {
    disposed = true; submitObserver.disconnect(); ++generation; hide(false);
    window.removeEventListener('popstate', onPop); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('focusin', onFocus);
  } };
}
