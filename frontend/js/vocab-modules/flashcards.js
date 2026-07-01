/**
 * frontend/js/vocab-modules/flashcards.js
 *
 * Sprint 7.4 — flashcards as a vocab-module. DEBT-2026-05-09-B Phase
 * 2/4. Follows the contract established by Sprint 7.3 (my-vocab):
 *
 *   mount(container, opts) → Promise<{ unmount }>
 *
 * This module is the stack-list page (NOT the per-card flip surface —
 * that lives at /pages/flashcard-study.html and is out of scope). On
 * click, a stack card navigates to flashcard-study.html.
 *
 * Cleanup needs on unmount (more than my-vocab):
 *   - Cancel _state.previewTimer (debounced create-stack preview).
 *   - Cancel toast._t (toast auto-hide).
 *   - Remove click + input + change listeners.
 *
 * Phase B contract (carried from Sprint 7.2):
 *   - Q1 event delegation (data-action attrs, no window.* leak).
 *   - Q2 embedded → window.top.location.href for auth redirect.
 *   - Q3 idempotent mount via guardMount (data-mounted attribute).
 */

import { guardMount, redirectToLogin } from './_loader.js';


// Sentinel matching backend services/flashcards._UNCATEGORIZED_TOPIC.
// Sent as a topic value when the user picks "Chưa phân loại" so the
// backend can map it to a topic IS NULL clause.
const UNCATEGORIZED = '__uncategorized__';


function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}


