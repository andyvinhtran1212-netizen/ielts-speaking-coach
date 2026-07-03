/**
 * frontend/js/admin-listening-content-detail.js — Sprint 13.1
 * (DEBT-ADMIN-LISTENING-AUTHORING 1/N).
 *
 * Single-content overview page. Fetches the row + its 4 exercise types
 * and renders:
 *   - metadata block (read-only here; "Sửa metadata" links to content-meta.html)
 *   - Publish / Draft / Archive buttons → PATCH /admin/listening/content/{id}/status
 *   - 4-row exercise matrix with "Tạo bài" or "Mở editor" deep-link
 *     into segments.html / gist.html / tf.html / mcq.html with
 *     ?content_id= pre-baked.
 *
 * Endpoints consumed:
 *   GET   /admin/listening/content/{id}
 *   GET   /admin/listening/exercises?content_id={id}
 *   PATCH /admin/listening/content/{id}/status
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
  contentId: null,
  content:   null,
  exercises: [],
};


const EX_TYPES = [
  { key: 'dictation',  label: 'Dictation',  editor: '/pages/admin/listening/segments.html' },
  { key: 'gist',       label: 'Gist',       editor: '/pages/admin/listening/gist.html' },
  { key: 'true_false', label: 'True/False', editor: '/pages/admin/listening/tf.html' },
  { key: 'mcq',        label: 'MCQ',        editor: '/pages/admin/listening/mcq.html' },
];


function getIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('id') || '').trim() || null;
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


function showBanner(text, kind = 'success') {
  showToast(text, kind, { persist: true });
}


function renderMeta(c) {
  $('det-title').textContent = c.title || '(Không tên)';
  $('det-id').textContent = c.id || '';
  const chip = $('det-status-chip');
  chip.textContent = c.status || 'draft';
  chip.className = `det-chip is-${c.status || 'draft'}`;

  const fields = [
    ['Accent',         c.accent_tag],
    ['CEFR',           c.cefr_level],
    ['IELTS section',  c.ielts_section],
    ['Topic tags',     (c.topic_tags || []).join(', ') || '—'],
    ['Premium',        c.is_premium ? 'Có' : 'Không'],
    ['Audio (s)',      c.audio_duration_seconds],
    ['Source type',    c.source_type],
    ['License',        c.external_license || '—'],
    ['Source URL',     c.external_source_url || '—'],
  ];
  $('det-meta-grid').innerHTML = fields.map(([k, v]) => `
    <div>
      <dt>${escapeHtml(k)}</dt>
      <dd>${escapeHtml(v == null ? '—' : v)}</dd>
    </div>
  `).join('');

  $('det-transcript').textContent = c.transcript || '(Chưa có transcript)';

  $('det-edit-meta-link').href = `/pages/admin/listening/content-meta.html?id=${encodeURIComponent(c.id)}`;
}


function exerciseSummary(ex) {
  if (!ex) return '—';
  if (ex.exercise_type === 'dictation') {
    const n = (ex.segments || []).length;
    return `${n} segment${n === 1 ? '' : 's'}`;
  }
  if (ex.exercise_type === 'gist') {
    const p = (ex.payload || {}).prompt_text || '';
    return p ? `Prompt: ${p.slice(0, 60)}${p.length > 60 ? '…' : ''}` : '—';
  }
  if (ex.exercise_type === 'true_false') {
    const n = ((ex.payload || {}).statements || []).length;
    return `${n} nhận định`;
  }
  if (ex.exercise_type === 'mcq') {
    const n = ((ex.payload || {}).questions || []).length;
    return `${n} câu hỏi`;
  }
  return '—';
}


function renderExerciseMatrix(exercises, contentId) {
  const byType = new Map();
  for (const ex of (exercises || [])) byType.set(ex.exercise_type, ex);

  const idEsc = encodeURIComponent(contentId);
  $('det-ex-tbody').innerHTML = EX_TYPES.map((t) => {
    const ex = byType.get(t.key);
    const status = ex ? ex.status : null;
    const statusCell = ex
      ? `<span class="det-chip is-${status}">${status}</span>`
      : `<span style="color: var(--av-text-muted); font-style: italic;">Chưa có</span>`;
    const action = ex
      ? `<a class="btn-secondary" data-action="open-editor" data-ex-type="${t.key}" href="${t.editor}?content_id=${idEsc}">Mở editor</a>`
      : `<a class="btn-primary"   data-action="create" data-ex-type="${t.key}" href="${t.editor}?content_id=${idEsc}">Tạo bài</a>`;
    return `
      <tr data-ex-type="${t.key}">
        <td><strong>${t.label}</strong></td>
        <td>${statusCell}</td>
        <td>${escapeHtml(exerciseSummary(ex))}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join('');
}


async function load() {
  const id = getIdFromUrl();
  if (!id) {
    showBanner('Thiếu ?id trong URL.', 'error');
    return;
  }
  STATE.contentId = id;
  try {
    const [content, exRes] = await Promise.all([
      window.api.get(`/admin/listening/content/${encodeURIComponent(id)}`),
      window.api.get(`/admin/listening/exercises?content_id=${encodeURIComponent(id)}`),
    ]);
    STATE.content = content;
    STATE.exercises = exRes.exercises || [];
    renderMeta(content);
    renderExerciseMatrix(STATE.exercises, id);
    maybeStartRenderingFlow();
  } catch (e) {
    // 404 fallback retained for safety even though Sprint 13.3.1
    // eliminated the placeholder-missing race via synchronous insert.
    if (isJustRenderedFlow() && /404/.test(String(e.message || ''))) {
      showRenderingBanner('Đang chờ row landed…');
      startRenderingPolling();
      return;
    }
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


// ── Sprint 13.3.1 — placeholder-row detection + backoff polling ──────────────


/**
 * Sprint 13.3.1: the canonical "render in progress" sentinel is
 * `audio_storage_path === null` on a row with `source_type ===
 * 'ai_elevenlabs'`. This holds regardless of how the admin arrived
 * (deep link share / browser back / refresh) — `?just_rendered=true`
 * is now a nudge, not a precondition.
 */
