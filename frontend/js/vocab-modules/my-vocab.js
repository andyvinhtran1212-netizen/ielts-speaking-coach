/**
 * frontend/js/vocab-modules/my-vocab.js
 *
 * Sprint 7.3 — my-vocabulary as a vocab-module. DEBT-2026-05-09-B
 * Phase 1 of 4 (flashcards Sprint 7.4, exercises 7.5, embedded-mode
 * retirement 7.6).
 *
 * Public API:
 *
 *   mount(container, opts) → Promise<{ unmount }>
 *
 *     container — HTMLElement where the module renders its body.
 *     opts.embedded — true when mounted inside vocabulary.html's tab
 *                     panel; false when mounted by the standalone
 *                     /pages/my-vocabulary.html shell.
 *
 * Behavior contract:
 *   - Idempotent: second mount() on the same container is a no-op,
 *     returns the previously-stored handle (guardMount in _loader.js).
 *   - Auth: if no Supabase session, redirects to /index.html. Embedded
 *     callers redirect via window.top (Phase B Q2 — auth = top-level).
 *   - Feature flag: if `/auth/me` returns vocab_bank_enabled=false,
 *     renders disabled state instead of fetching bank data.
 *   - Event handling: delegated. Buttons in the rendered HTML carry
 *     `data-action="<name>"` attributes; a single click listener on
 *     `container` dispatches via switch. No `window.*` globals leak.
 *   - HTML body: shipped as a template literal inside this module
 *     (Phase B Q2 — single source of truth, no runtime fetch).
 *
 * Migration notes vs the IIFE my-vocabulary.js it replaces:
 *   - State vars (_token, _allItems, etc.) moved from module-scope to
 *     closure-scope inside mount() so each container has its own
 *     state. (Only ever one container per page in practice, but the
 *     boundary is cleaner.)
 *   - DOM queries scoped to container (container.querySelector instead
 *     of document.getElementById) so two mounted instances couldn't
 *     fight over the same DOM IDs. IDs in the template are still
 *     unique within a container; the scoping is defense-in-depth.
 *   - All 11 window.* handlers replaced by data-action delegation.
 */

import { guardMount, redirectToLogin } from './_loader.js';


/** @type {string} canonical HTML body template — replaces the section
 *  of my-vocabulary.html between `<header class="mv-header …">` and the
 *  closing `</main>` plus the two modals. The standalone shell page
 *  will mount this into its `<main id="mount">`; the parent vocabulary
 *  landing will mount it into `[data-panel="my-vocab"] .tab-mount`. */
