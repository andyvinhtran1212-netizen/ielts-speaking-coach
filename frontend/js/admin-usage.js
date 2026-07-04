/**
 * frontend/js/admin-usage.js — Sprint 17.2 (Direction B)
 *
 * Page controller for /pages/admin/usage/index.html (replaces the Phase-B
 * placeholder). Two views off one page:
 *   - default            → per-user activity list  (GET /admin/usage/users)
 *   - ?code_id=<id>       → per-code rollup         (GET /admin/access-codes/{id}/usage)
 * The codes UI (Sprint 17.1) drills in via ?code_id. Search/sort are client-side
 * (consistent with Sprint 17.1). Class-based styling only (Pattern #26).
 */

import { usdLabel, countLabel, lastActiveLabel, userMatchesSearch, compareUsersBy }
  from './admin-usage-util.js';

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);
// C4: delegate to the shared escaper (window.WC.escapeHtml, api.js).
const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let _users = [];
let _search = '';
let _sort = { field: 'sessions', order: 'desc' };

function userRow(u) {
  const who = u.email ? esc(u.email) : '(không rõ)';
  const name = u.name ? `<div class="u-name">${esc(u.name)}</div>` : '';
  return `<tr>
    <td>${name}<div class="u-email">${who}</div></td>
    <td class="u-num">${countLabel(u.sessions)}</td>
    <td>${esc(lastActiveLabel(u.last_active))}</td>
    <td class="u-num">${esc(usdLabel(u.ai_cost_usd))}</td>
  </tr>`;
}

function renderUsers() {
  const rows = _users
    .filter((u) => userMatchesSearch(u, _search))
    .sort(compareUsersBy(_sort.field, _sort.order));
  $('usage-loading').hidden = true;
  if (!rows.length) {
    $('usage-empty').hidden = false;
    $('usage-table-wrap').hidden = true;
    return;
  }
  $('usage-empty').hidden = true;
  $('usage-table-wrap').hidden = false;
  $('usage-tbody').innerHTML = rows.map(userRow).join('');
}

async function loadUsers() {
  try {
    const r = await api.get('/admin/usage/users');
    _users = Array.isArray(r) ? r : [];
  } catch (err) {
    _users = [];
    console.warn('[usage] users fetch failed:', err && err.message);
  }
  renderUsers();
}

async function loadCodeUsage(codeId) {
  let data;
  try {
    data = await api.get('/admin/access-codes/' + encodeURIComponent(codeId) + '/usage');
  } catch (err) {
    $('code-usage-loading').textContent = 'Không tải được hoạt động của mã: ' + (err.message || err);
    return;
  }
  const agg = data.aggregate || {};
  $('code-usage-title').textContent = 'Hoạt động mã: ' + (data.code ? data.code.code : codeId);
  $('code-usage-summary').innerHTML =
    `<div class="adm-card"><span class="adm-card-num">${countLabel(agg.assigned_user_count)}</span><span class="adm-card-label">Người dùng</span></div>`
    + `<div class="adm-card"><span class="adm-card-num">${countLabel(agg.total_sessions)}</span><span class="adm-card-label">Tổng phiên</span></div>`
    + `<div class="adm-card"><span class="adm-card-num">${esc(usdLabel(agg.total_ai_cost_usd))}</span><span class="adm-card-label">Tổng chi phí AI</span></div>`;
  $('code-usage-loading').hidden = true;
  const users = data.assigned_users || [];
  if (!users.length) {
    $('code-usage-empty').hidden = false;
    $('code-usage-table-wrap').hidden = true;
    return;
  }
  $('code-usage-table-wrap').hidden = false;
  $('code-usage-tbody').innerHTML = users.map(userRow).join('');
}

function bindUserView() {
  const s = $('usage-search');
  if (s) s.addEventListener('input', () => { _search = s.value; renderUsers(); });
  document.querySelectorAll('#view-users th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      _sort = { field, order: (_sort.field === field && _sort.order === 'desc') ? 'asc' : 'desc' };
      renderUsers();
    });
  });
}

function main() {
  const codeId = new URLSearchParams(window.location.search).get('code_id');
  if (codeId) {
    $('view-users').hidden = true;
    $('view-code').hidden = false;
    loadCodeUsage(codeId);
  } else {
    $('view-code').hidden = true;
    $('view-users').hidden = false;
    bindUserView();
    loadUsers();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
