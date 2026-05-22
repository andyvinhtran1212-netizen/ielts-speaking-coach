/**
 * audio-cutter.js — Sprint 13.6.
 *
 * Admin audio cutter UI. Drives ``/pages/admin/listening/audio-cutter.html``.
 *
 * Vanilla JS — no module imports. Wavesurfer.js v6 (UMD) is loaded
 * from the page's <script> tags and exposed at ``window.WaveSurfer``.
 * The Regions + Timeline plugins attach themselves to that global.
 *
 * Two backend endpoints power the workflow:
 *   * POST /admin/listening/tests/{id}/detect-silence
 *   * POST /admin/listening/tests/{id}/cut-audio
 *
 * State is intentionally kept on a single ``STATE`` object so a
 * future refactor can lift it onto a class without changing the
 * call sites.
 */

(function bootstrapSupabase() {
  // Same bootstrap pattern as tests-detail.html (Sprint 13.4.1 hotfix).
  var SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (_e) { /* swallow */ }
  }
})();


// ── State ──────────────────────────────────────────────────────────────────


const STATE = {
  tests:       [],
  selectedTestId: null,
  selectedTest:   null,
  wavesurfer:  null,
  regions:     [],          // mirror of the Wavesurfer Regions plugin's list
  // Sprint 13.6.1 — deep-link target. When the page is opened with
  // ``?test_id=<uuid>`` from tests-detail.html, we auto-select that
  // test and trigger Load Audio once the dropdown is populated.
  initialTestId: null,
};


// Sprint 13.6 — colour rotation for the 4 IELTS sections so the
// auto-detect output is scannable without reading the table.
const SECTION_REGION_COLORS = [
  'rgba(231, 76, 60, 0.25)',    // red    — S1 (Q1-10)
  'rgba(241, 196, 15, 0.25)',   // yellow — S2 (Q11-20)
  'rgba(46, 204, 113, 0.25)',   // green  — S3 (Q21-30)
  'rgba(52, 152, 219, 0.25)',   // blue   — S4 (Q31-40)
];


function $(id) { return document.getElementById(id); }


// ── Time + size helpers ────────────────────────────────────────────────────


function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sectionColor(index) {
  return SECTION_REGION_COLORS[index % SECTION_REGION_COLORS.length];
}


// ── Status helpers ─────────────────────────────────────────────────────────


