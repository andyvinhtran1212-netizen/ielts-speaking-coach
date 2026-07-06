/**
 * admin-listening-drills-import.js — admin batch import for listening SKILL
 * DRILLS (Skills Practice).
 *
 * Drives /pages/admin/listening/import-drills.html. The user picks the
 * `11_Skill_Drills_Web` folder (webkitdirectory) — or a multi-file selection —
 * and the panel:
 *   1. Groups files into drill bundles by test_id: Source_JSON/<TEST_ID>.json +
 *      audio_output/<TEST_ID>/timings.json + audio_output/<TEST_ID>/full_test.mp3.
 *   2. Dry-runs every bundle (POST /admin/listening/drills/import) → a preview
 *      table (drill_type, level, question_count, audio present, ok/errors).
 *   3. Commits the selected, valid bundles (POST …/commit) with the mp3 when
 *      present — sequentially, rendering per-row result.
 *
 * Auth is automatic: window.api.upload attaches the admin session Bearer token.
 * A drill with no audio still imports (draft metadata, "Sắp có"). One drill per
 * request mirrors the full-test import granularity; the batch is client-side.
 */

(function () {
  'use strict';

  var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var STATE = {
    bundles: [],   // [{test_id, jsonFile, timingsFile, audioFile, preview, committed}]
    busy: false,
  };

  function showError(msg) {
    var el = $('di-error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // test_id from a Source_JSON file name: strip the .json extension.
  function testIdFromJsonName(name) {
    return String(name || '').replace(/\.json$/i, '');
  }
  // The audio_output subfolder name IS the test_id, so read it from the path.
  function testIdFromAudioPath(relPath) {
    var parts = String(relPath || '').split('/');
    var i = parts.indexOf('audio_output');
    return (i >= 0 && parts[i + 1]) ? parts[i + 1] : null;
  }

  // ── Group a FileList into drill bundles keyed by test_id ───────────────────
  function groupFiles(files) {
    var jsons = {};       // test_id → File
    var timings = {};     // test_id → File
    var audios = {};      // test_id → File
    for (var k = 0; k < files.length; k++) {
      var f = files[k];
      var rel = f.webkitRelativePath || f.name;
      var lower = f.name.toLowerCase();
      if (/(^|\/)audio_output\//i.test(rel)) {
        var tid = testIdFromAudioPath(rel);
        if (!tid) continue;
        if (lower === 'timings.json') timings[tid] = f;
        else if (lower === 'full_test.mp3') audios[tid] = f;
        continue;
      }
      // Anything else ending in .json under Source_JSON (or a loose selection)
      // that looks like a drill id is treated as a Source JSON.
      if (lower.endsWith('.json') && /ILR-LIS-DRL-/i.test(f.name)) {
        jsons[testIdFromJsonName(f.name)] = f;
      }
    }
    var bundles = [];
    Object.keys(jsons).sort().forEach(function (tid) {
      bundles.push({
        test_id:     tid,
        jsonFile:    jsons[tid],
        timingsFile: timings[tid] || null,
        audioFile:   audios[tid] || null,
        preview:     null,
        committed:   null,
      });
    });
    return bundles;
  }

  // ── File pickers ───────────────────────────────────────────────────────────
  function onPick(e) {
    var files = e.target.files;
    STATE.bundles = groupFiles(files);
    var withAudio = STATE.bundles.filter(function (b) { return b.audioFile; }).length;
    $('di-picked').innerHTML = STATE.bundles.length
      ? 'Đã nhận <strong>' + STATE.bundles.length + '</strong> drill (' + withAudio + ' có audio).'
      : 'Không tìm thấy Source_JSON hợp lệ (tên phải chứa ILR-LIS-DRL-).';
    $('di-scan').disabled = STATE.bundles.length === 0;
    showError('');
  }

  // ── Dry-run all bundles ─────────────────────────────────────────────────────
  async function scanAll() {
    if (STATE.busy || !STATE.bundles.length) return;
    STATE.busy = true;
    $('di-scan').disabled = true;
    $('di-results-card').hidden = false;
    var tbody = $('di-rows');
    tbody.innerHTML = '';
    for (var i = 0; i < STATE.bundles.length; i++) {
      var b = STATE.bundles[i];
      var tr = document.createElement('tr');
      tr.id = 'di-row-' + i;
      tr.innerHTML = rowHtml(i, b, { status: 'scanning' });
      tbody.appendChild(tr);
      try {
        var fd = new FormData();
        fd.append('source_json', b.jsonFile, b.jsonFile.name);
        if (b.timingsFile) fd.append('timings', b.timingsFile, 'timings.json');
        b.preview = await window.api.upload('/admin/listening/drills/import', fd);
      } catch (err) {
        b.preview = { ok: false, errors: [(err && err.message) || String(err)] };
      }
      tr.innerHTML = rowHtml(i, b, {});
    }
    STATE.busy = false;
    refreshScanSummary();
    updateImportButton();
    wireRowChecks();
  }

  function rowHtml(i, b, opts) {
    var p = b.preview || {};
    var scanning = opts.status === 'scanning';
    var checkable = !scanning && p.ok && !b.committed;
    var status;
    if (b.committed) {
      status = '<span class="di-pill done">✓ Đã import</span>';
    } else if (scanning) {
      status = '<span class="di-pill warn">Đang kiểm tra…</span>';
    } else if (p.ok) {
      status = p.duplicate_test_id
        ? '<span class="di-pill warn">Trùng (archive bản cũ)</span>'
        : '<span class="di-pill ok">Hợp lệ</span>';
    } else {
      status = '<span class="di-pill bad">Lỗi</span>' + errList(p.errors);
    }
    var audio = b.audioFile
      ? '<span class="di-pill ok">có</span>'
      : '<span class="di-pill warn">Sắp có</span>';
    return '' +
      '<td><input type="checkbox" class="di-check" data-idx="' + i + '"' +
        (checkable ? '' : ' disabled') + (checkable ? ' checked' : '') + ' /></td>' +
      '<td class="mono">' + escapeHtml(b.test_id) + '</td>' +
      '<td>' + escapeHtml((p.drill_type) || '—') + '</td>' +
      '<td>' + escapeHtml((p.level || '') + (p.task ? '·' + p.task : '')) + '</td>' +
      '<td>' + escapeHtml(p.question_count != null ? p.question_count : '—') + '</td>' +
      '<td>' + audio + '</td>' +
      '<td>' + status + '</td>';
  }

  function errList(errs) {
    if (!errs || !errs.length) return '';
    return '<ul class="di-errlist">' + errs.map(function (e) {
      return '<li>' + escapeHtml(e) + '</li>';
    }).join('') + '</ul>';
  }

  function refreshScanSummary() {
    var ok = 0, bad = 0, dup = 0;
    STATE.bundles.forEach(function (b) {
      if (!b.preview) return;
      if (b.preview.ok) { ok++; if (b.preview.duplicate_test_id) dup++; } else bad++;
    });
    $('di-scan-summary').innerHTML =
      '<strong>' + ok + '</strong> hợp lệ · ' + bad + ' lỗi' +
      (dup ? ' · ' + dup + ' trùng test_id (cần archive bản cũ trước)' : '');
  }

  function wireRowChecks() {
    var all = $('di-check-all');
    if (all) {
      all.onclick = function () {
        document.querySelectorAll('.di-check:not([disabled])').forEach(function (c) {
          c.checked = all.checked;
        });
        updateImportButton();
      };
    }
    document.querySelectorAll('.di-check').forEach(function (c) {
      c.onchange = updateImportButton;
    });
  }

  function selectedIdxs() {
    var out = [];
    document.querySelectorAll('.di-check:checked:not([disabled])').forEach(function (c) {
      out.push(Number(c.getAttribute('data-idx')));
    });
    return out;
  }

  function updateImportButton() {
    $('di-import').disabled = STATE.busy || selectedIdxs().length === 0;
  }

  // ── Commit selected bundles ────────────────────────────────────────────────
  async function importSelected() {
    if (STATE.busy) return;
    var idxs = selectedIdxs();
    if (!idxs.length) return;
    STATE.busy = true;
    $('di-import').disabled = true;
    var done = 0, failed = 0;
    for (var j = 0; j < idxs.length; j++) {
      var i = idxs[j];
      var b = STATE.bundles[i];
      try {
        var fd = new FormData();
        fd.append('source_json', b.jsonFile, b.jsonFile.name);
        if (b.timingsFile) fd.append('timings', b.timingsFile, 'timings.json');
        if (b.audioFile)   fd.append('audio', b.audioFile, 'full.mp3');
        b.committed = await window.api.upload('/admin/listening/drills/import/commit', fd);
        done++;
      } catch (err) {
        failed++;
        b.preview = b.preview || {};
        b.preview.ok = false;
        b.preview.errors = [(err && err.message) || String(err)];
      }
      var tr = $('di-row-' + i);
      if (tr) tr.innerHTML = rowHtml(i, b, {});
      $('di-import-summary').innerHTML =
        'Đã import <strong>' + done + '</strong>/' + idxs.length +
        (failed ? ' · ' + failed + ' lỗi' : '');
    }
    STATE.busy = false;
    wireRowChecks();
    updateImportButton();
    $('di-import-summary').innerHTML +=
      ' — mở <a href="/pages/admin/listening/tests.html">danh sách tests</a> để publish.';
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('di-dir').addEventListener('change', onPick);
    $('di-scan').addEventListener('click', scanAll);
    $('di-import').addEventListener('click', importSelected);
  });
})();