function isPlaceholderRendering(content) {
  return !!content
      && content.source_type === 'ai_elevenlabs'
      && (content.audio_storage_path === null
          || content.audio_storage_path === undefined);
}


/**
 * Sprint 13.3.1: the failed-render sentinel is `status === 'archived'`
 * on the same placeholder shape (no audio_storage_path). The renderer
 * flips status to 'archived' on any pipeline error so the UI can
 * surface a failed banner without needing a new column.
 */
function isFailedRender(content) {
  return isPlaceholderRendering(content) && content.status === 'archived';
}


function isJustRenderedFlow() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get('just_rendered') === 'true';
}


function showRenderingBanner(message) {
  const b = $('just-rendered-banner');
  if (!b) return;
  const msgEl = $('just-rendered-message');
  if (msgEl && message) msgEl.textContent = message;
  b.hidden = false;
  b.classList.remove('is-error');
  b.style.background = '#FEF3C7';
  b.style.color = '#92400E';
  b.style.borderColor = '#FDE68A';
}


function showFailedRenderBanner(message) {
  const b = $('just-rendered-banner');
  if (!b) return;
  const msgEl = $('just-rendered-message');
  if (msgEl && message) msgEl.textContent = message;
  b.hidden = false;
  b.classList.add('is-error');
  b.style.background = '#FEF2F2';
  b.style.color = '#991B1B';
  b.style.borderColor = '#FECACA';
}


function hideRenderingBanner() {
  const b = $('just-rendered-banner');
  if (b) b.hidden = true;
}


function maybeStartRenderingFlow() {
  // Sprint 13.3.1: detect the placeholder row state directly instead
  // of relying on the ?just_rendered=true URL nudge. Three cases:
  //   1. content is the failed-render shape → red banner, no polling.
  //   2. content is the in-progress placeholder → yellow banner +
  //      backoff polling.
  //   3. content is normal → dismiss any prior banner + clean URL.
  if (isFailedRender(STATE.content)) {
    showFailedRenderBanner('Render thất bại — admin có thể delete row hoặc thử lại.');
    cleanJustRenderedParam();
    return;
  }
  if (isPlaceholderRendering(STATE.content)) {
    showRenderingBanner('Render đang chạy (~30s) — đang chờ ElevenLabs upload audio…');
    startRenderingPolling();
    return;
  }
  hideRenderingBanner();
  cleanJustRenderedParam();
}


// Backoff schedule: 5s, 10s, 15s, 15s, 15s → total 60s. Conservative
// to avoid hammering the backend on a slow ElevenLabs render.
const _RENDER_POLL_BACKOFF_S = [5, 10, 15, 15, 15];


function startRenderingPolling() {
  if (STATE._pollHandle) return;  // already polling
  let attempt = 0;

  const tick = async () => {
    if (attempt >= _RENDER_POLL_BACKOFF_S.length) {
      STATE._pollHandle = null;
      showRenderingBanner(
        'Vẫn chưa landed sau 60s — refresh thủ công hoặc kiểm tra log Railway.',
      );
      return;
    }
    const delay = _RENDER_POLL_BACKOFF_S[attempt] * 1000;
    attempt += 1;
    STATE._pollHandle = setTimeout(async () => {
      try {
        const c = await window.api.get(
          `/admin/listening/content/${encodeURIComponent(STATE.contentId)}`,
        );
        STATE.content = c;
        if (c.audio_storage_path) {
          STATE._pollHandle = null;
          hideRenderingBanner();
          cleanJustRenderedParam();
          renderMeta(c);
          showBanner('Render xong — draft đã sẵn sàng.', 'success');
          return;
        }
        if (isFailedRender(c)) {
          STATE._pollHandle = null;
          showFailedRenderBanner(
            'Render thất bại — placeholder row flipped to archived.',
          );
          cleanJustRenderedParam();
          renderMeta(c);
          return;
        }
      } catch {
        // Swallow — next backoff tick retries.
      }
      tick();  // schedule next backoff step
    }, delay);
  };

  tick();
}


function cleanJustRenderedParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('just_rendered');
    window.history.replaceState({}, '', url.toString());
  } catch { /* noop */ }
}


async function patchStatus(targetStatus) {
  if (!STATE.contentId) return;
  // Defensive UI lock during request.
  ['btn-publish', 'btn-draft', 'btn-archive'].forEach((id) => {
    const b = $(id); if (b) b.disabled = true;
  });
  try {
    const updated = await window.api.patch(
      `/admin/listening/content/${encodeURIComponent(STATE.contentId)}/status`,
      { status: targetStatus },
    );
    // Merge into state and re-render header chip.
    STATE.content = { ...STATE.content, ...updated };
    const chip = $('det-status-chip');
    chip.textContent = STATE.content.status || targetStatus;
    chip.className = `det-chip is-${STATE.content.status || targetStatus}`;
    showBanner(`Status đã chuyển → ${STATE.content.status || targetStatus}.`, 'success');
  } catch (e) {
    showBanner(`Đổi status thất bại: ${e.message || e}`, 'error');
  } finally {
    ['btn-publish', 'btn-draft', 'btn-archive'].forEach((id) => {
      const b = $(id); if (b) b.disabled = false;
    });
  }
}


function wire() {
  document.querySelectorAll('[data-target-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target-status');
      patchStatus(target);
    });
  });
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    load();
  });
}