const HTML = /* html */ `
  <main class="max-w-3xl mx-auto px-4 pt-4 pb-8">

    <!-- Sprint 9.1 — .subpage-header primitive (components.css). The
         pre-9.1 .mv-header "context bar" with surface-elevated bg +
         border-bottom + py-4 was retired alongside the 3x duplicated
         {prefix}-header rule sets in mv/fc/ex CSS. Top spacing tightened
         from chrome to content ~200px (was: chrome 64px + bar 56px + main
         pt-20 80px) to ~108px (chrome 64px + main pt-4 16px + header
         content ~28px). -->
    <header class="subpage-header mb-6">
      <div class="subpage-header__lhs">
        <button type="button" class="subpage-header__back" data-action="back-to-dashboard" aria-label="Quay về dashboard Vocabulary">
          <i data-lucide="arrow-left"></i>
          <span>Vocabulary</span>
        </button>
        <span class="subpage-header__sep">|</span>
        <h1 class="subpage-header__title">My Vocab Bank</h1>
      </div>
      <button data-action="toggle-add-form" class="mv-add-btn text-sm font-medium px-4 py-1.5 rounded-lg">
        <i data-lucide="plus"></i>
        Add word
      </button>
    </header>


    <!-- Sprint 6.0 banner — Sprint 7.3 visibility controlled by mount() opts.embedded. -->
    <div data-banner="moved" class="mv-banner rounded-lg p-3 mb-5 text-sm flex items-center gap-3 hidden">
      <span class="mv-banner__icon" aria-hidden="true">📍</span>
      <div class="mv-banner__body">
        Trang này đã được tích hợp vào trang
        <a href="/pages/vocabulary.html#my-vocab" class="mv-banner__link">Từ vựng</a>
        — bạn có thể truy cập My Vocabulary, Flashcards và Bài tập trong một nơi.
      </div>
    </div>

    <!-- Stats bar -->
    <div data-stats-bar class="mv-stats hidden flex items-center gap-6 mb-5 text-sm">
      <span class="mv-stat">Total: <strong data-stat="total" class="mv-stat__val mv-stat__val--total">0</strong></span>
      <span class="mv-stat">Learning: <strong data-stat="learning" class="mv-stat__val mv-stat__val--learning">0</strong></span>
      <span class="mv-stat">Mastered: <strong data-stat="mastered" class="mv-stat__val mv-stat__val--mastered">0</strong></span>
      <span class="ml-auto flex items-center gap-2">
        <button data-action="download-csv" class="mv-export-btn mv-export-btn--primary text-xs px-3 py-1 rounded-lg"
                title="Tải về CSV (Excel-compatible)">
          <i data-lucide="download"></i> CSV
        </button>
        <button data-action="download-json" class="mv-export-btn mv-export-btn--secondary text-xs px-3 py-1 rounded-lg"
                title="Tải về JSON (full backup)">
          <i data-lucide="download"></i> JSON
        </button>
      </span>
    </div>

    <!-- Manual add form -->
    <div data-add-form class="mv-add-form mb-5 p-4 rounded-xl">
      <h3 class="mv-add-form__title text-sm font-semibold mb-3">Add a word manually</h3>
      <div class="flex flex-col gap-3">
        <input data-input="headword" type="text" placeholder="Word or phrase *"
               class="mv-input w-full px-3 py-2 rounded-lg text-sm" />
        <input data-input="context" type="text" placeholder="Example sentence (optional)"
               class="mv-input w-full px-3 py-2 rounded-lg text-sm" />
        <div class="flex gap-2">
          <button data-action="submit-add-word" class="mv-save-btn px-4 py-1.5 text-sm font-medium rounded-lg">Save</button>
          <button data-action="toggle-add-form" class="mv-cancel-btn px-4 py-1.5 text-sm rounded-lg">Cancel</button>
        </div>
        <p data-add-error class="mv-add-error text-xs hidden"></p>
      </div>
    </div>

    <!-- Filters.
         Sprint 10.1.5 — "Needs review" filter pill retired here. Items
         with source_type='needs_review' now live on the dedicated Needs
         Review tab (vocabulary.html#needs-review). The pre-10.1.5
         _applyFilter() switch still accepted 'needs_review' as a value,
         but the backend list endpoint default-excludes those rows so
         the filter would have returned empty anyway. -->
    <div class="flex flex-wrap gap-2 mb-5">
      <button class="filter-btn active" data-action="set-filter" data-filter="all">All</button>
      <button class="filter-btn" data-action="set-filter" data-filter="used_well">Used well</button>
      <button class="filter-btn" data-action="set-filter" data-filter="upgrade_suggested">Upgrade</button>
      <button class="filter-btn" data-action="set-filter" data-filter="manual">Manual</button>
      <button class="filter-btn" data-action="set-filter" data-filter="learning">Learning</button>
      <button class="filter-btn" data-action="set-filter" data-filter="mastered">Mastered</button>
    </div>

    <div data-state="loading" class="flex justify-center py-16"><div class="spinner"></div></div>
    <div data-state="disabled" class="hidden text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">Vocab Bank is not enabled</p>
      <p class="text-sm">This feature is available in the upcoming update.</p>
    </div>
    <div data-state="error" class="hidden text-center py-16 empty-state">
      <p class="text-sm">Failed to load your vocab bank. Please refresh.</p>
    </div>
    <div data-state="empty" class="hidden text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">No words yet</p>
      <p class="text-sm">Practice speaking and words will appear here automatically.</p>
    </div>

    <div data-list class="hidden flex flex-col gap-3"></div>
  </main>

  <!-- Flashcard picker modal (Phase D Wave 2) -->
  <div data-modal="fc-picker" class="mv-modal hidden fixed inset-0 z-50 flex items-center justify-center px-4">
    <div class="mv-modal__panel w-full max-w-md rounded-2xl p-5">
      <h3 class="mv-modal__title text-sm font-semibold mb-1">📚 Thêm vào flashcard stack</h3>
      <p data-fc-picker-headword class="mv-modal__subtitle text-xs mb-3"></p>
      <div data-fc-picker-list class="flex flex-col gap-2 max-h-64 overflow-y-auto mb-3"></div>
      <a href="/pages/flashcards.html" class="mv-modal__new-link block text-xs text-center mb-3 py-2 rounded-lg">
        + Tạo stack mới (sẽ rời trang này)
      </a>
      <div class="flex gap-2">
        <button data-action="close-fc-picker" class="mv-modal__close-btn flex-1 py-2 text-sm rounded-lg">Đóng</button>
      </div>
    </div>
  </div>

  <!-- Report modal -->
  <div data-modal="report" class="mv-modal hidden fixed inset-0 z-50 flex items-center justify-center px-4">
    <div class="mv-modal__panel w-full max-w-sm rounded-2xl p-5">
      <h3 class="mv-modal__title text-sm font-semibold mb-3">Report incorrect word?</h3>
      <p class="mv-modal__subtitle text-xs mb-4">This helps us improve extraction quality. The word will be removed from your bank.</p>
      <textarea data-input="report-reason" rows="2" placeholder="Optional reason..."
                class="mv-input mv-input--textarea w-full px-3 py-2 rounded-lg text-sm mb-3 resize-none"></textarea>
      <div class="flex gap-2">
        <button data-action="submit-report" class="mv-report-submit flex-1 py-2 text-sm font-medium rounded-lg">Report & Remove</button>
        <button data-action="close-report" class="mv-modal__close-btn flex-1 py-2 text-sm rounded-lg">Cancel</button>
      </div>
    </div>
  </div>
`;


