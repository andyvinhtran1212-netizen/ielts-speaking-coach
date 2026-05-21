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
  testId:    null,         // UUID from ?id=
  test:      null,         // listening_tests row
  sections:  [],           // listening_content rows
};


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
  document.getElementById('td-assemble').addEventListener('click', onAssemble);
  document.getElementById('td-file-full').addEventListener('change', onFullAudioPick);

  fetchTest();
}


async function fetchTest() {
  setLoading(true);
  hideError();
  try {
    const res = await window.api.get(`/admin/listening/tests/${encodeURIComponent(STATE.testId)}`);
    STATE.test = res;
    STATE.sections = res.sections || [];
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
  if (t.full_audio_storage_path) {
    const mins = t.full_audio_duration_seconds
      ? Math.round(t.full_audio_duration_seconds / 60) : '?';
    const mb   = t.full_audio_size_bytes
      ? (t.full_audio_size_bytes / (1024 * 1024)).toFixed(1) : '?';
    meta.textContent = `${t.full_audio_storage_path} · ${mins} min · ${mb} MB`;
    meta.hidden = false;
    zone.classList.add('has-file');
  } else {
    meta.hidden = true;
    zone.classList.remove('has-file');
  }
}


function renderPartsGrid() {
  const host = document.getElementById('td-parts-grid');
  host.innerHTML = '';
  for (let n = 1; n <= 4; n++) {
    const section = STATE.sections.find((s) => s.section_num === n) || {};
    const hasAudio = !!section.audio_storage_path;
    const card = document.createElement('label');
    card.className = 'td-dropzone' + (hasAudio ? ' has-file' : '');
    card.dataset.section = String(n);
    card.innerHTML = `
      <h3>Section ${n}</h3>
      <div class="td-section-meta">${escapeHtml(section.title || '—')}</div>
      <div class="td-file-meta" ${hasAudio ? '' : 'hidden'}>${
        hasAudio
          ? escapeHtml(section.audio_storage_path)
          : ''
      }</div>
      <input type="file" id="td-file-part-${n}" accept=".mp3,audio/mpeg" />
    `;
    const input = card.querySelector('input[type=file]');
    input.addEventListener('change', (e) => onPartAudioPick(n, e));
    host.appendChild(card);
  }
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
