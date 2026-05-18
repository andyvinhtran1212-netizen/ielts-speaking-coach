/**
 * frontend/js/listening-mini-test.js — Sprint 11.5
 * (DEBT-LISTENING-MODULE 5/5).
 *
 * Mini Test runner. Walks the session's exercise_ids[] sequentially:
 * for each step, loads the content + signed URL, mounts the
 * audio-player, renders mode-appropriate answer UI, POSTs the attempt
 * (with listening_session_id), advances on success.
 *
 * After the final step, POSTs /sessions/{id}/complete to compute
 * aggregate score + band estimate, then renders the summary.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);
const LETTERS = ['A', 'B', 'C', 'D'];

const STATE = {
  sessionId:     null,
  session:       null,
  exercises:     [],
  stepIdx:       0,
  currentContent:null,
  currentAnswer: null,  // depends on mode
};

const VIEWS = {
  loading:    $('state-loading'),
  empty:      $('state-empty'),
  error:      $('state-error'),
  progress:   $('mt-progress-bar'),
  step:       $('mt-step'),
  summary:    $('mt-summary'),
};


function showState(name) {
  VIEWS.loading.hidden  = name !== 'loading';
  VIEWS.empty.hidden    = name !== 'empty';
  VIEWS.error.hidden    = name !== 'error';
  VIEWS.progress.hidden = !(name === 'step' || name === 'summary');
  VIEWS.step.hidden     = name !== 'step';
  VIEWS.summary.hidden  = name !== 'summary';
}
function showError(msg) { VIEWS.error.textContent = msg; showState('error'); }


function getSessionIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('session_id') || '').trim() || null;
}


async function load(sessionId) {
  showState('loading');
  try {
    const session = await window.api.get(`/api/listening/sessions/${sessionId}`);
    STATE.sessionId = sessionId;
    STATE.session = session;
    STATE.exercises = Array.isArray(session.exercises) ? session.exercises : [];
    if (!STATE.exercises.length) {
      showError('Mini Test này không có câu hỏi nào.');
      return;
    }
    $('mt-title').textContent = session.title || 'Mini Test';
    $('mt-step-total').textContent = String(STATE.exercises.length);
    STATE.stepIdx = 0;
    await openStep(STATE.stepIdx);
  } catch (e) {
    if ((e && e.message || '').includes('404')) {
      showError('Mini Test không tồn tại hoặc không khả dụng.');
    } else {
      showError('Không tải được Mini Test. ' + (e && e.message ? e.message : ''));
    }
  }
}


async function openStep(idx) {
  const ex = STATE.exercises[idx];
  if (!ex) {
    showError('Không tìm thấy câu hỏi.');
    return;
  }
  $('mt-step-num').textContent = String(idx + 1);
  $('mt-step-mode-label').textContent = modeLabel(ex.exercise_type);

  try {
    const content = await window.api.get(`/api/listening/content/${ex.content_id}`);
    STATE.currentContent = content;

    $('mt-step-meta').textContent =
      `${modeLabel(ex.exercise_type)} · ${content.title || 'Bài nghe'}`;

    const player = $('player');
    player.setAttribute('refetch-url', `/api/listening/content/${ex.content_id}`);
    player.setAttribute('src', content.audio_signed_url);

    renderStep(ex);
    showState('step');
  } catch (e) {
    showError('Không tải được bài nghe. ' + (e && e.message ? e.message : ''));
  }
}


function modeLabel(t) {
  switch (t) {
    case 'dictation':  return 'Chép chính tả';
    case 'gist':       return 'Nghe ý chính';
    case 'true_false': return 'Đúng / Sai';
    case 'mcq':        return 'Trắc nghiệm';
    default:           return t;
  }
}


function renderStep(ex) {
  const stepContent = $('mt-step-content');
  const answerArea = $('mt-answer-area');
  stepContent.innerHTML = '';
  answerArea.innerHTML = '';
  STATE.currentAnswer = null;

  if (ex.exercise_type === 'dictation') {
    const segs = Array.isArray(ex.segments) ? ex.segments : [];
    const ref = segs[0]
      ? segs[0].transcript
      : (STATE.currentContent.transcript || '');
    stepContent.innerHTML =
      `<p style="color: var(--av-text-secondary); font-size: var(--av-fs-sm);">`
      + `Nghe và gõ lại câu chính xác từng từ. ${segs.length > 1
        ? `(Mini Test dùng chỉ câu đầu — ${segs.length} segments)` : ''}</p>`;
    answerArea.innerHTML = `
      <textarea id="mt-dictation-input" rows="3"
                placeholder="Gõ lại đoạn vừa nghe..."
                autocomplete="off" spellcheck="false"></textarea>
    `;
    STATE.currentAnswer = { mode: 'dictation', ref };
    return;
  }

  if (ex.exercise_type === 'gist') {
    const prompt = (ex.payload && ex.payload.prompt_text) || '';
    stepContent.innerHTML = `<p>${escapeHtml(prompt)}</p>`;
    answerArea.innerHTML = `
      <textarea id="mt-gist-input" rows="4"
                placeholder="Tóm tắt ý chính bằng tiếng Anh..."
                autocomplete="off" spellcheck="false"></textarea>
    `;
    STATE.currentAnswer = { mode: 'gist' };
    return;
  }

  if (ex.exercise_type === 'true_false') {
    const stmts = (ex.payload && Array.isArray(ex.payload.statements))
      ? ex.payload.statements.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
      : [];
    const ul = document.createElement('ul');
    ul.className = 'mt-step-list';
    stmts.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="margin-bottom: var(--av-space-2);">${i + 1}. ${escapeHtml(s.text)}</div>
        <div class="mt-radios" role="radiogroup">
          <label class="mt-radio-label"><input type="radio" name="tf-${i}" value="T" /> Đúng</label>
          <label class="mt-radio-label"><input type="radio" name="tf-${i}" value="F" /> Sai</label>
          <label class="mt-radio-label"><input type="radio" name="tf-${i}" value="NG" /> Không có</label>
        </div>
      `;
      ul.appendChild(li);
    });
    answerArea.appendChild(ul);
    STATE.currentAnswer = { mode: 'true_false', answers: new Array(stmts.length).fill('') };
    ul.addEventListener('change', (e) => {
      if (e.target.type !== 'radio') return;
      const m = e.target.name.match(/^tf-(\d+)$/);
      if (!m) return;
      STATE.currentAnswer.answers[Number(m[1])] = e.target.value;
    });
    return;
  }

  if (ex.exercise_type === 'mcq') {
    const qs = (ex.payload && Array.isArray(ex.payload.questions))
      ? ex.payload.questions.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
      : [];
    const ul = document.createElement('ul');
    ul.className = 'mt-step-list';
    qs.forEach((q, i) => {
      const li = document.createElement('li');
      const opts = (q.options || []).map((opt, j) => `
        <label class="mt-radio-label" style="display: flex;">
          <input type="radio" name="mcq-${i}" value="${j}" />
          <span style="margin-right: 6px;">${LETTERS[j]}.</span>
          <span>${escapeHtml(opt)}</span>
        </label>
      `).join('');
      li.innerHTML = `
        <div style="margin-bottom: var(--av-space-2); font-weight: var(--av-fw-semibold);">
          ${i + 1}. ${escapeHtml(q.stem)}
        </div>
        <div class="mt-radios" role="radiogroup"
             style="flex-direction: column; gap: var(--av-space-2);">
          ${opts}
        </div>
      `;
      ul.appendChild(li);
    });
    answerArea.appendChild(ul);
    STATE.currentAnswer = { mode: 'mcq', answers: new Array(qs.length).fill(null) };
    ul.addEventListener('change', (e) => {
      if (e.target.type !== 'radio') return;
      const m = e.target.name.match(/^mcq-(\d+)$/);
      if (!m) return;
      STATE.currentAnswer.answers[Number(m[1])] = Number(e.target.value);
    });
    return;
  }

  stepContent.innerHTML = `<p>Loại bài chưa hỗ trợ: ${ex.exercise_type}</p>`;
}


async function nextStep() {
  const ex = STATE.exercises[STATE.stepIdx];
  if (!ex) return;
  $('btn-next').disabled = true;
  try {
    await submitForStep(ex);
    STATE.stepIdx += 1;
    if (STATE.stepIdx >= STATE.exercises.length) {
      await complete();
      return;
    }
    await openStep(STATE.stepIdx);
  } catch (e) {
    showError('Không gửi được câu trả lời. ' + (e && e.message ? e.message : ''));
  } finally {
    $('btn-next').disabled = false;
  }
}


async function submitForStep(ex) {
  const body = {
    exercise_id:          ex.id,
    content_id:           ex.content_id,
    mode:                 ex.exercise_type,
    listening_session_id: STATE.sessionId,
    listen_count:         1,
  };
  if (ex.exercise_type === 'dictation') {
    const t = ($('mt-dictation-input')?.value || '').trim();
    if (!t) throw new Error('Hãy gõ đoạn vừa nghe.');
    body.user_transcript = t;
    body.segment_idx = 0;
  } else if (ex.exercise_type === 'gist') {
    const t = ($('mt-gist-input')?.value || '').trim();
    if (!t) throw new Error('Hãy nhập tóm tắt ý chính.');
    body.user_transcript = t;
  } else if (ex.exercise_type === 'true_false') {
    const answers = (STATE.currentAnswer?.answers || []);
    if (answers.some((a) => !a)) throw new Error('Chưa chọn đáp án cho tất cả nhận định.');
    body.answers = answers;
  } else if (ex.exercise_type === 'mcq') {
    const answers = (STATE.currentAnswer?.answers || []);
    if (answers.some((a) => a === null)) throw new Error('Chưa chọn đáp án cho tất cả câu hỏi.');
    body.mcq_answers = answers;
  } else {
    throw new Error('Loại bài chưa hỗ trợ.');
  }
  await window.api.post('/api/listening/attempts', body);
}


async function complete() {
  try {
    const res = await window.api.post(
      `/api/listening/sessions/${STATE.sessionId}/complete`, {},
    );
    $('sum-correct').textContent = `${res.correct_count}/${res.total}`;
    $('sum-score').textContent = `${Math.round((res.score_avg || 0) * 100)}%`;
    $('sum-band').textContent = String(res.band_estimate ?? '—');
    showState('summary');
  } catch (e) {
    showError('Không tính được điểm Mini Test. ' + (e && e.message ? e.message : ''));
  }
}


function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) { showState('empty'); return; }
    load(sessionId);
    $('btn-next').addEventListener('click', nextStep);
  });
}
