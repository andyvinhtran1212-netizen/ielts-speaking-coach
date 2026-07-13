/**
 * frontend/js/admin-ai-usage.js — Sprint 12.8.
 *
 * Carved from admin.html panel-ai_usage (loadAiUsage + renderAiUsage,
 * lines 2249-2540). Cross-skill AI cost tracking.
 *
 * Wired endpoint (unchanged from monolith):
 *   GET /admin/ai-usage[?days=N]
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

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return '$0.0000';
  return '$' + Number(n).toFixed(4);
}

function fmtNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('vi-VN');
}

function setStat(key, val) {
  document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
    el.textContent = val == null ? '—' : val;
  });
}

async function load() {
  const days = $('aiu-days').value;
  $('aiu-loading').hidden = false;
  $('aiu-error').hidden = true;
  try {
    const url = '/admin/ai-usage' + (days ? '?days=' + days : '');
    const data = await api.get(url);
    render(data);
  } catch (e) {
    $('aiu-error').textContent = 'Không tải được AI usage: ' + (e && e.message || 'lỗi');
    $('aiu-error').hidden = false;
  } finally {
    $('aiu-loading').hidden = true;
  }
}

function render(data) {
  const overall = data.overall || {};
  const byService = overall.by_service || {};
  const svc = (s) => byService[s] || {};
  const svcCost = (s) => svc(s).cost_usd || 0;
  const svcCalls = (s) => svc(s).calls || 0;

  const claudeCost  = svcCost('claude');
  const geminiCost  = svcCost('gemini');
  const whisperCost = svcCost('whisper');
  const ttsCost     = svcCost('tts');
  const otherCost   = whisperCost + ttsCost;

  setStat('total_cost',   fmtUsd(overall.cost_usd || 0));
  setStat('total_calls',  fmtNum(overall.calls || 0) + ' lượt gọi');
  setStat('claude_cost',  fmtUsd(claudeCost));
  setStat('claude_calls', fmtNum(svcCalls('claude')) + ' lượt');
  setStat('gemini_cost',  fmtUsd(geminiCost));
  setStat('gemini_calls', fmtNum(svcCalls('gemini')) + ' lượt');
  setStat('other_cost',   fmtUsd(otherCost));
  setStat('other_calls',  fmtNum(svcCalls('whisper')) + ' Whisper · ' + fmtNum(svcCalls('tts')) + ' TTS');

  renderUsers(data.per_user || []);
}

function renderUsers(rows) {
  const tbody = $('users-tbody');
  if (!rows.length) {
    $('users-empty').hidden = false;
    $('users-wrap').hidden = true;
    return;
  }
  $('users-empty').hidden = true;
  $('users-wrap').hidden = false;
  tbody.innerHTML = rows.map((u) => {
    const svc = u.by_service || {};
    const cost = (k) => svc[k] && svc[k].cost_usd != null ? fmtUsd(svc[k].cost_usd) : '—';
    const label = (u.display_name && u.display_name.trim())
      || (u.email && u.email.trim())
      || ((u.user_id || 'unknown').slice(0, 8) + '…');
    const subtitle = (u.display_name && u.display_name.trim() && u.email) ? u.email : '';
    return `
      <tr>
        <td>
          <div>${escapeHtml(label)}</div>
          ${subtitle ? `<div style="font-size: var(--av-fs-xs); color: var(--av-text-muted);">${escapeHtml(subtitle)}</div>` : ''}
        </td>
        <td class="aiu-num">${cost('claude')}</td>
        <td class="aiu-num">${cost('gemini')}</td>
        <td class="aiu-num">${cost('whisper')}</td>
        <td class="aiu-num">${cost('tts')}</td>
        <td class="aiu-num" style="font-weight: var(--av-fw-semibold);">${fmtUsd(u.total_cost_usd || 0)}</td>
      </tr>
    `;
  }).join('');
}

function wire() {
  $('btn-refresh').addEventListener('click', () => load());
  $('aiu-days').addEventListener('change', () => load());
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
