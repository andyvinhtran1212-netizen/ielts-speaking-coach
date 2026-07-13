/**
 * frontend/js/listening-dictation.js — Sprint 11.3 (DEBT-LISTENING-
 * MODULE 3/5).
 *
 * Segmented dictation iterator. Replaces the Sprint 11.2 single-pass
 * page after Andy's 2026-05-18 dogfood surfaced falsification #62 —
 * IELTS dictation practice is sentence-by-sentence (DailyDictation
 * standard), not whole-clip single submission.
 *
 * State machine:
 *
 *   load → [combined boot fetch: content + dictation exercises]
 *     ├─ no segments     → empty state ("Bài này chưa được phân câu")
 *     └─ segments loaded → segment 0:
 *         idle → recording (n/a — pre-rendered audio) → submitted →
 *         next → segment 1 → ... → final → completion
 *
 * Per-segment lifecycle:
 *   1. Audio player set to segment-start / segment-end / auto-loop
 *   2. User listens (replays as needed), types into textarea
 *   3. "Kiểm tra" → POST /api/listening/attempts with segment_idx
 *   4. Server returns diff; client renders + dot turns green/amber/red
 *   5. "Câu tiếp theo →" advances segment_idx; final segment → completion
 *
 * Sprint 10.3 first-attempt rule preserved: only the first submission
 * per (user, exercise, segment) is canonical. UI labels subsequent
 * submissions as "lần làm thêm".
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
  surface:    $('dictation-surface'),
  completion: $('completion-surface'),
};


// ── Module-level state (single page = single in-flight session) ──────


const SESSION = {
  contentId:     null,
  contentTitle:  '',
  exerciseId:    null,
  segments:      [],          // [{idx, start_sec, end_sec, transcript}]
  segmentIdx:    0,
  listenCount:   0,           // resets per segment
  results:       [],          // per-segment {score, is_correct, diff, user_text}
  hasSubmitted:  false,       // gates Next button enable
};


function showState(name) {
  STATE.loading.hidden    = name !== 'loading';
  STATE.empty.hidden      = name !== 'empty';
  STATE.error.hidden      = name !== 'error';
  STATE.surface.hidden    = name !== 'ready';
  STATE.completion.hidden = name !== 'complete';
}

function showError(msg) {
  STATE.error.textContent = msg;
  showState('error');
}

function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}


// ── Content + exercise load ─────────────────────────────────────────


async function loadContentAndExercise(contentId) {
  showState('loading');
  try {
    const boot = await window.api.get(`/api/listening/dictation/${encodeURIComponent(contentId)}/boot`);
    const content = boot && boot.content;
    if (!content || !content.audio_signed_url) {
      showError('Bài nghe không khả dụng (thiếu audio URL).');
      return;
    }
    const exercises = (boot && boot.exercises) || [];
    const dictation = exercises.find((e) => Array.isArray(e.segments) && e.segments.length > 0);

    if (!dictation) {
      STATE.empty.innerHTML =
        '<p><strong>Bài này chưa được phân câu.</strong></p>'
        + '<p>Quản trị viên cần dùng trang Phân câu để chia bản gỡ băng thành các câu nhỏ.</p>';
      showState('empty');
      return;
    }

    // Sort segments by idx defensively (server should return ordered).
    const segments = dictation.segments.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0));

    SESSION.contentId    = contentId;
    SESSION.contentTitle = content.title || 'Bài nghe';
    SESSION.exerciseId   = dictation.id;
    SESSION.segments     = segments;
    SESSION.segmentIdx   = 0;
    SESSION.results      = new Array(segments.length).fill(null);
    SESSION.hasSubmitted = false;

    $('content-title').textContent = SESSION.contentTitle;
    renderMeta(content);
    renderDots();

    const player = $('player');
    player.setAttribute('refetch-url', `/api/listening/content/${contentId}`);
    player.setAttribute('src', content.audio_signed_url);
    applySegmentToPlayer();

    resetAnswerSurface();
    showState('ready');
  } catch (e) {
    if ((e && e.message || '').includes('404')) {
      showError('Bài nghe không tồn tại hoặc chưa được công khai.');
    } else {
      showError('Không tải được bài nghe. ' + (e && e.message ? e.message : ''));
    }
  }
}


function renderMeta(row) {
  const meta = $('content-meta');
  const pills = [];
  if (row.accent_tag)    pills.push(row.accent_tag.replace('_', ' '));
  if (row.cefr_level)    pills.push(row.cefr_level);
  if (row.ielts_section) pills.push(`Section ${row.ielts_section}`);
  if (Array.isArray(row.topic_tags)) {
    row.topic_tags.slice(0, 3).forEach((t) => pills.push(t));
  }
  meta.innerHTML = pills.map((p) =>
    `<span class="pill">${escapeHtml(String(p))}</span>`
  ).join('');
  meta.hidden = pills.length === 0;
}


function renderDots() {
  const wrap = $('segment-dots');
  wrap.innerHTML = SESSION.segments.map((_, i) => {
    const result = SESSION.results[i];
    let cls = 'segment-dot';
    if (i === SESSION.segmentIdx) cls += ' is-current';
    if (result) {
      if (result.score >= 1.0)         cls += ' is-correct';
      else if (result.score >= 0.5)    cls += ' is-partial';
      else                             cls += ' is-incorrect';
    }
    return `<span class="${cls}" role="listitem" aria-label="Câu ${i + 1}"></span>`;
  }).join('');
  $('progress-counter').textContent =
    `${SESSION.segmentIdx + 1} / ${SESSION.segments.length}`;
}


// ── Segment-to-player wiring ────────────────────────────────────────


function applySegmentToPlayer() {
  const seg = SESSION.segments[SESSION.segmentIdx];
  if (!seg) return;
  const player = $('player');
  player.setAttribute('segment-start', String(seg.start_sec));
  player.setAttribute('segment-end',   String(seg.end_sec));
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
  SESSION.listenCount = 0;
  STATE.error.hidden = true;
}


// ── Submit attempt ──────────────────────────────────────────────────


async function submitAttempt() {
  if (!SESSION.exerciseId) return;
  const userText = $('answer').value;
  if (!userText.trim()) {
    showError('Hãy gõ câu trả lời trước khi kiểm tra.');
    return;
  }
  STATE.error.hidden = true;
  $('btn-submit').disabled = true;
  $('answer').disabled = true;

  try {
    const result = await window.api.post('/api/listening/attempts', {
      exercise_id:     SESSION.exerciseId,
      content_id:      SESSION.contentId,
      mode:            'dictation',
      segment_idx:     SESSION.segmentIdx,
      user_transcript: userText,
      listen_count:    Math.max(1, SESSION.listenCount),
    });

    SESSION.results[SESSION.segmentIdx] = {
      score:           result.score,
      is_correct:      result.is_correct,
      correct_words:   result.correct_words,
      total_words:     result.total_words,
      diff:            result.diff,
      user_text:       userText,
      is_first_attempt: result.is_first_attempt,
    };
    SESSION.hasSubmitted = true;

    renderResult(result);
    renderDots();

    // Hide submit, show next (or final-results) + reset.
    $('btn-submit').hidden = true;
    $('btn-reset').hidden = false;
    $('btn-next').hidden = false;
    $('btn-next').textContent =
      SESSION.segmentIdx + 1 < SESSION.segments.length
        ? 'Câu tiếp theo →'
        : 'Xem kết quả';
  } catch (e) {
    showError('Không gửi được câu trả lời. ' + (e && e.message ? e.message : ''));
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

  const labelEl = $('diff-label');
  labelEl.textContent = result.is_first_attempt
    ? 'Đối chiếu (lần làm đầu — đã ghi điểm chính thức)'
    : 'Đối chiếu (lần làm thêm — điểm chính thức giữ ở lần đầu)';

  const renderEl = $('diff-render');
  renderEl.innerHTML = (result.diff || []).map(renderDiffToken).join('');
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


function advanceSegmentOrComplete() {
  if (SESSION.segmentIdx + 1 < SESSION.segments.length) {
    SESSION.segmentIdx += 1;
    applySegmentToPlayer();
    resetAnswerSurface();
    renderDots();
    // Auto-pause the previous segment's player + scroll back into view.
    const p = $('player');
    try { p.pause(); p.reset(); } catch { /* swallow */ }
    $('answer').focus();
    return;
  }
  // Final segment graded → completion view.
  renderCompletion();
  showState('complete');
}


