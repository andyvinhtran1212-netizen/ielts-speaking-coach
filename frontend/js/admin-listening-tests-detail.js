/**
 * admin-listening-tests-detail.js — Sprint 13.4.3 (DEBT-ADMIN-LISTENING-AUTHORING).
 *
 * Drives /pages/admin/listening/tests-detail.html — per-test admin
 * surface for Cambridge IELTS bundles. Three audio modes selectable:
 *   - full_premixed         (Andy uploads 1 file)
 *   - parts_auto_assembled  (Andy uploads 4 parts → web renders narrator
 *                            via ElevenLabs + concatenates pauses)
 *   - parts_only            (4 parts only; cannot publish)
 *
 * Publish gate enforces audio readiness server-side; this controller
 * mirrors the rule client-side so the button is disabled when the
 * server would reject.
 */

// Sprint 13.4.1 hotfix carry-forward — bootstrap supabase at module load.
const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const STATE = {
  testId:        null,         // UUID from ?id=
  test:          null,         // listening_tests row
  sections:      [],           // listening_content rows
  signedUrls:    null,         // Sprint 13.4.3.2 — bundle from GET /audio/signed-urls
};


// Sprint 13.4.3.2 — shared MP3 file-extension check + dnd handler factory.
function _isMp3(file) {
  return !!file && typeof file.name === 'string'
         && file.name.toLowerCase().endsWith('.mp3');
}


function attachDropZoneHandlers(zoneEl, onFile) {
  // Sprint 13.4.3.2 — Sprint 13.2 upload.js wires the same pattern; the
  // tests-detail page shipped without these handlers so dragging onto a
  // zone bubbled to the browser (which opened the MP3 in a new tab).
  ['dragenter', 'dragover'].forEach((ev) => {
    zoneEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    zoneEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove('is-dragover');
    });
  });
  zoneEl.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!_isMp3(file)) {
      showError('Chỉ chấp nhận file .mp3');
      return;
    }
    onFile(file);
  });
}


// ── Bootstrap ───────────────────────────────────────────────────────────────


function init() {
  const params = new URLSearchParams(window.location.search);
  STATE.testId = params.get('id');
  if (!STATE.testId) {
    showError('Thiếu test id — quay lại danh sách.');
    return;
  }

  document.getElementById('td-mode').addEventListener('change', onModeChange);
  document.getElementById('td-publish-btn').addEventListener('click', () => onStatus('published'));
  document.getElementById('td-draft-btn').addEventListener('click',   () => onStatus('draft'));
  document.getElementById('td-archive-btn').addEventListener('click', () => onStatus('archived'));
  document.getElementById('td-delete-btn').addEventListener('click', onDelete);
  document.getElementById('td-hard-delete-btn').addEventListener('click', onHardDelete);
  document.getElementById('td-assemble').addEventListener('click', onAssemble);
  document.getElementById('td-file-full').addEventListener('change', onFullAudioPick);
  // Sprint 13.4.3.2 — wire dnd on the full-audio zone (parts zones are
  // wired per-render inside renderPartsGrid since the grid rebuilds).
  attachDropZoneHandlers(
    document.getElementById('td-zone-full'),
    (file) => uploadFullAudio(file),
  );

  fetchTest();
}


async function fetchTest() {
  setLoading(true);
  hideError();
  try {
    const res = await window.api.get(`/admin/listening/tests/${encodeURIComponent(STATE.testId)}`);
    STATE.test = res;
    STATE.sections = res.sections || [];
    // Sprint 13.4.3.2 — bundle-fetch signed URLs for the audio preview
    // players. Best-effort: if the endpoint errors we still render the
    // page without players (admin gets the metadata text fallback).
    try {
      STATE.signedUrls = await window.api.get(
        `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/audio/signed-urls`,
      );
    } catch {
      STATE.signedUrls = null;
    }
    render();
  } catch (e) {
    showError(e && e.message ? e.message : 'Không tải được test.');
  } finally {
    setLoading(false);
  }
}


// ── Render ──────────────────────────────────────────────────────────────────


function render() {
  document.getElementById('td-header').hidden    = false;
  document.getElementById('td-meta').hidden      = false;
  document.getElementById('td-audio').hidden     = false;
  document.getElementById('td-sections').hidden  = false;
  document.getElementById('td-publish').hidden   = false;
  document.getElementById('td-delete').hidden    = false;

  const t = STATE.test || {};
  document.getElementById('td-title').textContent =
    `${t.test_id || '—'} — ${t.title || ''}`;
  const statusEl = document.getElementById('td-status');
  statusEl.textContent = t.status || '—';
  statusEl.className   = `td-chip is-${escapeHtml(t.status || 'draft')}`;

  document.getElementById('td-meta-test-id').textContent = t.test_id || '—';
  document.getElementById('td-meta-version').textContent = t.version || '1.0';
  document.getElementById('td-meta-band').textContent    =
    t.band_target !== null && t.band_target !== undefined ? String(t.band_target) : '—';
  document.getElementById('td-meta-accents').textContent =
    (t.accent_profile || []).join(', ') || '—';
  document.getElementById('td-meta-words').textContent   =
    t.total_transcript_words ? String(t.total_transcript_words) : '—';
  document.getElementById('td-meta-sections').textContent = String(STATE.sections.length);
  document.getElementById('td-meta-created').textContent  = (t.created_at || '').slice(0, 10) || '—';

  document.getElementById('td-mode').value = t.audio_assembly_mode || '';
  renderModeUI(t.audio_assembly_mode);
  renderSectionsList();
  renderCuePoints();
  renderPublishGate();
  renderMapImagesPanel();
}


