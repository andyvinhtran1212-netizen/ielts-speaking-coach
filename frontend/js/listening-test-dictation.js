/**
 * frontend/js/listening-test-dictation.js — test-linked dictation
 * (chép chính tả) launched from a listening test card or result panel.
 *
 * Reuses a listening test's audio + per-section transcripts. Unlike the
 * content-based dictation (listening-dictation.js), tests have NO
 * per-sentence audio timing, so:
 *   - the section transcript is split into sentences server-side,
 *   - the learner types each sentence one at a time, and
 *   - the audio plays the WHOLE section with free scrub (no auto-clip).
 *
 * A full test has 4 sections → a section picker; a mini/drill has 1 →
 * it auto-starts. Grading is stateless (POST .../tests/dictation/grade).
 *
 * State machine:
 *   load → [GET /tests/{id}/dictation]
 *     ├─ no sentences anywhere → empty ("chưa có bản gỡ băng")
 *     ├─ 1 section (or ?section=) → start that section
 *     └─ >1 section → section picker → start on pick
 *
 * Per sentence: idle → submitted → next → ... → final → section complete.
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


// ── DOM helpers ─────────────────────────────────────────────────────


const $ = (id) => document.getElementById(id);

const STATE = {
  loading:    $('state-loading'),
  empty:      $('state-empty'),
  error:      $('state-error'),
  picker:     $('section-picker-surface'),
  surface:    $('dictation-surface'),
  completion: $('completion-surface'),
};


// ── Module-level state ──────────────────────────────────────────────


const SESSION = {
  testId:        null,
  testTitle:     '',
  audioUrl:      null,
  sections:      [],          // [{section_num, title, cue_start, sentences:[...]}]
  activeIdx:     null,        // index into sections of the active section
  sentenceIdx:   0,
  results:       [],          // per-sentence {score, is_correct, diff, ...}
  hasSubmitted:  false,
  playerSrcSet:  false,
};


function showState(name) {
  STATE.loading.hidden    = name !== 'loading';
  STATE.empty.hidden      = name !== 'empty';
  STATE.error.hidden      = name !== 'error';
  STATE.picker.hidden     = name !== 'picker';
  STATE.surface.hidden    = name !== 'ready';
  STATE.completion.hidden = name !== 'complete';
}

function showError(msg) {
  STATE.error.textContent = msg;
  showState('error');
}

// Per-sentence errors (empty answer, grade failure) must NOT hide the
// dictation surface — the learner has to stay on the sentence to fix it.
// Render them inline inside the active surface instead of flipping state.
function showInlineError(msg) {
  const el = $('inline-error');
  el.textContent = msg;
  el.hidden = false;
}

function clearInlineError() {
  $('inline-error').hidden = true;
}

function getParamsFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return {
    testId: (sp.get('test_id') || '').trim() || null,
    section: (sp.get('section') || '').trim() || null,
  };
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}


// ── Load test dictation bundle ──────────────────────────────────────


async function loadTest(testId, wantSection) {
  showState('loading');
  try {
    const boot = await window.api.get(
      `/api/listening/tests/${encodeURIComponent(testId)}/dictation`);
    const audioUrl = boot && boot.audio_url;
    if (!audioUrl) {
      showError('Bài test chưa có audio sẵn sàng.');
      return;
    }
    // Keep only sections that actually have transcript sentences.
    const sections = ((boot && boot.sections) || [])
      .filter((s) => Array.isArray(s.sentences) && s.sentences.length > 0);

    if (!sections.length) {
      STATE.empty.innerHTML =
        '<p><strong>Bài này chưa có bản gỡ băng để chép chính tả.</strong></p>'
        + '<p>Cần có transcript của bài nghe trước khi luyện chép chính tả.</p>';
      showState('empty');
      return;
    }

    SESSION.testId     = testId;
    SESSION.testTitle  = (boot && boot.title) || 'Bài nghe';
    SESSION.audioUrl   = audioUrl;
    SESSION.sections   = sections;

    $('test-title').textContent = SESSION.testTitle;

    // ?section=N deep-link, else auto-start when there's only one section.
    const wanted = wantSection != null ? Number(wantSection) : null;
    const wantedIdx = wanted != null
      ? sections.findIndex((s) => Number(s.section_num) === wanted)
      : -1;

    if (wantedIdx >= 0) {
      startSection(wantedIdx);
    } else if (sections.length === 1) {
      startSection(0);
    } else {
      renderSectionPicker();
      showState('picker');
    }
  } catch (e) {
    if ((e && e.message || '').includes('404')) {
      showError('Bài test không tồn tại hoặc chưa được công khai.');
    } else {
      showError('Không tải được bài test. ' + (e && e.message ? e.message : ''));
    }
  }
}


function renderSectionPicker() {
  $('section-picker').innerHTML = SESSION.sections.map((s, i) => {
    const label = s.title || `Section ${s.section_num}`;
    const sub = `${s.sentences.length} câu`
      + (s.cue_start != null ? ` · bắt đầu ~${fmtTime(s.cue_start)}` : '');
    return `<button class="section-chip" type="button" data-idx="${i}">`
      + `${escapeHtml(label)}<span class="chip-sub">${escapeHtml(sub)}</span></button>`;
  }).join('');
}


// ── Section lifecycle ───────────────────────────────────────────────


function startSection(idx) {
  const section = SESSION.sections[idx];
  if (!section) return;
  SESSION.activeIdx    = idx;
  SESSION.sentenceIdx  = 0;
  SESSION.results      = new Array(section.sentences.length).fill(null);
  SESSION.hasSubmitted = false;

  const player = $('player');
  if (!SESSION.playerSrcSet) {
    player.setAttribute('src', SESSION.audioUrl);
    SESSION.playerSrcSet = true;
  }
  try { player.pause(); } catch { /* swallow */ }

  const many = SESSION.sections.length > 1;
  $('active-section-label').textContent = many
    ? (section.title || `Section ${section.section_num}`)
    : 'Câu';

  // Hint depends on whether this section has per-sentence audio windows.
  const hint = $('section-hint');
  if (sectionHasTiming(section)) {
    hint.textContent = 'Mỗi câu tự phát đúng đoạn audio (tự lặp lại) — bấm ▶ để nghe.';
    hint.hidden = false;
  } else if (section.cue_start != null) {
    hint.textContent =
      `Phần này bắt đầu khoảng ${fmtTime(section.cue_start)} trong audio — tua tới đó để nghe.`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }

  $('btn-other-section').hidden = !many;

  applySentenceAudio();
  renderDots();
  resetAnswerSurface();
  showState('ready');
}


