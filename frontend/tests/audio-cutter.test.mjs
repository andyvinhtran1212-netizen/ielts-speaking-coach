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
    // forEach + plugin-instance ``add(opts)`` path. Sprint 13.6
    // used ``STATE.wavesurfer.addRegion`` via .call() with a bad
    // ``this`` binding — Sprint 13.6.2 routes through the plugin
    // instance directly so the static-prop dance can't return.
    assert.match(JS, /boundaries\.forEach\(\(b,\s*i\)\s*=>/);
    assert.match(JS, /regionsPlugin\.add\(\{/);
  });

  test('auto-detect clears existing regions before adding new ones', () => {
    // Otherwise re-running auto-detect would stack 8 regions on top
    // of the previous 4. Sprint 13.6.2 uses the plugin instance's
    // own ``clear()`` method (not the static ``clearRegions`` prop).
    assert.match(JS, /regionsPlugin\.clear\(\)/);
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


// ── Sprint 13.6.1 — navigation, query param, response-shape hotfix ─────────


describe('Sprint 13.6.1 — audio cutter discoverability + URL fetch hotfix', () => {

  const INDEX = read('pages', 'admin', 'listening', 'index.html');
  const DETAIL_JS = read('js', 'admin-listening-tests-detail.js');

  test('admin listening hub exposes Audio Cutter as a live nav card', () => {
    // Sprint 13.6 shipped the page itself but with zero entry points,
    // so it was undiscoverable. Pin the hub link so a refactor of
    // the hub layout can't silently orphan the page again.
    assert.match(INDEX,
      /<a class="lst-create-card is-live" href="\/pages\/admin\/listening\/audio-cutter\.html"/);
    assert.match(INDEX, /Cắt audio full đề/);
  });

  test('tests-detail renders contextual deep-link when full audio is present', () => {
    // The audio cutter operates per-test, so the natural authoring
    // hand-off is from tests-detail's full-audio preview block. Pin
    // both the anchor id and the test_id query-param wiring.
    assert.match(DETAIL_JS, /\/pages\/admin\/listening\/audio-cutter\.html\?test_id=/);
    assert.match(DETAIL_JS, /id="td-cut-audio-link"/);
    assert.match(DETAIL_JS, /Cắt audio thành 4 sections/);
    // The link is gated by ``signed.signed_url`` — only shown when
    // audio actually exists. Pin the guard so a refactor can't
    // surface the link on tests with no audio uploaded.
    assert.match(DETAIL_JS, /if \(previewHost && signed\.signed_url\)/);
  });

  test('controller reads nested {full: {signed_url}} shape, not flat keys', () => {
    // Root cause of Andy 2026-05-22 dogfood bug: backend returns
    //   { full: { signed_url: ... }, sections: [...] }
    // but the Sprint 13.6 controller read ``res.full_audio_signed_url``,
    // a flat key that never existed. Pin the correct nested access
    // so the regression can't sneak back via flattening "refactors".
    assert.match(JS, /res && res\.full && res\.full\.signed_url/);
    // Strip line comments before checking the negative — the
    // explanatory comment names the old bad key on purpose so future
    // readers understand why this contract is locked.
    const codeOnly = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(codeOnly, /full_audio_signed_url/);
  });

  test('missing-audio error surfaces an action link to tests list', () => {
    // Actionable error UX (Sprint 13.6.1 pattern): when the test
    // has no full audio, point the admin at the page that can fix
    // the prerequisite instead of dead-ending on a red message.
    assert.match(JS, /chưa upload full pre-mixed audio/);
    assert.match(JS, /href:\s*['"]\/pages\/admin\/listening\/tests\.html['"]/);
    assert.match(JS, /text:\s*['"]Mở danh sách tests/);
  });

  test('setSourceStatus accepts an optional action {href, text} for action links', () => {
    // Pin the 3-arg signature so a refactor cannot silently drop
    // the action parameter and revert error UX.
    assert.match(JS, /function setSourceStatus\(text, isError, action\)/);
    assert.match(JS, /el\.appendChild\(link\)/);
  });

  test('controller parses ?test_id= query param and validates UUID-ish shape', () => {
    // Deep-link entry from tests-detail. Defensive regex prevents
    // a malformed query string from crashing the dropdown auto-
    // select.
    assert.match(JS, /function parseInitialTestId\(\)/);
    assert.match(JS, /params\.get\(['"]test_id['"]\)/);
    assert.match(JS, /\^\[0-9a-fA-F-\]\{8,\}\$/);
  });

  test('init() routes through maybeAutoLoadFromQueryParam after dropdown populates', () => {
    // Order matters: tests dropdown must be populated before the
    // auto-select can find the matching entry. Pin the call order.
    const initRe = /async function init\(\) \{[\s\S]+?STATE\.initialTestId = parseInitialTestId\(\);[\s\S]+?await loadTests\(\);[\s\S]+?bindHandlers\(\);[\s\S]+?maybeAutoLoadFromQueryParam\(\);[\s\S]+?\}/;
    assert.match(JS, initRe);
  });

  test('auto-load surfaces a clear message when the deep-link test is not cuttable', () => {
    // A test_id in the URL that does not satisfy the full_premixed
    // filter applied in loadTests() would otherwise silently no-op.
    // Pin the explanatory message + error flag.
    assert.match(JS, /Test trong URL không có full pre-mixed audio/);
  });

  test('auto-load triggers select-change dispatch + deferred onLoadAudio', () => {
    // Dispatching ``change`` reuses the existing handler that wires
    // STATE.selectedTest. ``setTimeout(0)`` defers the load until
    // after the synchronous handler runs.
    assert.match(JS, /select\.dispatchEvent\(new Event\(['"]change['"]\)\)/);
    assert.match(JS, /setTimeout\(\(\) => \{ void onLoadAudio\(\); \}, 0\)/);
  });

  test('hub nav card uses the live state (is-live), not the dashed placeholder', () => {
    // Hub uses ``.is-live`` to upgrade dashed placeholder cards to
    // real clickable links. Without it, the card renders disabled.
    // Pin the live class on the audio-cutter card specifically.
    const audioCutterCardRe =
      /<a class="lst-create-card is-live" href="\/pages\/admin\/listening\/audio-cutter\.html"[\s\S]+?data-create="audio-cutter"/;
    assert.match(INDEX, audioCutterCardRe);
  });

  test('hub card lede explains ffmpeg stream-copy lossless cut', () => {
    // The lede sells *why* this tool is safe to run on production
    // audio — no re-encode, no quality loss, $0 cost. Pin so a
    // copy-rewrite can't drop the technical claim that justifies
    // running the action without an undo path.
    assert.match(INDEX, /ffmpeg stream-copy/);
    assert.match(INDEX, /\$0 cost/);
  });

  test('contextual link uses encodeURIComponent on testId', () => {
    // testId originates from a query string ultimately controlled
    // by users (admin URLs can be shared). Encoding makes the deep
    // link robust to ids that ever grow URL-unsafe characters.
    assert.match(DETAIL_JS,
      /audio-cutter\.html\?test_id=\$\{encodeURIComponent\(STATE\.testId\)\}/);
  });

  test('contextual link sits inside td-audio-actions row with replace button', () => {
    // Both actions are flex-row siblings so the layout stays one
    // visual unit. If a refactor splits them apart, the replace
    // button and cut link end up on different visual rows and the
    // affordance grouping breaks.
    assert.match(DETAIL_JS, /td-audio-actions/);
    assert.match(DETAIL_JS, /id="td-full-replace"[\s\S]+?id="td-cut-audio-link"/);
  });

  test('controller deep-link guard short-circuits on missing or malformed test_id', () => {
    // ``parseInitialTestId`` returns null in two cases: no param,
    // or malformed shape. Both branches must be pinned so a
    // refactor that "simplifies" the validator can't silently
    // accept arbitrary strings and feed them to the dropdown.
    assert.match(JS, /if \(!raw\) return null;/);
    assert.match(JS, /if \(!\/\^\[0-9a-fA-F-\]\{8,\}\$\/\.test\(raw\)\) return null;/);
  });

  test('auto-load preserves dropdown-driven happy path (no double trigger)', () => {
    // ``maybeAutoLoadFromQueryParam`` only runs when initialTestId
    // is set. Pin the guard so admins who navigate without a
    // query param still go through the manual select → load flow.
    assert.match(JS, /if \(!wanted\) return;/);
  });

});


// ── Sprint 13.6.2 — Wavesurfer v6 regions plugin binding hotfix ────────────


describe('Sprint 13.6.2 — auto-detect regions plugin binding', () => {

  test('getRegionsPlugin returns the v6 plugin instance, null-safe', () => {
    // Andy 2026-05-22 dogfood: "Cannot read properties of undefined
    // (reading 'regions')" thrown by the v6 ``addRegion`` static prop
    // because it ran with ``this = STATE.wavesurfer.regions`` (the
    // plugin instance) and tried to read ``this.initialisedPluginList.regions``.
    // Sprint 13.6.2 sidesteps the static prop entirely and uses the
    // plugin instance's own ``add``/``clear`` methods.
    assert.match(JS, /function getRegionsPlugin\(\)/);
    assert.match(JS, /\(STATE\.wavesurfer && STATE\.wavesurfer\.regions\) \|\| null/);
  });

  test('onAutoDetect short-circuits with a clear message when plugin missing', () => {
    // If the CDN script tag for the regions plugin failed to load,
    // ``getRegionsPlugin()`` returns null. Surface a hard refresh
    // hint rather than crashing on the first ``.add`` call.
    assert.match(JS, /Regions plugin chưa load/);
    assert.match(JS, /hard refresh page/);
  });

  test('static-prop binding bug from Sprint 13.6 is gone (no .call dance)', () => {
    // Pin the regression negatively. The Sprint 13.6 code did:
    //   add.call(STATE.wavesurfer.regions || STATE.wavesurfer, opts)
    // which is the exact source of the dogfood crash. Strip comments
    // so the bug description above doesn't masquerade as live code.
    const codeOnly = JS.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(codeOnly, /add\.call\(/);
    assert.doesNotMatch(codeOnly, /STATE\.wavesurfer\.addRegion/);
    assert.doesNotMatch(codeOnly, /STATE\.wavesurfer\.clearRegions/);
  });

  test('empty boundaries surfaces an actionable hint, not a silent no-op', () => {
    // If silencedetect finds zero gaps long enough to split on, the
    // admin needs to know that manual segmentation is the next step.
    // Pin both the message and the "Thêm segment" reference.
    assert.match(JS, /Không tìm thấy gap đủ lớn/);
    assert.match(JS, /\+ Thêm segment/);
  });

  test('empty boundaries early-returns before touching the plugin', () => {
    // Pin the order: empty check happens BEFORE ``regionsPlugin.clear()``
    // so a stale 4-up isn't wiped out when detect finds nothing.
    const re = /if \(boundaries\.length === 0\)[\s\S]+?return;[\s\S]+?regionsPlugin\.clear\(\)/;
    assert.match(JS, re);
  });

  test('region opts pin start/end/color/drag/resize/data fields', () => {
    // Sprint 13.6 used the same shape but via the buggy .call() —
    // Sprint 13.6.2 preserves the shape. Pin every documented field
    // so a future plugin upgrade can't quietly drop drag/resize.
    const optsRe =
      /regionsPlugin\.add\(\{\s+start:[\s\S]+?end:[\s\S]+?color:[\s\S]+?drag:[\s\S]+?resize:[\s\S]+?data:[\s\S]+?\}\)/;
    assert.match(JS, optsRe);
  });

  test('onAddRegion (manual + segment) uses the same plugin-instance API', () => {
    // Manual add went through the same static-prop dance as auto-
    // detect, so it was a latent bug ready to fire the moment the
    // wavesurfer instance happened to expose ``addRegion`` differently.
    // Pin that both paths now use the same helper.
    const manualBlockRe = /function onAddRegion\(\)[\s\S]+?regionsPlugin\.add\(\{/;
    assert.match(JS, manualBlockRe);
  });

  test('auto-detect happy path surfaces gap count + section count in status', () => {
    // The status text helps the admin sanity-check that
    // silencedetect found N gaps and we proposed N+1 sections (or
    // capped at target_section_count). Pin the message template.
    assert.match(JS, /Detected \$\{gapCount\} gaps → \$\{boundaries\.length\} sections/);
  });

  test('gap count read is defensive against missing silence_gaps_detected key', () => {
    // Backend could in theory ship an updated response that drops
    // the metric. Pin the fallback so the status string doesn't
    // render literal "undefined gaps".
    assert.match(JS,
      /res\.silence_gaps_detected != null[\s\S]+?res\.silence_gaps_detected[\s\S]+?:\s*['"]\?['"]/);
  });

  test('STATE.regions is reset before laying down new regions', () => {
    // Otherwise the table would briefly show stale entries between
    // the plugin clear and the region-created events firing. Pin
    // the explicit reset.
    const re = /regionsPlugin\.clear\(\)[\s\S]+?STATE\.regions = \[\]/;
    assert.match(JS, re);
  });

});
