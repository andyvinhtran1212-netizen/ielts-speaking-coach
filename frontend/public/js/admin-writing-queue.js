/**
 * admin-writing-queue.js — grade-flow PR-2.
 *
 * Global grade-queue controller for /pages/admin/writing/queue.html. Lists ALL
 * essays across students/cohorts by status (GET /admin/writing/essays — enriched
 * in PR-1 with student name/code, band, deadline), with a cross-cutting overdue
 * overlay and a bulk mark-delivered action on the "Chờ trả" (reviewed) lane.
 *
 * Two-lane model: graded = "Cần chấm" (review lane; submit-&-next lives in PR-3),
 * reviewed = "Chờ trả" (the only bulk-deliverable state). delivered = "Đã trả".
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

const TASK_LABELS = {
  task1_academic: 'Task 1 (A)', task1_general: 'Task 1 (G)', task2: 'Task 2',
};
const STATUS_LABELS = {
  graded: 'Cần chấm', reviewed: 'Chờ trả', delivered: 'Đã trả',
  pending: 'Đang chờ', grading: 'Đang chấm', failed: 'Lỗi',
};
// sessionStorage key shared with grade.html submit-&-next (PR-3).
const QUEUE_KEY = 'gradeQueue';

let _status = 'graded';   // default lane = "Cần chấm"
let _mock = false;        // Mock tab: 4-skill mock Writing essays get their own lane
let _overdue = false;
let _cohort = '';
let _rows = [];           // raw rows for the current status
let _selected = new Set();

// IELTS word minimums — a mock essay below its task's minimum is "too short":
// not auto-graded, held for the admin to grade-anyway or skip in the Mock tab.
const MOCK_MIN_WORDS = { task1: 150, task2: 250 };
function mockMinWords(taskType) {
  return String(taskType || '').startsWith('task1') ? MOCK_MIN_WORDS.task1 : MOCK_MIN_WORDS.task2;
}

// F1 — the "Đang chấm" (grading) lane shows essays the AI is grading right
// now (a 15–240s window). Those flip to graded/failed on their own, so this
// lane auto-refreshes; other lanes stay one-shot (no needless churn).
const GRADING_POLL_MS = 8000;
let _pollTimer = null;

function _stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}
function _startPollIfGrading() {
  _stopPoll();
  if (_status !== 'grading') return;
  _pollTimer = setInterval(() => {
    // Skip while backgrounded — resume on next visible tick.
    if (typeof document !== 'undefined' && document.hidden) return;
    load();
  }, GRADING_POLL_MS);
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

function showBanner(msg, kind) {
  if (kind === 'error') showToast(msg, 'error', { persist: true });
  else showToast(msg, kind === 'warn' ? 'warn' : 'success', { timeout: 5000 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return iso; }
}
function ageLabel(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return mins + ' phút';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' giờ';
  return Math.floor(hrs / 24) + ' ngày';
}
function isOverdue(e) {
  return !!e.deadline && e.deadline < new Date().toISOString() && e.status !== 'delivered';
}

// The rows actually shown = current status rows, optionally narrowed to overdue.
function visibleRows() {
  return _overdue ? _rows.filter(isOverdue) : _rows;
}

async function loadCohorts() {
  try {
    const r = await api.get('/admin/cohorts?is_active=true');
    const cohorts = (r && r.cohorts) || [];
    $('q-cohort').innerHTML = '<option value="">Tất cả lớp</option>'
      + cohorts.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || '(Lớp)')}</option>`).join('');
  } catch { /* cohort filter optional */ }
}

async function load() {
  $('q-loading').hidden = false;
  $('q-table-wrap').hidden = true;
  $('q-empty').hidden = true;
  _selected.clear();
  updateBulkBar();
  try {
    let path = '/admin/writing/essays?limit=200';
    if (_status) path += '&status=' + encodeURIComponent(_status);
    if (_cohort) path += '&cohort_id=' + encodeURIComponent(_cohort);
    // Mock essays live in their own tab: the Mock lane asks for them (mock=true),
    // every other lane excludes them (mock=false) so they don't mix into the
    // normal grading queue.
    path += '&mock=' + (_mock ? 'true' : 'false');
    const rows = await api.get(path);
    _rows = Array.isArray(rows) ? rows : [];
    render();
  } catch (e) {
    showBanner('Không tải được hàng chờ: ' + (e && e.message || 'lỗi'), 'error');
  } finally {
    $('q-loading').hidden = true;
  }
}

