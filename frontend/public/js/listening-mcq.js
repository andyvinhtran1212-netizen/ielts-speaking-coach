/**
 * frontend/js/listening-mcq.js — Sprint 11.5 (DEBT-LISTENING-MODULE 5/5).
 *
 * User-facing MCQ exercise. Loads content + published mcq exercise,
 * shows 4-option radio per question, POSTs mcq_answers[] (0-based int
 * indices) to /api/listening/attempts.
 *
 * Server returns per-question details + aggregate score; the canonical
 * answer_idx in `payload.questions` is stripped client-side so the
 * DOM never carries the answer key before submission.
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  contentId:    null,
  exerciseId:   null,
  questions:    [],    // [{idx, stem, options[4]}] — answer_idx stripped
  answers:      [],    // user picks (int 0-3 or null)
  listenCount:  0,
  hasSubmitted: false,
  lastResult:   null,
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  surface: $('mcq-surface'),
};


function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.surface.hidden = name !== 'ready';
}
function showError(msg) { VIEWS.error.textContent = msg; showState('error'); }


function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}


async function load(contentId) {
  showState('loading');
  try {
    const content = await window.api.get(`/api/listening/content/${contentId}`);
    if (!content || !content.audio_signed_url) {
      showError('Bài nghe không khả dụng (thiếu audio URL).');
      return;
    }
    const exRes = await window.api.get(
      `/api/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=mcq`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    const qs = ex && ex.payload && Array.isArray(ex.payload.questions)
      ? ex.payload.questions : [];
    if (!ex || !qs.length) {
      VIEWS.empty.innerHTML =
        '<p><strong>Bài này chưa có dạng Trắc nghiệm.</strong></p>'
        + '<p>Quản trị viên cần soạn các câu hỏi trước.</p>';
      showState('empty');
      return;
    }

    STATE.contentId   = contentId;
    STATE.exerciseId  = ex.id;
    // Strip server-side answer_idx — user must NOT see it in DOM.
    STATE.questions = qs.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
      .map((q) => ({ idx: q.idx, stem: q.stem, options: q.options.slice() }));
    STATE.answers = new Array(STATE.questions.length).fill(null);
    STATE.listenCount = 0;
    STATE.hasSubmitted = false;
    STATE.lastResult = null;

    $('content-title').textContent = content.title || 'Bài nghe';
    // 2026-07-17 — flag người học cho exercise lẻ: nút "Báo lỗi bài này"
    // ở header, anchor = content_id (không có test attempt ở surface này).
    if (window.AverFeedback) {
      const fbHost = $('content-title').closest('header');
      if (fbHost) window.AverFeedback.attachCardFlag({
        card: fbHost, top: fbHost, skill: 'listening',
        contentId: contentId, label: 'Báo lỗi bài này',
      });
    }

    const player = $('player');
    player.setAttribute('refetch-url', `/api/listening/content/${contentId}`);
    player.setAttribute('src', content.audio_signed_url);

    renderQuestions();
    showState('ready');
  } catch (e) {
    if ((e && e.message || '').includes('404')) {
      showError('Bài nghe không tồn tại hoặc chưa được công khai.');
    } else {
      showError('Không tải được bài nghe. ' + (e && e.message ? e.message : ''));
    }
  }
}


function renderQuestions() {
  const list = $('questions-list');
  const details = STATE.lastResult && Array.isArray(STATE.lastResult.details)
    ? STATE.lastResult.details : null;
  const LETTERS = ['A', 'B', 'C', 'D'];
  list.innerHTML = '';
  STATE.questions.forEach((q, i) => {
    const detail = details && details[i];
    const cls = !detail ? '' : (detail.is_correct ? 'is-correct' : 'is-incorrect');
    const note = !detail ? '' : (
      detail.is_correct
        ? `<span class="mcq-result-note">✓ Đúng</span>`
        : `<span class="mcq-result-note">✗ Sai — bạn chọn ${
            detail.actual_idx == null ? '(trống)' : LETTERS[detail.actual_idx]
          }</span>`
    );
    const disabled = STATE.hasSubmitted ? 'disabled' : '';

    const li = document.createElement('li');
    if (cls) li.classList.add(cls);
    li.dataset.idx = String(i);
    const optsHtml = q.options.map((opt, j) => {
      const checked = STATE.answers[i] === j ? 'checked' : '';
      return `
        <label class="mcq-option-label">
          <input type="radio" name="mcq-${i}" value="${j}" ${checked} ${disabled} />
          <span class="mcq-option-letter">${LETTERS[j]}.</span>
          <span>${escapeHtml(opt)}</span>
        </label>
      `;
    }).join('');
    li.innerHTML = `
      <div class="mcq-stem-row">
        <span class="mcq-idx">${i + 1}.</span>
        <span class="mcq-stem">${escapeHtml(q.stem)}</span>
      </div>
      <div class="mcq-options" role="radiogroup" aria-label="Câu ${i + 1}">
        ${optsHtml}
      </div>
      ${note}
    `;
    list.appendChild(li);
  });
  wireRadioEvents();
}


function wireRadioEvents() {
  // Delegated, bind-once handler — survives re-renders. `_mcq_bound` latch
  // prevents double-binding when load() runs twice.
  const list = $('questions-list');
  if (list._mcq_bound) return;
  list._mcq_bound = true;
  list.addEventListener('change', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    if (e.target.type === 'radio' && Number.isFinite(idx)) {
      STATE.answers[idx] = Number(e.target.value);
    }
  });
}


async function submitAttempt() {
  if (!STATE.exerciseId) return;
  if (STATE.answers.some((a) => a === null)) {
    showError('Bạn chưa chọn đáp án cho tất cả câu hỏi.');
    return;
  }
  VIEWS.error.hidden = true;
  $('btn-submit').disabled = true;

  try {
    const result = await window.api.post('/api/listening/attempts', {
      exercise_id:  STATE.exerciseId,
      content_id:   STATE.contentId,
      mode:         'mcq',
      mcq_answers:  STATE.answers,
      listen_count: Math.max(1, STATE.listenCount),
    });
    STATE.hasSubmitted = true;
    STATE.lastResult = result;
    renderResult(result);
    renderQuestions();
    $('btn-reset').hidden = false;
  } catch (e) {
    showError('Không gửi được câu trả lời. ' + (e && e.message ? e.message : ''));
    $('btn-submit').disabled = false;
  }
}


function renderResult(result) {
  const pct = Math.round((result.score || 0) * 100);
  const pill = $('score-pill');
  pill.textContent = `${pct}%  ·  ${result.correct}/${result.total}`;
  pill.classList.toggle('is-perfect', result.is_correct);
  pill.hidden = false;
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


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const contentId = getContentIdFromUrl();
    if (!contentId) { showState('empty'); return; }
    load(contentId);

    $('player').addEventListener('av-audio-play', () => { STATE.listenCount += 1; });

    $('btn-submit').addEventListener('click', submitAttempt);
    $('btn-reset').addEventListener('click', () => {
      STATE.answers = new Array(STATE.questions.length).fill(null);
      STATE.hasSubmitted = false;
      STATE.lastResult = null;
      $('btn-submit').disabled = false;
      $('btn-reset').hidden = true;
      $('score-pill').hidden = true;
      renderQuestions();
    });
  });
}
