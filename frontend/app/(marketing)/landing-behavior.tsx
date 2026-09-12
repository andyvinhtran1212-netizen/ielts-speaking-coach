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

    // RouteScriptChain loads runtime-config after hydration. Do not fall back
    // to production while that script is still in flight on staging.
    function fallbackApiBase(hostname: string) {
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:8000';
      }
      if (hostname === 'averlearning.com' || hostname === 'www.averlearning.com') {
        return 'https://ielts-speaking-coach-production.up.railway.app';
      }
      return null;
    }

    function loadEnvironmentData(allowKnownHostFallback = false) {
      const rc = window.__AVER_RUNTIME_CONFIG__;
      const apiBase = rc?.apiBase ||
        (allowKnownHostFallback ? fallbackApiBase(location.hostname) : null);
      if (!apiBase) return;

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
              release: rc?.release || null,
            },
          }),
        }).catch(() => {
          // Silently fail — a beacon must never surface to the user
        });
      } catch {
        // never affect the page
      }
    }

    function handleRuntimeConfigReady() {
      window.removeEventListener('aver:runtime-config-failed', handleRuntimeConfigFailure);
      loadEnvironmentData();
    }

    function handleRuntimeConfigFailure() {
      window.removeEventListener('aver:runtime-config-ready', handleRuntimeConfigReady);
      loadEnvironmentData(true);
    }

    if (window.__AVER_RUNTIME_CONFIG__) {
      loadEnvironmentData();
    } else {
      window.addEventListener('aver:runtime-config-ready', handleRuntimeConfigReady, { once: true });
      window.addEventListener(
        'aver:runtime-config-failed',
        handleRuntimeConfigFailure,
        { once: true },
      );
    }

    return () => {
      window.removeEventListener('load', hydrateIcons);
      window.removeEventListener('aver:runtime-config-ready', handleRuntimeConfigReady);
      window.removeEventListener('aver:runtime-config-failed', handleRuntimeConfigFailure);
    };
  }, []);

  return null;
}
