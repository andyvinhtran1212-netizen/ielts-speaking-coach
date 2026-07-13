/**
 * frontend/js/admin-vocab-exercises.js — Sprint 12.8.
 *
 * Carved from admin.html panel-vocab_exercises (ve_load + ve_render +
 * ve_bulk + ve_setStatus + ve_openGenerateBatchDialog).
 *
 * Admin pool moderation queue for vocabulary_exercises (admin-authored
 * D1 fill-blank questions). Status flow: draft → published / rejected.
 * Distinct from personalized D1 (user_d1_questions) on D1 Curation page.
 *
 * Wired endpoints (unchanged from monolith):
 *   GET    /admin/exercises?status=&exercise_type=D1&limit=200
 *   PATCH  /admin/exercises/{id}/publish
 *   PATCH  /admin/exercises/{id}/reject
 *   PATCH  /admin/exercises/{id}/unpublish
 *   POST   /admin/exercises/bulk           { ids, action }
 *   POST   /admin/exercises/d1/generate-batch { words, count }
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);

const STATUSES = ['draft', 'published', 'rejected'];
let _status = 'draft';
let _items = [];
let _selected = new Set();

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

async function loadList() {
  $('vex-loading').hidden = false;
  $('vex-empty').hidden = true;
  $('vex-error').hidden = true;
  $('vex-list').innerHTML = '';
  try {
    const url = `/admin/exercises?status=${encodeURIComponent(_status)}&exercise_type=D1&limit=200`;
    const rows = await api.get(url);
    _items = Array.isArray(rows) ? rows : [];
    _selected.clear();
    render();
    refreshCounts();
  } catch (e) {
    $('vex-error').hidden = false;
    $('vex-error').textContent = 'Không tải được exercises: ' + (e && e.message || 'lỗi');
  } finally {
    $('vex-loading').hidden = true;
  }
}

async function refreshCounts() {
  // Parallel-fetch counts per status, cheap (small list endpoints).
  await Promise.all(STATUSES.map(async (s) => {
    try {
      const rows = await api.get(`/admin/exercises?status=${s}&exercise_type=D1&limit=200`);
      const n = Array.isArray(rows) ? rows.length : 0;
      const el = $('vex-count-' + s);
      if (el) el.textContent = n;
    } catch { /* ignore — count is best-effort */ }
  }));
}

function render() {
  $('vex-count').textContent = _items.length;
  $('vex-selected-count').textContent = _selected.size;

  if (!_items.length) {
    $('vex-empty').hidden = false;
    $('vex-list').innerHTML = '';
    return;
  }
  $('vex-empty').hidden = true;
  $('vex-list').innerHTML = _items.map((it) => {
    const p = it.content_payload || {};
    const sentence = p.sentence || '(missing sentence)';
    const answer   = p.answer || p.word || '?';
    const distractors = Array.isArray(p.distractors) ? p.distractors.join(', ') : '';
    const checked = _selected.has(it.id) ? 'checked' : '';

    let actions = '';
    if (it.status === 'published') {
      actions = `<button class="btn-warn" data-action="unpublish" data-id="${escapeHtml(it.id)}" type="button">Unpublish</button>`;
    } else if (it.status === 'rejected') {
      actions = `<button class="btn-pub" data-action="publish" data-id="${escapeHtml(it.id)}" type="button">Publish</button>`;
    } else {
      actions = `
        <button class="btn-pub" data-action="publish" data-id="${escapeHtml(it.id)}" type="button">Publish</button>
        <button class="btn-rej" data-action="reject"  data-id="${escapeHtml(it.id)}" type="button">Reject</button>
      `;
    }

    return `
      <div class="vex-row">
        <input type="checkbox" data-id="${escapeHtml(it.id)}" ${checked} />
        <div class="body">
          <div class="sentence">${escapeHtml(sentence)}</div>
          <div class="meta">
            Answer: <span class="answer">${escapeHtml(answer)}</span>
            ${distractors ? ' · Distractors: ' + escapeHtml(distractors) : ''}
          </div>
          <div class="meta">
            id: <code style="font-family: var(--av-font-mono);">${escapeHtml(it.id)}</code> ·
            type: ${escapeHtml(it.exercise_type || '—')} ·
            status: ${escapeHtml(it.status || '—')}
          </div>
        </div>
        <div class="actions">${actions}</div>
      </div>
    `;
  }).join('');

  $('vex-list').querySelectorAll('input[type="checkbox"][data-id]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-id');
      if (cb.checked) _selected.add(id); else _selected.delete(id);
      $('vex-selected-count').textContent = _selected.size;
    });
  });
  $('vex-list').querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      setStatus(id, action);
    });
  });
}

