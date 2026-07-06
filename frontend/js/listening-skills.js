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
};

function showState(name) {
  if (VIEWS.loading) VIEWS.loading.hidden = name !== 'loading';
  if (VIEWS.empty)   VIEWS.empty.hidden   = name !== 'empty';
  if (VIEWS.error)   VIEWS.error.hidden   = name !== 'error';
  if (VIEWS.grid)    VIEWS.grid.hidden    = name !== 'grid';
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

function renderDrill(t) {
  const attempted = (t.user_attempt_count || 0) > 0;
  const best = t.user_best_score;
  const badge = t.level ? `<span class="ls-drill-level">${esc(t.level)}${t.task ? '·' + esc(t.task) : ''}</span>` : '';
  const stat = (best != null)
    ? `<span class="ls-drill-stat">Tốt nhất ${esc(best)}</span>`
    : (attempted ? '<span class="ls-drill-stat">Đã làm</span>' : '');
  const cta = attempted ? 'Làm lại' : 'Luyện';
  return `
    <a class="ls-drill" href="/pages/listening-test.html?id=${encodeURIComponent(t.id)}">
      ${badge}
      <span class="ls-drill-title">${esc(t.title || t.test_id || 'Skill drill')}</span>
      ${stat}
      <span class="ls-drill-cta">${cta} →</span>
    </a>`;
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
    VIEWS.grid.innerHTML = SKILLS.map((s) => renderGroup(s, byType.get(s.key) || [])).join('');
    showState('grid');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (e) {
    showError(`Không tải được danh sách bài luyện: ${(e && e.message) || e}`);
  }
}

document.addEventListener('DOMContentLoaded', load);
