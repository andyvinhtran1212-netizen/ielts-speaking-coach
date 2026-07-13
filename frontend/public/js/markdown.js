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

  function renderMarkdown(md, opts) {
    // Sprint 20.14d — second arg `opts` lets callers choose CommonMark
    // soft-break semantics (`{ breaks: false }`) instead of the GFM
    // hard-break default. Background: marked's `breaks: true` converts
    // every single `\n` inside a paragraph into `<br>`. For admin-
    // authored writing tips that pattern matches intent — the admin
    // typed a deliberate line break. For IELTS reading passages whose
    // YAML `|` literal-block source is incidentally hard-wrapped at
    // ~60 chars (visual convention for editing), the `<br>` after every
    // source line BREAKS prose reflow — the text wraps at the source's
    // 60-char column instead of the pane's edge, justify can't apply,
    // and resizing the window does nothing. Reading callers pass
    // `{ breaks: false }`; writing-tip callers keep the historic
    // default for back-compat.
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

    var breaks = (opts && typeof opts.breaks === 'boolean') ? opts.breaks : true;
    var rawHtml = window.marked.parse(src, { breaks: breaks, gfm: true });
    return window.DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  }

  window.renderMarkdown = renderMarkdown;
})();