// Sprint 13.5.6 — render the per-exercise map-image cards. Each
// plan-label exercise gets its own block with model selector,
// preview <img> when generated, and Generate/Regenerate/Delete CTAs.
function renderMapImagesPanel() {
  const panel = document.getElementById('td-map-images');
  const host  = document.getElementById('td-map-list');
  if (!panel || !host) return;
  const plExercises = (STATE.test && STATE.test.plan_label_exercises) || [];
  if (!plExercises.length) {
    panel.hidden = true;
    host.innerHTML = '';
    return;
  }
  panel.hidden = false;
  host.innerHTML = plExercises.map((ex) => {
    const has = ex.has_map_image;
    // Sprint 13.5.9.2 — default selector to Nano Banana 2 (Andy 2026-05-21
    // lock). The previous default (imagen-4.0-fast) couldn't follow
    // letter-placement instructions reliably for IELTS plan-label maps.
    const model = ex.map_image_model || 'gemini-3.1-flash-image-preview';
    const desc  = (ex.map_description || '').trim();
    // Sprint 13.5.9 — surface Andy's curated prompt (when the parser
    // pulled one from a `<details>` block) and the source actually used
    // by the last successful generation. The image-gen service prefers
    // the custom prompt verbatim and ignores the template.
    const customPrompt = (ex.map_image_custom_prompt || '').trim();
    const hasCustom = Boolean(customPrompt);
    const lastSource = ex.map_image_prompt_source || null;
    const sourceLabel = hasCustom
      ? `<span class="td-prompt-source td-prompt-source-custom" data-source="custom"
            style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:var(--av-fs-xs);background:#dcfce7;color:#166534;font-weight:600;">
            ✅ Custom prompt từ markdown (sẽ dùng khi generate)
          </span>`
      : `<span class="td-prompt-source td-prompt-source-template" data-source="template"
            style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:var(--av-fs-xs);background:#fef3c7;color:#92400e;font-weight:600;">
            ⚠️ Template prompt (no &lt;details&gt; block found trong markdown)
          </span>`;
    const lastSourceNote = has && lastSource
      ? `<span class="td-section-meta td-prompt-last-source" style="font-size:var(--av-fs-xs);">
           Hình hiện tại generate từ: <strong>${escapeHtml(lastSource)}</strong>
         </span>`
      : '';
    // Sprint 13.5.9.1 — replace the read-only `<pre>` preview with an
    // editable textarea. Admin sees the exact prompt that will go to
    // the API, can edit it (session-only — re-converting markdown
    // resets), and an "edit indicator" flips on the moment the value
    // diverges from the parser-extracted source. The reset button
    // brings the textarea back to the original.
    const promptReview = hasCustom
      ? `<div class="td-prompt-review" data-exercise-id="${escapeHtml(ex.id)}"
              style="margin-top:var(--av-space-3);">
           <details class="td-prompt-preview" data-exercise-id="${escapeHtml(ex.id)}">
             <summary>Review prompt sẽ gửi tới API (${customPrompt.length} chars)</summary>
             <p class="td-section-meta" style="margin-top:var(--av-space-2);font-size:var(--av-fs-xs);">
               Đây là prompt sẽ gửi tới Gemini API. Edit chỉ áp dụng cho lần generate này; re-convert markdown sẽ reset.
             </p>
             <textarea class="td-prompt-editable"
                       data-exercise-id="${escapeHtml(ex.id)}"
                       data-original="${escapeHtml(customPrompt)}"
                       rows="14"
                       style="width:100%;font-family:var(--av-font-mono);font-size:var(--av-fs-xs);padding:var(--av-space-2);border:1px solid var(--av-border-default);border-radius:var(--av-radius-sm);background:#f8fafc;">${escapeHtml(customPrompt)}</textarea>
             <div class="td-prompt-edit-actions"
                  style="display:flex;gap:var(--av-space-2);align-items:center;flex-wrap:wrap;margin-top:var(--av-space-2);">
               <button class="td-btn td-prompt-reset" type="button"
                       data-exercise-id="${escapeHtml(ex.id)}">↺ Reset về prompt gốc</button>
               <span class="td-prompt-edit-indicator"
                     data-exercise-id="${escapeHtml(ex.id)}"
                     hidden
                     style="font-size:var(--av-fs-xs);color:#92400e;font-weight:600;">⚠️ Prompt đã được edit — khác với markdown source</span>
             </div>
           </details>
         </div>`
      : '';
    const descPreview = desc
      ? `<details><summary>Map description (${desc.length} chars)</summary><pre style="white-space:pre-wrap;font-size:var(--av-fs-xs);max-height:160px;overflow:auto;">${escapeHtml(desc)}</pre></details>`
      : `<p class="td-section-meta" style="color:#991B1B;">Map description trống — parser chưa extract được. Re-convert markdown trước khi generate.</p>`;
    // Sprint 13.5.9.3 — header chip differentiates manual-upload vs
    // API-generated provenance so admin sees the source at a glance.
    const provenance = ex.map_image_source || (has && model ? 'api_generation' : null);
    const headerBadge = has
      ? (provenance === 'manual_upload'
         ? `<span class="td-section-meta td-map-source-badge" data-source="manual_upload"
                style="font-size:var(--av-fs-xs);background:#e8f4f8;color:#0066a1;
                       padding:2px 8px;border-radius:12px;font-weight:600;">
              📤 Manual upload
            </span>`
         : `<span class="td-section-meta td-map-source-badge" data-source="api_generation"
                style="font-size:var(--av-fs-xs);background:#e8f8e8;color:#2d7a2d;
                       padding:2px 8px;border-radius:12px;font-weight:600;">
              🎨 API: ${escapeHtml(model)}
            </span>`)
      : '<span class="td-section-meta" style="font-size:var(--av-fs-xs);">Chưa có hình</span>';
    return `
      <div class="td-map-card" data-exercise-id="${escapeHtml(ex.id)}"
           style="padding:var(--av-space-3);border:1px solid var(--av-border-default);border-radius:var(--av-radius-md);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--av-space-3);">
          <strong>Section ${escapeHtml(ex.section_num)} — Plan label</strong>
          ${headerBadge}
        </div>
        <!-- Sprint 13.5.9.3 — tab toggle between API generate (existing
             flow) and manual upload (escape hatch). The API tab stays
             the default so existing muscle memory is preserved. -->
        <nav class="td-map-tabs" data-exercise-id="${escapeHtml(ex.id)}"
             role="tablist"
             style="display:flex;gap:var(--av-space-2);border-bottom:1px solid var(--av-border-default);margin:var(--av-space-3) 0 var(--av-space-2);">
          <button type="button" role="tab" class="td-map-tab is-active"
                  data-exercise-id="${escapeHtml(ex.id)}"
                  data-tab="api-generate"
                  aria-selected="true"
                  style="background:none;border:none;border-bottom:2px solid var(--ielts-paper-accent, #1e3a5f);padding:var(--av-space-2) var(--av-space-3);cursor:pointer;font-weight:600;">
            🎨 Generate via API
          </button>
          <button type="button" role="tab" class="td-map-tab"
                  data-exercise-id="${escapeHtml(ex.id)}"
                  data-tab="manual-upload"
                  aria-selected="false"
                  style="background:none;border:none;border-bottom:2px solid transparent;padding:var(--av-space-2) var(--av-space-3);cursor:pointer;color:var(--av-text-muted);">
            📤 Upload ảnh có sẵn
          </button>
        </nav>
        <div class="td-map-tab-pane" data-tab-pane="api-generate"
             data-exercise-id="${escapeHtml(ex.id)}">
        <div class="td-prompt-source-row" style="display:flex;gap:var(--av-space-2);flex-wrap:wrap;align-items:center;margin-top:var(--av-space-2);">
          ${sourceLabel}
          ${lastSourceNote}
        </div>
        ${promptReview}
        ${descPreview}
        <div class="td-map-actions" style="display:flex;gap:var(--av-space-2);flex-wrap:wrap;margin-top:var(--av-space-3);align-items:center;">
          <label style="font-size:var(--av-fs-sm);">
            Model:
            <select class="td-map-model" data-exercise-id="${escapeHtml(ex.id)}">
              <option value="gemini-3.1-flash-image-preview"${model === 'gemini-3.1-flash-image-preview' ? ' selected' : ''}>Gemini 3.1 Flash Image (Nano Banana 2) — $0.067 ⭐ DEFAULT</option>
              <option value="gemini-3-pro-image-preview"${model === 'gemini-3-pro-image-preview' ? ' selected' : ''}>Gemini 3 Pro Image (Nano Banana Pro) — $0.134 (premium quality)</option>
              <option value="imagen-4.0-ultra-generate-001"${model === 'imagen-4.0-ultra-generate-001' ? ' selected' : ''}>Imagen 4 Ultra — $0.06 (publication-grade max fidelity)</option>
              <option value="imagen-4.0-generate-001"${model === 'imagen-4.0-generate-001' ? ' selected' : ''}>Imagen 4 Standard — $0.04 (general-purpose)</option>
              <option value="imagen-4.0-fast-generate-001"${model === 'imagen-4.0-fast-generate-001' ? ' selected' : ''}>Imagen 4 Fast — $0.02 (cheapest, basic)</option>
              <option value="gemini-2.5-flash-image"${model === 'gemini-2.5-flash-image' ? ' selected' : ''}>Gemini 2.5 Flash Image (Nano Banana) — $0.039 ⚠️ deprecated 2026-10-02</option>
            </select>
          </label>
          ${has
            ? `<button class="td-btn td-btn-primary td-map-regen" data-exercise-id="${escapeHtml(ex.id)}" type="button">Generate lại</button>
               <button class="td-btn td-btn-danger  td-map-delete" data-exercise-id="${escapeHtml(ex.id)}" type="button">Xoá hình</button>`
            : `<button class="td-btn td-btn-primary td-map-gen" data-exercise-id="${escapeHtml(ex.id)}" type="button">Generate hình map</button>`}
          <span class="td-map-status" data-exercise-id="${escapeHtml(ex.id)}" style="font-size:var(--av-fs-xs);color:var(--av-text-muted);"></span>
        </div>
        </div><!-- /tab-pane api-generate -->
        <!-- Sprint 13.5.9.3 — manual upload pane. Hidden until the
             admin clicks the "📤 Upload ảnh có sẵn" tab. Bypasses any
             API call so cost = $0. The same Supabase Storage bucket
             persists the uploaded bytes; the student player can't
             tell the source apart. -->
        <div class="td-map-tab-pane" data-tab-pane="manual-upload"
             data-exercise-id="${escapeHtml(ex.id)}" hidden>
          <p class="td-section-meta" style="font-size:var(--av-fs-xs);margin:var(--av-space-3) 0 var(--av-space-2);">
            Upload ảnh map đã tạo qua tool ngoài (e.g. Gemini Banana standalone web app).
            Hỗ trợ PNG / JPG / WebP — tối đa 5 MB. Cost: $0 (no API call).
          </p>
          <div class="td-map-dropzone"
               data-exercise-id="${escapeHtml(ex.id)}"
               style="border:2px dashed var(--av-border-default);border-radius:var(--av-radius-md);padding:var(--av-space-5) var(--av-space-3);text-align:center;cursor:pointer;transition:border-color 0.15s ease,background 0.15s ease;">
            <input type="file" class="td-map-file-input"
                   data-exercise-id="${escapeHtml(ex.id)}"
                   accept="image/png,image/jpeg,image/webp"
                   hidden />
            <div style="font-size:24px;">📁</div>
            <div style="margin-top:var(--av-space-2);">
              <strong>Kéo thả ảnh vào đây</strong> hoặc
              <span style="color:var(--ielts-paper-accent, #1e3a5f);text-decoration:underline;">click để chọn file</span>
            </div>
            <div class="td-section-meta" style="font-size:var(--av-fs-xs);margin-top:var(--av-space-1);">
              PNG / JPG / WebP — tối đa 5 MB
            </div>
          </div>
          <div class="td-map-upload-preview"
               data-exercise-id="${escapeHtml(ex.id)}"
               hidden
               style="margin-top:var(--av-space-3);padding:var(--av-space-3);border:1px solid var(--av-border-default);border-radius:var(--av-radius-md);">
            <h4 style="margin:0 0 var(--av-space-2);font-size:var(--av-fs-sm);">Preview ảnh sẽ upload:</h4>
            <img class="td-map-upload-preview-img"
                 data-exercise-id="${escapeHtml(ex.id)}"
                 alt="Manual upload preview"
                 style="max-width:100%;max-height:320px;border:1px solid var(--av-border-default);background:white;" />
            <div class="td-section-meta" style="font-size:var(--av-fs-xs);margin-top:var(--av-space-2);display:flex;gap:var(--av-space-3);flex-wrap:wrap;">
              <span class="td-map-upload-filename" data-exercise-id="${escapeHtml(ex.id)}"></span>
              <span class="td-map-upload-filesize" data-exercise-id="${escapeHtml(ex.id)}"></span>
            </div>
            <div class="td-map-upload-actions" style="display:flex;gap:var(--av-space-2);margin-top:var(--av-space-3);flex-wrap:wrap;align-items:center;">
              <button type="button" class="td-btn td-map-upload-cancel"
                      data-exercise-id="${escapeHtml(ex.id)}">Hủy</button>
              <button type="button" class="td-btn td-btn-primary td-map-upload-confirm"
                      data-exercise-id="${escapeHtml(ex.id)}">Confirm Upload</button>
              <span class="td-map-upload-status" data-exercise-id="${escapeHtml(ex.id)}"
                    style="font-size:var(--av-fs-xs);color:var(--av-text-muted);"></span>
            </div>
          </div>
        </div><!-- /tab-pane manual-upload -->
        <!-- Shared image preview — Sprint 13.5.6 + 13.5.9.3 -->
        <div class="td-map-preview" data-exercise-id="${escapeHtml(ex.id)}"
             style="margin-top:var(--av-space-3);text-align:center;${has ? '' : 'display:none;'}">
          ${has
            ? `<img class="td-map-img" data-exercise-id="${escapeHtml(ex.id)}" alt="Generated floor plan"
                   style="max-width:100%;max-height:480px;border:1px solid var(--av-border-default);background:white;" />`
            : ''}
        </div>
      </div>
    `;
  }).join('');

  attachMapImageHandlers();
  // Eagerly fetch fresh signed URLs for any card that already has an image.
  for (const ex of plExercises) {
    if (ex.has_map_image) {
      void refreshMapImage(ex.id);
    }
  }
}