function setSourceStatus(text, isError, action) {
  const el = $('ac-source-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('ac-error', !!isError);
  // Sprint 13.6.1 — actionable error UX. ``action`` shape: { href, text }.
  // Renders a sibling anchor so the admin can jump to the page that
  // fixes the missing prerequisite (e.g. upload full audio).
  if (action && action.href && action.text) {
    const link = document.createElement('a');
    link.href = action.href;
    link.textContent = action.text;
    link.className = 'ac-action-link';
    link.style.marginLeft = '8px';
    el.appendChild(link);
  }
}

function setExportStatus(text, isError) {
  const el = $('ac-export-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('ac-error', !!isError);
}


// ── Bootstrap ──────────────────────────────────────────────────────────────


function parseInitialTestId() {
  // Sprint 13.6.1 — accept ``?test_id=<uuid>`` so contextual links from
  // tests-detail open the cutter pre-filled with the right test.
  try {
    const params = new URLSearchParams(window.location.search || '');
    const raw = params.get('test_id');
    if (!raw) return null;
    // Defensive — only accept UUID-shaped strings so a malformed
    // query string can't crash the dropdown auto-select.
    if (!/^[0-9a-fA-F-]{8,}$/.test(raw)) return null;
    return raw;
  } catch (_e) {
    return null;
  }
}


async function init() {
  STATE.initialTestId = parseInitialTestId();
  await loadTests();
  bindHandlers();
  maybeAutoLoadFromQueryParam();
}


function maybeAutoLoadFromQueryParam() {
  const wanted = STATE.initialTestId;
  if (!wanted) return;
  const match = STATE.tests.find((t) => t.id === wanted);
  if (!match) {
    // Test id was passed but does not satisfy the full_premixed filter
    // applied in loadTests(). Surface a clear message instead of silent
    // no-op so the admin knows why nothing loaded.
    setSourceStatus(
      'Test trong URL không có full pre-mixed audio. Mở test trong tests-detail để upload audio đầy đủ trước.',
      true,
    );
    return;
  }
  const select = $('ac-test-select');
  if (select) {
    select.value = wanted;
    select.dispatchEvent(new Event('change'));
  }
  // Defer one tick so the change-handler has wired ``selectedTest``.
  setTimeout(() => { void onLoadAudio(); }, 0);
}


async function loadTests() {
  try {
    const res = await window.api.get('/admin/listening/tests');
    // Sprint 13.6 — only ``full_premixed`` tests are cuttable.
    const items = (res && res.items) || res || [];
    STATE.tests = items.filter(
      (t) => t.audio_assembly_mode === 'full_premixed'
            && t.full_audio_storage_path,
    );
    const select = $('ac-test-select');
    if (!select) return;
    STATE.tests.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.test_id || t.id} — ${t.title || ''}`;
      select.appendChild(opt);
    });
    if (!STATE.tests.length) {
      setSourceStatus(
        'Không có test nào với full_premixed audio. Upload audio đầy đủ trước.',
        true,
      );
    }
  } catch (e) {
    setSourceStatus(`Không tải được danh sách: ${e && e.message ? e.message : e}`, true);
  }
}


// ── Wavesurfer init + region drawing ───────────────────────────────────────


async function onLoadAudio() {
  const testId = STATE.selectedTestId;
  if (!testId) return;
  setSourceStatus('Đang lấy signed URL…', false);
  try {
    const res = await window.api.get(
      `/admin/listening/tests/${encodeURIComponent(testId)}/audio/signed-urls`,
    );
    // Sprint 13.6.1 — backend returns nested shape:
    //   { full: { signed_url, audio_storage_path, ... }, sections: [...], ... }
    // The original Sprint 13.6 implementation read ``res.full_audio_signed_url``
    // (a flat key that does not exist) and so always fell through to the
    // generic "Test không có full audio URL" branch even on the happy path.
    // Pin the nested key here — contract is covered by
    // test_signed_urls_returns_full_sections_assembled_bundle in the
    // backend suite.
    const url = (res && res.full && res.full.signed_url) || null;
    if (!url) {
      // Actionable error — link back to the test detail page so admin
      // can fix the missing prerequisite without copy-pasting the test
      // id manually.
      setSourceStatus(
        'Test chưa upload full pre-mixed audio. Mở test trong tests-detail để upload trước khi cắt.',
        true,
        { href: '/pages/admin/listening/tests.html', text: 'Mở danh sách tests →' },
      );
      return;
    }
    initWavesurfer(url);
  } catch (e) {
    setSourceStatus(`Load audio thất bại: ${e && e.message ? e.message : e}`, true);
  }
}


function initWavesurfer(audioUrl) {
  if (STATE.wavesurfer) {
    try { STATE.wavesurfer.destroy(); } catch (_e) { /* swallow */ }
    STATE.wavesurfer = null;
  }
  STATE.regions = [];
  $('ac-regions-tbody').innerHTML = '';
  $('ac-region-count').textContent = '0';

  if (!window.WaveSurfer) {
    setSourceStatus('Wavesurfer.js chưa load — refresh page.', true);
    return;
  }

  // Sprint 13.6 — Wavesurfer v6 attaches plugins as global classes on
  // ``window`` (e.g. ``window.WaveSurfer.regions``). We assemble the
  // instance with whichever plugins resolved at script-load time so a
  // CDN hiccup on one plugin doesn't kill the whole page.
  const plugins = [];
  if (window.WaveSurfer.regions) {
    plugins.push(window.WaveSurfer.regions.create({
      dragSelection: { slop: 5 },
    }));
  }
  if (window.WaveSurfer.timeline) {
    plugins.push(window.WaveSurfer.timeline.create({
      container: '#ac-timeline',
    }));
  }

  const ws = window.WaveSurfer.create({
    container:      '#ac-waveform',
    waveColor:      '#94a3b8',
    progressColor:  '#0f766e',
    cursorColor:    '#1e3a5f',
    height:         128,
    normalize:      true,
    responsive:     true,
    plugins:        plugins,
  });

  STATE.wavesurfer = ws;

  ws.on('ready', () => {
    $('ac-workspace').hidden = false;
    $('ac-total-time').textContent = formatTime(ws.getDuration());
    setSourceStatus(`Loaded (${formatTime(ws.getDuration())}).`, false);
  });
  ws.on('audioprocess', () => {
    $('ac-current-time').textContent = formatTime(ws.getCurrentTime());
  });
  ws.on('seek', () => {
    $('ac-current-time').textContent = formatTime(ws.getCurrentTime());
  });
  ws.on('play',   () => { $('ac-btn-play-pause').textContent = '⏸ Pause'; });
  ws.on('pause',  () => { $('ac-btn-play-pause').textContent = '▶ Play'; });
  ws.on('finish', () => { $('ac-btn-play-pause').textContent = '▶ Play'; });
  ws.on('region-created',  (region) => onRegionCreated(region));
  ws.on('region-updated',  (region) => updateRegionRow(region));
  ws.on('region-removed',  (region) => removeRegionRow(region));

  ws.load(audioUrl);
}


function onRegionCreated(region) {
  // Auto-label the first 4 regions as Section 1-4.
  if (STATE.regions.length < SECTION_REGION_COLORS.length) {
    const idx = STATE.regions.length;
    region.update({
      color: sectionColor(idx),
      data:  Object.assign({}, region.data, {
        label: (region.data && region.data.label) || `Section ${idx + 1}`,
      }),
    });
  } else {
    region.update({
      data: Object.assign({}, region.data, {
        label: (region.data && region.data.label) || `Segment ${STATE.regions.length + 1}`,
      }),
    });
  }
  STATE.regions.push(region);
  renderRegionsTable();
}


function updateRegionRow(region) {
  // Region drag/resize fires ``region-updated`` — rebuild the row so
  // the start/end/duration columns track the visual edit.
  renderRegionsTable();
}


function removeRegionRow(region) {
  STATE.regions = STATE.regions.filter((r) => r.id !== region.id);
  renderRegionsTable();
}


function renderRegionsTable() {
  const tbody = $('ac-regions-tbody');
  if (!tbody) return;
  const rows = STATE.regions.slice().sort((a, b) => a.start - b.start);
  tbody.innerHTML = rows.map((region, i) => {
    const label = (region.data && region.data.label) || `Segment ${i + 1}`;
    return `
      <tr data-region-id="${region.id}">
        <td>${i + 1}</td>
        <td>
          <input type="text"
                 class="ac-label-input"
                 data-region-id="${region.id}"
                 value="${escapeHtml(label)}"
                 maxlength="80" />
        </td>
        <td>${formatTime(region.start)}</td>
        <td>${formatTime(region.end)}</td>
        <td>${formatTime(region.end - region.start)}</td>
        <td>
          <button class="ac-btn ac-btn-play-region" data-region-id="${region.id}" type="button">▶</button>
          <button class="ac-btn ac-btn-delete-region" data-region-id="${region.id}" type="button">🗑</button>
        </td>
      </tr>
    `;
  }).join('');
  $('ac-region-count').textContent = String(STATE.regions.length);
}


function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function findRegion(regionId) {
  return STATE.regions.find((r) => r.id === regionId) || null;
}


// ── Auto-detect (calls backend silencedetect) ──────────────────────────────


// Sprint 13.6.2 — return the Wavesurfer v6 regions plugin instance,
// which exposes ``add(params)``, ``clear()``, ``list``, etc. The
// instance is attached to the wavesurfer at ``ws.regions`` (lowercase)
// by the v6 plugin loader. The plugin also wires static props
// ``addRegion`` + ``clearRegions`` onto the wavesurfer instance — but
// those expect ``this`` to be the wavesurfer instance (they read
// ``this.initialisedPluginList.regions`` internally). Sprint 13.6
// called them via ``.call(STATE.wavesurfer.regions, opts)`` which
// bound ``this`` to the plugin instance and crashed at
// ``this.initialisedPluginList.regions`` (the exact error Andy hit
// during 2026-05-22 dogfood). Using the plugin instance's own
// methods sidesteps the binding hazard entirely.
function getRegionsPlugin() {
  return (STATE.wavesurfer && STATE.wavesurfer.regions) || null;
}


async function onAutoDetect() {
  const testId = STATE.selectedTestId;
  if (!testId) return;
  const regionsPlugin = getRegionsPlugin();
  if (!regionsPlugin) {
    setExportStatus(
      'Regions plugin chưa load — hard refresh page rồi thử lại.',
      true,
    );
    return;
  }
  setExportStatus('Đang detect silence (10-30s)…', false);
  try {
    const res = await window.api.post(
      `/admin/listening/tests/${encodeURIComponent(testId)}/detect-silence`,
      {},
    );
    const boundaries = (res && res.boundaries) || [];
    if (boundaries.length === 0) {
      // Backend ran cleanly but found no gaps long enough to split on.
      // This happens on very tight mixes or when silence threshold is
      // too strict for the source material. Surface an actionable hint
      // instead of silently doing nothing — admin can still drop manual
      // segments with the "Thêm segment" button.
      setExportStatus(
        'Không tìm thấy gap đủ lớn để chia section. Dùng "+ Thêm segment" để tạo thủ công.',
        true,
      );
      return;
    }
    // Clear existing regions before laying down the auto-detected 4-up.
    regionsPlugin.clear();
    STATE.regions = [];
    boundaries.forEach((b, i) => {
      regionsPlugin.add({
        start:  b.start,
        end:    b.end,
        color:  sectionColor(i),
        drag:   true,
        resize: true,
        data:   { label: `Section ${i + 1}` },
      });
    });
    const gapCount = (res && res.silence_gaps_detected != null)
      ? res.silence_gaps_detected
      : '?';
    setExportStatus(
      `Detected ${gapCount} gaps → ${boundaries.length} sections.`,
      false,
    );
  } catch (e) {
    setExportStatus(`Detect thất bại: ${e && e.message ? e.message : e}`, true);
  }
}


// ── Manual region add ──────────────────────────────────────────────────────


function onAddRegion() {
  if (!STATE.wavesurfer) return;
  const current = STATE.wavesurfer.getCurrentTime();
  const duration = STATE.wavesurfer.getDuration();
  const end = Math.min(current + 30, duration);
  if (end - current < 1) {
    setExportStatus('Vị trí hiện tại quá gần cuối audio.', true);
    return;
  }
  const regionsPlugin = getRegionsPlugin();
  if (!regionsPlugin) {
    setExportStatus(
      'Regions plugin chưa load — hard refresh page rồi thử lại.',
      true,
    );
    return;
  }
  regionsPlugin.add({
    start:  current,
    end:    end,
    color:  sectionColor(STATE.regions.length),
    drag:   true,
    resize: true,
    data:   { label: `Segment ${STATE.regions.length + 1}` },
  });
}


// ── Export (calls backend cut) ─────────────────────────────────────────────


async function onExportAll() {
  if (!STATE.wavesurfer || !STATE.regions.length) {
    setExportStatus('Chưa có segment nào để export.', true);
    return;
  }
  const segments = STATE.regions
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((r) => ({
      label: (r.data && r.data.label) || 'Segment',
      start: r.start,
      end:   r.end,
    }));

  const confirmMsg =
    `Export ${segments.length} segments?\n\n`
    + segments.map((s, i) =>
        `${i + 1}. ${s.label} (${formatTime(s.start)} → ${formatTime(s.end)})`
      ).join('\n')
    + '\n\nCost: $0 (ffmpeg stream-copy, no API call).';
  if (!window.confirm(confirmMsg)) return;

  setExportStatus('Đang cut + upload…', false);
  try {
    const res = await window.api.post(
      `/admin/listening/tests/${encodeURIComponent(STATE.selectedTestId)}/cut-audio`,
      { segments: segments },
    );
    // Sprint 13.6.3 — split the success banner into new vs reused.
    // ``segments_new`` + ``segments_reused`` are the Sprint 13.6.3 fields
    // (Codex F2 fix); fall back to ``segments_created`` if a legacy
    // backend version is in front (defensive read during deploys).
    const created = (res && res.segments_created) || 0;
    const newCount = (res && typeof res.segments_new === 'number')
      ? res.segments_new : created;
    const reused = (res && typeof res.segments_reused === 'number')
      ? res.segments_reused : 0;
    const skipped = (res && res.segments_skipped) || 0;
    let msg = `OK — ${created} segment(s) (${newCount} mới, ${reused} reused).`;
    if (skipped) msg += ` ${skipped} bị skip (< ${res.min_segment_seconds}s).`;
    setExportStatus(msg, false);
  } catch (e) {
    setExportStatus(`Export thất bại: ${e && e.message ? e.message : e}`, true);
  }
}


// ── Handler wiring ─────────────────────────────────────────────────────────


function bindHandlers() {
  $('ac-test-select').addEventListener('change', (e) => {
    STATE.selectedTestId = e.target.value || null;
    STATE.selectedTest = STATE.tests.find((t) => t.id === STATE.selectedTestId) || null;
    $('ac-btn-load').disabled = !STATE.selectedTestId;
    if (STATE.selectedTestId) {
      setSourceStatus(`Selected: ${STATE.selectedTest && STATE.selectedTest.test_id}`, false);
    } else {
      setSourceStatus('', false);
    }
  });

  $('ac-btn-load').addEventListener('click', () => { void onLoadAudio(); });

  $('ac-btn-play-pause').addEventListener('click', () => {
    if (STATE.wavesurfer) STATE.wavesurfer.playPause();
  });
  $('ac-btn-stop').addEventListener('click', () => {
    if (STATE.wavesurfer) {
      STATE.wavesurfer.stop();
      $('ac-current-time').textContent = '0:00';
    }
  });

  $('ac-btn-auto-detect').addEventListener('click', () => { void onAutoDetect(); });
  $('ac-btn-add-region').addEventListener('click',   onAddRegion);
  $('ac-btn-export').addEventListener('click',       () => { void onExportAll(); });

  // Delegated handlers for inline label edits + per-row buttons.
  $('ac-regions-tbody').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.classList.contains('ac-label-input')) return;
    const region = findRegion(t.getAttribute('data-region-id'));
    if (region) region.update({
      data: Object.assign({}, region.data, { label: t.value }),
    });
  });
  $('ac-regions-tbody').addEventListener('click', (e) => {
    const t = e.target;
    const regionId = t.getAttribute && t.getAttribute('data-region-id');
    if (!regionId) return;
    const region = findRegion(regionId);
    if (!region) return;
    if (t.classList.contains('ac-btn-play-region')) {
      region.play();
    } else if (t.classList.contains('ac-btn-delete-region')) {
      region.remove();
    }
  });
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
