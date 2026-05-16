/**
 * frontend/js/vocab-modules/needs-review.js
 *
 * Sprint 10.1.5 — Needs Review tab. The 4th vocab-module sibling
 * alongside my-vocab / flashcards / exercises. Surfaces vocab items
 * captured with source_type='needs_review' (Claude Haiku flagged a
 * misuse, non-standard collocation, or wrong word choice) on a
 * dedicated tab so they don't pollute the main vocab bank.
 *
 * Public API matches the other vocab-modules:
 *
 *   mount(container, opts) → Promise<{ unmount }>
 *
 * Behaviour contract:
 *   - Idempotent mount via guardMount (data-mounted attribute).
 *   - Embedded mode auth-redirect via window.top (Phase B Q2).
 *   - Event delegation via data-action attributes; no window.* leaks.
 *   - HTML body shipped as template literal (Phase B Q2 — single
 *     source of truth, no runtime fetch).
 *
 * Card layout (per Phase B card-visual recommendation):
 *
 *     ┌─────────────────────────────────────────────┐
 *     │  {original_word}  →  {suggestion / headword}│
 *     │  "Context sentence verbatim from transcript"│
 *     │  {AI feedback / reason}                     │
 *     │                                             │
 *     │  [✓ Đã sửa, đưa lên flashcard]  [🗑 Bỏ qua] │
 *     └─────────────────────────────────────────────┘
 *
 * Actions:
 *   - "Đã sửa, đưa lên flashcard" → POST /vocabulary/bank/{id}/mark-fixed
 *     (server flips source_type='needs_review' → 'manual', item moves
 *     to the main bank and becomes eligible for flashcard stacks).
 *   - "Bỏ qua" → DELETE /vocabulary/bank/{id} (soft delete; can be
 *     restored later via POST /restore).
 */

import { guardMount, redirectToLogin } from './_loader.js';
import { renderSourceLink } from './_source-link.js';


// Sprint 9.2 — back-link returns to parent Vocabulary dashboard.
const HTML = /* html */ `
  <main class="max-w-3xl mx-auto px-4 pt-4 pb-8">

    <!-- Sprint 9.1 + 9.2 — canonical .subpage-header with interactive
         back-link button. .subpage-header__back data-action handles
         embedded vs standalone routing (see backToDashboard below). -->
    <header class="subpage-header mb-6">
      <div class="subpage-header__lhs">
        <button type="button" class="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Vocabulary">
          <i data-lucide="arrow-left"></i>
          <span>Vocabulary</span>
        </button>
        <span class="subpage-header__sep">|</span>
        <h1 class="subpage-header__title">Needs Review</h1>
      </div>
    </header>

    <!-- Intro banner — frames the pedagogical purpose so the surface
         doesn't read as "things you got wrong" but as "learning
         opportunities flagged by AI". -->
    <div class="needs-review-intro" data-banner="intro">
      <p class="needs-review-intro__body">
        Đây là những từ vựng và cách diễn đạt mà AI gợi ý bạn xem lại — fix-then-promote
        hoặc bỏ qua tùy bạn.
      </p>
    </div>

    <div data-state="loading" class="flex justify-center py-16"><div class="spinner"></div></div>
    <div data-state="disabled" class="hidden text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">Vocab Bank is not enabled</p>
      <p class="text-sm">This feature is available in the upcoming update.</p>
    </div>
    <div data-state="error" class="hidden text-center py-16 empty-state">
      <p class="text-sm">Failed to load Needs Review items. Please refresh.</p>
    </div>
    <div data-state="empty" class="hidden text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">Chưa có gì cần xem lại</p>
      <p class="text-sm">Khi AI phát hiện cách dùng từ chưa chuẩn trong bài luyện tập, mục đó sẽ xuất hiện ở đây.</p>
    </div>

    <div data-list class="hidden flex flex-col gap-3"></div>
  </main>

  <div data-toast class="nr-toast"></div>
`;


function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}


