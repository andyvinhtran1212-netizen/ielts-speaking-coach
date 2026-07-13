// @ts-check
// api.js — loaded before the inline script, after supabase-js CDN
// Uses a private variable name (_sb) so it never collides with window.supabase
//
// Step-A typecheck pilot: the data methods carry `@template T` so a caller can
// flow a response type, e.g.
//   const codes = /** @type {AccessCodeOut[]} */ (await api.get('/admin/access-codes'));
// JSDoc only — 0 runtime change; the IIFE + window.api shape are untouched, and
// `tsc --noEmit` never emits. Delete tsconfig.json and this becomes inert.

(function () {
  var _sb = null;

  // ── Shared HTML escaper (audit 2026-07-03 C4) ─────────────────────────────
  // Canonical window.WC.escapeHtml — the single source every page-script uses
  // to escape untrusted text before innerHTML. Several modules (writing-*.js,
  // grammar.js, admin-*.js) already delegate to it with a local fallback; it was
  // documented as "defined in api.js" but never actually added, so a page that
  // forgot to define its own escaper had no safety net (the grammar.js `?q=` XSS,
  // audit S1). Defining it here — api.js loads on every authenticated page —
  // gives that net globally without touching 100+ HTML files. Escapes the five
  // HTML-significant characters; & first so later entities aren't double-escaped.
  window.WC = window.WC || {};
  if (typeof window.WC.escapeHtml !== 'function') {
    window.WC.escapeHtml = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
  }

  // Generated runtime config (js/runtime-config.js, loaded before this file —
  // plan §7.1 / ADR-006). The committed copy is all-null ("unconfigured"), so
  // every non-Vercel context falls through to the legacy behavior below.
  // Vercel builds regenerate it per environment; config values win when set,
  // which is what keeps Preview/staging off the production origins.
  var _RC = (typeof window !== 'undefined' && window.__AVER_RUNTIME_CONFIG__) || {};

  function initSupabase(url, anonKey) {
    _sb = window.supabase.createClient(
      _RC.supabaseUrl || url,
      _RC.supabaseAnonKey || anonKey
    );
    return _sb;
  }

  function getSupabase() {
    return _sb;
  }

  var _API_BASE =
    _RC.apiBase ||
    (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : 'https://ielts-speaking-coach-production.up.railway.app');

  // Relative path prefix to the app root — works on both localhost and the deployed site.
  // pages/*.html are one level deep; index.html and admin.html are at root level.
  var _appRoot = /\/pages\/[^/]+$/.test(window.location.pathname) ? '../' : './';

  async function _getAuthToken() {
    if (!_sb) return null;
    var result = await _sb.auth.getSession();
    return result.data.session ? result.data.session.access_token : null;
  }

  async function _apiRequest(method, path, body, isFormData, extraHeaders, opts) {
    var token = await _getAuthToken();
    var headers = /** @type {Record<string, string>} */ ({});

    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    // reading-access-tracking — optional per-call headers (e.g. the locked-test
    // X-Reading-Password gate, or the anonymous X-Reading-Anon capability
    // token). Merged last so callers can't drop auth.
    if (extraHeaders) { for (var k in extraHeaders) { if (extraHeaders[k] != null) headers[k] = extraHeaders[k]; } }

    var response = await fetch(_API_BASE + path, {
      method: method,
      headers: headers,
      body: isFormData ? body : body ? JSON.stringify(body) : null,
    });

    // reading-access-tracking B2 — anonymous (share-link) callers have NO
    // account; a 401 there must surface as a friendly error to the caller, not
    // a redirect to the login page. opts.noRedirect lets those calls fall
    // through to the throw path below. The default (authed) behaviour is
    // unchanged: bounce to login on 401.
    if (response.status === 401 && !(opts && opts.noRedirect)) {
      // Sprint 13.4.1 hotfix — login.html lives at the site root
      // (/login.html). The previous _appRoot+'login.html' build
      // resolved correctly for /pages/X.html but broke for any deeper
      // path (e.g. /pages/admin/listening/X.html → 404). Use an
      // absolute path so redirect works from any depth.
      window.location.href = '/login.html';
      return null;
    }

    if (!response.ok) {
      var err = {};
      try { err = await response.json(); } catch (_) {}
      // Sprint 14.2 — surface structured 422 detail bodies (e.g.
      // {code:'audio_too_short', part, duration_seconds, min_seconds})
      // to callers without forcing them to re-parse the message string.
      // Existing callers that read `error.message` keep working: if
      // detail is an object we coerce a readable summary; otherwise
      // we use the string verbatim.
      var detail   = err.detail;
      var isObj    = detail && typeof detail === 'object';
      var message  = isObj
        ? (detail.message || 'HTTP ' + response.status)
        : (detail || 'HTTP ' + response.status);
      var thrown   = /** @type {any} */ (new Error(message));
      thrown.status = response.status;
      thrown.detail = detail || null;
      throw thrown;
    }

    // Empty-body responses (204 No Content, or a 200 with no payload) have
    // nothing to parse — calling response.json() on them throws "Unexpected end
    // of JSON input" (seen on DELETE revoke + remove-user, which return 204).
    // Read the body as text and only JSON.parse when there's something, so a
    // successful empty response resolves to null instead of a fake error toast.
    if (response.status === 204) return null;
    var text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  var api = {
    base: _API_BASE,
    // url(path) — resolve a same-site page path relative to the app root,
    // safe on both localhost and the deployed site.
    // Usage: window.api.url('pages/home.html')
    url:    function (path)        { return _appRoot + path; },
    /** @template T @param {string} path @returns {Promise<T>} */
    get:    function (path)        { return _apiRequest('GET',    path); },
    /** @template T @param {string} path @param {*} [body] @returns {Promise<T>} */
    post:   function (path, body)  { return _apiRequest('POST',   path, body); },
    /** @template T @param {string} path @param {*} [body] @returns {Promise<T>} */
    patch:  function (path, body)  { return _apiRequest('PATCH',  path, body); },
    /** @template T @param {string} path @returns {Promise<T>} */
    delete: function (path)        { return _apiRequest('DELETE', path); },
    /** @template T @param {string} path @param {FormData} fd @returns {Promise<T>} */
    upload: function (path, fd)    { return _apiRequest('POST',   path, fd, true); },
    // reading-access-tracking — GET/POST/PATCH with extra request headers
    // (X-Reading-Password / X-Reading-Anon) + optional opts ({noRedirect:true}
    // suppresses the 401→login bounce for the anonymous share-link path).
    /** @template T @param {string} path @param {Record<string,string>} [hdrs] @param {*} [opts] @returns {Promise<T>} */
    getWith:   function (path, hdrs, opts)       { return _apiRequest('GET',   path, null, false, hdrs, opts); },
    /** @template T @param {string} path @param {*} [body] @param {Record<string,string>} [hdrs] @param {*} [opts] @returns {Promise<T>} */
    postWith:  function (path, body, hdrs, opts) { return _apiRequest('POST',  path, body, false, hdrs, opts); },
    /** @template T @param {string} path @param {*} [body] @param {Record<string,string>} [hdrs] @param {*} [opts] @returns {Promise<T>} */
    patchWith: function (path, body, hdrs, opts) { return _apiRequest('PATCH', path, body, false, hdrs, opts); },
  };

  // Expose only what the page scripts need
  window.initSupabase = initSupabase;
  window.getSupabase  = getSupabase;
  window.api          = api;
})();
