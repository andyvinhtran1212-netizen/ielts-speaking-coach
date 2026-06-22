/**
 * frontend/js/instructor-compose.js — F2 compare + mix ($0) controller.
 *
 * Compare ≤3 live grading versions per-criterion, pick the best of each, preview
 * the assembled result AS THE LEARNER SEES IT (reusing window.WritingRenderers —
 * NO rebuilt renderer), then commit a composed version. Selection only — no
 * AI call, no free-text edit.
 *
 * Every call goes through window.api (api.js prepends the API base) + the IMP
 * impersonation wrapper (admin "Xem như GV" via ?as_instructor) — NEVER a raw
 * fetch to the backend URL (that path caused the CORS/404 incident).
 */

import { assembleComposed, overallFromPicks, MIX_CRITERIA }
  from './instructor-compose-util.js';

// ── api + impersonation (mirrors instructor-grade.js) ─────────────────
const _api = window.api;
const _AS = new URLSearchParams(location.search).get('as_instructor');
function IMP(p) {
  if (!_AS || !p.startsWith('/instructor')) return p;
  return p + (p.includes('?') ? '&' : '?') + 'as_instructor=' + encodeURIComponent(_AS);
}
const api = {
  get:  (p)    => _api.get(IMP(p)),
  post: (p, b) => _api.post(IMP(p), b),
};