function attachMapImageHandlers() {
  document.querySelectorAll('.td-map-gen').forEach((b) => {
    b.addEventListener('click', () => onGenerateMapImage(b.getAttribute('data-exercise-id')));
  });
  document.querySelectorAll('.td-map-regen').forEach((b) => {
    b.addEventListener('click', () => onRegenerateMapImage(b.getAttribute('data-exercise-id')));
  });
  document.querySelectorAll('.td-map-delete').forEach((b) => {
    b.addEventListener('click', () => onDeleteMapImage(b.getAttribute('data-exercise-id')));
  });
  // Sprint 13.5.9.1 — wire the editable prompt textareas: keep the
  // "Prompt đã được edit" indicator in sync with the textarea diff,
  // and let the reset button restore the original.
  document.querySelectorAll('.td-prompt-editable').forEach((ta) => {
    ta.addEventListener('input', () => updatePromptEditIndicator(ta));
  });
  document.querySelectorAll('.td-prompt-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exerciseId = btn.getAttribute('data-exercise-id');
      const ta = document.querySelector(
        `textarea.td-prompt-editable[data-exercise-id="${exerciseId}"]`,
      );
      if (!ta) return;
      ta.value = ta.getAttribute('data-original') || '';
      updatePromptEditIndicator(ta);
    });
  });
  // Sprint 13.5.9.3 — manual-upload tab + dropzone wiring.
  document.querySelectorAll('.td-map-tab').forEach((tab) => {
    tab.addEventListener('click', () => onMapTabSwitch(tab));
  });
  document.querySelectorAll('.td-map-dropzone').forEach((zone) => {
    const exerciseId = zone.getAttribute('data-exercise-id');
    const fileInput = document.querySelector(
      `input.td-map-file-input[data-exercise-id="${exerciseId}"]`,
    );
    if (!fileInput) return;
    zone.addEventListener('click', (e) => {
      // Don't loop the click-on-input case back through the zone.
      if (e.target === fileInput) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleManualUploadFile(exerciseId, file);
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
      zone.style.background = '#fafaf5';
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('is-dragover');
      zone.style.background = '';
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      zone.style.background = '';
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleManualUploadFile(exerciseId, file);
    });
  });
  document.querySelectorAll('.td-map-upload-cancel').forEach((btn) => {
    btn.addEventListener('click', () =>
      cancelManualUpload(btn.getAttribute('data-exercise-id'))
    );
  });
  document.querySelectorAll('.td-map-upload-confirm').forEach((btn) => {
    btn.addEventListener('click', () =>
      onConfirmManualUpload(btn.getAttribute('data-exercise-id'))
    );
  });
}


