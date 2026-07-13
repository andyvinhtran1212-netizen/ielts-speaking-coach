/**
 * frontend/js/admin-vocab-stats.js — Sprint 12.6.
 *
 * Carved from `admin.html` panel-vocab_monitor + panel-flashcards
 * (loadVocabMonitor + the former admin-flashcard-stats.js, since removed as
 * dead code — this module owns the flashcards stats panel now).
 *
 * Wired endpoints (unchanged from monolith):
 *   GET  /admin/vocab/stats                — bank total, FP rate, enabled-count
 *   POST /admin/users/{id}/vocab-flag      — toggle per-user vocab_enabled
 *   GET  /admin/flashcards/stats?days=N    — SRS activity + health + engagement
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

function showBanner(msg, kind) {
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}

function fmt(n, suffix) {
  if (n == null) return '—';
  return String(n) + (suffix || '');
}

async function loadVocabStats() {
  try {
    const data = await api.get('/admin/vocab/stats');
    $('vocab-bank-total').textContent = fmt(data.vocab_bank_total);
    $('vocab-fp-total').textContent = fmt(data.fp_reports_total);
    $('vocab-fp-rate').textContent = fmt(data.fp_rate_percent, '%');
    $('vocab-enabled-count').textContent = fmt(data.users_with_vocab_enabled);
    if (typeof data.fp_rate_percent === 'number' && data.fp_rate_percent >= 10) {
      $('vocab-fp-rate-tile').classList.add('is-warn');
    }
  } catch (e) {
    showBanner('Không tải được vocab stats: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function pct(n) {
  if (n == null) return '—';
  return (Math.round(n * 10) / 10) + '%';
}

function renderActivity(a) {
  const root = $('fcs-activity');
  if (!a) { root.innerHTML = '<div class="vst-tile"><span class="label">No data</span><span class="value">—</span></div>'; return; }
  root.innerHTML = [
    tile('Reviews today',         a.reviews_today),
    tile('Reviews 7d',            a.reviews_7d),
    tile('Active reviewers 7d',   a.active_reviewers_7d),
    tile('Total cards',           a.total_cards),
  ].join('');
}

function renderSrs(sh) {
  const root = $('fcs-srs');
  if (!sh) { root.innerHTML = '<div class="vst-tile"><span class="label">No data</span><span class="value">—</span></div>'; return; }
  const rd = sh.rating_distribution_percent || {};
  root.innerHTML = [
    tile('Due now',               sh.due_now),
    tile('Avg accuracy',          pct(sh.avg_accuracy_percent)),
    tile('Rating · Again',        pct(rd.again)),
    tile('Rating · Hard',         pct(rd.hard)),
    tile('Rating · Good',         pct(rd.good)),
    tile('Rating · Easy',         pct(rd.easy)),
  ].join('');
}

function renderEngagement(en) {
  const root = $('fcs-engagement');
  if (!en) { root.innerHTML = '<div class="vst-tile"><span class="label">No data</span><span class="value">—</span></div>'; return; }
  root.innerHTML = [
    tile('Reviewers in period',   en.unique_reviewers),
    tile('Avg cards / reviewer',  en.avg_cards_per_reviewer),
    tile('Streak ≥7 days',        en.users_with_7d_streak),
  ].join('');
}

function tile(label, value) {
  return [
    '<div class="vst-tile">',
    '<span class="label">', escapeHtml(label), '</span>',
    '<span class="value">', value == null ? '—' : escapeHtml(String(value)), '</span>',
    '</div>',
  ].join('');
}

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadFlashcardStats() {
  const days = parseInt($('fcs-period').value, 10) || 30;
  $('fcs-loading').hidden = false;
  $('fcs-error').hidden = true;
  try {
    const res = await api.get('/admin/flashcards/stats?days=' + days);
    const s = res && res.stats;
    renderActivity(s && s.activity);
    renderSrs(s && s.srs_health);
    renderEngagement(s && s.engagement);
  } catch (e) {
    $('fcs-error').textContent = 'Không tải được flashcard stats: ' + (e && e.message || 'lỗi');
    $('fcs-error').hidden = false;
  } finally {
    $('fcs-loading').hidden = true;
  }
}

async function setFlag(enabled) {
  const userId = ($('flag-user-id').value || '').trim();
  if (!userId) { showBanner('Nhập User ID trước.', 'error'); return; }
  try {
    const data = await api.post('/admin/users/' + encodeURIComponent(userId) + '/vocab-flag', { enabled });
    showBanner(data.message || 'OK', 'success');
    loadVocabStats();
  } catch (e) {
    showBanner('Toggle thất bại: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function wire() {
  $('btn-refresh').addEventListener('click', () => { loadVocabStats(); loadFlashcardStats(); });
  $('fcs-period').addEventListener('change', () => loadFlashcardStats());
  $('btn-flag-enable').addEventListener('click', () => setFlag(true));
  $('btn-flag-disable').addEventListener('click', () => setFlag(false));

  loadVocabStats();
  loadFlashcardStats();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
