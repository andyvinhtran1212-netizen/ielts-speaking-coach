/**
 * confirm-danger.js — shared styled danger-confirm modal (notification arc PR-2).
 *
 * window.confirmDanger({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel })
 * replaces native confirm() on danger actions (revoke / gỡ). Built on the
 * aver-design .adm-modal primitive (matches the #483 admin re-skin) with the
 * Student-Hub a11y pattern: focus-trap, Esc-cancel, return-focus, dialog aria.
 *
 * Gate preserved: the action runs ONLY when the user confirms (onConfirm);
 * cancel / Esc / backdrop click are a no-op (onCancel optional). Default focus
 * is the CANCEL button — never auto-focus the destructive action.
 */
(function () {
  if (typeof window === 'undefined' || window.confirmDanger) return;

  function confirmDanger(opts) {
    opts = opts || {};
    var prevFocus = document.activeElement;

    var backdrop = document.createElement('div');
    backdrop.className = 'adm-modal-backdrop av-confirm-backdrop';

    var modal = document.createElement('div');
    modal.className = 'adm-modal av-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'av-confirm-title');

    var h = document.createElement('h2');
    h.id = 'av-confirm-title';
    h.textContent = opts.title || 'Xác nhận';
    modal.appendChild(h);

    if (opts.body) {
      var p = document.createElement('p');
      p.className = 'av-confirm__body';
      p.textContent = opts.body;
      modal.appendChild(p);
    }

    var actions = document.createElement('div');
    actions.className = 'adm-modal-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'adm-btn-secondary';
    cancelBtn.textContent = opts.cancelLabel || 'Hủy';
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'adm-btn-danger';
    confirmBtn.textContent = opts.confirmLabel || 'Xác nhận';
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* opener gone */ }
      }
    }
    function doCancel() { close(); if (typeof opts.onCancel === 'function') opts.onCancel(); }
    function doConfirm() { close(); if (typeof opts.onConfirm === 'function') opts.onConfirm(); }

    cancelBtn.addEventListener('click', doCancel);
    confirmBtn.addEventListener('click', doConfirm);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) doCancel(); });

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); return; }
      if (e.key === 'Tab') {
        var f = [cancelBtn, confirmBtn];
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    // Danger default: focus Cancel, not the destructive action.
    cancelBtn.focus();
  }

  window.confirmDanger = confirmDanger;
})();
