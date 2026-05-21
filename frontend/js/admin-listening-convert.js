/**
 * admin-listening-convert.js — Sprint 13.4 (DEBT-ADMIN-LISTENING-AUTHORING 6/N).
 *
 * Drives the 3-step convert flow on /pages/admin/listening/convert.html:
 *   1. Upload Question Paper + Script+AnswerKey (both .docx, ≤5MB each)
 *   2. POST /admin/listening/convert → render preview (metadata + 4
 *      sections + warnings/errors)
 *   3. POST /admin/listening/convert/commit → 1 listening_tests row + 4
 *      listening_content rows + N listening_exercises rows
 *
 * Errors block commit (Sprint 13.2/13.3 pattern). Warnings are
 * informational and the commit button stays enabled.
 */

// Sprint 13.4.1 hotfix — bootstrap supabase at module load so the api
// helper's _getAuthToken() returns a token. The constants mirror
// admin-listening-upload.js (Sprint 13.2) + admin-listening-render.js
// (Sprint 13.3); the convert + tests pages introduced in 13.4 forgot
// to bootstrap and ate 401 on every POST.
const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const STATE = {
  qpFile:  null,
  saFile:  null,
  preview: null,         // parsed envelope from POST /convert
};

const MAX_BYTES = 5 * 1024 * 1024;


// ── DOM bootstrap ───────────────────────────────────────────────────────────


function init() {
  bindDropzone('qp', (file) => { STATE.qpFile = file; renderFile('qp', file); refreshParseButton(); });
  bindDropzone('sa', (file) => { STATE.saFile = file; renderFile('sa', file); refreshParseButton(); });

  document.getElementById('cv-parse').addEventListener('click', onParse);
  document.getElementById('cv-commit').addEventListener('click', onCommit);
  document.getElementById('cv-reset').addEventListener('click', resetFlow);
}


function bindDropzone(zoneKey, onFileSet) {
  const zone  = document.getElementById(`cv-zone-${zoneKey}`);
  const input = document.getElementById(`cv-file-${zoneKey}`);

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFileSet(file);
  });

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onFileSet(file);
  });
}


function renderFile(zoneKey, file) {
  const zone = document.getElementById(`cv-zone-${zoneKey}`);
  const meta = document.getElementById(`cv-meta-${zoneKey}`);
  const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
  meta.textContent = `${file.name} · ${sizeMb} MB`;
  meta.hidden = false;
  zone.classList.add('has-file');
}


function refreshParseButton() {
  const btn = document.getElementById('cv-parse');
  btn.disabled = !(STATE.qpFile && STATE.saFile);
}


// ── Step 2: parse ───────────────────────────────────────────────────────────


async function onParse() {
  const errBanner = document.getElementById('cv-parse-error');
  errBanner.hidden = true;
  errBanner.textContent = '';

  if (!STATE.qpFile || !STATE.saFile) return;
  if (STATE.qpFile.size > MAX_BYTES || STATE.saFile.size > MAX_BYTES) {
    showParseError('File vượt 5MB — kiểm tra lại bundle.');
    return;
  }
  if (!STATE.qpFile.name.toLowerCase().endsWith('.docx') ||
      !STATE.saFile.name.toLowerCase().endsWith('.docx')) {
    showParseError('Cả hai file phải là .docx.');
    return;
  }

  const fd = new FormData();
  fd.append('question_paper',   STATE.qpFile);
  fd.append('script_answerkey', STATE.saFile);

  setButtonBusy('cv-parse', true, 'Đang phân tích…');
  try {
    const result = await window.api.upload('/admin/listening/convert', fd);
    // Sprint 13.4.1 hotfix — null-check before nested access. On 401
    // the api helper redirects (and may return undefined here); on
    // unexpected server shape we surface a clean error instead of a
    // "Cannot read properties of null" stack trace.
    if (!result || typeof result !== 'object' || !result.test_metadata) {
      showParseError('Phản hồi server không hợp lệ — vui lòng thử lại hoặc kiểm tra Railway logs.');
      return;
    }
    STATE.preview = result;
    renderPreview(result);
  } catch (e) {
    showParseError(e && e.message ? e.message : 'Lỗi không mong đợi khi phân tích.');
  } finally {
    setButtonBusy('cv-parse', false, 'Phân tích đề');
  }
}