// ── Sprint 13.5.9.3 — manual upload escape hatch (frontend) ────────────────

const MAP_IMAGE_MANUAL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
const MAP_IMAGE_MANUAL_UPLOAD_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp',
]);

// Per-exercise selected-file slot. Keyed by exerciseId so multiple
// cards on the same page don't clobber each other.
const _manualUploadSelections = new Map();

function onMapTabSwitch(tabEl) {
  const exerciseId = tabEl.getAttribute('data-exercise-id');
  const targetTab  = tabEl.getAttribute('data-tab');
  document.querySelectorAll(
    `.td-map-tab[data-exercise-id="${exerciseId}"]`,
  ).forEach((t) => {
    const isActive = t === tabEl;
    t.classList.toggle('is-active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    t.style.borderBottomColor = isActive
      ? 'var(--ielts-paper-accent, #1e3a5f)'
      : 'transparent';
    t.style.color = isActive ? '' : 'var(--av-text-muted)';
    t.style.fontWeight = isActive ? '600' : '';
  });
  document.querySelectorAll(
    `.td-map-tab-pane[data-exercise-id="${exerciseId}"]`,
  ).forEach((pane) => {
    pane.hidden = pane.getAttribute('data-tab-pane') !== targetTab;
  });
}

function _validateManualUploadFile(file) {
  if (!MAP_IMAGE_MANUAL_UPLOAD_TYPES.has(file.type)) {
    return `Format không hỗ trợ: ${file.type || 'unknown'}. Dùng PNG / JPG / WebP.`;
  }
  if (file.size > MAP_IMAGE_MANUAL_UPLOAD_MAX_BYTES) {
    return `File quá lớn (${(file.size / 1024 / 1024).toFixed(2)} MB). Max 5 MB.`;
  }
  if (file.size < 100) {
    return `File quá nhỏ (${file.size} bytes) — có thể bị corrupt.`;
  }
  return null;
}

function handleManualUploadFile(exerciseId, file) {
  const error = _validateManualUploadFile(file);
  if (error) {
    window.alert(error);
    return;
  }
  _manualUploadSelections.set(exerciseId, file);
  const previewWrap = document.querySelector(
    `.td-map-upload-preview[data-exercise-id="${exerciseId}"]`,
  );
  const img = document.querySelector(
    `img.td-map-upload-preview-img[data-exercise-id="${exerciseId}"]`,
  );
  const nameEl = document.querySelector(
    `.td-map-upload-filename[data-exercise-id="${exerciseId}"]`,
  );
  const sizeEl = document.querySelector(
    `.td-map-upload-filesize[data-exercise-id="${exerciseId}"]`,
  );
  if (!previewWrap || !img || !nameEl || !sizeEl) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    img.src = e.target.result;
    nameEl.textContent = file.name;
    sizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    previewWrap.hidden = false;
  };
  reader.readAsDataURL(file);
}

