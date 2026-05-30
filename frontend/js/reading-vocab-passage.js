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
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var pct = max > 0 ? Math.min(100, (doc.scrollTop || window.scrollY) / max * 100) : 0;
    $('rv-progress-fill').style.width = pct + '%';
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
    window.addEventListener('scroll', updateProgress, { passive: true });
    var slug = slugFromUrl();
    if (!slug) { showState('empty'); return; }
    load(slug);
  });
})();
