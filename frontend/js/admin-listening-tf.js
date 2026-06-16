/**
 * frontend/js/admin-listening-tf.js — Sprint 11.4 (DEBT-LISTENING-
 * MODULE 4/5).
 *
 * Admin True/False/Not-Given exercise editor. URL: ?content_id=<UUID>.
 * Manages 3-12 statements (IELTS standard range), each with T/F/NG
 * answer dropdown. POSTs to /admin/listening/exercises with
 * payload.statements[].
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);
const MIN_STATEMENTS = 3;
const MAX_STATEMENTS = 12;

const STATE = {
  contentId:   null,
  exerciseId:  null,
  statements:  [],   // [{text, answer: "T"|"F"|"NG"}]
};


function showBanner(text, kind = 'info') {
  showToast(text, kind, { persist: true });
}


function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}


async function load() {
  const contentId = getContentIdFromUrl();
  if (!contentId) {
    showBanner('Thiếu ?content_id trong URL.', 'error');
    return;
  }
  STATE.contentId = contentId;
  try {
    const content = await window.api.get(`/admin/listening/content/${contentId}`);
    $('content-info').innerHTML =
      `<strong>${escapeHtml(content.title || 'Bài nghe')}</strong><br>`
      + `<span style="color: var(--av-text-muted); font-size: var(--av-fs-xs);">`
      + `Duration: ${content.audio_duration_seconds}s · Status: ${content.status} · ID: ${escapeHtml(content.id)}</span>`;
    $('transcript-ref').textContent = content.transcript || '';

    const player = $('player');
    if (content.audio_signed_url) {
      player.setAttribute('src', content.audio_signed_url);
      player.setAttribute('refetch-url', `/admin/listening/content/${contentId}`);
    }

    const exRes = await window.api.get(
      `/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=true_false`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    if (ex) {
      STATE.exerciseId = ex.id;
      const raw = (ex.payload && ex.payload.statements) || [];
      STATE.statements = raw.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
        .map((s) => ({ text: s.text || '', answer: s.answer || 'T' }));
      renderStatements();
      showBanner(
        `Đang chỉnh sửa exercise ${ex.id} (${STATE.statements.length} nhận định, status=${ex.status}).`,
        'info',
      );
    } else {
      // Seed with the minimum number of empty statement rows.
      STATE.statements = Array.from({ length: MIN_STATEMENTS },
        () => ({ text: '', answer: 'T' }));
      renderStatements();
      showBanner('Chưa có true_false exercise — soạn nội dung rồi lưu.', 'info');
    }
  } catch (e) {
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


function renderStatements() {
  const list = $('statements-list');
  list.innerHTML = '';
  STATE.statements.forEach((stmt, i) => {
    const li = document.createElement('li');
    li.dataset.idx = String(i);
    li.innerHTML = `
      <span class="stmt-idx">#${i + 1}</span>
      <input class="stmt-text-input" data-field="text"
             placeholder="Nhập nhận định..."
             value="${escapeAttr(stmt.text)}" />
      <select class="stmt-answer-select" data-field="answer">
        <option value="T"  ${stmt.answer === 'T' ? 'selected' : ''}>Đúng (T)</option>
        <option value="F"  ${stmt.answer === 'F' ? 'selected' : ''}>Sai (F)</option>
        <option value="NG" ${stmt.answer === 'NG' ? 'selected' : ''}>Không có (NG)</option>
      </select>
      <button class="btn-danger" type="button" data-action="delete">Xóa</button>
    `;
    list.appendChild(li);
  });
  $('statements-count').textContent =
    `${STATE.statements.length}/${MAX_STATEMENTS} nhận định`;
  highlightInvalid();
  // Disable Add button when at max.
  $('btn-add').disabled = STATE.statements.length >= MAX_STATEMENTS;
}


function highlightInvalid() {
  const lis = $('statements-list').querySelectorAll('li');
  lis.forEach((li, i) => {
    const stmt = STATE.statements[i];
    if (!stmt) return;
    li.classList.toggle('has-error', !stmt.text.trim());
  });
}


function wireRowEvents() {
  $('statements-list').addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const field = e.target.dataset.field;
    if (!STATE.statements[idx]) return;
    if (field === 'text') {
      STATE.statements[idx].text = e.target.value;
    } else if (field === 'answer') {
      STATE.statements[idx].answer = e.target.value;
    }
    highlightInvalid();
  });
  $('statements-list').addEventListener('change', (e) => {
    if (e.target.dataset.field === 'answer') {
      const li = e.target.closest('li');
      const idx = Number(li.dataset.idx);
      STATE.statements[idx].answer = e.target.value;
    }
  });
  $('statements-list').addEventListener('click', (e) => {
    if (e.target.dataset.action !== 'delete') return;
    const li = e.target.closest('li');
    const idx = Number(li.dataset.idx);
    if (STATE.statements.length <= MIN_STATEMENTS) {
      showBanner(`Tối thiểu ${MIN_STATEMENTS} nhận định — không thể xóa thêm.`, 'error');
      return;
    }
    STATE.statements.splice(idx, 1);
    renderStatements();
  });
}


function addStatement() {
  if (STATE.statements.length >= MAX_STATEMENTS) {
    showBanner(`Tối đa ${MAX_STATEMENTS} nhận định.`, 'error');
    return;
  }
  STATE.statements.push({ text: '', answer: 'T' });
  renderStatements();
}


function buildPayload(status) {
  const statements = STATE.statements.map((s, i) => ({
    idx:    i,
    text:   (s.text || '').trim(),
    answer: s.answer,
  }));
  return {
    content_id:    STATE.contentId,
    exercise_type: 'true_false',
    payload:       { statements },
    status,
  };
}


async function save(status) {
  if (STATE.statements.length < MIN_STATEMENTS) {
    showBanner(`Cần ít nhất ${MIN_STATEMENTS} nhận định.`, 'error');
    return;
  }
  $('btn-save').disabled = true;
  $('btn-publish').disabled = true;
  try {
    const out = await window.api.post(
      '/admin/listening/exercises', buildPayload(status),
    );
    STATE.exerciseId = out.exercise_id;
    showBanner(
      `Đã ${out.created ? 'tạo' : 'cập nhật'} T/F exercise (${out.exercise_id}, status=${status}).`,
      'success',
    );
  } catch (e) {
    showBanner(`Lưu thất bại: ${e.message || e}`, 'error');
  } finally {
    $('btn-save').disabled = false;
    $('btn-publish').disabled = false;
  }
}


function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    wireRowEvents();
    $('btn-add').addEventListener('click', addStatement);
    $('btn-save').addEventListener('click', () => save('draft'));
    $('btn-publish').addEventListener('click', () => save('published'));
  });
}
