/**
 * toast.js — shared admin notification helper (grade-flow / notification arc).
 *
 * window.showToast(msg, variant, opts) renders a floating .av-toast in a stack
 * (aver-design tokens, theme-aware, multi-line). Replaces the ~22 ad-hoc
 * showBanner / setAlert impls — each now delegates here so notifications look +
 * behave consistently across admin.
 *
 *   variant : 'success' | 'error' | 'info' | 'warn'   (default 'success')
 *   opts    : { persist=false, timeout=4000 }
 *
 * Behaviour:
 *  - auto-dismiss after `timeout` ms unless `persist` (then it stays + gets a × ).
 *  - aria-live: 'polite'/role=status for success/info/warn; 'assertive'/role=alert
 *    for error or persist (must be read).
 *  - persist toasts REPLACE the prior persist toast (no pileup — mirrors the old
 *    single #status-banner that each page replaced in place). Auto-dismiss toasts
 *    stack briefly then clear themselves.
 *  - returns { el, dismiss } so callers with an explicit clear (hideBanner /
 *    clearBanner) can remove their toast.
 */
(function () {
  if (typeof window === 'undefined' || window.showToast) return;

  var STACK_ID = 'av-toast-stack';
  var VARIANTS = { success: 1, error: 1, info: 1, warn: 1 };

  function stack() {
    var s = document.getElementById(STACK_ID);
    if (!s) {
      s = document.createElement('div');
      s.id = STACK_ID;
      s.className = 'av-toast-stack';
      document.body.appendChild(s);
    }
    return s;
  }

  function removeToast(node) {
    if (!node) return;
    if (node._t) { clearTimeout(node._t); node._t = null; }
    node.classList.remove('is-show');
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
  }

  function showToast(msg, variant, opts) {
    variant = VARIANTS[variant] ? variant : 'success';
    opts = opts || {};
    var persist = !!opts.persist;
    var timeout = (opts.timeout != null) ? opts.timeout : 4000;
    var loud = (variant === 'error' || persist);

    var s = stack();
    // Persist toasts replace any prior persist toast — keeps the old
    // single-banner semantics (each page replaced its #status-banner in place).
    if (persist) {
      Array.prototype.slice.call(s.querySelectorAll('.av-toast[data-persist="1"]'))
        .forEach(removeToast);
    }

    var el = document.createElement('div');
    el.className = 'av-toast av-toast-' + variant;
    el.setAttribute('role', loud ? 'alert' : 'status');
    el.setAttribute('aria-live', loud ? 'assertive' : 'polite');
    if (persist) el.setAttribute('data-persist', '1');

    var span = document.createElement('span');
    span.className = 'av-toast__msg';
    span.textContent = (msg == null) ? '' : String(msg);
    el.appendChild(span);

    if (persist) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'av-toast__close';
      x.setAttribute('aria-label', 'Đóng');
      x.textContent = '×';
      x.addEventListener('click', function () { removeToast(el); });
      el.appendChild(x);
    }

    s.appendChild(el);
    // Force reflow so the enter transition runs.
    void el.offsetWidth;
    el.classList.add('is-show');

    if (!persist && timeout > 0) {
      el._t = setTimeout(function () { removeToast(el); }, timeout);
    }

    return { el: el, dismiss: function () { removeToast(el); } };
  }

  // Remove every visible toast — backs the old hideBanner() / clearBanner().
  function clearToasts() {
    var s = document.getElementById(STACK_ID);
    if (!s) return;
    Array.prototype.slice.call(s.querySelectorAll('.av-toast')).forEach(removeToast);
  }

  window.showToast = showToast;
  window.clearToasts = clearToasts;
})();
