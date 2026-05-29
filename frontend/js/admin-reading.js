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
    // Sprint 20.8 A1 — accept by EXTENSION, not MIME. The previous regex
    // tested `name + ' ' + type`; when the OS handed us an empty MIME (common
    // for .md on macOS Safari/Firefox drag-drop) the trailing space made
    // `\.md$` and `\.markdown$` fall off the end of the string, and drops
    // were silently rejected even though the filename was perfectly valid.
    // OS-supplied MIME for .md is unreliable across browsers/platforms; the
    // file extension is the only stable signal.
    var name = (file && file.name) || '';
    if (!file || !/\.(md|markdown)$/i.test(name)) {
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
    var struct = $('ar-structure');
    preview.hidden = false;

    var errs = (res && res.validation_errors) || [];
    if (errs.length) {
      errors.hidden = false;
      errors.innerHTML = '<strong>Có lỗi cần sửa (' + errs.length + '):</strong><ul>' +
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
    var isL3 = d.content_type === 'reading_full_test';

    // Top-level frontmatter table. L3 swaps in test-level fields; L1/L2 keep
    // the original shape so existing flow stays familiar.
    var rows = isL3
      ? [
          ['content_type',      d.content_type],
          ['library',           d.library],
          ['test_id',           d.test_id],
          ['title',             d.title],
          ['module',            d.module],
          ['time_limit_minutes', d.time_limit_minutes],
          ['passage_count',     d.passage_count],
          ['total_questions',   d.total_questions],
          ['band_target',       d.band_target],
          ['published',         d.published ? 'true' : 'false'],
        ]
      : [
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

    // Sprint 20.8 A2 — structured-content preview. Only renders when the
    // dry-run came back clean (otherwise the user is fixing errors, not
    // reviewing structure). Read-only — the workflow stays: external edit
    // → re-upload.
    if (errs.length || !struct) {
      if (struct) { struct.hidden = true; struct.innerHTML = ''; }
      return;
    }
    var html = '';
    if (isL3) {
      var passages = (d.passages || []).slice().sort(function (a, b) {
        return (a.passage_order || 0) - (b.passage_order || 0);
      });
      var total = passages.reduce(function (s, p) { return s + (p.question_count || 0); }, 0);
      html = '<h4 class="ar-struct__title">Cấu trúc bài test</h4>' +
        '<table class="ar-struct__table"><thead><tr>' +
        '<th>Part</th><th>Slug</th><th>Tiêu đề</th>' +
        '<th class="ar-struct__num">Words</th><th class="ar-struct__num">Câu hỏi</th>' +
        '</tr></thead><tbody>' +
        passages.map(function (p) {
          return '<tr>' +
            '<td>Part ' + escapeHtml(String(p.passage_order || '?')) + '</td>' +
            '<td><code>' + escapeHtml(p.slug || '') + '</code></td>' +
            '<td>' + escapeHtml(p.title || '') + '</td>' +
            '<td class="ar-struct__num">' + escapeHtml(String(p.word_count || '—')) + '</td>' +
            '<td class="ar-struct__num">' + escapeHtml(String(p.question_count || 0)) + '</td>' +
          '</tr>';
        }).join('') +
        '<tr class="ar-struct__total"><td colspan="4">Tổng</td>' +
        '<td class="ar-struct__num">' + total + '</td></tr>' +
        '</tbody></table>';
    } else {
      // L1 / L2 — show glossary entries (if any) and body excerpt.
      var glossary = (d.glossary || []);
      var body = String(d.body_markdown || '').trim();
      var excerpt = body.length > 280 ? body.slice(0, 280) + '…' : body;
      var glossaryBlock = glossary.length ? (
        '<h4 class="ar-struct__title">Glossary (' + glossary.length + ')</h4>' +
        '<ul class="ar-struct__glossary">' +
        glossary.slice(0, 8).map(function (g) {
          return '<li><strong>' + escapeHtml(g.term || '') + '</strong> — ' +
                 escapeHtml(g.definition || '') + '</li>';
        }).join('') +
        (glossary.length > 8 ? '<li class="ar-struct__more">+' + (glossary.length - 8) + ' mục khác</li>' : '') +
        '</ul>'
      ) : '';
      var bodyBlock = excerpt ? (
        '<h4 class="ar-struct__title">Đoạn văn (' + body.length.toLocaleString('vi-VN') + ' ký tự)</h4>' +
        '<pre class="ar-struct__body">' + escapeHtml(excerpt) + '</pre>'
      ) : '';
      html = glossaryBlock + bodyBlock;
    }
    struct.innerHTML = html;
    struct.hidden = !html;
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

  // Sprint 20.8 A4 — friendly library labels (raw values like 'l1_vocab' are
  // dense for non-engineer reviewers). The table column keeps width small so
  // we don't pad the label itself.
  var LIBRARY_LABEL = {
    l1_vocab: 'L1 Vocab',
    l2_skill: 'L2 Skill',
    l3_test:  'L3 Test',
  };

  function renderList(items) {
    var tbody = $('ar-list-rows');
    tbody.innerHTML = items.map(function (it) {
      // For L3 rows the backend put the time/Qs summary in skill_focus and
      // the module in difficulty_level — both legitimate "what is this?"
      // signals for the Skill/Difficulty column.
      var skillOrDiff = [it.skill_focus, it.difficulty_level].filter(Boolean).join(' · ');
      var libLabel = LIBRARY_LABEL[it.library] || it.library || '';
      var date = it.updated_at ? new Date(it.updated_at).toISOString().slice(0, 10) : '';
      return '<tr>' +
        '<td>' + escapeHtml(it.title || '') + '</td>' +
        '<td><code>' + escapeHtml(it.slug || '') + '</code></td>' +
        '<td>' + escapeHtml(libLabel) + '</td>' +
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
