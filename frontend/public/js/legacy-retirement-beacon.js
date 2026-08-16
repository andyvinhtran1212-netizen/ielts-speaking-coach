/**
 * Gate F legacy-retirement telemetry.
 *
 * Every directly renderable HTML rollback artifact loads this file. Existing
 * pages that already sent the shared `page_view` beacon are left untouched;
 * this is only the fail-soft coverage layer for legacy pages that never loaded
 * analytics-beacon.js. It intentionally records pathname only — query strings
 * can contain capabilities, attempt ids or other private data.
 */
(function () {
  'use strict';

  function runtimeConfig() {
    try {
      return window.__AVER_RUNTIME_CONFIG__ || {};
    } catch (_) {
      return {};
    }
  }

  function inferredEnvironment(hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local';
    if (hostname === 'staging.averlearning.com') return 'staging';
    return 'production';
  }

  function sendFallbackPageView() {
    window.aver = window.aver || {};
    if (window.aver._pageViewSent || window.aver._legacyRetirementBeaconStarted) return;

    var config = runtimeConfig();
    var hostname = window.location.hostname;
    // The generated runtime config is the environment source of truth. A
    // loaded api.js may provide the same value for local/manual pages; never
    // guess a production backend from the hostname in this fallback layer.
    var apiBase = config.apiBase || (window.api && window.api.base) || null;
    if (!apiBase) return;
    window.aver._legacyRetirementBeaconStarted = true;
    // Share the canonical sent marker so a late analytics-beacon load cannot
    // double the denominator used by rollback and retirement reports.
    window.aver._pageViewSent = true;

    var payload = {
      event_name: 'page_view',
      event_data: {
        path: window.location.pathname,
        implementation: 'legacy',
        release: config.release || null,
        environment: config.environment || inferredEnvironment(hostname),
        telemetry_scope: 'gate-f-legacy-retirement',
        beacon_version: 1,
      },
    };

    try {
      window.fetch(apiBase + '/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        keepalive: true,
      }).catch(function () { /* telemetry must never affect the page */ });
    } catch (_) { /* telemetry must never affect the page */ }
  }

  // analytics-beacon.js fires at DOMContentLoaded. Waiting until `load` lets
  // that canonical path win on the pages that already have it, while still
  // covering every other HTML artifact once the document is fully usable.
  if (document.readyState === 'complete') sendFallbackPageView();
  else window.addEventListener('load', sendFallbackPageView, { once: true });
})();
