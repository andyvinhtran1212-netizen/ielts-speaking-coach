/**
 * tests/audio-cutter.test.mjs — Sprint 13.6.
 *
 * Source-regex sentinels for the new admin audio cutter
 * (``frontend/pages/admin/listening/audio-cutter.html`` +
 * ``frontend/js/audio-cutter.js``). Pins:
 *
 *   * The HTML scaffold: test-selector + waveform + timeline +
 *     transport + auto-detect button + regions table + export.
 *   * The JS contract: Wavesurfer init, region colour rotation,
 *     auto-detect → /detect-silence call, export → /cut-audio call,
 *     handler wiring + table rendering.
 *
 * No DOM is mounted; this mirrors the rest of the frontend test
 * suite which reads source files and asserts on string patterns.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function read(...parts) {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const HTML = read('pages', 'admin', 'listening', 'audio-cutter.html');
const JS   = read('js', 'audio-cutter.js');


// ── HTML structure ─────────────────────────────────────────────────────────


describe('Sprint 13.6 — audio cutter HTML scaffold', () => {

  test('loads Wavesurfer.js v6 UMD + regions + timeline plugins from CDN', () => {
    // v6 ships UMD bundles that attach to window.WaveSurfer, which is
    // what the vanilla controller needs. v7 is ES-module-only and
    // would require a build step — pin v6 explicitly so a refactor
    // can't silently upgrade and break the page.
    assert.match(HTML, /wavesurfer\.js@6\.\d+\.\d+\/dist\/wavesurfer\.min\.js/);
    assert.match(HTML, /wavesurfer\.js@6\.\d+\.\d+\/dist\/plugin\/wavesurfer\.regions\.min\.js/);
    assert.match(HTML, /wavesurfer\.js@6\.\d+\.\d+\/dist\/plugin\/wavesurfer\.timeline\.min\.js/);
  });

  test('renders a test selector (default value empty so Load button stays disabled)', () => {
    assert.match(HTML, /<select id="ac-test-select"/);
    assert.match(HTML, /<option value="">— Chọn test —/);
  });

  test('Load button starts disabled (re-enabled when a test is picked)', () => {
    assert.match(HTML,
      /<button id="ac-btn-load"[\s\S]+?disabled/);
  });

  test('workspace card starts hidden (revealed after audio.load completes)', () => {
    assert.match(HTML,
      /<section class="ac-card" id="ac-workspace" hidden>/);
  });

  test('waveform + timeline containers carry the expected IDs', () => {
    assert.match(HTML, /<div id="ac-waveform"><\/div>/);
    assert.match(HTML, /<div id="ac-timeline"><\/div>/);
  });

  test('transport controls render play/pause + stop + current/total time spans', () => {
    assert.match(HTML, /<button id="ac-btn-play-pause"/);
    assert.match(HTML, /<button id="ac-btn-stop"/);
    assert.match(HTML, /<span id="ac-current-time">0:00<\/span>/);
    assert.match(HTML, /<span id="ac-total-time">0:00<\/span>/);
  });

  test('auto-detect button advertises the 2s / -40dB defaults inline', () => {
    assert.match(HTML, /id="ac-btn-auto-detect"/);
    assert.match(HTML, /Auto-detect 4 sections \(silence-based\)/);
    // The ``>`` in the hint copy is HTML-escaped as ``&gt;``; pin the
    // entity form so the sentinel can't drift if a future render
    // un-escapes it.
    assert.match(HTML, /gaps &gt; 2s as section boundaries[\s\S]*-40dB/);
  });

  test('regions table has Label / Start / End / Duration / Actions columns', () => {
    assert.match(HTML, /<thead>[\s\S]+?<th>Label<\/th>[\s\S]+?<th[^>]*>Start<\/th>[\s\S]+?<th[^>]*>End<\/th>[\s\S]+?<th[^>]*>Duration<\/th>[\s\S]+?<th[^>]*>Actions<\/th>/);
    assert.match(HTML, /<tbody id="ac-regions-tbody"><\/tbody>/);
  });

  test('export button surfaces the $0 cost copy inline', () => {
    assert.match(HTML, /<button id="ac-btn-export"/);
    assert.match(HTML, /cost \$0/);
  });

  test('legend renders the 4 section colour swatches', () => {
    assert.match(HTML, /class="ac-section-colors"/);
    // Each colour appears once in an ``ac-color-swatch`` style.
    assert.match(HTML, /rgba\(231, 76, 60, 0\.45\)/);
    assert.match(HTML, /rgba\(241, 196, 15, 0\.45\)/);
    assert.match(HTML, /rgba\(46, 204, 113, 0\.45\)/);
    assert.match(HTML, /rgba\(52, 152, 219, 0\.45\)/);
  });
});


// ── JS controller ──────────────────────────────────────────────────────────


describe('Sprint 13.6 — audio cutter JS controller', () => {

  test('STATE keeps tests + selection + wavesurfer + regions on one object', () => {
    // Pin the field set so a future refactor can't silently drop one
    // — the handlers below all dereference these names.
    assert.match(JS, /const STATE\s*=\s*\{[\s\S]+?tests:[\s\S]+?selectedTestId:[\s\S]+?wavesurfer:[\s\S]+?regions:/);
  });

  test('SECTION_REGION_COLORS rotates 4 IELTS-section colours', () => {
    const m = /SECTION_REGION_COLORS\s*=\s*\[([\s\S]+?)\]/.exec(JS);
    assert.ok(m, 'SECTION_REGION_COLORS not found');
    const body = m[1];
    assert.match(body, /rgba\(231, 76, 60/);   // red    — S1
    assert.match(body, /rgba\(241, 196, 15/);  // yellow — S2
    assert.match(body, /rgba\(46, 204, 113/);  // green  — S3
    assert.match(body, /rgba\(52, 152, 219/);  // blue   — S4
    // Pin the count so a stray 5th colour can't quietly desync the
    // sectionColor(idx) modulo.
    assert.strictEqual((body.match(/rgba\(/g) || []).length, 4);
  });

  test('only full_premixed tests with a non-null full_audio_storage_path show up', () => {
    // ``loadTests`` filters the API response so the dropdown can't
    // expose a test that has no audio to cut.
    assert.match(JS,
      /t\.audio_assembly_mode === ['"]full_premixed['"]\s*\n?\s*&&\s*t\.full_audio_storage_path/);
  });

  test('audio load uses the existing /audio/signed-urls endpoint (Sprint 13.4.3.2 reuse)', () => {
    assert.match(JS,
      /window\.api\.get\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(testId\)\}\/audio\/signed-urls`/);
  });

  test('initWavesurfer destroys any previous instance before creating a new one', () => {
    // Switching tests without clean-up leaks the Wavesurfer instance
    // and its audio element — pin the destroy() call so a regression
    // can't quietly skip it.
    assert.match(JS, /STATE\.wavesurfer\.destroy\(\)/);
  });

  test('Wavesurfer config sets height 128 + waveColor + progressColor + normalize', () => {
    // Pin the visual config — width is fluid, height is what makes
    // the waveform legible alongside the timeline plugin.
    assert.match(JS, /height:\s*128/);
    assert.match(JS, /normalize:\s*true/);
    assert.match(JS, /waveColor:\s*['"]#94a3b8['"]/);
    assert.match(JS, /progressColor:\s*['"]#0f766e['"]/);
  });

  test('plugins array conditionally attaches regions + timeline (CDN-safe)', () => {
    // If one of the plugin scripts fails to load, the page must
    // still render a waveform — pin the ``if`` guards.
    assert.match(JS, /if\s*\(window\.WaveSurfer\.regions\)/);
    assert.match(JS, /if\s*\(window\.WaveSurfer\.timeline\)/);
  });

  test('auto-detect POSTs to /detect-silence then re-creates regions from the response', () => {
    assert.match(JS,
      /window\.api\.post\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(testId\)\}\/detect-silence`/);
    // Boundaries come back as ``[{ start, end }, …]`` — pin the
    // forEach + addRegion path so a refactor can't quietly stop
    // laying down regions.
    assert.match(JS, /boundaries\.forEach\(\(b,\s*i\)\s*=>/);
    assert.match(JS, /STATE\.wavesurfer\.addRegion/);
  });

  test('auto-detect clears existing regions before adding new ones', () => {
    // Otherwise re-running auto-detect would stack 8 regions on top
    // of the previous 4 — pin both API shapes (Regions v6 plugin's
    // ``clear`` and the older ``clearRegions`` method on the instance).
    assert.match(JS, /STATE\.wavesurfer\.regions\.clear\b/);
    assert.match(JS, /STATE\.wavesurfer\.clearRegions/);
  });

  test('first 4 manually-drawn regions auto-label as Section 1..4', () => {
    // ``onRegionCreated`` reads STATE.regions.length to pick a label.
    // Pin the comparison + the Section-prefixed label so a regression
    // can't silently flip to "Region 1" copy.
    assert.match(JS, /STATE\.regions\.length\s*<\s*SECTION_REGION_COLORS\.length/);
    assert.match(JS, /label:\s*\(region\.data && region\.data\.label\)\s*\|\|\s*`Section \$\{idx \+ 1\}`/);
  });

  test('region-table row carries data-region-id + 6 columns', () => {
    // Used by the delegated input + click handlers below.
    assert.match(JS, /<tr data-region-id="\$\{region\.id\}">/);
    // Six cells: index, label-input, start, end, duration, actions.
    const m = /<tr data-region-id="\$\{region\.id\}">[\s\S]+?<\/tr>/.exec(JS);
    assert.ok(m, 'region row template not found');
    const tdCount = (m[0].match(/<td>/g) || []).length;
    assert.ok(tdCount >= 6, `expected 6 <td> cells, got ${tdCount}`);
  });

  test('label input is delegated through the tbody input listener', () => {
    // Cheap to add 40 rows without 40 separate listeners. Pin the
    // delegation pattern so a regression doesn't accidentally bind
    // per-row.
    assert.match(JS, /\$\(['"]ac-regions-tbody['"]\)\.addEventListener\(['"]input['"]/);
    assert.match(JS, /t\.classList\.contains\(['"]ac-label-input['"]\)/);
  });

  test('per-row Play / Delete buttons route through the tbody click listener', () => {
    assert.match(JS, /\$\(['"]ac-regions-tbody['"]\)\.addEventListener\(['"]click['"]/);
    assert.match(JS, /classList\.contains\(['"]ac-btn-play-region['"]\)/);
    assert.match(JS, /classList\.contains\(['"]ac-btn-delete-region['"]\)/);
  });

  test('add-region button creates a 30-second region from the current playhead', () => {
    assert.match(JS, /STATE\.wavesurfer\.getCurrentTime\(\)/);
    assert.match(JS, /const end = Math\.min\(current \+ 30, duration\)/);
  });

  test('export confirm dialog spells out segment count + $0 cost', () => {
    assert.match(JS, /window\.confirm\(confirmMsg\)/);
    assert.match(JS, /Cost: \$0 \(ffmpeg stream-copy, no API call\)/);
    assert.match(JS, /Export \$\{segments\.length\} segments/);
  });

  test('export POSTs to /cut-audio with sorted-by-start segments', () => {
    // Sort by start before POSTing so the server-side index matches
    // the visual order Andy sees.
    assert.match(JS, /\.sort\(\(a,\s*b\)\s*=>\s*a\.start\s*-\s*b\.start\)/);
    assert.match(JS,
      /window\.api\.post\(\s*`\/admin\/listening\/tests\/\$\{encodeURIComponent\(STATE\.selectedTestId\)\}\/cut-audio`/);
    assert.match(JS, /\{\s*segments:\s*segments\s*\}/);
  });

  test('export status surfaces created + skipped counts after success', () => {
    // ``segments_skipped`` is the new Sprint 13.6 backend field —
    // the UI must surface it so Andy notices when a tiny region
    // got dropped silently.
    assert.match(JS, /res\.segments_created/);
    assert.match(JS, /res\.segments_skipped/);
    assert.match(JS, /res\.min_segment_seconds/);
  });

  test('test-select change toggles the Load button disabled state', () => {
    // Picking the empty option must re-disable Load; picking a real
    // test re-enables it. Pin the assignment so a regression can't
    // strand the button enabled with no selected test.
    assert.match(JS, /\$\(['"]ac-btn-load['"]\)\.disabled = !STATE\.selectedTestId/);
  });

  test('formatTime pads single-digit seconds and rejects bad inputs', () => {
    // Pure function — pin both behaviours.
    assert.match(JS, /function formatTime\(seconds\)/);
    assert.match(JS, /!Number\.isFinite\(seconds\) \|\| seconds < 0/);
    assert.match(JS, /s < 10 \? ['"]0['"] : ['"]['"]/);
  });

  test('formatBytes returns KB under 1 MB, MB above (one-place precision)', () => {
    assert.match(JS, /function formatBytes\(bytes\)/);
    assert.match(JS, /bytes < 1024 \* 1024/);
    assert.match(JS, /\(bytes \/ 1024\)\.toFixed\(0\)/);
    assert.match(JS, /\(bytes \/ 1024 \/ 1024\)\.toFixed\(1\)/);
  });

  test('sectionColor wraps via modulo so a 5th region reuses the S1 colour', () => {
    assert.match(JS, /function sectionColor\(index\)/);
    assert.match(JS, /SECTION_REGION_COLORS\[index % SECTION_REGION_COLORS\.length\]/);
  });

  test('Play button toggles label between ▶ Play and ⏸ Pause via WS events', () => {
    // The button text is the only state the user can rely on for
    // "is it playing" — pin both transitions on the WS events.
    assert.match(JS, /ws\.on\(['"]play['"][\s\S]+?['"]⏸ Pause['"]/);
    assert.match(JS, /ws\.on\(['"]pause['"][\s\S]+?['"]▶ Play['"]/);
    assert.match(JS, /ws\.on\(['"]finish['"][\s\S]+?['"]▶ Play['"]/);
  });

  test('stop button resets the current-time display to 0:00', () => {
    assert.match(JS,
      /\$\(['"]ac-btn-stop['"]\)\.addEventListener\([\s\S]+?STATE\.wavesurfer\.stop\(\)[\s\S]+?ac-current-time['"]\)\.textContent\s*=\s*['"]0:00['"]/);
  });

  test('init bootstraps via DOMContentLoaded or runs immediately if late-loaded', () => {
    // The page can <script> the controller at either head or body
    // foot — pin both paths so a refactor that moves the tag can't
    // break boot.
    assert.match(JS, /document\.readyState === ['"]loading['"]/);
    assert.match(JS, /document\.addEventListener\(['"]DOMContentLoaded['"], init\)/);
  });

  test('escapeHtml is used on user-controlled label values before innerHTML', () => {
    // Label text reaches innerHTML via the regions-table template —
    // pin the escape so an admin typing ``<script>`` can't break
    // the page (or worse, in a future multi-admin world, the page
    // of a colleague).
    assert.match(JS, /function escapeHtml\(s\)/);
    assert.match(JS, /escapeHtml\(label\)/);
  });

  test('regions list is re-rendered on every Wavesurfer region-* event', () => {
    // Three events feed the table: created, updated, removed. Pin
    // all three handlers so a refactor can't silently stop tracking
    // drag/resize edits.
    assert.match(JS, /ws\.on\(['"]region-created['"]/);
    assert.match(JS, /ws\.on\(['"]region-updated['"]/);
    assert.match(JS, /ws\.on\(['"]region-removed['"]/);
  });

  test('controller refuses to export when no regions exist', () => {
    // Otherwise the backend returns a 400 — better UX to short-
    // circuit client-side with a clear message.
    assert.match(JS, /!STATE\.regions\.length/);
    assert.match(JS, /Chưa có segment nào để export/);
  });

  test('manual add-region rejects positions less than 1s from the end', () => {
    // 30s region clipped to ``duration``; if that leaves < 1s the
    // region would be filtered out backend-side. Surface inline.
    assert.match(JS, /end - current < 1/);
    assert.match(JS, /quá gần cuối audio/);
  });

  test('CSS swatch legend mirrors the JS SECTION_REGION_COLORS', () => {
    // HTML legend uses the colours at 0.45 alpha (more visible in
    // the legend); JS uses 0.25 alpha (less visual noise on the
    // waveform). Pin both so they stay related but distinct.
    const wavMatches = (JS.match(/0\.25\)/g) || []).length;
    assert.ok(wavMatches >= 4, `expected ≥4 0.25-alpha colour stops in JS, got ${wavMatches}`);
    const legendMatches = (HTML.match(/0\.45\)/g) || []).length;
    assert.ok(legendMatches >= 4, `expected ≥4 0.45-alpha colour stops in HTML, got ${legendMatches}`);
  });

  test('source status helper sets the ac-error class for failures', () => {
    // Both setSourceStatus + setExportStatus toggle ac-error so the
    // CSS rule lights up the red colour for error states. Pin both.
    assert.match(JS, /function setSourceStatus/);
    assert.match(JS, /function setExportStatus/);
    assert.match(JS, /classList\.toggle\(['"]ac-error['"]/);
  });
});
