/**
 * frontend/js/reading-skill.js — Sprint 20.3 L2 Skill Practice library.
 *
 * Browse published L2 skill-practice exercises (GET /api/reading/skill).
 * The L2-specific filter is `skill` (skill_focus); cards emphasise the
 * targeted IELTS reading skill. Deep-links to /pages/reading-skill-exercise.
 * html?slug=... Mirrors reading-vocab.js (Sprint 20.2).
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

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
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Display labels for the D2 skill_tag enum (matches reading-skill.html filter <option>s).
const SKILL_LABEL = {
  skimming: 'Skimming',
  scanning: 'Scanning',
  detail: 'Detail',
  main_idea: 'Main idea',
  inference: 'Inference',
  vocabulary_in_context: 'Vocab in context',
  reference_cohesion: 'Reference / cohesion',
  writer_view_TFNG: "Writer's view (T/F/NG)",
};

async function load() {
  showState('loading');
  const difficulty = ($('filter-difficulty').value || '').trim();
  const skill = ($('filter-skill').value || '').trim();
  const qs = new URLSearchParams();
  if (difficulty) qs.set('difficulty', difficulty);
  if (skill) qs.set('skill', skill);
  qs.set('limit', '50');

  try {
    const res = await window.api.get(`/api/reading/skill?${qs.toString()}`);
    STATE.items = (res && res.items) || [];
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được thư viện. ' + (e && e.message ? e.message : ''));
  }
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((p) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/pages/reading-skill-exercise.html?slug=${encodeURIComponent(p.slug)}`;
    const skillLabel = p.skill_focus ? (SKILL_LABEL[p.skill_focus] || p.skill_focus) : '';
    const pills = [
      // The skill-focus pill is the defining L2 affordance — render it FIRST,
      // brand-coloured, so students can scan the library by skill at a glance.
      skillLabel ? `<span class="rv-pill is-brand">${escapeHtml(skillLabel)}</span>` : '',
      p.difficulty_level ? `<span class="rv-pill">${escapeHtml(p.difficulty_level)}</span>` : '',
      (p.topic_tags || []).slice(0, 1).map((t) => `<span class="rv-pill">${escapeHtml(t)}</span>`).join(''),
      p.estimated_minutes ? `<span class="rv-pill">${p.estimated_minutes}p</span>` : '',
    ].join('');
    a.innerHTML = `
      <h3>${escapeHtml(p.title || 'Bài luyện')}</h3>
      <div class="rv-card__excerpt">${escapeHtml(p.excerpt || '')}</div>
      <div class="rv-meta">${pills}</div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    ['filter-difficulty', 'filter-skill'].forEach((id) => {
      $(id).addEventListener('change', load);
    });
  });
}
