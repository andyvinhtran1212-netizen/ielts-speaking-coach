// writing-admin.js — Shared helpers for /admin/writing/* pages.
//
// Sprint W2 Phase 3. Loaded after supabase-js CDN + api.js.
// Provides:
//   • bootstrap(opts) — init Supabase, verify admin role, reveal #state-ready
//   • requestNotifyPermission() / notify(title, body)
//   • escapeHtml(s) — DOM-safe text rendering
//   • debounce(fn, ms)
//
// Pages call WC.bootstrap() once at load and use the helpers as needed.

(function () {
  'use strict';

  var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

  function escapeHtml(s) {
    // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
    // local fallback kept so this module is safe if window.WC hasn't loaded.
    return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      var ctx  = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 250);
    };
  }

  // Show #state-ready, hide #state-loading. Show #state-denied on non-admin.
  function _show(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }
  function _hide(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  async function bootstrap(opts) {
    opts = opts || {};
    initSupabase(SUPABASE_URL, SUPABASE_ANON);

    try {
      var me = await window.api.get('/auth/me');
      if (!me || me.role !== 'admin') {
        _hide('state-loading');
        _show('state-denied');
        return null;
      }

      var emailEl = document.getElementById('header-email');
      if (emailEl) {
        emailEl.textContent = me.email || '';
        emailEl.classList.remove('hidden');
      }
      _hide('state-loading');
      _show('state-ready');
      if (typeof opts.onReady === 'function') opts.onReady(me);
      return me;
    } catch (e) {
      // _apiRequest already redirects to login on 401; this catch covers
      // network errors and non-401 failures.
      window.location.href = window.api.url('index.html');
      return null;
    }
  }

  function requestNotifyPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Promise.resolve(Notification.permission);
    }
    return Notification.requestPermission();
  }

  function notify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body: body || '', icon: '/favicon.svg' });
    } catch (_) { /* some browsers block on unsecure origins */ }
  }

  window.WC = {
    bootstrap: bootstrap,
    requestNotifyPermission: requestNotifyPermission,
    notify: notify,
    escapeHtml: escapeHtml,
    debounce: debounce,
  };
})();