function cancelManualUpload(exerciseId) {
  _manualUploadSelections.delete(exerciseId);
  const previewWrap = document.querySelector(
    `.td-map-upload-preview[data-exercise-id="${exerciseId}"]`,
  );
  const fileInput = document.querySelector(
    `input.td-map-file-input[data-exercise-id="${exerciseId}"]`,
  );
  if (previewWrap) previewWrap.hidden = true;
  if (fileInput) fileInput.value = '';
}

function setManualUploadStatus(exerciseId, text, isError) {
  const el = document.querySelector(
    `.td-map-upload-status[data-exercise-id="${exerciseId}"]`,
  );
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#991B1B' : 'var(--av-text-muted)';
}

async function onConfirmManualUpload(exerciseId) {
  const file = _manualUploadSelections.get(exerciseId);
  if (!file) return;
  const confirmMsg =
    `Upload ảnh "${file.name}" (${(file.size / 1024).toFixed(1)} KB) `
    + `làm map cho exercise này?\nCost: $0 (no API call).`;
  if (!window.confirm(confirmMsg)) return;
  setManualUploadStatus(exerciseId, 'Đang upload…', false);
  try {
    const formData = new FormData();
    formData.append('image_file', file);
    const res = await window.api.upload(
      `/admin/listening/exercises/${encodeURIComponent(exerciseId)}/upload-map-image`,
      formData,
    );
    setManualUploadStatus(
      exerciseId,
      `OK — manual upload (${res.map_image_size_bytes} bytes)`,
      false,
    );
    cancelManualUpload(exerciseId);
    // Refresh the test bundle so the panel re-renders with the new
    // image + source badge.
    await fetchTest();
    render();
  } catch (e) {
    setManualUploadStatus(
      exerciseId,
      `Lỗi: ${(e && e.message) || e}`,
      true,
    );
  }
}

function updatePromptEditIndicator(textarea) {
  const exerciseId = textarea.getAttribute('data-exercise-id');
  const original = textarea.getAttribute('data-original') || '';
  const indicator = document.querySelector(
    `.td-prompt-edit-indicator[data-exercise-id="${exerciseId}"]`,
  );
  if (!indicator) return;
  indicator.hidden = (textarea.value === original);
}

// Sprint 13.5.9.1 — read the (possibly admin-edited) prompt out of the
// per-card textarea so the generate POST forwards what the admin
// actually sees. Returns null when the card carries no curated prompt
// (template path), or when the textarea is missing.
function readCustomPromptOverride(exerciseId) {
  const ta = document.querySelector(
    `textarea.td-prompt-editable[data-exercise-id="${exerciseId}"]`,
  );
  if (!ta) return null;
  const original = ta.getAttribute('data-original') || '';
  const current = ta.value;
  // Forward the current value verbatim — even if it matches the
  // original we send it so the server logs the explicit source.
  return current && current.trim() ? current : null;
}

function setMapStatus(exerciseId, text, isError) {
  const el = document.querySelector(`.td-map-status[data-exercise-id="${exerciseId}"]`);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#991B1B' : 'var(--av-text-muted)';
}

