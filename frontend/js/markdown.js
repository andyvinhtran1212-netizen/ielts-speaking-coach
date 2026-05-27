/* frontend/js/markdown.js — Sprint 19.1B shared markdown renderer.
 *
 * Exposes window.renderMarkdown(md) → sanitized HTML string. Used by the
 * student "Mẹo viết" tab (writing-dashboard.html) and the admin tips
 * editor preview (admin/writing/tips.html).
 *
 * Hard rule: NEVER inject un-sanitized HTML. Admin-authored markdown is
 * rendered in other users' browsers, so every render passes through
 * DOMPurify. If either CDN lib (marked / DOMPurify) failed to load, we
 * fall back to escaped plaintext in a <pre> rather than risk XSS.
 *
 * Pattern #15: CDN load (precedent: Tailwind, Supabase, Lucide). No npm.
 * Loaded only on the two pages that need it (not bundled app-wide).
 */
(function () {
  'use strict';

  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function renderMarkdown(md) {
    var src = String(md == null ? '' : md);
    if (!src.trim()) return '';

    var hasMarked = window.marked && typeof window.marked.parse === 'function';
    var hasPurify = window.DOMPurify && typeof window.DOMPurify.sanitize === 'function';

    // Defensive: a blocked/slow CDN must NOT cause raw HTML injection.
    if (!hasMarked || !hasPurify) {
      if (window.console) {
        console.warn('[markdown] marked/DOMPurify not loaded — rendering plaintext fallback');
      }
      return '<pre class="md-fallback">' + escapeText(src) + '</pre>';
    }

    var rawHtml = window.marked.parse(src, { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  }

  window.renderMarkdown = renderMarkdown;
})();
