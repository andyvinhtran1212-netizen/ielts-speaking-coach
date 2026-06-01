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

  // mode: 'single' (YAML/L1/L2/L3 one-file) | 'bundle' (prose đề+giải) — set
  // when a preview is run; runCommit routes to the matching endpoint.
  var STATE = { file: null, testFile: null, solutionFile: null, mode: 'single', libraryFilter: '' };

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
    STATE.mode = 'single';
    STATE.file = file;
    $('ar-filename').textContent = file.name;
    $('ar-filename').hidden = false;
    runPreview();
  }

  function resetImport() {
    STATE.file = null;
    STATE.testFile = null;
    STATE.solutionFile = null;
    STATE.mode = 'single';
    $('ar-file').value = '';
    $('ar-filename').hidden = true;
    if ($('ar-bundle-test')) $('ar-bundle-test').value = '';
    if ($('ar-bundle-solution')) $('ar-bundle-solution').value = '';
    if ($('ar-bundle-test-name')) $('ar-bundle-test-name').textContent = '';
    if ($('ar-bundle-solution-name')) $('ar-bundle-solution-name').textContent = '';
    $('ar-preview').hidden = true;
    $('ar-commit').disabled = true;
    setStatus('', null);
  }

  // ── Bundle (prose đề+giải) import — bundle-import-ui ───────────────────
  // The prose format has no YAML frontmatter (the single-file dropzone would
  // reject it), and the answer keys live in the GIẢI file — so the test + the
  // solution must be uploaded TOGETHER to POST /import-bundle. Reuses the same
  // dry-run → preview → commit panel as the single-file flow.
  function pickBundleFile(which, file) {
    var name = (file && file.name) || '';
    if (!file || !/\.(md|markdown)$/i.test(name)) {
      setStatus('Chỉ chấp nhận file .md / .markdown.', 'error');
      return;
    }
    if (which === 'test') { STATE.testFile = file; $('ar-bundle-test-name').textContent = name; }
    else { STATE.solutionFile = file; $('ar-bundle-solution-name').textContent = name; }

    if (STATE.testFile && STATE.solutionFile) {
      runBundlePreview();
    } else {
      // Helpful nudge — NOT the raw YAML-frontmatter error.
      var need = STATE.testFile ? 'GIẢI/đáp án' : 'ĐỀ thi';
      setStatus('Đã chọn 1 file. Chọn thêm file ' + need + ' (.md) để xem trước.', 'info');
    }
  }

  function _bundleFormData() {
    var fd = new FormData();
    fd.append('test_file', STATE.testFile);
    fd.append('solution_file', STATE.solutionFile);
    return fd;
  }

  function runBundlePreview() {
    if (!STATE.testFile || !STATE.solutionFile) return;
    STATE.mode = 'bundle';
    setStatus('Đang phân tích đề + giải…', 'loading');
    window.api.upload('/admin/reading/content/import-bundle?dry_run=true', _bundleFormData())
      .then(renderPreview)
      .catch(function (e) { setStatus('Preview lỗi: ' + (e && e.message || ''), 'error'); });
  }

  function runBundleCommit() {
    if (!STATE.testFile || !STATE.solutionFile) return;
    $('ar-commit').disabled = true;
    setStatus('Đang lưu full test…', 'loading');
    // published=true: the prose format carries no `published` field, and the
    // admin clicking "Lưu" intends the test to go live (gradeable after import).
    window.api.upload('/admin/reading/content/import-bundle?dry_run=false&published=true', _bundleFormData())
      .then(function (res) {
        if (res && res.validation_errors && res.validation_errors.length) {
          renderPreview(res); // re-show errors
          return;
        }
        setStatus('✓ Đã lưu full test (' + (res && res.action) + ', id=' +
                  (res && res.committed_id) + ').', 'success');
        resetImport();
        loadList();
      })
      .catch(function (e) { setStatus('Lưu lỗi: ' + (e && e.message || ''), 'error'); });
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
    if (STATE.mode === 'bundle') { runBundleCommit(); return; }
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
    // bundle-import-ui — what the prose parse extracted (đề+giải dry-run), so
    // the admin can confirm fidelity before committing.
    var bs = res && res.bundle_summary;
    if (bs) {
      rows.push(['bản dịch (passage)', bs.passages_with_translation]);
      rows.push(['IMG-PROMPT (cụm)',   bs.img_prompt_blocks]);
      rows.push(['giải chi tiết (câu)', bs.questions_with_solution]);
    }
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
      // l3-action-consistency — L3 Full Tests are now ALWAYS represented as ONE
      // test row (slug === test_id) in EVERY view (the backend groups L3 into
      // reading_tests rows, never raw passage rows). So L3 gets the same
      // preview + Sửa + Xoá as L1/L2, gated on it.library — unambiguous and
      // 404-safe: every L3 action keys on it.slug, which IS the test_id (#363),
      // NEVER a passage slug. No tab-gating + no parent_test_id needed: the row
      // IS the test, so deleting it is well-defined (no passage-vs-test footgun).
      var actions = '';
      if (it.library === 'l3_test' && it.slug) {
        actions +=
          '<a class="ar-row-action" target="_blank" rel="noopener" ' +
            'href="/pages/admin/reading/preview.html?test_id=' +
            encodeURIComponent(it.slug) + '">Xem trước</a>' +
          // edit = re-import by test_id (idempotent; PRESERVES uploaded diagram
          // images — l3-edit-delete-block-images). delete = attempt-safe (20.15
          // D2 — archives when attempts exist, never hard-deletes student data).
          ' <button type="button" class="ar-row-action" ' +
            'data-action="edit-test" data-test-id="' + escapeHtml(it.slug) + '" ' +
            'data-test-title="' + escapeHtml(it.title || '') + '">Sửa</button>' +
          ' <button type="button" class="ar-row-action is-danger" ' +
            'data-action="delete-test" data-test-id="' + escapeHtml(it.slug) + '" ' +
            'data-test-title="' + escapeHtml(it.title || '') + '">Xoá</button>';
      }
      // admin-reading-l1-l2-actions — standalone L1 vocab / L2 skill passages
      // get preview/edit/delete. STRICTLY slug-based, never test_id, so the
      // #363 404-safety separation holds (L3 = test_id path above; L1/L2 =
      // slug path here). Preview reuses the student page; edit = re-import;
      // delete = hard delete (L1/L2 have no attempts to protect).
      if ((it.library === 'l1_vocab' || it.library === 'l2_skill') && it.slug) {
        var passagePage = it.library === 'l1_vocab'
          ? 'reading-vocab-passage' : 'reading-skill-exercise';
        actions +=
          '<a class="ar-row-action" target="_blank" rel="noopener" ' +
            'href="/pages/' + passagePage + '.html?slug=' +
            encodeURIComponent(it.slug) + '">Xem trước</a>' +
          ' <button type="button" class="ar-row-action" ' +
            'data-action="edit-passage" data-slug="' + escapeHtml(it.slug) + '" ' +
            'data-title="' + escapeHtml(it.title || '') + '">Sửa</button>' +
          ' <button type="button" class="ar-row-action is-danger" ' +
            'data-action="delete-passage" data-slug="' + escapeHtml(it.slug) + '" ' +
            'data-title="' + escapeHtml(it.title || '') + '">Xoá</button>';
      }
      return '<tr>' +
        '<td>' + escapeHtml(it.title || '') + '</td>' +
        '<td><code>' + escapeHtml(it.slug || '') + '</code></td>' +
        '<td>' + escapeHtml(libLabel) + '</td>' +
        '<td>' + escapeHtml(skillOrDiff) + '</td>' +
        '<td><span class="ar-status-pill is-' + escapeHtml(it.status || 'draft') + '">' +
          escapeHtml(it.status || '') + '</span></td>' +
        '<td>' + escapeHtml(date) + '</td>' +
        '<td class="ar-row-actions"><div class="adm-action-group">' + actions + '</div></td>' +
      '</tr>';
    }).join('');
  }

  // Sprint 20.15 D2 — attempt-safe delete handler. Confirms first,
  // then calls the DELETE endpoint and surfaces the action it took
  // (hard `deleted` vs soft `archived`, with attempt count preserved).
  // The handler is wired ONCE via event delegation on the table body
  // so re-renders don't accumulate listeners.
  function handleListClick(ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('button[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'delete-test')   return handleDeleteTest(btn);
    if (action === 'edit-test')     return handleEditTest(btn);
    if (action === 'edit-passage')  return handleEditPassage(btn);
    if (action === 'delete-passage') return handleDeletePassage(btn);
  }

  function handleDeleteTest(btn) {
    var testId = btn.getAttribute('data-test-id');
    var testTitle = btn.getAttribute('data-test-title') || testId;
    if (!testId) return;
    var ok = window.confirm(
      'Xoá test "' + testTitle + '" (' + testId + ')?\n\n' +
      'Nếu test đã có lượt làm bài, server sẽ tự động ARCHIVE để bảo vệ ' +
      'dữ liệu học sinh (đáp án + điểm), không xoá vật lý.\n\n' +
      'Nếu chưa có lượt làm nào, test + 3 passages + ~40 questions sẽ bị ' +
      'xoá vĩnh viễn.',
    );
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'Đang xoá…';
    window.api['delete'](
      '/admin/reading/content/tests/' + encodeURIComponent(testId),
    )
      .then(function (res) {
        var action = (res && res.action) || 'deleted';
        var preserved = (res && res.attempts_preserved) || 0;
        var msg = (action === 'archived')
          ? 'Đã ARCHIVE test "' + testTitle + '" (' + preserved +
            ' lượt làm bài được giữ nguyên). Test sẽ ẩn khỏi học sinh nhưng ' +
            'dữ liệu attempt + điểm vẫn còn để phân tích.'
          : 'Đã xoá vĩnh viễn test "' + testTitle + '" (không có lượt làm nào).';
        window.alert(msg);
        loadList();
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Xoá';
        var status = e && e.status;
        if (status === 404) {
          window.alert('Test ' + testId + ' không tìm thấy (có thể đã bị xoá).');
          loadList();
        } else if (status === 401 || status === 403) {
          window.alert('Không có quyền xoá (cần đăng nhập admin).');
        } else {
          window.alert('Lỗi xoá: ' + ((e && e.message) || e));
        }
      });
  }

  // admin-reading-l1-l2-actions — "Sửa" for a standalone passage. There is no
  // inline editor (out of scope): editing = re-import. The import endpoint is
  // idempotent by slug (UPDATE, created_by preserved), so we reveal the import
  // panel + a contextual hint naming the slug to re-upload.
  function handleEditPassage(btn) {
    var slug = btn.getAttribute('data-slug');
    var title = btn.getAttribute('data-title') || slug;
    if (!slug) return;
    var panel = document.querySelector('.ar-panel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('Để sửa "' + title + '" (slug: ' + slug + '), tải lên lại file .md ' +
              'của bài này — hệ thống cập nhật theo slug (giữ nguyên người tạo).', 'info');
    var dz = $('ar-dropzone');
    if (dz && dz.focus) { try { dz.focus(); } catch (e) {} }
  }

  // l3-edit-delete-block-images — "Sửa" for an L3 full test. Editing = re-import
  // (no inline editor): the import is idempotent by test_id and PRESERVES any
  // uploaded diagram/flow images across the re-import (the backend snapshots +
  // restores payload.template.image_* by q_num). Reveal the import panel + a
  // hint naming the test_id to re-upload.
  function handleEditTest(btn) {
    var testId = btn.getAttribute('data-test-id');
    var title = btn.getAttribute('data-test-title') || testId;
    if (!testId) return;
    var panel = document.querySelector('.ar-panel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('Để sửa test "' + title + '" (' + testId + '), tải lên lại file .md ' +
              'của test — hệ thống cập nhật theo test_id (giữ nguyên ảnh sơ đồ đã upload).', 'info');
    var dz = $('ar-dropzone');
    if (dz && dz.focus) { try { dz.focus(); } catch (e) {} }
  }

  // admin-reading-l1-l2-actions — hard delete for L1/L2. No attempt-safety
  // branch: L1/L2 are ungraded (no attempt rows reference them), so there is
  // no student data to preserve. Content is recoverable by re-importing the
  // .md. The server refuses L3 slugs (409) — those go through the test delete.
  function handleDeletePassage(btn) {
    var slug = btn.getAttribute('data-slug');
    var title = btn.getAttribute('data-title') || slug;
    if (!slug) return;
    var ok = window.confirm(
      'Xoá vĩnh viễn bài "' + title + '" (' + slug + ')?\n\n' +
      'Bài đọc + các câu hỏi của nó sẽ bị xoá khỏi thư viện. L1/L2 là luyện ' +
      'tập không tính điểm nên không ảnh hưởng dữ liệu học sinh. Có thể khôi ' +
      'phục bằng cách import lại file .md.',
    );
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'Đang xoá…';
    window.api['delete'](
      '/admin/reading/content/passages/' + encodeURIComponent(slug),
    )
      .then(function () {
        window.alert('Đã xoá vĩnh viễn bài "' + title + '".');
        loadList();
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Xoá';
        var status = e && e.status;
        if (status === 404) {
          window.alert('Bài ' + slug + ' không tìm thấy (có thể đã bị xoá).');
          loadList();
        } else if (status === 409) {
          window.alert('Bài này thuộc một L3 Full Test — hãy xoá qua tab "L3 Test".');
        } else if (status === 401 || status === 403) {
          window.alert('Không có quyền xoá (cần đăng nhập admin).');
        } else {
          window.alert('Lỗi xoá: ' + ((e && e.message) || e));
        }
      });
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

    // bundle-import-ui — đề + giải file inputs.
    var bt = $('ar-bundle-test');
    var bs = $('ar-bundle-solution');
    if (bt) bt.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickBundleFile('test', e.target.files[0]);
    });
    if (bs) bs.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickBundleFile('solution', e.target.files[0]);
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

    // Sprint 20.15 D2 — delete handler is delegated on the tbody so
    // re-renders don't drop the wiring.
    var listTbody = $('ar-list-rows');
    if (listTbody) listTbody.addEventListener('click', handleListClick);

    loadList();

  });
})();
