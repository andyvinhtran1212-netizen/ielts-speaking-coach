/**
 * frontend/js/vocab-modules/_source-link.js — Sprint 10.8 (foundation 8/9).
 *
 * Single-source renderer for the "↗ nguồn" link that takes the user
 * back to the speaking-session result page that captured a vocab item.
 *
 * Rendering rules (Andy Q1/Q2/Q3 locked, 2026-05-16):
 *   - Capture-sourced cards (item.session_id is truthy): render the link.
 *   - Manual-add cards (no session_id): render nothing.
 *   - Session deleted: same as manual-add — the FK on user_vocabulary.
 *     session_id is `ON DELETE SET NULL`, so a hard-deleted session
 *     leaves session_id=null on the vocab row, which naturally hides
 *     the link without any client-side existence check.
 *
 * Why a shared helper:
 *   Pre-10.8 the link was open-coded in my-vocab.js and needs-review.js
 *   with byte-identical markup. Pending-vocab.js had no source link at
 *   all. Three surfaces emitting the same primitive is exactly the
 *   drift-risk shape Sprint 6.x callouts about renderer-emitted classes
 *   warned against — extracting the helper here makes the contract
 *   explicit and gives a single sentinel to pin in tests.
 *
 * Output contract:
 *   - Always a string (never null/undefined) so templates can interpolate
 *     it unconditionally with `${renderSourceLink(item)}`.
 *   - Empty string when the link should be hidden.
 *   - When rendered, the anchor uses `/pages/result.html?id=<session_id>`,
 *     the same deep-link entry the practice-flow already supports.
 *   - Class `vocab-action vocab-action--source` matches the existing
 *     primitive in my-vocabulary.css (Sprint 9.3 canonical card family).
 */

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the "↗ nguồn" anchor for a vocab item, or an empty string
 * when the source session is unknown (manual add) or no longer exists
 * (session hard-deleted → FK SET NULL).
 *
 * @param {{session_id?: string|null}} item Vocab row from the API.
 * @returns {string} HTML anchor or empty string.
 */
export function renderSourceLink(item) {
  const sessionId = item && item.session_id;
  if (!sessionId) return '';
  return `<a href="/pages/result.html?id=${_esc(sessionId)}"
            class="vocab-action vocab-action--source"
            title="Xem buổi luyện tập">↗ nguồn</a>`;
}
