/**
 * frontend/js/admin-error-logs.js — Sprint 12.3.
 *
 * Controller for /pages/admin/error-logs/index.html. Wires:
 *
 *   GET  /admin/error-logs/stats         (4 stat cards)
 *   GET  /admin/error-logs?...           (table + filters)
 *   POST /admin/error-logs/{id}/dismiss
 *   POST /admin/error-logs/{id}/undismiss
 *   POST /admin/error-logs/test          (admin dogfood helper)
 *
 * Row click expands an inline detail panel with stack trace + extra
 * JSON + request_id + dismiss/undismiss actions. Detail panels render
 * lazily — only opened rows live in the DOM, so a 1000-row corpus
 * doesn't bloat the table.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $   = (id) => document.getElementById(id);

let _rows = [];
const _expanded = new Set();

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return iso; }
}

function levelChip(level) {
  const cls = level === 'error' ? 'el-chip is-error'
            : level === 'warning' ? 'el-chip is-warning'
            : 'el-chip is-info';
  return `<span class="${cls}">${level}</span>`;
}

function dismissedChip(row) {
  if (row.dismissed_at) return '<span class="el-chip">Đã xử lý</span>';
  return '<span class="el-chip is-warning">Chưa xử lý</span>';
}

function truncate(s, n) {
  if (!s) return '—';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// Pre-escape any DB-sourced text so a malicious row can't inject HTML
// into the admin table (defense in depth — admin UI is privileged but
// the data comes from any user via /api/error-logs).
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDetail(row) {
  const stack = escapeHtml(row.stack || '(no stack)');
  const extra = row.extra ? escapeHtml(JSON.stringify(row.extra, null, 2)) : '(none)';
  const reqId = escapeHtml(row.request_id || '(none)');
  const ua = escapeHtml(row.user_agent || '(none)');
  const userId = row.user_id ? escapeHtml(row.user_id) : '(anonymous)';
  const dismissBtn = row.dismissed_at
    ? `<button class="btn-ghost" data-action="undismiss" data-id="${row.id}">Reset (undo)</button>`
    : `<button class="btn-primary" data-action="dismiss" data-id="${row.id}">Đánh dấu xử lý</button>`;
  return `
    <td colspan="8">
      <div class="el-detail">
        <div><strong>Request ID:</strong> <code>${reqId}</code></div>
        <div><strong>User:</strong> <code>${userId}</code></div>
        <div><strong>User-Agent:</strong> <code>${ua}</code></div>
        <div><strong>Stack:</strong><pre>${stack}</pre></div>
        <div><strong>Extra:</strong><pre>${extra}</pre></div>
        <div style="display:flex; gap: var(--av-space-2);">${dismissBtn}</div>
      </div>
    </td>
  `;
}

function renderTable() {
  $('logs-loading').hidden = true;
  if (!_rows.length) {
    $('logs-empty').hidden = false;
    $('logs-table-wrap').hidden = true;
    return;
  }
  $('logs-empty').hidden = true;
  $('logs-table-wrap').hidden = false;

  const tbody = $('logs-tbody');
  tbody.innerHTML = _rows.map((r) => {
    const cls = r.dismissed_at ? 'is-dismissed' : '';
    const expanded = _expanded.has(r.id);
    const url = truncate(r.url, 40);
    const userCell = r.user_id ? '<code>' + escapeHtml(r.user_id.slice(0, 8)) + '…</code>' : '<span style="color:var(--av-text-muted);">anon</span>';
    return `
      <tr class="${cls}" data-id="${r.id}" data-row="main">
        <td><code>${fmtTime(r.occurred_at)}</code></td>
        <td>${levelChip(r.level)}</td>
        <td><span class="el-chip">${escapeHtml(r.source)}</span></td>
        <td>${escapeHtml(truncate(r.message, 80))}</td>
        <td>${escapeHtml(url)}</td>
        <td>${userCell}</td>
        <td>${dismissedChip(r)}</td>
        <td><button class="btn-ghost" data-action="toggle" data-id="${r.id}">${expanded ? 'Ẩn' : 'Xem'}</button></td>
      </tr>
      ${expanded ? `<tr data-id="${r.id}" data-row="detail">${renderDetail(r)}</tr>` : ''}
    `;
  }).join('');
}

async function loadStats() {
  try {
    const r = await api.get('/admin/error-logs/stats');
    document.querySelectorAll('[data-stat]').forEach((el) => {
      el.textContent = r[el.dataset.stat] != null ? r[el.dataset.stat] : '—';
    });
    // Soft visual signal: hide the warning border if no undismissed errors.
    const undismissedCard = $('stat-undismissed');
    if (r.undismissed === 0) {
      undismissedCard.classList.remove('is-warning');
    } else {
      undismissedCard.classList.add('is-warning');
    }
  } catch (err) {
    console.warn('[error-logs] stats fetch failed:', err);
  }
}

function buildQuery() {
  const params = new URLSearchParams();
  const dismissed = $('filter-dismissed').value;
  if (dismissed !== '') params.set('dismissed', dismissed);
  const level = $('filter-level').value;
  if (level) params.set('level', level);
  const source = $('filter-source').value;
  if (source) params.set('source', source);
  params.set('limit', '100');
  return params.toString();
}

async function loadLogs() {
  try {
    const r = await api.get('/admin/error-logs?' + buildQuery());
    _rows = (r && r.items) || [];
  } catch (err) {
    _rows = [];
    showBanner('Không tải được báo lỗi: ' + (err.message || err), 'error');
  }
  renderTable();
}

async function dismiss(id) {
  try {
    await api.post('/admin/error-logs/' + id + '/dismiss');
    showBanner('Đã đánh dấu xử lý.', 'success');
    await Promise.all([loadLogs(), loadStats()]);
  } catch (err) {
    showBanner('Không xử lý được: ' + (err.message || err), 'error');
  }
}

async function undismiss(id) {
  try {
    await api.post('/admin/error-logs/' + id + '/undismiss');
    showBanner('Đã reset.', 'success');
    await Promise.all([loadLogs(), loadStats()]);
  } catch (err) {
    showBanner('Không reset được: ' + (err.message || err), 'error');
  }
}

async function generateTestError() {
  // The default 'exception' path raises in the backend, which returns 500.
  // The user-visible signal is that a new row appears in the table within
  // ~1s. We swallow the 500 here so the banner doesn't show an error.
  try {
    await api.post('/admin/error-logs/test?error_type=exception');
  } catch {
    // Expected — the test endpoint raises by design.
  }
  // Give the BackgroundTask a beat to land before refreshing.
  setTimeout(() => { loadLogs(); loadStats(); }, 800);
  showBanner('Đang tạo lỗi test… kiểm tra danh sách trong giây lát.', 'success');
}

function bind() {
  $('btn-refresh').addEventListener('click', () => { loadLogs(); loadStats(); });
  $('btn-test-error').addEventListener('click', generateTestError);
  ['filter-dismissed', 'filter-level', 'filter-source'].forEach((id) => {
    $(id).addEventListener('change', loadLogs);
  });
  $('logs-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'toggle') {
      if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
      renderTable();
    } else if (action === 'dismiss') {
      dismiss(id);
    } else if (action === 'undismiss') {
      undismiss(id);
    }
  });
}

async function main() {
  bind();
  await Promise.all([loadStats(), loadLogs()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
