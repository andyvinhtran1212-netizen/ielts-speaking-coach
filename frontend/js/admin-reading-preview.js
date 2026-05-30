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
 * Read-only. The diagram-image upload UX + the import + delete actions
 * live on /admin/reading/content; this page is for inspecting parsed
 * content + correctness only.
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

  function renderQuestion(q) {
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
      renderImagePreview(q) +
      '<dl class="ar-preview-q__keys">' +
        '<dt>Đáp án</dt><dd>' + renderAnswer(q) + '</dd>' +
        '<dt>Đáp án thay thế</dt><dd>' + renderAlternatives(q) + '</dd>' +
        (q.explanation
          ? '<dt>Lời giải</dt><dd>' + escapeHtml(q.explanation) + '</dd>'
          : '') +
      '</dl>' +
    '</article>';
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
          qs.map(renderQuestion).join('') +
        '</div>' +
      '</section>';
    }).join('');

    $('ar-preview-content').hidden = false;
    setState('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var testId = getQueryParam('test_id');
    if (!testId) {
      setState('');
      setError('Thiếu test_id trong URL. Vd: /pages/admin/reading/preview.html?test_id=AVR-READ-001');
      return;
    }
    setState('Đang tải test ' + testId + '…');
    setError('');
    window.api.get('/admin/reading/content/tests/' + encodeURIComponent(testId))
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
  });
})();
