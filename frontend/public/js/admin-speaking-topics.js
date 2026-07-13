/**
 * frontend/js/admin-speaking-topics.js — Sprint 12.5.
 *
 * Carved from `admin.html` panel-topics (lines 129-201 markup +
 * 1095-1520 JS) into /pages/admin/speaking/topics.html.
 *
 * Sprint 12.5 ships core CRUD + AI single-topic generate. Bulk
 * operations (bulk import, bulk generate/rotate/delete) deferred to
 * a follow-up — monolith JS for those stays as dead code until cluster
 * close in Sprint 12.8.
 *
 * Wired endpoints (unchanged from monolith):
 *   GET    /admin/topics                                — list (filterable by part client-side)
 *   POST   /admin/topics                                — create
 *   PATCH  /admin/topics/{id}                           — edit / toggle is_active
 *   DELETE /admin/topics/{id}                           — hard delete
 *   GET    /admin/topics/{id}/questions                 — expand
 *   POST   /admin/topics/{id}/questions                 — add question
 *   PATCH  /admin/topics/{id}/questions/{qid}           — edit question
 *   DELETE /admin/topics/{id}/questions/{qid}           — delete question
 *   POST   /admin/topics/{id}/generate-questions        — AI fill missing questions
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

let _all = [];           // all topics, all parts
let _currentPart = 1;    // active filter tab
let _searchTerm = '';
const _expanded = new Map();   // topicId → questions[] for inline expansion
let _editingTopicId = null;    // null = creating, else editing
let _editingQ = null;          // { topicId, questionId|null }


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
  showToast(msg, kind === 'error' ? 'error' : 'success', { timeout: 4000 });
}


// ── List ────────────────────────────────────────────────────────────


function filteredRows() {
  const needle = _searchTerm.toLowerCase();
  return _all
    .filter((t) => t.part === _currentPart)
    .filter((t) => !needle || (t.title || '').toLowerCase().includes(needle));
}

function renderTable() {
  const rows = filteredRows();
  const tbody = $('topics-tbody');
  const empty = $('topics-empty');
  const wrap = $('topics-table-wrap');
  const loading = $('topics-loading');

  loading.hidden = true;
  if (!rows.length) {
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }
  empty.hidden = true;
  wrap.hidden = false;

  tbody.innerHTML = rows.map((t) => {
    const isActive = t.is_active !== false;
    const cls = isActive ? '' : 'is-inactive';
    const expanded = _expanded.has(t.id);
    const toggleLabel = isActive ? 'Tắt' : 'Bật';
    const main = `<tr class="${cls}" data-id="${escapeHtml(t.id)}" data-row="main">
      <td>${escapeHtml(t.title || '—')}</td>
      <td><span class="top-chip">Part ${escapeHtml(String(t.part))}</span></td>
      <td>${t.question_count != null ? t.question_count : '?'}</td>
      <td>${isActive
            ? '<span class="top-chip is-active">Active</span>'
            : '<span class="top-chip">Off</span>'}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn-ghost" data-action="toggle-expand" data-id="${escapeHtml(t.id)}">${expanded ? 'Ẩn câu hỏi' : 'Xem câu hỏi'}</button>
        <button class="btn-ghost" data-action="edit"          data-id="${escapeHtml(t.id)}">Sửa</button>
        <button class="btn-ghost" data-action="toggle-active" data-id="${escapeHtml(t.id)}">${toggleLabel}</button>
        <button class="btn-ghost" data-action="generate"      data-id="${escapeHtml(t.id)}">AI gen</button>
        <button class="btn-danger" data-action="delete"        data-id="${escapeHtml(t.id)}">Xoá</button>
      </td>
    </tr>`;
    const detail = expanded
      ? `<tr data-id="${escapeHtml(t.id)}" data-row="detail"><td colspan="5">${renderQuestions(t)}</td></tr>`
      : '';
    return main + detail;
  }).join('');
}

function renderQuestions(topic) {
  const qs = _expanded.get(topic.id) || [];
  if (!qs.length) {
    return `<div class="top-questions">
      <div style="color:var(--av-text-muted)">Topic này chưa có câu hỏi nào.</div>
      <div><button class="btn-ghost" data-action="add-q" data-id="${escapeHtml(topic.id)}">+ Thêm câu hỏi</button></div>
    </div>`;
  }
  const rows = qs.map((q) => {
    const txt = escapeHtml(q.question_text || '');
    return `<div class="top-question-row">
      <div>${txt}</div>
      <div style="display:flex; gap:6px;">
        <button class="btn-ghost" data-action="edit-q"   data-id="${escapeHtml(topic.id)}" data-qid="${escapeHtml(q.id)}">Sửa</button>
        <button class="btn-danger" data-action="delete-q" data-id="${escapeHtml(topic.id)}" data-qid="${escapeHtml(q.id)}">Xoá</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="top-questions">
    ${rows}
    <div><button class="btn-ghost" data-action="add-q" data-id="${escapeHtml(topic.id)}">+ Thêm câu hỏi</button></div>
  </div>`;
}

async function loadTopics() {
  $('topics-loading').hidden = false;
  $('topics-table-wrap').hidden = true;
  $('topics-empty').hidden = true;
  try {
    _all = await api.get('/admin/topics') || [];
  } catch (err) {
    _all = [];
    showBanner('Lỗi tải topics: ' + (err.message || err), 'error');
  }
  renderTable();
}

async function loadQuestions(topicId) {
  try {
    const data = await api.get('/admin/topics/' + topicId + '/questions');
    _expanded.set(topicId, Array.isArray(data) ? data : (data.questions || []));
  } catch (err) {
    _expanded.set(topicId, []);
    showBanner('Lỗi tải câu hỏi: ' + (err.message || err), 'error');
  }
  renderTable();
}


// ── Topic CRUD ──────────────────────────────────────────────────────


function openTopicModal(topic) {
  _editingTopicId = topic ? topic.id : null;
  $('modal-title').textContent = topic ? 'Sửa topic' : 'Thêm topic mới';
  $('m-title').value = topic ? (topic.title || '') : '';
  $('m-part').value = String(topic ? topic.part : _currentPart);
  $('m-category').value = topic ? (topic.category || '') : '';
  $('modal-error').hidden = true;
  $('modal-backdrop').hidden = false;
}

function closeTopicModal() {
  $('modal-backdrop').hidden = true;
  _editingTopicId = null;
}

async function submitTopic() {
  const title = $('m-title').value.trim();
  const part = parseInt($('m-part').value, 10);
  const category = $('m-category').value.trim() || null;
  if (!title) {
    $('modal-error').textContent = 'Tên topic không được trống.';
    $('modal-error').hidden = false;
    return;
  }
  if (![1, 2, 3].includes(part)) {
    $('modal-error').textContent = 'Part phải là 1, 2 hoặc 3.';
    $('modal-error').hidden = false;
    return;
  }
  $('btn-submit').disabled = true;
  try {
    const body = { title, part, category };
    if (_editingTopicId) {
      await api.patch('/admin/topics/' + _editingTopicId, body);
      showBanner('Đã cập nhật topic.', 'success');
    } else {
      await api.post('/admin/topics', body);
      showBanner('Đã tạo topic mới.', 'success');
    }
    closeTopicModal();
    await loadTopics();
  } catch (err) {
    $('modal-error').textContent = 'Lỗi: ' + (err.message || err);
    $('modal-error').hidden = false;
  } finally {
    $('btn-submit').disabled = false;
  }
}

async function toggleActive(topicId) {
  const t = _all.find((x) => x.id === topicId);
  if (!t) return;
  const next = !(t.is_active !== false);
  try {
    await api.patch('/admin/topics/' + topicId, { is_active: next });
    showBanner('Đã ' + (next ? 'bật' : 'tắt') + ' topic.', 'success');
    await loadTopics();
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  }
}

async function deleteTopic(topicId) {
  if (!confirm('Xoá topic này? Tất cả câu hỏi liên quan cũng sẽ bị xoá.')) return;
  try {
    await api.delete('/admin/topics/' + topicId);
    showBanner('Đã xoá topic.', 'success');
    _expanded.delete(topicId);
    await loadTopics();
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  }
}

async function generateForTopic(topicId, btn) {
  if (!confirm('AI sinh câu hỏi cho topic này? Sẽ chỉ thêm câu mới, không ghi đè câu hiện có.')) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang sinh…'; }
  try {
    await api.post('/admin/topics/' + topicId + '/generate-questions', {});
    showBanner('Đã sinh câu hỏi cho topic.', 'success');
    if (_expanded.has(topicId)) await loadQuestions(topicId);
    await loadTopics();
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}


// ── Question CRUD ───────────────────────────────────────────────────


function openQuestionModal(topicId, question) {
  _editingQ = { topicId, questionId: question ? question.id : null };
  $('modal-q-title').textContent = question ? 'Sửa câu hỏi' : 'Thêm câu hỏi';
  $('mq-text').value = question ? (question.question_text || '') : '';
  // Cue card bullets visible only for Part 2 (where the topic itself is Part 2)
  const topic = _all.find((t) => t.id === topicId);
  const isPart2 = topic && topic.part === 2;
  $('mq-cue-row').hidden = !isPart2;
  if (isPart2 && question && Array.isArray(question.cue_card_bullets)) {
    $('mq-cue').value = question.cue_card_bullets.join('\n');
  } else {
    $('mq-cue').value = '';
  }
  $('modal-q-error').hidden = true;
  $('modal-q-backdrop').hidden = false;
}

function closeQuestionModal() {
  $('modal-q-backdrop').hidden = true;
  _editingQ = null;
}

async function submitQuestion() {
  if (!_editingQ) return;
  const text = $('mq-text').value.trim();
  if (!text) {
    $('modal-q-error').textContent = 'Câu hỏi không được trống.';
    $('modal-q-error').hidden = false;
    return;
  }
  const cueRaw = $('mq-cue').value;
  const bullets = cueRaw
    ? cueRaw.split('\n').map((l) => l.trim()).filter(Boolean)
    : null;

  const body = { question_text: text };
  if (bullets && bullets.length) body.cue_card_bullets = bullets;

  $('btn-q-submit').disabled = true;
  try {
    const { topicId, questionId } = _editingQ;
    if (questionId) {
      await api.patch(`/admin/topics/${topicId}/questions/${questionId}`, body);
      showBanner('Đã cập nhật câu hỏi.', 'success');
    } else {
      await api.post(`/admin/topics/${topicId}/questions`, body);
      showBanner('Đã thêm câu hỏi.', 'success');
    }
    closeQuestionModal();
    await loadQuestions(topicId);
    await loadTopics();
  } catch (err) {
    $('modal-q-error').textContent = 'Lỗi: ' + (err.message || err);
    $('modal-q-error').hidden = false;
  } finally {
    $('btn-q-submit').disabled = false;
  }
}

async function deleteQuestion(topicId, questionId) {
  if (!confirm('Xoá câu hỏi này?')) return;
  try {
    await api.delete(`/admin/topics/${topicId}/questions/${questionId}`);
    showBanner('Đã xoá câu hỏi.', 'success');
    await loadQuestions(topicId);
    await loadTopics();
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  }
}


// ── Wire it up ──────────────────────────────────────────────────────


function bind() {
  document.querySelectorAll('.top-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      _currentPart = parseInt(tab.dataset.part, 10);
      document.querySelectorAll('.top-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      renderTable();
    });
  });

  $('search').addEventListener('input', (e) => {
    _searchTerm = e.target.value || '';
    renderTable();
  });

  $('btn-add').addEventListener('click', () => openTopicModal(null));
  $('btn-cancel').addEventListener('click', closeTopicModal);
  $('btn-submit').addEventListener('click', submitTopic);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop')) closeTopicModal();
  });

  $('btn-q-cancel').addEventListener('click', closeQuestionModal);
  $('btn-q-submit').addEventListener('click', submitQuestion);
  $('modal-q-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-q-backdrop')) closeQuestionModal();
  });

  $('topics-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const a = btn.dataset.action;
    if (a === 'toggle-expand') {
      if (_expanded.has(id)) {
        _expanded.delete(id);
        renderTable();
      } else {
        await loadQuestions(id);
      }
    } else if (a === 'edit') {
      const t = _all.find((x) => x.id === id);
      if (t) openTopicModal(t);
    } else if (a === 'toggle-active') {
      toggleActive(id);
    } else if (a === 'generate') {
      generateForTopic(id, btn);
    } else if (a === 'delete') {
      deleteTopic(id);
    } else if (a === 'add-q') {
      openQuestionModal(id, null);
    } else if (a === 'edit-q') {
      const qid = btn.dataset.qid;
      const qs = _expanded.get(id) || [];
      const q = qs.find((x) => x.id === qid);
      openQuestionModal(id, q);
    } else if (a === 'delete-q') {
      deleteQuestion(id, btn.dataset.qid);
    }
  });
}

async function main() {
  bind();
  await loadTopics();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