function renderCompletion() {
  const graded = SESSION.results.filter(Boolean);
  const totalScore = graded.length
    ? graded.reduce((acc, r) => acc + (r.score || 0), 0) / graded.length
    : 0;
  $('completion-total').textContent = `${Math.round(totalScore * 100)}%`;

  // Per-segment summary (Results tab default).
  $('segment-summary').innerHTML = SESSION.segments.map((seg, i) => {
    const r = SESSION.results[i];
    if (!r) {
      return `<li>
        <div class="row">
          <span class="seg-label">Câu ${i + 1}</span>
          <span class="seg-score is-low">Chưa làm</span>
        </div>
        <div class="seg-transcript">${escapeHtml(seg.transcript)}</div>
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
      <div class="seg-transcript">${escapeHtml(seg.transcript)}</div>
    </li>`;
  }).join('');

  // Full transcript review (side-by-side ref vs user submission).
  $('transcript-review').innerHTML = SESSION.segments.map((seg, i) => {
    const r = SESSION.results[i];
    return `<div class="review-segment">
      <span class="review-label">Câu ${i + 1}</span>
      <div class="review-reference">${escapeHtml(seg.transcript)}</div>
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
  const contentId = getContentIdFromUrl();
  if (!contentId) {
    showState('empty');
    return;
  }
  loadContentAndExercise(contentId);

  $('player').addEventListener('av-audio-play', () => { SESSION.listenCount += 1; });

  $('btn-submit').addEventListener('click', submitAttempt);

  $('btn-reset').addEventListener('click', () => {
    // "Thử lại" — let the user resubmit the current segment without
    // advancing. Subsequent submission stores as is_first_attempt=false.
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

  $('btn-next').addEventListener('click', advanceSegmentOrComplete);

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

  $('btn-restart').addEventListener('click', () => {
    SESSION.segmentIdx = 0;
    SESSION.results = new Array(SESSION.segments.length).fill(null);
    applySegmentToPlayer();
    resetAnswerSurface();
    renderDots();
    showState('ready');
  });

  // Ctrl/Cmd+Enter — context-sensitive: submit if not yet submitted,
  // else advance to next segment.
  $('answer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!SESSION.hasSubmitted) submitAttempt();
      else advanceSegmentOrComplete();
    }
  });
});
