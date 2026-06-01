/* frontend/js/admin-reading-preview.js — Sprint 20.15 D1 admin preview.
 *
 * Renders an uploaded L3 reading test in a verification-focused layout:
 * each of the 3 passages + every question with options, answer, accepted
 * alternatives, explanation, and (for diagram/flow) the signed image
 * preview. Reads from GET /admin/reading/content/tests/{test_id} which
 * INCLUDES answer keys (the student detail strips them; this admin
 * endpoint exposes them because verifying the keys is the whole point
 * of the preview).
 *
 * Mostly a verification view (keys + parsed content). The diagram/flow
 * image upload+delete UX is folded in here per question
 * (reading-admin-preview-fix) so admins manage images in context; the test
 * import + delete actions still live on /admin/reading/content.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {}
  }

  var $ = function (id) { return document.getElementById(id); };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function getQueryParam(name) {
    try {
      var params = new URLSearchParams(window.location.search);
      return (params.get(name) || '').trim();
    } catch (e) { return ''; }
  }

  // Friendly Vietnamese labels for the question types so reviewers
  // don't have to memorise the enum tags.
  var QTYPE_LABEL = {
    mcq_single:                 'MCQ (1 đáp án)',
    mcq_multi:                  'MCQ (chọn 2+)',
    true_false_not_given:       'True / False / Not Given',
    yes_no_not_given:           'Yes / No / Not Given',
    matching_headings:          'Matching Headings',
    matching_information:       'Matching Information',
    matching_features:          'Matching Features',
    matching_sentence_endings:  'Matching Sentence Endings',
    sentence_completion:        'Sentence Completion',
    summary_completion:         'Summary Completion',
    notes_completion:           'Notes Completion',
    table_completion:           'Table Completion',
    form_completion:            'Form Completion',
    flow_chart_completion:      'Flow Chart Completion',
    diagram_label_completion:   'Diagram Label Completion',
    short_answer:               'Short Answer',
  };

  function setState(msg) {
    var el = $('ar-preview-state');
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
  }
  function setError(msg) {
    var el = $('ar-preview-error');
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
  }

  function renderAnswer(q) {
    var ans = (q.answer && q.answer.answer);
    if (ans == null) return '<em>—</em>';
    if (Array.isArray(ans)) {
      // mcq_multi: render labels as a small comma-joined list with
      // monospace so order + extras are easy to spot.
      return '<code>[' + ans.map(escapeHtml).join(', ') + ']</code>';
    }
    return '<code>' + escapeHtml(String(ans)) + '</code>';
  }
  function renderAlternatives(q) {
    var alts = (q.answer && q.answer.alternatives) || [];
    if (!Array.isArray(alts) || !alts.length) return '<em>không có</em>';
    return alts.map(function (a) {
      return '<code>' + escapeHtml(String(a)) + '</code>';
    }).join(' · ');
  }
  function renderOptions(q) {
    var opts = (q.payload && q.payload.options) || [];
    if (!Array.isArray(opts) || !opts.length) return '';
    return '<ul class="ar-preview-options">' +
      opts.map(function (o) {
        var label = (o.label != null) ? String(o.label) : '';
        return '<li><strong>' + escapeHtml(label) + '</strong> ' +
          escapeHtml(o.text || '') + '</li>';
      }).join('') +
      '</ul>';
  }
  function renderTemplate(q) {
    var tmpl = (q.payload && q.payload.template) || null;
    if (!tmpl) return '';
    // Only summary_text + image_storage_path get human-friendly
    // rendering; other template keys dump as <code> JSON for review.
    var bits = [];
    if (typeof tmpl.summary_text === 'string') {
      bits.push(
        '<div class="ar-preview-summary-text">' +
          '<strong>summary_text:</strong>' +
          '<pre>' + escapeHtml(tmpl.summary_text) + '</pre>' +
        '</div>',
      );
    }
    if (typeof tmpl.image_storage_path === 'string') {
      bits.push(
        '<div class="ar-preview-img-meta">' +
          '<strong>diagram image:</strong> ' +
          '<code>' + escapeHtml(tmpl.image_storage_path) + '</code> ' +
          '<span class="ar-preview-img-meta__source">(' +
            escapeHtml(tmpl.image_source || 'unknown') + ')</span>' +
        '</div>',
      );
    }
    var unknown = Object.keys(tmpl).filter(function (k) {
      return k !== 'summary_text' && !k.indexOf('image_') === 0
          && k !== 'image_storage_path' && k !== 'image_size_bytes'
          && k !== 'image_format' && k !== 'image_source'
          && k !== 'image_uploaded_at' && k !== 'image_uploaded_by'
          && k !== 'paragraph_labels' && k !== 'choose';
    });
    if (unknown.length) {
      // Dump anything we don't know about so the reviewer sees it.
      var dump = {};
      unknown.forEach(function (k) { dump[k] = tmpl[k]; });
      bits.push(
        '<div class="ar-preview-tmpl-extras"><strong>template (extras):</strong> ' +
        '<code>' + escapeHtml(JSON.stringify(dump)) + '</code></div>',
      );
    }
    if (typeof tmpl.choose === 'number') {
      bits.push('<div><strong>choose:</strong> <code>' + escapeHtml(tmpl.choose) + '</code></div>');
    }
    if (Array.isArray(tmpl.paragraph_labels)) {
      bits.push('<div><strong>paragraph_labels:</strong> <code>' +
        escapeHtml(tmpl.paragraph_labels.join(',')) + '</code></div>');
    }
    return bits.join('');
  }
  function renderImagePreview(q) {
    var imgUrl = (q.payload && q.payload.image_url) || '';
    if (!imgUrl) return '';
    return '<div class="ar-preview-img">' +
      '<img src="' + escapeHtml(imgUrl) + '" alt="Diagram for Q' + escapeHtml(q.q_num) + '" />' +
      '</div>';
  }

  // reading-admin-preview-fix — diagram/flow image manager, folded INTO the
  // preview (was a standalone "type test_id" panel on /admin/reading/content).
  // Each diagram_label / flow_chart question gets inline upload/delete controls
  // keyed by the question id (q.id, which the admin preview endpoint returns).
  // The controls call the existing 20.14f-α endpoints; on success we re-fetch
  // the test so the signed image preview refreshes.
  var DIAGRAM_TYPES = { diagram_label_completion: 1, flow_chart_completion: 1 };

  // l3-edit-delete-block-images — the diagram/flow image belongs to the
  // question BLOCK (a run of consecutive same-type questions), not each
  // question: the first Q of the run owns it and the student renders it ONCE
  // for the whole run. So the upload/delete control belongs on the run's LEAD
  // question only. `role` is {lead:true} on the lead, {lead:false, leadQNum}
  // on a member, or null for non-diagram questions.
  function renderDiagramControls(q) {
    if (!DIAGRAM_TYPES[q.question_type] || !q.id) return '';
    var hasImg = !!(q.payload && q.payload.image_url);
    return '<div class="ar-diagram-card__actions" data-diagram-controls ' +
        'data-q-id="' + escapeHtml(q.id) + '" data-q-num="' + escapeHtml(q.q_num) + '">' +
      '<input type="file" accept="image/png,image/jpeg,image/webp" data-action="upload" hidden />' +
      '<button type="button" class="ar-row-action" data-action="upload-trigger">' +
        (hasImg ? 'Thay ảnh sơ đồ' : 'Upload ảnh sơ đồ') +
      '</button>' +
      (hasImg
        ? '<button type="button" class="ar-row-action is-danger" data-action="delete">Xoá ảnh</button>'
        : '') +
      '<span class="ar-diagram-card__status"></span>' +
    '</div>';
  }

  // reading-rich Part B — the lower bound of a "1-6" / "33–37" qrange (en-dash
  // or hyphen), used to match an extracted IMG-PROMPT to its diagram run's lead.
  function _qrangeLow(qrange) {
    var m = /(\d+)/.exec(String(qrange || ''));
    return m ? parseInt(m[1], 10) : null;
  }
  function _promptForLead(imgPrompts, leadQNum) {
    return (imgPrompts || []).filter(function (ip) {
      return _qrangeLow(ip && ip.qrange) === leadQNum;
    })[0] || null;
  }

  // reading-rich Part B — the extracted IMG-PROMPT, shown next to the block's
  // #374 upload control on the run's lead Q. Collapsible (the prompt is long) +
  // a copy button so the admin copies it → generates the diagram externally →
  // uploads via #374. Manual workflow; no auto-gen. XSS-safe (escapeHtml; the
  // copy handler reads the <pre>'s textContent → original chars).
  function renderImgPrompt(ip) {
    if (!ip || !ip.prompt) return '';
    var meta = [ip.id, ip.type, ip.qrange ? ('Q' + ip.qrange) : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    return '<details class="ar-imgprompt">' +
      '<summary class="ar-imgprompt__summary">🎨 Prompt tạo ảnh sơ đồ (copy để generate ngoài rồi upload)</summary>' +
      '<div class="ar-imgprompt__bar">' +
        '<code class="ar-imgprompt__id">' + meta + '</code>' +
        '<button type="button" class="ar-row-action" data-action="copy-prompt">Copy prompt</button>' +
        '<span class="ar-imgprompt__status" aria-live="polite"></span>' +
      '</div>' +
      '<pre class="ar-imgprompt__text">' + escapeHtml(ip.prompt) + '</pre>' +
    '</details>';
  }

  function renderDiagramBlock(q, role, imgPrompt) {
    if (!role) return '';                      // not a diagram/flow question
    if (role.lead) {
      // The lead carries the (shared) image preview + the ONE upload control +
      // (when present) the extracted IMG-PROMPT for the copy→generate workflow.
      return renderImagePreview(q) + renderDiagramControls(q) + renderImgPrompt(imgPrompt);
    }
    // A non-lead member of the run: no control — the image is shared from the
    // lead. A small note tells the admin where to manage it.
    return '<div class="ar-diagram-card__shared">↳ Dùng chung ảnh sơ đồ với Q' +
      escapeHtml(role.leadQNum) + ' (quản lý ảnh ở Q' + escapeHtml(role.leadQNum) + ').</div>';
  }

  function renderQuestion(q, diagramRole, imgPrompt) {
    var typeLabel = QTYPE_LABEL[q.question_type] || q.question_type;
    return '<article class="ar-preview-q" data-q="' + escapeHtml(q.q_num) + '">' +
      '<header class="ar-preview-q__head">' +
        '<span class="ar-preview-q__num">Q' + escapeHtml(q.q_num) + '</span>' +
        '<span class="ar-preview-q__type">' + escapeHtml(typeLabel) +
          ' <code>' + escapeHtml(q.question_type) + '</code></span>' +
        '<span class="ar-preview-q__skill">' + escapeHtml(q.skill_tag || '') + '</span>' +
      '</header>' +
      '<p class="ar-preview-q__prompt">' + escapeHtml(q.prompt || '') + '</p>' +
      renderTemplate(q) +
      renderOptions(q) +
      renderDiagramBlock(q, diagramRole, imgPrompt) +
      '<dl class="ar-preview-q__keys">' +
        '<dt>Đáp án</dt><dd>' + renderAnswer(q) + '</dd>' +
        '<dt>Đáp án thay thế</dt><dd>' + renderAlternatives(q) + '</dd>' +
        (q.explanation
          ? '<dt>Lời giải</dt><dd>' + escapeHtml(q.explanation) + '</dd>'
          : '') +
      '</dl>' +
    '</article>';
  }

  // Render a passage's questions, detecting diagram/flow RUNS (consecutive
  // same-type) the same way the student renderer does (reading-exam.js
  // _consecutiveTypeRuns), so the image control shows once per run on the
  // lead question. l3-edit-delete-block-images.
  function renderQuestionsForPassage(qs, imgPrompts) {
    var out = [];
    var leadQNum = null;
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var isDiagram = !!DIAGRAM_TYPES[q.question_type];
      var role = null;
      var imgPrompt = null;
      if (isDiagram) {
        var sameAsPrev = i > 0 && qs[i - 1].question_type === q.question_type;
        if (!sameAsPrev) {
          leadQNum = q.q_num; role = { lead: true };
          // match the extracted IMG-PROMPT to this run's lead (Part B)
          imgPrompt = _promptForLead(imgPrompts, leadQNum);
        } else { role = { lead: false, leadQNum: leadQNum }; }
      }
      out.push(renderQuestion(q, role, imgPrompt));
    }
    return out.join('');
  }

  function renderPassageBody(md) {
    // Reuse the shared markdown renderer with `breaks: false` so the
    // hard-wrapped YAML literal blocks flow naturally — matches the
    // student exam-UI fix from Sprint 20.14d.
    if (window.renderMarkdown) {
      return window.renderMarkdown(md || '', { breaks: false });
    }
    // Fallback when the markdown CDN didn't load — escape + <pre>.
    return '<pre class="md-fallback">' + escapeHtml(md || '') + '</pre>';
  }

  function renderTest(test) {
    var passages = test.passages || [];
    var questions = test.questions || [];
    var meta = $('ar-preview-meta');
    if (meta) {
      var summary = [
        test.module || '',
        (test.passage_count || passages.length) + ' passages',
        (test.total_questions || questions.length) + ' questions',
        test.time_limit_minutes ? (test.time_limit_minutes + ' min') : '',
        'status: ' + (test.status || 'unknown'),
      ].filter(Boolean).join(' · ');
      meta.textContent = '[' + (test.test_id || '') + '] ' + (test.title || '') + ' — ' + summary;
    }

    var byPassage = {};
    questions.forEach(function (q) {
      var k = q.passage_id || ('passage-' + (q.passage_order || 1));
      (byPassage[k] = byPassage[k] || []).push(q);
    });

    var host = $('ar-preview-passages');
    if (!host) return;
    host.innerHTML = passages.map(function (p) {
      var qs = (byPassage[p.id] || []).slice().sort(function (a, b) {
        return (a.q_num || 0) - (b.q_num || 0);
      });
      return '<section class="ar-preview-passage" id="passage-' + escapeHtml(p.passage_order || '') + '">' +
        '<header class="ar-preview-passage__head">' +
          '<div class="ar-preview-passage__eyebrow">Passage ' + escapeHtml(p.passage_order || '') + '</div>' +
          '<h2 class="ar-preview-passage__title">' + escapeHtml(p.title || '') + '</h2>' +
          '<p class="ar-preview-passage__meta"><code>' + escapeHtml(p.slug || '') + '</code>' +
            (p.word_count ? ' · ' + escapeHtml(p.word_count) + ' words' : '') +
            (p.status ? ' · status: ' + escapeHtml(p.status) : '') +
          '</p>' +
        '</header>' +
        '<div class="ar-preview-passage__body md-body">' + renderPassageBody(p.body_markdown) + '</div>' +
        '<div class="ar-preview-passage__qs">' +
          renderQuestionsForPassage(qs, p.img_prompts) +
        '</div>' +
      '</section>';
    }).join('');

    $('ar-preview-content').hidden = false;
    setState('');
  }

  var CURRENT_TEST_ID = '';

  function loadTest(testId) {
    setState('Đang tải test ' + testId + '…');
    setError('');
    return window.api.get('/admin/reading/content/tests/' + encodeURIComponent(testId))
      .then(function (test) {
        setState('');
        renderTest(test);
      })
      .catch(function (e) {
        setState('');
        if (e && e.status === 404) {
          setError('Test ' + testId + ' không tìm thấy.');
        } else if (e && e.status === 401) {
          setError('Chưa đăng nhập admin.');
        } else if (e && e.status === 403) {
          setError('Tài khoản hiện tại không phải admin.');
        } else {
          setError('Lỗi tải test: ' + ((e && e.message) || e));
        }
      });
  }

  // ── Diagram image upload / delete (reading-admin-preview-fix) ──────────
  // Delegated on the (persistent) passages host so the wiring survives every
  // re-render. Buttons carry data-q-id; uploads/deletes hit the existing
  // 20.14f-α admin endpoints, then re-fetch so the signed preview refreshes.
  function ctrlOf(el) { return el.closest('[data-diagram-controls]'); }
  function statusEl(ctrl) { return ctrl.querySelector('.ar-diagram-card__status'); }

  function wireDiagramControls() {
    var host = $('ar-preview-passages');
    if (!host) return;

    host.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-action="upload-trigger"]');
      if (trigger) {
        var ctrl = ctrlOf(trigger);
        if (ctrl) ctrl.querySelector('input[data-action="upload"]').click();
        return;
      }
      // reading-rich Part B — copy the IMG-PROMPT to the clipboard. The raw
      // text is the <pre>'s textContent (escapeHtml round-trips back to the
      // original chars), so the admin can paste it straight into a gen tool.
      var copyBtn = e.target.closest('[data-action="copy-prompt"]');
      if (copyBtn) {
        var box = copyBtn.closest('.ar-imgprompt');
        var pre = box && box.querySelector('.ar-imgprompt__text');
        var note = box && box.querySelector('.ar-imgprompt__status');
        var text = pre ? pre.textContent : '';
        var done = function (ok) { if (note) note.textContent = ok ? '✓ Đã copy' : 'Copy lỗi — chọn + Ctrl/Cmd-C'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        } else {
          done(false);
        }
        return;
      }
      var del = e.target.closest('[data-action="delete"]');
      if (del) {
        var dctrl = ctrlOf(del);
        if (!dctrl) return;
        var qId = dctrl.getAttribute('data-q-id');
        var qNum = dctrl.getAttribute('data-q-num');
        if (!window.confirm('Xoá ảnh của Q' + qNum + '?')) return;
        statusEl(dctrl).textContent = 'Đang xoá…';
        // bracket notation — `delete` is a reserved word but valid as a key.
        window.api['delete']('/admin/reading/questions/' + encodeURIComponent(qId) + '/diagram-image')
          .then(function () { return loadTest(CURRENT_TEST_ID); })
          .catch(function (err) { statusEl(dctrl).textContent = 'Lỗi: ' + ((err && err.message) || err); });
      }
    });

    host.addEventListener('change', function (e) {
      var input = e.target.closest('input[data-action="upload"]');
      if (!input) return;
      var ctrl = ctrlOf(input);
      if (!ctrl) return;
      var qId = ctrl.getAttribute('data-q-id');
      var st = statusEl(ctrl);
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size < 100) { st.textContent = 'File quá nhỏ (<100 B).'; return; }
      if (file.size > 5 * 1024 * 1024) { st.textContent = 'File quá lớn (>5 MB).'; return; }
      var fd = new FormData();
      fd.append('image_file', file);
      st.textContent = 'Đang upload…';
      window.api.upload(
        '/admin/reading/questions/' + encodeURIComponent(qId) + '/upload-diagram-image', fd,
      )
        .then(function () { return loadTest(CURRENT_TEST_ID); })
        .catch(function (err) { st.textContent = 'Lỗi: ' + ((err && err.message) || err); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var testId = getQueryParam('test_id');
    if (!testId) {
      setState('');
      setError('Thiếu test_id trong URL. Vd: /pages/admin/reading/preview.html?test_id=AVR-READ-001');
      return;
    }
    CURRENT_TEST_ID = testId;
    wireDiagramControls();
    loadTest(testId);
  });
})();
