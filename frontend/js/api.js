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

  async function _getAuthToken() {
    if (!_sb) return null;
    var result = await _sb.auth.getSession();
    return result.data.session ? result.data.session.access_token : null;
  }

  async function _apiRequest(method, path, body, isFormData) {
    var token = await _getAuthToken();
    var headers = {};

    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    var response = await fetch(_API_BASE + path, {
      method: method,
      headers: headers,
      body: isFormData ? body : body ? JSON.stringify(body) : null,
    });

    if (response.status === 401) {
      window.location.href = '/index.html';
      return null;
    }

    if (!response.ok) {
      var err = {};
      try { err = await response.json(); } catch (_) {}
      throw new Error(err.detail || 'HTTP ' + response.status);
    }

    return response.json();
  }

  var api = {
    base: _API_BASE,
    get:    function (path)        { return _apiRequest('GET',    path); },
    post:   function (path, body)  { return _apiRequest('POST',   path, body); },
    patch:  function (path, body)  { return _apiRequest('PATCH',  path, body); },
    delete: function (path)        { return _apiRequest('DELETE', path); },
    upload: function (path, fd)    { return _apiRequest('POST',   path, fd, true); },
  };

  // Expose only what the page scripts need
  window.initSupabase = initSupabase;
  window.getSupabase  = getSupabase;
  window.api          = api;
})();