async function refreshMapImage(exerciseId) {
  try {
    const res = await window.api.get(
      `/admin/listening/exercises/${encodeURIComponent(exerciseId)}/map-image/signed-url`,
    );
    const img = document.querySelector(`img.td-map-img[data-exercise-id="${exerciseId}"]`);
    if (img && res && res.signed_url) {
      img.src = res.signed_url;
    }
  } catch (_e) {
    // Silent — the card already shows "Chưa có hình" if no image is stored.
  }
}

// Sprint 13.5.9.2 — keep the per-model price table in sync with the
// backend SUPPORTED_MODELS registry so the confirmation dialog quotes
// the right cost. Refer to ``backend/services/listening_map_image.py``
// — when prices change there, update this map too.
const MAP_IMAGE_MODEL_PRICING = {
  'gemini-3.1-flash-image-preview': 0.067,
  'gemini-3-pro-image-preview':     0.134,
  'imagen-4.0-ultra-generate-001':  0.06,
  'imagen-4.0-generate-001':        0.04,
  'imagen-4.0-fast-generate-001':   0.02,
  'gemini-2.5-flash-image':         0.039,
};

const MAP_IMAGE_DEPRECATED_MODELS = new Set(['gemini-2.5-flash-image']);

async function onGenerateMapImage(exerciseId) {
  const sel = document.querySelector(`select.td-map-model[data-exercise-id="${exerciseId}"]`);
  const model = sel ? sel.value : null;
  // Sprint 13.5.9.1 — forward the reviewed prompt the admin sees in
  // the textarea. The backend treats this as a session-only override
  // (not persisted back to markdown).
  const customPromptOverride = readCustomPromptOverride(exerciseId);
  const promptChars = customPromptOverride ? customPromptOverride.length : 0;
  // Sprint 13.5.9.2 — cost preview reads from the per-model table so
  // Andy sees the exact charge for the selected model (was a fixed
  // "$0.02-0.04" copy under 13.5.9.1, which under-quoted the new
  // Gemini 3.x default). The deprecation warning surfaces inline so
  // a stale option pick isn't a silent footgun.
  const cost = MAP_IMAGE_MODEL_PRICING[model] != null
    ? MAP_IMAGE_MODEL_PRICING[model]
    : 0.05;
  const deprecatedWarning = MAP_IMAGE_DEPRECATED_MODELS.has(model)
    ? '\n\n⚠️ Model này deprecated 2026-10-02. Cân nhắc đổi sang Nano Banana 2 / Pro.'
    : '';
  // Confirmation gate — cost guardrail + accuracy verification. The
  // dialog spells out the prompt source so Andy can't accidentally
  // burn an API call with the wrong prompt.
  const sourceLine = customPromptOverride
    ? `custom prompt (${promptChars} chars)`
    : 'template prompt (no <details> block trong markdown)';
  const confirmMsg =
    `Generate hình map với ${sourceLine}?\n\n`
    + `Model: ${model || 'default'}\n`
    + `Cost ước tính: ~$${cost.toFixed(3)}`
    + deprecatedWarning;
  if (!window.confirm(confirmMsg)) return;
  setMapStatus(exerciseId, 'Đang generate (10-30s)…', false);
  try {
    const res = await window.api.post(
      `/admin/listening/exercises/${encodeURIComponent(exerciseId)}/generate-map-image`,
      {
        model,
        custom_prompt_override: customPromptOverride,
      },
    );
    const source = res.map_image_prompt_source
      ? ` · source=${res.map_image_prompt_source}`
      : '';
    setMapStatus(
      exerciseId,
      `OK — ${res.map_image_model} · ~$${(res.cost_estimate_usd || 0).toFixed(3)}${source}`,
      false,
    );
    // Refresh the test bundle so the panel re-renders with the new image.
    await fetchTest();
    render();
  } catch (e) {
    setMapStatus(exerciseId, `Lỗi: ${(e && e.message) || e}`, true);
  }
}

async function onRegenerateMapImage(exerciseId) {
  if (!window.confirm(
    'Generate lại sẽ xoá hình hiện tại + tốn phí thêm cho lần generate mới. Tiếp tục?',
  )) return;
  setMapStatus(exerciseId, 'Đang xoá hình cũ…', false);
  try {
    await window.api.delete(
      `/admin/listening/exercises/${encodeURIComponent(exerciseId)}/map-image`,
    );
  } catch (e) {
    setMapStatus(exerciseId, `Xoá thất bại: ${(e && e.message) || e}`, true);
    return;
  }
  await onGenerateMapImage(exerciseId);
}

async function onDeleteMapImage(exerciseId) {
  if (!window.confirm('Xoá hình map cho exercise này? Phải generate lại nếu cần.')) return;
  setMapStatus(exerciseId, 'Đang xoá hình…', false);
  try {
    await window.api.delete(
      `/admin/listening/exercises/${encodeURIComponent(exerciseId)}/map-image`,
    );
    await fetchTest();
    render();
  } catch (e) {
    setMapStatus(exerciseId, `Xoá thất bại: ${(e && e.message) || e}`, true);
  }
}


function renderModeUI(mode) {
  const fullBlock  = document.getElementById('td-audio-full');
  const partsBlock = document.getElementById('td-audio-parts');
  if (mode === 'full_premixed') {
    fullBlock.hidden  = false;
    partsBlock.hidden = true;
    renderFullAudio();
  } else if (mode === 'parts_auto_assembled' || mode === 'parts_only') {
    fullBlock.hidden  = true;
    partsBlock.hidden = false;
    renderPartsGrid();
    document.getElementById('td-assemble-row').hidden = mode !== 'parts_auto_assembled';
    refreshAssembleButton();
  } else {
    fullBlock.hidden  = true;
    partsBlock.hidden = true;
  }
}


