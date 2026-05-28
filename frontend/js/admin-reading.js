/* frontend/js/admin-reading.js — Sprint 20.3 admin Reading content page.
 *
 * Wraps the existing POST /admin/reading/content/import endpoint (Sprint 20.1,
 * extended in 20.2 for questions) with a real UI: drag-drop a .md file →
 * preview (dry_run=true) → commit (dry_run=false) → success → list refresh.
 * Plus a GET /admin/reading/content list panel with library filter tabs.
 *
 * Solves the curl-only content-production friction Andy hit dogfooding 20.2.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };

  var STATE = { file: null, libraryFilter: '' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function setStatus(msg, kind) {
    var el = $('ar-status');
    el.hidden = !msg;
    el.className = 'ar-status' + (kind ? ' is-' + kind : '');
    el.textContent = msg || '';
  }

  // ── Import flow ──────────────────────────────────────────────────────

  function pickFile(file) {
    if (!file || !/\.md$|\.markdown$|^text\/markdown$/.test(file.name + ' ' + (file.type || ''))) {
      setStatus('Chỉ chấp nhận file .md / .markdown.', 'error');
      return;
    }
    STATE.file = file;
    $('ar-filename').textContent = file.name;
    $('ar-filename').hidden = false;
    runPreview();
  }

  function resetImport() {
    STATE.file = null;
    $('ar-file').value = '';
    $('ar-filename').hidden = true;
    $('ar-preview').hidden = true;
    $('ar-commit').disabled = true;
    setStatus('', null);
  }

  function runPreview() {
    if (!STATE.file) return;
    setStatus('Đang kiểm tra…', 'loading');
    var fd = new FormData();
    fd.append('file', STATE.file);
    window.api.upload('/admin/reading/content/import?dry_run=true', fd)
      .then(renderPreview)
      .catch(function (e) { setStatus('Preview lỗi: ' + (e && e.message || ''), 'error'); });
  }

  function runCommit() {
    if (!STATE.file) return;
    $('ar-commit').disabled = true;
    setStatus('Đang lưu…', 'loading');
    var fd = new FormData();
    fd.append('file', STATE.file);
    window.api.upload('/admin/reading/content/import?dry_run=false', fd)
      .then(function (res) {
        if (res && res.validation_errors && res.validation_errors.length) {
          renderPreview(res); // re-show errors
          return;
        }
        setStatus('✓ Đã lưu (' + (res && res.action) + ', id=' +
                  (res && res.committed_id) + ').', 'success');
        resetImport();
        loadList();
      })
      .catch(function (e) { setStatus('Lưu lỗi: ' + (e && e.message || ''), 'error'); });
  }

  function renderPreview(res) {
    setStatus('', null);
    var preview = $('ar-preview');
    var errors = $('ar-errors');
    var kv = $('ar-kv');
    var commit = $('ar-commit');
    preview.hidden = false;

    var errs = (res && res.validation_errors) || [];
    if (errs.length) {
      errors.hidden = false;
      errors.innerHTML = '<strong>Có lỗi cần sửa:</strong><ul>' +
        errs.map(function (e) {
          return '<li><code>' + escapeHtml(e.field) + '</code>: ' + escapeHtml(e.message) + '</li>';
        }).join('') + '</ul>';
      commit.disabled = true;
    } else {
      errors.hidden = true;
      errors.innerHTML = '';
      commit.disabled = false;
    }

    var d = (res && res.parsed_data) || {};
    var rows = [
      ['content_type',     d.content_type],
      ['library',          d.library],
      ['title',            d.title],
      ['slug',             d.slug],
      ['difficulty_level', d.difficulty_level],
      ['skill_focus',      d.skill_focus],
      ['topic_tags',       (d.topic_tags || []).join(', ')],
      ['image_url',        d.image_url],
      ['glossary',         (d.glossary && d.glossary.length) ? d.glossary.length + ' mục' : ''],
      ['questions',        d.question_count || 0],
      ['published',        d.published ? 'true' : 'false'],
    ];
    kv.innerHTML = rows.map(function (r) {
      var v = r[1] == null || r[1] === '' ? '<span class="ar-kv__empty">—</span>' : escapeHtml(String(r[1]));
      return '<tr><th>' + escapeHtml(r[0]) + '</th><td>' + v + '</td></tr>';
    }).join('');
  }

  // ── List flow ────────────────────────────────────────────────────────

  function loadList() {
    var qs = new URLSearchParams();
    if (STATE.libraryFilter) qs.set('library', STATE.libraryFilter);
    qs.set('limit', '200');

    $('ar-list-state').hidden = false;
    $('ar-list-state').textContent = 'Đang tải…';
    $('ar-list-empty').hidden = true;
    $('ar-list-table').hidden = true;

    window.api.get('/admin/reading/content?' + qs.toString())
      .then(function (res) {
        var items = (res && res.items) || [];
        $('ar-list-state').hidden = true;
        if (!items.length) { $('ar-list-empty').hidden = false; return; }
        renderList(items);
        $('ar-list-table').hidden = false;
      })
      .catch(function (e) {
        $('ar-list-state').textContent = 'Không tải được danh sách: ' + (e && e.message || '');
      });
  }

  function renderList(items) {
    var tbody = $('ar-list-rows');
    tbody.innerHTML = items.map(function (it) {
      var skillOrDiff = it.skill_focus || it.difficulty_level || '';
      var date = it.updated_at ? new Date(it.updated_at).toISOString().slice(0, 10) : '';
      return '<tr>' +
        '<td>' + escapeHtml(it.title || '') + '</td>' +
        '<td><code>' + escapeHtml(it.slug || '') + '</code></td>' +
        '<td>' + escapeHtml(it.library || '') + '</td>' +
        '<td>' + escapeHtml(skillOrDiff) + '</td>' +
        '<td><span class="ar-status-pill is-' + escapeHtml(it.status || 'draft') + '">' +
          escapeHtml(it.status || '') + '</span></td>' +
        '<td>' + escapeHtml(date) + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Wiring ──────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    var dz = $('ar-dropzone');
    var input = $('ar-file');

    input.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickFile(e.target.files[0]);
    });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('is-drag'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('is-drag');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
    });

    $('ar-reset').addEventListener('click', resetImport);
    $('ar-commit').addEventListener('click', runCommit);

    document.querySelectorAll('.ar-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.ar-filter').forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        STATE.libraryFilter = btn.getAttribute('data-library') || '';
        loadList();
      });
    });

    loadList();
  });
})();
