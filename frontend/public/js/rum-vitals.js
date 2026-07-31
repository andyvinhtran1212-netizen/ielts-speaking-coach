/**
 * frontend/js/rum-vitals.js — AUDIT F2 (2026-07-14).
 *
 * Real-user Web Vitals collector. The Pilot Entry checklist §4 freezes a
 * rollback trigger on "LCP p75 route > 1.5× baseline (24h)" and §5 requires
 * "Web Vitals thực (per implementation tag)" — but until this file, nothing
 * in either stack MEASURED field vitals (Lighthouse is lab data; error
 * telemetry has no timing). This collector feeds the
 * /admin/error-logs/rollback-metrics denominator:
 *
 *   POST {apiBase}/api/analytics/events
 *   { event_name: 'web_vitals',
 *     event_data: { path, implementation, release, doc_release, loaded_at,
 *                   age_ms, ua, lcp, cls, inp } }
 *
 * Measurement notes (self-contained on purpose — no web-vitals npm dep, the
 * legacy stack has no bundler):
 *   - LCP: last `largest-contentful-paint` entry (buffered) — spec-accurate.
 *   - CLS: sum of `layout-shift` values without recent input. This is the
 *     PAGE-LIFETIME total, not the session-window max the web-vitals lib
 *     reports — monotonic and slightly conservative (total ≥ max window),
 *     fine for trend/threshold comparison as long as both stacks use THIS
 *     same collector.
 *   - INP: max duration of `event` entries carrying an interactionId —
 *     an approximation of INP (true INP uses percentile-of-interactions);
 *     documented as approximate, same collector on both stacks.
 *
 * Send: ONCE per page, on first pagehide/hidden, via fetch keepalive.
 * NOT sendBeacon: the API is cross-origin (Railway) and sendBeacon cannot
 * carry Content-Type: application/json headers cleanly; fetch keepalive
 * survives page unload and reuses the exact CORS path the page_view beacon
 * already exercises.
 *
 * Fail-soft everywhere: vitals must never affect the page. Browsers without
 * PerformanceObserver (or the entry types) simply send fewer fields or
 * nothing at all.
 *
 * Legacy-baseline protocol (pilots 2–4): add this script to the target
 * legacy page ≥24h BEFORE its cutover — the implementation tag below
 * resolves to 'legacy' there, producing the baseline the trigger compares
 * against. Pilot 1 cut over before this collector existed, so `/` has no
 * legacy vitals baseline: rollback-metrics falls back to the absolute
 * LCP ceiling for that route.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.aver && window.aver._rumVitalsLoaded) return;
  window.aver = window.aver || {};
  window.aver._rumVitalsLoaded = true;

  var PO = window.PerformanceObserver;
  var supported = PO && PO.supportedEntryTypes;
  if (!supported) return;

  var lcp = null;   // ms
  var cls = 0;      // unitless score
  var clsSeen = false;
  var inp = null;   // ms (approximate — see header)

  function observe(type, cb, extraOpts) {
    if (supported.indexOf(type) === -1) return;
    try {
      var po = new PO(function (list) {
        try { list.getEntries().forEach(cb); } catch (e) { /* never escalate */ }
      });
      po.observe(Object.assign({ type: type, buffered: true }, extraOpts || {}));
    } catch (e) { /* older PO without `type` option — skip this metric */ }
  }

  observe('largest-contentful-paint', function (entry) {
    lcp = entry.startTime;  // later entries supersede — LCP is "last wins"
  });
  observe('layout-shift', function (entry) {
    if (!entry.hadRecentInput) { cls += entry.value; clsSeen = true; }
  });
  observe('event', function (entry) {
    if (entry.interactionId && (inp === null || entry.duration > inp)) {
      inp = entry.duration;
    }
  }, { durationThreshold: 40 });

  // Same API-base precedence as error-reporter.js (review #755): api.base →
  // runtime-config apiBase → host fallback. Keeps staging vitals off the
  // production table.
  function apiBase() {
    try {
      if (window.api && window.api.base) return window.api.base;
      var rc = window.__AVER_RUNTIME_CONFIG__ || {};
      if (rc.apiBase) return rc.apiBase;
      var host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8000';
      return 'https://ielts-speaking-coach-production.up.railway.app';
    } catch (e) { return ''; }
  }

  // DEBT-2026-07-30-N — mốc thời gian TẢI TRANG, lấy ngay lúc script chạy.
  // Cùng với `age_ms` (khoảng cách tới lúc gửi beacon), nó tách được hai giả
  // thuyết mà pilot 2 không phân xử nổi: tab mở lâu thì `age_ms` rất lớn; còn
  // tải mới mà `release` lại cũ thì `age_ms` nhỏ ⇒ asset rời bị cache cũ.
  var LOADED_AT = Date.now();

  /** Release nướng vào chính tài liệu (app/layout.tsx) — không thể cũ hơn trang. */
  function docRelease() {
    try {
      var el = document.documentElement;
      return (el && el.getAttribute && el.getAttribute('data-release')) || null;
    } catch (e) { return null; }
  }

  function uaString() {
    try {
      var ua = (window.navigator && window.navigator.userAgent) || null;
      return ua ? String(ua).slice(0, 300) : null;
    } catch (e) { return null; }
  }

  // Same tag derivation as error-reporter.js / analytics-beacon.js (ADR-012):
  // __next_f is the App Router flight sink — present on every Next page,
  // absent on legacy.
  function buildPayload() {
    var impl = 'legacy';
    var release = null;
    try {
      impl = (typeof window.__next_f !== 'undefined') ? 'next' : 'legacy';
      release = (window.__AVER_RUNTIME_CONFIG__ || {}).release || null;
    } catch (e) { /* tags are best-effort */ }
    var data = {
      path: (window.location && window.location.pathname) || null,
      implementation: impl,
      release: release,
      // DEBT-2026-07-29-M — without this a slow sample is unattributable. The
      // pilot-2 window opened with p75 = 12624ms over n=4, two of them ≥12s,
      // and nothing in the row could say whether those were real phones on a
      // weak network, an automated browser, or a crawler — so the verdict
      // could be neither trusted nor dismissed. error_logs already stores the
      // UA, so this only makes the two telemetry streams comparable. Capped:
      // the field is for cohort attribution, not forensics.
      ua: uaString(),
      // DEBT-2026-07-30-N — xuất xứ của phép đo:
      //  · `doc_release` đến từ CHÍNH tài liệu; `release` đến từ file rời.
      //    Hai cái khác nhau ⇒ client đang chạy asset cache cũ.
      //  · `age_ms` = trang đã mở bao lâu trước khi beacon bay. Lớn bất thường
      //    ⇒ tab sống lâu, và mẫu LCP của nó không đại diện cho lần tải mới.
      doc_release: docRelease(),
      loaded_at: LOADED_AT,
      age_ms: Math.max(0, Date.now() - LOADED_AT),
    };
    if (lcp !== null) data.lcp = Math.round(lcp);
    if (clsSeen) data.cls = Math.round(cls * 1000) / 1000;
    if (inp !== null) data.inp = Math.round(inp);
    return data;
  }

  var sent = false;
  function send() {
    if (sent) return;
    var data = buildPayload();
    // Nothing measured (e.g. instant bounce before LCP settled) → no row;
    // an empty sample would dilute p75 denominators with nulls.
    if (data.lcp === undefined && data.cls === undefined && data.inp === undefined) return;
    sent = true;
    try {
      if (typeof window.fetch !== 'function') return;
      window.fetch(apiBase() + '/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: 'web_vitals', event_data: data }),
        keepalive: true,
      }).catch(function () { /* best-effort — never surface */ });
    } catch (e) { /* never affect the page */ }
  }

  // First hide wins: visibilitychange→hidden covers tab switch + mobile
  // app-switch (where pagehide may never fire); pagehide covers navigation.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send();
  });
  window.addEventListener('pagehide', send);

  // Exported for tests.
  window.aver._rumBuildPayload = buildPayload;
})();