const $ = (id) => document.getElementById(id);
const esc = (window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml
  : (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESSAY_ID = new URLSearchParams(location.search).get('essay_id');

const CRIT_LABELS = {
  mainCriterion: 'Task Response / Achievement',
  coherenceCohesion: 'Coherence & Cohesion',
  lexicalResource: 'Lexical Resource',
  grammaticalRange: 'Grammatical Range',
};

let _versions = [];            // [{version, source, overall_band_score, criteriaFeedback, …}], newest first
let _versionsById = {};        // version → feedback-ish {criteriaFeedback, …}
let _budget = { can_compose: false };
let _picks = {};               // criterion → version
let _baseVersion = null;

function banner(msg, kind) {
  $('cm-banner').innerHTML = msg ? `<div class="cm-banner cm-banner--${kind}">${esc(msg)}</div>` : '';
}

async function boot() {
  let me;
  try { me = await api.get('/auth/me'); } catch (e) { me = null; }
  if (!me) return;
  if (me.role !== 'instructor' && me.role !== 'admin') {
    window.location.href = '/pages/home.html';
    return;
  }
  if (!ESSAY_ID) { banner('Thiếu essay_id.', 'err'); $('cm-loading').hidden = true; return; }
  if (_AS && $('cm-imp')) $('cm-imp').hidden = false;

  const back = $('cm-back');
  if (back) {
    let href = '/pages/instructor/grade.html?essay_id=' + encodeURIComponent(ESSAY_ID);
    if (_AS) href += '&as_instructor=' + encodeURIComponent(_AS);   // propagate impersonation
    back.href = href;
  }

  await load();
}

async function load() {
  try {
    const data = await api.get('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/versions');
    _versions = (data && data.versions) || [];
    _budget = (data && data.budget) || { can_compose: false };
    _versionsById = {};
    _versions.forEach((v) => { _versionsById[v.version] = v; });
  } catch (e) {
    $('cm-loading').hidden = true;
    banner(e.status === 403 ? 'Bài này không thuộc bạn.' : ('Lỗi tải phiên bản: ' + e.message), 'err');
    return;
  }
  $('cm-loading').hidden = true;

  if (_versions.length < 2) {
    banner('Bài này chỉ có 1 phiên bản — chưa có gì để so sánh/ghép.', 'err');
    return;
  }
  $('cm-body').hidden = false;

  // Defaults: current (newest) version is the base + every pick.
  _baseVersion = _versions[0].version;
  MIX_CRITERIA.forEach((c) => { _picks[c] = _versions[0].version; });

  renderGrid();
  renderBudget();
  renderPreview();
  $('cm-commit').addEventListener('click', onCommit);
}

function _label(v) {
  const tag = v.source === 'composed' ? 'Bản ghép'
    : (v.source && v.source.indexOf('ai_') === 0 ? 'AI' : (v.source || '—'));
  return `v${v.version} · ${tag}`;
}

// Grid: rows = 4 criteria, columns = versions. Each cell shows that version's
// criterion sub-object (band + feedback) + a radio to pick it for that criterion.
function renderGrid() {
  const head = ['<th>Tiêu chí</th>'].concat(
    _versions.map((v) => `<th>${esc(_label(v))}</th>`)).join('');
  const rows = MIX_CRITERIA.map((crit) => {
    const cells = _versions.map((v) => {
      const sub = (v.criteriaFeedback || {})[crit] || {};
      const checked = _picks[crit] === v.version ? 'checked' : '';
      return `<td>
        <label class="cm-cell">
          <input type="radio" name="pick-${crit}" value="${v.version}" ${checked}
                 data-crit="${crit}" />
          <span class="cm-cell-band">${esc(sub.bandScore != null ? sub.bandScore : '—')}</span>
          <span class="cm-cell-fb">${esc(sub.feedback || sub.explanation || '')}</span>
        </label></td>`;
    }).join('');
    return `<tr><th class="cm-crit">${esc(CRIT_LABELS[crit])}</th>${cells}</tr>`;
  }).join('');

  // base_version selector row (non-criteria content provenance).
  const baseOpts = _versions.map((v) =>
    `<option value="${v.version}" ${v.version === _baseVersion ? 'selected' : ''}>${esc(_label(v))}</option>`).join('');

  $('cm-grid').innerHTML =
    `<table class="cm-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="cm-base">Nội dung khác (bài mẫu, lỗi, tổng quan) lấy từ:
       <select id="cm-base-select">${baseOpts}</select></div>`;

  $('cm-grid').querySelectorAll('input[type=radio][data-crit]').forEach((el) => {
    el.addEventListener('change', () => {
      _picks[el.dataset.crit] = Number(el.value);
      renderPreview();
    });
  });
  $('cm-base-select').addEventListener('change', (e) => {
    _baseVersion = Number(e.target.value);
    renderPreview();
  });
}

// Budget pre-disable: when no slot is free, disable Commit BEFORE picking.
function renderBudget() {
  const b = _budget;
  $('cm-budget').textContent = `Đang dùng ${b.live_count}/${b.max} phiên bản.`;
  if (!b.can_compose) {
    $('cm-commit').disabled = true;
    banner('Đã đạt tối đa 3 phiên bản — không thể tạo bản ghép mới. Hãy chấm lại/so sánh các bản hiện có.', 'err');
  }
}

// Preview AS THE LEARNER: assemble → run through the SAME WritingRenderers the
// student view uses (no rebuilt renderer). Overall = roundHalf(mean of 4 picks).
function renderPreview() {
  const assembled = assembleComposed(_versionsById, _baseVersion, _picks);
  const pickedBands = MIX_CRITERIA.map((c) => (assembled.criteriaFeedback[c] || {}).bandScore);
  $('cm-overall').textContent = 'Band ' + overallFromPicks(pickedBands);

  const WR = window.WritingRenderers;
  const host = $('cm-preview');
  if (!WR) { host.innerHTML = '<p class="cm-muted">Renderer chưa sẵn sàng.</p>'; return; }
  const LABELS = {
    overview: 'Tổng quan', criteria: 'Theo tiêu chí', mistakes: 'Lỗi',
    'key-takeaways': 'Điểm chính', coherence: 'Mạch lạc', lexical: 'Từ vựng',
    'idea-development': 'Phát triển ý', improved: 'Bài mẫu',
  };
  let html = '';
  Object.keys(WR.SECTION_KEYS).forEach((sectionKey) => {
    const val = assembled[WR.SECTION_KEYS[sectionKey]];
    if (WR.isEmpty && WR.isEmpty(val)) return;
    const renderer = WR.SECTION_RENDERERS[sectionKey];
    if (!renderer) return;
    let bodyHtml;
    try { bodyHtml = renderer(val); } catch (e) { return; }
    html += `<div class="cm-sec"><h4>${esc(LABELS[sectionKey] || sectionKey)}</h4>${bodyHtml}</div>`;
  });
  host.innerHTML = html || '<p class="cm-muted">Không có nội dung để xem trước.</p>';
}

async function onCommit() {
  if (!_budget.can_compose) return;   // guarded; server 409 is the backstop
  $('cm-commit').disabled = true;
  banner('', 'ok');
  try {
    await api.post('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/compose', {
      base_version:      _baseVersion,
      mainCriterion:     _picks.mainCriterion,
      coherenceCohesion: _picks.coherenceCohesion,
      lexicalResource:   _picks.lexicalResource,
      grammaticalRange:  _picks.grammaticalRange,
    });
    banner('Đã tạo bản ghép — đặt làm phiên bản hiện hành.', 'ok');
  } catch (e) {
    $('cm-commit').disabled = false;
    banner('Lỗi tạo bản ghép: ' + (e.message || e), 'err');
  }
}

boot();