// Mock lane: word-count badge (⚠ when below the task minimum) + the per-row
// grade-anyway / skip actions for an ungraded essay.
function mockWcBadge(e) {
  const wc = e.word_count || 0;
  const min = mockMinWords(e.task_type);
  const short = wc < min;
  return ` <span class="q-wc${short ? ' q-wc-short' : ''}" title="Số từ (tối thiểu ${min})">${wc} từ${short ? ' ⚠' : ''}</span>`;
}
function mockActionsCell(e) {
  if (e.grading_skipped_at) return '<td><span class="q-muted">đã bỏ qua chấm</span></td>';
  if (e.status === 'pending') {
    const short = (e.word_count || 0) < mockMinWords(e.task_type);
    return '<td class="q-mock-act">'
      + `<button type="button" class="adm-btn-primary adm-btn-sm" data-grade-anyway="${escapeHtml(e.id)}">${short ? 'Chấm dù ngắn' : 'Chấm'}</button>`
      + (short ? ` <button type="button" class="adm-btn-sm q-skip-btn" data-skip="${escapeHtml(e.id)}">Bỏ qua</button>` : '')
      + '</td>';
  }
  return '<td><span class="q-muted">—</span></td>';
}

function render() {
  const rows = visibleRows();
  // Bulk-deliver only makes sense on the reviewed lane (the only deliverable
  // state); never on the Mock lane (those deliver via the mock CÔNG BỐ, not here).
  const bulkable = _status === 'reviewed' && !_mock;
  $('q-check-th').hidden = !bulkable;
  $('q-bulk-bar').hidden = !bulkable || _selected.size === 0;
  const actTh = $('q-actions-th');
  if (actTh) actTh.hidden = !_mock;

  $('q-count').textContent = rows.length + ' bài'
    + (_overdue ? ' quá hạn' : '')
    + (_mock ? ' · Mock (bài thi)' : '')
    + (_status ? ' · ' + (STATUS_LABELS[_status] || _status) : '')
    + (_status === 'grading' ? ' · tự động làm mới' : '');

  if (!rows.length) {
    $('q-empty').hidden = false;
    $('q-table-wrap').hidden = true;
    return;
  }
  $('q-empty').hidden = true;
  $('q-table-wrap').hidden = false;

  $('q-tbody').innerHTML = rows.map((e) => {
    const checkCell = bulkable
      ? `<td class="q-check-col"><input type="checkbox" class="q-check" data-id="${escapeHtml(e.id)}" ${_selected.has(e.id) ? 'checked' : ''} aria-label="Chọn bài" /></td>`
      : '';
    const name = e.student_full_name || '(không rõ)';
    const code = e.student_code ? `<span class="q-code">${escapeHtml(e.student_code)}</span>` : '';
    const task = TASK_LABELS[e.task_type] || e.task_type || '—';
    // Read-only feedback-depth level set at assign time (mig 104).
    const lvl = e.analysis_level ? ` <span class="q-lvl" title="Cấp độ phân tích AI">L${escapeHtml(e.analysis_level)}</span>` : '';
    // Task 1 graded WITHOUT its chart (stale/missing prompt image → text-only
    // grade). Flags essays that warrant a re-grade once the image is restored.
    const noImg = e.task1_image_missing
      ? ` <span class="q-badge-noimg" title="Task 1 chấm không có hình — nên chấm lại sau khi khôi phục ảnh">⚠ thiếu hình</span>`
      : '';
    const pillCls = ['graded', 'reviewed', 'delivered', 'failed'].includes(e.status) ? ' is-' + e.status : '';
    const pill = `<span class="q-pill${pillCls}">${escapeHtml(STATUS_LABELS[e.status] || e.status)}</span>`;
    const band = e.band != null ? e.band : '<span class="q-muted">—</span>';
    const overdue = isOverdue(e);
    const deadline = e.deadline
      ? `<span class="${overdue ? 'q-deadline-overdue' : ''}">${fmtDate(e.deadline)}${overdue ? ' ⚠' : ''}</span>`
      : '<span class="q-muted">—</span>';
    const wc = _mock ? mockWcBadge(e) : '';
    const actCell = _mock ? mockActionsCell(e) : '';
    return `<tr class="q-row" data-id="${escapeHtml(e.id)}">
      ${checkCell}
      <td><span class="q-name">${escapeHtml(name)}</span> ${code}</td>
      <td>${escapeHtml(task)}${lvl}${noImg}${wc}</td>
      <td>${pill}</td>
      <td>${band}</td>
      <td class="q-muted">${ageLabel(e.created_at)}</td>
      <td>${deadline}</td>
      ${actCell}
    </tr>`;
  }).join('');
}

