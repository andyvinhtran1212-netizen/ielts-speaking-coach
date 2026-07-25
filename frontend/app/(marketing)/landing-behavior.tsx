'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    __AVER_RUNTIME_CONFIG__?: {
      apiBase?: string;
      release?: string;
    };
    lucide?: {
      createIcons?: () => void;
    };
  }
}

export function LandingBehavior() {
  useEffect(() => {
    // ─── LUCIDE HYDRATION + THEME TOGGLE BINDING ─────────────────
    function hydrateIcons() {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    }

    function bindToggleButton() {
      const btn = document.querySelector('.av-theme-toggle');
      if (!btn) return;

      btn.addEventListener('click', function () {
        const current =
          document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem('av-theme', next);
        } catch (e) {
          // Silently fail if localStorage is unavailable
        }
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        hydrateIcons();
        bindToggleButton();
      });
    } else {
      hydrateIcons();
      bindToggleButton();
    }

    window.addEventListener('load', hydrateIcons);

    // ─── PUBLIC STATS LOADER ────────────────────────────────────
    function formatNum(n: any) {
      if (n == null) return '—';
      if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K+';
      return n + '+';
    }

    // Environment-aware API base (js/runtime-config.js) — the old
    // vercel.json rewrite hardcoded production for every environment.
    const rc = window.__AVER_RUNTIME_CONFIG__ || {};
    const apiBase =
      rc.apiBase ||
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:8000'
        : 'https://ielts-speaking-coach-production.up.railway.app');

    fetch(apiBase + '/api/public-stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        document.querySelectorAll('[data-stat]').forEach((el) => {
          const key = el.getAttribute('data-stat');
          if (key && key in data && data[key] != null) {
            el.textContent = formatNum(data[key]);
          }
        });
      })
      .catch(() => {
        // Silently fail if stats endpoint is unavailable
      });

    // ─── ADR-012 PAGE-VIEW BEACON (implementation-tagged) ──────
    // The lean marketing page doesn't load api.js/analytics-beacon.js, so
    // this is a raw-fetch equivalent (same /api/analytics/events contract,
    // anonymous → user_id=NULL) that gives the cutover dashboard a
    // page-view denominator for the migrated landing, tagged next + release.
    // Fire-and-forget; tracking must never affect the page (Pattern #29).
    try {
      fetch(apiBase + '/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'page_view',
          event_data: {
            path: location.pathname,
            referrer: document.referrer || '',
            implementation: 'next',
            release: rc.release || null,
          },
        }),
      }).catch(() => {
        // Silently fail — a beacon must never surface to the user
      });
    } catch {
      // never affect the page
    }
  }, []);

  return null;
}
