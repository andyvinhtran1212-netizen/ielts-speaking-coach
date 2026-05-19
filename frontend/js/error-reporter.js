/**
 * frontend/js/error-reporter.js — Sprint 12.3.
 *
 * Global frontend exception reporter. Captures three signals:
 *
 *   1. `window.error`               — synchronous uncaught throws.
 *   2. `window.unhandledrejection`  — async Promise rejections.
 *   3. `window.aver.reportError(msg, extra)` — manual reporting from
 *      page code (e.g. when a network response is bad but the code
 *      handled it gracefully — still want to know it happened).
 *
 * Per-session dedup on (message + stack first 500 chars) prevents a
 * runaway loop (Sprint 6 dogfood pattern where one bug could fire 200
 * /api/error-logs calls in a minute). The dedup window is the page's
 * lifetime; a fresh page load starts fresh.
 *
 * Fail-soft: this module must NEVER escalate. fetch() failures are
 * swallowed; missing crypto.randomUUID falls back to a Math.random
 * shim; missing window.fetch (ancient browsers) makes reportError a
 * no-op. Logging that crashes the page is worse than no logging.
 *
 * Loaded globally — once per page — by:
 *   - <aver-chrome>        (user-side pages)
 *   - <aver-admin-chrome>  (admin nested pages)
 *   - admin.html           (legacy monolith)
 *   - index.html / login pages (direct <script src> tag)
 *
 * The IIFE guards against double-load by no-op'ing if the global already
 * exists.
 */

(function () {
  if (typeof window === 'undefined') return;
  if (window.aver && window.aver._errorReporterLoaded) return;

  // ── UUID fallback (very old browsers / certain test envs) ─────────
  function _uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch { /* swallow */ }
    // Fallback: not RFC-compliant but unique-enough for correlation.
    return 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Per-session state.
  var DEDUP = new Set();
  var REQUEST_ID = _uuid();
  var MAX_DEDUP_ENTRIES = 100;  // hard cap so a flood doesn't grow forever

  // ── Resolve API base (mirrors api.js convention) ──────────────────
  function _apiBase() {
    try {
      var host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:8000';
      }
      return 'https://ielts-speaking-coach-production.up.railway.app';
    } catch {
      return '';
    }
  }

  // ── Pure helper, exported for tests ────────────────────────────────
  function buildDedupKey(message, stack) {
    var m = String(message || '');
    var s = String(stack || '');
    return (m + '::' + s).slice(0, 500);
  }

  function _getAuthToken() {
    try {
      if (typeof window.getSupabase !== 'function') return Promise.resolve(null);
      var sb = window.getSupabase();
      if (!sb) return Promise.resolve(null);
      return sb.auth.getSession().then(function (r) {
        return r && r.data && r.data.session ? r.data.session.access_token : null;
      });
    } catch {
      return Promise.resolve(null);
    }
  }

  async function reportError(payload) {
    if (!payload || !payload.message) return;
    var key = buildDedupKey(payload.message, payload.stack);
    if (DEDUP.has(key)) return;
    if (DEDUP.size >= MAX_DEDUP_ENTRIES) {
      // Reset: a long-running page might genuinely see >100 distinct
      // errors; we cap the set so it doesn't grow unbounded.
      DEDUP.clear();
    }
    DEDUP.add(key);

    var body = {
      level:      payload.level || 'error',
      source:     'frontend',
      message:    String(payload.message).slice(0, 2000),
      stack:      payload.stack ? String(payload.stack).slice(0, 10000) : null,
      url:        window.location ? window.location.pathname : null,
      user_agent: (window.navigator && window.navigator.userAgent || '').slice(0, 500),
      request_id: REQUEST_ID,
      extra:      payload.extra || null,
    };

    if (typeof window.fetch !== 'function') return;

    try {
      var headers = {
        'Content-Type': 'application/json',
        'X-Request-ID': REQUEST_ID,
      };
      var token = await _getAuthToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      await window.fetch(_apiBase() + '/api/error-logs', {
        method:  'POST',
        headers: headers,
        body:    JSON.stringify(body),
      });
    } catch {
      // Logging cannot escalate — swallow.
    }
  }

  // ── window.error listener ─────────────────────────────────────────
  window.addEventListener('error', function (event) {
    if (!event) return;
    var msg = event.message || (event.error && event.error.message) || 'Unknown error';
    reportError({
      level:   'error',
      message: msg,
      stack:   event.error && event.error.stack,
      extra: {
        filename: event.filename || null,
        line:     event.lineno || null,
        col:      event.colno || null,
      },
    });
  });

  // ── unhandledrejection listener ───────────────────────────────────
  window.addEventListener('unhandledrejection', function (event) {
    if (!event) return;
    var reason = event.reason;
    var msg = (reason && reason.message) || (typeof reason === 'string' ? reason : String(reason));
    reportError({
      level:   'error',
      message: msg || 'Unhandled promise rejection',
      stack:   reason && reason.stack,
      extra:   { type: 'unhandled_promise_rejection' },
    });
  });

  // ── Public surface ────────────────────────────────────────────────
  window.aver = window.aver || {};
  window.aver._errorReporterLoaded = true;
  window.aver.requestId = REQUEST_ID;
  window.aver.reportError = function (message, extra) {
    reportError({ level: 'warning', message: message, extra: extra });
  };
  // Exported for tests — keep the dedup-key helper testable in isolation.
  window.aver._buildDedupKey = buildDedupKey;
})();
