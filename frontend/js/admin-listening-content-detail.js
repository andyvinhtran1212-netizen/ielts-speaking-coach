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
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function showBanner(text, kind = 'success') {
  const b = $('status-banner');
  if (!b) return;
  b.textContent = text;
  b.classList.remove('is-success', 'is-error');
  b.classList.add(`is-${kind}`);
  b.hidden = false;
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
    maybeStartJustRenderedPolling();
  } catch (e) {
    // Sprint 13.3 — when admin lands here right after POST /render, the
    // row may not be persisted yet (the renderer runs as a BackgroundTask).
    // Show the post-render banner + start polling if ?just_rendered=true.
    if (isJustRenderedFlow() && /404/.test(String(e.message || ''))) {
      showJustRenderedBanner('Đang chờ ElevenLabs render xong — refresh tự động mỗi 5s…');
      startJustRenderedPolling();
      return;
    }
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


// ── Sprint 13.3 — post-render banner + auto-poll ─────────────────────────────


function isJustRenderedFlow() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get('just_rendered') === 'true';
}


function showJustRenderedBanner(message) {
  const b = $('just-rendered-banner');
  if (!b) return;
  const msgEl = $('just-rendered-message');
  if (msgEl && message) msgEl.textContent = message;
  b.hidden = false;
}


function hideJustRenderedBanner() {
  const b = $('just-rendered-banner');
  if (b) b.hidden = true;
}


function maybeStartJustRenderedPolling() {
  if (!isJustRenderedFlow()) return;
  // If the content row IS already loaded but audio_storage_path is still
  // missing (BackgroundTask landed the row but not the storage upload),
  // show the banner and keep polling.
  if (STATE.content && !STATE.content.audio_storage_path) {
    showJustRenderedBanner('Đang chờ ElevenLabs upload audio — refresh tự động mỗi 5s…');
    startJustRenderedPolling();
  } else if (STATE.content && STATE.content.audio_storage_path) {
    // Render landed before we mounted — just dismiss + clean the URL param.
    hideJustRenderedBanner();
    cleanJustRenderedParam();
  }
}


function startJustRenderedPolling() {
  if (STATE._pollHandle) return;
  let elapsed = 0;
  const POLL_MS  = 5000;
  const MAX_MS   = 90_000;  // 90s cap — past this, Andy refreshes manually.
  STATE._pollHandle = setInterval(async () => {
    elapsed += POLL_MS;
    try {
      const c = await window.api.get(
        `/admin/listening/content/${encodeURIComponent(STATE.contentId)}`,
      );
      STATE.content = c;
      if (c.audio_storage_path) {
        clearInterval(STATE._pollHandle); STATE._pollHandle = null;
        hideJustRenderedBanner();
        cleanJustRenderedParam();
        // Re-render the metadata block so duration + size show up.
        renderMeta(c);
        showBanner('Render xong — draft đã sẵn sàng.', 'success');
      }
    } catch {
      // Swallow — banner stays visible, next tick re-tries.
    }
    if (elapsed >= MAX_MS) {
      clearInterval(STATE._pollHandle); STATE._pollHandle = null;
      showJustRenderedBanner('Vẫn chưa landed sau 90s — refresh thủ công hoặc kiểm tra log.');
    }
  }, POLL_MS);
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
