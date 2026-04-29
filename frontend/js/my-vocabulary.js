/**
 * my-vocabulary.js — Personal Vocab Bank logic
 */

(function () {
  // api.js is loaded right above this file in my-vocabulary.html — its
  // single localhost/Railway switch is the authoritative source of the
  // API base URL.  Earlier copies kept a duplicated fallback here, which
  // was dead code (api.js always wins) and a textbook URL-drift trap
  // flagged by the Wave 2 audit (LOW #3).
  const BASE = window.api.base;

  let _token = null;
  let _allItems = [];
  let _currentFilter = 'all';
  let _reportVocabId = null;
  let _exercisesEnabled = false;   // populated from /auth/me; default-deny.
  let _flashcardEnabled = false;   // Phase D Wave 2 — same default-deny semantics.
  let _pickerVocabId = null;
  let _pickerStacksCache = null;   // [] of {id, name, type} — refreshed on each open

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    try {
      const sb = window.getSupabase ? window.getSupabase() : null;
      if (sb) {
        const { data } = await sb.auth.getSession();
        _token = data?.session?.access_token || null;
      }
    } catch (_) {}

    if (!_token) {
      window.location.href = '../index.html';
      return;
    }

    // Check feature flag before making any bank API calls.
    // Default-deny: any failure (network error, non-ok response) shows disabled state.
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

  // ── API helpers ───────────────────────────────────────────────────────────

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

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadStats() {
    try {
      const stats = await apiFetch('/stats');
      if (!stats) return;
      document.getElementById('stat-total').textContent = stats.total;
      document.getElementById('stat-learning').textContent = stats.learning;
      document.getElementById('stat-mastered').textContent = stats.mastered;
      document.getElementById('stats-bar').classList.remove('hidden');
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
      console.error('[vocab] load failed:', err);
      if (err.message.includes('403')) {
        showState('disabled');
      } else {
        showState('error');
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderList() {
    const listEl = document.getElementById('vocab-list');
    const filtered = _applyFilter(_allItems, _currentFilter);

    if (!filtered.length) {
      listEl.classList.add('hidden');
      showState(_allItems.length ? 'empty-filter' : 'empty');
      return;
    }

    listEl.innerHTML = filtered.map(item => cardHtml(item)).join('');
    listEl.classList.remove('hidden');
    document.getElementById('state-loading').classList.add('hidden');
    document.getElementById('state-empty').classList.add('hidden');
    document.getElementById('state-error').classList.add('hidden');
    document.getElementById('state-disabled').classList.add('hidden');
  }

  function cardHtml(item) {
    const badgeClass = `badge-${item.source_type}`;
    const badgeLabel = {
      used_well:          'Dùng tốt ✓',
      needs_review:       'Cần xem lại ⚠',
      upgrade_suggested:  'Nâng cấp ↑',
      manual:             'Thủ công',
    }[item.source_type] || item.source_type;

    const masteryClass = item.mastery_status === 'mastered' ? 'mastery-mastered' : 'mastery-learning';
    const masteryLabel = item.mastery_status === 'mastered' ? 'Mastered' : 'Learning';
    const nextStatus = item.mastery_status === 'mastered' ? 'learning' : 'mastered';

    const defBlock = (item.definition_en || item.definition_vi)
      ? `<div class="mt-2 text-xs" style="color:rgba(255,255,255,0.55);">
           ${item.definition_en ? `<span>${esc(item.definition_en)}</span>` : ''}
           ${item.definition_vi ? `<span style="color:rgba(255,255,255,0.35);"> · ${esc(item.definition_vi)}</span>` : ''}
         </div>`
      : '';

    const upgradeHint = item.source_type === 'upgrade_suggested' && item.original_word
      ? `<p class="text-xs mt-1" style="color:rgba(192,132,252,0.65);">Nâng cấp từ: <em>${esc(item.original_word)}</em></p>`
      : '';

    const suggestionHint = item.source_type === 'needs_review' && item.suggestion
      ? `<p class="text-xs mt-1" style="color:rgba(251,146,60,0.75);">Gợi ý: <em>${esc(item.suggestion)}</em></p>`
      : '';

    const sourceLink = item.session_id
      ? `<a href="result.html?id=${esc(item.session_id)}"
            class="vocab-action vocab-action--source"
            title="Xem buổi luyện tập">↗ nguồn</a>`
      : '';

    // TODO Wave 2: pass vocab_id to filter D3 exercises by target word.
    // Wave 1 hub doesn't consume vocab_id, so we ship the link as a plain
    // entry point to avoid a dead query param in the URL bar.
    const practiceLink = _exercisesEnabled
      ? `<a href="exercises.html"
            class="vocab-action vocab-action--practice"
            title="Practice with this word">▶ practice</a>`
      : '';

    // Phase D Wave 2 entry point.  Two layered gates:
    //   1. _flashcardEnabled: feature flag (PHASE_D §16 default-deny).
    //   2. source_type !== 'needs_review': dogfood polish — AI-flagged
    //      vocab must not be enrolled into SRS or it teaches the wrong
    //      form.  Backend enforces the same rule (defense-in-depth).
    //
    // For needs_review rows we render an explanatory "🔒 Đã khoá" cue
    // instead of nothing, so the absence of +Stack reads as a deliberate
    // policy and not a bug.
    let flashcardBtn = '';
    if (_flashcardEnabled) {
      if (item.source_type === 'needs_review') {
        flashcardBtn = `<span class="vocab-action vocab-action--locked"
              title="Vocab AI flag là 'cần xem lại' — sửa từ trước khi đưa vào flashcard.">🔒 Đã khoá</span>`;
      } else {
        flashcardBtn = `<button class="vocab-action vocab-action--stack"
                onclick="openFlashcardPicker('${esc(item.id)}', '${esc(item.headword)}')"
                title="Thêm vào flashcard stack">📚 +Stack</button>`;
      }
    }

    // Day 2 dogfood: preview shows the same front/back layout the
    // flashcard study page uses, so the user can sanity-check what an AI
    // entry will look like as a card before committing it to a stack.
    //
    // Locked for `needs_review` to stay consistent with the +Stack lock —
    // showing AI-flagged-as-incorrect vocab in flashcard form would imply
    // it's safe to learn that way.  Same `🔒 Đã khoá` cue, same tooltip
    // direction so the two locked controls read as one rule, not two bugs.
    const previewBtn = item.source_type !== 'needs_review'
      ? `<button class="vocab-action vocab-action--preview"
                onclick="window._myVocab.previewFlashcard('${esc(item.id)}')"
                title="Xem trước flashcard">👁️ Xem trước</button>`
      : `<span class="vocab-action vocab-action--locked"
                title="Vocab AI flag là 'cần xem lại' — sửa từ trước khi xem flashcard.">🔒 Đã khoá</span>`;

    // Day 2 dogfood: explicit "accept suggestion" gesture for upgrade_suggested
    // rows.  Promotes source_type → 'manual' so the card stops looking
    // provisional in the badge and no longer appears under the "Upgrade" filter.
    const acceptBtn = item.source_type === 'upgrade_suggested'
      ? `<button class="vocab-action vocab-action--accept"
                onclick="window._myVocab.acceptSuggestion('${esc(item.id)}')"
                title="Đưa vào danh sách của tôi">➕ Đưa vào danh sách</button>`
      : '';

    return `
      <div class="vocab-card" id="card-${item.id}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-white font-semibold text-base">${esc(item.headword)}</span>
            <span class="source-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <button class="mastery-btn ${masteryClass}" onclick="toggleMastery('${item.id}', '${nextStatus}', this)">
            ${masteryLabel}
          </button>
        </div>

        ${defBlock}
        ${item.context_sentence
          ? `<p class="text-xs italic mt-2 mb-1" style="color:rgba(148,163,184,0.7);">"${esc(item.context_sentence)}"</p>`
          : ''}
        ${upgradeHint}
        ${suggestionHint}
        ${item.reason
          ? `<p class="text-xs mt-1" style="color:rgba(255,255,255,0.25);">${esc(item.reason)}</p>`
          : ''}

        <div class="flex items-center justify-between mt-3 flex-wrap gap-y-2">
          <div class="flex items-center flex-wrap gap-x-3 gap-y-2">
            ${sourceLink}
            ${practiceLink}
            ${previewBtn}
            ${flashcardBtn}
            ${acceptBtn}
          </div>
          <button class="report-btn" onclick="openReport('${item.id}')">Report incorrect</button>
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

  // ── Filter ────────────────────────────────────────────────────────────────

  window.setFilter = function (filter, btn) {
    _currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  };

  // ── Add word ──────────────────────────────────────────────────────────────

  window.toggleAddForm = function () {
    const form = document.getElementById('add-form');
    form.classList.toggle('open');
    if (form.classList.contains('open')) {
      document.getElementById('add-headword').focus();
    }
  };

  window.submitAddWord = async function () {
    const headword = document.getElementById('add-headword').value.trim();
    const context = document.getElementById('add-context').value.trim();
    const errorEl = document.getElementById('add-error');
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
      document.getElementById('add-headword').value = '';
      document.getElementById('add-context').value = '';
      document.getElementById('add-form').classList.remove('open');
      await loadStats();
      renderList();
    } catch (err) {
      const msg = err.message.includes('409') ? `"${headword}" is already in your bank.` : 'Failed to save. Try again.';
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  };

  // ── Mastery toggle ────────────────────────────────────────────────────────

  window.toggleMastery = async function (vocabId, newStatus, btn) {
    try {
      await apiFetch(`/${vocabId}`, {
        method: 'PATCH',
        body: JSON.stringify({ mastery_status: newStatus }),
      });
      const item = _allItems.find(i => i.id === vocabId);
      if (item) item.mastery_status = newStatus;
      await loadStats();
      renderList();
    } catch (err) {
      console.error('[vocab] mastery toggle failed:', err);
    }
  };

  // ── FP Report ─────────────────────────────────────────────────────────────

  window.openReport = function (vocabId) {
    _reportVocabId = vocabId;
    document.getElementById('report-reason').value = '';
    document.getElementById('report-modal').classList.remove('hidden');
  };

  window.closeReport = function () {
    document.getElementById('report-modal').classList.add('hidden');
    _reportVocabId = null;
  };

  window.submitReport = async function () {
    if (!_reportVocabId) return;
    const reason = document.getElementById('report-reason').value.trim();
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
      console.error('[vocab] report failed:', err);
      closeReport();
    }
  };

  // ── Flashcard picker (Phase D Wave 2) ─────────────────────────────────────

  window.openFlashcardPicker = async function (vocabId, headword) {
    _pickerVocabId = vocabId;
    document.getElementById('fc-picker-headword').textContent = headword
      ? `Chọn stack để thêm "${headword}"` : '';
    const listEl = document.getElementById('fc-picker-list');
    listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-3">Đang tải stacks…</p>';
    document.getElementById('fc-picker-modal').classList.remove('hidden');

    // Always re-fetch — user may have created a new stack since the last
    // open without leaving this page.
    try {
      const res = await fetch(`${BASE}/api/flashcards/stacks`, { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      const all = Array.isArray(body.stacks) ? body.stacks : [];
      // Auto-stacks aren't curated — only manual stacks are valid targets.
      _pickerStacksCache = all.filter(s => s.type === 'manual');
    } catch (err) {
      console.error('[vocab] picker stacks load failed:', err);
      listEl.innerHTML = '<p class="text-xs text-center py-3" style="color:#fca5a5">Không tải được stacks.</p>';
      return;
    }

    if (!_pickerStacksCache.length) {
      listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-3">Bạn chưa có stack thủ công nào.<br/>Tạo stack mới ở dưới để bắt đầu.</p>';
      return;
    }

    listEl.innerHTML = _pickerStacksCache.map(s => `
      <button class="text-left px-3 py-2 rounded-lg flex items-center justify-between"
              style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); cursor:pointer;"
              onmouseover="this.style.background='rgba(20,184,166,0.08)'"
              onmouseout="this.style.background='rgba(255,255,255,0.04)'"
              onclick="addToFlashcardStack('${esc(s.id)}', '${esc(s.name)}')">
        <span class="text-sm text-white">${esc(s.name)}</span>
        <span class="text-xs text-slate-400">${s.card_count ?? 0} thẻ</span>
      </button>
    `).join('');
  };

  window.closeFlashcardPicker = function () {
    document.getElementById('fc-picker-modal').classList.add('hidden');
    _pickerVocabId = null;
  };

  window.addToFlashcardStack = async function (stackId, stackName) {
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
      console.error('[vocab] add to stack failed:', err);
      flashToast('Lỗi mạng khi thêm vào stack.', 'error');
    }
  };

  function flashToast(message, kind) {
    // Reuse the page's existing toast pattern if any; otherwise build a
    // disposable element so this module stays self-contained.
    let el = document.getElementById('vocab-flash-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vocab-flash-toast';
      el.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'padding:10px 16px;border-radius:10px;font-size:13px;z-index:60;' +
        'opacity:0;transition:opacity 0.2s;pointer-events:none;';
      document.body.appendChild(el);
    }
    const palette = {
      success: 'background:rgba(20,184,166,0.18);border:1px solid rgba(20,184,166,0.4);color:#5eead4;',
      info:    'background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;',
      error:   'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;',
    };
    el.style.cssText += (palette[kind] || palette.info);
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function showState(state) {
    ['loading', 'disabled', 'error', 'empty'].forEach(s => {
      const el = document.getElementById(`state-${s}`);
      if (el) el.classList.toggle('hidden', s !== state);
    });
    if (state !== 'empty') {
      document.getElementById('vocab-list')?.classList.add('hidden');
    }
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Export (Phase 2.5) ────────────────────────────────────────────────────
  // Triggers a browser download of the user's full vocab bank.  We can't go
  // through window.api.get because we need the raw Response (Blob + headers)
  // — the central client unwraps to JSON only.

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

    // Filename comes from Content-Disposition; fall back to a sensible default.
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

  // ── Preview flashcard (Day 2 dogfood) ────────────────────────────────────
  // Pulls the full row via GET /bank/{id} so we render exactly what the
  // study page would show (def_vi, def_en, IPA, AI example, context).
  // Modal is throwaway DOM — no global state to clean up.
  async function previewFlashcard(vocabId) {
    let vocab;
    try {
      vocab = await apiFetch(`/${vocabId}`);
    } catch (err) {
      console.error('[vocab] preview load failed:', err);
      flashToast('Không tải được flashcard.', 'error');
      return;
    }
    if (!vocab) return;
    _renderPreviewModal(vocab);
  }

  function _renderPreviewModal(vocab) {
    const close = () => modal.remove();
    const ipa = vocab.ipa
      ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#93c5fd;padding:2px 8px;border-radius:6px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);display:inline-block;margin-top:6px;">${esc(vocab.ipa)}</div>`
      : '';
    const defVi = vocab.definition_vi
      ? `<p style="font-size:15px;color:#fff;font-weight:500;margin:0 0 8px;">${esc(vocab.definition_vi)}</p>` : '';
    const defEn = vocab.definition_en
      ? `<p style="font-size:13px;color:rgba(255,255,255,0.7);font-style:italic;margin:0 0 12px;">${esc(vocab.definition_en)}</p>` : '';
    const example = vocab.example_sentence
      ? `<div style="font-size:13px;color:rgba(94,234,212,0.95);padding:10px 12px;background:rgba(20,184,166,0.06);border-left:2px solid rgba(20,184,166,0.4);border-radius:6px;margin-bottom:10px;">"${esc(vocab.example_sentence)}"</div>` : '';
    const context = vocab.context_sentence
      ? `<p style="font-size:12px;color:rgba(148,163,184,0.8);font-style:italic;margin:6px 0 0;">Trong câu của bạn: "${esc(vocab.context_sentence)}"</p>` : '';
    const noBack = !defVi && !defEn && !example && !context
      ? `<p style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center;padding:24px 0;">Thẻ này chưa có nội dung mặt sau (đợi enrichment).</p>` : '';

    const modal = document.createElement('div');
    modal.className = 'fc-preview-modal';
    modal.style.cssText =
      'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.7);padding:16px;';
    modal.innerHTML = `
      <div style="position:relative;width:100%;max-width:480px;background:#0c1f36;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:22px;">
        <button id="fc-preview-close" aria-label="Đóng"
                style="position:absolute;top:10px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.6);font-size:20px;line-height:1;cursor:pointer;padding:4px 8px;">×</button>

        <div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;background:linear-gradient(145deg,rgba(255,255,255,0.04) 0%,rgba(15,118,110,0.06) 100%);text-align:center;margin-bottom:14px;">
          <p style="font-size:10px;font-weight:600;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin:0 0 6px;text-transform:uppercase;">Mặt trước</p>
          <h2 style="font-size:24px;font-weight:700;color:#fff;margin:0;line-height:1.2;">${esc(vocab.headword)}</h2>
          ${ipa}
        </div>

        <div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px;background:rgba(255,255,255,0.02);">
          <p style="font-size:10px;font-weight:600;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin:0 0 10px;text-transform:uppercase;">Mặt sau</p>
          ${defVi}
          ${defEn}
          ${example}
          ${context}
          ${noBack}
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#fc-preview-close').addEventListener('click', close);
  }

  // ── Accept suggestion (Day 2 dogfood + PR #24 polish) ───────────────────
  // Flips source_type 'upgrade_suggested' → 'manual' AND adds the row to
  // the default flashcard stack ("Từ vựng đã chấp nhận") in one server
  // call.  Server creates the stack on first use, reuses it after that.
  // Optimistic local update with rollback on server error so the badge
  // flips immediately and feels responsive.
  async function acceptSuggestion(vocabId) {
    const item = _allItems.find(i => i.id === vocabId);
    if (!item) return;
    if (item.source_type !== 'upgrade_suggested') return;  // defensive

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
      // Server signals partial success when the flashcard write failed
      // (RLS, transient DB error).  Promote already persisted, so we
      // tell the user accurately rather than pretending both halves landed.
      if (data && data.flashcard_added && data.stack_name) {
        flashToast(`Đã thêm vào danh sách + flashcard "${data.stack_name}".`, 'success');
      } else {
        flashToast('Đã đưa vào danh sách (chưa thêm được vào flashcard).', 'info');
      }
      await loadStats();
    } catch (err) {
      console.error('[vocab] accept failed:', err);
      item.source_type = prevSource;
      renderList();
      flashToast('Không thể đưa vào danh sách. Thử lại.', 'error');
    }
  }

  window._myVocab = window._myVocab || {};
  window._myVocab.downloadCsv      = function () { return downloadExport('csv');  };
  window._myVocab.downloadJson     = function () { return downloadExport('json'); };
  window._myVocab.previewFlashcard = previewFlashcard;
  window._myVocab.acceptSuggestion = acceptSuggestion;

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