function renderFullAudio() {
  const t = STATE.test || {};
  const meta = document.getElementById('td-meta-full');
  const zone = document.getElementById('td-zone-full');
  const previewHost = document.getElementById('td-full-preview');
  // Reset preview host between renders so toggling mode doesn't leak players.
  if (previewHost) previewHost.innerHTML = '';

  if (t.full_audio_storage_path) {
    const mins = t.full_audio_duration_seconds
      ? Math.round(t.full_audio_duration_seconds / 60) : '?';
    const mb   = t.full_audio_size_bytes
      ? (t.full_audio_size_bytes / (1024 * 1024)).toFixed(1) : '?';
    meta.textContent = `${t.full_audio_storage_path} · ${mins} min · ${mb} MB`;
    meta.hidden = false;
    zone.classList.add('has-file');

    // Sprint 13.4.3.2 — render <audio> preview so admin can verify
    // the upload before publishing.
    const signed = (STATE.signedUrls && STATE.signedUrls.full) || {};
    if (previewHost && signed.signed_url) {
      previewHost.innerHTML = `
        <div class="td-audio-preview">
          <audio controls preload="metadata"
                 src="${escapeHtml(signed.signed_url)}"
                 class="td-audio-player">
            Trình duyệt không hỗ trợ HTML5 audio.
          </audio>
          <button type="button" class="td-btn td-btn-ghost td-replace-btn"
                  id="td-full-replace">Tải lại audio</button>
        </div>
      `;
      const replaceBtn = previewHost.querySelector('#td-full-replace');
      if (replaceBtn) {
        replaceBtn.addEventListener('click', () => {
          document.getElementById('td-file-full').click();
        });
      }
    }
  } else {
    meta.hidden = true;
    zone.classList.remove('has-file');
  }
}


function renderPartsGrid() {
  const host = document.getElementById('td-parts-grid');
  host.innerHTML = '';
  const signedSections = (STATE.signedUrls && STATE.signedUrls.sections) || [];
  for (let n = 1; n <= 4; n++) {
    const section = STATE.sections.find((s) => s.section_num === n) || {};
    const hasAudio = !!section.audio_storage_path;
    const signed = signedSections.find((s) => s.section_num === n) || {};
    const card = document.createElement('label');
    card.className = 'td-dropzone' + (hasAudio ? ' has-file' : '');
    card.dataset.section = String(n);
    const audioBlock = (hasAudio && signed.signed_url) ? `
      <audio controls preload="none"
             src="${escapeHtml(signed.signed_url)}"
             class="td-audio-player"
             onclick="event.stopPropagation()">
        Trình duyệt không hỗ trợ HTML5 audio.
      </audio>
    ` : '';
    card.innerHTML = `
      <h3>Section ${n}</h3>
      <div class="td-section-meta">${escapeHtml(section.title || '—')}</div>
      <div class="td-file-meta" ${hasAudio ? '' : 'hidden'}>${
        hasAudio ? escapeHtml(section.audio_storage_path) : ''
      }</div>
      ${audioBlock}
      <input type="file" id="td-file-part-${n}" accept=".mp3,audio/mpeg" />
    `;
    const input = card.querySelector('input[type=file]');
    input.addEventListener('change', (e) => onPartAudioPick(n, e));
    // Sprint 13.4.3.2 — wire dnd per card (the grid rebuilds on every
    // render, so we can't attach once at init like the full zone).
    attachDropZoneHandlers(card, (file) => uploadPartAudio(n, file));
    host.appendChild(card);
  }
  // Also render the assembled-audio preview if present.
  renderAssembledPreview();
}


