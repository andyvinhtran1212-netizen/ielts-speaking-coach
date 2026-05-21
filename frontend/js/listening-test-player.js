/**
 * frontend/js/listening-test-player.js — Sprint 13.5
 *
 * Student full-test player. Three states:
 *
 *   1. PRE-START — fetch GET /api/listening/tests/{id}, render rules
 *      + "Bắt đầu test" button. Confirm dialog before consuming an
 *      attempt slot (an attempt is only created when the student clicks
 *      Start).
 *
 *   2. PLAYER — POST /api/listening/tests/{id}/attempts, then render
 *      the 4-section question paper + custom audio controls. Audio has
 *      Play/Pause + speed (0.75/1/1.25) + volume — NO seek/rewind
 *      (Cambridge constraint). Each answer change debounces 2s and
 *      PATCHes /api/listening/tests/attempts/{id}/answers.
 *
 *   3. RESULT — POST /api/listening/tests/attempts/{id}/submit, render
 *      score + band + section breakdown + trap analytics + per-Q list.
 */

const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  testId:        null,
  test:          null,
  attemptId:     null,
  audio:         null,
  answers:       new Map(),   // q_num → user_answer
  saveTimers:    new Map(),   // q_num → setTimeout handle
  inflight:      new Set(),   // q_nums mid-PATCH
  submitting:    false,
};

const VIEWS = {
  loading:   $('state-loading'),
  missing:   $('state-missing'),
  error:     $('state-error'),
  prestart:  $('ft-prestart'),
  player:    $('ft-player'),
  result:    $('ft-result'),
};

function showState(name) {
  VIEWS.loading.hidden  = name !== 'loading';
  VIEWS.missing.hidden  = name !== 'missing';
  VIEWS.error.hidden    = name !== 'error';
  VIEWS.prestart.hidden = name !== 'prestart';
  VIEWS.player.hidden   = name !== 'player';
  VIEWS.result.hidden   = name !== 'result';
}
function showError(msg) {
  VIEWS.error.textContent = msg;
  showState('error');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTestIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('id') || '').trim() || null;
}

function fmtTime(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}


// ── Initial load ─────────────────────────────────────────────────────

async function loadTest(testId) {
  showState('loading');
  try {
    const test = await window.api.get(`/api/listening/tests/${encodeURIComponent(testId)}`);
    STATE.testId = testId;
    STATE.test   = test;
    $('ft-title').textContent = test.title || test.test_id || 'Untitled';
    $('ft-subtitle').textContent =
      `${(test.sections || []).length} sections · 40 câu · ~30 phút`;
    $('ft-prestart-title').textContent = `Sẵn sàng bắt đầu — ${test.title || test.test_id || ''}`;
    showState('prestart');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (msg.includes('404')) {
      showError('Test không tồn tại hoặc chưa được xuất bản.');
    } else if (msg.includes('422')) {
      showError('Test này chưa có audio sẵn sàng. Quay lại sau.');
    } else {
      showError(`Không tải được test: ${msg}`);
    }
  }
}


// ── Start attempt + render player ────────────────────────────────────

async function startAttempt() {
  const ok = window.confirm(
    'Bắt đầu test? Audio sẽ phát ngay và không thể tua lại. ' +
    'Bài thi sẽ kết thúc khi bạn nộp bài hoặc audio chạy hết.',
  );
  if (!ok) return;

  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Đang khởi tạo…';

  try {
    const res = await window.api.post(
      `/api/listening/tests/${encodeURIComponent(STATE.testId)}/attempts`,
      {},
    );
    STATE.attemptId = res.attempt_id;
    renderPaper();
    mountAudio();
    showState('player');
  } catch (e) {
    $('btn-start').disabled = false;
    $('btn-start').textContent = 'Bắt đầu test';
    showError(`Không tạo được attempt: ${(e && e.message) || e}`);
  }
}


// ── Question paper rendering ─────────────────────────────────────────

function renderPaper() {
  const root = $('ft-paper');
  const sections = (STATE.test && STATE.test.sections) || [];
  const out = [];
  for (const sec of sections) {
    out.push(`
      <section class="ft-section">
        <div class="ft-section-meta">Section ${esc(sec.section_num)}</div>
        <div class="ft-section-title">${esc(sec.title || `Section ${sec.section_num}`)}</div>
        ${sec.narrator_intro ? `<div class="ft-narrator">${esc(sec.narrator_intro)}</div>` : ''}
        ${sec.context ? `<div class="ft-narrator">${esc(sec.context)}</div>` : ''}
        ${(sec.exercises || []).map(renderExercise).join('')}
      </section>
    `);
  }
  root.innerHTML = out.join('');
  attachQuestionHandlers();
}

