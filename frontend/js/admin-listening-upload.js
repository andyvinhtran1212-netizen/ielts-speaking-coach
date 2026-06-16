/**
 * frontend/js/admin-listening-upload.js — Sprint 13.2
 * (DEBT-ADMIN-LISTENING-AUTHORING 2/N).
 *
 * Upload UI for /pages/admin/listening/upload.html. Two modes:
 *   - single: one MP3 + one metadata form → POST /admin/listening/upload
 *   - bulk:   1-20 MP3s + per-file metadata accordion → POST /admin/listening/upload/bulk
 *
 * Both modes share:
 *   - drop zone + click-to-select file pick
 *   - client-side duration probe via <audio>.loadedmetadata
 *   - validation preview POST /admin/listening/upload/validate before submit
 *   - inline error/warning rendering (errors block submit, warnings allow)
 */

const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const $  = (id) => document.getElementById(id);

const BULK_MAX = 20;

const STATE = {
  mode:      'single',
  singleFile: null,
  bulkFiles:  [],  // list of {file, meta}
};


function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function showBanner(text, kind = 'error') {
  showToast(text, kind, { persist: true });
}


function hideBanner() {
  clearToasts();
}


// ── Mode toggle ─────────────────────────────────────────────────────────────


function setMode(mode) {
  STATE.mode = mode;
  $('up-mode-single').classList.toggle('is-active', mode === 'single');
  $('up-mode-bulk').classList.toggle('is-active',   mode === 'bulk');
  $('up-mode-single').setAttribute('aria-selected', mode === 'single' ? 'true' : 'false');
  $('up-mode-bulk').setAttribute('aria-selected',   mode === 'bulk'   ? 'true' : 'false');
  $('up-single-mode').hidden = mode !== 'single';
  $('up-bulk-mode').hidden   = mode !== 'bulk';
  hideBanner();
}


// ── Client-side duration probe ──────────────────────────────────────────────


function probeDuration(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
      audio.addEventListener('loadedmetadata', () => {
        const d = Number.isFinite(audio.duration) ? Math.round(audio.duration) : null;
        cleanup();
        resolve(d);
      });
      audio.addEventListener('error', () => { cleanup(); resolve(null); });
      // 5s safety fallback — some MP3 variants don't fire loadedmetadata.
      setTimeout(() => { cleanup(); resolve(null); }, 5000);
    } catch {
      resolve(null);
    }
  });
}


function humanSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}


// ── Dropzone wiring (shared) ───────────────────────────────────────────────


