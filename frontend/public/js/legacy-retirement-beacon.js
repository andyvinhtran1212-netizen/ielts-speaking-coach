/**
 * Gate F legacy-retirement telemetry.
 *
 * Every directly renderable HTML rollback artifact loads this file. It emits a
 * dedicated event rather than the product `page_view`, so retirement evidence
 * cannot alter foot-traffic or rollback-rate denominators. It intentionally
 * records pathname only — query strings can contain capabilities, attempt ids
 * or other private data.
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

  function sendRetirementPageView() {
    window.aver = window.aver || {};
    if (window.aver._legacyRetirementBeaconStarted) return true;

    var config = runtimeConfig();
    var hostname = window.location.hostname;
    // The generated runtime config is the environment source of truth. A
    // loaded api.js may provide the same value for local/manual pages; never
    // guess a production backend from the hostname in this fallback layer.
    var apiBase = config.apiBase || (window.api && window.api.base) || null;
    if (!apiBase) return false;
    window.aver._legacyRetirementBeaconStarted = true;

    var payload = {
      event_name: 'legacy_retirement_page_view',
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
    return true;
  }

  // This file is deferred. It runs after parsing (and after any non-deferred
  // runtime-config script later in the document) but before DOMContentLoaded.
  // Send immediately: waiting for `load` loses evidence when page code performs
  // a DOM-ready redirect. Pure synchronous redirect stubs are excluded from the
  // renderable inventory and intentionally do not load this file.
  if (!sendRetirementPageView() && document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', sendRetirementPageView, { once: true });
  }
})();
