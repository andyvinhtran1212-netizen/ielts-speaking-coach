/**
 * admin-listening-fulltest-import.js — admin upload UI for the listening
 * FULL-TEST pack import (Phase A of admin-fulltest-import-ui).
 *
 * Drives /pages/admin/listening/import-fulltest.html. Replaces the curl +
 * hand-pasted-JWT + manual-SQL-archive workflow with one page:
 *   choose 4 files → "Kiểm tra" (POST /admin/listening/import-fulltest, dry-run)
 *   → fail-loud validation render (green if ok, red per-error list) → "Import"
 *   (POST …/commit with a real upload progress bar) → result + "Publish ngay".
 *
 * Auth is automatic: window.api.* attaches the admin session Bearer token, and
 * the progress-aware commit XHR reuses the same supabase session token — no
 * JWT is ever pasted by hand. dup-ACTIVE (same test_id already live) is handled
 * in one click: archive the old bundle (PATCH status=archived) then commit.
 *
 * Lesson 16: a dry-run with errors HARD-disables the Import button. Render-layer
 * over existing endpoints — no backend change, no migration.
 */

(function () {
  'use strict';

  var SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };

  var STATE = {
    files:   { question_paper: null, solution: null, timings: null, audio: null },
    preview: null,    // last dry-run result
    newTest: null,    // committed test row { id, test_id, ... }
    busy:    false,
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function mb(bytes) { return (Number(bytes || 0) / (1024 * 1024)).toFixed(1) + ' MB'; }

  // ── File pickers (drag-drop + click) ──────────────────────────────────────
  var DROPS = [
    { field: 'question_paper', input: 'fi-qp',  name: 'fi-qp-name'  },
    { field: 'solution',       input: 'fi-sol', name: 'fi-sol-name' },
    { field: 'timings',        input: 'fi-tim', name: 'fi-tim-name' },
    { field: 'audio',          input: 'fi-aud', name: 'fi-aud-name' },
  ];

  var SLOTS = {};   // field → { nameEl, zone }

  // Route a dropped file to the correct slot by extension/name, so dragging all
  // 4 files at once just works. (#408 bug: a multi-file drop on one zone kept
  // only files[0] → 3 files silently lost = "không nhận đủ 4 file".)
  function _routeField(name) {
    var n = String(name || '').toLowerCase();
    if (n.endsWith('.json')) return 'timings';
    if (n.endsWith('.mp3')) return 'audio';
    if (n.endsWith('.md') || n.endsWith('.markdown')) {
      return /solution|answer|chua|chữa|giai|giải/.test(n) ? 'solution' : 'question_paper';
    }
    return null;
  }

  function assignToSlot(field, file) {
    if (!field || !file || !SLOTS[field]) return;
    STATE.files[field] = file;
    SLOTS[field].nameEl.textContent = file.name + ' · ' + mb(file.size);
    SLOTS[field].zone.classList.add('is-set');
  }

  // single file → respect the slot it was dropped/picked on; multiple → auto-route each.
  function acceptFiles(slotField, fileList) {
    var files = fileList ? Array.prototype.slice.call(fileList) : [];
    if (!files.length) return;
    if (files.length === 1) assignToSlot(slotField, files[0]);
    else files.forEach(function (f) { assignToSlot(_routeField(f.name), f); });
    refreshCheckBtn();
    refreshImportBtns();
  }

  function wireDrop(d) {
    var input = $(d.input);
    var zone = input.closest('.fi-drop');
    SLOTS[d.field] = { nameEl: $(d.name), zone: zone };
    input.addEventListener('change', function () { acceptFiles(d.field, input.files); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('is-drag'); });
    });
    zone.addEventListener('drop', function (e) { acceptFiles(d.field, e.dataTransfer && e.dataTransfer.files); });
  }

  function refreshCheckBtn() {
    // Lesson 16 — require ALL 4 files before dry-run (đủ 4 file mới Kiểm tra).
    var f = STATE.files;
    var ready = f.question_paper && f.solution && f.timings && f.audio;
    $('fi-check').disabled = !ready || STATE.busy;
  }

  // ── STEP 1 → dry-run ──────────────────────────────────────────────────────
  async function onCheck() {
    if (STATE.busy) return;
    STATE.busy = true; STATE.preview = null;
    $('fi-check').disabled = true;
    $('fi-check-note').hidden = false;
    $('fi-done-card').hidden = true;
    try {
      var fd = new FormData();
      fd.append('question_paper', STATE.files.question_paper);
      fd.append('solution',       STATE.files.solution);
      fd.append('timings',        STATE.files.timings);
      var preview = await window.api.upload('/admin/listening/import-fulltest', fd);
      STATE.preview = preview;
      renderResult(preview);
    } catch (e) {
      renderResult({ ok: false, errors: [errText(e)], warnings: [] });
    } finally {
      STATE.busy = false;
      $('fi-check-note').hidden = true;
      refreshCheckBtn();
      // renderResult() ran the import-button gate WHILE STATE.busy was still
      // true (canBase = p.ok && !busy → false), and busy only clears here — so
      // recompute now, or both commit buttons stay disabled after a passing
      // dry-run. On failure STATE.preview is null → the gate early-returns.
      refreshImportBtns();
    }
  }

  function errText(e) {
    if (e && e.detail && typeof e.detail === 'object' && Array.isArray(e.detail.errors)) {
      return (e.detail.message || 'Pack không hợp lệ') + ': ' + e.detail.errors.join(' · ');
    }
    return (e && e.message) || 'Lỗi không xác định.';
  }

  function renderResult(p) {
    $('fi-result-card').hidden = false;
    var host = $('fi-result');
    var meta = p.metadata || {};
    var html = '';
    if (p.ok) {
      html += '<div class="fi-banner fi-banner--ok">✓ Pack hợp lệ — sẵn sàng import.</div>';
    } else {
      html += '<div class="fi-banner fi-banner--err">✗ Pack KHÔNG hợp lệ — sửa rồi kiểm tra lại. '
            + 'Không thể Import khi còn lỗi.</div>';
      if ((p.errors || []).length) {
        html += '<ul class="fi-errlist">' + p.errors.map(function (e) {
          return '<li>' + escapeHtml(e) + '</li>'; }).join('') + '</ul>';
      }
    }
    // summary (only meaningful when parsed)
    if (p.section_count != null || p.question_count != null) {
      html += '<div class="fi-summary">'
        + '<span>Sections: <b>' + (p.section_count != null ? p.section_count : '?') + '/4</b></span>'
        + '<span>Câu: <b>' + (p.question_count != null ? p.question_count : '?') + '/40</b></span>'
        + '<span>Transcript: <b>' + escapeHtml(meta.transcript_source || '—') + '</b></span>'
        + '<span class="fi-mono">' + escapeHtml(meta.format_version || '') + '</span>'
        + (meta.test_id ? '<span>Test ID: <b class="fi-mono">' + escapeHtml(meta.test_id) + '</b></span>' : '')
        + '</div>';
    }
    if ((p.warnings || []).length) {
      html += '<div class="fi-banner fi-banner--warn">⚠ Cảnh báo:<ul class="fi-errlist">'
        + p.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('')
        + '</ul></div>';
    }
    host.innerHTML = html;

    renderPreview(p);          // B — content preview + IMG-PROMPT extraction
    $('fi-import-actions').hidden = false;
    refreshImportBtns();
  }

  // ── B — content preview + IMG-PROMPT (render-only; data is in the dry-run) ──
  // The dry-run already returns questions[] {q_num, prompt, options, answer,
  // img_prompt, …}. Render a per-section eyeball preview + surface every
  // question's IMG-PROMPT as a copyable block (β diagrams feeder). XSS-safe.
  function previewHtml(p) {
    var qs = (p && p.questions) || [];
    if (!qs.length) return '';
    var bySec = {};
    qs.forEach(function (q) {
      var sec = q.section ? String(q.section).replace(/\D/g, '')
                          : String(Math.floor((((q.q_num || 1)) - 1) / 10) + 1);
      (bySec[sec] = bySec[sec] || []).push(q);
    });
    var imgCount = qs.filter(function (q) { return q.img_prompt; }).length;
    var out = '<details class="fi-preview-box" open><summary>Preview nội dung — '
      + qs.length + ' câu' + (imgCount ? ' · ' + imgCount + ' IMG-PROMPT' : '') + '</summary>';
    Object.keys(bySec).sort(function (a, b) { return a - b; }).forEach(function (sec) {
      out += '<div class="fi-sec"><div class="fi-sec__h">Section ' + escapeHtml(sec) + '</div>';
      bySec[sec].forEach(function (q) {
        out += '<div class="fi-q"><span class="fi-q__num">Câu ' + escapeHtml(String(q.q_num)) + '</span> '
          + '<span class="fi-q__prompt">' + escapeHtml(q.prompt || '') + '</span>';
        if (Array.isArray(q.options) && q.options.length) {
          out += '<ul class="fi-q__opts">' + q.options.map(function (o) {
            return '<li>' + escapeHtml(o) + '</li>'; }).join('') + '</ul>';
        }
        if (q.answer != null && q.answer !== '') {
          out += '<div class="fi-q__ans">Đáp án: <b>' + escapeHtml(String(q.answer)) + '</b></div>';
        }
        if (q.img_prompt) {
          out += '<div class="fi-imgprompt"><div class="fi-imgprompt__h">IMG-PROMPT (câu '
            + escapeHtml(String(q.q_num)) + ') <button type="button" class="fi-copy" data-copy="'
            + escapeHtml(q.img_prompt) + '">Copy</button></div>'
            + '<pre class="fi-imgprompt__body">' + escapeHtml(q.img_prompt) + '</pre></div>';
        }
        out += '</div>';
      });
      out += '</div>';
    });
    return out + '</details>';
  }

  function renderPreview(p) {
    var host = $('fi-preview');
    if (!host) return;
    host.innerHTML = previewHtml(p);
    host.querySelectorAll('.fi-copy').forEach(function (b) {
      b.addEventListener('click', function () {
        try { navigator.clipboard.writeText(b.getAttribute('data-copy') || ''); b.textContent = 'Đã copy'; }
        catch (e) { b.textContent = 'Copy lỗi'; }
      });
    });
  }

  function refreshImportBtns() {
    var p = STATE.preview;
    var importBtn = $('fi-import');
    var archiveBtn = $('fi-archive-import');
    var note = $('fi-import-note');
    if (!p) { return; }
    var dup = !!p.duplicate_test_id;
    var canBase = !!p.ok && !STATE.busy;             // Lesson 16: errors block commit
    var hasAudio = !!STATE.files.audio;

    // plain Import: ok + audio + NOT a duplicate
    importBtn.hidden = dup;
    importBtn.disabled = !(canBase && hasAudio && !dup);
    // combined Archive-old + Import: ok + audio + duplicate
    archiveBtn.hidden = !dup;
    archiveBtn.disabled = !(canBase && hasAudio && dup);

    note.hidden = true;
    if (canBase && !hasAudio) {
      note.hidden = false;
      note.textContent = 'Chọn file audio (.mp3) ở Bước 1 để Import.';
    } else if (dup && canBase) {
      note.hidden = false;
      note.textContent = 'Test ID này đang ACTIVE — "Archive bản cũ & Import" sẽ archive bản cũ rồi import bản mới.';
    }
  }

  // ── STEP 2 → commit (with upload progress) ────────────────────────────────
  function commitXhr(onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('question_paper', STATE.files.question_paper);
      fd.append('solution',       STATE.files.solution);
      fd.append('timings',        STATE.files.timings);
      fd.append('audio',          STATE.files.audio);
      Promise.resolve(window.getSupabase().auth.getSession()).then(function (r) {
        var token = r && r.data && r.data.session ? r.data.session.access_token : null;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', window.api.base + '/admin/listening/import-fulltest/commit');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
        };
        xhr.onload = function () {
          var body = {};
          try { body = JSON.parse(xhr.responseText); } catch (_) {}
          if (xhr.status >= 200 && xhr.status < 300) { resolve(body); return; }
          var d = body.detail;
          var msg = (d && typeof d === 'object')
            ? (d.message || 'HTTP ' + xhr.status) + ((d.errors || []).length ? ': ' + d.errors.join(' · ') : '')
            : (d || ('HTTP ' + xhr.status));
          reject(new Error(msg));
        };
        xhr.onerror = function () { reject(new Error('Mất kết nối khi tải lên.')); };
        xhr.send(fd);
      }).catch(reject);
    });
  }

  async function doCommit() {
    STATE.busy = true;
    $('fi-import').disabled = true; $('fi-archive-import').disabled = true;
    $('fi-progress-wrap').hidden = false;
    setProgress(0, STATE.files.audio ? STATE.files.audio.size : 0);
    try {
      var res = await commitXhr(function (loaded, total) { setProgress(loaded, total); });
      STATE.newTest = res;
      renderDone(res);
      return { ok: true };
    } catch (e) {
      var msg = (e && e.message) || 'Import thất bại.';
      $('fi-import-note').hidden = false;
      $('fi-import-note').textContent = '✗ ' + msg;
      return { ok: false, error: msg };
    } finally {
      STATE.busy = false;
      $('fi-progress-wrap').hidden = true;
      refreshImportBtns();
    }
  }

  function setProgress(loaded, total) {
    var pct = total ? Math.round((loaded / total) * 100) : 0;
    $('fi-progress-bar').style.width = pct + '%';
    $('fi-progress-label').textContent = 'Đang tải lên ' + mb(loaded) + ' / ' + mb(total) + ' (' + pct + '%)…';
  }

  // dup-ACTIVE: archive the live bundle with the same test_id, then commit.
  //
  // RECOVERY-ON-FAILURE (no transaction across these rove HTTP calls): the
  // archive PATCH runs BEFORE the commit, so a commit that fails afterwards
  // (422 / 26MB-upload timeout / network) would leave the site with 0 published
  // bundles. We therefore record what we archived and, if commit fails, restore
  // each archived bundle to its PRIOR status — the site always ends with ≥1 live
  // bundle (or a loud "publish manually" message if even the restore fails).
  //
  // The sequencing core is a pure, dependency-injected function so the recovery
  // is unit-testable with real values (L20) without a DOM.
  async function _archiveThenCommit(deps) {
    var old = await deps.listOld();                  // [{id, status}] — non-archived same test_id
    var archived = [];
    for (var i = 0; i < old.length; i++) {
      await deps.archive(old[i].id);
      archived.push({ id: old[i].id, prevStatus: old[i].status });
    }
    var res = await deps.commit();                   // {ok, error?}
    if (res && res.ok) return { committed: true, archived: archived, restored: [] };
    var restored = [];
    for (var j = 0; j < archived.length; j++) {
      await deps.restore(archived[j].id, archived[j].prevStatus);   // throws → caller surfaces manual-fix msg
      restored.push(archived[j].id);
    }
    return { committed: false, error: res && res.error, archived: archived, restored: restored };
  }

  async function onArchiveImport() {
    if (STATE.busy) return;
    var testId = (STATE.preview && STATE.preview.metadata && STATE.preview.metadata.test_id) || '';
    var note = $('fi-import-note');
    note.hidden = false;
    note.textContent = 'Đang archive bản cũ…';
    var patchStatus = function (id, status) {
      return window.api.patch('/admin/listening/tests/' + encodeURIComponent(id) + '/status', { status: status });
    };
    var deps = {
      listOld: function () {
        return window.api.get('/admin/listening/tests?status=all&limit=50&search=' + encodeURIComponent(testId))
          .then(function (list) {
            return (list.items || [])
              .filter(function (t) { return t.test_id === testId && t.status !== 'archived'; })
              .map(function (t) { return { id: t.id, status: t.status }; });
          });
      },
      archive: function (id) { return patchStatus(id, 'archived'); },
      commit:  function () { note.hidden = true; return doCommit(); },
      restore: function (id, status) { return patchStatus(id, status || 'published'); },
    };
    try {
      var r = await _archiveThenCommit(deps);
      if (!r.committed) {
        note.hidden = false;
        note.textContent = '✗ Import thất bại (' + (r.error || 'lỗi') + ') — đã KHÔI PHỤC '
          + r.restored.length + ' bản cũ về trạng thái trước, site vẫn còn bản live. Sửa pack rồi thử lại.';
      }
    } catch (e) {
      // archive OR restore itself failed → be loud + point to manual recovery
      note.hidden = false;
      note.textContent = '✗ Lỗi archive/khôi phục: ' + ((e && e.message) || '')
        + ' — vào Quản lý Tests kiểm tra trạng thái, có thể cần Publish lại thủ công.';
    }
  }

  function renderDone(d) {
    $('fi-done-card').hidden = false;
    var a = d.audio || {};
    $('fi-done').innerHTML =
      '<div class="fi-banner fi-banner--ok">✓ Đã import <b class="fi-mono">' + escapeHtml(d.test_id || '') + '</b> '
        + '(status <b>' + escapeHtml(d.status || 'draft') + '</b>).</div>'
      + '<div class="fi-summary">'
      + '<span>Sections: <b>' + (d.sections_created != null ? d.sections_created : '?') + '</b></span>'
      + '<span>Exercises: <b>' + (d.exercises_created != null ? d.exercises_created : '?') + '</b></span>'
      + '<span>Audio: <b>' + mb(a.size_bytes) + '</b></span>'
      + '<span class="fi-mono">id ' + escapeHtml(d.id || '') + '</span>'
      + '</div>'
      + ((d.warnings || []).length
          ? '<div class="fi-banner fi-banner--warn">⚠ ' + d.warnings.map(escapeHtml).join(' · ') + '</div>'
          : '');
    $('fi-done-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function onPublish() {
    if (!STATE.newTest || !STATE.newTest.id) return;
    var btn = $('fi-publish');
    btn.disabled = true;
    try {
      var row = await window.api.patch('/admin/listening/tests/'
        + encodeURIComponent(STATE.newTest.id) + '/status', { status: 'published' });
      btn.textContent = '✓ Đã publish (status=' + ((row && row.status) || 'published') + ')';
    } catch (e) {
      btn.disabled = false;
      var note = $('fi-done');
      note.insertAdjacentHTML('beforeend',
        '<div class="fi-banner fi-banner--err">✗ Publish thất bại: ' + escapeHtml((e && e.message) || '') + '</div>');
    }
  }

  function init() {
    DROPS.forEach(wireDrop);
    $('fi-check').addEventListener('click', onCheck);
    $('fi-import').addEventListener('click', doCommit);
    $('fi-archive-import').addEventListener('click', onArchiveImport);
    $('fi-publish').addEventListener('click', onPublish);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
