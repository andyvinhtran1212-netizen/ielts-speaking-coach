/**
 * listening-practice-run.js — the Luyện nhanh runner.
 *
 * One question at a time, checked the moment it is answered. On a miss the
 * player drops into segment mode over THAT question's audio window and loops
 * it, so the learner fixes it by ear rather than by being told. Modelled on
 * chép chính tả (listening-dictation.js), which has the same shape; explicitly
 * NOT the full-test shell, whose section tabs and 40-slot grid exist for a
 * 30-minute paper.
 *
 * Flow:
 *   GET  /api/listening/tests/{id}                  → questions (keys stripped)
 *   POST /api/listening/tests/{id}/attempts         → attempt_id
 *   POST /api/listening/tests/attempts/{aid}/check  → per question, repeatable
 *   POST /api/listening/tests/attempts/{aid}/submit → summary
 *
 * The score comes from submit, i.e. from the FIRST answer to each question
 * (enforced server-side, mig 174). Retries teach; they do not score. The
 * summary says so in as many words — a number the learner misreads as "I got
 * 8/8" after grinding every question is worse than no number.
 */

const $ = (id) => document.getElementById(id);

// Canonical escaper (audit C4) — the Node-safe guard keeps this module
// importable by the tests, which have no window.
const esc = (s) => (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml(s)
  : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Two wrong tries before the escape hatch appears. One is too eager — the
// learner has not really tried to hear it yet — and the server refuses a reveal
// until an answer is on file anyway.
export const REVEAL_AFTER_WRONG = 2;

export const STATE = {
  testId:   null,
  attempt:  null,
  questions: [],          // [{q_num, prompt, options, instruction}]
  idx:      0,
  wrongTries: 0,          // resets per question
  verdicts: new Map(),    // q_num → true|false (canonical, first answer)
  settled:  false,        // current question may advance
};


// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

/**
 * Flatten a test bundle into an ordered question list.
 *
 * Sorted by q_num rather than trusting document order: the converter emits
 * completions before the MCQs that precede them in the audio, so section /
 * exercise order is not question order.
 */
export function flattenQuestions(test) {
  const out = [];
  for (const sec of (test && test.sections) || []) {
    for (const ex of (sec.exercises || [])) {
      const payload = ex.payload || {};
      for (const q of (payload.questions || [])) {
        if (q == null || q.q_num == null) continue;
        out.push({
          q_num:       Number(q.q_num),
          prompt:      q.prompt || '',
          options:     Array.isArray(q.options) ? q.options : [],
          instruction: payload.instruction || '',
        });
      }
    }
  }
  out.sort((a, b) => a.q_num - b.q_num);
  return out;
}

/** Render a gap-fill prompt, marking the blank so the eye lands on it. */
export function promptHtml(prompt) {
  return esc(prompt || '').replace(/_{2,}/g, '<span class="gap">______</span>');
}

/** Is this question answered by picking a letter, or by typing? */
export function isChoice(q) {
  return !!(q && Array.isArray(q.options) && q.options.length > 0);
}

/**
 * What the learner is told after a check.
 *
 * `canonical_correct` (the first answer) drives the progress dot and the final
 * score; `correct` describes the try just made. When they differ the message
 * must say both, or the dot contradicts the tick on screen and the page looks
 * broken.
 */
export function verdictText(res) {
  if (res.revealed) {
    const alts = (res.alternatives || []).filter(Boolean);
    return {
      cls:  'is-wrong',
      html: `<strong>Đáp án: ${esc(res.expected || '')}</strong>`
            + (alts.length ? ` <span class="loop-note">Cũng chấp nhận: ${esc(alts.join(' / '))}</span>` : '')
            + (res.solution && res.solution.why
               ? `<span class="loop-note">${esc(res.solution.why)}</span>` : ''),
    };
  }
  if (res.correct && res.canonical_correct) {
    return { cls: 'is-correct', html: '<strong>Chính xác.</strong>' };
  }
  if (res.correct && !res.canonical_correct) {
    return {
      cls:  'is-correct',
      html: '<strong>Đúng rồi.</strong>'
            + '<span class="loop-note">Câu này tính là chưa bắt được, vì lần trả lời '
            + 'đầu tiên chưa đúng — nhưng giờ tai bạn đã nghe ra.</span>',
    };
  }
  return {
    cls:  'is-wrong',
    html: '<strong>Chưa đúng.</strong>'
          + '<span class="loop-note">Đoạn chứa đáp án đang được phát lặp lại. '
          + 'Nghe kỹ rồi sửa câu trả lời.</span>',
  };
}


// ── DOM ────────────────────────────────────────────────────────────────────

function showError(msg) {
  const el = $('state-error');
  if (el) { el.textContent = msg; el.hidden = false; }
  const load = $('state-loading');
  if (load) load.hidden = true;
}

function renderDots() {
  const wrap = $('lpr-dots');
  if (!wrap) return;
  wrap.innerHTML = STATE.questions.map((q, i) => {
    let cls = 'segment-dot';
    if (i === STATE.idx) cls += ' is-current';
    const v = STATE.verdicts.get(q.q_num);
    if (v === true) cls += ' is-correct';
    else if (v === false) cls += ' is-wrong';
    return `<span class="${cls}" role="listitem"></span>`;
  }).join('');
  const counter = $('lpr-counter');
  if (counter) counter.textContent = `${STATE.idx + 1} / ${STATE.questions.length}`;
}

function currentAnswer() {
  const q = STATE.questions[STATE.idx];
  if (isChoice(q)) {
    const picked = document.querySelector('input[name="lpr-opt"]:checked');
    return picked ? picked.value : '';
  }
  const input = $('lpr-text');
  return input ? input.value.trim() : '';
}

function renderQuestion() {
  const q = STATE.questions[STATE.idx];
  if (!q) return;

  const instr = $('lpr-instruction');
  if (instr) {
    instr.textContent = q.instruction || '';
    instr.hidden = !q.instruction;
  }
  $('lpr-prompt').innerHTML = `<span class="q-num">${q.q_num}.</span> ${promptHtml(q.prompt)}`;

  const area = $('lpr-answer');
  if (isChoice(q)) {
    area.innerHTML = '<div class="lpr-options">' + q.options.map((o) => `
      <label class="lpr-option">
        <input type="radio" name="lpr-opt" value="${esc(o.letter)}" />
        <span class="lpr-option-letter">${esc(o.letter)}</span>
        <span>${esc(o.text)}</span>
      </label>`).join('') + '</div>';
    area.querySelectorAll('input[name="lpr-opt"]').forEach((r) => {
      r.addEventListener('change', () => {
        area.querySelectorAll('.lpr-option').forEach((l) => l.classList.remove('is-picked'));
        if (r.checked && r.parentElement) r.parentElement.classList.add('is-picked');
      });
    });
  } else {
    area.innerHTML = '<input class="answer-input" id="lpr-text" type="text" '
      + 'autocomplete="off" autocapitalize="off" spellcheck="false" '
      + 'placeholder="Câu trả lời của bạn…" />';
    const input = $('lpr-text');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onCheck(); }
    });
    input.focus();
  }

  // Fresh question → whole clip, free scrub. Segment mode is a consequence of
  // getting it wrong, never the starting state: hearing only the answer window
  // first would hand over where to listen.
  const player = $('lpr-player');
  if (player) {
    player.removeAttribute('segment-start');
    player.removeAttribute('segment-end');
    player.removeAttribute('auto-loop');
  }

  $('lpr-verdict').hidden = true;
  $('lpr-check').hidden   = false;
  $('lpr-check').disabled = false;
  $('lpr-reveal').hidden  = true;
  $('lpr-next').hidden    = true;
  STATE.wrongTries = 0;
  STATE.settled    = false;
  renderDots();
}

