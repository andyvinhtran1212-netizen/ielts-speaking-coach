/**
 * frontend/js/admin-listening-mcq.js — Sprint 11.5 (DEBT-LISTENING-
 * MODULE 5/5).
 *
 * Admin MCQ exercise editor. URL: ?content_id=<UUID>.
 * Manages 1-20 questions, each with 4 options + canonical answer_idx
 * (0-3). POSTs to /admin/listening/exercises with payload.questions[].
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 20;
const LETTERS = ['A', 'B', 'C', 'D'];

const STATE = {
  contentId:   null,
  exerciseId:  null,
  questions:   [],   // [{stem, options[4], answer_idx}]
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
      `/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=mcq`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    if (ex) {
      STATE.exerciseId = ex.id;
      const raw = (ex.payload && ex.payload.questions) || [];
      STATE.questions = raw.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
        .map((q) => ({
          stem:       q.stem || '',
          options:    Array.isArray(q.options)
                        ? q.options.slice(0, 4).concat(['', '', '', '']).slice(0, 4)
                        : ['', '', '', ''],
          answer_idx: Number.isFinite(q.answer_idx) ? q.answer_idx : 0,
        }));
      renderQuestions();
      showBanner(
        `Đang chỉnh sửa exercise ${ex.id} (${STATE.questions.length} câu, status=${ex.status}).`,
        'info',
      );
    } else {
      STATE.questions = Array.from({ length: MIN_QUESTIONS },
        () => ({ stem: '', options: ['', '', '', ''], answer_idx: 0 }));
      renderQuestions();
      showBanner('Chưa có MCQ exercise — soạn nội dung rồi lưu.', 'info');
    }
  } catch (e) {
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


function renderQuestions() {
  const list = $('questions-list');
  list.innerHTML = '';
  STATE.questions.forEach((q, i) => {
    const li = document.createElement('li');
    li.dataset.idx = String(i);

    const optsHtml = q.options.map((opt, j) => {
      const checked = q.answer_idx === j ? 'checked' : '';
      return `
        <input class="mcq-correct-radio" type="radio"
               name="correct-${i}" data-field="answer_idx" value="${j}" ${checked}
               title="Đáp án đúng" />
        <span class="mcq-letter">${LETTERS[j]}.</span>
        <input class="mcq-option-input" data-field="option" data-opt-idx="${j}"
               placeholder="Lựa chọn ${LETTERS[j]}"
               value="${escapeAttr(opt)}" />
        <span class="mcq-correct-tag">${q.answer_idx === j ? '✓ đáp án' : ''}</span>
      `;
    }).join('');

    li.innerHTML = `
      <div class="mcq-stem-row">
        <span class="mcq-idx-label">#${i + 1}</span>
        <input class="mcq-stem-input" data-field="stem"
               placeholder="Nhập câu hỏi..."
               value="${escapeAttr(q.stem)}" />
        <button class="btn-danger" type="button" data-action="delete">Xóa</button>
      </div>
      <div class="mcq-options-grid">
        ${optsHtml}
      </div>
    `;
    list.appendChild(li);
  });
  $('questions-count').textContent =
    `${STATE.questions.length}/${MAX_QUESTIONS} câu hỏi`;
  highlightInvalid();
  $('btn-add').disabled = STATE.questions.length >= MAX_QUESTIONS;
}


function highlightInvalid() {
  const lis = $('questions-list').querySelectorAll('li');
  lis.forEach((li, i) => {
    const q = STATE.questions[i];
    if (!q) return;
    const bad = !q.stem.trim() || q.options.some((o) => !String(o || '').trim());
    li.classList.toggle('has-error', bad);
  });
}


function wireRowEvents() {
  const list = $('questions-list');
  list.addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const q = STATE.questions[idx];
    if (!q) return;
    const field = e.target.dataset.field;
    if (field === 'stem') {
      q.stem = e.target.value;
    } else if (field === 'option') {
      const optIdx = Number(e.target.dataset.optIdx);
      if (Number.isFinite(optIdx) && optIdx >= 0 && optIdx <= 3) {
        q.options[optIdx] = e.target.value;
      }
    }
    highlightInvalid();
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'answer_idx') {
      const li = e.target.closest('li');
      const idx = Number(li.dataset.idx);
      STATE.questions[idx].answer_idx = Number(e.target.value);
      renderQuestions();
    }
  });
  list.addEventListener('click', (e) => {
    if (e.target.dataset.action !== 'delete') return;
    const li = e.target.closest('li');
    const idx = Number(li.dataset.idx);
    if (STATE.questions.length <= MIN_QUESTIONS) {
      showBanner(`Tối thiểu ${MIN_QUESTIONS} câu hỏi.`, 'error');
      return;
    }
    STATE.questions.splice(idx, 1);
    renderQuestions();
  });
}


function addQuestion() {
  if (STATE.questions.length >= MAX_QUESTIONS) {
    showBanner(`Tối đa ${MAX_QUESTIONS} câu hỏi.`, 'error');
    return;
  }
  STATE.questions.push({ stem: '', options: ['', '', '', ''], answer_idx: 0 });
  renderQuestions();
}


function buildPayload(status) {
  const questions = STATE.questions.map((q, i) => ({
    idx:        i,
    stem:       (q.stem || '').trim(),
    options:    q.options.map((o) => String(o || '').trim()),
    answer_idx: Number.isFinite(q.answer_idx) ? q.answer_idx : 0,
  }));
  return {
    content_id:    STATE.contentId,
    exercise_type: 'mcq',
    payload:       { questions },
    status,
  };
}


async function save(status) {
  if (STATE.questions.length < MIN_QUESTIONS) {
    showBanner(`Cần ít nhất ${MIN_QUESTIONS} câu hỏi.`, 'error');
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
      `Đã ${out.created ? 'tạo' : 'cập nhật'} MCQ exercise (${out.exercise_id}, status=${status}).`,
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
    $('btn-add').addEventListener('click', addQuestion);
    $('btn-save').addEventListener('click', () => save('draft'));
    $('btn-publish').addEventListener('click', () => save('published'));
  });
}