const HTML = /* html */ `
  <main class="max-w-3xl mx-auto px-4 pt-4 pb-8">

    <!-- Sprint 9.1 — .subpage-header primitive (components.css). The
         pre-9.1 .fc-header "context bar" was retired; 📚 emoji prefix
         dropped per Phase D Q5 (chrome's active="vocabulary" highlight
         + eyebrow already anchor the IA position). -->
    <header class="subpage-header mb-6">
      <div class="subpage-header__lhs">
        <button type="button" class="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Vocabulary">
          <i data-lucide="arrow-left"></i>
          <span>Vocabulary</span>
        </button>
        <span class="subpage-header__sep">|</span>
        <h1 class="subpage-header__title">Flashcards</h1>
      </div>
    </header>

    <!-- Sprint 6.0 banner — Sprint 7.4 visibility controlled by mount() opts.embedded. -->
    <div data-banner="moved" class="fc-banner rounded-lg p-3 mb-5 text-sm flex items-center gap-3 hidden">
      <span class="fc-banner__icon" aria-hidden="true">📍</span>
      <div class="fc-banner__body">
        Flashcards giờ là một tab trong trang
        <a href="/pages/vocabulary.html#flashcards" class="fc-banner__link">Từ vựng</a>
        — quản lý vocab + ôn flashcards trong một nơi.
      </div>
    </div>

    <!-- Stack list renders into this region. -->
    <div data-fc-container>
      <div class="state-msg"><div class="spinner"></div></div>
    </div>
  </main>

  <!-- Create Stack Modal -->
  <div data-fc-modal class="modal-backdrop">
    <div class="modal">
      <h2>Tạo stack mới</h2>

      <div class="modal-section">
        <label class="modal-label" for="m-name">Tên stack</label>
        <input id="m-name" class="modal-input" type="text" maxlength="50"
               placeholder="VD: Business words from January" />
      </div>

      <div class="modal-section">
        <label class="modal-label">Chủ đề</label>
        <div data-fc-topics class="chip-group">
          <span class="fc-modal-loading">Đang tải…</span>
        </div>
      </div>

      <div class="modal-section">
        <label class="modal-label">Phân loại</label>
        <div class="chip-group">
          <span class="chip" data-action="toggle-category" data-cat="used_well">Dùng tốt</span>
          <span class="chip" data-action="toggle-category" data-cat="upgrade_suggested">Có thể nâng cấp</span>
          <span class="chip" data-action="toggle-category" data-cat="manual">Thêm thủ công</span>
        </div>
      </div>

      <div class="modal-section">
        <label class="modal-label" for="m-search">Tìm kiếm trong từ / định nghĩa (tuỳ chọn)</label>
        <input id="m-search" class="modal-input" type="text" placeholder="VD: implement" />
      </div>

      <div class="modal-section">
        <label class="modal-label" for="m-after">Thêm sau ngày (tuỳ chọn)</label>
        <input id="m-after" class="modal-input" type="date" />
      </div>

      <div class="modal-section">
        <label class="modal-label">Xem trước</label>
        <div data-fc-preview class="preview-box">
          <span class="fc-modal-loading">Chọn bộ lọc để xem số thẻ phù hợp.</span>
        </div>
      </div>

      <div class="modal-actions">
        <button data-action="close-stack-modal" class="btn-ghost">Hủy</button>
        <button data-action="save-stack" data-fc-save class="btn-primary" disabled>Lưu</button>
      </div>
    </div>
  </div>

  <div data-fc-toast class="toast"></div>
`;


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

  // Closure-scoped state. Replaces the IIFE-scoped vars in the legacy
  // /js/flashcards.js. Each mount has its own bag.
  let _token = null;
  const _state = {
    topics: [],
    hasUncategorized: false,
    selectedTopics: new Set(),
    selectedCats:   new Set(),
    previewTimer:   null,
  };
  let _toastTimer = null;

  container.innerHTML = HTML;

  const $    = (sel) => container.querySelector(sel);
  const $$   = (sel) => Array.from(container.querySelectorAll(sel));

  // Banner visibility: shown only on the standalone shell.
  const banner = $('[data-banner="moved"]');
  if (banner) banner.classList.toggle('hidden', !!embedded);

  // ── Container helpers (mirror legacy flashcards.js shape) ───────
  // Sprint 9.3 — re-hydrate Lucide icons after every innerHTML swap so
  // the dynamically-rendered stack cards (autoCard / manualCard) get
  // their <i data-lucide="..."> placeholders expanded to inline SVGs.
  // The pre-9.3 emoji icons rendered as plain text and didn't need
  // hydration; canonical Lucide outlines do.
  function setFcContainerHtml(html) {
    $('[data-fc-container]').innerHTML = html;
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
  function setFcPreviewHtml(html) {
    $('[data-fc-preview]').innerHTML = html;
  }
  function setFcTopicsHtml(html) {
    $('[data-fc-topics]').innerHTML = html;
  }
  function showLoading() {
    setFcContainerHtml('<div class="state-msg"><div class="spinner"></div></div>');
  }
  function showError(msg) {
    setFcContainerHtml(
      `<div class="state-msg error">${esc(msg || 'Không tải được flashcards.')}</div>`,
    );
  }
  function showDisabled() {
    setFcContainerHtml(
      '<div class="state-msg">Tính năng Flashcards chưa bật cho tài khoản của bạn.</div>',
    );
  }

  function toast(message, kind) {
    const el = $('[data-fc-toast]');
    if (!el) return;
    el.className = 'toast ' + (kind === 'error' ? 'error' : 'success');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
  }

  function authHeaders() { return { Authorization: 'Bearer ' + _token }; }

  // ── Bootstrap ───────────────────────────────────────────────────
  async function init() {
    showLoading();
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

    try {
      const meRes = await fetch(BASE + '/auth/me', { headers: authHeaders() });
      if (!meRes.ok) { showDisabled(); return; }
      const me = await meRes.json();
      if (me.flashcard_enabled !== true) { showDisabled(); return; }
    } catch (_) { showDisabled(); return; }

    await renderStacks();
  }

  // ── Stack list ─────────────────────────────────────────────────
  async function renderStacks() {
    showLoading();
    let stacks = [];
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks', { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      stacks = Array.isArray(body.stacks) ? body.stacks : [];
    } catch (err) {
      console.error('[flashcards] list_stacks', err);
      showError('Không tải được danh sách stacks. Thử lại sau.');
      return;
    }

    const autos = stacks.filter(s => s.type === 'auto');
    const manuals = stacks.filter(s => s.type === 'manual');

    const totalCards = autos.find(s => s.id === 'auto:all_vocab')?.card_count ?? 0;
    if (totalCards === 0) {
      setFcContainerHtml(`
        <div class="state-msg">
          <p class="text-base mb-2 text-white">Bạn chưa có thẻ flashcard nào.</p>
          <p class="text-sm">Tạo một stack mới để bắt đầu học theo lịch lặp khoảng cách.</p>
        </div>
      `);
      return;
    }

    const cardsHtml =
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">` +
        autos.map(autoCard).join('') +
        manuals.map(manualCard).join('') +
      `</div>`;

    setFcContainerHtml(`
      <div class="flex items-center justify-between mb-5">
        <div>
          <h2 class="text-lg font-semibold text-white">Stacks của bạn</h2>
          <p class="text-sm text-slate-400">3 nhóm tự động + ${manuals.length} stack thủ công</p>
        </div>
        <button data-action="open-stack-modal" class="btn-primary">+ Tạo stack mới</button>
      </div>
      ${cardsHtml}
    `);
  }

  // Sprint 9.3 — auto stacks adopt the canonical .mode-card inner
  // skeleton (.head > .icon + .arrow, h3, .lede). Emoji icons replaced
  // with Lucide outlines (library / sparkles / target). The pre-9.3
  // top-right "Tự động" pill moved inline into the h3 title row via
  // .mode-card__badge — phân biệt auto vs manual stack semantics is
  // preserved while the corner slot returns to the canonical arrow.
  function autoCard(s) {
    const iconName = s.id === 'auto:all_vocab' ? 'library'  :
                     s.id === 'auto:recent'    ? 'sparkles' : 'target';
    const disabled = s.card_count === 0 ? 'disabled' : '';
    return `
      <div class="mode-card ${disabled}"
           data-action="open-stack"
           data-stack-id="${esc(s.id)}" data-card-count="${s.card_count}">
        <div class="head">
          <div class="icon"><i data-lucide="${iconName}"></i></div>
          <span class="arrow" aria-hidden="true">→</span>
        </div>
        <h3>
          ${esc(s.name)}
          <span class="mode-card__badge">Tự động</span>
        </h3>
        <p class="lede">${s.card_count} thẻ</p>
      </div>
    `;
  }

  // Sprint 9.3 — manual stacks adopt the same canonical skeleton. No
  // .mode-card__badge — the absence of the "Tự động" tag is itself the
  // signal that this stack is user-created (and accordingly carries the
  // hover-revealed .delete-btn for removal). Lucide `folder` replaces
  // the pre-9.3 📂 emoji.
  function manualCard(s) {
    const disabled = s.card_count === 0 ? 'disabled' : '';
    return `
      <div class="mode-card ${disabled}"
           data-action="open-stack"
           data-stack-id="${esc(s.id)}" data-card-count="${s.card_count}">
        <button class="delete-btn"
                data-action="delete-stack"
                data-stack-id="${esc(s.id)}" title="Xoá stack">×</button>
        <div class="head">
          <div class="icon"><i data-lucide="folder"></i></div>
          <span class="arrow" aria-hidden="true">→</span>
        </div>
        <h3>${esc(s.name)}</h3>
        <p class="lede">${s.card_count} thẻ</p>
      </div>
    `;
  }

  function navigateToStudy(stackId) {
    const url = '/pages/flashcard-study.html?stack=' + encodeURIComponent(stackId);
    if (embedded && window.top && window.top !== window) {
      try { window.top.location.href = url; return; } catch (_) {}
    }
    window.location.href = url;
  }

  function openStack(stackEl) {
    const id = stackEl.getAttribute('data-stack-id');
    if (Number(stackEl.getAttribute('data-card-count')) === 0) {
      toast('Stack chưa có thẻ nào.', 'error');
      return;
    }
    navigateToStudy(id);
  }

  async function deleteStack(stackId) {
    if (!stackId) return;
    if (!confirm('Xoá stack này? (Tiến độ ôn tập của các thẻ vẫn được giữ)')) return;
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks/' + encodeURIComponent(stackId), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status === 204 || res.ok) {
        toast('Đã xoá stack.', 'success');
        renderStacks();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'Không xoá được stack.', 'error');
      }
    } catch (err) {
      console.error('[flashcards] delete', err);
      toast('Không xoá được stack.', 'error');
    }
  }

  // ── Create-stack modal ─────────────────────────────────────────
  async function openModal() {
    _state.selectedTopics.clear();
    _state.selectedCats.clear();
    $('#m-name').value = '';
    $('#m-search').value = '';
    $('#m-after').value = '';
    $$('[data-fc-topics] .chip').forEach(c => c.classList.remove('active'));
    $$('.chip-group .chip[data-cat]').forEach(c => c.classList.remove('active'));
    setFcPreviewHtml('<span class="text-xs text-slate-500">Chọn bộ lọc để xem số thẻ phù hợp.</span>');
    $('[data-fc-save]').disabled = true;

    $('[data-fc-modal]').classList.add('visible');

    if (_state.topics.length === 0 && _state.hasUncategorized === false) {
      try {
        const res = await fetch(BASE + '/api/flashcards/vocab-topics', { headers: authHeaders() });
        const body = await res.json();
        _state.topics = Array.isArray(body.topics) ? body.topics : [];
        _state.hasUncategorized = body.has_uncategorized === true;
      } catch (_) {
        _state.topics = [];
        _state.hasUncategorized = false;
      }
    }
    renderTopicChips();
  }

  function renderTopicChips() {
    if (!_state.topics.length && !_state.hasUncategorized) {
      setFcTopicsHtml('<span class="text-xs text-slate-500">Chưa có chủ đề nào — luyện Speaking để hệ thống gắn topic tự động.</span>');
      return;
    }
    const parts = [];
    if (_state.hasUncategorized) {
      parts.push(
        `<span class="chip chip-uncategorized"
                data-action="toggle-topic"
                data-topic="${UNCATEGORIZED}"
                title="Vocab chưa được gán topic (thường là từ thêm thủ công)"
                style="border-style:dashed;">📂 Chưa phân loại</span>`,
      );
    }
    parts.push(
      ..._state.topics.map(t =>
        `<span class="chip" data-action="toggle-topic" data-topic="${esc(t)}">${esc(t)}</span>`),
    );
    setFcTopicsHtml(parts.join(''));
  }

  function closeModal() {
    $('[data-fc-modal]').classList.remove('visible');
  }

  function toggleCategoryChip(chipEl) {
    const cat = chipEl.getAttribute('data-cat');
    if (_state.selectedCats.has(cat)) {
      _state.selectedCats.delete(cat);
      chipEl.classList.remove('active');
    } else {
      _state.selectedCats.add(cat);
      chipEl.classList.add('active');
    }
    onFilterChanged();
  }

  function toggleTopicChip(chipEl) {
    const t = chipEl.getAttribute('data-topic');
    if (_state.selectedTopics.has(t)) {
      _state.selectedTopics.delete(t);
      chipEl.classList.remove('active');
    } else {
      _state.selectedTopics.add(t);
      chipEl.classList.add('active');
    }
    onFilterChanged();
  }

  function buildFilterConfig() {
    const cfg = {};
    if (_state.selectedTopics.size) cfg.topics = Array.from(_state.selectedTopics);
    if (_state.selectedCats.size)   cfg.categories = Array.from(_state.selectedCats);
    const search = $('#m-search').value.trim();
    if (search) cfg.search = search;
    const after = $('#m-after').value.trim();
    if (after) cfg.added_after = after;
    return cfg;
  }

  function updateSaveEnabled() {
    const name = $('#m-name').value.trim();
    $('[data-fc-save]').disabled = !(name.length >= 3 && name.length <= 50);
  }

  function onFilterChanged() {
    updateSaveEnabled();
    clearTimeout(_state.previewTimer);
    _state.previewTimer = setTimeout(refreshPreview, 250);
  }

  async function refreshPreview() {
    const cfg = buildFilterConfig();
    setFcPreviewHtml('<span class="text-xs text-slate-500">Đang đếm…</span>');
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks/preview', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_config: cfg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFcPreviewHtml(
          `<span class="text-xs fc-preview-error">${esc(err.detail || 'Bộ lọc không hợp lệ')}</span>`);
        return;
      }
      const body = await res.json();
      const count = Number(body.card_count || 0);
      const words = Array.isArray(body.preview_headwords) ? body.preview_headwords : [];
      if (count === 0) {
        setFcPreviewHtml('<span class="text-xs text-slate-500">Không có thẻ nào khớp bộ lọc.</span>');
      } else {
        setFcPreviewHtml(
          `<span class="preview-count">${count} thẻ</span> sẽ được thêm vào stack.` +
          (words.length ? `<div class="preview-words">${esc(words.slice(0, 10).join(', '))}…</div>` : ''));
      }
      const name = $('#m-name').value.trim();
      $('[data-fc-save]').disabled = !(name.length >= 3 && name.length <= 50 && count > 0);
    } catch (err) {
      console.error('[flashcards] preview', err);
      setFcPreviewHtml(
        '<span class="text-xs fc-preview-error">Không thể xem trước. Thử lại sau.</span>');
    }
  }

  async function saveStack() {
    const name = $('#m-name').value.trim();
    const cfg = buildFilterConfig();
    $('[data-fc-save]').disabled = true;
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: 'manual', filter_config: cfg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'Không tạo được stack.', 'error');
        $('[data-fc-save]').disabled = false;
        return;
      }
      const stack = await res.json();
      closeModal();
      toast(`Đã tạo "${stack.name}" với ${stack.card_count} thẻ.`, 'success');
      if (stack.card_count > 0 && stack.id) {
        navigateToStudy(stack.id);
        return;
      }
      renderStacks();
    } catch (err) {
      console.error('[flashcards] save', err);
      toast('Không tạo được stack.', 'error');
      $('[data-fc-save]').disabled = false;
    }
  }

  // ── Event delegation ────────────────────────────────────────────
  function handleClick(e) {
    // delete-btn must intercept BEFORE its parent stack-card click bubbles.
    const deleteBtn = e.target.closest('[data-action="delete-stack"]');
    if (deleteBtn && container.contains(deleteBtn)) {
      e.stopPropagation();
      deleteStack(deleteBtn.dataset.stackId);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'back-to-dashboard': return backToDashboard();
      case 'open-stack-modal':  return openModal();
      case 'close-stack-modal': return closeModal();
      case 'save-stack':        return saveStack();
      case 'open-stack':        return openStack(btn);
      case 'toggle-topic':      return toggleTopicChip(btn);
      case 'toggle-category':   return toggleCategoryChip(btn);
      default: return;
    }
  }

  // Sprint 9.2 — back-link returns the user to the parent Vocabulary
  // dashboard. Embedded: clear hash, let vocab-landing.js handle the
  // hashchange. Standalone: hard-navigate to /pages/vocabulary.html.
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

  function handleInput(e) {
    const t = e.target;
    if (!container.contains(t)) return;
    if (t.id === 'm-name') updateSaveEnabled();
    else if (t.id === 'm-search') onFilterChanged();
  }

  function handleChange(e) {
    const t = e.target;
    if (!container.contains(t)) return;
    if (t.id === 'm-after') onFilterChanged();
  }

  container.addEventListener('click', handleClick);
  container.addEventListener('input', handleInput);
  container.addEventListener('change', handleChange);

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  init();

  // ── unmount lifecycle ──────────────────────────────────────────
  function unmount() {
    container.removeEventListener('click', handleClick);
    container.removeEventListener('input', handleInput);
    container.removeEventListener('change', handleChange);
    clearTimeout(_state.previewTimer);
    clearTimeout(_toastTimer);
    container.innerHTML = '';
    guard.clearHandle();
  }

  const handle = { unmount };
  guard.setHandle(handle);
  return handle;
}
