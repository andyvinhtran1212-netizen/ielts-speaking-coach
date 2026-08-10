'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

function showBootFailure(message: string) {
  const loading = document.getElementById('state-loading');
  const error = document.getElementById('state-error');
  const detail = document.getElementById('error-msg');
  loading?.classList.remove('active');
  error?.classList.add('active');
  if (detail) detail.textContent = message;
}

export function PracticeLegacyBoot() {
  const { status } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (status === 'initial-loading') return;
    if (status === 'signed-out') {
      window.location.replace('/login.html');
      return;
    }
    if (started.current) return;

    let cancelled = false;
    void (async () => {
      const ready = await whenGlobalReady(
        () => {
          const win = window as any;
          return typeof win.PracticeApp?.init === 'function'
            && typeof win.api?.get === 'function'
            && typeof win.getSupabase === 'function'
            && !!win.getSupabase();
        },
        'PracticeApp + API + Supabase',
      );
      if (cancelled || started.current) return;
      if (!ready) {
        showBootFailure('Không thể khởi động bài luyện. Hãy tải lại trang.');
        return;
      }

      started.current = true;
      try {
        await (window as any).PracticeApp.init();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        (window as any).aver?.reportError?.(
          'practice dark-route boot failed: ' + message,
          { type: 'practice_dark_route_boot_failed' },
        );
        showBootFailure('Không thể khởi động bài luyện. Hãy tải lại trang.');
      }
    })();

    return () => { cancelled = true; };
  }, [status]);

  return null;
}