function renderAssembledPreview() {
  const host = document.getElementById('td-assembled-preview');
  if (!host) return;
  const assembled = (STATE.signedUrls && STATE.signedUrls.assembled) || {};
  if (!assembled.signed_url) {
    host.innerHTML = '';
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.innerHTML = `
    <h3 style="font-size:var(--av-fs-base); margin: var(--av-space-3) 0 4px;">
      Assembled audio preview
    </h3>
    <div class="td-audio-preview">
      <audio controls preload="metadata"
             src="${escapeHtml(assembled.signed_url)}"
             class="td-audio-player">
        Trình duyệt không hỗ trợ HTML5 audio.
      </audio>
    </div>
  `;
}


function renderSectionsList() {
  const host = document.getElementById('td-sections-list');
  host.innerHTML = (STATE.sections || []).map((s) => {
    const audioMark = s.audio_storage_path ? '✓' : '·';
    return `
      <div class="td-section-card">
        <h3>S${s.section_num}: ${escapeHtml(s.title || '—')}</h3>
        <div class="td-section-meta">
          ${audioMark} audio · ${s.exercise_count || 0} exercises · status=${escapeHtml(s.status || 'draft')}
        </div>
      </div>
    `;
  }).join('');
}


function renderCuePoints() {
  const wrap = document.getElementById('td-cue-wrap');
  const tbody = document.getElementById('td-cue-tbody');
  const cues = (STATE.test || {}).cue_points || [];
  if (!cues.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  tbody.innerHTML = cues.map((c) => `
    <tr>
      <td>${escapeHtml(c.type)}</td>
      <td>${c.section_num !== undefined ? c.section_num : '—'}</td>
      <td>${typeof c.timestamp_seconds === 'number' ? c.timestamp_seconds.toFixed(2) : '—'}</td>
    </tr>
  `).join('');
}


function renderPublishGate() {
  const t = STATE.test || {};
  const allowed = canPublishClient(t);
  const btn = document.getElementById('td-publish-btn');
  btn.disabled = !allowed.ok;
  const hint = document.getElementById('td-publish-hint');
  hint.textContent = allowed.ok
    ? 'Audio sẵn sàng — có thể publish.'
    : (allowed.reason || 'Cần full audio HOẶC parts_auto_assembled đã assembled.');
}


function canPublishClient(t) {
  // Sprint 13.4.3 client-side mirror of services.listening_audio.can_publish.
  // Server-side is authoritative; this just disables the button preemptively.
  const mode = t.audio_assembly_mode;
  if (mode === 'full_premixed' && t.full_audio_storage_path) {
    return { ok: true };
  }
  if (mode === 'parts_auto_assembled' && t.assembled_audio_storage_path) {
    return { ok: true };
  }
  if (mode === 'parts_only') {
    return { ok: false, reason: 'Mode parts_only không support full test.' };
  }
  return { ok: false, reason: 'Cần full audio HOẶC parts_auto_assembled đã assembled.' };
}


function refreshAssembleButton() {
  const ready = STATE.sections.filter((s) => s.audio_storage_path).length;
  const btn = document.getElementById('td-assemble');
  btn.disabled = ready < 4;
  if (ready < 4) {
    btn.textContent = `Render & assemble (cần ${4 - ready} part nữa)`;
  } else {
    btn.textContent = 'Render & assemble (4 parts → 1 audio)';
  }
}


// ── Mode toggle ─────────────────────────────────────────────────────────────


async function onModeChange(e) {
  const mode = e.target.value;
  if (!mode) return;
  const errEl = document.getElementById('td-mode-error');
  errEl.hidden = true;

  // Sprint 13.4.3.1 — selection-driven render. The previous flow
  // PATCHed first then re-rendered from the persisted row, which left
  // the upload UI hidden when the backend rejected the toggle (412
  // on first selection because no audio was uploaded yet). Now we
  // render the upload UI immediately and persist the mode in the
  // background; if the PATCH fails the UI still works (the upload
  // endpoint auto-sets the mode again on success — Sprint 13.4.3).
  if (STATE.test) STATE.test.audio_assembly_mode = mode;
  renderModeUI(mode);
  renderPublishGate();

  try {
    await window.api.patch(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/audio/mode`,
      { mode },
    );
  } catch (e) {
    errEl.textContent = e && e.message
      ? `Lưu mode thất bại (UI vẫn dùng được): ${e.message}`
      : 'Lưu mode thất bại — sẽ thử lại khi upload audio.';
    errEl.hidden = false;
  }
}


// ── Audio uploads ───────────────────────────────────────────────────────────


async function onFullAudioPick(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await uploadFullAudio(file);
}


async function uploadFullAudio(file) {
  hideError();
  try {
    const fd = new FormData();
    fd.append('audio', file);
    await window.api.upload(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/audio/full`,
      fd,
    );
    await fetchTest();
  } catch (e) {
    showError(e && e.message ? e.message : 'Upload full audio thất bại.');
  }
}


async function onPartAudioPick(sectionNum, e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  await uploadPartAudio(sectionNum, file);
}


async function uploadPartAudio(sectionNum, file) {
  hideError();
  try {
    const fd = new FormData();
    fd.append('audio', file);
    await window.api.upload(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/audio/section/${sectionNum}`,
      fd,
    );
    await fetchTest();
  } catch (e) {
    showError(e && e.message ? e.message : `Upload section ${sectionNum} thất bại.`);
  }
}


// ── Assemble ────────────────────────────────────────────────────────────────


async function onAssemble() {
  const btn = document.getElementById('td-assemble');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang render & assemble… (~30-60s)';
  hideError();
  try {
    await window.api.post(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/audio/assemble`,
      {},
    );
    await fetchTest();
  } catch (e) {
    showError(e && e.message ? e.message : 'Assemble thất bại.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}


// ── Status + delete ─────────────────────────────────────────────────────────


async function onStatus(newStatus) {
  hideError();
  try {
    await window.api.patch(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/status`,
      { status: newStatus },
    );
    await fetchTest();
  } catch (e) {
    showError(e && e.message ? e.message : `Đổi sang ${newStatus} thất bại.`);
  }
}


async function onDelete() {
  if (!window.confirm('Xác nhận xoá test này? Sẽ archive 4 section rows kèm theo.')) {
    return;
  }
  hideError();
  try {
    await window.api.delete(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}`,
    );
    window.location.href = '/pages/admin/listening/tests.html';
  } catch (e) {
    showError(e && e.message ? e.message : 'Xoá thất bại.');
  }
}


// Sprint 13.5.4 — hard delete with double confirmation: a generic
// confirm() then a test_id match prompt(). Both must pass before
// the irreversible DELETE fires.
async function onHardDelete() {
  const shortName = (STATE.test && STATE.test.test_id) || '';
  if (!shortName) {
    showError('Không xác định được test_id — không thể xoá vĩnh viễn.');
    return;
  }
  if (!window.confirm(
    'Xác nhận XOÁ VĨNH VIỄN test? '
    + 'Tất cả data + audio + history attempts sẽ mất. '
    + 'Không thể recover.',
  )) {
    return;
  }
  const userInput = window.prompt(
    `Nhập chính xác test ID "${shortName}" để xác nhận:`,
  );
  if (userInput !== shortName) {
    window.alert('Test ID không khớp — huỷ xoá.');
    return;
  }
  hideError();
  try {
    await window.api.delete(
      `/admin/listening/tests/${encodeURIComponent(STATE.testId)}/hard`,
    );
    window.location.href = '/pages/admin/listening/tests.html';
  } catch (e) {
    showError(e && e.message ? e.message : 'Hard delete thất bại.');
  }
}


// ── Helpers ────────────────────────────────────────────────────────────────


function setLoading(busy) {
  document.getElementById('td-loading').hidden = !busy;
}


function showError(msg) {
  const el = document.getElementById('td-error');
  el.textContent = msg;
  el.hidden = false;
}


function hideError() {
  document.getElementById('td-error').hidden = true;
}


function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
