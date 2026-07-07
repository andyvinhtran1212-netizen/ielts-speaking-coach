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
  results:       [],          // per-sentence {score, is_correct, diff, listen_count, time_seconds, ...}
  hasSubmitted:  false,
  playerSrcSet:  false,
  // Report tracking (for the completion summary).
  startedAt:     null,        // Date when the section began (epoch ms)
  sentenceStartedAt: null,    // Date the current sentence began (epoch ms)
  listenCount:   0,           // audio plays for the CURRENT sentence (resets per sentence)
  report:        null,        // server report from POST .../dictation/session
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
  SESSION.startedAt    = Date.now();
  SESSION.sentenceStartedAt = Date.now();
  SESSION.listenCount  = 0;
  SESSION.report       = null;

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
  renderSentenceHint();
}


// Light proper-noun spelling hints for the current sentence — names are
// the hardest thing to spell from audio, so we surface them gently.
function renderSentenceHint() {
  const el = $('sentence-hint');
  if (!el) return;
  const section = SESSION.sections[SESSION.activeIdx];
  const names = section && Array.isArray(section.hints)
    ? section.hints[SESSION.sentenceIdx] : null;
  if (names && names.length) {
    el.innerHTML = '<span class="hint-label">Tên riêng</span>'
      + names.map((n) => `<span class="hint-name">${escapeHtml(n)}</span>`).join('');
    el.hidden = false;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
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
      listen_count:  SESSION.listenCount,
      time_seconds:  Math.max(0, Math.round((Date.now() - (SESSION.sentenceStartedAt || Date.now())) / 1000)),
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
  const diff = result.diff || [];
  $('diff-render').innerHTML = diff.map(renderDiffToken).join('');
  $('diff-block').hidden = false;
  // Only explain the filler styling when a forgiven filler is actually shown.
  $('diff-legend').hidden = !diff.some((d) => d.filler);
}


function renderDiffToken(op) {
  // Forgiven hesitations (um / er / oh) render softly — they don't count
  // against the score, so they read as optional, not as an error.
  if (op.filler) {
    const word = op.op === 'extra' ? op.actual : op.expected;
    return `<span class="diff-token diff-token--filler" title="Ngập ngừng — có thể bỏ qua">${escapeHtml(word || '')}</span>`;
  }
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
    SESSION.sentenceStartedAt = Date.now();   // reset per-sentence timing
    SESSION.listenCount = 0;
    applySentenceAudio();
    resetAnswerSurface();
    renderDots();
    $('answer').focus();
    return;
  }
  submitSessionAndRenderReport();
}


// Persist the finished section + fetch the canonical report, then render it.
// Falls back to a client-only report if the save fails (never blocks results).
async function submitSessionAndRenderReport() {
  const section = SESSION.sections[SESSION.activeIdx];
  const sentences = SESSION.results
    .map((r, i) => (r ? {
      sentence_idx:    i,
      user_transcript: r.user_text || '',
      listen_count:    r.listen_count || 0,
      time_seconds:    r.time_seconds || 0,
    } : null))
    .filter(Boolean);
  const totalTime = SESSION.startedAt
    ? Math.max(0, Math.round((Date.now() - SESSION.startedAt) / 1000)) : null;

  renderCompletion(null);          // render immediately from client data
  showState('complete');

  try {
    SESSION.report = await window.api.post('/api/listening/tests/dictation/session', {
      test_id:            SESSION.testId,
      section_num:        section.section_num,
      started_at:         SESSION.startedAt ? new Date(SESSION.startedAt).toISOString() : null,
      total_time_seconds: totalTime,
      sentences,
    });
    renderReportStats(SESSION.report);   // upgrade tiles/trends with server truth
  } catch (e) {
    // Keep the client-side report; just note it wasn't saved.
    const el = $('report-save-note');
    if (el) { el.textContent = 'Không lưu được kết quả (vẫn xem được bên dưới).'; el.hidden = false; }
  }
}


function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

