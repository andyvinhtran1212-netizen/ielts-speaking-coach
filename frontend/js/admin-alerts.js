/**
 * frontend/js/admin-alerts.js — Sprint 12.8.
 *
 * Carved from admin.html panel-alerts (loadAlerts + renderAlerts).
 * Surfaces session-level errors and response-level grading failures.
 *
 * Wired endpoint (unchanged from monolith):
 *   GET /admin/alerts?limit=30
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);

const ERROR_LABELS = {
  stt_failed:     'STT Failed',
  grading_failed: 'Grading Failed',
  save_failed:    'Save Failed',
  pdf_failed:     'PDF Failed',
};

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return iso; }
}

function errorChip(code) {
  if (!code) return '<span class="alr-chip">—</span>';
  const label = ERROR_LABELS[code] || code;
  return `<span class="alr-chip is-fail">${escapeHtml(label)}</span>`;
}

function setStatus(kind, msg) {
  const el = $('alr-status');
  if (!el) return;
  el.className = 'alr-banner is-' + (kind === 'error' ? 'error' : 'info');
  el.textContent = msg;
  el.hidden = false;
}

async function load() {
  $('alr-loading').hidden = false;
  $('alr-status').hidden = true;
  try {
    const data = await api.get('/admin/alerts?limit=30');
    renderSessionErrors(data.session_errors || []);
    renderGradingFailures(data.grading_failures || []);
    setStatus('info',
      'Đã làm mới Alerts lúc ' +
      new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit', second: '2-digit'}) + '.');
  } catch (e) {
    setStatus('error', 'Không tải được Alerts: ' + (e && e.message || 'lỗi'));
  } finally {
    $('alr-loading').hidden = true;
  }
}

function renderSessionErrors(rows) {
  const tbody = $('alr-sessions-tbody');
  if (!rows.length) {
    $('alr-sessions-empty').hidden = false;
    $('alr-sessions-wrap').hidden = true;
    return;
  }
  $('alr-sessions-empty').hidden = true;
  $('alr-sessions-wrap').hidden = false;
  tbody.innerHTML = rows.map((s) => {
    const shortId = (s.id || '').slice(0, 8) + '…';
    return `
      <tr>
        <td><span class="alr-mono">${escapeHtml(shortId)}</span></td>
        <td>${escapeHtml(s.user_email || s.user_id || '—')}</td>
        <td>${errorChip(s.error_code)}</td>
        <td><span class="alr-mono">${escapeHtml(s.failed_step || '—')}</span></td>
        <td><div class="alr-truncate" title="${escapeHtml(s.error_message || '')}">${escapeHtml(s.error_message || '—')}</div></td>
        <td><span class="alr-mono">${fmtDate(s.last_error_at)}</span></td>
      </tr>
    `;
  }).join('');
}

function renderGradingFailures(rows) {
  const tbody = $('alr-grading-tbody');
  if (!rows.length) {
    $('alr-grading-empty').hidden = false;
    $('alr-grading-wrap').hidden = true;
    return;
  }
  $('alr-grading-empty').hidden = true;
  $('alr-grading-wrap').hidden = false;
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><span class="alr-mono">${escapeHtml((r.id || '').slice(0, 8) + '…')}</span></td>
      <td><span class="alr-mono">${escapeHtml((r.session_id || '').slice(0, 8) + '…')}</span></td>
      <td>${escapeHtml(r.user_email || r.user_id || '—')}</td>
      <td>${errorChip(r.grading_status)}</td>
      <td>${errorChip(r.stt_status)}</td>
    </tr>
  `).join('');
}

function wire() {
  $('btn-refresh').addEventListener('click', () => load());
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