function showParseError(msg) {
  const banner = document.getElementById('cv-parse-error');
  banner.textContent = msg;
  banner.hidden = false;
}


function renderPreview(result) {
  const meta = result.test_metadata || {};
  document.getElementById('cv-meta-test-id').textContent = meta.test_id || '—';
  document.getElementById('cv-meta-version').textContent = meta.version || '1.0';
  document.getElementById('cv-meta-band').textContent    =
    meta.band_target !== null && meta.band_target !== undefined ? String(meta.band_target) : '—';
  document.getElementById('cv-meta-accents').textContent =
    (meta.accent_profile || []).join(', ') || '—';
  document.getElementById('cv-meta-words').textContent   =
    meta.total_words ? String(meta.total_words) : '—';
  document.getElementById('cv-meta-source').textContent  =
    meta.source_format || 'cambridge_ielts_docx';

  // Sections accordion
  const sectionsHost = document.getElementById('cv-sections');
  sectionsHost.innerHTML = '';
  (result.sections || []).forEach((sec, idx) => {
    sectionsHost.appendChild(renderSectionCard(sec, idx === 0));
  });

  // Banners
  const warnBanner  = document.getElementById('cv-warnings');
  const errBanner   = document.getElementById('cv-errors');
  if ((result.warnings || []).length) {
    warnBanner.innerHTML = '<strong>Cảnh báo:</strong><ul>' +
      result.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>';
    warnBanner.hidden = false;
  } else {
    warnBanner.hidden = true;
  }
  if ((result.errors || []).length) {
    errBanner.innerHTML = '<strong>Lỗi:</strong><ul>' +
      result.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
    errBanner.hidden = false;
  } else {
    errBanner.hidden = true;
  }

  // Errors block commit; warnings do not (Sprint 13.2/13.3 contract).
  document.getElementById('cv-commit').disabled = (result.errors || []).length > 0;

  document.getElementById('cv-preview').hidden = false;
  document.getElementById('cv-results').hidden = true;
}


function renderSectionCard(sec, expanded) {
  const card = document.createElement('div');
  card.className = 'cv-section-card';

  const exTypes = (sec.exercises || []).map((e) => e.exercise_type);
  const exSummary = exTypes.length
    ? `${(sec.questions || []).length} Q · ${exTypes.length} exercises (${exTypes.join('/')})`
    : `${(sec.questions || []).length} Q · 0 exercises`;

  const head = document.createElement('div');
  head.className = 'cv-section-head';
  head.innerHTML = `
    <div>
      <div class="cv-section-title">Section ${sec.section_num}: ${escapeHtml(sec.theme || sec.title || 'Untitled')}</div>
      <div class="cv-section-meta">accent=${escapeHtml(sec.accent_tag)} · cefr=${escapeHtml(sec.cefr_level || '—')} · ${sec.word_count || 0} words</div>
    </div>
    <div class="cv-section-meta">${escapeHtml(exSummary)}</div>
  `;

  const body = document.createElement('div');
  body.className = 'cv-section-body';
  body.hidden = !expanded;

  const speakers = (sec.speakers || []).map(
    (s) => s.tag || `[${s.gender}-${s.accent}-${s.age || ''}]`,
  ).join(' · ');
  const transcriptPreview = (sec.transcript_clean || '').slice(0, 800);

  body.innerHTML = `
    <div><strong>Speakers:</strong> ${escapeHtml(speakers || '—')}</div>
    <div><strong>Exercises:</strong></div>
    <ul>
      ${(sec.exercises || []).map((e) =>
        `<li><code>${escapeHtml(e.exercise_type)}</code> · variant=<code>${escapeHtml(e.variant || '—')}</code> · ${(e.payload && e.payload.questions || []).length} Q</li>`,
      ).join('') || '<li>(chưa có exercises)</li>'}
    </ul>
    <div><strong>Transcript (clean) — 800 ký tự đầu:</strong></div>
    <div class="cv-transcript">${escapeHtml(transcriptPreview)}${(sec.transcript_clean || '').length > 800 ? '\n…' : ''}</div>
  `;

  head.addEventListener('click', () => { body.hidden = !body.hidden; });
  card.appendChild(head);
  card.appendChild(body);
  return card;
}


