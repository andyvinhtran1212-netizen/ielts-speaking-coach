'use client';

// Adapter lifecycle cho hai module từ vựng đã có hợp đồng mount()/unmount().
// Import động chỉ xảy ra sau khi api + Supabase sẵn sàng; cleanup thật sự gọi
// handle.unmount() nên App Router có thể điều hướng mềm mà không giữ listener.
import { useCallback, useEffect, useRef } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export type VocabModuleName = 'flashcards' | 'exercises';

interface VocabModuleHandle {
  unmount?: () => void;
}

interface VocabModule {
  mount: (
    container: HTMLElement,
    options: { embedded: boolean },
  ) => Promise<VocabModuleHandle | null> | VocabModuleHandle | null;
}

interface LoaderModule {
  renderSkeleton: (container: HTMLElement) => void;
  renderError: (
    container: HTMLElement,
    error: Error,
    options: { onRetry: () => void },
  ) => void;
}

function renderFallback(container: HTMLElement, retry: () => void) {
  const wrapper = document.createElement('div');
  wrapper.className = 'vocab-module-error text-center py-16 empty-state';
  const message = document.createElement('p');
  message.className = 'text-sm mb-4';
  message.textContent = 'Không tải được module. Vui lòng thử lại.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mv-add-btn text-sm font-medium px-4 py-1.5 rounded-lg';
  button.textContent = 'Thử lại';
  button.addEventListener('click', retry, { once: true });
  wrapper.append(message, button);
  container.replaceChildren(wrapper);
}

export function VocabModuleMount({
  moduleName,
  embedded,
  accountKey,
  as = 'div',
  id,
  className,
}: {
  moduleName: VocabModuleName;
  embedded: boolean;
  accountKey: string;
  as?: 'div' | 'main';
  id?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const setContainer = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let mounting = false;
    let handle: VocabModuleHandle | null = null;

    const load = async () => {
      if (disposed || mounting || handle) return;
      mounting = true;

      try {
        const ready = await whenGlobalReady(
          () => !!window.api?.base
            && typeof window.getSupabase === 'function'
            && !!window.getSupabase(),
          `vocabulary ${moduleName} dependencies`,
        );
        if (!ready || disposed) throw new Error('dependencies unavailable');

        const loaderUrl = '/js/vocab-modules/_loader.js';
        const moduleUrl = `/js/vocab-modules/${moduleName}.js`;
        const loader = await import(/* webpackIgnore: true */ loaderUrl) as LoaderModule;
        if (disposed) return;
        loader.renderSkeleton(container);

        const vocabModule = await import(/* webpackIgnore: true */ moduleUrl) as VocabModule;
        const mounted = await vocabModule.mount(container, { embedded });
        if (disposed) {
          mounted?.unmount?.();
          return;
        }
        handle = mounted;
      } catch {
        if (disposed) return;
        try {
          const loaderUrl = '/js/vocab-modules/_loader.js';
          const loader = await import(/* webpackIgnore: true */ loaderUrl) as LoaderModule;
          if (!disposed) {
            loader.renderError(container, new Error('Vui lòng thử lại.'), { onRetry: load });
          }
        } catch {
          if (!disposed) renderFallback(container, load);
        }
      } finally {
        mounting = false;
      }
    };

    load();

    return () => {
      disposed = true;
      handle?.unmount?.();
      if (!handle) {
        container.replaceChildren();
        delete container.dataset.mounted;
        delete container.dataset.loading;
      }
    };
  }, [accountKey, embedded, moduleName]);

  if (as === 'main') {
    return <main id={id} className={className} ref={setContainer} />;
  }
  return <div id={id} className={className} ref={setContainer} />;
}
