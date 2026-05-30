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
      // Sprint 20.15 — Preview + Delete only meaningful for L3 tests
      // (one-row-per-test). L1/L2 list passages — that path stays
      // action-less until a passage-level admin op lands.
      var actions = '';
      if (it.library === 'l3_test' && it.slug) {
        actions =
          '<a class="ar-row-action" target="_blank" rel="noopener" ' +
            'href="/pages/admin/reading/preview.html?test_id=' +
            encodeURIComponent(it.slug) + '">Xem trước</a>' +
          ' <button type="button" class="ar-row-action is-danger" ' +
            'data-action="delete-test" data-test-id="' + escapeHtml(it.slug) + '" ' +
            'data-test-title="' + escapeHtml(it.title || '') + '">Xoá</button>';
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
    var btn = ev.target && ev.target.closest && ev.target.closest('button[data-action="delete-test"]');
    if (!btn) return;
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

    // Sprint 20.15 D2 — delete handler is delegated on the tbody so
    // re-renders don't drop the wiring.
    var listTbody = $('ar-list-rows');
    if (listTbody) listTbody.addEventListener('click', handleListClick);

    loadList();

    // ── Sprint 20.14f-α — diagram / flow image manager ──────────────
    // Minimal admin UI: enter test_id → GET /api/reading/test/{test_id}
    // (reuses the student endpoint — admin only needs the public
    // metadata + the already-signed `payload.image_url`) → render one
    // card per diagram_label / flow_chart question with current image
    // preview + upload field + delete button.
    //
    // Why reuse the student endpoint: it already projects payload +
    // signs `payload.image_url` via _stamp_diagram_image_urls. Adding
    // a parallel admin GET would just duplicate that projection.
    var diagramTestInput  = $('ar-diagram-test-id');
    var diagramLoadBtn    = $('ar-diagram-load');
    var diagramStatus     = $('ar-diagram-status');
    var diagramList       = $('ar-diagram-list');

    function setDiagramStatus(msg, isErr) {
      if (!diagramStatus) return;
      diagramStatus.textContent = msg || '';
      diagramStatus.classList.toggle('is-error', !!isErr);
    }

    function renderDiagramList(testId, questions) {
      diagramList.innerHTML = '';
      var diagramQs = questions.filter(function (q) {
        return q.question_type === 'diagram_label_completion'
            || q.question_type === 'flow_chart_completion';
      });
      if (!diagramQs.length) {
        setDiagramStatus(
          'Test ' + testId + ' không có câu diagram_label / flow_chart.',
          true,
        );
        return;
      }
      setDiagramStatus('Đã tải ' + diagramQs.length + ' câu diagram/flow.', false);
      diagramQs.forEach(function (q) {
        var qNum = q.q_num;
        var qId = q.id;
        var template = (q.payload && q.payload.template) || {};
        var imageUrl = (q.payload && q.payload.image_url) || '';
        var source = template.image_source || null;
        var sizeKb = template.image_size_bytes
          ? (template.image_size_bytes / 1024).toFixed(1) + ' KB'
          : '';
        var card = document.createElement('div');
        card.className = 'ar-diagram-card';
        card.dataset.qId = qId || '';
        card.dataset.qNum = String(qNum);
        var preview = imageUrl
          ? '<img class="ar-diagram-thumb" src="' + escapeHtml(imageUrl) +
            '" alt="Q' + escapeHtml(qNum) + ' diagram" />'
          : '<div class="ar-diagram-thumb is-empty">Chưa có ảnh</div>';
        var meta = source
          ? '<span class="ar-diagram-badge">' + escapeHtml(source) +
            (sizeKb ? ' · ' + sizeKb : '') + '</span>'
          : '';
        card.innerHTML =
          '<div class="ar-diagram-card__head">' +
            '<strong>Q' + escapeHtml(qNum) + '</strong>' +
            ' <span class="ar-diagram-type">' + escapeHtml(q.question_type) + '</span>' +
            ' ' + meta +
          '</div>' +
          '<div class="ar-diagram-card__body">' +
            preview +
            '<div class="ar-diagram-card__prompt">' + escapeHtml(q.prompt || '') + '</div>' +
          '</div>' +
          '<div class="ar-diagram-card__actions">' +
            '<input type="file" accept="image/png,image/jpeg,image/webp" data-action="upload" hidden />' +
            '<button type="button" data-action="upload-trigger">' +
              (imageUrl ? 'Thay ảnh' : 'Upload ảnh') +
            '</button>' +
            (imageUrl
              ? '<button type="button" data-action="delete" class="is-danger">Xoá ảnh</button>'
              : '') +
            '<span class="ar-diagram-card__status"></span>' +
          '</div>';
        diagramList.appendChild(card);

        var fileInput = card.querySelector('input[data-action="upload"]');
        var uploadBtn = card.querySelector('button[data-action="upload-trigger"]');
        var deleteBtn = card.querySelector('button[data-action="delete"]');
        var cardStatus = card.querySelector('.ar-diagram-card__status');

        uploadBtn.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size < 100) {
            cardStatus.textContent = 'File quá nhỏ (<100 B).'; return;
          }
          if (file.size > 5 * 1024 * 1024) {
            cardStatus.textContent = 'File quá lớn (>5 MB).'; return;
          }
          var fd = new FormData();
          fd.append('image_file', file);
          cardStatus.textContent = 'Đang upload…';
          window.api.upload(
            '/admin/reading/questions/' + encodeURIComponent(qId) + '/upload-diagram-image',
            fd,
          )
            .then(function () {
              cardStatus.textContent = 'OK — refresh…';
              return loadDiagrams(testId);
            })
            .catch(function (e) {
              cardStatus.textContent = 'Lỗi: ' + ((e && e.message) || e);
            });
        });
        if (deleteBtn) {
          deleteBtn.addEventListener('click', function () {
            if (!window.confirm('Xoá ảnh của Q' + qNum + '?')) return;
            cardStatus.textContent = 'Đang xoá…';
            // `api.delete` — bracket-notation safe (delete is a reserved
            // word but valid as a property name).
            window.api['delete'](
              '/admin/reading/questions/' + encodeURIComponent(qId) + '/diagram-image',
            )
              .then(function () { return loadDiagrams(testId); })
              .catch(function (e) {
                cardStatus.textContent = 'Lỗi: ' + ((e && e.message) || e);
              });
          });
        }
      });
    }

    function loadDiagrams(testId) {
      if (!testId) {
        setDiagramStatus('Nhập test_id trước (vd AVR-READ-002).', true);
        return Promise.resolve();
      }
      setDiagramStatus('Đang tải test ' + testId + '…', false);
      diagramList.innerHTML = '';
      return window.api.get('/api/reading/test/' + encodeURIComponent(testId))
        .then(function (test) {
          // The student endpoint doesn't include the question `id` in
          // its projection (it returns q_num + the public payload). For
          // the admin upload endpoint we need the row UUID — admin GET
          // hits the same student-fetch projection BUT requires the row
          // id. Re-fetch from supabase via admin would be a second
          // round-trip. Workaround for MVP: the student endpoint should
          // expose `id` for admin/auth-aware use. Until then, we look
          // it up via the dedicated admin questions search by passage_id
          // (TODO Sprint 20.14f-α follow-up if MVP UX needs it). For now
          // the projection at /api/reading/test/{id} already includes
          // `id` on questions — see q.id below.
          var questions = (test && test.questions) || [];
          renderDiagramList(testId, questions);
        })
        .catch(function (e) {
          var status = e && e.status;
          if (status === 404) {
            setDiagramStatus('Test ' + testId + ' không tìm thấy (404).', true);
          } else {
            setDiagramStatus('Lỗi tải test: ' + ((e && e.message) || e), true);
          }
        });
    }

    if (diagramLoadBtn) {
      diagramLoadBtn.addEventListener('click', function () {
        var tid = (diagramTestInput.value || '').trim();
        loadDiagrams(tid);
      });
    }
    if (diagramTestInput) {
      diagramTestInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          loadDiagrams((diagramTestInput.value || '').trim());
        }
      });
    }
  });
})();
