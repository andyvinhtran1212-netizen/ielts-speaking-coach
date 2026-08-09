

// Module nay co the duoc NAP MUON: tren ban Next, `LegacyModule` chen the
// <script> trong useEffect, tuc SAU khi React hydrate — ma luc do
// `DOMContentLoaded` DA BAN. Mot listener dang ky sau do khong bao gio chay,
// nen trang KHONG BAO GIO boot. Do la loi cong G1 bat duoc o
// /listening/skills va /reading/vocab (PR #1004).
//
// Tren ban legacy the <script> van nam san trong HTML nen `readyState` con la
// 'loading' — nhanh cu chay y nguyen, khong doi hanh vi.
function __averOnReady(fn) {
  if (typeof document === 'undefined') return;
  // `readyState` LUON la chuoi trong trinh duyet that. Vang no nghia la ta dang
  // o mot `document` GIA (bo test dung stub toi gian) — khi do giu nguyen hanh
  // vi cu: chi dang ky listener, dung tu chay. Chay ngay o do se keo ca than
  // boot vao moi truong khong co DOM that; da lam 5 test chet o lan dau.
  if (typeof document.readyState !== 'string' || document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
    return;
  }
  fn();
}
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
  result:  $('rv-result-count'),
  total:   $('rv-total-count'),
  focus:   $('rv-focus-count'),
  reset:   $('clear-filters'),
};

function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.grid.hidden    = name !== 'ready';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  if (VIEWS.result) VIEWS.result.textContent = 'Không thể tải danh sách';
  showState('error');
}

function revealActiveLibraryTab() {
  const nav = document.querySelector?.('.rv-libnav');
  const active = nav?.querySelector('.rv-libnav__link.is-active');
  if (!nav || !active) return;
  nav.scrollLeft = Math.max(0, active.offsetLeft - ((nav.clientWidth - active.clientWidth) / 2));
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

const DIFFICULTY_LABEL = {
  foundation: 'Foundation',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

function displaySkillTitle(p) {
  const raw = String(p.title || 'Bài luyện').trim();
  const parts = raw.split(/\s+[—·]\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : raw;
}

async function load() {
  showState('loading');
  const difficulty = ($('filter-difficulty').value || '').trim();
  const skill = ($('filter-skill').value || '').trim();
  VIEWS.result.textContent = 'Đang cập nhật danh sách…';
  VIEWS.reset.hidden = !(difficulty || skill);
  const qs = new URLSearchParams();
  if (difficulty) qs.set('difficulty', difficulty);
  if (skill) qs.set('skill', skill);
  qs.set('limit', '50');

  try {
    const res = await window.api.get(`/api/reading/skill?${qs.toString()}`);
    STATE.items = (res && res.items) || [];
    renderSummary();
    if (!STATE.items.length) { showState('empty'); return; }
    render();
    showState('ready');
  } catch (e) {
    showError('Không tải được thư viện. ' + (e && e.message ? e.message : ''));
  }
}

function renderSummary() {
  const count = STATE.items.length;
  const focusCount = new Set(STATE.items.map((p) => p.skill_focus).filter(Boolean)).size;
  VIEWS.total.textContent = String(count);
  VIEWS.focus.textContent = String(focusCount);
  VIEWS.result.textContent = `${count} bài luyện · ${focusCount} nhóm kỹ năng`;
}

function render() {
  const grid = VIEWS.grid;
  grid.innerHTML = '';
  STATE.items.forEach((p) => {
    const a = document.createElement('a');
    a.className = 'rv-card';
    a.href = `/pages/reading-skill-exercise.html?slug=${encodeURIComponent(p.slug)}`;
    const title = displaySkillTitle(p);
    a.setAttribute('aria-label', `Luyện bài ${title}`);
    const skillLabel = p.skill_focus ? (SKILL_LABEL[p.skill_focus] || p.skill_focus) : '';
    const difficulty = DIFFICULTY_LABEL[p.difficulty_level] || p.difficulty_level || '';
    const pills = [
      // The skill-focus pill is the defining L2 affordance — render it FIRST,
      // brand-coloured, so students can scan the library by skill at a glance.
      skillLabel ? `<span class="rv-pill is-brand">${escapeHtml(skillLabel)}</span>` : '',
      difficulty ? `<span class="rv-pill">${escapeHtml(difficulty)}</span>` : '',
      (p.topic_tags || []).slice(0, 1).map((t) => `<span class="rv-pill">${escapeHtml(t)}</span>`).join(''),
    ].join('');
    a.innerHTML = `
      <div class="rv-card__top">
        <span class="rv-card__type">SKILL PRACTICE</span>
        ${p.estimated_minutes ? `<span class="rv-card__time">${escapeHtml(p.estimated_minutes)} PHÚT</span>` : ''}
      </div>
      <h3 title="${escapeHtml(p.title || '')}">${escapeHtml(title)}</h3>
      <p class="rv-card__excerpt">${escapeHtml(p.excerpt || '')}</p>
      <div class="rv-meta">${pills}</div>
      <div class="rv-card__footer">
        <span class="rv-card__code">ĐỌC + CÂU HỎI</span>
        <span class="rv-card__cta">Luyện ngay <span aria-hidden="true">→</span></span>
      </div>`;
    grid.appendChild(a);
  });
}

if (typeof document !== 'undefined') {
  __averOnReady(() => {
    revealActiveLibraryTab();
    load();
    ['filter-difficulty', 'filter-skill'].forEach((id) => {
      $(id).addEventListener('change', load);
    });
    VIEWS.reset.addEventListener('click', () => {
      $('filter-difficulty').value = '';
      $('filter-skill').value = '';
      load();
    });
  });
}