// Client-side roll-up mirroring the server aggregate — so the report is
// populated instantly; the server response then confirms/overrides it.
function aggregateClient() {
  const graded = SESSION.results.filter(Boolean);
  const n = graded.length || 1;
  const norm = (w) => String(w || '').toLowerCase().replace(/[.,!?;:'"…]+$/, '').trim();
  const op = { miss: 0, wrong: 0, extra: 0 };
  const missed = {};
  const wronged = {};
  graded.forEach((r) => (r.diff || []).forEach((o) => {
    if (o.filler || op[o.op] == null) return;
    op[o.op] += 1;
    if (o.op === 'miss' && o.expected) { const k = norm(o.expected); if (k) missed[k] = (missed[k] || 0) + 1; }
    else if (o.op === 'wrong' && o.expected) { const k = norm(o.expected); if (k) wronged[k] = (wronged[k] || 0) + 1; }
  }));
  const top = (m, label) => Object.entries(m)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8).map(([w, c]) => ({ [label]: w, count: c }));
  return {
    total_sentences: graded.length,
    correct_count:   graded.filter((r) => (r.score || 0) >= 1.0).length,
    accuracy:        graded.reduce((a, r) => a + (r.score || 0), 0) / n,
    total_words:     graded.reduce((a, r) => a + (r.total_words || 0), 0),
    correct_words:   graded.reduce((a, r) => a + (r.correct_words || 0), 0),
    error_trends:    { op_counts: op, top_missed: top(missed, 'word'), top_wrong: top(wronged, 'expected') },
  };
}

// Fill the stat tiles + error-trend panel from a report (server or client).
function renderReportStats(data) {
  if (!data) return;
  const pct = Math.round((data.accuracy || 0) * 100);
  $('stat-accuracy').textContent = `${pct}%`;
  $('stat-sentences').textContent = `${data.correct_count}/${data.total_sentences}`;
  $('stat-words').textContent = `${data.correct_words}/${data.total_words}`;
  const totalTime = (SESSION.report && SESSION.report.total_time_seconds != null)
    ? SESSION.report.total_time_seconds
    : (SESSION.startedAt ? Math.round((Date.now() - SESSION.startedAt) / 1000) : null);
  $('stat-time').textContent = totalTime != null ? fmtDuration(totalTime) : '—';

  const et = data.error_trends || {};
  const oc = et.op_counts || {};
  $('trend-ops').innerHTML =
    `<span class="trend-op trend-op--miss">Thiếu <strong>${oc.miss || 0}</strong></span>`
    + `<span class="trend-op trend-op--wrong">Sai <strong>${oc.wrong || 0}</strong></span>`
    + `<span class="trend-op trend-op--extra">Thừa <strong>${oc.extra || 0}</strong></span>`;
  const chips = (arr, key) => (arr && arr.length)
    ? arr.map((w) => `<span class="trend-word">${escapeHtml(w[key])}<span class="trend-word-n">${w.count}</span></span>`).join('')
    : '<span class="trend-empty">—</span>';
  $('trend-missed').innerHTML = chips(et.top_missed, 'word');
  $('trend-wrong').innerHTML = chips(et.top_wrong, 'expected');
}

function renderCompletion(report) {
  const section = SESSION.sections[SESSION.activeIdx];
  renderReportStats(report || aggregateClient());

  // Per-sentence review: reference + word diff + a "báo lỗi" button.
  $('transcript-review').innerHTML = section.sentences.map((sentence, i) => {
    const r = SESSION.results[i];
    const pct = r ? Math.round((r.score || 0) * 100) : null;
    let cls = 'is-low';
    if (r && r.score >= 1.0) cls = 'is-perfect';
    else if (r && r.score >= 0.5) cls = 'is-partial';
    return `<div class="review-segment">
      <div class="review-head">
        <span class="review-label">Câu ${i + 1}</span>
        ${pct != null ? `<span class="review-score ${cls}">${pct}% · ${r.correct_words}/${r.total_words}</span>` : '<span class="review-score is-low">Chưa làm</span>'}
        <button class="review-flag" type="button" data-flag-idx="${i}" title="Báo lỗi câu này" aria-label="Báo lỗi câu ${i + 1}">⚑ Báo lỗi</button>
      </div>
      <div class="review-reference">${escapeHtml(sentence)}</div>
      <div class="review-diff">${(r && r.diff ? r.diff.map(renderDiffToken).join('') : '<em style="color:var(--av-text-muted)">Chưa làm</em>')}</div>
    </div>`;
  }).join('');
}


// ── Flag (báo lỗi nội dung) ─────────────────────────────────────────


let _flagIdx = null;

function openFlagModal(idx) {
  _flagIdx = idx;
  $('flag-title').textContent = `Báo lỗi — câu ${idx + 1}`;
  $('flag-category').value = '';
  $('flag-note').value = '';
  $('flag-error').hidden = true;
  document.querySelectorAll('.flag-chip').forEach((c) => c.classList.remove('is-selected'));
  $('flag-modal').hidden = false;
  $('flag-note').focus();
}

function closeFlagModal() {
  $('flag-modal').hidden = true;
  _flagIdx = null;
}

async function submitFlag() {
  const idx = _flagIdx;
  const section = SESSION.sections[SESSION.activeIdx];
  const category = $('flag-category').value || null;
  const note = $('flag-note').value.trim();
  if (!category && !note) {
    $('flag-error').textContent = 'Chọn loại lỗi hoặc nhập mô tả.';
    $('flag-error').hidden = false;
    return;
  }
  $('flag-submit').disabled = true;
  try {
    await window.api.post('/api/listening/tests/dictation/flag', {
      test_id:      SESSION.testId,
      section_num:  section.section_num,
      sentence_idx: idx,
      category,
      note,
    });
    closeFlagModal();
    const btn = document.querySelector(`[data-flag-idx="${idx}"]`);
    if (btn) { btn.textContent = '✓ Đã báo lỗi'; btn.disabled = true; }
  } catch (e) {
    $('flag-error').textContent = 'Không gửi được. ' + (e && e.message ? e.message : '');
    $('flag-error').hidden = false;
  } finally {
    $('flag-submit').disabled = false;
  }
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

  // Count audio plays for the current sentence (for the report's listen stat).
  $('player').addEventListener('av-audio-play', () => { SESSION.listenCount += 1; });

  // "Báo lỗi" per sentence in the completion review.
  $('transcript-review').addEventListener('click', (e) => {
    const b = e.target.closest('[data-flag-idx]');
    if (b && !b.disabled) openFlagModal(Number(b.getAttribute('data-flag-idx')));
  });
  $('flag-cancel').addEventListener('click', closeFlagModal);
  $('flag-submit').addEventListener('click', submitFlag);
  // Dismiss the modal on overlay click or Escape.
  $('flag-modal').addEventListener('click', (e) => {
    if (e.target === $('flag-modal')) closeFlagModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('flag-modal').hidden) closeFlagModal();
  });
  $('flag-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.flag-chip');
    if (!chip) return;
    document.querySelectorAll('.flag-chip').forEach((c) => c.classList.remove('is-selected'));
    chip.classList.add('is-selected');
    $('flag-category').value = chip.getAttribute('data-cat') || '';
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

  // Ctrl/Cmd+Enter — submit if not yet submitted, else advance.
  $('answer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!SESSION.hasSubmitted) submitAttempt();
      else advanceSentenceOrComplete();
    }
  });
});
