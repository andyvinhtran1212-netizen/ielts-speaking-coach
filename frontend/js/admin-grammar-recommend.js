/**
 * frontend/js/admin-grammar-recommend.js — Sprint 12.7.
 *
 * Dogfood tester for the grammar recommendation matcher
 * (services.grammar_content.find_best_match). Same function powers the
 * post-grading recommendation surface — this page lets Andy preview
 * quality before users see it.
 *
 * Wired endpoint (new in Sprint 12.7):
 *   POST /admin/grammar/recommend-test  { issue }
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

function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function runMatch() {
  const issue = ($('grt-issue').value || '').trim();
  $('grt-error').hidden = true;
  $('grt-result').hidden = true;
  $('grt-no-match').hidden = true;

  if (!issue) {
    $('grt-error').textContent = 'Nhập issue text trước khi tìm match.';
    $('grt-error').hidden = false;
    return;
  }

  try {
    const data = await api.post('/admin/grammar/recommend-test', { issue });
    if (!data.match) {
      $('grt-no-match').hidden = false;
      return;
    }
    const m = data.match;
    $('grt-title').textContent    = m.title || m.slug || '—';
    $('grt-slug').textContent     = m.slug || '—';
    $('grt-category').textContent = m.category || '—';
    $('grt-score').textContent    = m.score != null ? (Math.round(m.score * 100) / 100) : '—';
    $('grt-summary').textContent  = m.summary || '';
    $('grt-link').href            = m.url || '#';
    $('grt-result').hidden = false;
  } catch (e) {
    $('grt-error').textContent = 'Không gọi được matcher: ' + (e && e.message || 'lỗi');
    $('grt-error').hidden = false;
  }
}

function wire() {
  $('btn-match').addEventListener('click', runMatch);
  $('btn-clear').addEventListener('click', () => {
    $('grt-issue').value = '';
    $('grt-result').hidden = true;
    $('grt-no-match').hidden = true;
    $('grt-error').hidden = true;
    $('grt-issue').focus();
  });
  document.querySelectorAll('.grt-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('grt-issue').value = btn.getAttribute('data-preset') || '';
      runMatch();
    });
  });
  $('grt-issue').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) runMatch();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
