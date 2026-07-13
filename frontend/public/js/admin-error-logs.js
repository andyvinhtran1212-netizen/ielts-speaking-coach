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

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

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
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Human-friendly summary + category (2026-07-02) ────────────────────────
// The stored `message` is often a raw Postgres/PostgREST dict repr
// ({'message': ..., 'code': '23502'}) or a third-party JS error — unreadable for
// a non-engineer admin. Turn each row into a plain-language summary + a category
// so the table is triageable at a glance. Pure display logic; the raw message +
// stack are still shown in the detail panel.
function humanizeError(row) {
  const msg = String(row.message || '');

  // Test / dogfood entries (from the "Tạo lỗi thử" button)
  if (/test exception|manual fire test|manual warning|dogfood|unhandled rejection test|manual report/i.test(msg)) {
    return { category: 'Thử nghiệm', tone: 'muted', noise: true,
             summary: 'Mục thử nghiệm — không phải lỗi thật' };
  }
  // Third-party scripts / opaque cross-origin
  if (/zalojsv2|zalosdk|\bgmo\b|\bfbq\b|gtag|adsbygoogle|google[- ]analytics/i.test(msg)
      || msg.trim() === 'Script error.' || msg.trim() === 'Script error') {
    return { category: 'Bên thứ 3', tone: 'muted', noise: true,
             summary: 'Lỗi từ tiện ích/quảng cáo bên ngoài — không phải lỗi của ứng dụng' };
  }
  // Database (Postgres / PostgREST) — message is a dict repr carrying a code
  const code = (msg.match(/'code':\s*'([^']+)'/) || [])[1];
  if (code || /schema cache|violates .*constraint|does not exist|null value in column/i.test(msg)) {
    // The inner Postgres message is single-quoted but often contains double
    // quotes ("prompt_version"), or double-quoted and contains single quotes
    // ('public.writing_tips') — match by the opening delimiter so we capture the
    // whole thing instead of stopping at the first inner quote.
    const inner = (msg.match(/'message':\s*'([^']*)'/)
                || msg.match(/'message':\s*"([^"]*)"/)
                || [null, msg])[1] || msg;
    const col = (inner.match(/column\s+"?([\w.]+)"?/i) || [])[1];
    const tblM = inner.match(/relation\s+"([\w.]+)"/i) || inner.match(/table '([\w.]+)'/i) || [];
    const table = tblM[1];
    let s;
    if (code === '23502') s = `Thiếu dữ liệu bắt buộc ở cột "${col || '?'}"`;
    else if (code === '23505') s = `Bị trùng giá trị (không cho phép trùng)${col ? ` ở "${col}"` : ''}`;
    else if (code === '42703') s = `Cột "${col || '?'}" không tồn tại (lệch schema)`;
    else if (code === 'PGRST205' || code === '42P01') s = `Bảng "${table || '?'}" không tồn tại (lệch schema)`;
    else if (code === '23503') s = 'Vi phạm khoá ngoại (dữ liệu tham chiếu không tồn tại)';
    else s = (inner || 'Lỗi truy vấn CSDL').slice(0, 100);
    return { category: 'CSDL', tone: 'error', noise: false,
             summary: s + (table ? ` — bảng ${table}` : '') };
  }
  // Network / SSL / transient
  if (/certificate_verify_failed|\bssl\b|server disconnected|timed? ?out|connection|econnrefused/i.test(msg)) {
    return { category: 'Mạng', tone: 'warning', noise: false,
             summary: 'Lỗi kết nối tới dịch vụ bên ngoài (thường tạm thời)' };
  }
  // Frontend JS runtime
  if (row.source === 'frontend') {
    const m = msg.match(/Cannot read properties of (\w+) \(reading '([^']+)'\)/)
           || msg.match(/([\w$]+) is not defined/);
    if (m && m[2]) return { category: 'Giao diện', tone: 'error', noise: false,
                            summary: `Truy cập "${m[2]}" trên giá trị ${m[1]} (thiếu kiểm tra null)` };
    if (m && m[1]) return { category: 'Giao diện', tone: 'error', noise: false,
                            summary: `Biến "${m[1]}" chưa được định nghĩa` };
    return { category: 'Giao diện', tone: 'error', noise: false, summary: truncate(msg, 90) };
  }
  // Backend Python KeyError etc. — a bare quoted key
  if (/^'[\w ]+'$/.test(msg.trim())) {
    return { category: 'Máy chủ', tone: 'error', noise: false,
             summary: `Thiếu khoá/giá trị: ${msg.trim()}` };
  }
  return { category: 'Khác', tone: '', noise: false, summary: truncate(msg, 90) };
}

function categoryChip(h) {
  const cls = h.tone === 'error' ? 'el-chip is-error'
            : h.tone === 'warning' ? 'el-chip is-warning'
            : h.tone === 'muted' ? 'el-chip' : 'el-chip';
  const style = h.tone === 'muted' ? ' style="opacity:.6;"' : '';
  return `<span class="${cls}"${style}>${escapeHtml(h.category)}</span>`;
}

