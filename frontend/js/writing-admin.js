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

  // C4: api.js installs the CANONICAL window.WC.escapeHtml and loads first on
  // every authenticated page. This local copy is installed into window.WC only
  // as a fallback (below) for the case api.js hasn't run. It MUST be a direct
  // implementation, NOT a delegate to window.WC.escapeHtml — this module is the
  // one that assigns that property, so delegating would make it call itself →
  // infinite recursion (RangeError: Maximum call stack size exceeded).
  function escapeHtml(s) {
    return String(s == null ? '' : s)
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

  // Merge into window.WC — never reassign the object wholesale. api.js runs
  // first and installs the canonical window.WC.escapeHtml; replacing window.WC
  // here would drop that canonical escaper (audit C4) and, combined with the old
  // delegating local escaper, made window.WC.escapeHtml point at itself →
  // infinite recursion. Merge our helpers in; install the local escapeHtml only
  // as a fallback when the canonical one isn't already present.
  window.WC = window.WC || {};
  window.WC.bootstrap = bootstrap;
  window.WC.requestNotifyPermission = requestNotifyPermission;
  window.WC.notify = notify;
  window.WC.debounce = debounce;
  if (typeof window.WC.escapeHtml !== 'function') {
    window.WC.escapeHtml = escapeHtml;
  }
})();
