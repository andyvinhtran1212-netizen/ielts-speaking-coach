/* frontend/js/reading-skill-exercise.js — Sprint 20.3 L2 exercise detail.
 *
 * Loads one published L2 skill-practice exercise (GET /api/reading/skill/{slug}),
 * renders the markdown body, highlights glossary terms, wires the image
 * lightbox, drives the reading-progress bar, and delegates the questions to
 * the shared ReadingQuestions component (library='skill' → POSTs /check at
 * /api/reading/skill/{slug}/check). Mirrors reading-vocab-passage.js (20.2).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { slug: null };

  // Display labels for the D2 skill_tag enum (kept in lockstep with reading-skill.js).
  var SKILL_LABEL = {
    skimming: 'Skimming',
    scanning: 'Scanning',
    detail: 'Detail',
    main_idea: 'Main idea',
    inference: 'Inference',
    vocabulary_in_context: 'Vocab in context',
    reference_cohesion: 'Reference / cohesion',
    writer_view_TFNG: "Writer's view (T/F/NG)",
  };

  function showState(name) {
    $('state-loading').hidden = name !== 'loading';
    $('state-empty').hidden   = name !== 'empty';
    $('state-error').hidden   = name !== 'error';
    $('rv-passage').hidden    = name !== 'ready';
  }
  function showError(msg) { $('state-error').textContent = msg; showState('error'); }

  function slugFromUrl() {
    return (new URLSearchParams(window.location.search).get('slug') || '').trim() || null;
  }

  function updateProgress() {
    // 2-pane layout: track the passage pane's own scroll when it's the
    // scroller (desktop independent panes); fall back to window scroll
    // (mobile single column). reading-content-rich-layout.
    var pane = document.querySelector('.rv-passage-layout > article');
    var el = (pane && pane.scrollHeight > pane.clientHeight + 1) ? pane : document.documentElement;
    var max = el.scrollHeight - el.clientHeight;
    var pct = max > 0 ? Math.min(100, (el.scrollTop || window.scrollY) / max * 100) : 0;
    var fill = $('rv-progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function renderPassage(p) {
    document.title = (p.title || 'Bài luyện') + ' — Aver Learning';
    $('rv-title').textContent = p.title || 'Bài luyện';

    // The defining L2 affordance: announce which skill this exercise targets.
    if (p.skill_focus) {
      var banner = $('rv-skill-banner');
      banner.hidden = false;
      banner.textContent = 'Kỹ năng: ' + (SKILL_LABEL[p.skill_focus] || p.skill_focus);
    }

    var body = $('rv-body');
    // Sprint 20.14d — same fix as reading-exam.js. CommonMark soft-break
    // for IELTS reading passages so YAML-literal-block hard-wrapped
    // source text reflows to fill the pane, not the source's column.
    body.innerHTML = window.renderMarkdown ? window.renderMarkdown(p.body_markdown || '', { breaks: false }) : '';

    if (p.image_url) {
      var img = document.createElement('img');
      img.className = 'prompt-chart-img'; img.src = p.image_url;
      img.alt = p.title || ''; img.setAttribute('role', 'button'); img.tabIndex = 0;
      body.insertBefore(img, body.firstChild);
    }
    body.querySelectorAll('img').forEach(function (im) {
      im.classList.add('prompt-chart-img');
      im.addEventListener('click', function () {
        if (window.AvImageLightbox) window.AvImageLightbox.open(im.src, im.alt);
      });
    });

    if (window.GlossaryPopover) window.GlossaryPopover.attach(body, p.glossary || []);
    if (window.ReadingQuestions) {
      window.ReadingQuestions.attach({
        host:      $('rv-questions'),
        questions: p.questions || [],
        library:   'skill',
        slug:      SESSION.slug,
      });
    }
  }

  function load(slug) {
    showState('loading');
    SESSION.slug = slug;
    window.api.get('/api/reading/skill/' + encodeURIComponent(slug))
      .then(function (p) {
        if (!p) { showState('empty'); return; }
        renderPassage(p);
        showState('ready');
        updateProgress();
      })
      .catch(function (e) {
        if (e && e.status === 404) { showState('empty'); }
        else { showError('Không tải được bài luyện. ' + (e && e.message ? e.message : '')); }
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Capture phase catches scroll from the passage pane too (scroll doesn't
    // bubble, but it propagates in capture) — covers both pane + window.
    document.addEventListener('scroll', updateProgress, { passive: true, capture: true });
    var slug = slugFromUrl();
    if (!slug) { showState('empty'); return; }
    load(slug);
  });
})();
