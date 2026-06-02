// api.js — loaded before the inline script, after supabase-js CDN
// Uses a private variable name (_sb) so it never collides with window.supabase

(function () {
  var _sb = null;

  function initSupabase(url, anonKey) {
    _sb = window.supabase.createClient(url, anonKey);
    return _sb;
  }

  function getSupabase() {
    return _sb;
  }

  var _API_BASE =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : 'https://ielts-speaking-coach-production.up.railway.app';

  // Relative path prefix to the app root — works on both localhost and GitHub Pages.
  // pages/*.html are one level deep; index.html and admin.html are at root level.
  var _appRoot = /\/pages\/[^/]+$/.test(window.location.pathname) ? '../' : './';

  async function _getAuthToken() {
    if (!_sb) return null;
    var result = await _sb.auth.getSession();
    return result.data.session ? result.data.session.access_token : null;
  }

  async function _apiRequest(method, path, body, isFormData, extraHeaders, opts) {
    var token = await _getAuthToken();
    var headers = {};

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
      var thrown   = new Error(message);
      thrown.status = response.status;
      thrown.detail = detail || null;
      throw thrown;
    }

    return response.json();
  }

  var api = {
    base: _API_BASE,
    // url(path) — resolve a same-site page path relative to the app root,
    // safe on both localhost and GitHub Pages project sites.
    // Usage: window.api.url('pages/home.html')
    url:    function (path)        { return _appRoot + path; },
    get:    function (path)        { return _apiRequest('GET',    path); },
    post:   function (path, body)  { return _apiRequest('POST',   path, body); },
    patch:  function (path, body)  { return _apiRequest('PATCH',  path, body); },
    delete: function (path)        { return _apiRequest('DELETE', path); },
    upload: function (path, fd)    { return _apiRequest('POST',   path, fd, true); },
    // reading-access-tracking — GET/POST/PATCH with extra request headers
    // (X-Reading-Password / X-Reading-Anon) + optional opts ({noRedirect:true}
    // suppresses the 401→login bounce for the anonymous share-link path).
    getWith:   function (path, hdrs, opts)       { return _apiRequest('GET',   path, null, false, hdrs, opts); },
    postWith:  function (path, body, hdrs, opts) { return _apiRequest('POST',  path, body, false, hdrs, opts); },
    patchWith: function (path, body, hdrs, opts) { return _apiRequest('PATCH', path, body, false, hdrs, opts); },
  };

  // Expose only what the page scripts need
  window.initSupabase = initSupabase;
  window.getSupabase  = getSupabase;
  window.api          = api;
})();