function sectionHasTiming(section) {
  return !!(section && Array.isArray(section.timings)
    && section.timings.some((t) => t && t.start != null));
}


// Clip the audio to the current sentence's turn window when timing exists;
// otherwise leave the whole section scrubbable (no segment bounds).
function applySentenceAudio() {
  const section = SESSION.sections[SESSION.activeIdx];
  const player = $('player');
  if (!player) return;
  const t = section && Array.isArray(section.timings)
    ? section.timings[SESSION.sentenceIdx] : null;
  if (t && t.start != null && t.end != null) {
    player.setAttribute('segment-start', String(t.start));
    player.setAttribute('segment-end', String(t.end));
    player.setAttribute('auto-loop', 'true');
  } else {
    player.removeAttribute('segment-start');
    player.removeAttribute('segment-end');
    player.removeAttribute('auto-loop');
  }
  try { player.pause(); } catch { /* swallow */ }
}


function renderDots() {
  const section = SESSION.sections[SESSION.activeIdx];
  const wrap = $('segment-dots');
  wrap.innerHTML = section.sentences.map((_, i) => {
    const result = SESSION.results[i];
    let cls = 'segment-dot';
    if (i === SESSION.sentenceIdx) cls += ' is-current';
    if (result) {
      if (result.score >= 1.0)      cls += ' is-correct';
      else if (result.score >= 0.5) cls += ' is-partial';
      else                          cls += ' is-incorrect';
    }
    return `<span class="${cls}" role="listitem" aria-label="Câu ${i + 1}"></span>`;
  }).join('');
  $('progress-counter').textContent =
    `${SESSION.sentenceIdx + 1} / ${section.sentences.length}`;
}


