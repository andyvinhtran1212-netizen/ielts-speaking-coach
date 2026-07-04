/**
 * frontend/js/admin-listening-gist.js — Sprint 11.4 (DEBT-LISTENING-
 * MODULE 4/5).
 *
 * Admin Gist exercise editor. URL: ?content_id=<UUID>. Loads
 * /admin/listening/content + /admin/listening/exercises (filtered to
 * exercise_type=gist), seeds form fields, POSTs to
 * /admin/listening/exercises on save/publish.
 *
 * Payload shape (server-validated via _validate_gist_payload):
 *   {prompt_text, model_answer, rubric_keywords[]}
 */

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);
const STATE = { contentId: null, content: null, exerciseId: null };


function showBanner(text, kind = 'info') {
  showToast(text, kind, { persist: true });
}


function getContentIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('content_id') || '').trim() || null;
}


async function load() {
  const contentId = getContentIdFromUrl();
  if (!contentId) {
    showBanner('Thiếu ?content_id trong URL.', 'error');
    return;
  }
  STATE.contentId = contentId;

  try {
    const content = await window.api.get(`/admin/listening/content/${contentId}`);
    STATE.content = content;
    $('content-info').innerHTML =
      `<strong>${escapeHtml(content.title || 'Bài nghe')}</strong><br>`
      + `<span style="color: var(--av-text-muted); font-size: var(--av-fs-xs);">`
      + `Duration: ${content.audio_duration_seconds}s · Status: ${content.status} · ID: ${escapeHtml(content.id)}</span>`;
    $('transcript-ref').textContent = content.transcript || '';

    const player = $('player');
    if (content.audio_signed_url) {
      player.setAttribute('src', content.audio_signed_url);
      player.setAttribute('refetch-url', `/admin/listening/content/${contentId}`);
    }

    const exRes = await window.api.get(
      `/admin/listening/exercises?content_id=${encodeURIComponent(contentId)}&exercise_type=gist`,
    );
    const ex = (exRes && exRes.exercises || [])[0];
    if (ex) {
      STATE.exerciseId = ex.id;
      const p = ex.payload || {};
      $('prompt-text').value     = p.prompt_text || '';
      $('model-answer').value    = p.model_answer || '';
      $('rubric-keywords').value = (p.rubric_keywords || []).join(', ');
      showBanner(`Đang chỉnh sửa exercise ${ex.id} (status=${ex.status}).`, 'info');
    } else {
      showBanner('Chưa có gist exercise — soạn nội dung rồi lưu.', 'info');
    }
  } catch (e) {
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


function buildPayload(status) {
  const promptText = $('prompt-text').value.trim();
  const modelAnswer = $('model-answer').value.trim();
  const rubricKeywords = $('rubric-keywords').value
    .split(',').map((k) => k.trim()).filter(Boolean);

  return {
    content_id:    STATE.contentId,
    exercise_type: 'gist',
    payload: {
      prompt_text:     promptText,
      model_answer:    modelAnswer,
      rubric_keywords: rubricKeywords,
    },
    status,
  };
}


async function save(status) {
  $('btn-save').disabled = true;
  $('btn-publish').disabled = true;
  try {
    const out = await window.api.post(
      '/admin/listening/exercises', buildPayload(status),
    );
    STATE.exerciseId = out.exercise_id;
    showBanner(
      `Đã ${out.created ? 'tạo' : 'cập nhật'} gist exercise (${out.exercise_id}, status=${status}).`,
      'success',
    );
  } catch (e) {
    showBanner(`Lưu thất bại: ${e.message || e}`, 'error');
  } finally {
    $('btn-save').disabled = false;
    $('btn-publish').disabled = false;
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


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('btn-save').addEventListener('click', () => save('draft'));
    $('btn-publish').addEventListener('click', () => save('published'));
  });
}
