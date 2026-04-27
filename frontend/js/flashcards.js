/**
 * flashcards.js — Phase D Wave 2 stack-list page.
 *
 * Flow:
 *   /auth/me → flag check (default-deny on flashcard_enabled)
 *   GET /api/flashcards/stacks → render auto + manual cards
 *   "Tạo stack mới" → modal (filter UI + live preview) → POST /stacks → reload
 *   Click stack → flashcard-study.html?stack=<id>
 *   Click delete (manual only) → DELETE /stacks/{id} → toast → reload
 *
 * No hardcoded URLs — every fetch goes through window.api which is bound to
 * the localhost/Railway switch in api.js.
 */

(function () {
  const BASE = window.api.base;

  let _token = null;
  // Modal state — flushed by openModal() / read by save handler.
  const _state = {
    topics: [],          // available distinct topics from /vocab-topics
    selectedTopics: new Set(),
    selectedCats:   new Set(),
    previewTimer:   null,
  };

  // ── Auth helpers ───────────────────────────────────────────────────────────

  async function getToken() {
    const sb = window.getSupabase ? window.getSupabase() : null;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  }

  function authHeaders() { return { Authorization: 'Bearer ' + _token }; }

  // ── Container helpers ──────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function setHtml(id, html) { $(id).innerHTML = html; }
  function showLoading() {
    setHtml('fc-container', '<div class="state-msg"><div class="spinner"></div></div>');
  }
  function showError(msg) {
    setHtml('fc-container',
      `<div class="state-msg error">${escape(msg || 'Không tải được flashcards.')}</div>`);
  }
  function showDisabled() {
    setHtml('fc-container',
      '<div class="state-msg">Tính năng Flashcards chưa bật cho tài khoản của bạn.</div>');
  }

  function escape(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(message, kind) {
    const el = $('fc-toast');
    el.className = 'toast ' + (kind === 'error' ? 'error' : 'success');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('visible'), 2500);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    showLoading();
    _token = await getToken();
    if (!_token) {
      window.location.href = window.api.url('index.html');
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

  // ── Stack list ─────────────────────────────────────────────────────────────

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
      setHtml('fc-container', `
        <div class="state-msg">
          <p class="text-base mb-2 text-white">Vocab Bank của bạn chưa có thẻ nào.</p>
          <p class="text-sm">Hãy luyện tập Speaking để hệ thống tự động trích xuất từ vựng,
            hoặc thêm thẻ thủ công từ trang Vocab Bank.</p>
          <a class="empty-cta" href="my-vocabulary.html">Mở Vocab Bank</a>
        </div>
      `);
      return;
    }

    const cardsHtml =
      `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">` +
        autos.map(autoCard).join('') +
        manuals.map(manualCard).join('') +
      `</div>`;

    setHtml('fc-container', `
      <div class="flex items-center justify-between mb-5">
        <div>
          <h2 class="text-lg font-semibold text-white">Stacks của bạn</h2>
          <p class="text-sm text-slate-400">3 nhóm tự động + ${manuals.length} stack thủ công</p>
        </div>
        <button id="fc-new-stack" class="btn-primary">+ Tạo stack mới</button>
      </div>
      ${cardsHtml}
    `);

    $('fc-new-stack').addEventListener('click', openModal);
    document.querySelectorAll('[data-stack-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        const id = el.getAttribute('data-stack-id');
        if (Number(el.getAttribute('data-card-count')) === 0) {
          toast('Stack chưa có thẻ nào.', 'error');
          return;
        }
        window.location.href =
          'flashcard-study.html?stack=' + encodeURIComponent(id);
      });
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteStack(btn.getAttribute('data-stack-id'));
      });
    });
  }

  function autoCard(s) {
    const icon = s.id === 'auto:all_vocab' ? '📚' :
                 s.id === 'auto:recent'    ? '🆕' : '🎯';
    const disabled = s.card_count === 0 ? 'disabled' : '';
    return `
      <div class="stack-card ${disabled}" data-stack-id="${escape(s.id)}" data-card-count="${s.card_count}">
        <div class="flex items-start justify-between">
          <span class="stack-icon">${icon}</span>
          <span class="pill-auto">Tự động</span>
        </div>
        <p class="stack-name">${escape(s.name)}</p>
        <p class="stack-meta">${s.card_count} thẻ</p>
      </div>
    `;
  }

  function manualCard(s) {
    const disabled = s.card_count === 0 ? 'disabled' : '';
    return `
      <div class="stack-card ${disabled}" data-stack-id="${escape(s.id)}" data-card-count="${s.card_count}">
        <button class="delete-btn" data-stack-id="${escape(s.id)}" title="Xoá stack">×</button>
        <div class="flex items-start justify-between">
          <span class="stack-icon">📂</span>
          <span class="pill-manual">Thủ công</span>
        </div>
        <p class="stack-name">${escape(s.name)}</p>
        <p class="stack-meta">${s.card_count} thẻ</p>
      </div>
    `;
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

  // ── Create-stack modal ─────────────────────────────────────────────────────

  async function openModal() {
    // Reset state on every open so a closed-then-reopened modal starts fresh.
    _state.selectedTopics.clear();
    _state.selectedCats.clear();
    $('m-name').value = '';
    $('m-search').value = '';
    $('m-after').value = '';
    document.querySelectorAll('#m-topics .chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.chip-group .chip[data-cat]').forEach(c => c.classList.remove('active'));
    setHtml('m-preview', '<span class="text-xs text-slate-500">Chọn bộ lọc để xem số thẻ phù hợp.</span>');
    $('m-save').disabled = true;

    $('fc-modal').classList.add('visible');

    // Load topics dropdown lazily — first open hits /vocab-topics, subsequent
    // opens reuse cached list.
    if (_state.topics.length === 0) {
      try {
        const res = await fetch(BASE + '/api/flashcards/vocab-topics', { headers: authHeaders() });
        const body = await res.json();
        _state.topics = Array.isArray(body.topics) ? body.topics : [];
      } catch (_) {
        _state.topics = [];
      }
    }
    renderTopicChips();

    // Bind handlers (idempotent — modal is reused).
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick   = saveStack;
    $('m-name').oninput   = updateSaveEnabled;
    $('m-search').oninput = onFilterChanged;
    $('m-after').onchange = onFilterChanged;
    document.querySelectorAll('.chip-group .chip[data-cat]').forEach(c => {
      c.onclick = () => {
        const cat = c.getAttribute('data-cat');
        if (_state.selectedCats.has(cat)) {
          _state.selectedCats.delete(cat);
          c.classList.remove('active');
        } else {
          _state.selectedCats.add(cat);
          c.classList.add('active');
        }
        onFilterChanged();
      };
    });
  }

  function renderTopicChips() {
    const wrap = $('m-topics');
    if (!_state.topics.length) {
      wrap.innerHTML = '<span class="text-xs text-slate-500">Chưa có chủ đề nào — luyện Speaking để hệ thống gắn topic tự động.</span>';
      return;
    }
    wrap.innerHTML = _state.topics
      .map(t => `<span class="chip" data-topic="${escape(t)}">${escape(t)}</span>`)
      .join('');
    wrap.querySelectorAll('.chip').forEach(c => {
      c.onclick = () => {
        const t = c.getAttribute('data-topic');
        if (_state.selectedTopics.has(t)) {
          _state.selectedTopics.delete(t);
          c.classList.remove('active');
        } else {
          _state.selectedTopics.add(t);
          c.classList.add('active');
        }
        onFilterChanged();
      };
    });
  }

  function closeModal() {
    $('fc-modal').classList.remove('visible');
  }

  function buildFilterConfig() {
    const cfg = {};
    if (_state.selectedTopics.size) cfg.topics = Array.from(_state.selectedTopics);
    if (_state.selectedCats.size)   cfg.categories = Array.from(_state.selectedCats);
    const search = $('m-search').value.trim();
    if (search) cfg.search = search;
    const after = $('m-after').value.trim();
    if (after) cfg.added_after = after;
    return cfg;
  }

  function updateSaveEnabled() {
    const name = $('m-name').value.trim();
    // Mirror backend rule: 3-50 chars after trim.
    $('m-save').disabled = !(name.length >= 3 && name.length <= 50);
  }

  function onFilterChanged() {
    updateSaveEnabled();
    // Debounce so typing in search doesn't fire a request per keystroke.
    clearTimeout(_state.previewTimer);
    _state.previewTimer = setTimeout(refreshPreview, 250);
  }

  async function refreshPreview() {
    const cfg = buildFilterConfig();
    setHtml('m-preview', '<span class="text-xs text-slate-500">Đang đếm…</span>');
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks/preview', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_config: cfg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setHtml('m-preview',
          `<span class="text-xs" style="color:#fca5a5">${escape(err.detail || 'Bộ lọc không hợp lệ')}</span>`);
        return;
      }
      const body = await res.json();
      const count = Number(body.card_count || 0);
      const words = Array.isArray(body.preview_headwords) ? body.preview_headwords : [];
      if (count === 0) {
        setHtml('m-preview', '<span class="text-xs text-slate-500">Không có thẻ nào khớp bộ lọc.</span>');
      } else {
        setHtml('m-preview',
          `<span class="preview-count">${count} thẻ</span> sẽ được thêm vào stack.` +
          (words.length ? `<div class="preview-words">${escape(words.slice(0, 10).join(', '))}…</div>` : ''));
      }
      // Disable save when no cards match — frontend mirror of plan rule
      // "Lưu (disabled nếu count=0)".
      const name = $('m-name').value.trim();
      $('m-save').disabled = !(name.length >= 3 && name.length <= 50 && count > 0);
    } catch (err) {
      console.error('[flashcards] preview', err);
      setHtml('m-preview',
        '<span class="text-xs" style="color:#fca5a5">Không thể xem trước. Thử lại sau.</span>');
    }
  }

  async function saveStack() {
    const name = $('m-name').value.trim();
    const cfg = buildFilterConfig();
    $('m-save').disabled = true;
    try {
      const res = await fetch(BASE + '/api/flashcards/stacks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: 'manual', filter_config: cfg }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || 'Không tạo được stack.', 'error');
        $('m-save').disabled = false;
        return;
      }
      const stack = await res.json();
      closeModal();
      toast(`Đã tạo "${stack.name}" với ${stack.card_count} thẻ.`, 'success');
      // Jump straight to study if the new stack has cards; otherwise reload list.
      if (stack.card_count > 0 && stack.id) {
        window.location.href = 'flashcard-study.html?stack=' + encodeURIComponent(stack.id);
        return;
      }
      renderStacks();
    } catch (err) {
      console.error('[flashcards] save', err);
      toast('Không tạo được stack.', 'error');
      $('m-save').disabled = false;
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