function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


export async function mount(container, opts = {}) {
  const { embedded = false } = opts;

  const guard = guardMount(container);
  if (guard.alreadyMounted) return guard.getHandle();

  // Closure-scoped state — replaces the IIFE-scoped vars in the legacy
  // my-vocabulary.js. One container = one state bag.
  const BASE = window.api && window.api.base;
  if (!BASE) {
    container.innerHTML =
      '<p style="text-align:center;padding:3rem;color:var(--av-text-muted);">' +
      'window.api not initialized — module cannot bootstrap.</p>';
    return { unmount: () => {} };
  }

  let _token = null;
  let _allItems = [];
  let _currentFilter = 'all';
  let _reportVocabId = null;
  let _exercisesEnabled = false;
  let _flashcardEnabled = false;
  let _pickerVocabId = null;
  let _pickerStacksCache = null;
  let _flashToastTimer = null;

  // Inject HTML.
  container.innerHTML = HTML;

  // Scoped query helpers.
  const $ = (sel) => container.querySelector(sel);
  const $$ = (sel) => Array.from(container.querySelectorAll(sel));

  // Banner — Sprint 7.3 visibility logic: hidden when embedded, shown
  // on the standalone shell.
  const banner = $('[data-banner="moved"]');
  if (banner) banner.classList.toggle('hidden', !!embedded);

  // ── Auth / feature-flag bootstrap ───────────────────────────────
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

    try {
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (!meRes.ok) {
        showState('disabled');
        return;
      }
      const me = await meRes.json();
      if (me.vocab_bank_enabled !== true) {
        showState('disabled');
        return;
      }
      _exercisesEnabled = (me.d1_enabled === true) || (me.d3_enabled === true);
      _flashcardEnabled = (me.flashcard_enabled === true);
    } catch (_) {
      showState('disabled');
      return;
    }

    await loadStats();
    await loadVocab();
  }

  // ── API helpers ─────────────────────────────────────────────────
  function authHeaders() {
    return { Authorization: `Bearer ${_token}`, 'Content-Type': 'application/json' };
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(`${BASE}/api/vocabulary/bank${path}`, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
    });
    if (res.status === 403) {
      showState('disabled');
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Load ────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const stats = await apiFetch('/stats');
      if (!stats) return;
      $('[data-stat="total"]').textContent = stats.total;
      $('[data-stat="learning"]').textContent = stats.learning;
      $('[data-stat="mastered"]').textContent = stats.mastered;
      $('[data-stats-bar]').classList.remove('hidden');
    } catch (_) {}
  }

  async function loadVocab() {
    showState('loading');
    try {
      const items = await apiFetch('/');
      if (items === null) return;
      _allItems = items;
      renderList();
    } catch (err) {
      console.error('[my-vocab] load failed:', err);
      if (err.message.includes('403')) {
        showState('disabled');
      } else {
        showState('error');
      }
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  function renderList() {
    const listEl = $('[data-list]');
    const filtered = _applyFilter(_allItems, _currentFilter);

    if (!filtered.length) {
      listEl.classList.add('hidden');
      showState(_allItems.length ? 'empty' : 'empty');
      return;
    }

    listEl.innerHTML = filtered.map(cardHtml).join('');
    listEl.classList.remove('hidden');
    $('[data-state="loading"]').classList.add('hidden');
    $('[data-state="empty"]').classList.add('hidden');
    $('[data-state="error"]').classList.add('hidden');
    $('[data-state="disabled"]').classList.add('hidden');
  }

  function cardHtml(item) {
    const badgeClass = `badge-${item.source_type}`;
    const badgeLabel = {
      used_well:          'Dùng tốt ✓',
      needs_review:       'Cần xem lại ⚠',
      upgrade_suggested:  'Nâng cấp ↑',
      manual:             'Thủ công',
    }[item.source_type] || item.source_type;

    // Sprint 10.2 — button writes to SRS (flashcard_reviews), not to
    // the deprecated mastery_status column. Label flipped to Vietnamese
    // and reframed as an action ("Đánh dấu đã thuộc") rather than a
    // status ("Mastered"); the title attr nudges the user toward
    // understanding that SRS reviews update mastery automatically.
    const isMastered = item.mastery_status === 'mastered';
    const masteryClass = isMastered ? 'mastery-mastered' : 'mastery-learning';
    const masteryLabel = isMastered ? 'Đã thuộc ✓' : 'Đánh dấu đã thuộc';
    const nextMastered = isMastered ? 'false' : 'true';
    const masteryTitle = 'Tự động cập nhật khi bạn ôn tập đều';

    const defBlock = (item.definition_en || item.definition_vi)
      ? `<div class="mt-2 text-xs mv-def-block">
           ${item.definition_en ? `<span>${esc(item.definition_en)}</span>` : ''}
           ${item.definition_vi ? `<span class="mv-def-vi"> · ${esc(item.definition_vi)}</span>` : ''}
         </div>` : '';

    const upgradeHint = item.source_type === 'upgrade_suggested' && item.original_word
      ? `<p class="text-xs mt-1 mv-upgrade-hint">Nâng cấp từ: <em>${esc(item.original_word)}</em></p>` : '';

    const suggestionHint = item.source_type === 'needs_review' && item.suggestion
      ? `<p class="text-xs mt-1 mv-suggestion-hint">Gợi ý: <em>${esc(item.suggestion)}</em></p>` : '';

    const sourceLink = item.session_id
      ? `<a href="/pages/result.html?id=${esc(item.session_id)}"
            class="vocab-action vocab-action--source"
            title="Xem buổi luyện tập">↗ nguồn</a>` : '';

    const practiceLink = _exercisesEnabled
      ? `<a href="/pages/exercises.html"
            class="vocab-action vocab-action--practice"
            title="Practice with this word">▶ practice</a>` : '';

    let flashcardBtn = '';
    let previewBtn = '';
    let triageActions = '';

    if (item.source_type === 'needs_review') {
      triageActions = `
        <button class="vocab-action vocab-action--fixed"
                data-action="mark-fixed" data-vocab-id="${esc(item.id)}"
                title="Đã sửa grammar/usage — đưa vocab này vào flashcard">
          ✏️ Đã sửa, đưa lên flashcard
        </button>
        <button class="vocab-action vocab-action--skip"
                data-action="skip-vocab" data-vocab-id="${esc(item.id)}"
                title="Bỏ qua vocab này, sẽ không hiện lại">
          🗑️ Bỏ qua
        </button>`;
    } else {
      if (_flashcardEnabled) {
        flashcardBtn = `<button class="vocab-action vocab-action--stack"
                data-action="open-fc-picker"
                data-vocab-id="${esc(item.id)}" data-headword="${esc(item.headword)}"
                title="Thêm vào flashcard stack">📚 +Stack</button>`;
      }
      previewBtn = `<button class="vocab-action vocab-action--preview"
                data-action="preview-flashcard" data-vocab-id="${esc(item.id)}"
                title="Xem trước flashcard">👁️ Xem trước</button>`;
    }

    const acceptBtn = item.source_type === 'upgrade_suggested'
      ? `<button class="vocab-action vocab-action--accept"
                data-action="accept-suggestion" data-vocab-id="${esc(item.id)}"
                title="Đưa vào danh sách của tôi">➕ Đưa vào danh sách</button>`
      : '';

    return `
      <div class="vocab-card" id="card-${esc(item.id)}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-white font-semibold text-base">${esc(item.headword)}</span>
            <span class="source-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <button class="mastery-btn ${masteryClass}"
                  data-action="toggle-mastery"
                  data-vocab-id="${esc(item.id)}"
                  data-mastered="${nextMastered}"
                  title="${masteryTitle}">
            ${masteryLabel}
          </button>
        </div>

        ${defBlock}
        ${item.context_sentence
          ? `<p class="text-xs italic mt-2 mb-1 mv-context">"${esc(item.context_sentence)}"</p>`
          : ''}
        ${upgradeHint}
        ${suggestionHint}
        ${item.reason
          ? `<p class="text-xs mt-1 mv-reason">${esc(item.reason)}</p>`
          : ''}

        <div class="flex items-center justify-between mt-3 flex-wrap gap-y-2">
          <div class="flex items-center flex-wrap gap-x-3 gap-y-2">
            ${sourceLink}
            ${practiceLink}
            ${previewBtn}
            ${flashcardBtn}
            ${acceptBtn}
            ${triageActions}
          </div>
          <button class="report-btn" data-action="open-report" data-vocab-id="${esc(item.id)}">
            Report incorrect
          </button>
        </div>
      </div>`;
  }

  function _applyFilter(items, filter) {
    if (filter === 'all') return items;
    if (['learning', 'mastered'].includes(filter)) {
      return items.filter(i => i.mastery_status === filter);
    }
    return items.filter(i => i.source_type === filter);
  }

  // ── Handlers (formerly window.* globals) ────────────────────────
  function setFilter(filter, btn) {
    _currentFilter = filter;
    $$('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  }

  function toggleAddForm() {
    const form = $('[data-add-form]');
    form.classList.toggle('open');
    if (form.classList.contains('open')) {
      $('[data-input="headword"]').focus();
    }
  }

  async function submitAddWord() {
    const headword = $('[data-input="headword"]').value.trim();
    const context = $('[data-input="context"]').value.trim();
    const errorEl = $('[data-add-error]');
    errorEl.classList.add('hidden');

    if (!headword) {
      errorEl.textContent = 'Please enter a word.';
      errorEl.classList.remove('hidden');
      return;
    }

    try {
      const newItem = await apiFetch('/', {
        method: 'POST',
        body: JSON.stringify({ headword, context_sentence: context || null }),
      });
      if (!newItem) return;
      _allItems.unshift(newItem);
      $('[data-input="headword"]').value = '';
      $('[data-input="context"]').value = '';
      $('[data-add-form]').classList.remove('open');
      await loadStats();
      renderList();
    } catch (err) {
      const msg = err.message.includes('409')
        ? `"${headword}" is already in your bank.`
        : 'Failed to save. Try again.';
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  // Sprint 10.2 — `mastered` is a boolean toggle. The PATCH handler
  // writes to flashcard_reviews; the server response carries the
  // derived mastery_status, which we trust over local guessing so the
  // UI never lies about SRS state (e.g. if a future server-side rule
  // change makes 'mastered' require a longer interval, the response
  // value will reflect that even if the local optimistic value is
  // stale).
  async function toggleMastery(vocabId, mastered) {
    try {
      const resp = await apiFetch(`/${vocabId}`, {
        method: 'PATCH',
        body: JSON.stringify({ mastered }),
      });
      const item = _allItems.find(i => i.id === vocabId);
      if (item && resp && resp.mastery_status) {
        item.mastery_status = resp.mastery_status;
      }
      await loadStats();
      renderList();
    } catch (err) {
      console.error('[my-vocab] mastery toggle failed:', err);
    }
  }

  function openReport(vocabId) {
    _reportVocabId = vocabId;
    $('[data-input="report-reason"]').value = '';
    $('[data-modal="report"]').classList.remove('hidden');
  }

  function closeReport() {
    $('[data-modal="report"]').classList.add('hidden');
    _reportVocabId = null;
  }

  async function submitReport() {
    if (!_reportVocabId) return;
    const reason = $('[data-input="report-reason"]').value.trim();
    try {
      await apiFetch(`/${_reportVocabId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      });
      _allItems = _allItems.filter(i => i.id !== _reportVocabId);
      closeReport();
      await loadStats();
      renderList();
    } catch (err) {
      console.error('[my-vocab] report failed:', err);
      closeReport();
    }
  }

  async function openFlashcardPicker(vocabId, headword) {
    _pickerVocabId = vocabId;
    $('[data-fc-picker-headword]').textContent = headword
      ? `Chọn stack để thêm "${headword}"` : '';
    const listEl = $('[data-fc-picker-list]');
    listEl.innerHTML = '<p class="text-xs text-center py-3 mv-picker-msg">Đang tải stacks…</p>';
    $('[data-modal="fc-picker"]').classList.remove('hidden');

    try {
      const res = await fetch(`${BASE}/api/flashcards/stacks`, { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      const all = Array.isArray(body.stacks) ? body.stacks : [];
      _pickerStacksCache = all.filter(s => s.type === 'manual');
    } catch (err) {
      console.error('[my-vocab] picker stacks load failed:', err);
      listEl.innerHTML = '<p class="text-xs text-center py-3 mv-picker-msg mv-picker-msg--error">Không tải được stacks.</p>';
      return;
    }

    if (!_pickerStacksCache.length) {
      listEl.innerHTML = '<p class="text-xs text-center py-3 mv-picker-msg">Bạn chưa có stack thủ công nào.<br/>Tạo stack mới ở dưới để bắt đầu.</p>';
      return;
    }

    listEl.innerHTML = _pickerStacksCache.map(s => `
      <button class="mv-stack-row flex items-center justify-between"
              data-action="add-to-fc-stack"
              data-stack-id="${esc(s.id)}" data-stack-name="${esc(s.name)}">
        <span class="text-sm mv-stack-row__name">${esc(s.name)}</span>
        <span class="mv-stack-row__count">${s.card_count ?? 0} thẻ</span>
      </button>
    `).join('');
  }

  function closeFlashcardPicker() {
    $('[data-modal="fc-picker"]').classList.add('hidden');
    _pickerVocabId = null;
  }

  async function addToFlashcardStack(stackId, stackName) {
    if (!_pickerVocabId) return;
    const vocabId = _pickerVocabId;
    closeFlashcardPicker();
    try {
      const res = await fetch(`${BASE}/api/flashcards/stacks/${encodeURIComponent(stackId)}/cards`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ vocabulary_id: vocabId }),
      });
      if (res.ok || res.status === 201) {
        flashToast(`Đã thêm vào "${stackName}".`, 'success');
        return;
      }
      if (res.status === 409) {
        flashToast(`Đã có trong "${stackName}".`, 'info');
        return;
      }
      const err = await res.json().catch(() => ({}));
      flashToast(err.detail || 'Không thêm được vào stack.', 'error');
    } catch (err) {
      console.error('[my-vocab] add to stack failed:', err);
      flashToast('Lỗi mạng khi thêm vào stack.', 'error');
    }
  }

  function flashToast(message, kind) {
    let el = document.getElementById('vocab-flash-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vocab-flash-toast';
      el.className = 'mv-toast';
      document.body.appendChild(el);
    }
    const variant = (kind === 'success' || kind === 'error') ? kind : 'info';
    el.className = `mv-toast mv-toast--${variant}`;
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(_flashToastTimer);
    _flashToastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  }

  function showState(state) {
    ['loading', 'disabled', 'error', 'empty'].forEach(s => {
      const el = $(`[data-state="${s}"]`);
      if (el) el.classList.toggle('hidden', s !== state);
    });
    if (state !== 'empty') {
      $('[data-list]')?.classList.add('hidden');
    }
  }

  async function downloadExport(format) {
    if (!_token) {
      alert('Phải đăng nhập để tải về.');
      return;
    }
    const url = `${BASE}/api/vocabulary/bank/export?format=${encodeURIComponent(format)}`;
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${_token}` } });
    } catch (e) {
      alert(`Lỗi mạng: ${e.message || e}`);
      return;
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch (_) {}
      alert(`Tải về thất bại (${res.status})${detail ? ': ' + detail : ''}`);
      return;
    }

    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="?([^"]+)"?/i.exec(cd);
    const fname = m ? m[1] : `vocab_export.${format}`;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  }

  async function previewFlashcard(vocabId) {
    let vocab;
    try {
      vocab = await apiFetch(`/${vocabId}`);
    } catch (err) {
      console.error('[my-vocab] preview load failed:', err);
      flashToast('Không tải được flashcard.', 'error');
      return;
    }
    if (!vocab) return;
    _renderPreviewModal(vocab);
  }

  function _renderPreviewModal(vocab) {
    const ipa = vocab.ipa
      ? `<div class="mv-preview-ipa">${esc(vocab.ipa)}</div>` : '';
    const defVi = vocab.definition_vi
      ? `<p class="mv-preview-def-vi">${esc(vocab.definition_vi)}</p>` : '';
    const defEn = vocab.definition_en
      ? `<p class="mv-preview-def-en">${esc(vocab.definition_en)}</p>` : '';
    const example = vocab.example_sentence
      ? `<div class="mv-preview-example">"${esc(vocab.example_sentence)}"</div>` : '';
    const contextLine = vocab.context_sentence
      ? `<p class="mv-preview-context">Trong câu của bạn: "${esc(vocab.context_sentence)}"</p>` : '';
    const noBack = !defVi && !defEn && !example && !contextLine
      ? `<p class="mv-preview-no-back">Thẻ này chưa có nội dung mặt sau (đợi enrichment).</p>` : '';

    const modal = document.createElement('div');
    modal.className = 'mv-preview-modal';
    modal.innerHTML = `
      <div class="mv-preview-modal__panel">
        <button data-preview-close aria-label="Đóng" class="mv-preview-modal__close">×</button>
        <div class="mv-preview-face mv-preview-face--front">
          <p class="mv-preview-face__label">Mặt trước</p>
          <h2 class="mv-preview-face__headword">${esc(vocab.headword)}</h2>
          ${ipa}
        </div>
        <div class="mv-preview-face mv-preview-face--back">
          <p class="mv-preview-face__label">Mặt sau</p>
          ${defVi}
          ${defEn}
          ${example}
          ${contextLine}
          ${noBack}
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('[data-preview-close]').addEventListener('click', close);
  }

  async function acceptSuggestion(vocabId) {
    const item = _allItems.find(i => i.id === vocabId);
    if (!item) return;
    if (item.source_type !== 'upgrade_suggested') return;

    const prevSource = item.source_type;
    item.source_type = 'manual';
    renderList();

    try {
      const res = await fetch(`${BASE}/api/vocabulary/bank/${encodeURIComponent(vocabId)}/accept`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (data && data.flashcard_added && data.stack_name) {
        flashToast(`Đã thêm vào danh sách + flashcard "${data.stack_name}".`, 'success');
      } else {
        flashToast('Đã đưa vào danh sách (chưa thêm được vào flashcard).', 'info');
      }
      await loadStats();
    } catch (err) {
      console.error('[my-vocab] accept failed:', err);
      item.source_type = prevSource;
      renderList();
      flashToast('Không thể đưa vào danh sách. Thử lại.', 'error');
    }
  }

  async function markFixed(vocabId) {
    const item = _allItems.find(i => i.id === vocabId);
    if (!item) return;
    if (item.source_type !== 'needs_review') return;

    const prevSource = item.source_type;
    item.source_type = 'manual';
    renderList();

    try {
      const res = await fetch(`${BASE}/api/vocabulary/bank/${encodeURIComponent(vocabId)}/mark-fixed`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (data && data.flashcard_added && data.stack_name) {
        flashToast(`Đã đánh dấu đã sửa + đưa vào flashcard "${data.stack_name}".`, 'success');
      } else {
        flashToast('Đã đánh dấu đã sửa (chưa thêm được vào flashcard).', 'info');
      }
      await loadStats();
    } catch (err) {
      console.error('[my-vocab] mark-fixed failed:', err);
      item.source_type = prevSource;
      renderList();
      flashToast('Không thể đánh dấu. Thử lại.', 'error');
    }
  }

  async function skipVocab(vocabId) {
    const item = _allItems.find(i => i.id === vocabId);
    if (!item) return;
    if (!confirm(`Bỏ qua "${item.headword}"? Vocab này sẽ không xuất hiện lại ở bất cứ đâu.`)) {
      return;
    }

    const idx = _allItems.findIndex(i => i.id === vocabId);
    const removed = _allItems.splice(idx, 1)[0];
    renderList();

    try {
      const res = await fetch(`${BASE}/api/vocabulary/bank/${encodeURIComponent(vocabId)}/skip`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      flashToast(`Đã bỏ qua "${removed.headword}".`, 'info');
      await loadStats();
    } catch (err) {
      console.error('[my-vocab] skip failed:', err);
      _allItems.splice(idx, 0, removed);
      renderList();
      flashToast('Không thể bỏ qua. Thử lại.', 'error');
    }
  }

  // Sprint 9.2 — back-link returns the user to the parent Vocabulary
  // dashboard. Embedded mode (inside /pages/vocabulary.html): clear
  // the hash so vocab-landing.js's hashchange listener falls back to
  // the dashboard view (no full page reload). Standalone shell mode:
  // hard-navigate to the parent page since there's no dashboard above
  // the current shell.
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

  // ── Event delegation (replaces 11 window.* handlers + inline onclick) ──
  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;
    const action = btn.dataset.action;
    const vocabId = btn.dataset.vocabId;

    switch (action) {
      case 'back-to-dashboard':  return backToDashboard();
      case 'toggle-add-form':    return toggleAddForm();
      case 'submit-add-word':    return submitAddWord();
      case 'set-filter':         return setFilter(btn.dataset.filter, btn);
      case 'submit-report':      return submitReport();
      case 'close-report':       return closeReport();
      case 'close-fc-picker':    return closeFlashcardPicker();
      case 'download-csv':       return downloadExport('csv');
      case 'download-json':      return downloadExport('json');
      case 'open-report':        return openReport(vocabId);
      case 'toggle-mastery':     return toggleMastery(vocabId, btn.dataset.mastered === 'true');
      case 'open-fc-picker':     return openFlashcardPicker(vocabId, btn.dataset.headword);
      case 'preview-flashcard':  return previewFlashcard(vocabId);
      case 'accept-suggestion':  return acceptSuggestion(vocabId);
      case 'mark-fixed':         return markFixed(vocabId);
      case 'skip-vocab':         return skipVocab(vocabId);
      case 'add-to-fc-stack':    return addToFlashcardStack(btn.dataset.stackId, btn.dataset.stackName);
      default:                   return;
    }
  }

  container.addEventListener('click', handleClick);

  // Hydrate Lucide icons that were emitted as <i data-lucide="…"> inside HTML.
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

  // Kick off the auth + feature-flag + data load.
  init();

  // ── unmount lifecycle ──────────────────────────────────────────
  function unmount() {
    container.removeEventListener('click', handleClick);
    clearTimeout(_flashToastTimer);
    const toast = document.getElementById('vocab-flash-toast');
    if (toast) toast.remove();
    container.innerHTML = '';
    guard.clearHandle();
  }

  const handle = { unmount };
  guard.setHandle(handle);
  return handle;
}