function renderDetail(row) {
  const h = humanizeError(row);
  const stack = escapeHtml(row.stack || '(no stack)');
  const rawMsg = escapeHtml(row.message || '(none)');
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
        <div><strong>Tóm tắt:</strong> ${categoryChip(h)} ${escapeHtml(h.summary)}</div>
        <div><strong>Message gốc:</strong> <code>${rawMsg}</code></div>
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
  const hideNoise = $('filter-hide-noise') && $('filter-hide-noise').checked;
  const rows = hideNoise ? _rows.filter((r) => !humanizeError(r).noise) : _rows;

  if (!rows.length) {
    $('logs-empty').hidden = false;
    $('logs-table-wrap').hidden = true;
    return;
  }
  $('logs-empty').hidden = true;
  $('logs-table-wrap').hidden = false;

  tbody.innerHTML = rows.map((r) => {
    const h = humanizeError(r);
    const cls = [r.dismissed_at ? 'is-dismissed' : '', h.noise ? 'is-noise' : ''].filter(Boolean).join(' ');
    const expanded = _expanded.has(r.id);
    const url = truncate(r.url, 40);
    const userCell = r.user_id ? '<code>' + escapeHtml(r.user_id.slice(0, 8)) + '…</code>' : '<span style="color:var(--av-text-muted);">anon</span>';
    // Message cell: category badge + plain-language summary (raw message is in the detail panel).
    const msgCell = `${categoryChip(h)} <span title="${escapeHtml(truncate(r.message, 200))}">${escapeHtml(h.summary)}</span>`;
    return `
      <tr class="${cls}"${h.noise ? ' style="opacity:.55;"' : ''} data-id="${r.id}" data-row="main">
        <td><code>${fmtTime(r.occurred_at)}</code></td>
        <td>${levelChip(r.level)}</td>
        <td><span class="el-chip">${escapeHtml(r.source)}</span></td>
        <td>${msgCell}</td>
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


// ── ADR-012 cutover dashboard (FE Next.js migration, Pilot Entry) ──────
// Error counts by (implementation, release) so a migrated route's error
// rate is comparable against legacy on the same release; also shows which
// release THIS admin session is being served (drift hint vs telemetry).
async function loadMigrationStats() {
  const body = document.getElementById('migration-stats-body');
  if (!body) return;
  try {
    const rc = (typeof window !== 'undefined' && window.__AVER_RUNTIME_CONFIG__) || {};
    const serving = document.getElementById('migration-serving');
    if (serving && rc.release) {
      serving.textContent = ' · đang phục vụ: ' + String(rc.release).slice(0, 8) +
        (rc.environment ? ' (' + rc.environment + ')' : '');
    }
    const r = await api.get('/admin/error-logs/migration-stats');
    const rows = (r && r.rows) || [];
    if (!rows.length) {
      body.textContent = 'Chưa có lỗi nào trong ' + ((r && r.window_days) || 7) + ' ngày qua.';
      return;
    }
    const cells = rows.map((g) => {
      const levels = Object.keys(g.by_level || {})
        .map((k) => escapeHtml(k) + ' ' + g.by_level[k]).join(' · ');
      return '<tr>' +
        '<td>' + escapeHtml(g.implementation) + '</td>' +
        '<td>' + escapeHtml(g.release) + '</td>' +
        '<td>' + g.total + '</td>' +
        '<td>' + g.undismissed + '</td>' +
        '<td>' + levels + '</td>' +
        '</tr>';
    }).join('');
    body.innerHTML =
      '<table class="el-migration-table"><thead><tr>' +
      '<th>Implementation</th><th>Release</th><th>Tổng</th><th>Chưa xử lý</th><th>Theo level</th>' +
      '</tr></thead><tbody>' + cells + '</tbody></table>' +
      (r.truncated ? '<div class="el-migration-note">⚠ Dữ liệu bị cắt ở ' + r.scanned + ' dòng.</div>' : '');
  } catch (err) {
    console.warn('[error-logs] migration-stats fetch failed:', err);
    body.textContent = 'Không tải được migration-stats.';
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
    await Promise.all([loadLogs(), loadStats(), loadMigrationStats()]);
  } catch (err) {
    showBanner('Không xử lý được: ' + (err.message || err), 'error');
  }
}

async function undismiss(id) {
  try {
    await api.post('/admin/error-logs/' + id + '/undismiss');
    showBanner('Đã reset.', 'success');
    await Promise.all([loadLogs(), loadStats(), loadMigrationStats()]);
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
  // The generated row is a "Test exception" — humanizeError() marks it as noise,
  // so with the default-on "Ẩn nhiễu" filter it would be hidden and this
  // dogfood check would appear to do nothing. The admin explicitly asked for it,
  // so un-hide noise before refreshing to keep the verification path working.
  const hideNoise = $('filter-hide-noise');
  if (hideNoise) hideNoise.checked = false;
  // Give the BackgroundTask a beat to land before refreshing.
  setTimeout(() => { loadLogs(); loadStats(); loadMigrationStats(); }, 800);
  showBanner('Đang tạo lỗi test… một dòng "Thử nghiệm" sẽ xuất hiện trong giây lát.', 'success');
}

function bind() {
  $('btn-refresh').addEventListener('click', () => { loadLogs(); loadStats(); loadMigrationStats(); });
  $('btn-test-error').addEventListener('click', generateTestError);
  ['filter-dismissed', 'filter-level', 'filter-source'].forEach((id) => {
    $(id).addEventListener('change', loadLogs);
  });
  // Hide-noise is a pure client-side re-filter of the already-loaded rows.
  const hideNoise = $('filter-hide-noise');
  if (hideNoise) hideNoise.addEventListener('change', renderTable);
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
  await Promise.all([loadStats(), loadLogs(), loadMigrationStats()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