function resetAnswerSurface() {
  $('answer').value = '';
  $('answer').disabled = false;
  $('btn-submit').hidden = false;
  $('btn-submit').disabled = false;
  $('btn-reset').hidden = true;
  $('btn-next').hidden = true;
  $('score-pill').hidden = true;
  $('diff-block').hidden = true;
  SESSION.hasSubmitted = false;
  STATE.error.hidden = true;
  clearInlineError();
}


// ── Submit attempt ──────────────────────────────────────────────────


async function submitAttempt() {
  const section = SESSION.sections[SESSION.activeIdx];
  if (!section) return;
  const userText = $('answer').value;
  if (!userText.trim()) {
    showInlineError('Hãy gõ câu trả lời trước khi kiểm tra.');
    return;
  }
  clearInlineError();
  $('btn-submit').disabled = true;
  $('answer').disabled = true;

  try {
    const result = await window.api.post('/api/listening/tests/dictation/grade', {
      test_id:         SESSION.testId,
      section_num:     section.section_num,
      sentence_idx:    SESSION.sentenceIdx,
      user_transcript: userText,
    });

    SESSION.results[SESSION.sentenceIdx] = {
      score:         result.score,
      is_correct:    result.is_correct,
      correct_words: result.correct_words,
      total_words:   result.total_words,
      diff:          result.diff,
      user_text:     userText,
    };
    SESSION.hasSubmitted = true;

    renderResult(result);
    renderDots();

    $('btn-submit').hidden = true;
    $('btn-reset').hidden = false;
    $('btn-next').hidden = false;
    $('btn-next').textContent =
      SESSION.sentenceIdx + 1 < section.sentences.length
        ? 'Câu tiếp theo →'
        : 'Xem kết quả';
  } catch (e) {
    // Grade failure — stay on the sentence so the learner can retry.
    showInlineError('Không chấm được câu trả lời. ' + (e && e.message ? e.message : ''));
    $('btn-submit').disabled = false;
    $('answer').disabled = false;
  }
}


function renderResult(result) {
  const pct = Math.round((result.score || 0) * 100);
  const pill = $('score-pill');
  pill.textContent = `${pct}%  ·  ${result.correct_words}/${result.total_words}`;
  pill.classList.toggle('is-perfect', result.is_correct);
  pill.hidden = false;

  $('diff-label').textContent = 'Đối chiếu với bản gỡ băng';
  $('diff-render').innerHTML = (result.diff || []).map(renderDiffToken).join('');
  $('diff-block').hidden = false;
}


function renderDiffToken(op) {
  switch (op.op) {
    case 'match':
      return `<span class="diff-token diff-token--match">${escapeHtml(op.actual || op.expected || '')}</span>`;
    case 'miss':
      return `<span class="diff-token diff-token--miss" title="Thiếu từ">${escapeHtml(op.expected || '')}</span>`;
    case 'wrong':
      return `<span class="diff-token diff-token--wrong" title="Sai từ">`
        + `<span class="strike">${escapeHtml(op.actual || '')}</span>`
        + `${escapeHtml(op.expected || '')}`
        + `</span>`;
    case 'extra':
      return `<span class="diff-token diff-token--extra" title="Thừa từ">${escapeHtml(op.actual || '')}</span>`;
    default:
      return '';
  }
}


// ── Advance ─────────────────────────────────────────────────────────


function advanceSentenceOrComplete() {
  const section = SESSION.sections[SESSION.activeIdx];
  if (SESSION.sentenceIdx + 1 < section.sentences.length) {
    SESSION.sentenceIdx += 1;
    applySentenceAudio();
    resetAnswerSurface();
    renderDots();
    $('answer').focus();
    return;
  }
  renderCompletion();
  showState('complete');
}


