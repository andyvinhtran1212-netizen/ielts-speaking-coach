/**
 * frontend/js/listening-dictation.js — Sprint 11.2 (DEBT-LISTENING-MODULE 2/5).
 *
 * Glue script for /pages/listening-dictation.html. Three responsibilities:
 *
 *   1. Bootstrap Supabase from /config (so api.js can attach the bearer
 *      token) — same lazy pattern as the speaking page.
 *   2. Read ?content_id from the URL, fetch /api/listening/content/{id},
 *      hand the signed URL to the <audio-player>.
 *   3. Wire the "Kiểm tra" button to POST /api/listening/attempts and
 *      render the word-level diff back to the user.
 *
 * Sprint 11.0 §6 dictation UX:
 *   - User can replay unlimited (audio player tracks listen_count via
 *     av-audio-play events).
 *   - "Kiểm tra" submits; server runs grader; client renders diff +
 *     score pill. "Thử lại" re-opens the textarea for another attempt
 *     (server stores all attempts but flags is_first_attempt).
 *
 * No external dependencies beyond the standard /js/api.js helper.
 */

// Canonical Supabase project ref (matches vocabulary.html, speaking.html
// et al). When this rotates, every page bootstrap rotates together.
const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

// ── DOM helpers ─────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const STATE = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  surface: $('dictation-surface'),
};

let _listenCount = 0;
let _currentContentId = null;

function showState(name) {
  STATE.loading.hidden = name !== 'loading';
  STATE.empty.hidden   = name !== 'empty';
  STATE.error.hidden   = name !== 'error';
  STATE.surface.hidden = name !== 'ready';
}

function showError(msg) {
  STATE.error.textContent = msg;
  showState('error');
}

function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}

// ── Content load ────────────────────────────────────────────────────

async function loadContent(contentId) {
  showState('loading');
  try {
    const data = await window.api.get(`/api/listening/content/${contentId}`);
    if (!data || !data.audio_signed_url) {
      showError('Bài nghe không khả dụng (thiếu audio URL).');
      return;
    }
    _currentContentId = contentId;
    _listenCount = 0;

    $('content-title').textContent = data.title || 'Bài nghe';
    renderMeta(data);

    const player = $('player');
    if (data.audio_duration_seconds) {
      player.setAttribute('duration-hint', String(data.audio_duration_seconds));
    }
    player.setAttribute('refetch-url', `/api/listening/content/${contentId}`);
    player.setAttribute('src', data.audio_signed_url);

    // Reset submission state for the new content.
    $('answer').value = '';
    $('answer').disabled = false;
    $('btn-submit').disabled = false;
    $('btn-reset').hidden = true;
    $('score-pill').hidden = true;
    $('diff-block').hidden = true;

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

// ── Submit + render diff ────────────────────────────────────────────

async function submitAttempt() {
  if (!_currentContentId) return;
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
      content_id: _currentContentId,
      mode: 'dictation',
      user_transcript: userText,
      listen_count: Math.max(1, _listenCount),
    });
    renderResult(result);
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

  $('btn-reset').hidden = false;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Wire ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const contentId = getContentIdFromUrl();
  if (!contentId) {
    showState('empty');
    return;
  }
  loadContent(contentId);

  $('player').addEventListener('av-audio-play', () => { _listenCount += 1; });

  $('btn-submit').addEventListener('click', submitAttempt);

  $('btn-reset').addEventListener('click', () => {
    $('answer').disabled = false;
    $('btn-submit').disabled = false;
    $('btn-reset').hidden = true;
    $('score-pill').hidden = true;
    $('diff-block').hidden = true;
    $('answer').focus();
  });

  // Ctrl/Cmd+Enter submits — keyboardy IELTS practice convention.
  $('answer').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitAttempt();
    }
  });
});
