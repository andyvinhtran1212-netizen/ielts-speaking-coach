/**
 * frontend/js/listening-tf.js — Sprint 11.4 (DEBT-LISTENING-MODULE 4/5).
 *
 * User-facing True/False/Not-Given exercise. Loads content + published
 * true_false exercise (statements[]), shows radios per statement,
 * POSTs answers[] to /api/listening/attempts. Server returns
 * per-statement details + aggregate score.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  contentId:    null,
  exerciseId:   null,
  statements:   [],    // [{idx, text, answer?}] — answer stripped client-side
  answers:      [],    // user picks, parallel to statements
  listenCount:  0,
  hasSubmitted: false,
  lastResult:   null,
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  surface: $('tf-surface'),
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
      `/api/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=true_false`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    const stmts = ex && ex.payload && Array.isArray(ex.payload.statements)
      ? ex.payload.statements : [];
    if (!ex || !stmts.length) {
      VIEWS.empty.innerHTML =
        '<p><strong>Bài này chưa có dạng Đúng / Sai.</strong></p>'
        + '<p>Quản trị viên cần soạn các nhận định trước.</p>';
      showState('empty');
      return;
    }

    STATE.contentId   = contentId;
    STATE.exerciseId  = ex.id;
    // Strip server-side answer field — user must NOT see it client-side.
    STATE.statements = stmts.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0))
      .map((s) => ({ idx: s.idx, text: s.text }));
    STATE.answers = new Array(STATE.statements.length).fill('');
    STATE.listenCount = 0;
    STATE.hasSubmitted = false;
    STATE.lastResult = null;

    $('content-title').textContent = content.title || 'Bài nghe';

    const player = $('player');
    player.setAttribute('refetch-url', `/api/listening/content/${contentId}`);
    player.setAttribute('src', content.audio_signed_url);

    renderStatements();
    showState('ready');
  } catch (e) {
    if ((e && e.message || '').includes('404')) {
      showError('Bài nghe không tồn tại hoặc chưa được công khai.');
    } else {
      showError('Không tải được bài nghe. ' + (e && e.message ? e.message : ''));
    }
  }
}


function renderStatements() {
  const list = $('statements-list');
  const details = STATE.lastResult && Array.isArray(STATE.lastResult.details)
    ? STATE.lastResult.details : null;
  list.innerHTML = '';
  STATE.statements.forEach((stmt, i) => {
    const detail = details && details[i];
    const cls = !detail ? '' : (detail.is_correct ? 'is-correct' : 'is-incorrect');
    const note = !detail ? '' : (
      detail.is_correct
        ? `<span class="stmt-result-note">✓ Đúng — đáp án ${detail.expected}</span>`
        : `<span class="stmt-result-note">✗ Sai — bạn chọn ${detail.actual || '(trống)'} · đáp án ${detail.expected}</span>`
    );
    const disabled = STATE.hasSubmitted ? 'disabled' : '';
    const checked = (v) => STATE.answers[i] === v ? 'checked' : '';

    const li = document.createElement('li');
    if (cls) li.classList.add(cls);
    li.dataset.idx = String(i);
    li.innerHTML = `
      <div class="stmt-row">
        <span class="stmt-idx">${i + 1}.</span>
        <span class="stmt-text">${escapeHtml(stmt.text)}</span>
      </div>
      <div class="stmt-radios" role="radiogroup" aria-label="Đáp án câu ${i + 1}">
        <label class="stmt-radio-label">
          <input type="radio" name="tf-${i}" value="T"  ${checked('T')}  ${disabled} /> Đúng (T)
        </label>
        <label class="stmt-radio-label">
          <input type="radio" name="tf-${i}" value="F"  ${checked('F')}  ${disabled} /> Sai (F)
        </label>
        <label class="stmt-radio-label">
          <input type="radio" name="tf-${i}" value="NG" ${checked('NG')} ${disabled} /> Không có (NG)
        </label>
      </div>
      ${note}
    `;
    list.appendChild(li);
  });
  wireRadioEvents();
}


function wireRadioEvents() {
  // Delegated, bind-once handler — survives re-renders (`renderStatements`
  // reuses the same #statements-list element). A `_tf_bound` latch on the
  // node prevents double-binding when load() runs twice (e.g. nav-back).
  const list = $('statements-list');
  if (list._tf_bound) return;
  list._tf_bound = true;
  list.addEventListener('change', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    if (e.target.type === 'radio' && Number.isFinite(idx)) {
      STATE.answers[idx] = e.target.value;
    }
  });
}


async function submitAttempt() {
  if (!STATE.exerciseId) return;
  if (STATE.answers.some((a) => !a)) {
    showError('Bạn chưa chọn đáp án cho tất cả nhận định.');
    return;
  }
  VIEWS.error.hidden = true;
  $('btn-submit').disabled = true;

  try {
    const result = await window.api.post('/api/listening/attempts', {
      exercise_id:  STATE.exerciseId,
      content_id:   STATE.contentId,
      mode:         'true_false',
      answers:      STATE.answers,
      listen_count: Math.max(1, STATE.listenCount),
    });
    STATE.hasSubmitted = true;
    STATE.lastResult = result;
    renderResult(result);
    renderStatements();
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
      STATE.answers = new Array(STATE.statements.length).fill('');
      STATE.hasSubmitted = false;
      STATE.lastResult = null;
      $('btn-submit').disabled = false;
      $('btn-reset').hidden = true;
      $('score-pill').hidden = true;
      renderStatements();
    });
  });
}