async function setStatus(id, action) {
  try {
    await api.patch('/admin/exercises/' + encodeURIComponent(id) + '/' + action, {});
    _items = _items.filter((it) => it.id !== id);
    _selected.delete(id);
    render();
    refreshCounts();
  } catch (e) {
    showBanner('Status update thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

async function bulkAction(action) {
  const ids = Array.from(_selected);
  if (!ids.length) {
    showBanner('Chọn ít nhất một exercise.', 'error');
    return;
  }
  const verb = action === 'publish' ? 'PUBLISH' : 'REJECT';
  if (!confirm(`${verb} ${ids.length} exercise${ids.length === 1 ? '' : 's'}?`)) return;
  try {
    await api.post('/admin/exercises/bulk', { ids, action });
    _items = _items.filter((it) => !_selected.has(it.id));
    _selected.clear();
    render();
    refreshCounts();
    showBanner(`Đã ${verb.toLowerCase()} ${ids.length} exercises.`, 'success');
  } catch (e) {
    showBanner('Bulk action thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function toggleSelectAll() {
  const anyUnselected = _items.some((it) => !_selected.has(it.id));
  if (anyUnselected) {
    _items.forEach((it) => _selected.add(it.id));
  } else {
    _selected.clear();
  }
  render();
}

function switchStatus(next) {
  if (!STATUSES.includes(next) || next === _status) return;
  _status = next;
  STATUSES.forEach((s) => {
    const tab = $('vex-tab-' + s);
    if (tab) tab.classList.toggle('is-active', s === _status);
  });
  loadList();
}

// ── Generate batch modal ───────────────────────────────────────

function openBatchModal() {
  $('vex-batch-words').value = '';
  $('vex-batch-count').value = '10';
  $('vex-batch-status').hidden = true;
  $('vex-batch-backdrop').hidden = false;
  setTimeout(() => $('vex-batch-words').focus(), 50);
}

function closeBatchModal() {
  $('vex-batch-backdrop').hidden = true;
}

async function submitBatch() {
  const wordsRaw = ($('vex-batch-words').value || '').trim();
  const count = parseInt($('vex-batch-count').value, 10) || 10;
  const words = wordsRaw.split(',').map((w) => w.trim()).filter(Boolean);

  const status = $('vex-batch-status');
  if (!words.length) {
    status.className = 'vex-banner is-error';
    status.textContent = 'Cần ít nhất 1 target word.';
    status.hidden = false;
    return;
  }

  try {
    const res = await api.post('/admin/exercises/d1/generate-batch', { words, count });
    status.className = 'vex-banner is-success';
    status.textContent = res && res.message
      ? res.message
      : `Đã queue ${words.length} target words. Drafts sẽ hiển thị sau khi Gemini hoàn tất.`;
    status.hidden = false;
    setTimeout(() => {
      closeBatchModal();
      loadList();
    }, 1500);
  } catch (e) {
    status.className = 'vex-banner is-error';
    status.textContent = 'Generate thất bại: ' + (e && e.message || 'lỗi');
    status.hidden = false;
  }
}

// ── Wire ───────────────────────────────────────────────────────

function wire() {
  $('btn-refresh').addEventListener('click', () => { loadList(); });
  STATUSES.forEach((s) => {
    const tab = $('vex-tab-' + s);
    if (tab) tab.addEventListener('click', () => switchStatus(s));
  });
  $('btn-select-all').addEventListener('click', toggleSelectAll);
  $('btn-bulk-publish').addEventListener('click', () => bulkAction('publish'));
  $('btn-bulk-reject').addEventListener('click', () => bulkAction('reject'));

  $('btn-open-generate').addEventListener('click', openBatchModal);
  $('btn-batch-cancel').addEventListener('click', closeBatchModal);
  $('btn-batch-submit').addEventListener('click', submitBatch);
  $('vex-batch-backdrop').addEventListener('click', (ev) => {
    if (ev.target.id === 'vex-batch-backdrop') closeBatchModal();
  });

  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
