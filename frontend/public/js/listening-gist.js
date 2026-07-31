/**
 * frontend/js/listening-gist.js — Sprint 11.4 (DEBT-LISTENING-MODULE 4/5).
 *
 * User-facing Gist exercise surface. Loads content + published gist
 * exercise, shows prompt, accepts free-text response, POSTs to
 * /api/listening/attempts with mode=gist. Server uses Haiku (with
 * keyword fallback) to grade.
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
  promptText:   '',
  listenCount:  0,
  hasSubmitted: false,
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  surface: $('gist-surface'),
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
      `/api/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=gist`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    if (!ex) {
      VIEWS.empty.innerHTML =
        '<p><strong>Bài này chưa có dạng Nghe ý chính.</strong></p>'
        + '<p>Quản trị viên cần soạn câu hỏi + đáp án mẫu trước.</p>';
      showState('empty');
      return;
    }

    STATE.contentId = contentId;
    STATE.exerciseId = ex.id;
    STATE.promptText = (ex.payload && ex.payload.prompt_text) || 'Bạn nghe được gì?';
    STATE.listenCount = 0;
    STATE.hasSubmitted = false;

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
    $('prompt-box').textContent = STATE.promptText;

    const player = $('player');
    player.setAttribute('refetch-url', `/api/listening/content/${contentId}`);
    player.setAttribute('src', content.audio_signed_url);

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


function resetAnswerSurface() {
  $('answer').value = '';
  $('answer').disabled = false;
  $('btn-submit').disabled = false;
  $('btn-reset').hidden = true;
  $('score-pill').hidden = true;
  $('feedback-block').hidden = true;
  STATE.hasSubmitted = false;
  STATE.listenCount = 0;
  VIEWS.error.hidden = true;
}


async function submitAttempt() {
  if (!STATE.exerciseId) return;
  const userText = $('answer').value;
  if (!userText.trim()) {
    showError('Hãy viết tóm tắt trước khi kiểm tra.');
    return;
  }
  VIEWS.error.hidden = true;
  $('btn-submit').disabled = true;
  $('answer').disabled = true;

  try {
    const result = await window.api.post('/api/listening/attempts', {
      exercise_id:     STATE.exerciseId,
      content_id:      STATE.contentId,
      mode:            'gist',
      user_transcript: userText,
      listen_count:    Math.max(1, STATE.listenCount),
    });
    STATE.hasSubmitted = true;
    renderResult(result);
    $('btn-reset').hidden = false;
  } catch (e) {
    showError('Không gửi được câu trả lời. ' + (e && e.message ? e.message : ''));
    $('btn-submit').disabled = false;
    $('answer').disabled = false;
  }
}


function renderResult(result) {
  const score = Number(result.score) || 0;
  const pill = $('score-pill');
  pill.textContent = `${score} / 100${result.ai_used ? '' : ' · keyword fallback'}`;
  pill.classList.toggle('is-perfect', score >= 80);
  pill.hidden = false;

  $('feedback-label').textContent = result.is_first_attempt
    ? 'Phản hồi (lần làm đầu — đã ghi điểm chính thức)'
    : 'Phản hồi (lần làm thêm — điểm chính thức giữ ở lần đầu)';
  $('feedback-text').textContent = result.feedback || 'Đã chấm xong.';

  const matches = Array.isArray(result.keyword_matches) ? result.keyword_matches : [];
  $('keyword-row').innerHTML = matches.length
    ? matches.map((kw) => `<span class="keyword-pill">${escapeHtml(kw)}</span>`).join('')
    : '<span style="color: var(--av-text-muted);">Không trúng từ khóa nào.</span>';
  $('feedback-block').hidden = false;
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
      $('answer').disabled = false;
      $('btn-submit').disabled = false;
      $('btn-reset').hidden = true;
      $('score-pill').hidden = true;
      $('feedback-block').hidden = true;
      STATE.hasSubmitted = false;
      $('answer').focus();
    });
    $('answer').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!STATE.hasSubmitted) submitAttempt();
      }
    });
  });
}
