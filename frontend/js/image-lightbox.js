/* frontend/js/image-lightbox.js — Sprint 19.3.5 shared image lightbox.
 *
 * window.AvImageLightbox.open(src, alt) — full-screen overlay to scrutinise
 * a Task 1 Academic chart. Used by admin grade.html + student
 * writing-result.html. One lazily-created overlay; backdrop click / ✕ /
 * Esc close it. Vanilla, zero-dep (Pattern #15).
 */
(function () {
  'use strict';

  var overlay = null;

  function close() {
    if (overlay) overlay.classList.add('hidden');
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'av-lightbox hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<button type="button" class="av-lightbox__close" aria-label="Đóng">✕</button>' +
      '<img class="av-lightbox__img" alt="" />';
    overlay.addEventListener('click', function (ev) {
      // Close on backdrop or the ✕; clicks on the image itself don't close.
      if (ev.target === overlay || ev.target.classList.contains('av-lightbox__close')) {
        close();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) close();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function open(src, alt) {
    if (!src) return;
    var o = ensureOverlay();
    var img = o.querySelector('.av-lightbox__img');
    img.src = src;
    img.alt = alt || '';
    o.classList.remove('hidden');
  }

  window.AvImageLightbox = { open: open, close: close };
})();
