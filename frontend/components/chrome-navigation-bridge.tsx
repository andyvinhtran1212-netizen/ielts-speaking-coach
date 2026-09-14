'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { navigationGuardBlocks } from '@/lib/navigation-guard';

const CHROME_SELECTOR = 'aver-chrome, aver-admin-chrome';

function eventAnchor(event: Event): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) return node;
  }
  return null;
}

function internalDestination(anchor: HTMLAnchorElement): URL | null {
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target && target !== '_self') return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) {
    return null;
  }
  // Preserve the chrome's native skip-link/hash behavior.
  if (url.pathname === window.location.pathname
      && url.search === window.location.search
      && url.hash) return null;
  return url;
}

/**
 * Gives the migration-era Shadow DOM chrome a Next-native navigation owner.
 * Modified/middle clicks, downloads, cross-origin URLs and in-page anchors keep
 * their browser semantics; ordinary same-origin clicks use App Router state.
 */
export function ChromeNavigationBridge() {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    const bindings = new Map<Element, () => void>();

    const bind = (host: Element) => {
      if (bindings.has(host)) return;
      const root = host.shadowRoot;
      if (!root) return;

      const navigate = (event: Event) => {
        if (event.defaultPrevented || !(event instanceof MouseEvent)) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = eventAnchor(event);
        if (!anchor) return;
        const url = internalDestination(anchor);
        if (!url) return;
        // Guarded pages keep the native click so beforeunload can present the
        // browser confirmation and retain state when the user cancels.
        if (navigationGuardBlocks()) return;
        event.preventDefault();
        const href = `${url.pathname}${url.search}${url.hash}`;
        if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
          router.push(href);
        }
      };

      const prefetch = (event: Event) => {
        const anchor = eventAnchor(event);
        if (!anchor) return;
        const url = internalDestination(anchor);
        if (!url) return;
        router.prefetch(`${url.pathname}${url.search}`);
      };

      root.addEventListener('click', navigate);
      root.addEventListener('pointerover', prefetch);
      root.addEventListener('focusin', prefetch);
      bindings.set(host, () => {
        root.removeEventListener('click', navigate);
        root.removeEventListener('pointerover', prefetch);
        root.removeEventListener('focusin', prefetch);
      });
    };

    const reconcile = () => {
      if (disposed) return;
      for (const [host, cleanup] of bindings) {
        if (!host.isConnected) {
          cleanup();
          bindings.delete(host);
        }
      }
      document.querySelectorAll(CHROME_SELECTOR).forEach(bind);
    };

    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    for (const tag of ['aver-chrome', 'aver-admin-chrome']) {
      void customElements.whenDefined(tag).then(reconcile);
    }

    return () => {
      disposed = true;
      observer.disconnect();
      bindings.forEach((cleanup) => cleanup());
      bindings.clear();
    };
  }, [router]);

  return null;
}
