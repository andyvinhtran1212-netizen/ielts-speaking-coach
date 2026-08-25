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
  /** @type {{environment?: string|null, apiBase?: string|null, supabaseUrl?: string|null, supabaseAnonKey?: string|null, release?: string|null, gitRef?: string|null}} */
  var _RC = (typeof window !== 'undefined' && /** @type {any} */ (window).__AVER_RUNTIME_CONFIG__) || {};

  function initSupabase(url, anonKey) {
    // MỘT client cho mỗi trang. Trước bản này, mỗi lời gọi lại `createClient`
    // một lần nữa và ghi đè `_sb` — nghĩa là trang nào gọi hai lần sẽ có HAI
    // GoTrue client dùng CHUNG một khoá lưu trữ, tranh nhau làm mới token và
    // tranh nhau sự kiện đăng nhập giữa các tab. Client bị bỏ rơi vẫn sống.
    //
    // Trang legacy chỉ gọi một lần nên không lộ. Lỗi lộ ra khi đưa các module
    // `public/js/*` sang route Next: module tự gọi `initSupabase` ở đầu tệp,
    // còn `AuthedShell` cũng gọi ở `DOMContentLoaded` (Codex bắt ở #951).
    //
    // Vá ở ĐÂY chứ không ở từng trang: 108 chỗ gọi trong repo đều trỏ cùng một
    // dự án Supabase (đếm được), nên "lần đầu thắng" không đổi hành vi của ai.
    // Nếu lần đầu NÉM (ví dụ gọi không đối số khi `_RC` chưa cấu hình) thì `_sb`
    // vẫn rỗng và lần gọi sau có đối số thật vẫn dựng được client.
    if (_sb) return _sb;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      var sdkReady = /** @type {any} */ (window).__AVER_SUPABASE_SDK_READY__;
      if (sdkReady && typeof sdkReady.then === 'function') {
        sdkReady.then(function () {
          if (!_sb) initSupabase(url, anonKey);
        }).catch(function (loadError) {
          try { console.error('[api] Supabase SDK fallback failed:', loadError); } catch {}
          try {
            var aver = /** @type {any} */ (window).aver;
            if (aver && typeof aver.reportError === 'function') {
              aver.reportError('Supabase SDK unavailable', {
                code: 'SUPABASE_SDK_UNAVAILABLE',
              });
            }
          } catch {}
        });
        return null;
      }
      var sdkError = new Error(
        'Supabase SDK unavailable: the browser bundle did not load before api.js initialization.'
      );
      /** @type {any} */ (sdkError).code = 'SUPABASE_SDK_UNAVAILABLE';
      throw sdkError;
    }
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

  // Token của lần lấy gần nhất. Giữ lại CHỈ để phục vụ đường `keepalive` —
  // xem ghi chú ở `_apiRequest`.
  var _lastToken = null;

  async function _getAuthToken() {
    if (!_sb) return null;
    var result = await _sb.auth.getSession();
    _lastToken = result.data.session ? result.data.session.access_token : null;
    return _lastToken;
  }

  async function _apiRequest(method, path, body, isFormData, extraHeaders, opts) {
    // Đường `keepalive` KHÔNG ĐƯỢC `await` trước khi gọi `fetch`.
    //
    // `keepalive` chỉ cứu được một request ĐÃ TỒN TẠI. Chờ lấy token trước là
    // nhường quyền cho trình duyệt: nó có thể dừng JS ngay sau `pagehide`, và
    // khi ấy `fetch` chưa bao giờ được tạo ra — lượt lưu lúc rời trang thành
    // trang trí. Sáu chỗ đang dùng `keepalive` đều dính, kể cả báo cáo tính
    // toàn vẹn của bài thi thử (codex cục bộ 05/08).
    //
    // Dùng token của lần lấy gần nhất. Token hết hạn thì request 401 và mất
    // đúng lượt ấy — vẫn hơn một request không bao giờ được tạo.
    // Renderer-affinity create protocol (migration 216). A page that loaded an
    // older api.js omits this marker and the backend atomically pins its new
    // sessions to Legacy. Current pages explicitly request an unclaimed row;
    // their stable Speaking player claims Legacy/Next before canonical reads.
    // Copy rather than mutate the caller's object so retry/debug state remains
    // exactly what the caller supplied.
    if (
      method === 'POST' && path === '/sessions' && !isFormData && body
      && typeof body === 'object' && !Array.isArray(body)
    ) {
      var versionedSessionBody = {};
      for (var bodyKey in body) versionedSessionBody[bodyKey] = body[bodyKey];
      versionedSessionBody.renderer_affinity_protocol = 'claim-v1';
      body = versionedSessionBody;
    }

    var token = (opts && opts.keepalive && _lastToken !== null)
      ? _lastToken
      : await _getAuthToken();
    var headers = /** @type {Record<string, string>} */ ({});

    // ADR-012 §2 — correlation id browser → FastAPI (middleware echoes it;
    // header CORS-allowlisted; best-effort, never blocks a call). The SENT id
    // is what the backend logs under (middleware prefers the inbound header),
    // so failures below attach it to the thrown error — error-reporter then
    // ships it and the frontend report joins to the exact server log line.
    var requestId = null;
    try {
      headers['X-Request-ID'] = requestId =
        (window.crypto && typeof window.crypto.randomUUID === 'function')
          ? window.crypto.randomUUID()
          : 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    } catch (e) { /* correlation is optional */ }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    // reading-access-tracking — optional per-call headers (e.g. the locked-test
    // X-Reading-Password gate, or the anonymous X-Reading-Anon capability
    // token). Merged last so callers can't drop auth.
    if (extraHeaders) { for (var k in extraHeaders) { if (extraHeaders[k] != null) headers[k] = extraHeaders[k]; } }

    var response;
    try {
      response = await fetch(_API_BASE + path, {
        method: method,
        headers: headers,
        body: isFormData ? body : body ? JSON.stringify(body) : null,
        // ADR-011 §2 (AUDIT F6): logout must be able to ABORT in-flight
        // requests — callers pass an AbortController signal via opts.signal
        // (getWith/patchWith/…). Undefined for the existing 4-arg helpers:
        // zero behaviour change unless a caller opts in.
        signal: (opts && opts.signal) || undefined,
        // DEBT-2026-07-22-D: a save fired from `pagehide` is normally killed
        // with the document. `keepalive` lets the browser finish it after the
        // page is gone, which is the whole point of the unload flush. Opt-in
        // per call (same shape as opts.signal) — no other caller is affected.
        keepalive: !!(opts && opts.keepalive) || undefined,
      });
    } catch (fetchErr) {
      // Network/CORS failure — tag the rejection with the id we SENT so an
      // unhandled-rejection report still correlates to this exact call.
      try { if (fetchErr && typeof fetchErr === 'object') /** @type {any} */ (fetchErr).request_id = requestId; } catch (_) {}
      throw fetchErr;
    }

    // reading-access-tracking B2 — anonymous (share-link) callers have NO
    // account; a 401 there must surface as a friendly error to the caller, not
    // a redirect to the login page. opts.noRedirect lets those calls fall
    // through to the throw path below. The default (authed) behaviour is
    // unchanged: bounce to login on 401.
    if (response.status === 401 && !(opts && opts.noRedirect)) {
      // The canonical login entry lives at the site root (/login). The
      // previous _appRoot+'login.html' build
      // resolved correctly for /pages/X.html but broke for any deeper
      // path (e.g. /pages/admin/listening/X.html → 404). Use an
      // absolute path so redirect works from any depth.
      window.location.href = '/login';
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
      // ADR-012 §2 — join keys for error reports: the correlation id of THIS
      // call + the server's sanitizer ref when the 5xx body carries one.
      thrown.request_id = requestId;
      thrown.ref = (isObj && detail.ref) || null;
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
    /** @template T @param {string} path @param {FormData} fd @param {*} [opts] @returns {Promise<T>} */
    uploadWith: function (path, fd, opts) { return _apiRequest('POST', path, fd, true, null, opts); },
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
