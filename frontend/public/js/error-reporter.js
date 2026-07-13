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

  // ── Resolve API base ──────────────────────────────────────────────
  // Prefer the canonical window.api.base (api.js) so the host never drifts,
  // but keep a self-contained fallback: error-reporter must still work when
  // api.js itself failed to load (it reports that very failure).
  function _apiBase() {
    try {
      if (window.api && window.api.base) return window.api.base;
      var host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:8000';
      }
      return 'https://ielts-speaking-coach-production.up.railway.app';
    } catch {
      return '';
    }
  }

  // ── ADR-012 migration tags (FE Next.js migration, Pilot Entry) ─────
  // Every error report carries which STACK rendered the page and which
  // RELEASE served it, so the cutover dashboard can compare error rates
  // by implementation/release. Additive: rides in `extra`, no schema
  // change. `__next_f` is the App Router RSC flight sink — present on
  // every Next page before any app code runs, absent on legacy pages.
  function migrationTags() {
    var tags = {};
    try {
      tags.implementation =
        (typeof window.__next_f !== 'undefined') ? 'next' : 'legacy';
      var rc = window.__AVER_RUNTIME_CONFIG__ || {};
      if (rc.release) tags.release = rc.release;
      if (rc.environment) tags.environment = rc.environment;
    } catch { /* tags are best-effort — never block a report */ }
    return tags;
  }

  // ── Pure helper, exported for tests ────────────────────────────────
  function buildDedupKey(message, stack) {
    var m = String(message || '');
    var s = String(stack || '');
    return (m + '::' + s).slice(0, 500);
  }

  // Sprint 12.3.1 hotfix — every console.error path below is intentional.
  // Tester01 dogfood on 2026-05-19 surfaced Falsification #82: a bare
  // `catch {}` in reportError + a Promise chain in _getAuthToken with no
  // `.catch()` meant ANY failure (auth rejection, fetch CORS, JSON.stringify
  // on a circular extra) was invisible. Listeners attached, no POST. We
  // now leave a visible trace via console.error so future dogfood can
  // see WHY a report didn't ship. Console writes are not user-visible
  // alerts — they don't violate the "logging cannot escalate" contract.

  function _getAuthToken() {
    try {
      if (typeof window.getSupabase !== 'function') return Promise.resolve(null);
      var sb = window.getSupabase();
      if (!sb) return Promise.resolve(null);
      // Sprint 12.3.1 — `.catch()` so a rejecting session check never
      // bubbles out and skips the fetch in reportError.
      return sb.auth.getSession().then(function (r) {
        return r && r.data && r.data.session ? r.data.session.access_token : null;
      }).catch(function (e) {
        try { console.error('[error-reporter] getSession failed:', e); } catch {}
        return null;
      });
    } catch (e) {
      try { console.error('[error-reporter] _getAuthToken sync throw:', e); } catch {}
      return Promise.resolve(null);
    }
  }

  async function reportError(payload) {
    if (!payload) {
      try { console.warn('[error-reporter] reportError called with no payload'); } catch {}
      return;
    }
    // Defensive non-empty message guard — never bail silently. Sprint
    // 12.3.1: tightened from `if (!payload.message) return;` so a
    // missing/falsy message becomes "Unknown error" instead of a silent
    // no-op (Tester01 saw zero POSTs on real errors).
    var msg = payload.message;
    if (msg == null || String(msg).trim() === '') msg = 'Unknown error';
    payload.message = String(msg);

    var key = buildDedupKey(payload.message, payload.stack);
    if (DEDUP.has(key)) return;
    if (DEDUP.size >= MAX_DEDUP_ENTRIES) {
      // Reset: a long-running page might genuinely see >100 distinct
      // errors; we cap the set so it doesn't grow unbounded.
      DEDUP.clear();
    }
    DEDUP.add(key);

    var body;
    try {
      body = {
        level:      payload.level || 'error',
        source:     'frontend',
        message:    String(payload.message).slice(0, 2000),
        stack:      payload.stack ? String(payload.stack).slice(0, 10000) : null,
        url:        (window.location && window.location.pathname) || null,
        user_agent: ((window.navigator && window.navigator.userAgent) || '').slice(0, 500),
        request_id: REQUEST_ID,
        // Caller extra first, ADR-012 tags second (tags win a collision —
        // implementation/release are infrastructure truth, not caller data).
        extra:      Object.assign({}, payload.extra || {}, migrationTags()),
      };
    } catch (e) {
      // Defensive: a circular `extra` or weird browser globals could
      // throw during body assembly. Don't swallow silently — leave a
      // trace so future dogfood spots it.
      try { console.error('[error-reporter] body assembly failed:', e); } catch {}
      return;
    }

    if (typeof window.fetch !== 'function') {
      try { console.warn('[error-reporter] window.fetch unavailable; skipping'); } catch {}
      return;
    }

    // Resolve auth token in a separate try so its failure cannot block
    // the fetch from firing. Anonymous reports are valid — the server
    // accepts `user_id=NULL`.
    var token = null;
    try {
      token = await _getAuthToken();
    } catch (e) {
      try { console.error('[error-reporter] auth resolution failed:', e); } catch {}
      token = null;
    }

    try {
      var headers = {
        'Content-Type': 'application/json',
        'X-Request-ID': REQUEST_ID,
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var bodyJson;
      try {
        bodyJson = JSON.stringify(body);
      } catch (e) {
        try { console.error('[error-reporter] JSON.stringify failed:', e); } catch {}
        return;
      }
      var resp = await window.fetch(_apiBase() + '/api/error-logs', {
        method:  'POST',
        headers: headers,
        body:    bodyJson,
      });
      if (resp && !resp.ok) {
        try { console.error('[error-reporter] POST returned', resp.status); } catch {}
      }
    } catch (e) {
      // Network / CORS failure — leave a trace, then swallow. The
      // "logging cannot escalate" contract means we don't re-throw, but
      // silent failure was the bug we just shipped a hotfix for.
      try { console.error('[error-reporter] fetch failed:', e); } catch {}
    }
  }

  // Pure helper exported for tests — wraps the extraction logic used by
  // the window.error listener so we can verify defensive fallbacks at
  // the unit layer (in addition to the vm-based dispatch integration).
  // Noise filter (2026-07-02) — the admin error log was drowning in errors that
  // are NOT app bugs: third-party widgets/trackers (Zalo, analytics) and opaque
  // cross-origin "Script error." reports that carry no actionable info. Drop
  // them at capture so real errors stand out. Manual window.aver.reportError()
  // is intentionally NOT filtered.
  function _isIgnoredError(msg, filename) {
    var m = String(msg || '').trim();
    // Opaque cross-origin error — no message, file, or stack we can act on.
    if (m === 'Script error.' || m === 'Script error') return true;
    // Benign browser-emitted noise — "ResizeObserver loop limit exceeded" /
    // "ResizeObserver loop completed with undelivered notifications." fire on
    // legitimate layout thrash, carry no stack, and are not app bugs.
    if (/^ResizeObserver loop/i.test(m)) return true;
    // Known third-party scripts / trackers by message text.
    if (/zalojsv2|zalosdk|\bgmo\b|\bfbq\b|gtag\(|adsbygoogle|google[- ]analytics/i.test(m)) return true;
    // Errors thrown from third-party CDNs (not our origin).
    var f = String(filename || '');
    if (f && /(zalo|zdn\.vn|facebook|fbcdn|googletagmanager|google-analytics|doubleclick|gstatic|hotjar)/i.test(f)) return true;
    return false;
  }

  function extractErrorPayload(event) {
    if (!event) return null;
    var msg =
      (event && event.message)
      || (event && event.error && event.error.message)
      || (event && event.error && String(event.error))
      || 'Unknown error';
    if (!msg || !String(msg).trim()) msg = 'Unknown error';
    if (_isIgnoredError(msg, event && event.filename)) return null;   // third-party / opaque noise
    return {
      level:   'error',
      message: String(msg),
      stack:   (event && event.error && event.error.stack) || null,
      extra: {
        filename: (event && event.filename) || null,
        line:     (event && event.lineno) || null,
        col:      (event && event.colno) || null,
      },
    };
  }

  // ── window.error listener ─────────────────────────────────────────
  // Sprint 12.3.1 — wrapped in try/catch so a sync throw inside the
  // handler (e.g., from a malformed event object) cannot detach the
  // listener silently. ALSO chains `.catch()` on the reportError
  // Promise to surface any rejection that escaped reportError's own
  // internal handlers.
  window.addEventListener('error', function (event) {
    try {
      var payload = extractErrorPayload(event);
      if (!payload) return;
      reportError(payload).catch(function (e) {
        try { console.error('[error-reporter] reportError rejected (error):', e); } catch {}
      });
    } catch (e) {
      try { console.error('[error-reporter] error listener crashed:', e); } catch {}
    }
  });

  // ── unhandledrejection listener ───────────────────────────────────
  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event && event.reason;
      var msg = (reason && reason.message)
        || (typeof reason === 'string' ? reason : null)
        || (reason != null ? String(reason) : null);
      if (_isIgnoredError(msg, null)) return;   // third-party / opaque noise
      reportError({
        level:   'error',
        message: msg || 'Unhandled promise rejection',
        stack:   reason && reason.stack,
        extra:   { type: 'unhandled_promise_rejection' },
      }).catch(function (e) {
        try { console.error('[error-reporter] reportError rejected (rejection):', e); } catch {}
      });
    } catch (e) {
      try { console.error('[error-reporter] rejection listener crashed:', e); } catch {}
    }
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
  // Sprint 12.3.1 — exported so the vm-based dispatch test can assert
  // on the extraction logic without round-tripping through the DOM.
  window.aver._extractErrorPayload = extractErrorPayload;
})();