function renderExercise(ex) {
  const payload = ex.payload || {};
  const instructions = payload.instructions || '';
  const type = ex.exercise_type || '';
  const items = Array.isArray(payload.items) ? payload.items : [];
  return `
    <div class="ft-exercise" data-exercise-type="${esc(type)}">
      ${instructions ? `<div class="ft-exercise-instructions">${esc(instructions)}</div>` : ''}
      ${items.map((it) => renderItem(type, it)).join('')}
    </div>
  `;
}

function renderItem(type, item) {
  const q = item.q_num;
  if (type === 'mcq_3option' || type === 'mcq_letter_label') {
    const opts = Array.isArray(item.options) ? item.options : [];
    return `
      <div class="ft-q-row" data-q-num="${esc(q)}">
        <span class="ft-q-num">${esc(q)}.</span>
        <span class="ft-q-prompt">${esc(item.prompt || '')}</span>
      </div>
      <div class="ft-mcq-options" data-q-options="${esc(q)}">
        ${opts.map((o) => {
          const label = o.label || '';
          const text  = o.text || '';
          return `
            <label class="ft-mcq-label">
              <input type="radio" name="q-${esc(q)}" value="${esc(label)}"
                     class="ft-q-input" data-q-num="${esc(q)}" />
              <span><strong>${esc(label)}.</strong> ${esc(text)}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;
  }
  // dictation_gap_fill / dictation_short_answer
  return `
    <div class="ft-q-row" data-q-num="${esc(q)}">
      <span class="ft-q-num">${esc(q)}.</span>
      <span class="ft-q-prompt">${esc(item.prompt || '')}</span>
      <input type="text" class="ft-q-input" data-q-num="${esc(q)}"
             placeholder="Đáp án" autocomplete="off" spellcheck="false" />
    </div>
  `;
}

function attachQuestionHandlers() {
  const inputs = document.querySelectorAll('.ft-q-input');
  inputs.forEach((el) => {
    el.addEventListener('input',  () => onAnswerChange(el));
    el.addEventListener('change', () => onAnswerChange(el));
  });
}

function onAnswerChange(el) {
  const qNum = Number(el.getAttribute('data-q-num'));
  if (!Number.isFinite(qNum) || qNum < 1 || qNum > 40) return;
  const val = (el.type === 'radio')
    ? (el.checked ? el.value : null)
    : el.value;
  if (val == null || val === '') {
    STATE.answers.delete(qNum);
  } else {
    STATE.answers.set(qNum, val);
  }
  updateAnsweredCount();
  scheduleAutoSave(qNum, val);
}

function updateAnsweredCount() {
  const n = STATE.answers.size;
  const a = $('ft-answered');
  const b = $('ft-answered-foot');
  if (a) a.textContent = String(n);
  if (b) b.textContent = String(n);
}


// ── Debounced auto-save (2s per gap, last-write-wins) ────────────────

function scheduleAutoSave(qNum, value) {
  if (STATE.saveTimers.has(qNum)) {
    clearTimeout(STATE.saveTimers.get(qNum));
  }
  const handle = setTimeout(() => {
    STATE.saveTimers.delete(qNum);
    void saveAnswer(qNum, value);
  }, 2000);
  STATE.saveTimers.set(qNum, handle);
}