function updateBulkBar() {
  const bar = $('q-bulk-bar');
  if (!bar) return;
  bar.hidden = !(_status === 'reviewed' && _selected.size > 0);
  $('q-bulk-count').textContent = _selected.size + ' đã chọn';
}

// Persist the current filtered order so grade.html (PR-3) can offer submit-&-next.
// Written fresh on every row open → always matches the current filter.
function writeQueueContext(essayId) {
  try {
    const ids = visibleRows().map((e) => e.id);
    const i = ids.indexOf(essayId);
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify({ ids, i, status: _status }));
  } catch { /* sessionStorage unavailable — grade.html falls back to single-essay */ }
}

function openEssay(essayId) {
  // In-flight essays (pending/grading) have no feedback yet — send them to
  // the live status poller, not the (empty) grade view. Graded+ rows open
  // the grade page with submit-&-next context.
  const row = _rows.find((e) => e.id === essayId);
  const st = row && row.status;
  if (st === 'pending' || st === 'grading') {
    window.location.href = '/pages/admin/writing/status.html?essay_id=' + encodeURIComponent(essayId);
    return;
  }
  writeQueueContext(essayId);
  window.location.href = '/pages/admin/writing/grade.html?essay_id=' + encodeURIComponent(essayId);
}

async function bulkDeliver() {
  const ids = Array.from(_selected);
  if (!ids.length) return;
  if (!confirm('Trả ' + ids.length + ' bài đã chọn cho học viên?')) return;
  const btn = $('q-bulk-deliver');
  btn.disabled = true;
  try {
    const r = await api.post('/admin/writing/essays/bulk-mark-delivered', { essay_ids: ids });
    const delivered = (r && r.delivered_count) || 0;
    const skipped = (r && r.skipped_count) || 0;
    showBanner(
      'Đã trả ' + delivered + ' bài' + (skipped ? ` · ${skipped} bài bị bỏ qua (chưa review).` : '.'),
      skipped ? 'warn' : 'success',
    );
    await load();   // canonical refetch — delivered rows leave the reviewed lane
  } catch (e) {
    showBanner('Trả bài thất bại: ' + (e && e.message || 'lỗi'), 'error');
  } finally {
    btn.disabled = false;
  }
}

