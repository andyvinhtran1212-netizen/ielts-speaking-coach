/**
 * frontend/js/reading-mini-test.js — Reading mini test (1-passage L3 test) library.
 *
 * Browse published L3 tests (GET /api/reading/test). Card → deep-link to
 * /pages/reading-exam.html?test_id=<id>. Mirrors reading-vocab.js /
 * reading-skill.js but the L3-defining facts are different (parts, total
 * questions, time limit, IELTS band target rather than skill_focus).
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = { items: [] };

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('rv-grid'),
};

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'ready';
}
function showError(msg) { VIEWS.error.textContent = msg; showState('error'); }

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const MODULE_LABEL = {
  academic: 'Academic',
  general_training: 'General Training',
};

async function load() {
  showState('loading');
  const module = ($('filter-module').value || '').trim();
  const qs = new URLSearchParams();
  if (module) qs.set('module', module);
  qs.set('limit', '50');
  // Mini Tests library shows ONLY mini tests (the test_type='mini' flag). Explicit
  // so it can't regress if the endpoint default ever changes.
  qs.set('test_type', 'mini');

  try {
    const res = await window.api.get(`/api/reading/test?${qs.toString()}`);
    STATE.items = (res && res.items) || [];
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được danh sách bài thi. ' + (e && e.message ? e.message : ''));
  }
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((t) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/pages/reading-exam.html?test_id=${encodeURIComponent(t.test_id)}`;
    const moduleLabel = MODULE_LABEL[t.module] || t.module || '';
    const parts = t.passage_count || 3;
    const totalQs = t.total_questions || 40;
    const minutes = t.time_limit_minutes || 60;
    const pills = [
      moduleLabel ? `<span class="rv-pill is-brand">${escapeHtml(moduleLabel)}</span>` : '',
      `<span class="rv-pill">${parts} parts</span>`,
      `<span class="rv-pill">${totalQs} câu</span>`,
      `<span class="rv-pill">${minutes}p</span>`,
      t.band_target ? `<span class="rv-pill">Band ${t.band_target}</span>` : '',
    ].join('');
    // The "excerpt" line tells the student what the test is — for L3 we
    // show the test_id (catalog code) since there's no excerpt in the list shape.
    a.innerHTML = `
      <h3>${escapeHtml(t.title || 'Full Test')}</h3>
      <div class="rv-card__excerpt"><code>${escapeHtml(t.test_id || '')}</code></div>
      <div class="rv-meta">${pills}</div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('filter-module').addEventListener('change', load);
  });
}