function wireDropzone(dz, fileInput, onPicked) {
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  dz.addEventListener('dragover', (e) => {
    e.preventDefault(); dz.classList.add('is-dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('is-dragover');
    if (e.dataTransfer && e.dataTransfer.files) onPicked(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files) onPicked(Array.from(fileInput.files));
  });
}


// ── Issues rendering (shared by single + bulk preview) ─────────────────────


function renderIssues(containerEl, errors, warnings) {
  const parts = [];
  for (const e of (errors || [])) {
    parts.push(`<div class="up-issue is-error" data-code="${escapeHtml(e.code)}">⚠ ${escapeHtml(e.message)}</div>`);
  }
  for (const w of (warnings || [])) {
    parts.push(`<div class="up-issue is-warning" data-code="${escapeHtml(w.code)}">⚑ ${escapeHtml(w.message)}</div>`);
  }
  if (!parts.length) {
    containerEl.hidden = true;
    containerEl.innerHTML = '';
    return;
  }
  containerEl.innerHTML = parts.join('');
  containerEl.hidden = false;
}


// ── Single mode ─────────────────────────────────────────────────────────────


function readSingleForm() {
  return {
    title:               $('up-s-title').value.trim(),
    transcript:          $('up-s-transcript').value,
    accent_tag:          $('up-s-accent').value,
    cefr_level:          $('up-s-cefr').value,
    ielts_section:       Number($('up-s-section').value),
    topic_tags:          $('up-s-tags').value,  // comma string for single endpoint
    is_premium:          $('up-s-premium').checked,
    external_license:    $('up-s-license').value.trim(),
    external_source_url: $('up-s-source-url').value.trim(),
  };
}


function buildSingleFormData(file, meta) {
  const fd = new FormData();
  fd.append('audio_file', file);
  fd.append('title',               meta.title);
  fd.append('transcript',          meta.transcript);
  fd.append('accent_tag',          meta.accent_tag);
  fd.append('cefr_level',          meta.cefr_level);
  fd.append('ielts_section',       String(meta.ielts_section));
  if (meta.topic_tags) fd.append('topic_tags', meta.topic_tags);
  fd.append('is_premium',          meta.is_premium ? 'true' : 'false');
  if (meta.external_license)    fd.append('external_license',    meta.external_license);
  if (meta.external_source_url) fd.append('external_source_url', meta.external_source_url);
  return fd;
}


async function onSinglePicked(files) {
  if (!files.length) return;
  STATE.singleFile = files[0];
  const info = $('up-single-fileinfo');
  info.textContent = `${STATE.singleFile.name} · ${humanSize(STATE.singleFile.size)}`;
  info.hidden = false;
  const duration = await probeDuration(STATE.singleFile);
  if (duration) info.textContent += ` · ~${duration}s`;
  $('up-s-submit').disabled = true;  // require validate first
  renderIssues($('up-single-issues'), [], []);
}


async function onSingleValidate() {
  if (!STATE.singleFile) {
    showBanner('Hãy chọn file trước.', 'error'); return;
  }
  const meta = readSingleForm();
  const fd = buildSingleFormData(STATE.singleFile, meta);
  $('up-s-validate').disabled = true;
  try {
    const res = await window.api.upload('/admin/listening/upload/validate', fd);
    renderIssues($('up-single-issues'), res.errors, res.warnings);
    $('up-s-submit').disabled = !res.ok;
    if (res.ok && !(res.warnings || []).length) {
      showBanner('Validation passed — sẵn sàng tải lên.', 'success');
    } else if (res.ok) {
      showBanner('Có warning nhưng vẫn upload được.', 'info');
    } else {
      showBanner('Có lỗi validation — fix trước khi tải.', 'error');
    }
  } catch (e) {
    showBanner(`Validate thất bại: ${e.message || e}`, 'error');
  } finally {
    $('up-s-validate').disabled = false;
  }
}


async function onSingleSubmit() {
  if (!STATE.singleFile) {
    showBanner('Hãy chọn file trước.', 'error'); return;
  }
  const meta = readSingleForm();
  const fd = buildSingleFormData(STATE.singleFile, meta);
  $('up-s-submit').disabled = true;
  $('up-s-validate').disabled = true;
  try {
    const res = await window.api.upload('/admin/listening/upload', fd);
    if (res && res.content_id) {
      window.location.href = `/pages/admin/listening/content-detail.html?id=${encodeURIComponent(res.content_id)}`;
    } else {
      showBanner('Upload trả về dạng không hợp lệ.', 'error');
    }
  } catch (e) {
    showBanner(`Upload thất bại: ${e.message || e}`, 'error');
    $('up-s-submit').disabled = false;
  } finally {
    $('up-s-validate').disabled = false;
  }
}


// ── Bulk mode ───────────────────────────────────────────────────────────────


function defaultBulkMeta(file) {
  return {
    title:               (file.name || 'listening').replace(/\.mp3$/i, ''),
    transcript:          '',
    accent_tag:          'us_general',
    cefr_level:          'B2',
    ielts_section:       1,
    topic_tags:          [],
    is_premium:          false,
    external_license:    '',
    external_source_url: '',
  };
}


function renderBulkList() {
  const list = $('up-bulk-list');
  list.innerHTML = STATE.bulkFiles.map((entry, i) => `
    <details class="up-bulk-item" data-bulk-idx="${i}" ${i === 0 ? 'open' : ''}>
      <summary>
        <span class="up-bulk-status-pill" data-bulk-status="${i}">…</span>
        <span>${escapeHtml(entry.file.name)}</span>
        <span style="color: var(--av-text-muted);">· ${humanSize(entry.file.size)}</span>
      </summary>
      <div class="up-bulk-item-fields">
        <div class="up-field">
          <label>Title</label>
          <input type="text" data-bulk-field="title" value="${escapeHtml(entry.meta.title)}" />
        </div>
        <div class="up-field">
          <label>Transcript</label>
          <textarea data-bulk-field="transcript">${escapeHtml(entry.meta.transcript)}</textarea>
        </div>
        <div class="up-field-pair-3">
          <div class="up-field">
            <label>Accent</label>
            <select data-bulk-field="accent_tag">
              ${['us_general','uk_rp','au','ca','other'].map((v) =>
                `<option value="${v}" ${entry.meta.accent_tag === v ? 'selected' : ''}>${v}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="up-field">
            <label>CEFR</label>
            <select data-bulk-field="cefr_level">
              ${['A2','B1','B2','C1','C2'].map((v) =>
                `<option value="${v}" ${entry.meta.cefr_level === v ? 'selected' : ''}>${v}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="up-field">
            <label>IELTS section</label>
            <select data-bulk-field="ielts_section">
              ${[1,2,3,4].map((v) =>
                `<option value="${v}" ${entry.meta.ielts_section === v ? 'selected' : ''}>${v}</option>`,
              ).join('')}
            </select>
          </div>
        </div>
        <div class="up-field">
          <label>Topic tags (phân cách bằng dấu phẩy)</label>
          <input type="text" data-bulk-field="topic_tags"
                 value="${escapeHtml((entry.meta.topic_tags || []).join(', '))}" />
        </div>
        <div class="up-checkbox-row">
          <input type="checkbox" data-bulk-field="is_premium"
                 ${entry.meta.is_premium ? 'checked' : ''} />
          <label style="margin: 0; font-size: var(--av-fs-sm); color: var(--av-text-primary); text-transform: none; letter-spacing: 0;">
            Premium
          </label>
        </div>
        <div class="up-field-pair-2">
          <div class="up-field">
            <label>External license</label>
            <input type="text" data-bulk-field="external_license"
                   value="${escapeHtml(entry.meta.external_license)}" />
          </div>
          <div class="up-field">
            <label>External source URL</label>
            <input type="url" data-bulk-field="external_source_url"
                   value="${escapeHtml(entry.meta.external_source_url)}" />
          </div>
        </div>
        <div class="up-issues" data-bulk-issues="${i}" hidden></div>
      </div>
    </details>
  `).join('');
}


function bindBulkFieldEvents() {
  $('up-bulk-list').addEventListener('input', (e) => {
    const wrap = e.target.closest('[data-bulk-idx]');
    if (!wrap) return;
    const idx = Number(wrap.dataset.bulkIdx);
    const field = e.target.dataset.bulkField;
    if (!field || !STATE.bulkFiles[idx]) return;
    const meta = STATE.bulkFiles[idx].meta;
    if (e.target.type === 'checkbox') {
      meta[field] = e.target.checked;
    } else if (field === 'ielts_section') {
      meta[field] = Number(e.target.value);
    } else if (field === 'topic_tags') {
      meta[field] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      meta[field] = e.target.value;
    }
  });
}


function onBulkApplyAll() {
  if (STATE.bulkFiles.length < 2) return;
  const base = STATE.bulkFiles[0].meta;
  for (let i = 1; i < STATE.bulkFiles.length; i += 1) {
    STATE.bulkFiles[i].meta = {
      ...STATE.bulkFiles[i].meta,
      accent_tag:          base.accent_tag,
      cefr_level:          base.cefr_level,
      ielts_section:       base.ielts_section,
      topic_tags:          [...(base.topic_tags || [])],
      is_premium:          base.is_premium,
      external_license:    base.external_license,
      external_source_url: base.external_source_url,
      // Title + transcript intentionally NOT copied — each file is unique.
    };
  }
  renderBulkList();
}


async function onBulkPicked(files) {
  const accepted = files.slice(0, BULK_MAX);
  if (files.length > BULK_MAX) {
    showBanner(`Tối đa ${BULK_MAX} file — bỏ qua ${files.length - BULK_MAX} file dư.`, 'info');
  }
  STATE.bulkFiles = accepted.map((file) => ({ file, meta: defaultBulkMeta(file) }));
  renderBulkList();
  $('up-bulk-quickbar').hidden = STATE.bulkFiles.length < 2;
  $('up-b-validate').disabled = STATE.bulkFiles.length === 0;
  $('up-b-submit').disabled = true;  // require validate first
  $('up-bulk-results').hidden = true;
}


function buildBulkValidateFormData(entry) {
  const fd = new FormData();
  fd.append('audio_file', entry.file);
  fd.append('title',               entry.meta.title);
  fd.append('transcript',          entry.meta.transcript);
  fd.append('accent_tag',          entry.meta.accent_tag);
  fd.append('cefr_level',          entry.meta.cefr_level);
  fd.append('ielts_section',       String(entry.meta.ielts_section));
  if ((entry.meta.topic_tags || []).length) {
    fd.append('topic_tags', (entry.meta.topic_tags || []).join(','));
  }
  fd.append('is_premium', entry.meta.is_premium ? 'true' : 'false');
  if (entry.meta.external_license)    fd.append('external_license',    entry.meta.external_license);
  if (entry.meta.external_source_url) fd.append('external_source_url', entry.meta.external_source_url);
  return fd;
}


async function onBulkValidate() {
  if (!STATE.bulkFiles.length) return;
  $('up-b-validate').disabled = true;
  let allOk = true;
  for (let i = 0; i < STATE.bulkFiles.length; i += 1) {
    const entry = STATE.bulkFiles[i];
    const pill = document.querySelector(`[data-bulk-status="${i}"]`);
    const issuesEl = document.querySelector(`[data-bulk-issues="${i}"]`);
    try {
      const res = await window.api.upload(
        '/admin/listening/upload/validate', buildBulkValidateFormData(entry),
      );
      renderIssues(issuesEl, res.errors, res.warnings);
      if (pill) {
        pill.textContent = res.ok ? (res.warnings && res.warnings.length ? 'warn' : 'ok') : 'lỗi';
        pill.classList.remove('is-ok', 'is-fail');
        pill.classList.add(res.ok ? 'is-ok' : 'is-fail');
      }
      if (!res.ok) allOk = false;
    } catch (e) {
      if (pill) { pill.textContent = 'lỗi'; pill.classList.add('is-fail'); }
      if (issuesEl) renderIssues(issuesEl, [{code: 'validate_failed', message: e.message || String(e)}], []);
      allOk = false;
    }
  }
  $('up-b-validate').disabled = false;
  $('up-b-submit').disabled = !allOk;
  showBanner(allOk ? 'Validation passed — sẵn sàng tải lên.' : 'Có file fail validation — fix trước khi tải.',
             allOk ? 'success' : 'error');
}


async function onBulkSubmit() {
  if (!STATE.bulkFiles.length) return;
  $('up-b-submit').disabled = true;
  $('up-b-validate').disabled = true;
  try {
    const fd = new FormData();
    const manifestItems = [];
    for (const entry of STATE.bulkFiles) {
      fd.append('files', entry.file);
      manifestItems.push({
        filename:            entry.file.name,
        title:               entry.meta.title,
        transcript:          entry.meta.transcript,
        accent_tag:          entry.meta.accent_tag,
        cefr_level:          entry.meta.cefr_level,
        ielts_section:       entry.meta.ielts_section,
        topic_tags:          entry.meta.topic_tags || [],
        is_premium:          entry.meta.is_premium,
        external_license:    entry.meta.external_license || null,
        external_source_url: entry.meta.external_source_url || null,
      });
    }
    fd.append('manifest', JSON.stringify({items: manifestItems}));
    const res = await window.api.upload('/admin/listening/upload/bulk', fd);
    renderBulkResults(res);
    showBanner(
      `Bulk upload: ${res.succeeded}/${res.total} thành công.`,
      res.failed === 0 ? 'success' : 'info',
    );
  } catch (e) {
    showBanner(`Bulk upload thất bại: ${e.message || e}`, 'error');
    $('up-b-submit').disabled = false;
  } finally {
    $('up-b-validate').disabled = false;
  }
}


function renderBulkResults(res) {
  const tbody = $('up-bulk-results-tbody');
  tbody.innerHTML = (res.results || []).map((r) => {
    const status = r.ok
      ? `<span class="up-bulk-status-pill is-ok">ok</span>`
      : `<span class="up-bulk-status-pill is-fail">lỗi</span>`;
    const detail = r.ok
      ? `<a href="/pages/admin/listening/content-detail.html?id=${encodeURIComponent(r.content_id)}"
             style="font-family: var(--av-font-mono); font-size: var(--av-fs-xs);">
           ${escapeHtml(r.content_id)}
         </a>`
      : (r.errors || []).map((e) => escapeHtml(e.message)).join('<br>');
    return `
      <tr>
        <td style="font-family: var(--av-font-mono);">${escapeHtml(r.filename)}</td>
        <td>${status}</td>
        <td>${detail}</td>
      </tr>
    `;
  }).join('');
  $('up-bulk-results').hidden = false;
}


// ── Wire everything ─────────────────────────────────────────────────────────


function wire() {
  $('up-mode-single').addEventListener('click', () => setMode('single'));
  $('up-mode-bulk').addEventListener('click',   () => setMode('bulk'));

  wireDropzone($('up-single-dz'), $('up-single-file'), onSinglePicked);
  wireDropzone($('up-bulk-dz'),   $('up-bulk-files'),  onBulkPicked);

  $('up-s-validate').addEventListener('click', onSingleValidate);
  $('up-s-submit').addEventListener('click', onSingleSubmit);

  $('up-b-validate').addEventListener('click', onBulkValidate);
  $('up-b-submit').addEventListener('click', onBulkSubmit);
  $('up-bulk-apply-all').addEventListener('click', onBulkApplyAll);

  bindBulkFieldEvents();
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', wire);
}
