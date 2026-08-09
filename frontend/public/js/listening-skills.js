

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
 * frontend/js/listening-skills.js — Listening Skills Practice
 *
 * Groups published skill-drills (GET /api/listening/tests?test_type=drill) by
 * question type into 11 sections, each listing its drills by level (L1→L4) and
 * task. Every drill reuses the SAME player (listening-test.html?id=<uuid>) and
 * review as a mini test — a drill is just a 1-section test isolating one type.
 *
 * The list endpoint only returns audio-ready (published) drills, so a type/level
 * with no audio yet simply doesn't appear; the "Sắp có" hints are seeded from the
 * full 11-type catalogue so students see what's coming.
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

// The 11 IELTS listening question types, in a sensible learning order. `key`
// matches metadata.drill_type emitted by the importer. icon = lucide glyph.
const SKILLS = [
  { key: 'form',         icon: 'clipboard-list', label: 'Điền vào form',        lede: 'Nghe và điền thông tin vào biểu mẫu (tên, ngày, số…).' },
  { key: 'note',         icon: 'notebook-pen',   label: 'Điền ghi chú',         lede: 'Hoàn thành ghi chú theo bài nói.' },
  { key: 'table',        icon: 'table',          label: 'Điền bảng',            lede: 'Điền các ô còn trống trong bảng.' },
  { key: 'flowchart',    icon: 'git-branch',     label: 'Sơ đồ quy trình',      lede: 'Hoàn thành sơ đồ các bước theo thứ tự.' },
  { key: 'sentence',     icon: 'text-cursor-input', label: 'Hoàn thành câu',    lede: 'Điền từ còn thiếu vào câu.' },
  { key: 'summary',      icon: 'file-text',      label: 'Hoàn thành đoạn tóm tắt', lede: 'Điền từ vào đoạn văn tóm tắt.' },
  { key: 'short_answer', icon: 'pencil',         label: 'Trả lời ngắn',         lede: 'Trả lời câu hỏi bằng 1–3 từ.' },
  { key: 'mcq',          icon: 'list-checks',    label: 'Trắc nghiệm (1 đáp án)', lede: 'Chọn A, B hoặc C.' },
  { key: 'mcq_multi',    icon: 'check-check',    label: 'Trắc nghiệm (chọn nhiều)', lede: 'Chọn 2–3 đáp án đúng.' },
  { key: 'matching',     icon: 'arrow-left-right', label: 'Nối thông tin',      lede: 'Nối mỗi câu với đáp án từ danh sách.' },
  { key: 'map',          icon: 'map',            label: 'Bản đồ / sơ đồ',       lede: 'Gắn nhãn vị trí trên bản đồ hoặc sơ đồ.' },
];

const $ = (id) => document.getElementById(id);

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  grid:    $('ls-groups'),
  library: $('ls-library'),
  nav:     $('ls-skill-nav'),
  summary: $('ls-summary'),
};

let DRILLS_BY_TYPE = new Map();
let ACTIVE_SKILL = '';
let ACTIVE_STATUS = 'all';