function renderCompletion() {
  const section = SESSION.sections[SESSION.activeIdx];
  const graded = SESSION.results.filter(Boolean);
  const totalScore = graded.length
    ? graded.reduce((acc, r) => acc + (r.score || 0), 0) / graded.length
    : 0;
  $('completion-total').textContent = `${Math.round(totalScore * 100)}%`;

  $('segment-summary').innerHTML = section.sentences.map((sentence, i) => {
    const r = SESSION.results[i];
    if (!r) {
      return `<li>
        <div class="row">
          <span class="seg-label">Câu ${i + 1}</span>
          <span class="seg-score is-low">Chưa làm</span>
        </div>
        <div class="seg-transcript">${escapeHtml(sentence)}</div>
      </li>`;
    }
    const pct = Math.round((r.score || 0) * 100);
    let cls = '';
    if (r.score < 0.5) cls = 'is-low';
    else if (r.score < 1.0) cls = 'is-partial';
    return `<li>
      <div class="row">
        <span class="seg-label">Câu ${i + 1}</span>
        <span class="seg-score ${cls}">${pct}%  ·  ${r.correct_words}/${r.total_words}</span>
      </div>
      <div class="seg-transcript">${escapeHtml(sentence)}</div>
    </li>`;
  }).join('');

  $('transcript-review').innerHTML = section.sentences.map((sentence, i) => {
    const r = SESSION.results[i];
    return `<div class="review-segment">
      <span class="review-label">Câu ${i + 1}</span>
      <div class="review-reference">${escapeHtml(sentence)}</div>
      <div>${(r && r.diff ? r.diff.map(renderDiffToken).join('') : '<em style="color:var(--av-text-muted)">Chưa làm</em>')}</div>
    </div>`;
  }).join('');
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


// ── Wire ────────────────────────────────────────────────────────────


document.addEventListener('DOMContentLoaded', () => {
  const { testId, section } = getParamsFromUrl();
  if (!testId) {
    showState('empty');
    return;
  }
  loadTest(testId, section);

  $('section-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.section-chip');
    if (!btn) return;
    startSection(Number(btn.getAttribute('data-idx')));
  });

  $('btn-submit').addEventListener('click', submitAttempt);

  $('btn-reset').addEventListener('click', () => {
    // "Thử lại" — resubmit the current sentence without advancing.
    $('answer').disabled = false;
    $('btn-submit').hidden = false;
    $('btn-submit').disabled = false;
    $('btn-reset').hidden = true;
    $('btn-next').hidden = true;
    $('score-pill').hidden = true;
    $('diff-block').hidden = true;
    SESSION.hasSubmitted = false;
    $('answer').focus();
  });

  $('btn-next').addEventListener('click', advanceSentenceOrComplete);

  $('btn-restart').addEventListener('click', () => {
    if (SESSION.activeIdx != null) startSection(SESSION.activeIdx);
  });

  $('btn-other-section').addEventListener('click', () => {
    renderSectionPicker();
    showState('picker');
  });

  // Completion tab switcher.
  $('tab-results').addEventListener('click', () => {
    $('tab-results').classList.add('is-active');
    $('tab-results').setAttribute('aria-selected', 'true');
    $('tab-transcript').classList.remove('is-active');
    $('tab-transcript').setAttribute('aria-selected', 'false');
    $('panel-results').hidden = false;
    $('panel-transcript').hidden = true;
  });
  $('tab-transcript').addEventListener('click', () => {
    $('tab-transcript').classList.add('is-active');
    $('tab-transcript').setAttribute('aria-selected', 'true');
    $('tab-results').classList.remove('is-active');
    $('tab-results').setAttribute('aria-selected', 'false');
    $('panel-results').hidden = true;
    $('panel-transcript').hidden = false;
  });

  // Ctrl/Cmd+Enter — submit if not yet submitted, else advance.
  $('answer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!SESSION.hasSubmitted) submitAttempt();
      else advanceSentenceOrComplete();
    }
  });
});