export async function mount(container, opts = {}) {
  const { embedded = false } = opts;

  const guard = guardMount(container);
  if (guard.alreadyMounted) return guard.getHandle();

  const BASE = window.api && window.api.base;
  if (!BASE) {
    container.innerHTML =
      '<p style="text-align:center;padding:3rem;color:var(--av-text-muted);">' +
      'window.api not initialized — module cannot bootstrap.</p>';
    return { unmount: () => {} };
  }

  let _token = null;
  let _items = [];
  let _toastTimer = null;

  container.innerHTML = HTML;

  const $ = (sel) => container.querySelector(sel);

  function showState(name) {
    ['loading', 'disabled', 'error', 'empty'].forEach(s => {
      const el = $(`[data-state="${s}"]`);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    const list = $('[data-list]');
    if (list) list.classList.toggle('hidden', name !== 'list');
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json' };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(`${BASE}/api/vocabulary/bank${path}`, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function toast(msg, variant = 'success') {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.className = `nr-toast nr-toast--${variant} visible`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, 2500);
  }

  // ── Render ──────────────────────────────────────────────────────
  // Sprint 10.4.1-hotfix — adopt canonical .vocab-card family declared
  // in my-vocabulary.css (Sprint 9.1/9.3) so this surface is visually
  // identical to the my-vocab tab's needs_review rows. No bespoke
  // .nr-card* CSS — primitives reused: .vocab-card, .source-badge +
  // .badge-needs_review, .vocab-action--fixed / --skip / --source,
  // .mv-context, .mv-reason.
  function cardHtml(item) {
    // For a needs_review item, `headword` is the corrected/suggested
    // form Claude returned. `original_word` (if present) was the
    // simpler/wrong form the learner used. If `suggestion` is set it
    // overrides headword as the preferred fix. Fall back gracefully
    // when fields are missing — the AI doesn't always populate every
    // slot.
    const suggested = item.suggestion || item.headword || '';
    const original = item.original_word || '';
    const showArrow = original && suggested && original !== suggested;

    const headerHtml = showArrow
      ? `<span class="mv-context"><s>${esc(original)}</s></span>
         <i data-lucide="arrow-right" aria-hidden="true"></i>
         <span class="font-semibold text-base">${esc(suggested)}</span>`
      : `<span class="font-semibold text-base">${esc(suggested)}</span>`;

    const contextHtml = item.context_sentence
      ? `<p class="text-xs italic mt-2 mb-1 mv-context">"${esc(item.context_sentence)}"</p>`
      : '';

    const reasonHtml = item.reason
      ? `<p class="text-xs mt-1 mv-reason">${esc(item.reason)}</p>`
      : '';

    // Sprint 10.8 — shared renderSourceLink helper.
    const sourceLink = renderSourceLink(item);

    return `
      <div class="vocab-card" data-vocab-id="${esc(item.id)}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex items-center gap-2 flex-wrap">
            ${headerHtml}
            <span class="source-badge badge-needs_review">Cần xem lại ⚠</span>
          </div>
        </div>
        ${contextHtml}
        ${reasonHtml}
        <div class="flex items-center flex-wrap gap-x-3 gap-y-2 mt-3">
          ${sourceLink}
          <button class="vocab-action vocab-action--fixed"
                  data-action="mark-fixed" data-vocab-id="${esc(item.id)}">
            ✏️ Đã sửa, đưa lên flashcard
          </button>
          <button class="vocab-action vocab-action--skip"
                  data-action="dismiss" data-vocab-id="${esc(item.id)}">
            🗑️ Bỏ qua
          </button>
        </div>
      </div>
    `;
  }

  function renderList() {
    if (!_items.length) {
      showState('empty');
      return;
    }
    const listEl = $('[data-list]');
    listEl.innerHTML = _items.map(cardHtml).join('');
    showState('list');
    // Re-hydrate Lucide icons for the dynamically-rendered arrow-right
    // glyphs inside each card header (Sprint 9.3 pattern).
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  async function loadItems() {
    showState('loading');
    try {
      const res = await fetch(`${BASE}/api/vocabulary/bank/needs-review`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _items = await res.json();
      renderList();
    } catch (err) {
      console.error('[needs-review] load failed:', err);
      showState('error');
    }
  }

  // ── Actions ─────────────────────────────────────────────────────
  async function markFixed(vocabId) {
    const item = _items.find(i => i.id === vocabId);
    if (!item) return;
    try {
      await apiFetch(`/${vocabId}/mark-fixed`, { method: 'POST' });
      _items = _items.filter(i => i.id !== vocabId);
      renderList();
      toast(`Đã đưa "${item.headword}" lên flashcard.`, 'success');
    } catch (err) {
      console.error('[needs-review] mark-fixed failed:', err);
      toast('Không thể đánh dấu đã sửa. Thử lại sau.', 'error');
    }
  }

  async function dismiss(vocabId) {
    const item = _items.find(i => i.id === vocabId);
    if (!item) return;
    try {
      await apiFetch(`/${vocabId}`, { method: 'DELETE' });
      _items = _items.filter(i => i.id !== vocabId);
      renderList();
      toast(`Đã bỏ qua "${item.headword}".`, 'info');
    } catch (err) {
      console.error('[needs-review] dismiss failed:', err);
      toast('Không thể bỏ qua. Thử lại sau.', 'error');
    }
  }

  // Sprint 9.2 — back-link returns the user to the parent Vocabulary
  // dashboard. Embedded: clear hash, vocab-landing.js hashchange
  // listener restores the dashboard. Standalone: hard-navigate to
  // /pages/vocabulary.html.
  function backToDashboard() {
    if (embedded) {
      if (window.location.hash) {
        history.pushState(null, '', window.location.pathname);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    } else {
      window.location.href = '/pages/vocabulary.html';
    }
  }

  // ── Event delegation ────────────────────────────────────────────
  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;
    const action = btn.dataset.action;
    const vocabId = btn.dataset.vocabId;
    switch (action) {
      case 'back-to-dashboard': return backToDashboard();
      case 'mark-fixed':        return markFixed(vocabId);
      case 'dismiss':           return dismiss(vocabId);
      default: return;
    }
  }

  container.addEventListener('click', handleClick);

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  async function init() {
    try {
      const sb = window.getSupabase ? window.getSupabase() : null;
      if (sb) {
        const { data } = await sb.auth.getSession();
        _token = data?.session?.access_token || null;
      }
    } catch (_) {}

    if (!_token) {
      redirectToLogin({ embedded });
      return;
    }

    // Optional feature-flag check via /auth/me — mirror my-vocab.js.
    try {
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.vocab_bank_enabled === false) {
          showState('disabled');
          return;
        }
      }
    } catch (_) {
      // Non-fatal — fall through to loadItems and let the API call
      // surface the real error if vocab bank is disabled server-side.
    }

    await loadItems();
  }

  init();

  function unmount() {
    clearTimeout(_toastTimer);
    container.removeEventListener('click', handleClick);
    container.innerHTML = '';
    guard.clearHandle();
  }

  const handle = { unmount };
  guard.setHandle(handle);
  return handle;
}
