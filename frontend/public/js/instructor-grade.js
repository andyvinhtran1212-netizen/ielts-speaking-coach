/**
 * frontend/js/instructor-grade.js — W-6b-3 instructor grade panel.
 *
 * Read-only AI feedback (reuses window.WritingRenderers — the SAME read-only
 * renderers the student view uses, so there is NO AI-band/feedback edit UI here:
 * "AI bất biến", mirroring the backend 403 on PATCH /feedback). The instructor's
 * contribution is the SEPARATE teacher-comment (instructor_note). Deliver flips
 * the essay to delivered (student sees the comment). Regrade re-runs AI (keeps the
 * comment). Revoke pulls a delivered essay back.
 *
 * Every fetch is /instructor/* (owner-scoped). Zero /admin/* (grep-gated).
 */

// Impersonation propagation (carried via ?as_instructor from the queue link).
const _api = window.api;
const _AS = new URLSearchParams(location.search).get('as_instructor');
function IMP(p) {
  if (!_AS || !p.startsWith('/instructor')) return p;
  return p + (p.includes('?') ? '&' : '?') + 'as_instructor=' + encodeURIComponent(_AS);
}
const api = {
  get:   (p)    => _api.get(IMP(p)),
  post:  (p, b) => _api.post(IMP(p), b),
  patch: (p, b) => _api.patch(IMP(p), b),
};
const $ = (id) => document.getElementById(id);
const esc = (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml
  : (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const params = new URLSearchParams(location.search);
const ESSAY_ID = params.get('essay_id');
const REVIEW_ID = params.get('review_id');

function banner(msg, kind) {
  $('ig-banner').innerHTML = msg ? `<div class="ig-banner ig-banner--${kind}">${esc(msg)}</div>` : '';
}

async function boot() {
  // role-gate (mirror require_instructor)
  let me;
  try { me = await api.get('/auth/me'); } catch (e) { me = null; }
  if (!me) return;
  if (me.role !== 'instructor' && me.role !== 'admin') {
    window.location.href = '/pages/home.html';
    return;
  }
  if (!ESSAY_ID) { banner('Thiếu essay_id.', 'err'); $('ig-loading').hidden = true; return; }
  if (_AS && $('ig-imp')) $('ig-imp').hidden = false;

  await loadEssay();
  await wireCompare();
  $('ig-save').addEventListener('click', onSaveComment);
  $('ig-deliver').addEventListener('click', onDeliver);
  $('ig-regrade').addEventListener('click', onRegrade);
  $('ig-revoke').addEventListener('click', onRevoke);
}

async function loadEssay() {
  try {
    // /instructor/* — scoped; 403 if not my essay (assert_essay_owned)
    const data = await api.get('/instructor/essays/' + encodeURIComponent(ESSAY_ID));
    $('ig-loading').hidden = true;
    $('ig-body').hidden = false;
    renderEssay(data);
  } catch (e) {
    $('ig-loading').hidden = true;
    banner(e.status === 403 ? 'Bài này không thuộc bạn.' : ('Lỗi tải bài: ' + e.message), 'err');
  }
}

function renderEssay(data) {
  const st = data.student || {};
  $('ig-student').textContent = (st.full_name || '') + (st.student_code ? ' · ' + st.student_code : '');

  const fb = data.feedback || {};
  $('ig-band').textContent = (fb.overall_band_score != null) ? ('Band ' + fb.overall_band_score) : '—';

  // teacher-comment (current value)
  $('ig-comment').value = data.instructor_note || '';

  // essay text + read-only highlight (reuse student renderer; never restyle)
  const fj = (fb && fb.feedback_json) || {};
  const essayEl = $('ig-essay');
  const raw = data.essay_text || '';
  if (window.WritingHighlight && typeof window.WritingHighlight.render === 'function') {
    try { window.WritingHighlight.render(essayEl, raw, fj.mistakeAnalysis); }
    catch (e) { essayEl.textContent = raw; }
  } else {
    essayEl.textContent = raw;
  }

  // AI feedback — READ-ONLY, via the shared section renderers (no edit controls)
  const WR = window.WritingRenderers;
  const host = $('ig-ai');
  if (!WR || !fb.feedback_json) {
    host.innerHTML = '<p class="ig-muted">Chưa có phân tích AI.</p>';
  } else {
    let html = '';
    const LABELS = {
      overview: 'Tổng quan', criteria: 'Theo tiêu chí', mistakes: 'Lỗi',
      'key-takeaways': 'Điểm chính', coherence: 'Mạch lạc', lexical: 'Từ vựng',
      'idea-development': 'Phát triển ý', 'improved': 'Bài mẫu',
    };
    Object.keys(WR.SECTION_KEYS).forEach((sectionKey) => {
      const val = fj[WR.SECTION_KEYS[sectionKey]];
      if (WR.isEmpty && WR.isEmpty(val)) return;
      const renderer = WR.SECTION_RENDERERS[sectionKey];
      if (!renderer) return;
      let body;
      try { body = renderer(val); } catch (e) { return; }
      html += `<div class="ig-sec"><h4>${esc(LABELS[sectionKey] || sectionKey)}</h4>${body}</div>`;
    });
    host.innerHTML = html || '<p class="ig-muted">Chưa có phân tích AI.</p>';
  }

  // revoke only when delivered
  $('ig-revoke').hidden = data.status !== 'delivered';
}

// F2 — surface "So sánh / Trộn phiên bản" only when ≥2 live versions exist.
async function wireCompare() {
  const btn = $('ig-compare');
  if (!btn) return;
  try {
    const data = await api.get('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/versions');
    const liveCount = (data && data.budget && data.budget.live_count) || 0;
    if (liveCount >= 2) {
      let href = '/pages/instructor/compare.html?essay_id=' + encodeURIComponent(ESSAY_ID);
      if (_AS) href += '&as_instructor=' + encodeURIComponent(_AS);   // propagate impersonation
      btn.href = href;
      btn.hidden = false;
    }
  } catch (e) { /* non-fatal — compare entry just stays hidden */ }
}

async function onSaveComment() {
  banner('', 'ok');
  try {
    await api.patch('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/instructor-note',
      { instructor_note: $('ig-comment').value });
    banner('Đã lưu nhận xét.', 'ok');
  } catch (e) {
    banner('Lỗi lưu: ' + e.message, 'err');
  }
}

async function onDeliver() {
  if (!REVIEW_ID) { banner('Thiếu review_id — mở bài từ danh sách chấm để trả bài.', 'err'); return; }
  banner('', 'ok');
  try {
    // save the comment first so it ships with the delivery
    await api.patch('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/instructor-note',
      { instructor_note: $('ig-comment').value });
    await api.post('/instructor/reviews/' + encodeURIComponent(REVIEW_ID) + '/deliver', {});
    banner('Đã trả bài — học viên sẽ thấy nhận xét.', 'ok');
    await loadEssay();
  } catch (e) {
    banner('Lỗi trả bài: ' + e.message, 'err');
  }
}

async function onRegrade() {
  if (!confirm('Chấm lại bằng AI? Nhận xét của bạn được giữ; phân tích AI cũ bị thay.')) return;
  banner('', 'ok');
  try {
    await api.post('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/regrade', {});
    banner('Đang chấm lại — tải lại sau ít phút.', 'ok');
  } catch (e) {
    banner('Lỗi chấm lại: ' + e.message, 'err');
  }
}

async function onRevoke() {
  if (!confirm('Thu hồi bài đã trả? Học viên sẽ không còn thấy bài (nhận xét được giữ).')) return;
  banner('', 'ok');
  try {
    await api.post('/instructor/essays/' + encodeURIComponent(ESSAY_ID) + '/revoke-delivery', {});
    banner('Đã thu hồi.', 'ok');
    await loadEssay();
  } catch (e) {
    banner('Lỗi thu hồi: ' + e.message, 'err');
  }
}

boot();
