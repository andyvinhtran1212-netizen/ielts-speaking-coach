/* frontend/js/reading-vocab-passage.js — Sprint 20.2 L1 passage detail.
 *
 * Loads one published L1 passage (GET /api/reading/vocab/{slug}), renders the
 * markdown body, highlights glossary terms (GlossaryPopover), wires the image
 * lightbox, drives the reading-progress bar, and renders light comprehension
 * questions with server-side instant feedback (POST .../check — answer keys
 * never reach the client). No persistence: L1 is ungraded practice.
 *
 * Code-authoritative (Discovery blind-spot #5): a compact purpose-built
 * instant-feedback renderer for the 4 Phase-1 L1 types, NOT the attempt-mode
 * listening player (which is coupled to its own STATE/auto-save).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';
  if (window.initSupabase) { try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) {} }

  var $ = function (id) { return document.getElementById(id); };
  var SESSION = { slug: null };

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

  // ── Reading progress bar ──
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

  // ── Light comprehension questions ──
  // Renderer + server-side check live in the shared component at
  // /js/components/reading-questions.js (Sprint 20.3 extraction — L1 + L2
  // share it; loaded as a classic defer script in this page's head).

  // ── Passage render ──
  function renderPassage(p) {
    document.title = (p.title || 'Bài đọc') + ' — Aver Learning';
    $('rv-title').textContent = p.title || 'Bài đọc';

    var body = $('rv-body');
    // Sprint 20.14d — CommonMark soft-break for prose reflow; see
    // reading-exam.js for the full rationale.
    body.innerHTML = window.renderMarkdown ? window.renderMarkdown(p.body_markdown || '', { breaks: false }) : '';

    // Lead image (Cloudinary) → lightbox. Also wire any inline images.
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
    // reading-l1l2-grammar-toggle — 3-toggle pane swap (Gốc / Dịch / Grammar);
    // shared with the L2 skill page. Subsumes the old translation-only panel.
    // Graceful: missing translation_vi / grammar_focus → that toggle is omitted.
    if (window.ReadingPanes) {
      window.ReadingPanes.mount({
        body:          body,
        translationVi: p.translation_vi,
        grammarFocus:  p.grammar_focus,
      });
    }
    if (window.ReadingQuestions) {
      window.ReadingQuestions.attach({
        host:      $('rv-questions'),
        questions: p.questions || [],
        library:   'vocab',
        slug:      SESSION.slug,
      });
    }
  }

  function load(slug) {
    showState('loading');
    SESSION.slug = slug;
    window.api.get('/api/reading/vocab/' + encodeURIComponent(slug))
      .then(function (p) {
        if (!p) { showState('empty'); return; }
        renderPassage(p);
        showState('ready');
        updateProgress();
      })
      .catch(function (e) {
        if (e && e.status === 404) { showState('empty'); }
        else { showError('Không tải được bài đọc. ' + (e && e.message ? e.message : '')); }
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