function showState(name) {
  if (VIEWS.loading) VIEWS.loading.hidden = name !== 'loading';
  if (VIEWS.empty)   VIEWS.empty.hidden   = name !== 'empty';
  if (VIEWS.error)   VIEWS.error.hidden   = name !== 'error';
  if (VIEWS.library) VIEWS.library.hidden = name !== 'grid';
}
function showError(msg) {
  if (VIEWS.error) VIEWS.error.textContent = msg;
  showState('error');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sort a type's drills by level (L1→L4) then task (T1→T4) for a stable ladder.
function _levelNum(s) { const m = /L(\d+)/i.exec(s || ''); return m ? Number(m[1]) : 99; }
function _taskNum(s)  { const m = /T(\d+)/i.exec(s || ''); return m ? Number(m[1]) : 99; }

function drillSort(a, b) {
  const la = _levelNum(a.level), lb = _levelNum(b.level);
  if (la !== lb) return la - lb;
  const ta = _taskNum(a.task), tb = _taskNum(b.task);
  if (ta !== tb) return ta - tb;
  return String(a.test_id || '').localeCompare(String(b.test_id || ''));
}

function displayDrillTitle(t) {
  const raw = String(t.title || t.test_id || 'Skill drill').trim();
  const parts = raw.split(/\s+[—·]\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : raw;
}

function renderDrill(t) {
  const attempted = (t.user_attempt_count || 0) > 0;
  const best = t.user_best_score;
  const badge = t.level ? `<span class="ls-drill-level">${esc(t.level)}${t.task ? '·' + esc(t.task) : ''}</span>` : '';
  const stat = (best != null)
    ? `<span>Điểm tốt nhất <strong>${esc(best)} điểm</strong></span>`
    : (attempted ? '<span>Đã có lượt làm</span>' : '<span>Chưa làm</span>');
  const cta = attempted ? 'Làm lại' : 'Bắt đầu';
  return `
    <article class="ls-drill" data-status="${attempted ? 'done' : 'new'}">
      <div class="ls-drill-head">
        ${badge}
        <span class="ls-drill-status${attempted ? ' is-done' : ''}">${attempted ? 'Đã luyện' : 'Chưa làm'}</span>
      </div>
      <h3 class="ls-drill-title">${esc(displayDrillTitle(t))}</h3>
      <div class="ls-drill-stat">${stat}</div>
      <div class="ls-drill-actions">
        <a class="ls-drill-cta${attempted ? ' secondary' : ''}" href="/pages/listening-test.html?id=${encodeURIComponent(t.id)}">${cta} <span aria-hidden="true">→</span></a>
        <a class="ls-drill-cta secondary" href="/pages/listening-test-dictation.html?test_id=${encodeURIComponent(t.id)}">Chép chính tả</a>
      </div>
    </article>`;
}

function renderGroup(skill, drills) {
  const available = drills.length > 0;
  const body = available
    ? `<div class="ls-drill-list">${drills.slice().sort(drillSort).map(renderDrill).join('')}</div>`
    : `<p class="ls-group-soon">Sắp có</p>`;
  return `
    <section class="ls-group${available ? '' : ' is-empty'}">
      <div class="ls-group-head">
        <div class="ls-group-icon"><i data-lucide="${esc(skill.icon)}"></i></div>
        <div>
          <h2 class="ls-group-title">${esc(skill.label)}
            ${available ? `<span class="ls-group-count">${drills.length}</span>` : ''}</h2>
          <p class="ls-group-lede">${esc(skill.lede)}</p>
        </div>
      </div>
      ${body}
    </section>`;
}

function filteredDrills() {
  const drills = DRILLS_BY_TYPE.get(ACTIVE_SKILL) || [];
  if (ACTIVE_STATUS === 'all') return drills;
  return drills.filter((t) => {
    const attempted = (t.user_attempt_count || 0) > 0;
    return ACTIVE_STATUS === 'done' ? attempted : !attempted;
  });
}

function renderSkillNav() {
  VIEWS.nav.innerHTML = SKILLS.map((skill) => {
    const count = (DRILLS_BY_TYPE.get(skill.key) || []).length;
    const selected = skill.key === ACTIVE_SKILL;
    return `
      <button class="ls-skill-nav__button${selected ? ' is-active' : ''}" type="button"
        data-skill="${esc(skill.key)}" aria-pressed="${selected ? 'true' : 'false'}"
        ${count ? '' : 'disabled'}>
        <span class="ls-skill-nav__icon"><i data-lucide="${esc(skill.icon)}"></i></span>
        <span class="ls-skill-nav__label">${esc(skill.label)}</span>
        <span class="ls-skill-nav__count">${count || '—'}</span>
      </button>`;
  }).join('');
  VIEWS.nav.querySelectorAll('.ls-skill-nav__button:not([disabled])').forEach((button) => {
    button.addEventListener('click', () => {
      ACTIVE_SKILL = button.dataset.skill || ACTIVE_SKILL;
      renderLibrary();
    });
  });
}

function renderLibrary() {
  const skill = SKILLS.find((item) => item.key === ACTIVE_SKILL);
  if (!skill) return;
  const allForSkill = (DRILLS_BY_TYPE.get(ACTIVE_SKILL) || []).slice().sort(drillSort);
  const visible = filteredDrills().slice().sort(drillSort);
  renderSkillNav();
  VIEWS.grid.innerHTML = visible.length
    ? renderGroup(skill, visible)
    : '<div class="ls-filter-empty">Không có bài nào trong nhóm này.</div>';
  $('ls-visible-count').textContent = `${visible.length}/${allForSkill.length} bài · ${skill.label}`;
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function renderSummary(drills) {
  const done = drills.filter((t) => (t.user_attempt_count || 0) > 0).length;
  const types = SKILLS.filter((skill) => (DRILLS_BY_TYPE.get(skill.key) || []).length > 0).length;
  $('ls-total-count').textContent = String(drills.length);
  $('ls-done-count').textContent = String(done);
  $('ls-type-count').textContent = String(types);
  VIEWS.summary.hidden = false;
}

function wireStatusFilters() {
  document.querySelectorAll('.ls-filter__button').forEach((button) => {
    button.addEventListener('click', () => {
      ACTIVE_STATUS = button.dataset.statusFilter || 'all';
      document.querySelectorAll('.ls-filter__button').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      renderLibrary();
    });
  });
}

// The list endpoint caps limit at 100; drills can exceed that, so page through.
async function fetchAllDrills() {
  const all = [];
  const limit = 100;
  let offset = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await window.api.get(`/api/listening/tests?test_type=drill&limit=${limit}&offset=${offset}`);
    const items = Array.isArray(res && res.items) ? res.items : [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

async function load() {
  showState('loading');
  try {
    const drills = await fetchAllDrills();
    const byType = new Map(SKILLS.map((s) => [s.key, []]));
    for (const d of drills) {
      if (byType.has(d.drill_type)) byType.get(d.drill_type).push(d);
    }
    if (!drills.length) {
      showState('empty');
      return;
    }
    DRILLS_BY_TYPE = byType;
    const firstIncomplete = SKILLS.find((skill) =>
      (byType.get(skill.key) || []).some((t) => (t.user_attempt_count || 0) === 0));
    const firstAvailable = SKILLS.find((skill) => (byType.get(skill.key) || []).length > 0);
    ACTIVE_SKILL = (firstIncomplete || firstAvailable || SKILLS[0]).key;
    renderSummary(drills);
    renderLibrary();
    showState('grid');
  } catch (e) {
    showError(`Không tải được danh sách bài luyện: ${(e && e.message) || e}`);
  }
}

__averOnReady(function () {
  wireStatusFilters();
  load();
});