// ── Step 3: commit ──────────────────────────────────────────────────────────


async function onCommit() {
  if (!STATE.preview) return;
  setButtonBusy('cv-commit', true, 'Đang commit…');
  try {
    const body = {
      test_metadata: STATE.preview.test_metadata,
      sections:      STATE.preview.sections,
    };
    const result = await window.api.post('/admin/listening/convert/commit', body);
    // Sprint 13.4.1 hotfix — same defensive null-check as onParse.
    if (!result || typeof result !== 'object' || !result.test_id) {
      showParseError('Commit không trả về test_id — vui lòng kiểm tra Railway logs.');
      return;
    }
    renderResults(result);
  } catch (e) {
    showParseError(e && e.message ? e.message : 'Commit thất bại.');
  } finally {
    setButtonBusy('cv-commit', false, 'Tạo test + 4 sections');
  }
}


function renderResults(result) {
  document.getElementById('cv-results').hidden = false;

  const banner = document.getElementById('cv-results-banner');
  const list   = document.getElementById('cv-results-list');
  const warnings = document.getElementById('cv-results-warnings');

  banner.innerHTML =
    `<strong>Đã tạo test thành công.</strong> Test ID <code>${escapeHtml(result.test_id_external)}</code> · ${(result.content_ids || []).length} section · ${result.exercises_created || 0} exercises.`;

  list.innerHTML = `
    <div><a href="/pages/admin/listening/tests.html">→ Xem trong tests browser</a></div>
    <div><a href="/pages/admin/listening/index.html?test_id=${encodeURIComponent(result.test_id)}">→ Xem 4 section content rows</a></div>
  `;

  if ((result.failed_sections || []).length || (result.failed_exercises || []).length) {
    const fs = result.failed_sections || [];
    const fe = result.failed_exercises || [];
    warnings.innerHTML = `
      <strong>Một số phần bị lỗi (test row đã được tạo):</strong>
      <ul>
        ${fs.map((s) => `<li>Section ${s.section_num}: ${escapeHtml(s.error || 'unknown')}</li>`).join('')}
        ${fe.map((e) => `<li>Exercise s${e.section_num} #${e.order_num}: ${escapeHtml(e.error || 'unknown')}</li>`).join('')}
      </ul>
    `;
    warnings.hidden = false;
  } else {
    warnings.hidden = true;
  }
}


// ── Helpers ────────────────────────────────────────────────────────────────


function resetFlow() {
  STATE.qpFile = STATE.saFile = STATE.preview = null;
  document.getElementById('cv-file-qp').value = '';
  document.getElementById('cv-file-sa').value = '';
  ['qp', 'sa'].forEach((k) => {
    document.getElementById(`cv-zone-${k}`).classList.remove('has-file');
    const meta = document.getElementById(`cv-meta-${k}`);
    meta.hidden = true; meta.textContent = '';
  });
  document.getElementById('cv-preview').hidden = true;
  document.getElementById('cv-results').hidden = true;
  document.getElementById('cv-parse').disabled = true;
  document.getElementById('cv-commit').disabled = true;
}


function setButtonBusy(id, busy, label) {
  const btn = document.getElementById(id);
  btn.disabled = busy;
  if (label !== undefined) btn.textContent = label;
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
