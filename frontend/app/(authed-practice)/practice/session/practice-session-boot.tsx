'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  createPracticeBootstrapOnce,
  loadPracticeBootstrap,
  PracticeBootstrapError,
  readPracticeSessionId,
} from '@/lib/practice-session-bootstrap.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

function setLoadingMessage(message: string) {
  const player = (window as any).PracticePlayer;
  if (typeof player?.updateView === 'function'
      && player.updateView('frame', { loadingMessage: message })) return;
  const loading = document.getElementById('loading-msg');
  if (loading) loading.textContent = message;
}

function showBootFailure(message: string) {
  const player = (window as any).PracticePlayer;
  const renderedByPlayer = typeof player?.updateView === 'function'
    && player.updateView('frame', { errorMessage: message });
  if (!renderedByPlayer) {
    const detail = document.getElementById('error-msg');
    if (detail) detail.textContent = message;
  }
  if (typeof player?.showState === 'function') {
    player.showState('error');
    return;
  }
  // Fail visibly even if the player bridge itself could not mount.
  document.getElementById('state-loading')?.classList.remove('active');
  document.getElementById('state-error')?.classList.add('active');
}

export function PracticeSessionBoot() {
  const { status, user } = useAuth();
  const bootOnce = useRef<(() => Promise<any>) | null>(null);
  const ownerUserId = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (status === 'initial-loading') return;
    if (status === 'signed-out') {
      window.location.replace('/login.html');
      return;
    }
    if (!user?.id) {
      showBootFailure('Không thể xác nhận tài khoản. Hãy đăng nhập lại.');
      return;
    }
    if (ownerUserId.current && ownerUserId.current !== user.id) {
      // Never reuse an A-owned bootstrap/player after Supabase changes the
      // signed-in account in place. The legacy player has no safe reset API;
      // a hard reload is the fail-closed ownership boundary.
      window.location.reload();
      return;
    }
    ownerUserId.current = user.id;

    let active = true;
    if (!bootOnce.current) {
      // Keep one promise across React StrictMode's effect replay. In
      // particular, question generation is a POST and must not run twice.
      bootOnce.current = createPracticeBootstrapOnce(async () => {
        const ready = await whenGlobalReady(
          () => {
            const win = window as any;
            return typeof win.PracticeApp?.init === 'function'
              && typeof win.PracticePlayer?.showState === 'function'
              && typeof win.PracticeRecorder?.start === 'function'
              && typeof win.PracticeSubmission?.submit === 'function'
              && typeof win.PracticeFullTest?.restore === 'function'
              && typeof win.api?.get === 'function'
              && typeof win.api?.post === 'function'
              && typeof win.api?.getWith === 'function'
              && typeof win.api?.postWith === 'function'
              && typeof win.api?.uploadWith === 'function';
          },
          'PracticeApp + native player + native recorder + native submission + native full-test state + API',
        );
        if (!ready) {
          throw new PracticeBootstrapError(
            'runtime_unavailable',
            'Không thể khởi động bài luyện. Hãy tải lại trang.',
          );
        }

        return loadPracticeBootstrap({
          api: (window as any).api,
          sessionId: readPracticeSessionId(window.location.search),
          userId: ownerUserId.current,
          onPhase: setLoadingMessage,
        });
      });
    }

    void bootOnce.current()
      .then(async (bootstrap) => {
        if (!active || started.current) return;
        started.current = true;
        await (window as any).PracticeApp.init(bootstrap);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof PracticeBootstrapError && error.code === 'auth_required') {
          window.location.replace('/login.html');
          return;
        }
        const message = error instanceof PracticeBootstrapError
          ? error.message
          : ((error as any)?.userMessage
            || 'Không thể khởi động bài luyện. Hãy tải lại trang.');
        const detail = error instanceof Error ? error.message : String(error);
        const code = error instanceof PracticeBootstrapError
          ? error.code
          : ((error as any)?.code || 'unexpected');
        (window as any).aver?.reportError?.(
          'practice native bootstrap failed: ' + detail,
          {
            type: 'practice_native_bootstrap_failed',
            code,
            status: (error as any)?.status ?? null,
            request_id: (error as any)?.request_id ?? null,
            ref: (error as any)?.ref ?? null,
          },
        );
        showBootFailure(message);
      });

    return () => { active = false; };
  }, [status, user?.id]);

  return null;
}