function loopWindow(win) {
  const player = $('lpr-player');
  if (!player || !win || win.start == null || win.end == null) return;
  player.setAttribute('segment-start', String(win.start));
  player.setAttribute('segment-end',   String(win.end));
  player.setAttribute('auto-loop',     'true');
  // reset() before play(): the component only snaps currentTime into the
  // window when it falls OUTSIDE it, so a learner already paused mid-window
  // would otherwise hear the replay start halfway through the answer.
  if (typeof player.reset === 'function') player.reset();
  if (typeof player.play === 'function') {
    // Autoplay can be refused (no gesture yet on some browsers). The window is
    // still armed, so the play button replays it — swallow rather than throw
    // into the check handler and show a scary error over a working page.
    Promise.resolve(player.play()).catch(() => {});
  }
}

function applyResult(res) {
  const q = STATE.questions[STATE.idx];
  // The dot tracks the CANONICAL verdict, so it never brightens on a retry.
  STATE.verdicts.set(q.q_num, !!res.canonical_correct);

  const v = $('lpr-verdict');
  const { cls, html } = verdictText(res);
  v.className = `lpr-verdict ${cls}`;
  v.innerHTML = html;
  v.hidden = false;

  const done = !!res.correct || !!res.revealed;
  if (done) {
    STATE.settled = true;
    $('lpr-check').hidden  = true;
    $('lpr-reveal').hidden = true;
    $('lpr-next').hidden   = false;
    $('lpr-next').textContent = (STATE.idx >= STATE.questions.length - 1)
      ? 'Xem tổng kết →' : 'Câu tiếp theo →';
    const player = $('lpr-player');
    if (player) player.removeAttribute('auto-loop');   // stop nagging once settled
  } else {
    STATE.wrongTries += 1;
    loopWindow(res.audio_window);
    $('lpr-reveal').hidden = STATE.wrongTries < REVEAL_AFTER_WRONG;
  }
  renderDots();
}