function setStatus(status) {
  _status = status;
  _mock = false;       // a status tab always leaves the Mock lane
  _selected.clear();   // reset selection when the lane changes
  document.querySelectorAll('[data-status]').forEach((b) => {
    const on = b.getAttribute('data-status') === status;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  _setMockTabActive(false);
  const sa = $('q-select-all');
  if (sa) sa.checked = false;
  load();
  _startPollIfGrading();   // auto-refresh only on the grading lane
}

function _setMockTabActive(on) {
  const mb = $('q-mock-tab');
  if (!mb) return;
  mb.classList.toggle('is-active', on);
  mb.setAttribute('aria-selected', on ? 'true' : 'false');
}

// The Mock lane: all statuses, mock essays only. No status filter, no polling
// (mock essays flip through grading like any other, but this lane is a review
// worklist, not a live monitor).
function setMockLane() {
  _mock = true;
  _status = '';
  _selected.clear();
  document.querySelectorAll('[data-status]').forEach((b) => {
    b.classList.remove('is-active');
    b.setAttribute('aria-selected', 'false');
  });
  _setMockTabActive(true);
  _stopPoll();
  load();
}

// Grade a too-short (or otherwise pending) mock essay anyway — the admin's
// override of the word-count gate. Reuses the standard start-grading endpoint.
async function mockGradeAnyway(essayId) {
  try {
    await api.post('/admin/writing/essays/' + encodeURIComponent(essayId) + '/start-grading',
                   { grading_tier: 'standard' });
    showBanner('Đã đưa vào hàng chấm.', 'success');
    await load();
  } catch (e) {
    showBanner('Không đưa vào hàng chấm được: ' + (e && e.message || 'lỗi'), 'error');
  }
}

// Skip grading a too-short mock essay — the student gets the examiner's manual
// Writing band with no per-task feedback, and release stops blocking on it.
async function mockSkipGrading(essayId) {
  if (!confirm('Bỏ qua chấm bài này? Học viên vẫn nhận band Writing (do giám khảo nhập) nhưng sẽ không có bài chữa cho phần này.')) return;
  try {
    await api.post('/admin/mock-exams/writing/essays/' + encodeURIComponent(essayId) + '/skip-grading', {});
    showBanner('Đã bỏ qua chấm bài này.', 'success');
    await load();
  } catch (e) {
    showBanner('Không bỏ qua được: ' + (e && e.message || 'lỗi'), 'error');
  }
}

function wire() {
  document.querySelectorAll('[data-status]').forEach((b) => {
    b.addEventListener('click', () => setStatus(b.getAttribute('data-status')));
  });
  const mockTab = $('q-mock-tab');
  if (mockTab) mockTab.addEventListener('click', setMockLane);
  $('q-overdue').addEventListener('change', (e) => { _overdue = e.target.checked; render(); });
  $('q-cohort').addEventListener('change', (e) => { _cohort = e.target.value; load(); });

  // Row open (delegated) — mock action buttons intercept first (they must not
  // open the row), then ignore checkbox-cell clicks.
  $('q-tbody').addEventListener('click', (e) => {
    const ga = e.target.closest('[data-grade-anyway]');
    if (ga) { e.stopPropagation(); mockGradeAnyway(ga.getAttribute('data-grade-anyway')); return; }
    const sk = e.target.closest('[data-skip]');
    if (sk) { e.stopPropagation(); mockSkipGrading(sk.getAttribute('data-skip')); return; }
    if (e.target.closest('.q-check-col')) return;
    const tr = e.target.closest('tr.q-row[data-id]');
    if (tr) openEssay(tr.dataset.id);
  });
  // Per-row checkbox → selection set.
  $('q-tbody').addEventListener('change', (e) => {
    const cb = e.target.closest('input.q-check[data-id]');
    if (!cb) return;
    if (cb.checked) _selected.add(cb.dataset.id); else _selected.delete(cb.dataset.id);
    updateBulkBar();
  });
  // Select-all (visible reviewed rows).
  $('q-select-all').addEventListener('change', (e) => {
    const on = e.target.checked;
    _selected.clear();
    if (on) visibleRows().forEach((r) => _selected.add(r.id));
    document.querySelectorAll('#q-tbody input.q-check[data-id]').forEach((cb) => { cb.checked = on; });
    updateBulkBar();
  });
  $('q-bulk-deliver').addEventListener('click', bulkDeliver);

  loadCohorts();
  // The Mock Test cockpit embeds this page with ?mocklane=1 → open the Mock lane
  // straight away (skip the default status lane + polling).
  let _mocklane = false;
  try { _mocklane = new URLSearchParams(location.search).get('mocklane') === '1'; } catch { /* no-op */ }
  if (_mocklane) { setMockLane(); return; }
  // F3 — honour a ?status= deep-link (e.g. nav "Trạng thái chấm" →
  // queue.html?status=grading lands on the "Đang chấm" lane). Falls back to
  // the default "Cần chấm" lane when absent/invalid.
  const urlStatus = _readUrlStatus();
  if (urlStatus !== null) setStatus(urlStatus);   // sets lane + tab + load + poll
  else load();
}

// Returns a valid lane from ?status= (incl. '' = "Tất cả"), or null when the
// param is absent/unrecognised. null vs '' matters: absent → default lane.
function _readUrlStatus() {
  try {
    const v = new URLSearchParams(window.location.search).get('status');
    if (v === null) return null;
    return ['grading', 'graded', 'reviewed', 'delivered', ''].includes(v) ? v : null;
  } catch { return null; }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
