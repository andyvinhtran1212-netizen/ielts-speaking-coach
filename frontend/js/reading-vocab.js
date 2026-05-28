/**
 * frontend/js/reading-vocab.js — Sprint 20.2 L1 Vocab Reading library.
 *
 * Browse published L1 passages (GET /api/reading/vocab), render cards,
 * filter by difficulty / topic tag, deep-link to the passage page
 * (/pages/reading-vocab-passage.html?slug=...). Mirrors listening-browse.js.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = { items: [], tagsSeeded: false };

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

async function load() {
  showState('loading');
  const difficulty = ($('filter-difficulty').value || '').trim();
  const tag = ($('filter-tag').value || '').trim();
  const qs = new URLSearchParams();
  if (difficulty) qs.set('difficulty', difficulty);
  if (tag) qs.set('tag', tag);
  qs.set('limit', '50');

  try {
    const res = await window.api.get(`/api/reading/vocab?${qs.toString()}`);
    STATE.items = (res && res.items) || [];
    seedTagFilter();
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được thư viện. ' + (e && e.message ? e.message : ''));
  }
}

// Populate the topic-tag dropdown once, from whatever the first load returns.
function seedTagFilter() {
  if (STATE.tagsSeeded) return;
  const tags = new Set();
  STATE.items.forEach((p) => (p.topic_tags || []).forEach((t) => tags.add(t)));
  if (!tags.size) return;
  const sel = $('filter-tag');
  [...tags].sort().forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
  STATE.tagsSeeded = true;
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((p) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/pages/reading-vocab-passage.html?slug=${encodeURIComponent(p.slug)}`;
    const pills = [
      p.difficulty_level ? `<span class="rv-pill is-brand">${escapeHtml(p.difficulty_level)}</span>` : '',
      (p.topic_tags || []).slice(0, 2).map((t) => `<span class="rv-pill">${escapeHtml(t)}</span>`).join(''),
      p.estimated_minutes ? `<span class="rv-pill">${p.estimated_minutes}p</span>` : '',
      p.word_count ? `<span class="rv-pill">${p.word_count} từ</span>` : '',
    ].join('');
    a.innerHTML = `
      <h3>${escapeHtml(p.title || 'Bài đọc')}</h3>
      <div class="rv-card__excerpt">${escapeHtml(p.excerpt || '')}</div>
      <div class="rv-meta">${pills}</div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    ['filter-difficulty', 'filter-tag'].forEach((id) => {
      $(id).addEventListener('change', load);
    });
  });
}