async function onCheck() {
  if (STATE.settled) return;
  const q = STATE.questions[STATE.idx];
  const answer = currentAnswer();
  if (!answer) {
    const v = $('lpr-verdict');
    v.className = 'lpr-verdict';
    v.innerHTML = 'Hãy chọn hoặc nhập câu trả lời trước đã.';
    v.hidden = false;
    return;
  }
  $('lpr-check').disabled = true;
  try {
    const res = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attempt)}/check`,
      { q_num: q.q_num, user_answer: answer },
    );
    applyResult(res);
  } catch (e) {
    showError(`Không chấm được câu này: ${(e && e.message) || e}`);
  } finally {
    $('lpr-check').disabled = false;
  }
}

async function onReveal() {
  const q = STATE.questions[STATE.idx];
  try {
    const res = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attempt)}/check`,
      { q_num: q.q_num, reveal: true },
    );
    applyResult(res);
  } catch (e) {
    showError(`Không lấy được đáp án: ${(e && e.message) || e}`);
  }
}

async function onNext() {
  if (STATE.idx < STATE.questions.length - 1) {
    STATE.idx += 1;
    renderQuestion();
    return;
  }
  await finish();
}

async function finish() {
  try {
    const res = await window.api.post(
      `/api/listening/tests/attempts/${encodeURIComponent(STATE.attempt)}/submit`, {});
    $('lpr-run').hidden = true;
    $('lpr-score').textContent = `${res.score} / ${res.max_score}`;
    $('lpr-summary-list').innerHTML = (res.per_question || []).map((r) => `
      <li class="lpr-summary-item ${r.correct ? 'ok' : 'no'}">
        <span class="mark">${r.correct ? '✓' : '✗'}</span>
        <span><strong>Câu ${esc(r.q_num)}</strong> — ${esc(r.expected || '')}</span>
      </li>`).join('');
    $('lpr-summary').hidden = false;
  } catch (e) {
    showError(`Không nộp được bài: ${(e && e.message) || e}`);
  }
}

async function boot() {
  const id = (new URLSearchParams(location.search).get('id') || '').trim();
  if (!id) { showError('Thiếu mã bài luyện.'); return; }
  STATE.testId = id;
  try {
    const test = await window.api.get(`/api/listening/tests/${encodeURIComponent(id)}`);
    STATE.questions = flattenQuestions(test);
    if (!STATE.questions.length) { showError('Bài này chưa có câu hỏi.'); return; }

    $('lpr-title').textContent = test.title || test.test_id || '';
    $('lpr-subtitle').textContent =
      `${STATE.questions.length} câu · nghe lại thoải mái · chấm ngay từng câu`;

    const player = $('lpr-player');
    if (player && test.audio_url) player.setAttribute('src', test.audio_url);

    const att = await window.api.post(
      `/api/listening/tests/${encodeURIComponent(id)}/attempts`, {});
    STATE.attempt = att.attempt_id || att.id;

    $('state-loading').hidden = true;
    $('lpr-run').hidden = false;
    renderQuestion();
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (msg.includes('404')) showError('Bài luyện không tồn tại hoặc chưa được xuất bản.');
    else if (msg.includes('422')) showError('Bài luyện này chưa có audio sẵn sàng.');
    else showError(`Không tải được bài luyện: ${msg}`);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    $('lpr-check').addEventListener('click', onCheck);
    $('lpr-reveal').addEventListener('click', onReveal);
    $('lpr-next').addEventListener('click', onNext);
    boot();
  });
}