async function saveAnswer(qNum, value) {
  if (!STATE.attemptId) return;
  if (STATE.inflight.has(qNum)) return;
  STATE.inflight.add(qNum);
  try {
    await window.api.patch(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/answers`,
      { q_num: qNum, user_answer: value == null ? '' : String(value) },
    );
    const el = document.querySelector(`.ft-q-input[data-q-num="${qNum}"]`);
    if (el && el.type !== 'radio') el.classList.add('saved');
  } catch (e) {
    // Silent — user can re-edit; UI does not need to block on save errors.
  } finally {
    STATE.inflight.delete(qNum);
  }
}


// ── Audio control (NO seek/rewind) ───────────────────────────────────

function mountAudio() {
  const audio = new Audio();
  audio.src         = STATE.test.audio_url;
  audio.preload     = 'auto';
  audio.crossOrigin = 'anonymous';
  STATE.audio = audio;

  audio.addEventListener('loadedmetadata', () => {
    $('ft-total-time').textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    $('ft-current-time').textContent = fmtTime(audio.currentTime);
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $('ft-audio-fill').style.width = `${pct}%`;
  });
  audio.addEventListener('ended', () => {
    $('btn-playpause').textContent = '▶ Play';
  });

  $('btn-playpause').addEventListener('click', togglePlay);
  document.querySelectorAll('.ft-speed-btn').forEach((b) => {
    b.addEventListener('click', () => setSpeed(b));
  });
  $('ft-volume').addEventListener('input', (e) => {
    audio.volume = Number(e.target.value) / 100;
  });
  $('btn-submit').addEventListener('click', confirmSubmit);
}

function togglePlay() {
  const a = STATE.audio;
  if (!a) return;
  if (a.paused) {
    a.play();
    $('btn-playpause').textContent = '⏸ Pause';
  } else {
    a.pause();
    $('btn-playpause').textContent = '▶ Play';
  }
}

function setSpeed(btn) {
  if (!STATE.audio) return;
  const rate = Number(btn.getAttribute('data-speed')) || 1;
  STATE.audio.playbackRate = rate;
  document.querySelectorAll('.ft-speed-btn').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
}


// ── Submit + result panel ────────────────────────────────────────────

async function confirmSubmit() {
  if (STATE.submitting) return;
  const answered = STATE.answers.size;
  const ok = window.confirm(
    `Nộp bài bây giờ? Bạn đã trả lời ${answered}/40 câu. ` +
    'Sau khi nộp, bạn không thể chỉnh sửa đáp án.',
  );
  if (!ok) return;

  STATE.submitting = true;
  $('btn-submit').disabled = true;
  $('btn-submit').textContent = 'Đang chấm…';

  // Flush any pending debounced saves first.
  const pending = Array.from(STATE.saveTimers.keys());
  for (const q of pending) {
    clearTimeout(STATE.saveTimers.get(q));
    STATE.saveTimers.delete(q);
    await saveAnswer(q, STATE.answers.get(q));
  }

  try {
    const result = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attemptId)}/submit`,
      {},
    );
    if (STATE.audio) STATE.audio.pause();
    renderResult(result);
    showState('result');
  } catch (e) {
    STATE.submitting = false;
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = 'Nộp bài';
    showError(`Không nộp được bài: ${(e && e.message) || e}`);
  }
}

function renderResult(result) {
  const score = result.score ?? 0;
  const max   = result.max_score ?? 40;
  $('res-score').textContent = `${score}/${max}`;
  $('res-band').textContent  = result.band_estimate != null
    ? Number(result.band_estimate).toFixed(1)
    : 'Dưới band 4';
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  $('res-pct').textContent = `${pct}%`;

  // Section breakdown.
  const sb = result.section_breakdown || {};
  const sbRoot = $('res-sections');
  sbRoot.innerHTML = ['s1','s2','s3','s4'].map((k) => {
    const cell = sb[k] || { correct: 0, total: 0 };
    return `<div class="ft-section-cell">
      ${esc(k.toUpperCase())}<br>
      <strong>${esc(cell.correct)}/${esc(cell.total)}</strong>
    </div>`;
  }).join('');

  // Trap analytics.
  const trap = result.trap_analytics || {};
  const trapKeys = Object.keys(trap);
  if (trapKeys.length) {
    $('res-trap-block').hidden = false;
    $('res-trap').innerHTML = trapKeys.map((k) => {
      const v = trap[k] || { caught: 0, missed: 0 };
      return `<div class="ft-trap-row">
        <span>${esc(k)}</span>
        <span>Bắt được: <strong>${esc(v.caught)}</strong> · Mắc bẫy: <strong>${esc(v.missed)}</strong></span>
      </div>`;
    }).join('');
  } else {
    $('res-trap-block').hidden = true;
  }

  // Per-question list.
  const perQ = Array.isArray(result.per_question) ? result.per_question : [];
  $('res-per-q').innerHTML = perQ.map((r) => {
    const cls = r.correct ? 'correct' : 'wrong';
    const userText = r.user_answer || '(bỏ trống)';
    return `
      <div class="ft-per-q-row ${cls}">
        <span class="ft-per-q-num">${esc(r.q_num)}</span>
        <span class="ft-per-q-user">${esc(userText)}</span>
        <span class="ft-per-q-expected">→ ${esc(r.expected)}</span>
      </div>
    `;
  }).join('');
}


// ── Entry point ──────────────────────────────────────────────────────

function main() {
  const id = getTestIdFromUrl();
  if (!id) {
    showState('missing');
    return;
  }
  $('btn-start').addEventListener('click', startAttempt);
  void loadTest(id);
}

document.addEventListener('DOMContentLoaded', main);
