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


// ── Question paper rendering — Sprint 13.5.2 Cambridge-authentic ─────
//
// Each exercise's `payload.template_kind` (form_completion /
// table_completion / notes_completion / sentence_completion /
// summary_completion / short_answer / mcq_3option / plan_label)
// dispatches to a variant-specific renderer. The renderer reads
// `payload.template` for structural context that the Sprint 13.5.2
// parser preserves alongside the question list.
//
// Every gap or MCQ input carries `data-q-num="<N>"` + class
// `ft-q-input` so the existing change handler picks them up
// without modification.

function renderPaper() {
  const root = $('ft-paper');
  const sections = (STATE.test && STATE.test.sections) || [];
  const totalQs = sections.reduce(
    (a, s) => a + (s.exercises || [])
      .reduce((b, e) => b + ((e.payload && e.payload.questions) || []).length, 0),
    0,
  );
  const out = ['<div class="ielts-test-paper">'];
  for (const sec of sections) {
    const range = sectionQuestionRange(sec);
    out.push(`
      <section class="ielts-section" data-section-num="${esc(sec.section_num)}">
        <div class="ielts-section-label">PART ${esc(sec.section_num)}</div>
        <h2 class="ielts-section-title">Questions ${esc(range[0])} – ${esc(range[1])}</h2>
        ${sec.narrator_intro
          ? `<div class="ielts-narrator-intro">${esc(sec.narrator_intro)}</div>`
          : ''}
        ${(sec.exercises || []).map(renderExercise).join('')}
      </section>
    `);
  }
  out.push('</div>');
  root.innerHTML = out.join('');
  if (totalQs) { /* total Q count not displayed; preserve for future stats */ }
  attachQuestionHandlers();
}

function sectionQuestionRange(sec) {
  let lo = Infinity, hi = -Infinity;
  for (const ex of (sec.exercises || [])) {
    for (const q of ((ex.payload && ex.payload.questions) || [])) {
      if (Number.isFinite(q.q_num)) {
        if (q.q_num < lo) lo = q.q_num;
        if (q.q_num > hi) hi = q.q_num;
      }
    }
  }
  if (lo === Infinity) return ['?', '?'];
  return [lo, hi];
}

function renderExercise(ex) {
  const payload = ex.payload || {};
  const kind = payload.template_kind
    || payload.variant
    || ex.variant
    || ex.exercise_type
    || '';
  const questions = Array.isArray(payload.questions)
    ? payload.questions
    : (Array.isArray(payload.items) ? payload.items : []);
  const tmpl = payload.template || {};
  const meta = payload.metadata || {};
  const instruction = payload.instruction || payload.instructions || '';
  const range = questions.length
    ? [questions[0].q_num, questions[questions.length - 1].q_num]
    : null;

  const header = `
    <div class="ielts-question-block" data-template-kind="${esc(kind)}">
      ${range
        ? `<div class="ielts-block-header">Questions ${esc(range[0])} – ${esc(range[1])}</div>`
        : ''}
      ${instruction
        ? `<div class="ielts-instruction">${formatInstruction(instruction)}</div>`
        : ''}
  `;
  const body = (() => {
    switch (kind) {
      case 'form_completion':     return renderFormCompletion(tmpl, questions);
      case 'table_completion':    return renderTableCompletion(tmpl, questions);
      case 'notes_completion':    return renderNotesCompletion(tmpl, questions);
      case 'summary_completion':  return renderSummaryCompletion(tmpl, questions);
      case 'sentence_completion': return renderSentenceCompletion(tmpl, questions);
      case 'short_answer':        return renderShortAnswer(questions);
      case 'mcq_3option':         return renderMCQ(questions);
      case 'mcq_letter_label':
      case 'plan_label':          return renderPlanLabel(meta, questions);
      default:                    return renderFallback(questions);
    }
  })();
  return header + body + `</div>`;
}

function formatInstruction(raw) {
  // Each sentence on its own line preserves the second-line italic
  // emphasis pattern (`Write NO MORE THAN…`).
  const parts = String(raw)
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return `<p>${esc(raw)}</p>`;
  return parts.map((p) => `<p>${esc(p)}</p>`).join('');
}


// ── Form completion ─────────────────────────────────────────────────

function renderFormCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const rows = Array.isArray(tmpl.rows) ? tmpl.rows : [];
  if (!rows.length) return renderFallback(questions);
  return `
    <div class="ielts-form-container">
      ${heading ? `<div class="ielts-form-heading">${esc(heading)}</div>` : ''}
      <div class="ielts-form-grid">
        ${rows.map((r) => {
          const label = `<span class="ielts-form-label">${esc(r.label || '')}:</span>`;
          if (r.example != null) {
            return `<div class="ielts-form-row">
              ${label}
              <span class="ielts-form-example">${esc(r.example)} (Example)</span>
            </div>`;
          }
          if (r.q_num != null) {
            const pref = r.prefix
              ? `<span class="ielts-form-prefix">${esc(r.prefix)}</span>`
              : '';
            return `<div class="ielts-form-row">
              ${label}
              ${pref}
              <span class="ielts-question-num">${esc(r.q_num)}</span>
              ${gapInput(r.q_num)}
            </div>`;
          }
          return `<div class="ielts-form-row">
            ${label}
            <span>${esc(r.text || '')}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}


// ── Table completion ────────────────────────────────────────────────

function renderTableCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const headers = Array.isArray(tmpl.headers) ? tmpl.headers : [];
  const rows    = Array.isArray(tmpl.rows)    ? tmpl.rows    : [];
  if (!headers.length || !rows.length) return renderFallback(questions);
  return `
    <div class="ielts-table-container">
      ${heading ? `<div class="ielts-table-heading">${esc(heading)}</div>` : ''}
      <table class="ielts-table">
        <thead>
          <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((c) => {
            if (c && typeof c === 'object' && c.q_num != null) {
              return `<td>
                <span class="ielts-question-num">${esc(c.q_num)}</span>
                ${gapInput(c.q_num)}
              </td>`;
            }
            return `<td>${esc(c == null ? '' : c)}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}


// ── Notes completion ────────────────────────────────────────────────

function renderNotesCompletion(tmpl, questions) {
  const heading = tmpl.heading || '';
  const groups = Array.isArray(tmpl.groups) ? tmpl.groups : [];
  if (!groups.length) return renderFallback(questions);
  return `
    <div class="ielts-notes-container">
      ${heading ? `<div class="ielts-notes-heading">${esc(heading)}</div>` : ''}
      ${groups.map((g) => `
        <div class="ielts-notes-group">
          ${g.heading
            ? `<div class="ielts-notes-group-heading">${esc(g.heading)}</div>`
            : ''}
          <ul class="ielts-notes-list">
            ${(g.items || []).map((it) => {
              if (it && typeof it === 'object' && it.q_num != null) {
                return `<li>
                  ${esc(it.prefix || '')}
                  <span class="ielts-question-num">${esc(it.q_num)}</span>
                  ${gapInput(it.q_num)}
                  ${it.suffix ? ' ' + esc(it.suffix) : ''}
                </li>`;
              }
              return `<li>${esc((it && it.text) || '')}</li>`;
            }).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  `;
}


// ── Summary completion (inline-gap paragraph) ──────────────────────

function renderSummaryCompletion(tmpl, questions) {
  const paragraph = tmpl.paragraph || '';
  if (!paragraph) return renderFallback(questions);
  // Split on `{{QN}}` tokens and interleave gap inputs.
  const parts = String(paragraph).split(/(\{\{Q\d+\}\})/);
  const rendered = parts.map((p) => {
    const m = /^\{\{Q(\d+)\}\}$/.exec(p);
    if (m) {
      const n = Number(m[1]);
      return `<span class="ielts-question-num">${esc(n)}</span>${gapInput(n)}`;
    }
    return esc(p);
  }).join('');
  return `<div class="ielts-summary-paragraph">${rendered}</div>`;
}


// ── Sentence completion ────────────────────────────────────────────

function renderSentenceCompletion(tmpl, questions) {
  const sentences = Array.isArray(tmpl.sentences) ? tmpl.sentences : [];
  if (!sentences.length) return renderFallback(questions);
  return sentences.map((s) => `
    <div class="ielts-sentence-row">
      <span class="ielts-question-num">${esc(s.q_num)}</span>
      <span>${esc(s.prefix || '')}</span>
      ${gapInput(s.q_num)}
      <span>${esc(s.suffix || '')}</span>
    </div>
  `).join('');
}


// ── Short answer ───────────────────────────────────────────────────

function renderShortAnswer(questions) {
  return questions.map((q) => `
    <div class="ielts-short-row">
      <span class="ielts-question-num">${esc(q.q_num)}</span>
      <span>${esc(q.prompt || '')}</span>
      ${gapInput(q.q_num)}
    </div>
  `).join('');
}


// ── MCQ ────────────────────────────────────────────────────────────

function renderMCQ(questions) {
  return questions.map((q) => `
    <div class="ielts-mcq-question">
      <div class="ielts-mcq-stem">
        <span class="ielts-question-num">${esc(q.q_num)}</span>
        ${esc(q.prompt || '')}
      </div>
      <div class="ielts-mcq-options">
        ${(q.options || []).map((o) => {
          const letter = o.letter || o.label || '';
          const text   = o.text   || '';
          return `<label class="ielts-mcq-option">
            <input type="radio" name="q-${esc(q.q_num)}" value="${esc(letter)}"
                   class="ft-q-input" data-q-num="${esc(q.q_num)}" />
            <span><strong>${esc(letter)}</strong> ${esc(text)}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}


// ── Plan / map labelling ───────────────────────────────────────────

function renderPlanLabel(meta, questions) {
  const mapDesc = (meta && meta.map_description) || '';
  const letters = Array.isArray(meta && meta.letter_options) && meta.letter_options.length
    ? meta.letter_options
    : ['A','B','C','D','E','F','G','H'];
  return `
    <div class="ielts-plan-container">
      ${mapDesc
        ? `<div class="ielts-map-description"><strong>Map description:</strong> ${esc(mapDesc)}</div>`
        : ''}
      <div class="ielts-plan-labels">
        ${questions.map((q) => `
          <div class="ielts-plan-row">
            <span class="ielts-question-num">${esc(q.q_num)}</span>
            <span class="ielts-plan-name">${esc(q.prompt || '')}</span>
            <select class="ft-q-input ielts-gap-input" data-q-num="${esc(q.q_num)}">
              <option value="">—</option>
              ${letters.map((L) => `<option value="${esc(L)}">${esc(L)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}


// ── Fallback (unknown template_kind or missing template) ───────────

function renderFallback(questions) {
  return questions.map((q) => `
    <div class="ielts-short-row">
      <span class="ielts-question-num">${esc(q.q_num)}</span>
      <span>${esc(q.prompt || '')}</span>
      ${gapInput(q.q_num)}
    </div>
  `).join('');
}


// ── Shared input fragment ──────────────────────────────────────────

function gapInput(qNum) {
  return `<input type="text" class="ft-q-input ielts-gap-input"
                 data-q-num="${esc(qNum)}"
                 autocomplete="off" spellcheck="false" />`;
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
